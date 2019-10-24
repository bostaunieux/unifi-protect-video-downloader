require("log-timestamp");

const mqtt = require('mqtt');
const Api = require('./api');

const cameraStates = {};

const client = mqtt.connect(process.env.MQTT_HOST, {
  username: process.env.MQTT_USER, 
  password: process.env.MQTT_PASS,
  will: {
    topic: 'unifi/protect-downloader/availability',
    payload: 'offline',
    qos: 1,
    retain: true
  }
});

const api = new Api({
  host: process.env.UNIFI_HOST,
  username: process.env.UNIFI_USER,
  password: process.env.UNIFI_PASS,
  downloadPath: '/downloads'
});

client.on('error', (error) => {
  console.error('[controller] ' + error);
});

client.on('connect', () => {
  console.info('[controller] Connected to home automation mqtt broker');

  client.publish('unifi/protect-downloader/availability', 'online', {qos: 1, retain: true});
  
  client.subscribe('unifi/camera/motion/#');
});

client.on('message', (topic, message) => {

  if (topic.startsWith('unifi/camera/motion/')) {
    const {status, camera_id: cameraId, timestamp} = JSON.parse(message.toString());
    return processMotionEvent({status, cameraId, timestamp})
  }

  console.warn('[controller] No handler for topic: %s', topic);
});

const processMotionEvent = async ({status, cameraId, timestamp}) => {
  console.info(`[controller] Processing motion event with status: ${status}, cameraId: ${cameraId}, timestamp: ${timestamp}`);

  if (status === 'ON') {
    console.info('[controller] Processing motion start event');
    cameraStates[cameraId] = timestamp;
  } else if (status === 'OFF') {
    console.info('[controller] Processing motion end event');
    
    const previousTimestamp = cameraStates[cameraId];
    delete cameraStates[cameraId];
    
    if (!previousTimestamp) {
      return;
    }

    console.info('[controller] Found motion start event, processing video download');

    // ensure enough time has elapsed to read past the end of motion
    setTimeout(() => {
      api.processDownload({cameraMac: cameraId, start: previousTimestamp - 5000, end: timestamp + 5000})
    }, 5000);
  }
};