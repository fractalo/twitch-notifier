import * as dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import path from 'path';
import { Telegraf } from 'telegraf';

import { TwitchNotifier, TwitchNotifierChannelConfig, TwitchUserConfig } from './TwitchNotifier';

import { TelegramBotApiClient } from './api/telegram/botApiClient';

(async() => {
    const personalTGBot = process.env.TELEGRAM_PERSONAL_BOT_TOKEN ? new Telegraf(process.env.TELEGRAM_PERSONAL_BOT_TOKEN) : null;
    const alertToTelegram = (message: string) => {
        console.log(new Date(), message);
        message = `[${process.env.RUNNING_ON}] ${message}`;
        personalTGBot && personalTGBot.telegram.sendMessage(process.env.TELEGRAM_SELF_CHATID!, message.slice(0, 4096)).catch(() => {});
    }

    const twitchNotiTGBot = new TelegramBotApiClient(process.env.TELEGRAM_TWITCH_NOTI_BOT_TOKEN!, process.env.TELEGRAM_TWITCH_NOTI_BOT_NAME);

    let twitchChatNotiTGBot: TelegramBotApiClient | null = null;
    if (process.env.TELEGRAM_TWITCH_CHAT_NOTI_BOT_TOKEN) {
        twitchChatNotiTGBot = new TelegramBotApiClient(process.env.TELEGRAM_TWITCH_CHAT_NOTI_BOT_TOKEN, process.env.TELEGRAM_TWITCH_CHAT_NOTI_BOT_NAME);
    }

    try {
        const configPath = './config';
        const notificationDestinations = ['telegram'];

        const userConfigsJson = await fs.readFile(path.resolve(configPath, 'users.json'), 'utf-8');
        const userConfigs = JSON.parse(userConfigsJson) as TwitchUserConfig[];

        const twitchNotifier = new TwitchNotifier({ userConfigs, logAlerter: alertToTelegram });

        const destinationAddingPromises = new Map<string, Promise<string>[]>();

        for (const destination of notificationDestinations) {
            const configDirectoryPath = path.resolve(configPath, destination);
            const fileNames = await fs.readdir(configDirectoryPath);
            for (const fileName of fileNames) {
                const configFilePath = path.resolve(configDirectoryPath, fileName);
                const stat = await fs.lstat(configFilePath);
                if (!stat.isFile()) {
                    continue;
                }

                const configJson = await fs.readFile(configFilePath, 'utf-8');
                const config = JSON.parse(configJson) as TwitchNotifierChannelConfig;

                let addingPromise: Promise<string> | null = null;
                if (config.type === 'telegram') {
                    const bot = config.botName === process.env.TELEGRAM_TWITCH_CHAT_NOTI_BOT_NAME && twitchChatNotiTGBot ? twitchChatNotiTGBot : twitchNotiTGBot;
                    addingPromise = twitchNotifier.addTelegramChannel(config.telegramChannel, bot, config.twitchChannels)
                    .then(() => config.telegramChannel.name || config.telegramChannel.chatId);
                }

                if (addingPromise) {
                    const promises = destinationAddingPromises.get(config.type);
                    if (!promises) {
                        destinationAddingPromises.set(config.type, [addingPromise]);
                    } else {
                        promises.push(addingPromise);
                    }
                }
            }
        }

        destinationAddingPromises.forEach(async(promises, destinationType) => {
            const destinationNames = await Promise.all(promises);
            console.log(new Date(), `[Twitch Notifier] ${destinationType} destinations added: \n${destinationNames.join(', ')}`);
        });

    } catch (err) {
        console.error(err);
        alertToTelegram(`${err instanceof Error ? err.message : err}`);
        throw err;
    }

})();
