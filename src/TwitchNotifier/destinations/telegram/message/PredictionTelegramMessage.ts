import { ChannelPointsPredictions, arePredictionsMergeable, ChannelPointsPredictionsOutcome } from "../../../TwitchChannel";
import { TwitchChannelObserver } from "../TwitchChannelObserver";
import { TelegramTextMessage } from "./TelegramTextMessage";
import { format as formatTimeAgo, register as registerTimeAgoFunc } from "timeago.js";
import he from "he";
import { createHash } from "crypto";
import { MAX_TEXT_MESSAGE_LENGTH } from "../../../../constant/telegram";
import { truncateString, getKoreanNumberString, koreanTimeAgoFunc, numberToEmoji } from "../../../../util";

registerTimeAgoFunc('ko-KR', koreanTimeAgoFunc);

export class PredictionTelegramMessage implements TelegramTextMessage {
    id?: number;

    channelObserver: TwitchChannelObserver;
    predictions: ChannelPointsPredictions[];

    private prevRenderedTextMessageHash: string;
    private showChannelName: boolean;
    private readonly maxOutcomeLength = 30;

    private livePreview?: {
        url: string;
        timestamp: number;
        lastPredictionId: string;
        lastPredictionStatus: string;
    };

    constructor(channelObserver: TwitchChannelObserver, showChannelName = true) {
        this.channelObserver = channelObserver;
        this.prevRenderedTextMessageHash = '';
        this.showChannelName = showChannelName;
        this.predictions = channelObserver.predictions;
    }

    addPredictionsFromObserver() {
        this.mergeStatusFromObserver();
        this.predictions.push(...this.channelObserver.predictions);
    }

    mergeStatusFromObserver() {
        if (
            this.predictions.length && 
            this.channelObserver.predictions.length &&
            arePredictionsMergeable(this.predictions[this.predictions.length - 1], this.channelObserver.predictions[0])
        ) {
            this.predictions[this.predictions.length - 1] = this.channelObserver.predictions[0];
            this.channelObserver.predictions.shift();
            return true;
        } else {
            return false;
        }
    }

    private getNotificationTitleText(characterCounter: {count: number}) {
        const channelName = this.showChannelName ? `[${truncateString(this.channelObserver.name, 100)}] ` : '';
        characterCounter.count += channelName.length;

        const prediction = this.predictions[this.predictions.length - 1] as ChannelPointsPredictions | undefined;
        if (!prediction) {
            return '';
        }

        const twitchUrl = `https://www.twitch.tv/${this.channelObserver.twitchChannel.loginName}`;

        let text: string;
        if (prediction.status === 'active') {
            const endsAt = prediction.createdAt + prediction.predictionWindowSeconds * 1000;
            let secondsLeft = Math.floor((endsAt - Date.now()) / 1000);
            if (secondsLeft > 0) {
                if (secondsLeft > prediction.predictionWindowSeconds - 3) {
                    secondsLeft = prediction.predictionWindowSeconds;
                }
                const timesLeftStr = `${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, '0')}`;
                text = `<b>${he.escape(channelName)}예측 시작</b> <a href="${he.escape(twitchUrl)}">⏳</a>${timesLeftStr}`;
                characterCounter.count += 7 + timesLeftStr.length;
            } else {
                text = `<b>${he.escape(channelName)}예측 시작</b> <a href="${he.escape(twitchUrl)}">🚪</a>`;
                characterCounter.count += 7;
            }
        } else if (prediction.status === 'locked') {
            text = `<b>${he.escape(channelName)}예측 시작</b> <a href="${he.escape(twitchUrl)}">🔒</a>`;
            characterCounter.count += 7;
        } else if (prediction.status === 'resolve_pending' || prediction.status === 'resolved') {
            const winningOutcomeIndex = prediction.outcomes.findIndex((outcome) => outcome.id === prediction.winningOutcomeId);
            const winningOutcomeEmoji = numberToEmoji(winningOutcomeIndex + 1);
            text = `<b>${he.escape(channelName)}예측 결과</b> <a href="${he.escape(twitchUrl)}">${winningOutcomeEmoji}</a>`;
            characterCounter.count += 6 + winningOutcomeEmoji.length;
        } else {
            text = `<b>${he.escape(channelName)}예측 취소</b> <a href="${he.escape(twitchUrl)}">❌</a>`;
            characterCounter.count += 7;
        }
        return text;
    }

    private getPredictionTitleText(characterCounter: {count: number}) {
        const prediction = this.predictions[this.predictions.length - 1] as ChannelPointsPredictions | undefined;
        if (!prediction) {
            return '';
        }
        const predictionTitle = truncateString(prediction.title, 150);
        characterCounter.count += predictionTitle.length + 1;
        return `\n<b>${he.escape(predictionTitle)}</b>`;
    }

    private getOutcomeBettingInfoText(proportion: number, outcome: ChannelPointsPredictionsOutcome, useEmoji: boolean) {
        const totalPoints = getKoreanNumberString(outcome.totalPoints, 1);
        const dividendRate = proportion ? `1:${getKoreanNumberString(Math.round((1 / proportion) * 100) / 100, 2)}` : '-:-';
        const totalUsers = getKoreanNumberString(outcome.totalUsers, 1);
        if (useEmoji) {
            return `💰${totalPoints} 🏆${dividendRate} 👥${totalUsers}`;
        } else {
            return `${totalPoints} | ${dividendRate} | ${totalUsers}명`;
        }
    }

    private getOutcomesText(characterCounter: {count: number}) {
        const prediction = this.predictions[this.predictions.length - 1] as ChannelPointsPredictions | undefined;
        if (!prediction) {
            return '';
        }
        const totalBettingPoints = prediction.outcomes.reduce((sum, outcome) => sum + outcome.totalPoints, 0);
        const winningOutcomeIndex = prediction.outcomes.findIndex((outcome) => outcome.id === prediction.winningOutcomeId);

        const getOutcomeText = (outcomeIndex: number, showGraph = true) => {
            let outcomeText = '';
            const outcome = prediction.outcomes[outcomeIndex];
            const outcomeNumber = outcomeIndex === winningOutcomeIndex ? '✅' : numberToEmoji(outcomeIndex + 1);
            const outcomeTitle = truncateString(outcome.title, 50);
            outcomeText += `\n${outcomeNumber} <b>${he.escape(outcomeTitle)}</b>`;
            characterCounter.count += outcomeNumber.length + outcomeTitle.length + 2;

            if (!totalBettingPoints) {
                return outcomeText;
            }
            const proportion = outcome.totalPoints / totalBettingPoints;
            const bettingRate = `${Math.round(proportion * 100)}%`;
            const bettingInfo = this.getOutcomeBettingInfoText(proportion, outcome, true);
            outcomeText += `\n<b>${bettingRate}</b> ${bettingInfo}`;
            characterCounter.count += bettingRate.length + bettingInfo.length + 2;
            
            if (showGraph) {
                const graphLength = Math.round(proportion * 40);
                outcomeText += `\n${'‾'.repeat(graphLength || 1)}`;
                characterCounter.count += graphLength + 1;
            }
            return outcomeText;
        }
        
        let text = '';
        if (
            prediction.status === 'active' || prediction.status === 'locked' ||
            ((prediction.status === 'resolve_pending' || prediction.status === 'resolved') && !prediction.hasBeenActiveOrLocked)
        ) {
            for (let i = 0; i < Math.min(prediction.outcomes.length, this.maxOutcomeLength); ++i) {
                if (i === 0 && totalBettingPoints) {
                    text += `\n${getOutcomeText(i)}`;
                    characterCounter.count += 1;
                } else {
                    text += getOutcomeText(i);
                }
            }
            if (winningOutcomeIndex !== -1 && winningOutcomeIndex >= this.maxOutcomeLength) {
                text += getOutcomeText(winningOutcomeIndex);
            }
        } else if (
            (prediction.status === 'resolve_pending' || prediction.status === 'resolved') && prediction.hasBeenActiveOrLocked
        ) {
            if (winningOutcomeIndex !== -1) {
                text += getOutcomeText(winningOutcomeIndex, false);
            }
        }
        return text;
    }

    render() {
        if (!this.predictions.length) {
            return { text: '', hasTextChanged: false };
        }
        const characterCounter = { count: 0 };
        
        let text = ``;

        text += this.getNotificationTitleText(characterCounter);
        text += this.getPredictionTitleText(characterCounter);
        text += this.getOutcomesText(characterCounter);

        for (let i = this.predictions.length - 2; i >= 0;  --i) {
            const counter = { count: 8 };
            const prediction = this.predictions[i];
            let prevPredictionText = '';
            const seperator = i === this.predictions.length - 2 ? '\n───────' : '\n<tg-spoiler>―――――――</tg-spoiler>';
            prevPredictionText += seperator;

            const timeAgo = formatTimeAgo(prediction.timestamp, 'ko-KR');
            let notificationTitle = ''
            if (prediction.status === 'active' || prediction.status === 'locked') {
                notificationTitle = `\n<tg-spoiler>예측 시작 (${timeAgo})</tg-spoiler>`;
            } else if (prediction.status === 'resolve_pending' || prediction.status ==='resolved') {
                notificationTitle = `\n<tg-spoiler>예측 결과 (${timeAgo})</tg-spoiler>`;
            } else {    
                notificationTitle = `\n<tg-spoiler>예측 취소 (${timeAgo})</tg-spoiler>`;
            }
            prevPredictionText += notificationTitle;
            counter.count += notificationTitle.length;

            const predictionTitle = truncateString(prediction.title, 150);
            prevPredictionText += `\n<tg-spoiler>${he.escape(predictionTitle)}</tg-spoiler>`;
            counter.count += predictionTitle.length + 1;


            const totalBettingPoints = prediction.outcomes.reduce((sum, outcome) => sum + outcome.totalPoints, 0);
            const winningOutcomeIndex = prediction.outcomes.findIndex((outcome) => outcome.id === prediction.winningOutcomeId);
            const getOutcomeText = (outcomeIndex: number, showBettingData: boolean) => {
                let outcomeText = '';
                const outcome = prediction.outcomes[outcomeIndex];
                const outcomeNumber = outcomeIndex === winningOutcomeIndex ? `✓[${outcomeIndex + 1}]` : `[${outcomeIndex + 1}]`;
                const outcomeTitle = truncateString(outcome.title, 50);
                outcomeText += `\n<tg-spoiler>${outcomeNumber} ${he.escape(outcomeTitle)}</tg-spoiler>`;
                counter.count += outcomeNumber.length + outcomeTitle.length + 2;
    
                if (!totalBettingPoints || !showBettingData) {
                    return outcomeText;
                }
                const proportion = outcome.totalPoints / totalBettingPoints;
                const bettingRate = `${Math.round(proportion * 100)}%`;
                const bettingInfo = this.getOutcomeBettingInfoText(proportion, outcome, false);
                outcomeText += `\n<tg-spoiler>${bettingRate} | ${bettingInfo}</tg-spoiler>`;
                counter.count += bettingRate.length + bettingInfo.length + 4;
                
                return outcomeText;
            }

            if (prediction.status === 'active' || prediction.status === 'locked') {
                for (let j = 0; j < Math.min(prediction.outcomes.length, this.maxOutcomeLength); ++j) {
                    prevPredictionText += getOutcomeText(j, false);
                }
            } else if (prediction.status === 'resolve_pending' || prediction.status ==='resolved') {
                if (prediction.hasBeenActiveOrLocked) {
                    if (winningOutcomeIndex !== -1) {
                        prevPredictionText += getOutcomeText(winningOutcomeIndex, true);
                    }
                } else {
                    for (let j = 0; j < Math.min(prediction.outcomes.length, this.maxOutcomeLength); ++j) {
                        prevPredictionText += getOutcomeText(j, j === winningOutcomeIndex);
                    }
                    if (winningOutcomeIndex !== -1 && winningOutcomeIndex >= this.maxOutcomeLength) {
                        prevPredictionText += getOutcomeText(winningOutcomeIndex, true);
                    }
                }
            }

            if (characterCounter.count + counter.count <= MAX_TEXT_MESSAGE_LENGTH - 1) {
                text += prevPredictionText;
                characterCounter.count += counter.count;
            } else {
                break;
            }
        }

        const twitchChannel = this.channelObserver.twitchChannel;

        
        const isLivePreviewRequired = ['active', 'locked', 'resolve_pending', 'resolved'].some(status => this.predictions[this.predictions.length - 1].status === status);
        const isLivePreviewAvailable = twitchChannel.isLivePreviewAvailable ||
        (twitchChannel.liveStartedAt && Date.now() - twitchChannel.liveStartedAt > 20_000);

        const hasLivePreview = isLivePreviewRequired && isLivePreviewAvailable;
        if (hasLivePreview) {
            if (
                !this.livePreview || (
                    Date.now() > this.livePreview.timestamp + 32_000 && ( 
                        this.predictions[this.predictions.length - 1].id !== this.livePreview.lastPredictionId ||
                        this.predictions[this.predictions.length - 1].status !== this.livePreview.lastPredictionStatus
                    )
                )
            ) {
                this.livePreview = {
                    url: twitchChannel.getCachedLivePreviewImageUrl(),
                    timestamp: Date.now(),
                    lastPredictionId: this.predictions[this.predictions.length - 1].id,
                    lastPredictionStatus: this.predictions[this.predictions.length - 1].status
                };
            }
            const livePreview = `<a href="${this.livePreview.url}">‎</a>`;
            ++characterCounter.count;
            text = livePreview + text;
        }

        const hash = createHash('sha256');
        hash.update(text);
        const textHash = hash.digest('hex');

        const hasTextChanged = this.prevRenderedTextMessageHash !== textHash;
        this.prevRenderedTextMessageHash = textHash;

        return { text, hasTextChanged, disableWebPagePreview: !hasLivePreview };
    }
}