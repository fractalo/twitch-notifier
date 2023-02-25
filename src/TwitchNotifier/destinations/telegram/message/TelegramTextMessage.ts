import { TwitchChannelObserver } from "../TwitchChannelObserver";

interface RenderedTextMessage {
    text: string;
    hasTextChanged: boolean;
    disableWebPagePreview?: boolean;
}

export interface TelegramTextMessage {
    id?: number;
    type?: string;
    channelObserver?: TwitchChannelObserver;
    render: () => RenderedTextMessage;
}

export interface RenderedText {
    text: string;
    rawTextLength: number;
}

