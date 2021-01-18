export type MotionType = "smart" | "basic";

export interface MotionStartEvent {
  // camera id
  camera: CameraId;
  // event start timestamp
  start: Timestamp;
  type?: MotionType;
}

export interface MotionEndEvent extends MotionStartEvent {
  // event end timestamp
  end: Timestamp;
}

export interface CameraDetails {
  // unique id
  id: CameraId;
  // display friently camera name, e.g. Front Door
  name: string;
  // camera mac address
  mac: string;
  // camera ip address
  host: string;
  // camera type, e.g. UVC G3 Instant
  type: string;
}

export const isMotionEndEvent = (event: MotionStartEvent | MotionEndEvent): event is MotionEndEvent =>
  (event as MotionEndEvent)?.end !== undefined;

export type CameraId = string;
export type EventId = string;
export type Timestamp = number;
