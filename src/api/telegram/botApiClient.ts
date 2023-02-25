import Bottleneck from 'bottleneck';
import { Telegraf, Telegram } from 'telegraf';

const userOutThrottlerOptions: Bottleneck.ConstructorOptions = {
    maxConcurrent: 5,
    minTime: 1000,
};

const groupOutThrottlerOptions: Bottleneck.ConstructorOptions = {
    maxConcurrent: 5,
    minTime: 1000,
    reservoir: 20,
    reservoirRefreshAmount: 20,
    reservoirRefreshInterval: 60_000,
};

const globalOutThrottlerOptions: Bottleneck.ConstructorOptions = {
    minTime: 25,
    reservoir: 30,
    reservoirRefreshAmount: 30,
    reservoirRefreshInterval: 1000,
};

export class TelegramBotApiClient {
    telegram: Telegram;
    readonly name: string;
    private userOutThrottlers: Map<string, Bottleneck>;
    private groupOutThrottlers: Map<string, Bottleneck>;
    private globalOutThrottler: Bottleneck;

    constructor(token: string, name?: string) {
        const bot = new Telegraf(token);
        this.telegram = bot.telegram;
        this.name = name || '';

        this.userOutThrottlers = new Map();
        this.groupOutThrottlers = new Map();
        this.globalOutThrottler = new Bottleneck(globalOutThrottlerOptions);
    }

    private createOutThrottler(options: Bottleneck.ConstructorOptions) {
        const throttler = new Bottleneck(options);
        throttler.chain(this.globalOutThrottler);
        throttler.on('failed', (error, jobInfo) => {
            if (jobInfo.retryCount <= 3) {
                return 100;
            }
        });
        return throttler;
    }

    private isUserChat(chatId: number | string) {
        return !isNaN(Number(chatId)) && Number(chatId) >= 0;
    }

    private isGroupChat(chatId: number | string) {
        return (!isNaN(Number(chatId)) && Number(chatId) < 0) || 
        (typeof chatId === 'string' && chatId.startsWith('@'));
    }

    getThrottler(chatId: number | string) {
        if (this.isUserChat(chatId)) {
            if (!this.userOutThrottlers.has(chatId.toString())) {
                this.userOutThrottlers.set(chatId.toString(), this.createOutThrottler(userOutThrottlerOptions));
            }
            return this.userOutThrottlers.get(chatId.toString());
        } else if (this.isGroupChat(chatId)) {
            if (!this.groupOutThrottlers.has(chatId.toString())) {
                this.groupOutThrottlers.set(chatId.toString(), this.createOutThrottler(groupOutThrottlerOptions));
            }
            return this.groupOutThrottlers.get(chatId.toString());
        } else {
            return null;
        }
    }
}