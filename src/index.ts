import "log-timestamp";

import mqtt, { Client } from "mqtt";
import Api from "./api";
import EventProcessor from "./event_processor";
import { CameraDetails, CameraId, isMotionEndEvent } from "./types";
import VideoDownloader from "./video_downloader";

const { CAMERAS, DOWNLOAD_PATH, PREFER_SMART_MOTION, MQTT_HOST, UNIFI_HOST, UNIFI_USER, UNIFI_PASS } = process.env;

const cameraNames = CAMERAS?.split(",").map((camera) => camera.trim()) ?? [];
const enableSmartMotion = PREFER_SMART_MOTION === undefined || PREFER_SMART_MOTION === "true";

if (!UNIFI_HOST || !UNIFI_USER || !UNIFI_PASS) {
  console.error("Unable to initialize; missing required configuration");
  process.exit(1);
}

const initialize = async () => {
  const client: Client = mqtt.connect(MQTT_HOST, {
    will: {
      topic: "unifi/protect-downloader/availability",
      payload: "offline",
      qos: 1,
      retain: true,
    },
  });

  const api = new Api({
    host: UNIFI_HOST,
    username: UNIFI_USER,
    password: UNIFI_PASS,
    downloadPath: DOWNLOAD_PATH ?? "/downloads",
  });

  const eventProcessor = new EventProcessor();

  const downloader = new VideoDownloader(api);

  try {
    await api.initialize();
  } catch (error) {
    console.error("Failed initializing API: %s", error);
    process.exit(1);
  }

  const allCameras = api.getCameras();
  const targetCameras = cameraNames.length
    ? allCameras.filter((camera) => cameraNames.includes(camera.name))
    : allCameras;
  const camerasById = new Map<CameraId, CameraDetails>(targetCameras.map((camera) => [camera.id, camera]));

  if (camerasById.size === 0) {
    console.error("Unable to find references to target cameras: %s, exiting", CAMERAS);
    process.exit(1);
  }

  console.info(
    "Setting up motion event subscription for cameras: %s",
    targetCameras.map((cam) => cam.name)
  );

  api.addSubscriber((message) => {
    const event = eventProcessor.parseMessage(message);
    const camera = event?.camera && camerasById.get(event.camera);

    if (!event || !camera) {
      return;
    }

    if (isMotionEndEvent(event)) {
      const hasSmartDetect = camera.featureFlags.hasSmartDetect;
      const isSmartEvent = event.type === "smart";

      if (
        !hasSmartDetect ||
        (hasSmartDetect && ((enableSmartMotion && isSmartEvent) || (!enableSmartMotion && !isSmartEvent)))
      ) {
        console.info("Processing event: %s", event);
        downloader.queueDownload(event);
      }
    }

    client.publish(
      `unifi/protect-downloader/${camera.id}/motion`,
      JSON.stringify({ ...event, camera: { id: camera.id, name: camera.name } }),
      {
        qos: 1,
        retain: true,
      }
    );
  });

  client.on("error", (error) => {
    console.error(`MQTT error: ${error.message}`);
  });

  client.on("connect", () => {
    console.info("Connected to MQTT broker");

    client.publish("unifi/protect-downloader/availability", "online", {
      qos: 1,
      retain: true,
    });
  });
};

initialize();
