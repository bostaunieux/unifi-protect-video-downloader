import axios from "axios";
import { SequentialQueue } from "./sequential_queue";
import { logger } from "./logger";
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
  queue = new SequentialQueue();

  constructor(api: Api) {
    this.api = api;
  }

  /**
   * Download a video for the provided motion event if any retries are remaining.
   *
   * @param event event details for the video to download
   * @param retries number of retries remaining; numbers <= 0 will result in a video not being downloaded
   */
  public queueDownload(event: MotionEndEvent, retries = MAX_RETRIES): void {
    if (retries <= 0) {
      logger.warn("Retries exhausted, not queuing download for event: %s", event);
      return;
    }

    logger.info("Queueing motion event: %s, retries: %s", event, retries);

    this.queue
      .add(() => this.processEvent(event, retries))
      .catch((err: unknown) => {
        if (err instanceof DownloadError) {
          logger.info("Encountered queue error: %s", err);
          setTimeout(() => this.queueDownload(err.event, err.retries - 1), RETRY_INTERNAL_MS);
        }
      });
  }

  private processEvent = async (event: MotionEndEvent, retries: number): Promise<void> => {
    try {
      await this.api.downloadVideo(event);
    } catch (error: unknown) {
      const response = axios.isAxiosError(error) ? error.response : null;

      logger.warn("Download attempt failed for event: %s, retries: %s", event, retries);
      if (response) {
        logger.warn("Error details - status: %s, data: %s", response.status, response.data);
      } else {
        logger.warn("Error details - %s", error);
      }
      throw new DownloadError(event, retries);
    }
  };
}
