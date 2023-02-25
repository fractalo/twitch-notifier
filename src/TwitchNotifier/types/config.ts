import { TelegarmChannel } from "../../api/telegram/types";

export interface NotificationOption {
    notifiesOnline? : boolean;
    notifiesOffline? : boolean;
    notifiesTitle?: boolean;
    notifiesCategory?: boolean;
    excludedCategoryNames?: string[];
    notifiesPredictions?: boolean;
    monitoredChatters?: Array<TwitchUserConfig | string>;
}

export interface TwitchUserConfig {
    loginName: string;
    name?: string;
    emoji?: string;
}

export interface TwitchChannelConfig {
    channel: TwitchUserConfig | string;
    options: NotificationOption
}

export type TwitchNotifierChannelConfig = TelegramConfig;


interface TelegramConfig {
    type: "telegram";
    telegramChannel: TelegarmChannel;
    botName?: string;
    twitchChannels: TwitchChannelConfig[];
}

export interface TwitchEmoteSet {
    [name: string]: string;
}