const test = require("node:test");
const assert = require("node:assert/strict");

function loadAuth(wxMock) {
  global.getApp = () => ({ globalData: { apiBaseUrl: "https://linkcv.example.test" } });
  global.wx = wxMock;
  const modulePath = require.resolve("../services/auth");
  delete require.cache[modulePath];
  return require(modulePath);
}

test("does not create a mini-program session before privacy agreement", async () => {
  const storage = new Map();
  let wxLoginCalls = 0;
  const auth = loadAuth({
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    login() { wxLoginCalls += 1; },
  });

  await assert.rejects(
    auth.ensureSession(),
    (error) => error.code === "SESSION_REQUIRED",
  );
  await assert.rejects(
    auth.registerOrLogin(),
    (error) => error.code === "AGREEMENT_REQUIRED",
  );
  assert.equal(wxLoginCalls, 0);
});

test("creates a session only after the user accepts the privacy agreement", async () => {
  const storage = new Map();
  let requestData;
  const auth = loadAuth({
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    login(options) { queueMicrotask(() => options.success({ code: "wx-code" })); },
    request(options) {
      requestData = options.data;
      queueMicrotask(() => options.success({
        statusCode: 200,
        data: {
          user: { id: "1", nickname: "张三" },
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      }));
    },
  });

  auth.acceptPrivacyAgreement();
  const user = await auth.registerOrLogin();

  assert.equal(user.nickname, "张三");
  assert.deepEqual(requestData, { code: "wx-code", privacy_accepted: true });
  assert.equal(storage.get("linkcv_access_token"), "access-token");
  assert.equal(storage.get("linkcv_privacy_agreement_v1"), true);
});

test("logs into an existing account without enabling registration", async () => {
  const storage = new Map();
  let requestData;
  const auth = loadAuth({
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    login(options) { queueMicrotask(() => options.success({ code: "wx-existing" })); },
    request(options) {
      requestData = options.data;
      queueMicrotask(() => options.success({
        statusCode: 200,
        data: {
          user: { id: "1", nickname: "已有用户" },
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      }));
    },
  });

  await auth.loginExistingAccount();

  assert.deepEqual(requestData, { code: "wx-existing", privacy_accepted: false });
});

test("checks whether the current WeChat identity is registered without logging in", async () => {
  let requestedPath = "";
  let requestData;
  const auth = loadAuth({
    getStorageSync: () => undefined,
    login(options) { queueMicrotask(() => options.success({ code: "wx-status" })); },
    request(options) {
      requestedPath = options.url;
      requestData = options.data;
      queueMicrotask(() => options.success({
        statusCode: 200,
        data: { registered: true },
      }));
    },
  });

  assert.equal(await auth.getAccountStatus(), true);
  assert.equal(requestedPath, "https://linkcv.example.test/api/auth/wechat/miniprogram/account-status");
  assert.deepEqual(requestData, { code: "wx-status" });
});

test("reads the platform privacy contract name when available", async () => {
  const auth = loadAuth({
    getStorageSync: () => undefined,
    getPrivacySetting(options) {
      options.success({
        needAuthorization: true,
        privacyContractName: "《LinkCV 隐私保护指引》",
      });
    },
  });

  assert.deepEqual(await auth.getPrivacySetting(), {
    supported: true,
    needAuthorization: true,
    privacyContractName: "《LinkCV 隐私保护指引》",
  });
});

test("fails closed when the platform privacy API is unavailable", async () => {
  const auth = loadAuth({ getStorageSync: () => undefined });

  assert.deepEqual(await auth.getPrivacySetting(), {
    supported: false,
    needAuthorization: false,
    privacyContractName: "《LinkCV 小程序隐私保护指引》",
  });
});
