import { SequentialTaskQueue } from "sequential-task-queue";
import { DownloadError, MotionEndEvent } from "./types";
import Api from "./api";

export const MAX_RETRIES = 5;
export const RETRY_INTERNAL_MS = 60 * 1000;

/**
 * Class to process video downloads. Downloads will be queued and processed sequentially
 * in the order received. Failed downloads will be re-queued after a delay.
 */
export default class VideoDownloader {
  api: Api;
  queue = new SequentialTaskQueue();

  constructor(api: Api) {
    this.api = api;

    this.queue.on("error", this.onError);
  }

  /**
   * Download a video for the provided motion event if any retries are remaining.
   *
   * @param event event details for the video to download
   * @param retries number of retries remaining; numbers <= 0 will result in a video not being downloaded
   */
  public async queueDownload(event: MotionEndEvent, retries = MAX_RETRIES): Promise<void> {
    if (retries <= 0) {
      console.warn("Retries exhausted, not queuing download for event: %s", event);
      return;
    }

    console.info("Queueing motion event: %s, retries: %s", event, retries);

    await this.queue.push(this.processEvent, { args: [event, retries] });
  }

  private processEvent = async (event: MotionEndEvent, retries: number): Promise<void> => {
    try {
      await this.api.downloadVideo(event);
    } catch (error) {
      console.warn("Download attempt failed for event: %s, retries: %s", event, retries);
      if (error?.response) {
        console.warn("Error details - status: %s, data: %s", error.response.status, error.response.data);
      }
      throw new DownloadError(event, retries);
    }
  };

  private onError = (error: DownloadError): void => {
    if (!(error instanceof DownloadError)) {
      return;
    }
    const { event, retries } = error;

    console.info("Encountered queue error: %s", error);
    setTimeout(() => {
      this.queueDownload(event, retries - 1);
    }, RETRY_INTERNAL_MS);
  };
}
