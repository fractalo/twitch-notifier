export const truncateString = (str: string, lengthLimit: number) => {
    if (lengthLimit <= 0) {
        return '';
    }
    return str.length > lengthLimit ? str.slice(0, lengthLimit - 1) + '…' : str;
};