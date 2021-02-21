import { SequentialTaskQueue } from "sequential-task-queue";
import { DownloadError, MotionEndEvent } from "./types";
import Api from "./api";

export default class VideoDownloader {
  api: Api;
  queue = new SequentialTaskQueue();
  maxRetries = 5;
  retryIntervalMs = 60 * 1000;

  constructor(api: Api) {
    this.api = api;

    this.queue.on("error", this.onError);
  }

  onError(error: DownloadError) {
    if (!(error instanceof DownloadError)) {
      return;
    }
    const { event, retries } = error;

    console.info("Encountered queue error: %s", error);
    setTimeout(() => {
      this.queueDownload(event, retries - 1);
    }, this.retryIntervalMs);
  }

  async processEvent(event: MotionEndEvent, retries: number) {
    try {
      await this.api.downloadVideo(event);
    } catch (error) {
      console.warn("Download attempt failed for event: %s, retries: %s", event, retries);
      if (error?.response) {
        console.warn("Error details - status: %s, data: %s", error.response.status, error.response.data);
      }
      throw new DownloadError(event, retries);
    }
  }

  public async queueDownload(event: MotionEndEvent, retries = this.maxRetries) {
    if (retries <= 0) {
      console.info("Retries exhausted, not queuing download for event: %s", event);
      return;
    }

    console.info("Queueing motion event: %s, retries: %s", event, retries);

    await this.queue.push(this.processEvent, { args: [event, retries] });
  }
}
