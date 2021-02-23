import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import https from "https";
import path from "path";
import fs from "fs";
import promises from "fs/promises";
import EventStream from "./event_stream";
import { CameraDetails, MotionEndEvent, Timestamp } from "./types";

interface ApiProps {
  /** Unifi NVR hostname */
  host: string;
  /** Unifi NVR account username */
  username: string;
  /** Unifi NVR account password */
  password: string;
  /** Absolute path acting as the base path for video downloads */
  downloadPath: string;
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
  private request: AxiosInstance;
  private headers?: Record<string, string>;
  private loginExpiry: Timestamp = 0;
  private bootstrap?: BootstrapResponse;
  private stream?: EventStream;

  constructor({ host, username, password, downloadPath }: ApiProps) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.downloadPath = downloadPath;

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
  public addSubscriber(eventHandler: (event: Buffer) => void): void {
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
      console.error("Encountered unknown camera id: %s, unable to download video", id);
      return false;
    }
    const { filePath, fileName } = this.generateFileAttributes(camera.name, start);
    console.info(
      "Downloading video with length: %s seconds, to file path: %s",
      Math.round((end - start) / 1000),
      filePath
    );

    try {
      await promises.access(filePath);
    } catch (e) {
      // directory doesn't exist, create it
      await promises.mkdir(filePath, { recursive: true });
    }

    const writeStream = fs.createWriteStream(`${filePath}/${fileName}`);
    const result: Promise<true> = new Promise((resolve, reject) => {
      writeStream.on("finish", () => resolve(true));
      writeStream.on("error", reject);
    });

    const downloadStream = await this.request.get("/proxy/protect/api/video/export", {
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

    downloadStream.data.pipe(writeStream);

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
      console.info("Using cached authentication");
      return true;
    }

    console.info("Requesting new authentication...");

    // make an intial request to the unifi os entry page to "borrow" the csrf token it generates
    let htmlResponse;
    try {
      htmlResponse = await this.request.get(`/`);
    } catch (error) {
      console.error("Index request failed: %s", error.message);
      return false;
    }

    if (htmlResponse?.status !== 200 || !htmlResponse?.headers["x-csrf-token"]) {
      console.log("Unable to get initial CSFR token");
      return false;
    }

    let authResponse;

    try {
      authResponse = await this.request.post(
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
    } catch (error) {
      console.error("Login request failed: %s", error.message);
      return false;
    }

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

    this.loginExpiry = now + REAUTHENTICATION_INTERVAL_MS;

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
