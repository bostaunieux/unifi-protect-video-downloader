import mqtt, { Client } from "mqtt";
import Api from "./api";
import EventProcessor from "./event_processor";
import { CameraId, CameraDetails, isMotionEndEvent, MotionEvent } from "./types";
import VideoDownloader from "./video_downloader";

interface ControllerProps {
  /** Unifi NVR api */
  api: Api;
  /** Optional camera names to process motion events */
  cameraNames: Array<string>;
  /** Optinal camera names to exclude from processing motion events */
  cameraNamesExclude: Array<string>;
  /** For cameras supporting smart motion events, should smart motion events trigger downloads  */
  enableSmartMotion: boolean;
  /** Optional MQTT host */
  mqttHost?: string;
  /** Topic prefix to use for mqtt messages */
  mqttPrefix: string;
}

const CONNECTION_RETRY_DELAY_SEC = 30;

/**
 * Main class for managing video downloads. Handles discovering available cameras and
 * activating the connection to the real-time motion event stream.
 */
export default class Controller {
  private api: Api;
  private cameraNames: Array<string>;
  private cameraNamesExclude: Array<string>;
  private enableSmartMotion: boolean;
  private eventProcessor: EventProcessor;
  private downloader: VideoDownloader;
  private camerasById: Map<CameraId, CameraDetails>;
  private client?: Client;
  private mqttHost?: string;
  private mqttPrefix: string;

  constructor({ api, cameraNames, cameraNamesExclude, mqttHost, mqttPrefix, enableSmartMotion }: ControllerProps) {
    this.api = api;
    this.cameraNames = cameraNames;
    this.cameraNamesExclude = cameraNamesExclude;
    this.mqttHost = mqttHost;
    this.mqttPrefix = mqttPrefix;
    this.enableSmartMotion = enableSmartMotion;
    this.eventProcessor = new EventProcessor();
    this.downloader = new VideoDownloader(this.api);
    this.camerasById = new Map();
  }

  /**
   * Boostrap required connections with the Unifi NVR and optional mqtt broker
   */
  public initialize = async (): Promise<void> => {
    this.client = this.getConnection();

    await this.api.initialize();

    const allCameras = this.api.getCameras();
    let filteredCameras;
    /** Include Filtering */
    if (this.cameraNames.length) {
      filteredCameras = allCameras.filter((camera) => this.cameraNames.includes(camera.name));
    /** Exclude filtering */
    } else if (this.cameraNamesExclude.length) {
      filteredCameras = allCameras.filter((camera) => !this.cameraNamesExclude.includes(camera.name));
      /** No filttering, include all cameras */
    } else {
      filteredCameras = allCameras;
    }

    const targetCameras = filteredCameras;
    this.camerasById = new Map<CameraId, CameraDetails>(targetCameras.map((camera) => [camera.id, camera]));

    if (this.camerasById.size === 0) {
      throw new Error("Unable to find cameras");
    }
  };

  /**
   * Subscribe to motion events. Additionally publish an availability topic if an mqtt broker
   * host is configured.
   */
  public subscribe = (): void => {
    console.info(
      "Subscribing to motion events for cameras: %s",
      Array.from(this.camerasById).map(([, { name }]) => name)
    );

    this.api.addSubscriber(this.onMessage);

    this.client?.on("error", async (error) => {
      console.error("Encountered MQTT error: %s; will reconnect after a delay", error);
    });
  };

  private getConnection = (): Client | undefined => {
    if (!this.mqttHost) {
      return;
    }

    console.info("Connecting to MQTT broker...");

    const client = mqtt.connect(this.mqttHost, {
      will: {
        topic: `${this.mqttPrefix}/protect-downloader/availability`,
        payload: "offline",
        qos: 1,
        retain: true,
      },
      reconnectPeriod: CONNECTION_RETRY_DELAY_SEC * 1000,
    });

    client.on("connect", () => {
      console.info("Connected to MQTT broker");

      client.publish(`${this.mqttPrefix}/protect-downloader/availability`, "online", {
        qos: 1,
        retain: true,
      });
    });

    return client;
  };

  private shouldProcessMotionEvent = (event: MotionEvent, camera: CameraDetails) => {
    const hasSmartDetect = camera.featureFlags.hasSmartDetect;
    const isSmartEvent = event.type === "smart";

    return (
      !hasSmartDetect ||
      (hasSmartDetect && ((this.enableSmartMotion && isSmartEvent) || (!this.enableSmartMotion && !isSmartEvent)))
    );
  };

  private onMessage = (message: Buffer) => {
    const event = this.eventProcessor.parseMessage(message);
    const camera = event?.camera && this.camerasById.get(event.camera);

    if (!event || !camera) {
      return;
    }

    if (isMotionEndEvent(event) && this.shouldProcessMotionEvent(event, camera)) {
      console.info("Processing motion event: %s", event);
      this.downloader.queueDownload(event);
    }

    this.client?.publish(
      `${this.mqttPrefix}/protect-downloader/${camera.id}/motion`,
      JSON.stringify({ ...event, camera: { id: camera.id, name: camera.name } }),
      {
        qos: 1,
        retain: true,
      }
    );
  };
}
