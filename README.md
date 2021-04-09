# unifi-protect-video-downloader

![https://github.com/bostaunieux/unifi-protect-video-downloader/actions/workflows/node-ci.yml](https://github.com/bostaunieux/unifi-protect-video-downloader/actions/workflows/node-ci.yml/badge.svg) [![codecov](https://codecov.io/gh/bostaunieux/unifi-protect-video-downloader/branch/master/graph/badge.svg?token=YFI0RGEV2S)](https://codecov.io/gh/bostaunieux/unifi-protect-video-downloader)

This will listen for motion events triggered from a UniFi NVR device running UnifiOS. This has been tested on a Cloud Key Gen2+, but should work on any other device running the same OS. When a motion event is triggered by a camera, it will download a video for the duration of the recording.

## Output

When a start motion event is detected, this service will wait for the corresponding end motion event. At that point, a video export will be requested from the NVR and written within the configured download directory.

Download files will written in separate directories following the format:

```
/CAMERA_NAME/YYYY/MM/DD/YYYY-MM-DD_HH.MM.SS_TIMESTAMP.mp4
```

e.g.

```
/Front Door/2021/01/15/2021-02-15_12.05.30_1610712330.mp4
```

## Running via command line

1. Configure required parameters for the service, either using env vars, or by defining a `.env` file containing properties in the format of: `FIELD=VALUE`.
2. Install dependencies
   ```
   npm install
   ```
3. Start the service
   ```
   npm run start
   ```

## Running via docker

1. Mount a `/downloads` directory where videos will be downloaded
2. Define all required fields via ENV vars

## Configuration

| Field               | Required | Description                                                                                               | Default            |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ------------------ |
| UNIFI_HOST          | Yes      | UniFi NVR running unifi protect (e.g. `192.168.1.10`)                                                     | N/A                |
| UNIFI_USER          | Yes      | Username for unifi protect server (see directions below)                                                  | N/A                |
| UNIFI_PASS          | Yes      | Password for unifi protect server (see directions below)                                                  | N/A                |
| MQTT_HOST           | No       | Mqtt broker host where availability topic will be posted (e.g. `mqtt://[username:password@]192.168.1.10`) | N/A                |
| MQTT_PREFIX         | No       | Mqtt topic prefix. Only used if `MQTT_HOST` is set                                                        | `unifi`            |
| CAMERAS             | No       | Comma-separated list of camera names to record (e.g. `Front Door, Garage`)                                | Record all cameras |
| DOWNLOAD_PATH       | No       | Root file path where downloads will be placed                                                             | `/downloads`       |
| PREFER_SMART_MOTION | No       | For cameras supporting smart detection, record smart motion events instead of basic optical motion events | true               |

## User account creation

1. Login to protect web ui and navigate to users section
2. Click `Invite User`
   1. For Invite Type select `Local Access Only`
   2. For Roles, select `View Only`
3. Enter a username and password to use in docker setup

## Acknowledgements

Real-time events integration heavily aided by API documentation from https://github.com/hjdhjd/homebridge-unifi-protect
