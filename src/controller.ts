import mqtt, { Client } from "mqtt";
import Api from "./api";
import EventProcessor from "./event_processor";
import { CameraId, CameraDetails, isMotionEndEvent } from "./types";
import VideoDownloader from "./video_downloader";

interface ControllerProps {
  api: Api;
  cameraNames: Array<string>;
  mqttHost: string;
  enableSmartMotion: boolean;
}

const CONNECTION_RETRY_DELAY_SEC = 30;

export default class Controller {
  private api: Api;
  private cameraNames: Array<string>;
  private mqttHost: string;
  private enableSmartMotion: boolean;
  private eventProcessor: EventProcessor;
  private downloader: VideoDownloader;
  private client?: Client;
  private camerasById: Map<CameraId, CameraDetails>;

  constructor({ api, cameraNames, mqttHost, enableSmartMotion }: ControllerProps) {
    this.api = api;
    this.cameraNames = cameraNames;
    this.mqttHost = mqttHost;
    this.enableSmartMotion = enableSmartMotion;
    this.eventProcessor = new EventProcessor();
    this.downloader = new VideoDownloader(this.api);
    this.camerasById = new Map();
  }

  /**
   * Boostrap required connections with the mqtt broker and unifi nvr
   */
  public initialize = async (): Promise<void> => {
    this.client = this.getConnection();

    await this.api.initialize();

    const allCameras = this.api.getCameras();
    const targetCameras = this.cameraNames.length
      ? allCameras.filter((camera) => this.cameraNames.includes(camera.name))
      : allCameras;

    this.camerasById = new Map<CameraId, CameraDetails>(targetCameras.map((camera) => [camera.id, camera]));

    if (this.camerasById.size === 0) {
      throw new Error("Unable to find cameras");
    }

    console.info(
      "Setting up motion event subscription for cameras: %s",
      targetCameras.map((cam) => cam.name)
    );
  };

  /**
   * Subscribe to motion events
   */
  public subscribe = (): void => {
    this.api.addSubscriber((message) => {
      const event = this.eventProcessor.parseMessage(message);
      const camera = event?.camera && this.camerasById.get(event.camera);

      if (!event || !camera) {
        return;
      }

      if (isMotionEndEvent(event)) {
        const hasSmartDetect = camera.featureFlags.hasSmartDetect;
        const isSmartEvent = event.type === "smart";

        if (
          !hasSmartDetect ||
          (hasSmartDetect && ((this.enableSmartMotion && isSmartEvent) || (!this.enableSmartMotion && !isSmartEvent)))
        ) {
          console.info("Processing event: %s", event);
          this.downloader.queueDownload(event);
        }
      }

      this.client?.publish(
        `unifi/protect-downloader/${camera.id}/motion`,
        JSON.stringify({ ...event, camera: { id: camera.id, name: camera.name } }),
        {
          qos: 1,
          retain: true,
        }
      );
    });

    this.client?.on("error", async (error) => {
      console.error("Encountered MQTT error: %s; will reconnect after a delay", error);
    });

    this.client?.on("connect", () => {
      console.info("Connected to MQTT broker");

      this.client?.publish("unifi/protect-downloader/availability", "online", {
        qos: 1,
        retain: true,
      });
    });
  };

  private getConnection = (): Client => {
    return mqtt.connect(this.mqttHost, {
      will: {
        topic: "unifi/protect-downloader/availability",
        payload: "offline",
        qos: 1,
        retain: true,
      },
      reconnectPeriod: CONNECTION_RETRY_DELAY_SEC * 1000,
    });
  };
}
