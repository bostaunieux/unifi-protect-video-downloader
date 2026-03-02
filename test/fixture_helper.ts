import { MockAgent, MockPool } from "undici";
import { PassThrough } from "stream";
import Api from "../src/api";

const AUTH_COOKIE = "test-cookie";
const AUTH_TOKEN = "test-token";
export const USERNAME = "username";
export const PASSWORD = "password";

export const TEST_CAMERA_1 = {
  id: "123456",
  name: "Garage",
  mac: "XX:XX:XX:XX",
  host: "192.168.1.1",
  type: "TestCam",
  featureFlags: { hasSmartDetect: true },
};

export const TEST_CAMERA_2 = {
  id: "654321",
  name: "Balcony",
  mac: "XX:XX:XX:XX",
  host: "192.168.1.1",
  type: "TestCam",
  featureFlags: { hasSmartDetect: false },
};

export function createMockAgent(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  return agent;
}

export function mockIndex(pool: MockPool): void {
  pool.intercept({ path: "/", method: "GET" }).reply(200, "<html/>", {
    headers: { "X-CSRF-Token": AUTH_TOKEN },
  });
}

export function mockLogin(pool: MockPool): void {
  pool.intercept({ path: "/api/auth/login", method: "POST" }).reply(200, "", {
    headers: {
      "X-CSRF-Token": AUTH_TOKEN,
      "Set-Cookie": AUTH_COOKIE,
    },
  });
}

export function mockFailedLogin(pool: MockPool): void {
  pool.intercept({ path: "/api/auth/login", method: "POST" }).reply(401);
}

export function mockBootstrap(pool: MockPool): void {
  pool
    .intercept({ path: "/proxy/protect/api/bootstrap", method: "GET" })
    .reply(200, JSON.stringify({ lastUpdateId: "abcdef", cameras: [TEST_CAMERA_1] }), {
      headers: { "Content-Type": "application/json" },
    });
}

export function mockDownloadVideo(pool: MockPool): void {
  pool.intercept({ path: /\/proxy\/protect\/api\/video\/export/, method: "GET" }).reply(200, () => {
    const stream = new PassThrough();
    stream.end();
    return stream;
  });
}

export function mockSuccess(pool: MockPool): void {
  mockIndex(pool);
  mockLogin(pool);
  mockBootstrap(pool);
}

export const stubApi = (): Api => new Api({ host: "", username: "", password: "", downloadPath: "" });
