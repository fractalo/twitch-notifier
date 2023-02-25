interface Point {
    x: number;
    y: number;
}

export const linearFunctionYFromX = (point1: Point, point2: Point, x: number) => {
    const gradient = (point2.y - point1.y) / (point2.x - point1.x);
    const intercept = point1.y - (gradient * point1.x);
    return gradient * x + intercept;
}