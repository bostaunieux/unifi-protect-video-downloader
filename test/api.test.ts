import fs, { WriteStream } from "fs";
import { PassThrough } from "stream";
import Api from "../src/api";
import EventStream from "../src/event_stream";
import {
  createMockAgent,
  mockDownloadVideo,
  mockFailedLogin,
  mockIndex,
  mockSuccess,
  PASSWORD,
  TEST_CAMERA_1,
  USERNAME,
} from "./fixture_helper";

jest.mock("fs");
jest.mock("fs/promises");
jest.mock("../src/event_stream");

const fsMock = fs as jest.Mocked<typeof fs>;
const EventStreamMock = EventStream as jest.MockedClass<typeof EventStream>;

const TEST_HOST = "localhost";

describe("Api", () => {
  let api: Api;
  let mockAgent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    EventStreamMock.mockClear();

    mockAgent = createMockAgent();

    api = new Api({
      host: TEST_HOST,
      username: USERNAME,
      password: PASSWORD,
      downloadPath: "/downloads",
      dispatcher: mockAgent,
    });
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("should initialize successfully", async () => {
    mockSuccess(mockAgent.get(`https://${TEST_HOST}`));

    await api.initialize();

    expect(EventStreamMock).toHaveBeenCalledTimes(1);
    expect(EventStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: TEST_HOST,
      }),
    );
    expect(EventStreamMock.mock.instances[0].connect).toHaveBeenCalledTimes(1);
  });

  it("should throw an initialization error when login fails", async () => {
    expect.assertions(1);

    mockIndex(mockAgent.get(`https://${TEST_HOST}`));
    mockFailedLogin(mockAgent.get(`https://${TEST_HOST}`));

    await expect(api.initialize()).rejects.toThrow("Unable to get bootstrap details; failed fetching auth headers");
  });

  it("should find configured cameras", async () => {
    mockSuccess(mockAgent.get(`https://${TEST_HOST}`));

    await api.initialize();

    expect(api.getCameras()).toEqual([TEST_CAMERA_1]);
  });

  it("should properly add a subscriber", async () => {
    mockSuccess(mockAgent.get(`https://${TEST_HOST}`));

    await api.initialize();

    const handler = jest.fn();
    api.addSubscriber(handler);

    expect(EventStreamMock.mock.instances[0].addSubscriber).toHaveBeenCalledTimes(1);
    expect(EventStreamMock.mock.instances[0].addSubscriber).toHaveBeenCalledWith(handler);
  });

  it("should properly clear subscribers", async () => {
    mockSuccess(mockAgent.get(`https://${TEST_HOST}`));

    await api.initialize();

    api.addSubscriber(jest.fn());

    api.clearSubscribers();

    expect(EventStreamMock.mock.instances[0].clearSubscribers).toHaveBeenCalledTimes(1);
  });

  it("should return false when downloading an unknown camera's video", async () => {
    mockSuccess(mockAgent.get(`https://${TEST_HOST}`));

    await api.initialize();

    await expect(api.downloadVideo({ camera: "FAKE_CAMERA", start: 1, end: 2 })).resolves.toBe(false);
  });

  it("should return true when downloading a known camera's video", async () => {
    expect.assertions(1);

    mockSuccess(mockAgent.get(`https://${TEST_HOST}`));
    mockDownloadVideo(mockAgent.get(`https://${TEST_HOST}`));

    await api.initialize();

    const mockWriteable = new PassThrough() as unknown as WriteStream;
    fsMock.createWriteStream.mockReturnValueOnce(mockWriteable);

    // Start the download
    const downloadPromise = api.downloadVideo({ camera: TEST_CAMERA_1.id, start: 1000, end: 9000 });

    // The mock stream will end automatically, which will trigger the finish event
    await expect(downloadPromise).resolves.toBe(true);
  });
});
