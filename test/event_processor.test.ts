import EventProcessor from "../src/event_processor";

// don't block on setTimeout calls
jest.useFakeTimers();

const START_MOTION_BUFFER = Buffer.from(
  "0101010000000071789c1dcb410ac2400c46e1bb64ed40a83389e30dc4b507c84cfe42c1b6221511f1ee46778f07df9bac6fd3bad0911e37b70db4a305cfcbbf4f1edbc4b57729096a9272c99caa7a4bd250d154e003079a57c7f58c57886e33ee166ffaf9e20748ad23338f26bc8746e53cd0e70b4bfc242c0201010000000038789cab56ca492c2ef1cd2fc9cccf53b2323433343631b43435b0303137d351ca2c8648b8a496a42697a4a62859951495a6d60200b4b11126",
  "hex",
);

const END_MOTION_BUFFER = Buffer.from(
  "0101010000000071789c1d8b510ac2400c05ef926f17a2a6dbae3710bf7b80a42f0b05db8ab48848ef6ef4671806e6433aace332d385b60774753ad0ecaffeef574486c250d89200356096ba4638653516d1f6a828314d0bfc7ef3771c834efed468e3ef6fd0792ea53273d5cc676fc3444eb47f017674249f0201010000000039789cab56ca492c2ef1cd2fc9cccf53b2323433343631b4343534333734d551ca2c8648b8a496a42697a4a62859a525e614a7d60200c4f8116c",
  "hex",
);

const START_SMART_MOTION_BUFFER = Buffer.from(
  "010101000000006f789c15cb4d0a02310c06d0bb646d21fdb12dde405ccf01d2e41b18d08e8ba20ce2ddaddb07ef43a263db3b5d48cce8441defe5693270b5697a1681557649427129415d2b3ebbec11abf96a683ad36337dc6f38e6c00b7d4cdafe3d73106bb2324709ca118539b155fafe0092c4231c02010100000000a3789c558dbb0ec2301004ffe5ea147e244ee21a2a5a2a10c5619fa548891dd9062942fc3b17d140bbbbb3f382baad0416ca82b91ea892ab9714091a289513b0d248dd2ad90edaa896539732ef87b1f945ce7c52c05e61a55c5284db5f7b7c52ac7bcdb1c38532b2b00b3a504012d274632734f542688d3d9b5726a73af18f8d8f796e60f20c18a1d0df31f00c95fb02adf003034bf2349f68e315ed2e787f0058df43d3",
  "hex",
);

const END_SMART_MOTION_BUFFER = Buffer.from(
  "0101010000000071789c1dcb410a02310c46e1bb646d21d3694df506e2da0324cd2f0c68c7455544bcbbd5dde3c1f726ad7d591bede97e73eda00d353c4fff3ef8d8391a345b0d95dd424a6261374909d9c1283699481ce8ba3a2e47bc86c003ad8fb5fcf896a3bae99979d65879863027f6429f2f2ccf24470201010000000028789cab564acd4b51b23234333436313234b13431b330d7512a4ece2f4a55b2b2b4a805008a18088d",
  "hex",
);

describe("EventProcessor", () => {
  let eventProcessor: EventProcessor;

  beforeEach(() => {
    eventProcessor = new EventProcessor();
  });

  it("should return null for a non-motion event", () => {
    expect(eventProcessor.parseMessage(Buffer.from("INVALID BUFFER"))).toBe(null);
  });

  it("should parse a basic start motion event", () => {
    expect(eventProcessor.parseMessage(START_MOTION_BUFFER)).toEqual({
      camera: "5d8e699f000fa603e7000442",
      start: 1613419508476,
      type: "basic",
    });
  });

  it("should return null fora basic end motion event without a start event", () => {
    expect(eventProcessor.parseMessage(END_MOTION_BUFFER)).toBe(null);
  });

  it("should parse a basic end motion event", () => {
    eventProcessor.parseMessage(START_MOTION_BUFFER);

    expect(eventProcessor.parseMessage(END_MOTION_BUFFER)).toEqual({
      camera: "5d8e699f000fa603e7000442",
      start: 1613419508476,
      end: 1613419516715,
      type: "basic",
    });
  });

  it("should parse a smart start motion event", () => {
    expect(eventProcessor.parseMessage(START_SMART_MOTION_BUFFER)).toEqual({
      camera: "5f3fefae01659503e70033a7",
      start: 1613421483624,
      type: "smart",
    });
  });

  it("should return null for a smart end motion event without a start event", () => {
    expect(eventProcessor.parseMessage(END_SMART_MOTION_BUFFER)).toBe(null);
  });

  it("should parse a smart end motion event", () => {
    eventProcessor.parseMessage(START_SMART_MOTION_BUFFER);

    expect(eventProcessor.parseMessage(END_SMART_MOTION_BUFFER)).toEqual({
      camera: "5f3fefae01659503e70033a7",
      start: 1613421483624,
      end: 1613421494687,
      type: "smart",
    });
  });
});
