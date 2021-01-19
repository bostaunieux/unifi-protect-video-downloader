import { MotionEndEvent } from "./types";
import Api from "./api";

interface QueuedDownload {
  retries: number;
  event: MotionEndEvent;
}

const DOWNLOAD_INTERVAL_SEC = 60;

export default class VideoDownloader {
  queuedDownloads: Array<QueuedDownload>;
  api: Api;
  timer: NodeJS.Timeout;

  constructor(api: Api) {
    this.api = api;
    this.queuedDownloads = [];
    this.timer = setInterval(() => this.processEvent(), DOWNLOAD_INTERVAL_SEC * 1000);
  }

  private async processEvent() {
    const { event, retries } = this.queuedDownloads.pop() ?? {};
    if (event && retries) {
      try {
        await this.api.downloadVideo(event);
      } catch (error) {
        console.warn("Download attempt failed for event: %s, retries: %s", event, retries);
        if (error?.response) {
          console.warn("Error details - status: %s, data: %s", error.response.status, error.response.data);
        }

        if (retries > 0) {
          this.queueDownload(event, retries - 1);
        }
      }
    }
  }

  public async queueDownload(event: MotionEndEvent, retries = 5): Promise<void> {
    console.info("Queueing motion event: %s", event);
    this.queuedDownloads.unshift({ event, retries });
  }
}
