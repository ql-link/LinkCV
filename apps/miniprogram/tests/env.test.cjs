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

test("account environment lookup errors fail closed without reading development sources", () => {
  let storageReads = 0;
  let localConfigReads = 0;
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: () => {
      storageReads += 1;
      return true;
    },
    getAccountInfoSync: () => {
      throw new Error("account info unavailable");
    },
  };
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => {
        localConfigReads += 1;
        return { apiBaseUrl: "http://192.168.3.20:8000" };
      },
    }),
    "https://linkresume.cn",
  );
  assert.equal(storageReads, 0);
  assert.equal(localConfigReads, 0);
});

test("missing account environment API fails closed without reading development sources", () => {
  let storageReads = 0;
  let localConfigReads = 0;
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: () => {
      storageReads += 1;
      return true;
    },
  };
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => {
        localConfigReads += 1;
        return { apiBaseUrl: "http://192.168.3.20:8000" };
      },
    }),
    "https://linkresume.cn",
  );
  assert.equal(storageReads, 0);
  assert.equal(localConfigReads, 0);
});

test("missing or incomplete account info fails closed without reading development sources", () => {
  for (const accountInfo of [null, {}, { miniProgram: {} }]) {
    let storageReads = 0;
    let localConfigReads = 0;
    global.wx = {
      getExtConfigSync: () => ({}),
      getStorageSync: () => {
        storageReads += 1;
        return true;
      },
      getAccountInfoSync: () => accountInfo,
    };
    assert.equal(
      resolveApiBaseUrl({
        readLocalConfig: () => {
          localConfigReads += 1;
          return { apiBaseUrl: "http://192.168.3.20:8000" };
        },
      }),
      "https://linkresume.cn",
    );
    assert.equal(storageReads, 0);
    assert.equal(localConfigReads, 0);
  }
});

test("develop DevTools build without opt-in defaults to production and does not read local config", () => {
  let localConfigReads = 0;
  const storageReads = [];
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: (key) => {
      storageReads.push(key);
      return "";
    },
    getSystemInfoSync: () => ({ platform: "devtools" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
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
  assert.deepEqual(storageReads, ["linkcv_local_debug_enabled", "linkcv_api_base_url"]);
});

test("real-device develop build without opt-in defaults to production", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: () => "",
    getSystemInfoSync: () => ({ platform: "ios" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  assert.equal(resolveApiBaseUrl(), "https://linkresume.cn");
});

test("develop without opt-in does not depend on platform metadata", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: () => "",
    getSystemInfoSync: () => {
      throw new Error("platform metadata unavailable");
    },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  assert.equal(resolveApiBaseUrl(), "https://linkresume.cn");
});

test("develop opt-in uses the bundled local config in DevTools", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: (key) => key === "linkcv_local_debug_enabled" ? true : "",
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

test("develop local debug opt-in requires the boolean true value", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: (key) => key === "linkcv_local_debug_enabled" ? "true" : "",
    getSystemInfoSync: () => ({ platform: "devtools" }),
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

test("develop opt-in also uses the bundled local config on a real device", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: (key) => key === "linkcv_local_debug_enabled" ? true : "",
    getSystemInfoSync: () => ({ platform: "ios" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => ({ apiBaseUrl: "http://192.168.3.20:8000" }),
    }),
    "http://192.168.3.20:8000",
  );
});

test("develop explicit URL storage override wins over opt-in local config", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: (key) => key === "linkcv_local_debug_enabled"
      ? true
      : "http://192.168.1.23:8000/",
    getSystemInfoSync: () => ({ platform: "android" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => ({ apiBaseUrl: "http://192.168.3.20:8000" }),
    }),
    "http://192.168.1.23:8000",
  );
});

test("local config read failure falls back to production", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: (key) => key === "linkcv_local_debug_enabled" ? true : "",
    getSystemInfoSync: () => ({ platform: "ios" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  assert.equal(
    resolveApiBaseUrl({
      readLocalConfig: () => {
        throw new Error("local config unavailable");
      },
    }),
    "https://linkresume.cn",
  );
});

test("release build ignores opt-in and local config", () => {
  let localConfigReads = 0;
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: (key) => key === "linkcv_local_debug_enabled"
      ? true
      : "http://192.168.1.23:8000",
    getSystemInfoSync: () => ({ platform: "android" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  };
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

test("trial build ignores opt-in and local config", () => {
  let localConfigReads = 0;
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: (key) => key === "linkcv_local_debug_enabled"
      ? true
      : "http://192.168.1.23:8000",
    getSystemInfoSync: () => ({ platform: "ios" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "trial" } }),
  };
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

test("release build rejects an insecure configured API URL", () => {
  global.wx = {
    getExtConfigSync: () => ({ apiBaseUrl: "http://linkcv.example.test" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "trial" } }),
  };
  assert.throws(resolveApiBaseUrl, /必须使用 HTTPS/);
});
