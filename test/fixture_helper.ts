import { Scope } from "nock";
import { PassThrough } from "stream";

const AUTH_COOKIE = "test-cookie";
const AUTH_TOKEN = "test-token";
export const USERNAME = "username";
export const PASSWORD = "password";
export const TEST_CAMERA_1 = {
  id: "123456",
  name: "Garage",
};

export const mockIndex = (scope: Scope): Scope =>
  scope.get("/").reply(200, "<html/>", {
    "X-CSRF-Token": "test-token",
  });

export const mockLogin = (scope: Scope): Scope =>
  scope
    .post("/api/auth/login", { username: USERNAME, password: PASSWORD }, { reqheaders: { "X-CSRF-Token": AUTH_TOKEN } })
    .reply(200, "", {
      "X-CSRF-Token": AUTH_TOKEN,
      "Set-Cookie": AUTH_COOKIE,
    });

export const mockFailedLogin = (scope: Scope): Scope =>
  scope
    .post("/api/auth/login", { username: USERNAME, password: PASSWORD }, { reqheaders: { "X-CSRF-Token": AUTH_TOKEN } })
    .reply(401);

export const mockBootstrap = (scope: Scope): Scope =>
  scope
    .get("/proxy/protect/api/bootstrap", "", {
      reqheaders: {
        "Content-Type": "application/json",
        Cookie: AUTH_COOKIE,
        "X-CSRF-Token": AUTH_TOKEN,
      },
    })
    .reply(200, {
      lastUpdateId: "abcdef",
      cameras: [TEST_CAMERA_1],
    });

export const mockDownloadVideo = (scope: Scope): Scope =>
  scope
    .get("/proxy/protect/api/video/export")
    .query(true)
    .reply(200, () => {
      return new PassThrough();
    });

export const mockSuccess = (scope: Scope): Scope => {
  mockIndex(scope);
  mockLogin(scope);
  mockBootstrap(scope);

  return scope;
};
