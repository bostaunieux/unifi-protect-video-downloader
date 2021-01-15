import { MotionEvent } from "./types";
import Api from "./api";

interface EventProcessorOptions {
  recordingPadding?: number;
}
/**
 * Number of milliseconds to add to the beginning and end of motion
 */
const DEFAULT_RECORDING_PADDING: number = 5000;

export default class EventProcessor {
  eventTimestamps: Map<string, number>;
  pendingDownloads: Map<string, NodeJS.Timeout>;
  api: Api;
  recordingPadding: number;

  constructor(
    api: Api,
    { recordingPadding = DEFAULT_RECORDING_PADDING }: EventProcessorOptions = {
      recordingPadding: DEFAULT_RECORDING_PADDING,
    }
  ) {
    this.api = api;
    this.recordingPadding = recordingPadding;
    this.eventTimestamps = new Map();
    this.pendingDownloads = new Map();
  }

  public async processEvent({
    status,
    camera_id: cameraId,
    timestamp,
  }: MotionEvent): Promise<void> {
    console.info(
      `Processing motion event with status: ${status}, cameraMac: ${cameraId}, timestamp: ${timestamp}`
    );

    const eventTimestamp = Number(timestamp);

    switch (status) {
      case "ON":
        console.info("Processing motion start event");
        const timeout = this.pendingDownloads.get(cameraId);
        if (timeout) {
          console.info("Found previous motion event; resetting timer");
          clearTimeout(timeout);
        } else {
          // when receiving a start motion event, just record the event time for the camera;
          // it will be processed when the corresponding end motion event is received
          this.eventTimestamps.set(cameraId, eventTimestamp);
        }

        break;

      case "OFF":
        console.info("Processing motion end event");

        const startTimestamp = this.eventTimestamps.get(cameraId);

        if (!startTimestamp) {
          console.info(
            "No start timestamp found, aborting (this may happen when restarting the service after a motion end event was previously published)"
          );
          return;
        }

        const pendingDownload = this.pendingDownloads.get(cameraId);
        if (pendingDownload) {
          console.info("Found previous motion event; resetting timer");
          clearTimeout(pendingDownload);
        }

        // wait to see if new movement is started
        this.pendingDownloads.set(
          cameraId,
          setTimeout(() => {
            console.info(
              "Motion end event finished; processing video download"
            );
            this.eventTimestamps.delete(cameraId);
            this.pendingDownloads.delete(cameraId);

            this.api.processDownload(
              cameraId,
              startTimestamp - this.recordingPadding,
              eventTimestamp + this.recordingPadding
            );
          }, 5000)
        );
        break;

      default:
        console.warn(
          `Not processing event with unrecognized status: '${status}'`
        );
    }
  }
}
