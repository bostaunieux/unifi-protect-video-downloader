import { SequentialTaskQueue } from "sequential-task-queue";
import { TEST_CAMERA_1, stubApi } from "./fixture_helper";
import VideoDownloader from "../src/video_downloader";
import { DownloadError, MotionEndEvent } from "../src/types";
import Api from "../src/api";

// don't block on setInterval calls
jest.useFakeTimers();

jest.mock("../src/api");
jest.mock("sequential-task-queue");

const ApiMock = Api as jest.MockedClass<typeof Api>;
const SequentialTaskQueueMock = SequentialTaskQueue as jest.MockedClass<typeof SequentialTaskQueue>;

describe("VideoDownloader", () => {
  let videoDownloader: VideoDownloader;

  const event: MotionEndEvent = {
    camera: TEST_CAMERA_1.id,
    start: 10000,
    end: 20000,
    type: "smart",
  };

  beforeEach(() => {
    ApiMock.mockClear();
    SequentialTaskQueueMock.mockClear();

    videoDownloader = new VideoDownloader(stubApi());
  });

  it("should properly initialize", () => {
    expect(SequentialTaskQueueMock.prototype.on).toHaveBeenLastCalledWith("error", videoDownloader.onError);
  });

  describe("queueDownload", () => {
    beforeEach(() => {
      SequentialTaskQueueMock.prototype.push.mockClear();
    });

    it("should queue a motion event", () => {
      videoDownloader.queueDownload(event);

      expect(SequentialTaskQueueMock.prototype.push).toHaveBeenCalledWith(videoDownloader.processEvent, {
        args: [event, videoDownloader.maxRetries],
      });
    });

    it("should not queue a motion event with zero retries", () => {
      videoDownloader.queueDownload(event, 0);

      expect(SequentialTaskQueueMock.prototype.push).not.toHaveBeenCalled();
    });
  });

  describe("onError", () => {
    let queueDownloadSpy: jest.SpyInstance;

    beforeEach(() => {
      queueDownloadSpy = jest.spyOn(videoDownloader, "queueDownload");
    });

    afterEach(() => {
      queueDownloadSpy.mockRestore();
    });

    it("should requeue a motion event", async () => {
      const retries = 5;
      videoDownloader.onError(new DownloadError(event, retries));

      jest.advanceTimersByTime(videoDownloader.retryIntervalMs);

      expect(queueDownloadSpy).toHaveBeenCalledTimes(1);
      expect(queueDownloadSpy).toHaveBeenCalledWith(event, retries - 1);
    });

    it("should do nothing with an unknown error", async () => {
      videoDownloader.onError(new Error("unknown error") as DownloadError);

      expect(queueDownloadSpy).not.toHaveBeenCalled();
    });
  });

  describe("processEvent", () => {
    it("should complete on successful download", async () => {
      ApiMock.prototype.downloadVideo.mockResolvedValue(true);

      const retries = 5;

      await expect(videoDownloader.processEvent(event, retries)).resolves.toBeUndefined();
    });

    it("should throw DownloadError on generic download failure", async () => {
      ApiMock.prototype.downloadVideo.mockRejectedValue(null);

      const retries = 5;

      await expect(videoDownloader.processEvent(event, retries)).rejects.toThrow(new DownloadError(event, retries));
    });

    it("should throw DownloadError on download failure", async () => {
      ApiMock.prototype.downloadVideo.mockRejectedValue({ response: { status: 401, data: "testData" } });

      const retries = 5;

      await expect(videoDownloader.processEvent(event, retries)).rejects.toThrow(new DownloadError(event, retries));
    });
  });
});
