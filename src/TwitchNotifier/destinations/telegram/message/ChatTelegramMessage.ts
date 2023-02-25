import he from 'he';
import { RenderedText, TelegramTextMessage } from "./TelegramTextMessage";
import { TwitchChatMessage } from "../../../TwitchChannel";
import { ChatBuffer } from "../NotifiedTelegramChannel";
import { twitchEmotes } from "../../../twitchEmotes";
import { MAX_TEXT_MESSAGE_LENGTH } from '../../../../constant/telegram';
import { createHash } from 'crypto';
import { truncateString } from '../../../../util';

class TwitchChatMessageBlock {
    chatterLoginName: string;
    channelLoginName: string;
    header: RenderedText;
    contents: RenderedText[];
    rawTextLength: number;

    constructor(chatMessage: TwitchChatMessage, header: RenderedText, content: RenderedText) {
        this.chatterLoginName = chatMessage.chatter.loginName;
        this.channelLoginName = chatMessage.channel.loginName;
        this.header = header;
        this.contents = [content];
        this.rawTextLength = header.rawTextLength + content.rawTextLength;
    }

    isAppendable(chatMessage: TwitchChatMessage) {
        return this.chatterLoginName === chatMessage.chatter.loginName &&
        this.channelLoginName === chatMessage.channel.loginName;
    }

    appendContent(content: RenderedText) {
        if (this.contents.length) {
            ++this.rawTextLength; // newline character between content
        }
        this.rawTextLength += content.rawTextLength;
        this.contents.push(content);
    }
}

export class ChatTelegramMessage implements TelegramTextMessage {
    readonly type = 'CHAT';
    id?: number;

    private prevRenderedTextMessageHash: string;

    private chatMessageBlocks: TwitchChatMessageBlock[];
    private totalRawTextLength: number; // Total text length after entities parsing
    private showChannelName: boolean;

    constructor(chatBuffer: ChatBuffer, showChannelName = true) {
        this.prevRenderedTextMessageHash = '';
        this.chatMessageBlocks = [];
        this.totalRawTextLength = 0;
        this.showChannelName = showChannelName;
        this.addChatMessages(chatBuffer);
    }

    addChatMessages(chatBuffer: ChatBuffer) {
        let addedCount = 0;
        for (const chatMessage of chatBuffer.buffer) {
            let rawTextLengthAddition = 0;
            const lastBlock = this.chatMessageBlocks[this.chatMessageBlocks.length - 1] as TwitchChatMessageBlock | undefined;
            
            let header = lastBlock?.header;
            if (!lastBlock || !lastBlock.isAppendable(chatMessage)) {
                header = this.renderChatMessageHeader(chatMessage);
                rawTextLengthAddition += header.rawTextLength;
                if (lastBlock) {
                    rawTextLengthAddition += 2; // newline characters between block
                }
            } else {
                ++rawTextLengthAddition; // newline character between content
            }

            let content = this.renderChatMessageContent(chatMessage);

            // This doesn't happen unless the twitch chat character limit is significantly increased or the twitch emote's alt text in twitchEmotes.json is set too long.
            if (
                !this.chatMessageBlocks.length && 
                rawTextLengthAddition + content.rawTextLength > MAX_TEXT_MESSAGE_LENGTH
            ) {
                content = this.renderChatMessageContent(chatMessage, MAX_TEXT_MESSAGE_LENGTH - rawTextLengthAddition);
            }

            rawTextLengthAddition += content.rawTextLength;
            
            if (this.totalRawTextLength + rawTextLengthAddition > MAX_TEXT_MESSAGE_LENGTH) {
                break;
            }
            
            if (!lastBlock || !lastBlock.isAppendable(chatMessage)) {
                const chatMessageBlock = new TwitchChatMessageBlock(chatMessage, header!, content);
                this.chatMessageBlocks.push(chatMessageBlock);
            } else {
                lastBlock.appendContent(content);
            }
            this.totalRawTextLength += rawTextLengthAddition;
            
            ++addedCount;
            chatBuffer.totalTextLength -= chatMessage.text.length;
        }
        if (addedCount) {
            chatBuffer.buffer = chatBuffer.buffer.slice(addedCount);
        }
    }

    forceAddChatMessages(chatBuffer: ChatBuffer) {
        let prevChatMessageBlocks = this.chatMessageBlocks;
        let prevTotalRawTextLength = this.totalRawTextLength;

        this.chatMessageBlocks = [];
        this.totalRawTextLength = 0;
        this.addChatMessages(chatBuffer);

        if (!prevChatMessageBlocks.length) {
            return;
        }

        if (this.chatMessageBlocks.length) {
            prevTotalRawTextLength += 2; // newline characters between block
        }
        
        let removedCount = 0;
        for (const chatMessageBlock of prevChatMessageBlocks) {
            if (this.totalRawTextLength + prevTotalRawTextLength <= MAX_TEXT_MESSAGE_LENGTH) {
                break;
            }
            prevTotalRawTextLength -= chatMessageBlock.rawTextLength;
            prevTotalRawTextLength -= 2; // newline characters between block
            ++removedCount;
        }
        this.totalRawTextLength += prevTotalRawTextLength;

        if (removedCount) {
            prevChatMessageBlocks = prevChatMessageBlocks.slice(removedCount);
        }
        this.chatMessageBlocks = [...prevChatMessageBlocks, ...this.chatMessageBlocks];

    }

    private renderChatMessageHeader(chatMessage: TwitchChatMessage): RenderedText {
        const isSelfChat = chatMessage.chatter.loginName === chatMessage.channel.loginName;
        const chatterName = chatMessage.chatter.name || chatMessage.chatter.loginName;
        const chatterEmoji = chatMessage.chatter.emoji || '';
        const channelName = chatMessage.channel.name || chatMessage.channel.loginName;

        const chatterInfo = chatterName + chatterEmoji;
        const channelInfo = this.showChannelName && !isSelfChat ? ` → ${channelName}` : '';

        const text = `<b>${he.escape(chatterInfo + channelInfo)}</b>: `;
        let rawTextLength = chatterInfo.length + channelInfo.length;
        rawTextLength += 2; // ": " 

        return { text, rawTextLength };
    }

    private renderChatMessageContent(chatMessage: TwitchChatMessage, lengthLimit: number = -1): RenderedText {
        let rawTextLength = 0;

        // this is to reduce the number of entities as much as possible due to telegram's entities limit (max 100 entities per message)
        const textGroups = new Array<{ isItalic: boolean; text: string; }>();

        for (let i = 0; i < chatMessage.messageParts.length; ++i) {
            const messagePart = chatMessage.messageParts[i];
            const lastTextGroup = textGroups[textGroups.length - 1] as { isItalic: boolean; text: string; } | undefined;

            let text: string;
            let isItalic: boolean;

            if (messagePart.type === 'text') {
                text = messagePart.text;
                isItalic = !messagePart.text.trim().length && !!lastTextGroup?.isItalic;
            } else {
                const alternativeText = twitchEmotes.get(messagePart.name);
                text = alternativeText || messagePart.name;
                isItalic = !alternativeText;
            }

            if (lengthLimit >= 0 && rawTextLength + text.length > lengthLimit) {
                if (messagePart.type !== 'text') {
                    break;
                }
                text = truncateString(text, lengthLimit - rawTextLength);
            }

            rawTextLength += text.length;

            if (lastTextGroup?.isItalic === isItalic) {
                lastTextGroup.text += text;
            } else {
                textGroups.push({isItalic, text});
            }

            if (rawTextLength === lengthLimit) {
                break;
            }
        }

        const text = textGroups.map(group => group.isItalic ? `<i>${he.escape(group.text)}</i>` : he.escape(group.text)).join('');

        return { text, rawTextLength };
    }

    render() {
        const text = this.chatMessageBlocks
        .map((chatMessageBlock, i) => {
            let text = '';
            if (i > 0) {
                text += '\n\n';
            }
            text += chatMessageBlock.header.text;
            text += chatMessageBlock.contents.map((content, i) => i > 0 ? `\n${content.text}` : content.text).join('');
            return text;
        })
        .join('');

        const hash = createHash('sha256');
        hash.update(text);
        const textHash = hash.digest('hex');

        const hasTextChanged = this.prevRenderedTextMessageHash !== textHash;
        this.prevRenderedTextMessageHash = textHash;

        return { text, hasTextChanged, disableWebPagePreview: false };
    }
}