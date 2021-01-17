import zlib from "zlib";
import { MotionEvent } from "./types";

interface EventAction {
  action: string;
  id: string;
  modelKey: string;
  newUpdateId: string;
}

interface UpdateEventPayload {
  isMotionDetected?: boolean;
  lastMotion?: number;
  lastRing?: number;

  end?: number;
  score?: number;
}

interface AddEventPayload {
  camera: string;
  id: string;
  modelKey: string;
  partition: null;
  score: number;
  smartDetectEvents: string[];
  smartDetectTypes: string[];
  start: number;
  type: string;
}

interface DecodedEvent {
  action: EventAction;
  payload: Record<string, string>;
}

interface QueuedSmartEvent {
  camera: string;
  start: number;
}

const PACKET_BYTE_SIZE = 8;
const PACKET_PAYLOAD_SIZE_OFFSET = 4;


export default class EventProcessor {
  // event id -> motion start details
  smartMotionEvents: Map<string, QueuedSmartEvent>;
  // camera id -> motion start timestamp
  motionEvents: Map<string, number>;

  constructor() {
    this.smartMotionEvents = new Map();
    this.motionEvents = new Map();
  }

  public parseMessage(message: Buffer): MotionEvent | null {
    const { action, payload } = this.decodeBuffer(message) ?? {};

    if (
      action?.modelKey == "camera" &&
      !payload?.stats &&
      !payload?.wifiConnectionState &&
      !(payload?.upSince && Object.keys(payload)?.length === 2)
    ) {
      console.debug("action: %s, payload: %s", action, payload);
    }

    if (!payload || !action) {
      console.debug("Skipping unrecognized message");
      return null;
    }

    // smart detect event will first send an 'add' event with an event id, camera id
    // and start timestamp. we'll queue this info until a later 'update' event comes
    // with the end timestamp
    if (action.modelKey === "event" && action.action === "add") {
      const { id, type, camera, smartDetectTypes, start } = (payload as unknown) as AddEventPayload;

      if (type === "smartDetectZone" && smartDetectTypes.length) {
        // process smart motion event
        console.info("Queuing start motion event for camera: %s, start: %d", camera, start);
        this.smartMotionEvents.set(id, { camera, start });

        // register a delayed handler to clear the event from the queue
        setTimeout(() => {
          this.smartMotionEvents.delete(id);
        }, 10 * 60 * 1000);

        return null;
      }
    }

    //check for smart motion end event
    if (action.modelKey === "event" && action.action === "update") {
      const { score, end } = (payload as unknown) as UpdateEventPayload;
      const { camera, start } = this.smartMotionEvents.get(action.id) ?? {};
      if (camera && start && end) {
        // process end motion event
        console.info("Processing end motion event for camera: %s score: %d", camera, score);
        return { camera, start, end };
      }
    }

    //check for basic motion start event
    if (action.modelKey === "camera" && action.action === "update") {
      const { lastMotion, isMotionDetected } = (payload as unknown) as UpdateEventPayload;

      if (lastMotion && isMotionDetected === true) {
        // process start motion event
        console.info("Processing start basic motion event for camera: %s", action.id);
        this.motionEvents.set(action.id, lastMotion);
      } else if (lastMotion && isMotionDetected === false) {
        const firstMotion = this.motionEvents.get(action.id);
        if (firstMotion) {
          this.motionEvents.delete(action.id);
          return { camera: action.id, start: firstMotion, end: lastMotion };
        }
      }
    }

    return null;
  }

  private decodeBuffer(buffer: Buffer): DecodedEvent | null {
    // determine the offset where the payload packet begins
    let dataOffset;

    try {
      dataOffset = buffer.readUInt32BE(PACKET_PAYLOAD_SIZE_OFFSET) + PACKET_BYTE_SIZE;
    } catch (error) {
      console.error("Error decoding message buffer: %s", error);
      return null;
    }

    // Decode the action and payload frames now that we know where everything is.
    const action = this.decodeActionPacket(buffer.slice(0, dataOffset));
    const payload = this.decodePayloadPacket(buffer.slice(dataOffset));

    if (!action || !payload) {
      return null;
    }

    return { action, payload };
  }

  private decodeActionPacket(packet: Buffer): EventAction | null {
    try {
      const data = zlib.inflateSync(packet.slice(PACKET_BYTE_SIZE)).toString();
      return JSON.parse(data) as EventAction;
    } catch (error) {
      console.error("Unable to decode action: %s", error);
      return null;
    }
  }

  private decodePayloadPacket(packet: Buffer): Record<string, string> | null {
    try {
      const data = zlib.inflateSync(packet.slice(PACKET_BYTE_SIZE)).toString();
      return JSON.parse(data) as Record<string, string>;
    } catch (error) {
      console.error("Unable to decode payload: %s", error);
      return null;
    }
  }
}