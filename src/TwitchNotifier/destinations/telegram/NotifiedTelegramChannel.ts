import Bottleneck from 'bottleneck';
import { TelegramBotApiClient } from "../../../api/telegram/botApiClient";
import { TelegarmChannel } from "../../../api/telegram/types";
import { linearFunctionYFromX, sleep } from '../../../util';
import { 
    arePredictionsMergeable, 
    ChannelPointsPredictions, 
    ChannelUpdate, 
    StateChange, 
    TwitchChannel, 
    ChatterListener, 
    TwitchChatMessage 
} from "../../TwitchChannel";
import { NotificationOption, TwitchUserConfig } from "../../types/config";
import { 
    TelegramTextMessage, 
    StateUpdateTelegramMessage, 
    PredictionTelegramMessage, 
    ChatTelegramMessage, 
} from "./message";
import { TwitchChannelObserver } from "./TwitchChannelObserver";


export interface MessageRenderStatus {
    isRenderStarted?: boolean;
}

interface ChatTelegramMessageSending {
    message: ChatTelegramMessage;
    promise: Promise<void>;
    renderStatus: MessageRenderStatus;
}

export interface ChatBuffer {
    buffer: TwitchChatMessage[];
    totalTextLength: number;
}

interface NotifiedTelegramChannelConfig {
    logAlerter?: (message: string) => void;
}

export class NotifiedTelegramChannel {
    private telegramChannel: TelegarmChannel; 
    private telegramBot: TelegramBotApiClient;
    private botThrottler: Bottleneck;

    private twitchChannelObservers: TwitchChannelObserver[];

    private readonly maxChatBufferTotalTextLength = 1_000_000;
    private chatBuffer: ChatBuffer;
    private isNotifyingChat: boolean;
    private chatTelegramMessageSending: ChatTelegramMessageSending | null;

    private flowControl: {
        readonly targetSendingInterval: number;
        readonly minSendingInterval: number;
        readonly maxSendingInterval: number;
        readonly slidingWindowSize: number;
        sendingIntervals: number[];
        lastSentAt?: number;
    };

    private logAlerter?: (message: string) => void;

    constructor(telegramChannel: TelegarmChannel, telegramBot: TelegramBotApiClient, config?: NotifiedTelegramChannelConfig) {
        if (config) {
            this.logAlerter = config.logAlerter;
        }
        this.telegramChannel = telegramChannel;
        this.telegramBot = telegramBot;
        const throttler = telegramBot.getThrottler(telegramChannel.chatId);
        if (!throttler) throw new Error('could not get throttler for telegram channel: ' + telegramChannel.chatId);
        this.botThrottler = throttler;

        this.twitchChannelObservers = [];
        this.chatBuffer = { buffer: [], totalTextLength: 0 };
        this.isNotifyingChat = false;
        this.chatTelegramMessageSending = null;

        this.flowControl = {
            targetSendingInterval: 3000,
            minSendingInterval: 1000,
            maxSendingInterval: 6000,
            slidingWindowSize: 10,
            sendingIntervals: []
        };
    }
    
    private alertLog(message: string) {
        this.logAlerter && this.logAlerter(message);
    }

    private updateSendingInterval() {
        const currentTime = Date.now();
        if (!this.flowControl.lastSentAt) {
            this.flowControl.lastSentAt = currentTime;
            return;
        }
        
        const interval = currentTime - this.flowControl.lastSentAt;
        this.flowControl.sendingIntervals.push(interval);
        if (this.flowControl.sendingIntervals.length > this.flowControl.slidingWindowSize) {
            this.flowControl.sendingIntervals.shift();
        }
        this.flowControl.lastSentAt = currentTime;
    }

    private async delayForFlowControl() {
        const sendingIntervals = this.flowControl.sendingIntervals;
        if (
            sendingIntervals.length < this.flowControl.slidingWindowSize || 
            !this.flowControl.lastSentAt
        ) {
            return;
        }

        const averageInterval = sendingIntervals.reduce((sum, num) => sum + num, 0) / sendingIntervals.length;
        const thresholdInterval = (this.flowControl.targetSendingInterval * 2) - this.flowControl.minSendingInterval;
        if (averageInterval >= thresholdInterval) {
            return;
        }

        const currentInterval = Date.now() - this.flowControl.lastSentAt;
        const correctionInterval = Math.round(linearFunctionYFromX(
            { x: this.flowControl.minSendingInterval, y: this.flowControl.maxSendingInterval },
            { x: thresholdInterval, y: this.flowControl.minSendingInterval },
            averageInterval
        ));

        if (currentInterval >= correctionInterval) {
            return;
        }

        await sleep(correctionInterval - currentInterval);
    }

    private async sendMessage(message: TelegramTextMessage, renderStatus: MessageRenderStatus = {}) {
        return this.botThrottler.schedule(async() => {
            if (message.type === 'CHAT') {
                await this.delayForFlowControl();
            }
            renderStatus.isRenderStarted = true;
            const renderedMessage = message.render();
            if (!renderedMessage.text) {
                throw new Error('rendered message text is empty!');
            }
            this.updateSendingInterval();
            return this.telegramBot.telegram.sendMessage(this.telegramChannel.chatId, renderedMessage.text, {
                parse_mode: 'HTML',
                disable_web_page_preview: renderedMessage.disableWebPagePreview
            });
        })
        .then((tgMsg) => {
            message.id = tgMsg.message_id;
        })
        .catch((err) => {
            const metadata = `channelId: ${this.telegramChannel.chatId} / channelName: ${this.telegramChannel.name || ''} / botName: ${this.telegramBot.name}`;
            this.alertLog(`[ERROR] Failed to send telegram message (${message.channelObserver?.name || message.type})\n${metadata}\nError message: ${err instanceof Error ? err.message : err}`);
        });
    }

    private async editMessageText(message: TelegramTextMessage, renderStatus: MessageRenderStatus = {}) {
        const messageId = message.id;
        if (!messageId) {
            return;
        }
        return this.botThrottler.schedule(async() => {
            renderStatus.isRenderStarted = true;
            const renderedMessage = message.render();
            if (!renderedMessage.text) {
                throw new Error('rendered message text is empty!');
            } else if (!renderedMessage.hasTextChanged) {
                return;
            }
            this.updateSendingInterval();
            return this.telegramBot.telegram.editMessageText(this.telegramChannel.chatId, messageId, undefined, renderedMessage.text, {
                parse_mode: 'HTML',
                disable_web_page_preview: renderedMessage.disableWebPagePreview
            });
        })
        .then(() => {
        })
        .catch((err) => {
            const metadata = `channelId: ${this.telegramChannel.chatId} / channelName: ${this.telegramChannel.name || ''} / botName: ${this.telegramBot.name}`;
            this.alertLog(`[ERROR] Failed to edit telegram message (${message.channelObserver?.name || message.type})\n${metadata}\nError message: ${err instanceof Error ? err.message : err}`);
        });
    }

    private truncateChatBuffer() {
        if (this.chatBuffer.totalTextLength <= this.maxChatBufferTotalTextLength) {
            return;
        }
        
        let deleteCount = 0;
        let reductionSum = 0;
        for (const chatMessage of this.chatBuffer.buffer) {
            if (this.chatBuffer.totalTextLength - reductionSum <= this.maxChatBufferTotalTextLength) {
                break;
            }
            ++deleteCount;
            reductionSum += chatMessage.text.length;
        }

        this.chatBuffer.buffer.splice(0, deleteCount);
        this.chatBuffer.totalTextLength -= reductionSum;
    }

    subscribeTwitchChannel(twitchChannel: TwitchChannel, channelUserConfig: TwitchUserConfig, options: NotificationOption) {
        const twitchChannelObserver = new TwitchChannelObserver(twitchChannel, channelUserConfig);

        let isNotifyingUpdates = false;
        let notifications = new Set<StateChange>();
        let updateBuffer: ChannelUpdate[] = [];

        const channelUpdateListener = async(update: ChannelUpdate) => {
            if (update.changes.has('online') || update.changes.has('offline')) {
                notifications.delete('online');
                notifications.delete('offline');
            }
            update.changes.forEach(change => notifications.add(change));
            updateBuffer.push(update);

            if (isNotifyingUpdates) {
                return;
            }
            isNotifyingUpdates = true;
            
            try {
                let latestUpdate: ChannelUpdate | undefined;
                while (latestUpdate = updateBuffer.pop()) {
                    twitchChannelObserver.notifications = notifications;
                    twitchChannelObserver.previousUpdates = updateBuffer;
                    twitchChannelObserver.latestUpdate = latestUpdate;
                    notifications = new Set();
                    updateBuffer = [];
                    await this.notifyTwitchChannelUpdates(twitchChannelObserver);
                }
            } finally {
                isNotifyingUpdates = false;
            }
        };
        twitchChannel.addStateUpdateSubscriber({ listener: channelUpdateListener, options });

        if (options.notifiesPredictions) {
            let isNotifyingPredictions = false;
            let predictionBuffer: ChannelPointsPredictions[] = [];

            const channelPredictionListener = async(prediction: ChannelPointsPredictions) => {
                if (
                    predictionBuffer.length && 
                    arePredictionsMergeable(predictionBuffer[predictionBuffer.length - 1], prediction)
                ) {
                    predictionBuffer[predictionBuffer.length - 1] = prediction;
                } else {
                    predictionBuffer.push(prediction);
                }

                if (isNotifyingPredictions) {
                    return;
                }
                isNotifyingPredictions = true;

                try {
                    while (predictionBuffer.length) {
                        twitchChannelObserver.predictions = predictionBuffer;
                        predictionBuffer = [];
                        await this.notifyTwitchChannelPredictions(twitchChannelObserver);
                    }
                } finally {
                    isNotifyingPredictions = false;
                }
            };
            twitchChannel.addPredictionsSubscriber({
                listener: channelPredictionListener,
                activeStatusUpdateInterval: 7000
            });
        }

        if (options.monitoredChatters && options.monitoredChatters.length) {
            const chatterConfigs = new Map<string, TwitchUserConfig>();
            const monitoredChatters = new Set<string>();

            options.monitoredChatters.forEach(chatter => {
                const userConfig = typeof chatter === 'string' ? { loginName: chatter } : chatter;
                chatterConfigs.set(userConfig.loginName, userConfig);
                monitoredChatters.add(userConfig.loginName);
            });

            const chatterListener: ChatterListener = async(chatterLoginName, text, messageParts) => {
                const chatterConfig = chatterConfigs.get(chatterLoginName);
                if (!chatterConfig) {
                    return;
                }

                const twitchChatMessage: TwitchChatMessage = {
                    channel: channelUserConfig,
                    chatter: chatterConfig,
                    text,
                    messageParts
                };

                this.chatBuffer.buffer.push(twitchChatMessage);
                this.chatBuffer.totalTextLength += twitchChatMessage.text.length;
                this.truncateChatBuffer();

                if (this.isNotifyingChat) {
                    return;
                }
                this.isNotifyingChat = true;

                try {
                    while (this.chatBuffer.buffer.length) {
                        const chatBuffer = this.chatBuffer;
                        this.chatBuffer = { buffer: [], totalTextLength: 0};

                        await this.notifyTwitchChat(chatBuffer);

                        // Puts back leftover buffer items due to telegram character limit.
                        this.chatBuffer.buffer = [...chatBuffer.buffer, ...this.chatBuffer.buffer];
                        this.chatBuffer.totalTextLength += chatBuffer.totalTextLength;
                        this.truncateChatBuffer();
                    }
                } finally {
                    this.isNotifyingChat = false;
                }                
            };

            twitchChannel.addChatterSubscriber({
                listener: chatterListener,
                monitoredChatters
            });
        }

        this.twitchChannelObservers.push(twitchChannelObserver);
    }

    private sendNewStateUpdateMessage(channelObserver: TwitchChannelObserver) {
        const message = new StateUpdateTelegramMessage(channelObserver, this.twitchChannelObservers.length >= 2);
        const renderStatus = { isRenderStarted: false };
        const promise = this.sendMessage(message, renderStatus);
        promise.then(() => {
            if (
                message.id &&
                message.prevRenderedTextMetadata?.isLivePreviewUpdateRequired
            ) {
                this.updateLivePreview(channelObserver, message);
            }
        });
        channelObserver.stateUpdateMessageSending = { message, promise, renderStatus };
    }

    private async notifyTwitchChannelUpdates(channelObserver: TwitchChannelObserver) {
        if (!channelObserver.stateUpdateMessageSending) {
            return this.sendNewStateUpdateMessage(channelObserver);
        }

        let { message, promise, renderStatus } = channelObserver.stateUpdateMessageSending;

        if (!renderStatus.isRenderStarted) {
            return message.addUpdatesFromObserver();
        }

        await promise;
        if (message.id) {
            this.sendNewStateUpdateMessage(channelObserver);
        } else {
            message.addUpdatesFromObserver();
            renderStatus = { isRenderStarted: false };
            promise = this.sendMessage(message, renderStatus);
            channelObserver.stateUpdateMessageSending = { message, promise, renderStatus };
        }
    }

    private updateLivePreview(channelObserver: TwitchChannelObserver, sentMessage: StateUpdateTelegramMessage) {
        if (channelObserver.livePreviewRetry) {
            channelObserver.livePreviewRetry.abortController.abort();
        }

        const abortController = new AbortController();
        channelObserver.twitchChannel.tryGetLivePreviewImage(20_000, { signal: abortController.signal })
        .then((image) => {
            if (!image || abortController.signal.aborted) {
                return;
            }
            sentMessage.livePreviewImageUrl = image.url;
            this.editMessageText(sentMessage);
        });
        channelObserver.livePreviewRetry = { abortController };
    }

    private sendNewPredictionMessage(channelObserver: TwitchChannelObserver) {
        const message = new PredictionTelegramMessage(channelObserver, this.twitchChannelObservers.length >= 2);
        const renderStatus = { isRenderStarted: false };
        const promise = this.sendMessage(message, renderStatus);
        const isEdit = false;
        channelObserver.predictionMessageSending = { message, promise, renderStatus, isEdit };
    }

    private async notifyTwitchChannelPredictions(channelObserver: TwitchChannelObserver) {
        if (!channelObserver.predictionMessageSending) {
            return this.sendNewPredictionMessage(channelObserver);
        }

        let { message, promise, renderStatus, isEdit } = channelObserver.predictionMessageSending;

        if (!renderStatus.isRenderStarted) {
            if (isEdit) {
                message.mergeStatusFromObserver();
                if (channelObserver.predictions.length) {
                    this.sendNewPredictionMessage(channelObserver);
                }
            } else {
                message.addPredictionsFromObserver();
            }
            return;
        }

        if (!isEdit) {
            await promise;
        }

        if (message.id) {
            const isStatusMerged = message.mergeStatusFromObserver();
            if (isStatusMerged) {
                renderStatus = { isRenderStarted: false };
                promise = this.editMessageText(message, renderStatus);
                isEdit = true;
                channelObserver.predictionMessageSending = { message, promise, renderStatus, isEdit };
            }
            if (channelObserver.predictions.length) {
                this.sendNewPredictionMessage(channelObserver);
            }
        } else {
            message.addPredictionsFromObserver();
            renderStatus = { isRenderStarted: false };
            promise = this.sendMessage(message, renderStatus);
            isEdit = false;
            channelObserver.predictionMessageSending = { message, promise, renderStatus, isEdit };
        }
    }

    private sendNewChatTelegramMessage(chatBuffer: ChatBuffer) {
        const message = new ChatTelegramMessage(chatBuffer, this.twitchChannelObservers.length >= 2);
        const renderStatus = { isRenderStarted: false };
        const promise = this.sendMessage(message, renderStatus);
        this.chatTelegramMessageSending = { message, promise, renderStatus };
    }

    private async notifyTwitchChat(chatBuffer: ChatBuffer) {
        if (!this.chatTelegramMessageSending) {
            return this.sendNewChatTelegramMessage(chatBuffer);
        }

        let { message, promise, renderStatus } = this.chatTelegramMessageSending;

        if (!renderStatus.isRenderStarted) {
            message.addChatMessages(chatBuffer);

            // if chatbuffers didn't completely flushed, must wait for promise to prevent event loop blocking.
            if (!chatBuffer.buffer.length) {
                return;
            }
        }

        await promise;
        if (message.id) {
            this.sendNewChatTelegramMessage(chatBuffer);
        } else {
            message.forceAddChatMessages(chatBuffer);
            renderStatus = { isRenderStarted: false };
            promise = this.sendMessage(message, renderStatus);
            this.chatTelegramMessageSending = { message, promise, renderStatus };
        }
    }
}