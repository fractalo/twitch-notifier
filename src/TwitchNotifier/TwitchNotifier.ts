import { ClientCredentialsAuthProvider } from '@twurple/auth';
import { ApiClient as TwitchApiClient } from '@twurple/api';
import { LoggerOptions, LogLevel } from '@d-fischer/logger';
import { PubSubCustomMessage } from '@twurple/pubsub';
import { ChatClient, toChannelName } from '@twurple/chat';

import { GuestPubSubClient } from '../api/twitch/GuestPubSub';
import type { VideoPlaybackStatus, BroadcastSettings, CommunityPointsPredictions } from '../api/twitch/GuestPubSub/topicData';

import { TwitchChannel, ChannelState, StateChange, PredictionStatus } from './TwitchChannel';

import { TwitchChannelConfig, TwitchUserConfig } from './types/config';

import { TelegramBotApiClient } from '../api/telegram/botApiClient';
import { NotifiedTelegramChannel } from './destinations/telegram';
import { TelegarmChannel } from '../api/telegram/types';
import { sleep } from '../util';
import { fibWithLimit } from '../util/fibonacci';


interface TwitchNotifierConfig {
    userConfigs?: TwitchUserConfig[];
    logAlerter?: (message: string) => void;
}

export class TwitchNotifier {
    private twitchUserConfigs: Map<string, TwitchUserConfig>;
    private twitchApiClient: TwitchApiClient;
    private twitchPubsubClient: GuestPubSubClient;
    private twitchChatClient: ChatClient;
    private twitchChatRegistration?: Symbol;
    private twitchChatChannels: Map<string, TwitchChannel>;
    private twitchChannels: Map<string, TwitchChannel>;
    private twitchChannelPromises: Map<string, Promise<TwitchChannel>>;
    private notifiedTelegramChannels: Map<string, NotifiedTelegramChannel>;
    private logAlerter?: (message: string) => void;

    constructor(config?: TwitchNotifierConfig) {
        this.twitchUserConfigs = new Map();
        if (config) {
            config.userConfigs?.forEach(userConfig => this.twitchUserConfigs.set(userConfig.loginName, userConfig));
            this.logAlerter = config.logAlerter;
        }
        
        const twitchAuthProvider = new ClientCredentialsAuthProvider(process.env.TWITCH_API_CLIENT_ID!, process.env.TWITCH_API_CLIENT_SECRET!);
        this.twitchApiClient = new TwitchApiClient({ authProvider: twitchAuthProvider, logger: this.getTwurpleCustomLoggerOptions('apiClient') });
        this.twitchPubsubClient = new GuestPubSubClient({ authProvider: twitchAuthProvider, logger: this.getTwurpleCustomLoggerOptions('pubsub') });

        this.twitchChatClient = new ChatClient({ logger: this.getTwurpleCustomLoggerOptions('chat') });
        this.twitchChatClient.onMessage((chatChannelName, chatterLoginName, text, msg) => {
            const channel = this.twitchChatChannels.get(chatChannelName);
            if (channel && channel.chatListener && text) {
                channel.chatListener(chatterLoginName, text, msg);
            }
        });
        this.twitchChatClient.onRegister(() => {
            this.twitchChatRegistration = Symbol();
            this.twitchChatChannels.forEach((channel) => {
                this.tryJoinChatChannel(channel.loginName);
            });
        });
        this.twitchChatClient.connect();

        this.twitchChatChannels = new Map();
        this.twitchChannels = new Map();
        this.twitchChannelPromises = new Map();
        this.notifiedTelegramChannels = new Map();
    }

    private alertLog(message: string) {
        this.logAlerter && this.logAlerter(message);
    }

    private getTwurpleCustomLoggerOptions(type: string): Partial<LoggerOptions> {
        return {
            custom: (level: LogLevel, message: string) => {
                const logMessage = `twurple:${type} [${LogLevel[level]}] ${message}`;
                this.alertLog(logMessage);
            },
            minLevel: 'warning',
        }
    }

    private async subscribePubSub(twitchChannel: TwitchChannel) {
        const broadcastSettingsUpdateListener = (message: PubSubCustomMessage) => {
            const data = message.data as BroadcastSettings;
            const newTitle = data.status?.trim();
            const newCategoryId = data.game_id ? data.game_id.toString() : '';
            const newCategoryName = data.game?.trim();
            const updates = new Set<StateChange>();
            if (twitchChannel.state.title !== newTitle) {
                twitchChannel.state.title = newTitle;
                newTitle && updates.add('title');
            }
            if (
                twitchChannel.state.categoryId !== newCategoryId && 
                twitchChannel.state.categoryName !== newCategoryName
            ) {
                twitchChannel.state.categoryId = newCategoryId;
                twitchChannel.state.categoryName = newCategoryName;
                newCategoryId && newCategoryName && updates.add('category');
            }
            twitchChannel.notifyChannelUpdates(updates);
        };

        const streamUpDownListener = (message: PubSubCustomMessage) => {
            const data = message.data as VideoPlaybackStatus;
            const updates = new Set<StateChange>();
            if (data.type === 'stream-up') {
                twitchChannel.state.isLive = true;
                twitchChannel.liveStartedAt = Date.now();
                twitchChannel.isLivePreviewAvailable = false;
                updates.add('online');
            } else if (data.type === 'stream-down') {
                twitchChannel.state.isLive = false;
                twitchChannel.isLivePreviewAvailable = false;
                updates.add('offline');
            }
            twitchChannel.notifyChannelUpdates(updates);
        };

        const pointsPredictionsListener = (message: PubSubCustomMessage) => {
            const data = message.data as CommunityPointsPredictions;
            const timestamp = new Date(data.data?.timestamp || 0).getTime() || null;
            const id = data.data?.event?.id;
            const createdAt = new Date(data.data?.event?.created_at || 0).getTime() || null;
            if (!timestamp || !id || !createdAt) {
                return;
            }
            const latestPrediction = twitchChannel.pointsPrediction;
            const isPastPrediction = latestPrediction && (
                latestPrediction.timestamp > timestamp ||
                (latestPrediction.id !== id && latestPrediction.createdAt > createdAt)
            );
            if (isPastPrediction) {
                return;
            }
            
            const winningOutcomeId = data.data?.event?.winning_outcome_id;
            const hasWinningOutcome = winningOutcomeId && !!data.data?.event?.outcomes?.some((outcome) => {
                return outcome?.id && outcome?.id === winningOutcomeId;
            });

            let isExistingActiveStatusUpdate = false;
            const isExistingPredictionUpdate = !!latestPrediction && latestPrediction.id === id;
            
            let status: PredictionStatus | null = null;
            switch (data.data?.event?.status) {
                case "ACTIVE":
                    if (!isExistingPredictionUpdate || latestPrediction.status === 'active') {
                        status = 'active';
                        isExistingActiveStatusUpdate = isExistingPredictionUpdate;
                    }
                    break;
                case "LOCKED":
                    if (!isExistingPredictionUpdate || latestPrediction.status === 'active') {
                        status = 'locked';
                    }
                    break;
                case "RESOLVE_PENDING":
                    if (
                        hasWinningOutcome &&
                        (!isExistingPredictionUpdate || ['resolve_pending', 'resolved'].every(status => latestPrediction.status !== status))
                    ) {
                        status = 'resolve_pending';
                    }
                    break;
                case "RESOLVED":
                    if (
                        hasWinningOutcome && 
                        (!isExistingPredictionUpdate || latestPrediction.status !== 'resolved')
                    ) {
                        status = 'resolved';
                    }
                    break;
                case "CANCEL_PENDING":
                case "CANCELED":
                    if (isExistingPredictionUpdate && latestPrediction.status !== 'canceled') {
                        status = 'canceled';
                    }
                    break;
                default:
            }
            if (!status) {
                return;
            }

            const predictionWindowSeconds = Number(data.data?.event?.prediction_window_seconds);
            
            twitchChannel.notifyChannelPredictions({
                timestamp,
                id,
                createdAt,
                status,
                predictionWindowSeconds: (!isNaN(predictionWindowSeconds) && predictionWindowSeconds > 0) ? 
                    predictionWindowSeconds : 0,
                title: data.data?.event?.title || '',
                outcomes: data.data?.event?.outcomes?.map((outcome) => {
                    const totalPoints = Number(outcome?.total_points);
                    const totalUsers = Number(outcome?.total_users);
                    return {
                        id: outcome?.id || '',
                        title: outcome?.title || '',
                        totalPoints: (!isNaN(totalPoints) && totalPoints > 0) ? totalPoints : 0,
                        totalUsers: (!isNaN(totalUsers) && totalUsers > 0) ? totalUsers : 0,
                    };
                }) || [],
                winningOutcomeId,
                hasBeenActiveOrLocked: (status === 'active' || status === 'locked') || (isExistingPredictionUpdate && latestPrediction.hasBeenActiveOrLocked)
            }, isExistingActiveStatusUpdate);
        }

        const pubsubListeners = await Promise.all([
            this.twitchPubsubClient.onTopic('broadcast-settings-update', twitchChannel.id, broadcastSettingsUpdateListener),
            this.twitchPubsubClient.onTopic('video-playback-by-id', twitchChannel.id, streamUpDownListener),
            this.twitchPubsubClient.onTopic('predictions-channel-v1', twitchChannel.id, pointsPredictionsListener),
        ]);
        pubsubListeners.forEach(listener => twitchChannel.addPubsubListener(listener));
        console.log(new Date(), 'Subscribed to channel PubSub:', twitchChannel.loginName);
    }

    private subscribeChatMessage(twitchChannel: TwitchChannel) {
        twitchChannel.chatListener = (chatterLoginName, text, msg) => {
            if (!twitchChannel.commonMonitoredChatters.has(chatterLoginName)) {
                return;
            }
            twitchChannel.notifyChatters(chatterLoginName, text, msg);
        };
    }

    private async tryJoinChatChannel(loginName: string) {
        const registrationSymbol = this.twitchChatRegistration;
        let retryCount = 0;
        const retryTimer = fibWithLimit(120);
        while (
            this.twitchChatClient.isRegistered &&
            this.twitchChatRegistration === registrationSymbol
        ) {
            try {
                await this.twitchChatClient.join(loginName);
                console.log(new Date(), 'Joined to channel chat:', loginName);
                break;
            } catch (err) {
                this.alertLog(`Failed to join channel chat: ${loginName}\nerror message: ${err instanceof Error ? err.message : err}`);
                if (++retryCount > 10) {
                    this.twitchChatClient.reconnect()
                    .catch((err) => this.alertLog(`Failed to reconnect chat client.\nerror message: ${err instanceof Error ? err.message : err}`));
                    break;
                }
                const secs = retryTimer.next().value;
                await sleep(secs * 1000);
            }
        }
    }

    private async createTwitchChannel(loginName: string) {
        const user = await this.twitchApiClient.users.getUserByName(loginName).catch(() => {});
        if (!user) throw new Error(`Failed to get user of ${loginName}`);

        const channelInfo = await this.twitchApiClient.channels.getChannelInfoById(user.id).catch(() => {});
        if (!channelInfo) throw new Error(`Failed to get channelInfo of ${loginName}`);

        const stream = await this.twitchApiClient.streams.getStreamByUserId(user.id)
        .catch(() => {
            throw new Error(`Failed to get stream of ${loginName}`);
        });

        const initState: ChannelState = {
            isLive: !!stream,
            title: channelInfo.title,
            categoryId: channelInfo.gameId,
            categoryName: channelInfo.gameName
        };
        const twitchChannel = new TwitchChannel(user, initState);
        await twitchChannel.initImageUrls(user.profilePictureUrl, user.offlinePlaceholderUrl);
        twitchChannel.userUpdateTimer = setInterval(async() => {
            const user = await this.twitchApiClient.users.getUserById(twitchChannel.id).catch(() => {});
            if (!user) return;
            if (user.offlinePlaceholderUrl && user.offlinePlaceholderUrl !== twitchChannel.offlineImageUrl) {
                twitchChannel.offlineImageUrl = user.offlinePlaceholderUrl;
            }
            if (user.profilePictureUrl && user.profilePictureUrl !== twitchChannel.profileImageUrl) {
                twitchChannel.profileImageUrl = user.profilePictureUrl;
            }
        }, 3 * 60 * 60_000);

        await this.subscribePubSub(twitchChannel);

        this.subscribeChatMessage(twitchChannel);
        this.twitchChatChannels.set(toChannelName(loginName), twitchChannel);
        await this.tryJoinChatChannel(loginName);

        return twitchChannel;
    }

    private async getTwitchChannel(loginName: string) {
        let twitchChannel = this.twitchChannels.get(loginName);
        if (twitchChannel) {
            return twitchChannel;
        }
        let twitchChannelPromise = this.twitchChannelPromises.get(loginName);
        if (!twitchChannelPromise) {
            twitchChannelPromise = this.createTwitchChannel(loginName);
            this.twitchChannelPromises.set(loginName, twitchChannelPromise);
            twitchChannelPromise.then((channel) => {
                this.twitchChannelPromises.delete(loginName);
                this.twitchChannels.set(loginName, channel)
            });
        }
        twitchChannel = await twitchChannelPromise;
        return twitchChannel;
    }

    private getUserConfig(user: string | TwitchUserConfig) {
        if (typeof user !== 'string') {
            return user;
        }
        let userConfig = this.twitchUserConfigs.get(user);
        if (!userConfig) {
            userConfig = { loginName: user };
            this.twitchUserConfigs.set(user, userConfig);
        }
        return userConfig;
    }

    async addTelegramChannel(telegramChannel: TelegarmChannel, telegramBot: TelegramBotApiClient, twitchChannelConfigs: TwitchChannelConfig[]) {
        const notifiedTelegramChannel = new NotifiedTelegramChannel(telegramChannel, telegramBot, { logAlerter: this.logAlerter });
        await Promise.all(
            twitchChannelConfigs.map(async(config) => {
                const userConfig = this.getUserConfig(config.channel);
                if (config.options.monitoredChatters) {
                    config.options.monitoredChatters = config.options.monitoredChatters.map(user => this.getUserConfig(user));
                }
                const twitchChannel = await this.getTwitchChannel(userConfig.loginName);
                notifiedTelegramChannel.subscribeTwitchChannel(twitchChannel, userConfig, config.options);
            })
        );
        this.notifiedTelegramChannels.set(telegramChannel.chatId, notifiedTelegramChannel);
    }

} 