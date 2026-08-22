const test = require("node:test");
const assert = require("node:assert/strict");

test("concurrent 401 responses share one refresh and retry once", async () => {
  const storage = new Map([
    ["linkcv_access_token", "old-access"],
    ["linkcv_refresh_token", "old-refresh"],
    ["linkcv_user", { id: "1", nickname: "张三" }],
  ]);
  let refreshCalls = 0;
  let protectedCalls = 0;

  global.getApp = () => ({ globalData: { apiBaseUrl: "https://linkcv.example.test" } });
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      queueMicrotask(() => {
        if (options.url.endsWith("/miniprogram/refresh")) {
          refreshCalls += 1;
          options.success({
            statusCode: 200,
            data: {
              user: { id: "1", nickname: "张三" },
              access_token: "new-access",
              refresh_token: "new-refresh",
            },
          });
          return;
        }
        protectedCalls += 1;
        const authorized = options.header.Authorization === "Bearer new-access";
        options.success({
          statusCode: authorized ? 200 : 401,
          data: authorized ? { resumes: [] } : { error: "UNAUTHORIZED" },
        });
      });
    },
  };

  const { request } = require("../utils/request");
  const responses = await Promise.all([
    request("/api/miniprogram/resumes"),
    request("/api/miniprogram/resumes"),
  ]);

  assert.deepEqual(responses, [{ resumes: [] }, { resumes: [] }]);
  assert.equal(refreshCalls, 1);
  assert.equal(protectedCalls, 4);
  assert.equal(storage.get("linkcv_refresh_token"), "new-refresh");
});

test("transient refresh failure keeps the session and does not create a new login", async () => {
  const storage = new Map([
    ["linkcv_access_token", "expired-access"],
    ["linkcv_refresh_token", "still-valid-refresh"],
    ["linkcv_user", { id: "1", nickname: "张三" }],
  ]);
  let loginCalls = 0;

  global.getApp = () => ({ globalData: { apiBaseUrl: "https://linkcv.example.test" } });
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    login() {
      loginCalls += 1;
    },
    request(options) {
      queueMicrotask(() => {
        if (options.url.endsWith("/miniprogram/refresh")) {
          options.success({
            statusCode: 503,
            data: { error: "WECHAT_SERVICE_UNAVAILABLE" },
          });
          return;
        }
        options.success({ statusCode: 401, data: { error: "UNAUTHORIZED" } });
      });
    },
  };

  const { request } = require("../utils/request");
  await assert.rejects(
    request("/api/miniprogram/resumes"),
    (error) => error.statusCode === 503 && error.message === "WECHAT_SERVICE_UNAVAILABLE",
  );

  assert.equal(loginCalls, 0);
  assert.equal(storage.get("linkcv_refresh_token"), "still-valid-refresh");
  assert.equal(storage.get("linkcv_access_token"), "expired-access");
});

test("expired refresh can only log into an existing account and never registers silently", async () => {
  const storage = new Map([
    ["linkcv_access_token", "expired-access"],
    ["linkcv_refresh_token", "expired-refresh"],
    ["linkcv_user", { id: "1", nickname: "张三" }],
  ]);
  let loginRequestData;

  global.getApp = () => ({ globalData: { apiBaseUrl: "https://linkcv.example.test" } });
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    login(options) {
      queueMicrotask(() => options.success({ code: "wx-recovery-code" }));
    },
    request(options) {
      queueMicrotask(() => {
        if (options.url.endsWith("/miniprogram/refresh")) {
          options.success({ statusCode: 401, data: { error: "INVALID_CREDENTIALS" } });
          return;
        }
        if (options.url.endsWith("/miniprogram/login")) {
          loginRequestData = options.data;
          options.success({
            statusCode: 400,
            data: { error: "PRIVACY_AGREEMENT_REQUIRED" },
          });
          return;
        }
        options.success({ statusCode: 401, data: { error: "UNAUTHORIZED" } });
      });
    },
  };

  const { request } = require("../utils/request");
  await assert.rejects(
    request("/api/miniprogram/resumes"),
    (error) => error.code === "PRIVACY_AGREEMENT_REQUIRED",
  );

  assert.deepEqual(loginRequestData, {
    code: "wx-recovery-code",
    privacy_accepted: false,
  });
  assert.equal(storage.has("linkcv_access_token"), false);
  assert.equal(storage.has("linkcv_refresh_token"), false);
});
