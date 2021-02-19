import WebSocket, { OPEN } from "ws";

interface EventStreamProps {
  host: string;
  headers: Record<string, string>;
  lastUpdateId: string;
}

// ws heartbeat timeout before considering the connection severed, in seconds
const EVENTS_HEARTBEAT_INTERVAL_MS = 20 * 1000;
const EVENTS_RECONNECT_INTERNAL_MS = 5 * 1000;

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

  public connect(): void {
    if (this.socket?.readyState === OPEN) {
      return;
    }

    this.socket?.terminate();

    const webSocketUrl = `wss://${this.host}/proxy/protect/ws/updates?lastUpdateId=${this.lastUpdateId}`;

    console.debug("Connecting to ws server url: %s", webSocketUrl);

    this.socket = new WebSocket(webSocketUrl, {
      headers: this.headers,
      rejectUnauthorized: false,
    });

    this.socket.on("open", () => {
      console.info("Connected to UnifiOS websocket server for event updates");
      this.connected = true;
      this.heartbeat();
    });
    this.socket.on("ping", this.heartbeat);
    this.socket.on("message", (event: Buffer) => {
      this.heartbeat();
      this.subscribers.forEach((subscriber) => subscriber(event));
    });

    this.socket.on("close", () => {
      console.info("WebSocket connection closed");
      this.pingTimeout && clearTimeout(this.pingTimeout);
      this.socket = undefined;
      this.connected = false;

      this.reconnect();
    });

    this.socket.on("error", (error) => {
      console.error("Websocket connection error: %s", error);

      this.socket?.terminate();
    });
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

  public disconnect() {
    this.socket?.terminate();
  }

  private async reconnect() {
    while (!this.connected) {
      // wait before attempting to conect
      await new Promise((resolve) => setTimeout(resolve, EVENTS_RECONNECT_INTERNAL_MS));
      this.connect();
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
}
