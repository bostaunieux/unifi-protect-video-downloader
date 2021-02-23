export type MotionType = "smart" | "basic";

export interface MotionStartEvent {
  /** camera id */
  camera: CameraId;
  /** event start timestamp */
  start: Timestamp;
  /** is this smart or basic motion event */
  type?: MotionType;
}

export interface MotionEndEvent extends MotionStartEvent {
  /** event end timestamp */
  end: Timestamp;
}

interface FeatureFlags {
  /** does this camera support smart motion events */
  hasSmartDetect: boolean;
}

export interface CameraDetails {
  /** unique id */
  id: CameraId;
  /** display friendly camera name, e.g. Front Door */
  name: string;
  /** camera mac address */
  mac: string;
  /** camera ip address */
  host: string;
  /** camera type, e.g. UVC G3 Instant  */
  type: string;
  /** camera feature flags */
  featureFlags: FeatureFlags;
}

/**
 * Predicate for checking if the provided event a complete motion end event
 * @param event
 */
export const isMotionEndEvent = (event: MotionStartEvent | MotionEndEvent): event is MotionEndEvent =>
  (event as MotionEndEvent)?.end !== undefined;

export type CameraId = string;
export type EventId = string;
export type Timestamp = number;

/**
 * Error class encapsulating details of when a download attempt fails
 */
export class DownloadError extends Error {
  event: MotionEndEvent;
  retries: number;

  constructor(event: MotionEndEvent, retries: number) {
    super("Failed downloading motion event");
    this.name = "DownloadError";
    this.event = event;
    this.retries = retries;
  }
}
