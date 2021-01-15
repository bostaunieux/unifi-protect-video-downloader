import { CameraTimestamps, DownloadQueue, MotionEvent } from "./types";

require("log-timestamp");

import mqtt, { Client } from "mqtt";
// const mqtt = require("mqtt");
const Api = require("./api");

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

const api = new Api({
  host: UNIFI_HOST,
  username: UNIFI_USER,
  password: UNIFI_PASS,
  downloadPath: "/downloads",
});

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
      return processMotionEvent(motionEvent);
    }

    console.warn("No handler for topic: %s", topic);
  });
};

const processMotionEvent = async ({
  status,
  camera_id,
  timestamp,
}: MotionEvent) => {
  console.info(
    `Processing motion event with status: ${status}, cameraMac: ${camera_id}, timestamp: ${timestamp}`
  );

  if (status === "ON") {
    console.info("Processing motion start event");

    if (cameraDownloadQueue[camera_id]) {
      console.info("Found previous motion event; reseting timer");
      clearTimeout(cameraDownloadQueue[camera_id]);
    } else {
      cameraStartTimeByMac[camera_id] = Number(timestamp);
    }
  } else if (status === "OFF") {
    console.info("Processing motion end event");

    const startTimestamp = cameraStartTimeByMac[camera_id];

    if (!startTimestamp) {
      console.info(
        "No start timestamp found, aborting (this may happen when restarting the service after a motion end event was previously published)"
      );
      return;
    }

    if (cameraDownloadQueue[camera_id]) {
      console.info("Found previous motion event; reseting timer");
      clearTimeout(cameraDownloadQueue[camera_id]);
    }

    // wait to see if new movement is started
    cameraDownloadQueue[camera_id] = setTimeout(() => {
      console.info("Motion end event finished; processing video download");
      delete cameraStartTimeByMac[camera_id];
      delete cameraDownloadQueue[camera_id];

      api.processDownload(
        camera_id,
        startTimestamp - 5000,
        Number(timestamp) + 5000
      );
    }, 5000);
  }
};

initialize();
