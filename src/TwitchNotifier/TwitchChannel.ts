import { PubSubMessage, PubSubListener } from '@twurple/pubsub/lib';
import { LivePreview, LivePreviewImage } from '../api/twitch/LivePreview';
import { HelixUser } from '@twurple/api/lib';
import { NotificationOption, TwitchUserConfig } from './types/config';
import { TwitchPrivateMessage } from '@twurple/chat/lib/commands/TwitchPrivateMessage';


export type StateChange = 'online' | 'offline' | 'title' | 'category';

export type PredictionStatus = 'active' | 'locked' | 'resolve_pending' | 'resolved' | 'canceled';

export interface ChannelUpdate {
    changes: Set<StateChange>;
    state: ChannelState;
    updatedAt?: number;
}

export interface ChannelState {
    isLive: boolean;
    title: string;
    categoryId: string;
    categoryName: string;
}

export interface ChannelPointsPredictionsOutcome {
    id: string;
    title: string;
    totalPoints: number;
    totalUsers: number;
}

export interface ChannelPointsPredictions {
    timestamp: number;
    id: string;
    createdAt: number;
    status: PredictionStatus;
    predictionWindowSeconds: number;
    title: string;
    outcomes: ChannelPointsPredictionsOutcome[];
    winningOutcomeId: string | null;
    hasBeenActiveOrLocked: boolean;
}

export type StateUpdateListener = (update: ChannelUpdate) => Promise<void>;

type ChatListener = (chatterLoginName: string, text: string, msg: TwitchPrivateMessage) => void;

export interface StateUpdateSubscriber {
    listener: StateUpdateListener;
    options: NotificationOption;
}

export type PredictionsUpdateListener = (prediction: ChannelPointsPredictions) => Promise<void>;

export interface PredictionsSubscriber {
    listener: PredictionsUpdateListener;
    activeStatusUpdatedAt?: number;
    activeStatusUpdateInterval: number;
}

export type ChatterListener = (chatterLoginName: string, text: string, messageParts: ReturnType<TwitchPrivateMessage["parseEmotes"]>) => Promise<void>; 

export interface ChatterSubscriber {
    listener: ChatterListener;
    monitoredChatters: Set<string>;
}

export interface TwitchChatMessage {
    channel: TwitchUserConfig;
    chatter: TwitchUserConfig;
    text: string;
    messageParts: ReturnType<TwitchPrivateMessage["parseEmotes"]>;
}

export class TwitchChannel {
    id: string;
    loginName: string;
    displayName: string;
    state: ChannelState;
    pointsPrediction: ChannelPointsPredictions | null;
    liveStartedAt: number | null;
    userUpdateTimer?: NodeJS.Timer;
    isLivePreviewAvailable: boolean;
    profileImageUrl: string;
    offlineImageUrl: string;
    chatListener?: ChatListener;
    commonMonitoredChatters: Set<string>;

    private lastCopiedState?: ChannelState;
    private pubsubListeners: PubSubListener<PubSubMessage>[];

    private stateUpdateSubscribers: StateUpdateSubscriber[];
    private predictionsSubscribers: PredictionsSubscriber[];
    private chatterSubscribers: ChatterSubscriber[];

    private livePreviewImagePromise: Promise<LivePreviewImage | null> | null;
    private livePreivewImageUrlCache: null | { url: string; createdAt: number; };


    constructor(user: HelixUser, initState: ChannelState) {
        this.id = user.id;
        this.loginName = user.name;
        this.displayName = user.displayName;
        this.state = initState;
        this.pointsPrediction = null;
        this.liveStartedAt = initState.isLive ? Date.now() : null;
        this.isLivePreviewAvailable = false;
        this.pubsubListeners = [];
        this.stateUpdateSubscribers = [];
        this.predictionsSubscribers = [];
        this.chatterSubscribers = [];
        this.commonMonitoredChatters = new Set();
        this.livePreviewImagePromise = null;
        this.livePreivewImageUrlCache = null;
        this.profileImageUrl = '';
        this.offlineImageUrl = '';
    }

    async initImageUrls(profileImageUrl: string, offlineImageUrl: string) {
        this.profileImageUrl = profileImageUrl;
        this.offlineImageUrl = offlineImageUrl;
    }

    addPubsubListener(listener: PubSubListener<PubSubMessage>) {
        this.pubsubListeners.push(listener);
    }

    addStateUpdateSubscriber(subscriber: StateUpdateSubscriber) {
        this.stateUpdateSubscribers.push(subscriber);
    }

    addPredictionsSubscriber(subscriber: PredictionsSubscriber) {
        this.predictionsSubscribers.push(subscriber);
    }

    addChatterSubscriber(subscriber: ChatterSubscriber) {
        subscriber.monitoredChatters.forEach(chatter => this.commonMonitoredChatters.add(chatter));
        this.chatterSubscribers.push(subscriber);
    }

    private filterChannelChanges(changes: Set<StateChange>, state: ChannelState, options: NotificationOption) {
        const filteredChanges = new Set<StateChange>();
        const setNotifications = (type: StateChange, doNotify: boolean | undefined) => {
            if (doNotify && changes.has(type)) {
                filteredChanges.add(type);
            }
        };
        setNotifications('online', options.notifiesOnline);
        setNotifications('offline', options.notifiesOffline);
        setNotifications('title', options.notifiesTitle);
        setNotifications('category', options.notifiesCategory && !options.excludedCategoryNames?.some((excludedName) => state.categoryName === excludedName));
        return filteredChanges;
    }

    notifyChannelUpdates(changes: Set<StateChange>) {
        if (!changes.size) {
            return;
        }
        const state = this.getCurrentState();
        const updatedAt = Date.now();

        this.stateUpdateSubscribers.forEach(subscriber => {
            const filteredChanges = this.filterChannelChanges(changes, state, subscriber.options);
            if (!filteredChanges.size) {
                return;
            }
            subscriber.listener({ changes: filteredChanges, state, updatedAt });
        });
    }

    private areStatesEqual(state1: ChannelState, state2: ChannelState) {
        return (
            state1.isLive === state2.isLive &&
            state1.title === state2.title &&
            state1.categoryName === state2.categoryName &&
            state1.categoryId === state2.categoryId
        );
    }

    getCurrentState(): ChannelState {
        if (!this.lastCopiedState || !this.areStatesEqual(this.state, this.lastCopiedState)) {
            this.lastCopiedState = { ...this.state };
        }
        return this.lastCopiedState;
    }

    notifyChannelPredictions(pointsPrediction: ChannelPointsPredictions, isExistingActiveStatusUpdate: boolean) {
        this.pointsPrediction = pointsPrediction;

        this.predictionsSubscribers.forEach(subscriber => {
            if (
                isExistingActiveStatusUpdate && 
                subscriber.activeStatusUpdatedAt &&
                Date.now() < subscriber.activeStatusUpdatedAt + subscriber.activeStatusUpdateInterval
            ) {
                return;
            }
            if (pointsPrediction.status === 'active') {
                subscriber.activeStatusUpdatedAt = Date.now();
            }
            subscriber.listener(pointsPrediction);
        });
    }

    notifyChatters(chatterLoginName: string, text: string, msg: TwitchPrivateMessage) {
        const messageParts = msg.parseEmotes();
        this.chatterSubscribers.forEach(subscriber => {
            if (!subscriber.monitoredChatters.has(chatterLoginName)) {
                return;
            }
            subscriber.listener(chatterLoginName, text, messageParts);
        });
    }

    getCachedLivePreviewImageUrl() {
        const cache = this.livePreivewImageUrlCache;
        if (cache && Date.now() - cache.createdAt < 1000) {
            return cache.url;
        } else {
            const url = LivePreview.getImageUrl(this.loginName);
            this.livePreivewImageUrlCache = { url, createdAt: Date.now() };
            return url;
        }
    }

    async getLivePreviewImage() {
        if (this.livePreviewImagePromise) {
            return this.livePreviewImagePromise;
        }
        this.livePreviewImagePromise = LivePreview.getImage(this.loginName);
        this.livePreviewImagePromise.then(() => this.livePreviewImagePromise = null);
        return this.livePreviewImagePromise;
    }

    async tryGetLivePreviewImage(timeout: number, { signal }: { signal?: AbortSignal } = {} ) {
        const timeEnd = Date.now() + timeout;
        let aborted = !!signal?.aborted;
        if (aborted || !this.state.isLive) {
            return null;
        }
        const abortHandler = () => { aborted = true };
        signal?.addEventListener("abort", abortHandler);

        let image: LivePreviewImage | null = null;
        do {
            image = await this.getLivePreviewImage();
        } while (!aborted && this.state.isLive && !image && Date.now() < timeEnd);

        if (image && this.state.isLive) {
            this.isLivePreviewAvailable = true;
        }

        signal?.removeEventListener("abort", abortHandler);
        return image;
    }

}

export const arePredictionsMergeable = (existing: ChannelPointsPredictions, addition: ChannelPointsPredictions) => {
    const isActiveStatusMergeable = existing.id === addition.id &&
    existing.status === 'active' &&
    (addition.status === 'active' || addition.status === 'locked');
    
    const isResolveStatusMergeable = existing.id === addition.id &&
    existing.status === 'resolve_pending' &&
    addition.status === 'resolved';

    return isActiveStatusMergeable || isResolveStatusMergeable;
};