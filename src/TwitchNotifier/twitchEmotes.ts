import fs from 'fs';
import { TwitchEmoteSet } from './types/config';


const twitchEmotes = new Map<string, string>();

try {
    const twitchEmotesJson = fs.readFileSync('./config/twitchEmotes.json', 'utf-8');
    const twitchEmoteSets = JSON.parse(twitchEmotesJson) as TwitchEmoteSet[];

    twitchEmoteSets.forEach((emoteSet) => {
        Object.entries(emoteSet).forEach(([name, alt]) => {
            twitchEmotes.set(name, alt || name);
        });
    });

} catch (err) {
}

export { twitchEmotes };