import WebSocket, { CONNECTING, OPEN } from "ws";

interface EventStreamProps {
  host: string;
  headers: Record<string, string>;
  lastUpdateId: string;
}

// ws heartbeat timeout before considering the connection severed, in seconds
export const EVENTS_HEARTBEAT_INTERVAL_MS = 20 * 1000;
export const EVENTS_RECONNECT_INTERNAL_MS = 5 * 1000;

export default class EventStream {
  public connected = false;
  private host: string;
  private headers: Record<string, string>;
  private lastUpdateId: string;
  private subscribers = new Set<(event: Buffer) => void>();
  private socket?: WebSocket;
  private pingTimeout?: NodeJS.Timeout;

  constructor({ host, headers, lastUpdateId }: EventStreamProps) {
    this.host = host;
    this.headers = headers;
    this.lastUpdateId = lastUpdateId;
  }

  public connect(): boolean {
    if (this.socket?.readyState === OPEN || this.socket?.readyState === CONNECTING) {
      return true;
    }

    this.socket?.terminate();

    const webSocketUrl = `wss://${this.host}/proxy/protect/ws/updates?lastUpdateId=${this.lastUpdateId}`;

    console.debug("Connecting to ws server url: %s", webSocketUrl);

    this.socket = new WebSocket(webSocketUrl, {
      headers: this.headers,
      rejectUnauthorized: false,
    });

    this.socket.on("open", this.onOpen.bind(this));
    this.socket.on("ping", this.heartbeat.bind(this));
    this.socket.on("message", this.onMessage.bind(this));
    this.socket.on("close", this.onClose.bind(this));
    this.socket.on("error", this.onError.bind(this));

    return true;
  }

  /**
   * Add an event handler for websocket message events
   * @param eventHandler Callback for processing websocket messages
   */
  public addSubscriber(eventHandler: (event: Buffer) => void): void {
    console.info("Adding event subscriber");
    this.subscribers.add(eventHandler);
  }

  /**
   * Remove all event handler subscriptions
   */
  public clearSubscribers(): void {
    this.subscribers.clear();
  }

  public disconnect(): void {
    this.socket?.terminate();
  }

  private reconnect() {
    if (this.connected) {
      return;
    }

    if (!this.connect()) {
      setTimeout(() => {
        this.reconnect();
      }, EVENTS_RECONNECT_INTERNAL_MS);
    }
  }

  private heartbeat() {
    this.pingTimeout && clearTimeout(this.pingTimeout);

    // Use `WebSocket#terminate()`, which immediately destroys the connection,
    // instead of `WebSocket#close()`, which waits for the close timer.
    this.pingTimeout = setTimeout(() => {
      this.socket?.terminate();
    }, EVENTS_HEARTBEAT_INTERVAL_MS);
  }

  private onOpen() {
    console.info("Connected to UnifiOS websocket server for event updates");
    this.connected = true;
    this.heartbeat();
  }

  private onMessage(event: Buffer) {
    this.heartbeat();
    this.subscribers.forEach((subscriber) => subscriber(event));
  }

  private onClose() {
    console.info("WebSocket connection closed");
    this.pingTimeout && clearTimeout(this.pingTimeout);
    this.socket = undefined;
    this.connected = false;

    this.reconnect();
  }

  private onError(error: Error) {
    console.error("Websocket connection error: %s", error);

    this.socket?.terminate();
  }
}
