import WebSocket, { CLOSED, OPEN } from "ws";
import EventStream, { EVENTS_HEARTBEAT_INTERVAL_MS, EVENTS_RECONNECT_INTERNAL_MS } from "../src/event_stream";

const mockHost = "mockServer";
const mockUpdateId = "12345";

jest.useFakeTimers();
jest.mock("ws");

const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>;

describe("EventStream", () => {
  let eventStream: EventStream;

  beforeEach(() => {
    MockWebSocket.mockClear();

    eventStream = new EventStream({ host: mockHost, headers: {}, lastUpdateId: mockUpdateId });
  });

  describe("connect", () => {
    it("should connect without error", () => {
      eventStream.connect();

      expect(MockWebSocket.mock.instances[0].on).toHaveBeenCalledTimes(5);
      expect(MockWebSocket.mock.instances[0].on).toHaveBeenCalledWith("open", expect.any(Function));
      expect(MockWebSocket.mock.instances[0].on).toHaveBeenCalledWith("ping", expect.any(Function));
      expect(MockWebSocket.mock.instances[0].on).toHaveBeenCalledWith("message", expect.any(Function));
      expect(MockWebSocket.mock.instances[0].on).toHaveBeenCalledWith("close", expect.any(Function));
      expect(MockWebSocket.mock.instances[0].on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("should not connect if already connected", () => {
      eventStream.connect();

      MockWebSocket.mock.instances[0].readyState = CLOSED;

      eventStream.connect();

      expect(MockWebSocket.mock.calls).toHaveLength(2);

      MockWebSocket.mock.instances[1].readyState = OPEN;

      eventStream.connect();

      expect(MockWebSocket.mock.calls).toHaveLength(2);
    });
  });

  describe("addSubscriber", () => {
    it("should add a subscriber", () => {
      // @ts-expect-error access private method
      expect(eventStream.subscribers).toEqual(new Set([]));

      const mockHandler = jest.fn();
      eventStream.addSubscriber(mockHandler);

      // @ts-expect-error access private method
      expect(eventStream.subscribers).toEqual(new Set([mockHandler]));
    });
  });

  describe("clearSubscribers", () => {
    it("should clear subscribers", () => {
      const mockHandler = jest.fn();
      eventStream.addSubscriber(mockHandler);

      eventStream.clearSubscribers();

      // @ts-expect-error access private method
      expect(eventStream.subscribers).toEqual(new Set([]));
    });
  });

  describe("disconnect", () => {
    it("should terminate the connection on disconnect", () => {
      eventStream.connect();

      eventStream.disconnect();

      expect(MockWebSocket.mock.instances[0].terminate).toHaveBeenCalled();
    });
  });

  describe("reconnect", () => {
    it("should attempt to reconnect ", () => {
      const connectSpy = jest.spyOn(eventStream, "connect");

      // @ts-expect-error access private method
      eventStream.reconnect();

      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it("should not reconnect if already connected", () => {
      const connectSpy = jest.spyOn(eventStream, "connect");

      eventStream.connected = true;
      // @ts-expect-error access private method
      eventStream.reconnect();

      expect(connectSpy).not.toHaveBeenCalled();
    });

    it("should reconnect after a delay if initial connect fails ", () => {
      const connectSpy = jest.spyOn(eventStream, "connect").mockReturnValueOnce(false).mockReturnValueOnce(true);

      // @ts-expect-error access private method
      eventStream.reconnect();

      expect(connectSpy).toHaveBeenCalledTimes(1);

      // first connect fails
      jest.advanceTimersByTime(EVENTS_RECONNECT_INTERNAL_MS);

      expect(connectSpy).toHaveBeenCalledTimes(2);

      // second connect succeeds
      jest.advanceTimersByTime(EVENTS_RECONNECT_INTERNAL_MS);

      expect(connectSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("onOpen", () => {
    it("should mark the stream as connected", () => {
      eventStream.connect();

      // @ts-expect-error access private method
      eventStream.onOpen();

      expect(eventStream.connected).toBe(true);
    });

    it("should terminate if no heartbeat received after connection open", () => {
      eventStream.connect();

      // @ts-expect-error access private method
      eventStream.onOpen();

      jest.advanceTimersByTime(EVENTS_HEARTBEAT_INTERVAL_MS);

      expect(MockWebSocket.mock.instances[0].terminate).toHaveBeenCalled();
    });
  });

  describe("onMessage", () => {
    it("should call subsribers with the message", () => {
      eventStream.connect();

      const mockHandler = jest.fn();
      eventStream.addSubscriber(mockHandler);

      const testMessage = Buffer.from("test");
      // @ts-expect-error access private method
      eventStream.onMessage(testMessage);

      expect(mockHandler).toHaveBeenCalledWith(testMessage);
    });
  });

  describe("onClose", () => {
    it("should attempt reconnect on close", async () => {
      // @ts-expect-error access private method
      const reconnectSpy = jest.spyOn(eventStream, "reconnect");

      eventStream.connect();

      // @ts-expect-error access private method
      eventStream.onClose();

      expect(eventStream.connected).toBe(false);

      expect(reconnectSpy).toHaveBeenCalled();
    });
  });

  describe("onError", () => {
    it("should terminate on error", () => {
      eventStream.connect();

      // @ts-expect-error access private method
      eventStream.onError(new Error("Failed"));

      expect(MockWebSocket.mock.instances[0].terminate).toHaveBeenCalled();
    });
  });
});
