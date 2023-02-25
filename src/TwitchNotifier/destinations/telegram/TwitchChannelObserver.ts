import { ChannelPointsPredictions, ChannelUpdate, StateChange, TwitchChannel } from "../../TwitchChannel";
import { TwitchUserConfig } from "../../types/config";
import { PredictionTelegramMessage, StateUpdateTelegramMessage } from "./message";
import { MessageRenderStatus } from "./NotifiedTelegramChannel";

interface StateUpdateMessageSending {
    message: StateUpdateTelegramMessage;
    promise: Promise<void>;
    renderStatus: MessageRenderStatus;
}

interface PredictionMessageSending {
    message: PredictionTelegramMessage;
    promise: Promise<void>;
    renderStatus: MessageRenderStatus;
    isEdit: boolean;
}

export class TwitchChannelObserver {
    name: string;
    emoji: string;
    twitchChannel: TwitchChannel;

    notifications: Set<StateChange>;
    latestUpdate: ChannelUpdate;
    previousUpdates: ChannelUpdate[];

    predictions: ChannelPointsPredictions[];

    stateUpdateMessageSending: StateUpdateMessageSending | null;
    livePreviewRetry: { abortController: AbortController; } | null;
    predictionMessageSending: PredictionMessageSending | null;

    constructor(twitchChannel: TwitchChannel, userConfig: TwitchUserConfig) {
        this.name = userConfig.name || userConfig.loginName;
        this.emoji = userConfig.emoji || '';
        this.twitchChannel = twitchChannel;

        this.notifications = new Set();
        this.latestUpdate = {
            changes: new Set(),
            state: twitchChannel.getCurrentState()
        };
        this.previousUpdates = [];

        this.predictions = [];

        this.stateUpdateMessageSending = null;
        this.livePreviewRetry = null;
        this.predictionMessageSending = null;
    }
}