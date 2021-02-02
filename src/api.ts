import axios from "axios";
import axiosRetry from "axios-retry";
import https from "https";
import path from "path";
import fs from "fs";
import WebSocket from "ws";
import { CameraDetails, MotionEndEvent, Timestamp } from "./types";

interface ApiConfig {
  host: string;
  username: string;
  password: string;
  downloadPath: string;
}

interface NvrData {
  // mac address
  mac: string;
  // ip address
  host: string;
  // nvr name, e.g. Home
  name: string;
  version: string;
  firmwareVersion: string;
  uptime: number;
  lastSeen: number;
  // hardware type
  type: string;
}

interface BootstrapResponse {
  cameras: Array<CameraDetails>;
  lastUpdateId: string;
  nvr: NvrData;
}

interface FileAttributes {
  fileName: string;
  filePath: string;
}

// ws heartbeat timeout before considering the connection severed, in seconds
const EVENTS_HEARTBEAT_INTERVAL_SEC = 20;

// interval before we attempt to re-authenticate any requests, in seconds
const REAUTHENTICATION_INTERVAL_SEC = 3600;

export default class Api {
  private host: string;
  private username: string;
  private password: string;
  private downloadPath: string;
  private request;
  private headers: Record<string, string> | null;
  private loginExpiry: Timestamp;
  private bootstrap: BootstrapResponse | null;
  private socket: WebSocket | null;
  private subscribers: Set<(event: Buffer) => void>;

  constructor({ host, username, password, downloadPath }: ApiConfig) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.downloadPath = downloadPath;
    this.loginExpiry = 0;
    this.headers = null;
    this.bootstrap = null;
    this.socket = null;
    this.subscribers = new Set();

    this.request = axios.create({
      baseURL: `https://${this.host}`,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
    });
    axiosRetry(this.request, { retries: 5, retryDelay: axiosRetry.exponentialDelay });
  }

  /**
   * Setup the api connection for future requests and connect to the nvr websocket server
   */
  public async initialize(): Promise<void> {
    const { cameras } = await this.getBootstrap();
    console.info(
      "Found cameras: %s",
      cameras.map((c) => `${c.id} : ${c.name}`)
    );

    await this.connect();

    // periodically check to confirm we're still connected
    setInterval(async () => {
      await this.connect();
    }, 5000);
  }

  /**
   * Get all available cameras configured in the nvr
   */
  public getCameras(): Array<CameraDetails> {
    return this.bootstrap?.cameras ?? [];
  }

  /**
   * Add an event handler for websocket message events
   * @param eventHandler Callback for processing websocket messages
   */
  public addSubscriber(eventHandler: (event: Buffer) => void): void {
    this.subscribers.add(eventHandler);
  }

  /**
   * Remove all event handler subscriptions
   */
  public clearSubscribers(): void {
    this.subscribers.clear();
  }

  private async connect(): Promise<void | Error> {
    if (this.socket) {
      return;
    }

    if (!(await this.authenticate())) {
      throw new Error("Unable to subscribe to events; failed fetching auth headers");
    }
    const webSocketUrl = `wss://${this.host}/proxy/protect/ws/updates?lastUpdateId=${this.bootstrap?.lastUpdateId}`;

    console.debug("Connecting to ws server url: %s", webSocketUrl);

    this.socket = new WebSocket(webSocketUrl, {
      headers: {
        Cookie: this.headers?.["Cookie"],
      },
      rejectUnauthorized: false,
    });

    let pingTimeout: NodeJS.Timeout;

    const heartbeat = () => {
      clearTimeout(pingTimeout);

      // Use `WebSocket#terminate()`, which immediately destroys the connection,
      // instead of `WebSocket#close()`, which waits for the close timer.
      pingTimeout = setTimeout(() => {
        this.socket?.terminate();
      }, EVENTS_HEARTBEAT_INTERVAL_SEC * 1000);
    };

    this.socket.on("open", () => {
      console.info("Connected to UnifiOS websocket server for event updates");
      heartbeat();
    });
    this.socket.on("ping", heartbeat);
    this.socket.on("message", (event: Buffer) => {
      heartbeat();
      this.subscribers.forEach((subscriber) => subscriber(event));
    });

    this.socket.on("close", () => {
      console.info("WebSocket connection closed");
      clearTimeout(pingTimeout);
      this.socket = null;
    });

    this.socket.on("error", (error) => {
      console.error("WebSocket connection error: %s", error.message);
      console.error("Websocket connection error: %s", error);

      this.socket?.terminate();
    });
  }

  private async authenticate(): Promise<boolean> {
    const now = Date.now();

    // do we need to reauthenticate?
    if (now < this.loginExpiry && this.headers) {
      console.info("Using cached authentication");
      return true;
    }

    console.info("Requesting new authentication...");

    // make an intial request to the unifi os entry page to "borrow" the csrf token it generates
    const htmlResponse = await this.request.get(`/`);

    if (htmlResponse?.status !== 200 || !htmlResponse?.headers["x-csrf-token"]) {
      console.log("Unable to get initial CSFR token");
      return false;
    }

    const authResponse = await this.request.post(
      "/api/auth/login",
      {
        username: this.username,
        password: this.password,
      },
      {
        headers: {
          "X-CSRF-Token": htmlResponse.headers["x-csrf-token"],
        },
      }
    );

    const csrfToken = authResponse.headers["x-csrf-token"];
    const cookie = authResponse.headers["set-cookie"];

    if (!csrfToken || !cookie) {
      console.log("Unable to fetch auth details");
      return false;
    }

    this.headers = {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
    };

    this.loginExpiry = now + REAUTHENTICATION_INTERVAL_SEC * 1000;

    return true;
  }

  private async getBootstrap(): Promise<BootstrapResponse> {
    if (!(await this.authenticate())) {
      throw new Error("Unable to get bootstrap details; failed fetching auth headers");
    }

    const response = await this.request.get<BootstrapResponse>("/proxy/protect/api/bootstrap", {
      headers: this.headers,
    });

    if (response.status !== 200) {
      throw new Error("Failed to fetch bootstrap");
    }

    this.bootstrap = response.data;

    return response.data;
  }

  /**
   * Request a video download for the specified camera between the start and end timestamps
   */
  public async downloadVideo({ camera: id, start, end }: MotionEndEvent): Promise<void> {
    if (!(await this.authenticate())) {
      throw new Error("Unable to download video; failed fetching auth headers");
    }

    const camera = this.bootstrap?.cameras.find((cam) => cam.id === id);
    if (!camera) {
      console.error("Encountered unknown camera id: %s, unable to download video", id);
      return;
    }
    const { filePath, fileName } = this.generateFileAttributes(camera.name, start);
    console.info(
      "Downloading video with length: %s seconds, to file path: %s",
      Math.round((end - start) / 1000),
      filePath
    );

    try {
      await fs.promises.access(filePath);
    } catch (e) {
      // directory doesn't exist, create it
      await fs.promises.mkdir(filePath, { recursive: true });
    }

    const response = await this.request.get("/proxy/protect/api/video/export", {
      headers: this.headers,
      responseType: "stream",
      params: {
        start,
        end,
        camera: camera.id,
        filename: fileName,
        channel: 0,
      },
    });

    const writer = fs.createWriteStream(`${filePath}/${fileName}`);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  private generateFileAttributes(cameraName: string, timestamp: number): FileAttributes {
    const padDatePart = (num: number) => String(num).padStart(2, "0");

    const date = new Date(timestamp);
    const year = String(date.getFullYear());
    const month = padDatePart(date.getMonth() + 1);
    const day = padDatePart(date.getDate());
    const hour = padDatePart(date.getHours());
    const minute = padDatePart(date.getMinutes());
    const seconds = padDatePart(date.getSeconds());

    const filePath = path.resolve(this.downloadPath, cameraName, year, month, day);

    const fileName = `${year}-${month}-${day}_${hour}.${minute}.${seconds}_${timestamp}.mp4`;
    return { filePath, fileName };
  }
}
