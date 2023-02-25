interface Preloaded<T> {
    promise: Promise<T>;
    error: boolean;
    timer: NodeJS.Timer;
}

export class PreloadedQueue<T> {
    private queue: Preloaded<T>[];
    private refreshInterval: number;
    private retryInterval: number;
    private preloader: () => Promise<T>;
    private retryTimers: NodeJS.Timer[];

    constructor(size: number, refreshInterval: number, retryInterval: number, preloader: () => Promise<T>) {
        this.queue = [];
        this.refreshInterval = refreshInterval;
        this.retryInterval = retryInterval;
        this.preloader = preloader;
        this.retryTimers = [];
        for (let i = 0; i < size; ++i) {
            this.push();
        }
    }

    private push() {
        const preloaded: Preloaded<T> = {
            promise: this.preloader(),
            timer: setTimeout(() => this.pop(), this.refreshInterval),
            error: false
        }
        preloaded.promise.catch(() => {
            preloaded.error = true;
            clearTimeout(preloaded.timer);
            this.retryTimers.push(setTimeout(() => {
                this.retryTimers.shift();
                while (this.queue.length && this.queue[this.queue.length - 1].error) {
                    this.queue.pop();
                }
                this.push();
            } , this.retryInterval));
        });
        this.queue.push(preloaded);
    }

    pop(): Promise<T> {
        while (this.queue.length) {
            const preloaded = this.queue.shift()!;
            clearTimeout(preloaded.timer);
            if (!preloaded.error) {
                this.push();
                return preloaded.promise;
            }
        }
        return this.preloader();
    }
}
