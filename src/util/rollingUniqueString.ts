/**
 * @param array 
 * @param length length of a permutation
 * @param index among the possible permutations with repitition.
 * @returns 
 */
const createPermutationWithRepetition = (array: any[], length: number, index: number) => {
    if (!array.length) {
        return [];
    }
    const permutation = new Array<any>();
    for (let i = 0; i < length; ++i) {
        permutation.push(array[index % array.length]);
        index = Math.floor(index / array.length);
    }
    return permutation.reverse();
}

export const createRollingUniqueString = (charCodes: number[], timeInterval: number, minLength: number, maxLength: number) => {
    if (!charCodes.length) {
        return '';
    }
    if (minLength > maxLength) {
        maxLength = minLength;
    }
    if (maxLength < 1) {
        return '';
    }
    if (minLength < 1) {
        minLength = 1;
    }

    let uniqueStringSize = 0;
    for (let i = minLength; i <= maxLength; ++i) {
        uniqueStringSize += charCodes.length ** i;
    }

    const tick = Math.ceil(timeInterval / uniqueStringSize);
    let index = Math.floor(Date.now() / tick) % uniqueStringSize;
    let length = minLength;

    for (let i = minLength; i <= maxLength; ++i) {
        const size = charCodes.length ** i;
        if (index >= size) {
            index -= size;
        } else {
            length = i;
            break;
        }
    }

    return createPermutationWithRepetition(charCodes, length, index).reduce((concated, charCode) => {
        return concated + String.fromCharCode(charCode);
    }, '');
}