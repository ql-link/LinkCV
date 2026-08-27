const test = require("node:test");
const assert = require("node:assert/strict");
const runtimeConfig = require("../config/runtime");
const { resolveApiBaseUrl } = require("../config/env");

test("release build defaults to the LinkResume production origin", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  };
  assert.equal(resolveApiBaseUrl(), "https://linkresume.cn");
});

test("ext config API URL wins and removes a trailing slash", () => {
  global.wx = {
    getExtConfigSync: () => ({ apiBaseUrl: "https://linkcv.example.test/" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  };
  assert.equal(resolveApiBaseUrl(), "https://linkcv.example.test");
});

test("static runtime config supports a standalone release build", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  };
  const previous = runtimeConfig.productionApiBaseUrl;
  runtimeConfig.productionApiBaseUrl = "https://linkcv.example.test/api/";
  try {
    assert.equal(resolveApiBaseUrl(), "https://linkcv.example.test/api");
  } finally {
    runtimeConfig.productionApiBaseUrl = previous;
  }
});

test("DevTools develop build defaults to the local FastAPI origin", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getSystemInfoSync: () => ({ platform: "devtools" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  assert.equal(resolveApiBaseUrl(), "http://127.0.0.1:8000");
});

test("DevTools develop build uses the bundled local config", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getSystemInfoSync: () => ({ platform: "devtools" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  let localConfigReads = 0;
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => {
        localConfigReads += 1;
        return { apiBaseUrl: "http://192.168.3.20:8000/" };
      },
    }),
    "http://192.168.3.20:8000",
  );
  assert.equal(localConfigReads, 1);
});

test("real-device develop build ignores local config and defaults to production", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getSystemInfoSync: () => ({ platform: "ios" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  let localConfigReads = 0;
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => {
        localConfigReads += 1;
        return { apiBaseUrl: "http://192.168.3.20:8000" };
      },
    }),
    "https://linkresume.cn",
  );
  assert.equal(localConfigReads, 0);
});

test("develop build accepts a device-local internal API URL override", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getSystemInfoSync: () => ({ platform: "android" }),
    getStorageSync: (key) => key === "linkcv_api_base_url"
      ? "http://192.168.1.23:8000/"
      : "",
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => ({ apiBaseUrl: "http://192.168.3.20:8000" }),
    }),
    "http://192.168.1.23:8000",
  );
});

test("release build ignores a device-local development override", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getSystemInfoSync: () => ({ platform: "ios" }),
    getStorageSync: () => "http://192.168.1.23:8000",
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  };
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => ({ apiBaseUrl: "http://192.168.3.20:8000" }),
    }),
    "https://linkresume.cn",
  );
});

test("trial build ignores local development sources and keeps the production default", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getSystemInfoSync: () => ({ platform: "android" }),
    getStorageSync: () => "http://192.168.1.23:8000",
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "trial" } }),
  };
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => ({ apiBaseUrl: "http://192.168.3.20:8000" }),
    }),
    "https://linkresume.cn",
  );
});

test("release build rejects an insecure configured API URL", () => {
  global.wx = {
    getExtConfigSync: () => ({ apiBaseUrl: "http://linkcv.example.test" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "trial" } }),
  };
  assert.throws(resolveApiBaseUrl, /必须使用 HTTPS/);
});
