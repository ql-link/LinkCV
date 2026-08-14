const test = require("node:test");
const assert = require("node:assert/strict");
const runtimeConfig = require("../config/runtime");
const { resolveApiBaseUrl } = require("../config/env");

test("release build requires an explicit HTTPS API base URL", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  };
  assert.throws(resolveApiBaseUrl, /未配置小程序 API 地址/);
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
  runtimeConfig.apiBaseUrl = "https://linkcv.example.test/api/";
  try {
    assert.equal(resolveApiBaseUrl(), "https://linkcv.example.test/api");
  } finally {
    runtimeConfig.apiBaseUrl = "";
  }
});

test("release build rejects an insecure configured API URL", () => {
  global.wx = {
    getExtConfigSync: () => ({ apiBaseUrl: "http://linkcv.example.test" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "trial" } }),
  };
  assert.throws(resolveApiBaseUrl, /必须使用 HTTPS/);
});
