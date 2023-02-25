import type { AuthProvider } from '@twurple/auth';
import { 
    BasicPubSubClient, 
    SingleUserPubSubClient, 
    PubSubListener, 
    PubSubCustomMessage, 
    SingleUserPubSubClientOptions 
} from '@twurple/pubsub';


export class GuestPubSubClient {
    private _listeners: Map<string, PubSubListener[]>;
    private _pubSubClient: BasicPubSubClient;
    private _authProvider: AuthProvider; 
    private _connectionPromise: Promise<void> | undefined;

    constructor(options: SingleUserPubSubClientOptions) {
        this._listeners = new Map<string, PubSubListener[]>();
        const { authProvider, pubSubClient, logger } = options;
        this._authProvider = authProvider;
        this._pubSubClient = pubSubClient !== null && pubSubClient !== void 0 ? pubSubClient : new BasicPubSubClient({ logger });
        this._pubSubClient.onMessage(async(topicName, messageData) => {
            if (this._listeners.has(topicName)) {
                const message = new PubSubCustomMessage(messageData);
                const listners = this._listeners.get(topicName);
                if (listners) {
                    for (const listener of listners) {
                        listener.call(message);
                    }
                }
            }
        });
    }

    private connect() {
        if (!this._connectionPromise) {
            this._connectionPromise = this._pubSubClient.connect();
            this._connectionPromise.catch(() => this._connectionPromise = undefined);
        }
        return this._connectionPromise;
    }

    async onTopic(topicName: string, chennelId: string, callback: (message: PubSubCustomMessage) => void) {
        await this.connect();
        const topic = [topicName, chennelId].join('.');
        const listener = new PubSubListener(topic, chennelId, callback, this as unknown as SingleUserPubSubClient);
        if (this._listeners.has(topic)) {
            this._listeners.get(topic)?.push(listener);
        }
        else {
            this._listeners.set(topic, [listener]);
            await this._pubSubClient.listen(topic, this._authProvider);
        }
        return listener;
    }

    async removeListener(listener: PubSubListener) {
        if (this._listeners.has(listener.topic)) {
            const newListeners = this._listeners.get(listener.topic)?.filter(l => l !== listener);
            if (newListeners && !newListeners.length) {
                this._listeners.delete(listener.topic);
                await this._pubSubClient.unlisten(listener.topic);
                if (!this._pubSubClient.hasAnyTopics &&
                    (this._pubSubClient.isConnected || this._pubSubClient.isConnecting)) {
                    await this._pubSubClient.disconnect();
                }
            }
            else {
                newListeners && this._listeners.set(listener.topic, newListeners);
            }
        }
    }
}