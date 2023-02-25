const getNumberOfDigits = (number: number) => {
    return Math.max(Math.floor(Math.log10(Math.abs(number))), 0) + 1;
};


export const getKoreanNumberString = (number: number, maxDecimalPlaces: number) => {
    const units = ['', '만', '억', '조', '경', '해'];
    const grouping = 4;

    let i = 0;
    while (getNumberOfDigits(number) > grouping && i + 1 < units.length) {
        number /= 10 ** grouping;
        ++i;
    }

    const decimalPlaces = Math.max(Math.min(grouping - getNumberOfDigits(number), grouping - 1, maxDecimalPlaces), 0);
    number = Math.round(number * (10 ** decimalPlaces)) / (10 ** decimalPlaces);
    return `${number}${units[i] || ''}`;
};