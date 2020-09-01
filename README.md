# unifi-protect-video-downloader

This will listen for motion events triggered from the unifi protect mqtt motion event service and trigger a download of the video. Note this relies on a separate process for publishing start and end events to the mqtt broker for each camera.

## Docker setup

1. Mount a `/downloads` directory where videos will be downloaded. They will have the format`/{cameraName}/YYYY/MM/DD/YY-MM-DD_HH.MM_${timestamp}.mp4`
2. Define the following ENV vars
   * `MQTT_HOST` - mqtt broker host, e.g. "mqtt://192.168.1.1",
   * `MQTT_USER` - username for connecting to mqtt broker
   * `MQTT_PASS` - password for connecting to mqtt broker
   * `UNIFI_HOST` - unifi protect host, e.g. "https://192.168.1.1:7443"
   * `UNIFI_USER` - username for unifi protect server (see directions below)
   * `UNIFI_PASS` - password for unifi protect server (see directions below)
   * `CAMERAS` - Optional, comma-separated list of camera names to record , e.g. 'Front Door, Driveway' (all will be recorded if not specified)

## User account creation

1. Login to protect web ui and navigate to users section
2. Click `Invite User`
   1. For Invite Type select `Local Access Only`
   2. For Roles, select `View Only`
3. Enter a username and password to use in docker setup
