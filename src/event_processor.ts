import { ProtectApiUpdates } from "unifi-protect";
import { CameraId, EventId, MotionEndEvent, MotionStartEvent, Timestamp } from "./types";

// properties on an 'update' event payload vary based on the prior event
// they're referencing; therefore are properties are optional
interface UpdateEventPayload {
  isMotionDetected?: boolean;
  lastMotion?: number;
  lastRing?: number;

  end?: number;
  score?: number;
}

interface AddEventPayload {
  camera: CameraId;
  id: EventId;
  modelKey: string;
  score: number;
  smartDetectEvents: string[];
  smartDetectTypes: string[];
  start: Timestamp;
  type: string;
}

// timeout after which start motion events will be ignored
const START_MOTION_EVENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Utility class for parsing and formatting raw motion event message buffers from
 * the event stream.
 */
export default class EventProcessor {
  // event id -> motion start details
  private smartMotionEvents = new Map<EventId, MotionStartEvent>();
  // camera id -> motion start timestamp
  private motionEvents = new Map<CameraId, Timestamp>();

  /**
   * Parse the incoming message from the NVR into a consumable format. This will ignore
   * the majority of messages received and focus solely on the subset having to do
   * with motion events from cameras. When either a start motion event or start smart
   * motion event is received, it will be queued until the corresponding end event is
   * received. At this time, the full motion event will be returned.
   *
   * TODO: return a StartMotionEvent so clients can be notified immediately when motion
   * starts.
   *
   * @param message {Buffer} Message buffer for NVR activity event
   */
  public parseMessage(message: Buffer): MotionStartEvent | MotionEndEvent | null {
    const response = ProtectApiUpdates.decodeUpdatePacket(console, message);

    if (!response?.payload || !response?.action) {
      console.debug("Skipping unrecognized message");
      return null;
    }

    const { action, payload } = response;

    // smart detect event will first send an 'add' event with an event id, camera id
    // and start timestamp. we'll queue this info until a later 'update' event comes
    // with the end timestamp
    if (action.modelKey === "event" && action.action === "add") {
      const { id, type, camera, smartDetectTypes, start } = payload as unknown as AddEventPayload;

      if (type === "smartDetectZone" && smartDetectTypes.length) {
        const motionStartEvent: MotionStartEvent = { camera, start, type: "smart" };
        // process smart motion event
        console.info("Queuing start motion event for camera: %s, start: %d", camera, start);
        this.smartMotionEvents.set(id, motionStartEvent);

        // register a delayed handler to clear the event from the queue
        setTimeout(() => {
          this.smartMotionEvents.delete(id);
        }, START_MOTION_EVENT_TIMEOUT_MS);

        return motionStartEvent;
      }
    }

    // check for smart motion end event
    if (action.modelKey === "event" && action.action === "update") {
      const { score, end } = payload as unknown as UpdateEventPayload;
      const { camera, start, type } = this.smartMotionEvents.get(action.id) ?? {};
      if (camera && start && end && type) {
        // process end motion event
        console.info("Processing end motion event for camera: %s score: %d", camera, score);
        return { camera, start, end, type };
      }
    }

    //check for basic motion start event
    if (action.modelKey === "camera" && action.action === "update") {
      const { lastMotion, isMotionDetected } = payload as unknown as UpdateEventPayload;
      const camera = action.id;

      if (lastMotion && isMotionDetected === true) {
        // process start motion event
        console.info("Processing start basic motion event for camera: %s", camera);
        this.motionEvents.set(camera, lastMotion);
        return { camera, start: lastMotion, type: "basic" };
      } else if (lastMotion && isMotionDetected === false) {
        // process end motion event
        const firstMotion = this.motionEvents.get(camera);
        if (firstMotion) {
          this.motionEvents.delete(camera);
          return { camera, start: firstMotion, end: lastMotion, type: "basic" };
        }
      }
    }

    return null;
  }
}
