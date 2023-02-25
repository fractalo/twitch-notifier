import { ChannelState, ChannelUpdate, StateChange } from "../../../TwitchChannel";
import { TwitchChannelObserver } from "../TwitchChannelObserver";
import { TelegramTextMessage } from "./TelegramTextMessage";
import { format as formatTimeAgo, register as registerTimeAgoFunc } from "timeago.js";
import he from 'he';
import { createHash } from "crypto";
import { MAX_TEXT_MESSAGE_LENGTH } from "../../../../constant/telegram";
import { truncateString, koreanTimeAgoFunc } from "../../../../util";

registerTimeAgoFunc('ko-KR', koreanTimeAgoFunc);


export class StateUpdateTelegramMessage implements TelegramTextMessage {
    id?: number;
    channelObserver: TwitchChannelObserver;

    notifications: Set<StateChange>;
    latestUpdate: ChannelUpdate;
    previousUpdates: ChannelUpdate[];

    private prevRenderedTextMessageHash: string;
    private showChannelName: boolean;

    livePreviewImageUrl?: string

    prevRenderedTextMetadata: {
        hasLivePreview: boolean;
        liveStartedAt: number | null;
        isLivePreviewUpdateRequired: boolean;
    } | null;

    constructor(channelObserver: TwitchChannelObserver, showChannelName = true) {
        this.channelObserver = channelObserver;
        this.notifications = channelObserver.notifications;
        this.latestUpdate = channelObserver.latestUpdate;
        this.previousUpdates = channelObserver.previousUpdates;
        this.prevRenderedTextMessageHash = '';
        this.showChannelName = showChannelName;
        this.prevRenderedTextMetadata = null;
    }
    
    addUpdatesFromObserver() {
        this.channelObserver.notifications.forEach((notification) => this.notifications.add(notification));
        this.previousUpdates.push(this.latestUpdate);
        this.previousUpdates.push(...this.channelObserver.previousUpdates);
        this.latestUpdate = this.channelObserver.latestUpdate;
    }

    private stateChangesToString(changes: Set<StateChange>, state: ChannelState) {
        const segments = new Array<String>();
        if (changes.has('online') && state.isLive) {
            segments.push('뱅온');
        } else if (changes.has('offline') && !state.isLive) {
            segments.push('뱅종');
        }

        if (changes.has('title') && changes.has('category')) {
            segments.push('방제 & 카테고리 변경');
        } else if (changes.has('title')) {
            segments.push('방제 변경');
        } else if (changes.has('category')) {
            segments.push('카테고리 변경');
        }
        return segments.join(', ');
    }

    private getNotificationTitleText(characterCounter: {count: number}) {
        const channelName = this.showChannelName ? `[${truncateString(this.channelObserver.name, 100)}] ` : '';
        characterCounter.count += channelName.length;

        const stateChanges = this.stateChangesToString(this.notifications, this.latestUpdate.state);
        characterCounter.count += stateChanges.length;

        const twitchUrl = `https://www.twitch.tv/${this.channelObserver.twitchChannel.loginName}`;
        const emoji = this.latestUpdate.state.isLive ? "🔴" : "⚪";
        ++characterCounter.count;

        const text = `<b>${he.escape(channelName + stateChanges)}</b> <a href="${he.escape(twitchUrl)}">${emoji}</a>`
        ++characterCounter.count; // whitespace in front of emoji
        
        return text;
    }

    private getLatestStateText(characterCounter: {count: number}) {
        const title = truncateString(this.latestUpdate.state.title, 140);
        const category = truncateString(this.latestUpdate.state.categoryName, 140);

        let titleText = '';
        if (title) {
            titleText = this.notifications.has('title') ? `\n<b>${he.escape(title)}</b>`: `\n${he.escape(title)}`;
            characterCounter.count += title.length + 1;
        }
        let categoryText = '';
        if (category) {
            categoryText = this.notifications.has('category') ? `\n<b><i>${he.escape(category)}</i></b>`: `\n<i>${he.escape(category)}</i>`;
            characterCounter.count += category.length + 1;
        }
        
        if (this.notifications.has('category') && !this.notifications.has('title')) {
            return categoryText + titleText;
        } else {
            return titleText + categoryText;
        }
    }

    render() {
        const characterCounter = { count: 0 };
        let text = '';
        text += this.getNotificationTitleText(characterCounter);

        if (!(this.notifications.size === 1 && this.notifications.has('offline'))) {
            text += this.getLatestStateText(characterCounter);
        }

        for (let i = this.previousUpdates.length - 1; i >= 0;  --i) {
            let counter = 8;
            const seperator = i === this.previousUpdates.length - 1 ? '\n───────' : '\n<tg-spoiler>―――――――</tg-spoiler>';

            const prevUpdate = this.previousUpdates[i];
            const title = truncateString(prevUpdate.state.title, 140);
            const category = truncateString(prevUpdate.state.categoryName, 140);

            let titleText = '';
            if (title) {
                titleText = `\n<tg-spoiler>${he.escape(title)}</tg-spoiler>`;
                counter += title.length + 1;
            }
            let categoryText = '';
            if (category) {
                categoryText = `\n<tg-spoiler><i>${he.escape(category)}</i></tg-spoiler>`;
                counter += category.length + 1;
            }

            const timeAgo = prevUpdate.updatedAt ? formatTimeAgo(prevUpdate.updatedAt, 'ko-KR') : '이전';
            const stateChanges = this.stateChangesToString(prevUpdate.changes, prevUpdate.state);
            const liveStatus = prevUpdate.state.isLive ? '●': '○';
            const metadata = `${timeAgo} | ${stateChanges} ${liveStatus}`;
            const metadataText = `\n<tg-spoiler>${he.escape(metadata)}</tg-spoiler>`;
            counter += metadata.length + 1;
            
            if (characterCounter.count + counter <= MAX_TEXT_MESSAGE_LENGTH - 1) {
                text += seperator + titleText + categoryText + metadataText;
                characterCounter.count += counter;
            } else {
                break;
            }
        }

        const twitchChannel = this.channelObserver.twitchChannel;
        
        let hasLivePreview = false;
        let isLivePreviewUpdateRequired = false;
        const isLivePreviewRequired = this.latestUpdate.state.isLive && twitchChannel.state.isLive;
        if (isLivePreviewRequired) {
            const isLivePreviewAvailable = twitchChannel.isLivePreviewAvailable ||
                (twitchChannel.liveStartedAt && Date.now() - twitchChannel.liveStartedAt > 20_000);
            if (isLivePreviewAvailable) {
                const livePreview = `<a href="${twitchChannel.getCachedLivePreviewImageUrl()}">‎</a>`;
                ++characterCounter.count;
                text = livePreview + text;
                hasLivePreview = true;
            } else if (
                twitchChannel.liveStartedAt === this.prevRenderedTextMetadata?.liveStartedAt &&
                this.livePreviewImageUrl
            ) {
                const livePreview = `<a href="${this.livePreviewImageUrl}">‎</a>`;
                ++characterCounter.count;
                text = livePreview + text;
                hasLivePreview = true;
            } else {
                isLivePreviewUpdateRequired = true;
            }
        }
        this.prevRenderedTextMetadata = {
            hasLivePreview,
            isLivePreviewUpdateRequired,
            liveStartedAt: twitchChannel.liveStartedAt
        }

        const hash = createHash('sha256');
        hash.update(text);
        const textHash = hash.digest('hex');

        const hasTextChanged = this.prevRenderedTextMessageHash !== textHash;
        this.prevRenderedTextMessageHash = textHash;

        return { text, hasTextChanged, disableWebPagePreview: !hasLivePreview };
    }
}