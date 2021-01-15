import { DownloadQueue } from "./types";

// const axios = require("axios");
import axios, { AxiosResponse } from "axios";
const https = require("https");
const path = require("path");
const fs = require("fs");

const padDatePart = (num: number) => String(num).padStart(2, "0");

interface ApiConfig {
  host: string;
  username: string;
  password: string;
  downloadPath: string;
}

interface DownloadParams {
  camera: BasicCameraInfo;
  // start timestamp for the video download
  start: number;
  // end timestamp for the video download
  end: number;
}

interface BasicCameraInfo {
  // unique id
  id: string;
  // display friently camera name, e.g. Front Door
  name: string;
}

interface RequestHeaders {
  [key: string]: string;
}

interface CameraResponse extends BasicCameraInfo {
  // camera mac address
  mac: string;
  // camera ip address
  host: string;
  // camera type, e.g. UVC G3 Instant
  type: string;
}

interface CamerasResponse {
  cameras: CameraResponse[];
}

interface FileAttributes {
  fileName: string;
  filePath: string;
}

export default class Api {
  private host: string;
  private username: string;
  private password: string;
  private downloadPath: string;
  private request;
  private headers: RequestHeaders;

  constructor({ host, username, password, downloadPath }: ApiConfig) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.downloadPath = downloadPath;
    this.request = axios.create({
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
    });
    this.headers = {
      "Content-Type": "application/json",
    };
  }

  public async processDownload(
    cameraId: string,
    start: number,
    end: number
  ): Promise<void> {
    if (!(await this.getToken())) {
      throw new Error("Failed fetching auth token");
    }

    const camera = await this.getCameraDetails(cameraId);

    while (start < end) {
      // break up videos longer than 10 minutes
      const calculatedEnd = Math.min(end, start + 10 * 60 * 1000);

      this.downloadVideo({ camera, start, end: calculatedEnd });

      start += 1 + 10 * 60 * 1000;
    }
  }

  private async getToken(): Promise<boolean> {
    // make an intial request to the unifi os entry page to "borrow" the csrf token
    // it generates
    const htmlResponse = await this.request.get(this.host);

    if (
      htmlResponse?.status !== 200 ||
      !htmlResponse?.headers["X-CSRF-Token"]
    ) {
      console.log("Unable to get initial CSFR token");
      return false;
    }

    const authResponse = await this.request.post(
      `${this.host}/api/auth/login`,
      {
        username: this.username,
        password: this.password,
      },
      {
        headers: {
          "X-CSRF-Token": htmlResponse.headers["X-CSRF-Token"],
        },
      }
    );

    const csrfToken = authResponse.headers["X-CSRF-Token"];
    const cookie = authResponse.headers["Set-Cookie"];

    if (!csrfToken || !cookie) {
      console.log("Unable to fetch auth details");
      return false;
    }

    this.headers["Cookie"] = cookie;
    this.headers["X-CSRF-Token"] = csrfToken;

    return true;
  }

  /**
   *
   */
  private async getCameraDetails(cameraId: string): Promise<BasicCameraInfo> {
    const response = await this.request.get<CamerasResponse>(
      `${this.host}/proxy/protect/api/cameras`,
      { headers: this.headers }
    );

    const camera = response.data.cameras.find(
      (camera) => camera.mac === cameraId
    );

    if (!camera) {
      throw new Error("Unable to find camera with mac: " + cameraId);
    }

    return { id: camera.id, name: camera.name };
  }

  private async downloadVideo({
    camera,
    start,
    end,
  }: DownloadParams): Promise<void> {
    const { filePath, fileName } = this.generateFileAttributes(
      camera.name,
      start
    );
    console.info(`[api] writing to file path: ${filePath}`);

    try {
      await fs.promises.access(filePath);
    } catch (e) {
      // directory doesn't exist, create it
      await fs.promises.mkdir(filePath, { recursive: true });
    }

    const requestConfig = {
      headers: this.headers,
      responseType: "stream",
      params: {
        start,
        end,
        camera: camera.id,
      },
    };

    let response;
    try {
      response = await this.request.get(
        `${this.host}/api/video/export`,
        requestConfig
      );
    } catch (e) {
      console.error("unable to download video", e);
      return;
    }

    const writer = fs.createWriteStream(`${filePath}/${fileName}`);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  private generateFileAttributes(
    cameraName: string,
    timestamp: number
  ): FileAttributes {
    const date = new Date(timestamp);
    const year = "" + date.getFullYear();
    const month = padDatePart(date.getMonth() + 1);
    const day = padDatePart(date.getDate());
    const hour = padDatePart(date.getHours());
    const minute = padDatePart(date.getMinutes());

    const filePath = path.resolve(
      this.downloadPath,
      cameraName,
      year,
      month,
      day
    );

    const fileName = `${filePath}/${year}-${month}-${day}_${hour}.${minute}_${timestamp}.mp4`;
    return { filePath, fileName };
  }
}
