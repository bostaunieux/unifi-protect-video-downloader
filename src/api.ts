import { Dispatcher } from "undici";
import { logger } from "./logger";
import path from "path";
import fs from "fs";
import promises from "fs/promises";
import EventStream from "./event_stream";
import { CameraDetails, MotionEndEvent, Timestamp } from "./types";
import { HttpClient } from "./http_client";

interface ApiProps {
  /** Unifi NVR hostname */
  host: string;
  /** Unifi NVR account username */
  username: string;
  /** Unifi NVR account password */
  password: string;
  /** Absolute path acting as the base path for video downloads */
  downloadPath: string;
  /** Optional dispatcher for testing (e.g. undici MockAgent) */
  dispatcher?: Dispatcher;
}

interface NvrData {
  /** mac address */
  mac: string;
  /** ip address */
  host: string;
  /** NVR name, e.g. Home */
  name: string;
  /** NVR OS version */
  version: string;
  /** NVR firmware version */
  firmwareVersion: string;
  /** Seconds? of uptime for the NVR server */
  uptime: number;
  lastSeen: number;
  // hardware type
  type: string;
}

interface BootstrapResponse {
  /** Cameras configured with the NVR */
  cameras: Array<CameraDetails>;
  /** Event stream last received event id */
  lastUpdateId: string;
  /** NVR details */
  nvr: NvrData;
}

interface FileAttributes {
  fileName: string;
  filePath: string;
}

// interval before we attempt to re-authenticate any requests, in seconds
const REAUTHENTICATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Api for interacting with the Unifi Protect NVR. Allows for camera discovery and requesting
 * video downloads for specific cameras.
 */
export default class Api {
  private host: string;
  private username: string;
  private password: string;
  private downloadPath: string;
  private httpClient: HttpClient;
  private headers?: Record<string, string>;
  private loginExpiry: Timestamp = 0;
  private bootstrap?: BootstrapResponse;
  private stream?: EventStream;

  constructor({ host, username, password, downloadPath, dispatcher }: ApiProps) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.downloadPath = downloadPath;

    this.httpClient = new HttpClient({
      baseUrl: `https://${this.host}`,
      dispatcher,
    });
  }

  /**
   * Setup the api connection for future requests and connect to the nvr websocket server
   */
  public async initialize(): Promise<void> {
    logger.info("Initializing unifi controller connection...");
    const { cameras } = await this.getBootstrap();
    logger.info(
      "Found cameras: %s",
      cameras.map((c) => `${c.id} : ${c.name}`),
    );

    await this.connect();
  }

  /**
   * Disconnect from the websocket event stream
   */
  public terminate(): void {
    this.stream?.disconnect();
  }

  /**
   * Get all available cameras configured in the NVR
   */
  public getCameras(): Array<CameraDetails> {
    return this.bootstrap?.cameras ?? [];
  }

  /**
   * Add an event handler for websocket message events
   * @param eventHandler Callback for processing websocket messages
   */
  public addSubscriber(eventHandler: (_event: Buffer) => void): void {
    this.stream?.addSubscriber(eventHandler);
  }

  /**
   * Remove all event handler subscriptions
   */
  public clearSubscribers(): void {
    this.stream?.clearSubscribers();
  }

  /**
   * Request a video download for the specified camera between the start and end timestamps
   */
  public async downloadVideo({ camera: id, start, end }: MotionEndEvent): Promise<boolean> {
    if (!(await this.authenticate())) {
      throw new Error("Unable to download video; failed fetching auth headers");
    }

    const camera = this.bootstrap?.cameras.find((cam) => cam.id === id);
    if (!camera) {
      logger.error("Encountered unknown camera id: %s, unable to download video", id);
      return false;
    }
    const { filePath, fileName } = this.generateFileAttributes(camera.name, start);
    logger.info(
      "Downloading video with length: %s seconds, to file path: %s",
      Math.round((end - start) / 1000),
      filePath,
    );

    try {
      await promises.access(filePath);
    } catch (_error) {
      // directory doesn't exist, create it
      await promises.mkdir(filePath, { recursive: true });
    }

    const writeStream = fs.createWriteStream(`${filePath}/${fileName}`);
    const result: Promise<true> = new Promise((resolve, reject) => {
      writeStream.on("finish", () => resolve(true));
      writeStream.on("error", reject);
    });

    const downloadStream = await this.httpClient.getStream(
      "/proxy/protect/api/video/export",
      {
        start,
        end,
        camera: camera.id,
        filename: fileName,
        channel: 0,
      },
      this.headers,
    );

    downloadStream.pipe(writeStream);

    return result;
  }

  private async connect(): Promise<void | Error> {
    if (!(await this.authenticate())) {
      throw new Error("Unable to subscribe to events; failed fetching auth headers");
    }

    if (!this.bootstrap?.lastUpdateId) {
      throw new Error("Unable to setup eventstream; missing required bootstrap lastUpdateId");
    }

    if (!this.headers?.["Cookie"]) {
      throw new Error("Unable to setup eventstream; missing required auth cookie");
    }

    this.stream = new EventStream({
      host: this.host,
      lastUpdateId: this.bootstrap?.lastUpdateId,
      headers: {
        Cookie: this.headers?.["Cookie"],
      },
    });

    this.stream.connect();
  }

  private async authenticate(): Promise<boolean> {
    const now = Date.now();

    // do we need to reauthenticate?
    if (now < this.loginExpiry && this.headers) {
      logger.info("Using cached authentication");
      return true;
    }

    logger.info("Requesting new unifi controller authentication...");

    // make an initial request to the unifi os entry page to "borrow" the csrf token it generates
    const homepageResponse = await this.httpClient.getOptional("/");
    if (!homepageResponse) {
      logger.warn("Homepage request failed, skipping");
    }

    const csrfToken = homepageResponse?.headers.get("x-csrf-token") ?? "";

    let authResponse;
    try {
      authResponse = await this.httpClient.post(
        "/api/auth/login",
        {
          username: this.username,
          password: this.password,
          rememberMe: true,
          token: "",
        },
        { "X-CSRF-Token": csrfToken },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "UNKNOWN CAUSE";
      logger.error("Login request failed: %s", message);
      return false;
    }

    const authCsrfToken = authResponse.headers.get("x-csrf-token");
    const cookies = authResponse.headers.getSetCookie?.() ?? [];
    const cookie = cookies[0] ?? authResponse.headers.get("set-cookie") ?? "";

    if (!authCsrfToken || !cookie) {
      logger.log("Unable to fetch auth details");
      return false;
    }

    logger.info("Unifi controller authentication completed");

    this.headers = {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": authCsrfToken,
    };

    this.loginExpiry = now + REAUTHENTICATION_INTERVAL_MS;

    return true;
  }

  private async getBootstrap(): Promise<BootstrapResponse> {
    if (!(await this.authenticate())) {
      throw new Error("Unable to get bootstrap details; failed fetching auth headers");
    }

    const response = await this.httpClient.get("/proxy/protect/api/bootstrap", this.headers);

    const data = (await response.json()) as BootstrapResponse;
    this.bootstrap = data;

    return data;
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
