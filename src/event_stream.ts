import WebSocket from "ws";

interface EventStreamProps {
  /** NVR host */
  host: string;
  /** Request headers for connecting to NVR */
  headers: Record<string, string>;
  /** Event stream last received event id */
  lastUpdateId: string;
}

// ws heartbeat timeout before considering the connection severed
export const EVENTS_HEARTBEAT_INTERVAL_MS = 20 * 1000; // 20 seconds

// time to wait before attempting to reconnect to the websocket server
export const EVENTS_RECONNECT_INTERNAL_MS = 5 * 1000; // 5 seconds

/**
 * Class for managing a connection to the NVR's websocket server. This real-time event stream
 * is shared across all services running on the NVR, though we will only focus on events
 * coming from the Unifi Protect service.
 */
export default class EventStream {
  public connected = false;
  private shouldReconnect = false;
  private host: string;
  private headers: Record<string, string>;
  private lastUpdateId: string;
  private subscribers = new Set<(_event: Buffer) => void>();
  private socket?: WebSocket;
  private pingTimeout?: NodeJS.Timeout;

  constructor({ host, headers, lastUpdateId }: EventStreamProps) {
    this.host = host;
    this.headers = headers;
    this.lastUpdateId = lastUpdateId;
  }

  /**
   * Attempt to connect to the websocket server
   */
  public connect(): boolean {
    // guard against repeated calls to connect when already connected
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
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
   *
   * @param eventHandler Callback for processing websocket messages
   */
  public addSubscriber(eventHandler: (_event: Buffer) => void): void {
    console.info("Adding event subscriber");
    this.subscribers.add(eventHandler);
  }

  /**
   * Remove all event handler subscriptions
   */
  public clearSubscribers(): void {
    this.subscribers.clear();
  }

  /**
   * Disconnect from the websocket server and prevent any reconnect attempts
   */
  public disconnect(): void {
    this.shouldReconnect = false;
    this.socket?.terminate();
  }

  private reconnect() {
    if (this.connected || !this.shouldReconnect) {
      return;
    }

    if (!this.connect()) {
      setTimeout(() => {
        this.reconnect();
      }, EVENTS_RECONNECT_INTERNAL_MS);
    }
  }

  private heartbeat() {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
    }

    // Use `WebSocket#terminate()`, which immediately destroys the connection,
    // instead of `WebSocket#close()`, which waits for the close timer.
    this.pingTimeout = setTimeout(() => {
      this.socket?.terminate();
    }, EVENTS_HEARTBEAT_INTERVAL_MS);
  }

  private onOpen() {
    console.info("Connected to UnifiOS websocket server for event updates");
    this.connected = true;
    this.shouldReconnect = true;
    this.heartbeat();
  }

  private onMessage(event: Buffer) {
    this.heartbeat();
    this.subscribers.forEach((subscriber) => subscriber(event));
  }

  private onClose() {
    console.info("WebSocket connection closed");
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
    }
    this.socket = undefined;
    this.connected = false;

    this.reconnect();
  }

  private onError(error: Error) {
    console.error("Websocket connection error: %s", error);

    // terminate the connect; this will trigger a reconnect attempt
    this.socket?.terminate();
  }
}
