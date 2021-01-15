import { CameraTimestamps, DownloadQueue, MotionEvent } from "./types";

import "log-timestamp";

import mqtt, { Client } from "mqtt";
import Api from "./api";
import EventProcessor from "./event_processor";

const cameraStartTimeByMac: CameraTimestamps = {};
const cameraDownloadQueue: DownloadQueue = {};

const {
  CAMERAS,
  MQTT_HOST,
  MQTT_USER,
  MQTT_PASS,
  UNIFI_HOST,
  UNIFI_USER,
  UNIFI_PASS,
} = process.env;

const client: Client = mqtt.connect(MQTT_HOST, {
  username: MQTT_USER,
  password: MQTT_PASS,
  will: {
    topic: "unifi/protect-downloader/availability",
    payload: "offline",
    qos: 1,
    retain: true,
  },
});

const cameraNames =
  (CAMERAS &&
    CAMERAS.split(",").map((camera) =>
      camera.trim().toLowerCase().replace(/\s/g, "_")
    )) ||
  [];

if (!UNIFI_HOST || !UNIFI_USER || !UNIFI_PASS) {
  console.error("Unable to initialize; missing required configuration");
  process.exit(1);
}

const api = new Api({
  host: UNIFI_HOST,
  username: UNIFI_USER,
  password: UNIFI_PASS,
  downloadPath: "/downloads",
});

const eventProcessor = new EventProcessor(api);

const initialize = () => {
  client.on("error", (error) => {
    console.error(`MQTT error: ${error.message}`);
  });

  client.on("connect", () => {
    console.info("Connected to home automation mqtt broker");

    client.publish("unifi/protect-downloader/availability", "online", {
      qos: 1,
      retain: true,
    });

    if (cameraNames.length > 0) {
      console.info(
        `Subcribing to motion events for cameras: ${cameraNames.join(", ")}`
      );
      cameraNames.map((cameraName) =>
        client.subscribe(`unifi/camera/motion/${cameraName}`)
      );
    } else {
      console.info("Subcribing to motion events for all cameras");
      client.subscribe("unifi/camera/motion/#");
    }
  });

  client.on("message", (topic: string, message: Buffer) => {
    if (topic.startsWith("unifi/camera/motion/")) {
      const motionEvent: MotionEvent = JSON.parse(message.toString());
      return eventProcessor.processEvent(motionEvent);
    }

    console.warn("No handler for topic: %s", topic);
  });
};

initialize();
