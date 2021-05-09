import mqtt, { Client, IStream } from "mqtt";
import Api from "../src/api";
import VideoDownloader from "../src/video_downloader";
import EventProcessor from "../src/event_processor";
import Controller from "../src/controller";
import { MotionEndEvent } from "../src/types";
import { stubApi, TEST_CAMERA_1, TEST_CAMERA_2 } from "./fixture_helper";

jest.mock("mqtt");
jest.mock("../src/api");
jest.mock("../src/event_processor");
jest.mock("../src/video_downloader");

const mqttMock = mqtt as jest.Mocked<typeof mqtt>;
const ClientMock = Client as jest.MockedClass<typeof Client>;
const ApiMock = Api as jest.MockedClass<typeof Api>;
const EventProcessorMock = EventProcessor as jest.MockedClass<typeof EventProcessor>;
const VideoDownloaderMock = VideoDownloader as jest.MockedClass<typeof VideoDownloader>;

const TEST_HOST = "mqtt://localhost";

describe("Controller", () => {
  let controller: Controller;

  beforeEach(() => {
    ApiMock.mockClear();
    EventProcessorMock.mockClear();
    VideoDownloaderMock.mockClear();
    ClientMock.mockClear();
    mqttMock.connect.mockClear();

    ApiMock.prototype.initialize.mockResolvedValue();
    ApiMock.prototype.getCameras.mockReturnValue([TEST_CAMERA_1, TEST_CAMERA_2]);

    const iStreamMock: IStream = jest.fn() as unknown as IStream;
    mqttMock.connect.mockReturnValue(new ClientMock(() => iStreamMock, {}));

    controller = new Controller({
      api: stubApi(),
      cameraNames: [],
      mqttHost: TEST_HOST,
      mqttPrefix: "foo",
      enableSmartMotion: true,
    });
  });

  it("should initialize successfully", async () => {
    await expect(controller.initialize()).resolves.toBeUndefined();

    expect(mqttMock.connect).toHaveBeenCalledWith(TEST_HOST, expect.any(Object));
    expect(ClientMock).toHaveBeenCalledTimes(1);
    expect(ApiMock.mock.instances[0].initialize).toHaveBeenCalledTimes(1);
    expect(ApiMock.mock.instances[0].getCameras).toHaveBeenCalledTimes(1);
  });

  it("should throw an error if no cameras are found", async () => {
    ApiMock.prototype.getCameras.mockClear();
    ApiMock.prototype.getCameras.mockReturnValue([]);

    await expect(controller.initialize()).rejects.toThrow("Unable to find cameras");
  });

  it("should subscribe successfully", async () => {
    await controller.initialize();
    controller.subscribe();

    expect(ApiMock.mock.instances[0].addSubscriber).toHaveBeenCalledTimes(1);
    // @ts-expect-error access private class method
    expect(ApiMock.mock.instances[0].addSubscriber).toHaveBeenCalledWith(controller.onMessage);
    expect(ClientMock.mock.instances[0].on).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(ClientMock.mock.instances[0].on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  describe("onMessage", () => {
    it("should do nothing when processing an invalid message", async () => {
      EventProcessorMock.prototype.parseMessage.mockReturnValue(null);

      await controller.initialize();
      // @ts-expect-error access private class method
      controller.onMessage();

      expect(VideoDownloaderMock.mock.instances[0].queueDownload).not.toHaveBeenCalled();
      expect(ClientMock.mock.instances[0].publish).not.toHaveBeenCalled();
    });

    it("should do nothing when processing an unknown camera", async () => {
      EventProcessorMock.prototype.parseMessage.mockReturnValue({
        camera: "UNKNOWN_CAMERA",
        start: 10000,
        type: "smart",
      });

      await controller.initialize();
      // @ts-expect-error access private class method
      controller.onMessage();

      expect(VideoDownloaderMock.mock.instances[0].queueDownload).not.toHaveBeenCalled();
      expect(ClientMock.mock.instances[0].publish).not.toHaveBeenCalled();
    });

    it("should only publish an mqtt message on valid start motion event", async () => {
      EventProcessorMock.prototype.parseMessage.mockReturnValue({
        camera: TEST_CAMERA_1.id,
        start: 10000,
        type: "smart",
      });

      await controller.initialize();
      // @ts-expect-error access private class method
      controller.onMessage(Buffer.from("test"));

      expect(VideoDownloaderMock.mock.instances[0].queueDownload).not.toHaveBeenCalled();
      expect(ClientMock.mock.instances[0].publish).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`downloader\/${TEST_CAMERA_1.id}\/motion$`)),
        expect.stringContaining(TEST_CAMERA_1.name),
        expect.any(Object)
      );
    });

    it("should queue a video download on valid end motion event", async () => {
      const event: MotionEndEvent = {
        camera: TEST_CAMERA_1.id,
        start: 10000,
        end: 20000,
        type: "smart",
      };
      EventProcessorMock.prototype.parseMessage.mockReturnValue(event);

      await controller.initialize();
      // @ts-expect-error access private class method
      controller.onMessage(Buffer.from("test"));

      expect(VideoDownloaderMock.mock.instances[0].queueDownload).toHaveBeenCalledWith(event);
      expect(ClientMock.mock.instances[0].publish).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`downloader\/${TEST_CAMERA_1.id}\/motion$`)),
        expect.stringContaining(TEST_CAMERA_1.name),
        expect.any(Object)
      );
    });
  });
});
