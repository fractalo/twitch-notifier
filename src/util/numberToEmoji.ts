export const numberToEmoji = (num: number) => {
    if (num === 1) {
        return '1️⃣';
    } else if (num === 2) {
        return '2️⃣';
    } else if (num === 3) {
        return '3️⃣';
    } else if (num === 4) {
        return '4️⃣';
    } else if (num === 5) {
        return '5️⃣';
    } else if (num === 6) {
        return '6️⃣';
    } else if (num === 7) {
        return '7️⃣';
    } else if (num === 8) {
        return '8️⃣';
    } else if (num === 9) {
        return '9️⃣';
    } else if (num === 10) {
        return '🔟';
    } else {
        return `[${num}]`;
    }
};