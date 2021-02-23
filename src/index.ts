import "log-timestamp";
import Api from "./api";
import Controller from "./controller";

const {
  CAMERAS,
  DOWNLOAD_PATH: downloadPath = "/downloads",
  PREFER_SMART_MOTION = "true",
  MQTT_HOST: mqttHost,
  UNIFI_HOST: host,
  UNIFI_USER: username,
  UNIFI_PASS: password,
} = process.env;

const cameraNames = CAMERAS?.split(",").map((camera) => camera.trim()) ?? [];
const enableSmartMotion = PREFER_SMART_MOTION === "true";

if (!host || !username || !password) {
  console.error("Unable to initialize; missing required configuration");
  process.exit(1);
}

const init = async () => {
  const api = new Api({
    host,
    username,
    password,
    downloadPath,
  });

  try {
    const controller = new Controller({ api, cameraNames, mqttHost, enableSmartMotion });
    await controller.initialize();
    controller.subscribe();
  } catch (error) {
    console.error("Failed initialization: %s", error);
    process.exit(1);
  }

  process.on("exit", function () {
    console.info("Cleaning up connections...");
    api.terminate();
  });

  // catch ctrl+c event and exit normally
  process.on("SIGINT", function () {
    process.exit(2);
  });
};

init();
