import { TEST_CAMERA_1, stubApi } from "./fixture_helper";
import VideoDownloader from "../src/video_downloader";
import { DownloadError, MotionEndEvent } from "../src/types";
import Api from "../src/api";

jest.useFakeTimers();

jest.mock("../src/api");

const ApiMock = Api as jest.MockedClass<typeof Api>;

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

    videoDownloader = new VideoDownloader(stubApi());
  });

  describe("queueDownload", () => {
    it("should queue a motion event and process it", async () => {
      ApiMock.prototype.downloadVideo.mockResolvedValue(true);

      videoDownloader.queueDownload(event);

      await Promise.resolve();
      await Promise.resolve();

      expect(ApiMock.prototype.downloadVideo).toHaveBeenCalledWith(event);
    });

    it("should not queue a motion event with zero retries", () => {
      const addSpy = jest.spyOn(videoDownloader.queue, "add");

      videoDownloader.queueDownload(event, 0);

      expect(addSpy).not.toHaveBeenCalled();
    });

    it("should requeue a motion event on DownloadError", async () => {
      const queueDownloadSpy = jest.spyOn(videoDownloader, "queueDownload");
      ApiMock.prototype.downloadVideo.mockRejectedValue(new Error("network error"));

      videoDownloader.queueDownload(event, 5);

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      expect(queueDownloadSpy).toHaveBeenCalledTimes(2);
      expect(queueDownloadSpy).toHaveBeenNthCalledWith(1, event, 5);
      expect(queueDownloadSpy).toHaveBeenNthCalledWith(2, event, 4);
    });

    it("should not requeue on non-DownloadError", async () => {
      const queueDownloadSpy = jest.spyOn(videoDownloader, "queueDownload");
      const processEventSpy = jest
        .spyOn(videoDownloader as unknown as { processEvent: () => Promise<void> }, "processEvent")
        .mockRejectedValue(new Error("other error"));

      videoDownloader.queueDownload(event, 5);

      await Promise.resolve();
      await Promise.resolve();
      await jest.runOnlyPendingTimersAsync();

      expect(queueDownloadSpy).toHaveBeenCalledTimes(1);
      expect(queueDownloadSpy).toHaveBeenCalledWith(event, 5);
      processEventSpy.mockRestore();
    });
  });

  describe("processEvent", () => {
    it("should complete on successful download", async () => {
      ApiMock.prototype.downloadVideo.mockResolvedValue(true);

      const retries = 5;

      // @ts-expect-error access private method
      await expect(videoDownloader.processEvent(event, retries)).resolves.toBeUndefined();
    });

    it("should throw DownloadError on generic download failure", async () => {
      ApiMock.prototype.downloadVideo.mockRejectedValue(null);

      const retries = 5;

      // @ts-expect-error access private method
      await expect(videoDownloader.processEvent(event, retries)).rejects.toThrow(new DownloadError(event, retries));
    });

    it("should throw DownloadError on download failure", async () => {
      ApiMock.prototype.downloadVideo.mockRejectedValue({ response: { status: 401, data: "testData" } });

      const retries = 5;

      // @ts-expect-error access private method
      await expect(videoDownloader.processEvent(event, retries)).rejects.toThrow(new DownloadError(event, retries));
    });
  });
});
