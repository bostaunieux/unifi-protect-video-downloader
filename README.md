# unifi-protect-video-downloader

This will listen for motion events triggered from the unifi protect mqtt motion event service and 

## Docker setup

1. Mount a `/downloads` directory where videos will be downloaded. They will have the format`/{cameraName}/YYYY/MM/DD/${timestamp}.mp4`
2. Define the following ENV vars
   * `MQTT_HOST` - mqtt broker host, e.g. "mqtt://192.168.1.1",
   * `MQTT_USER` - username for connecting to mqtt broker
   * `MQTT_PASS` - password for connecting to mqtt broker
   * `UNIFI_HOST` - unifi protect host, e.g. "https://192.168.1.1:7443"
   * `UNIFI_USER` - username for unifi protect server (see directions below)
   * `UNIFI_PASS` - password for unifi protect server (see directions below)

## User account creation

1. Login to protect web ui and navigate to users section
2. Click `Invite User`
   1. For Invite Type select `Local Access Only`
   2. For Roles, select `View Only`
3. Enter a username and password to use in docker setup
