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

test("develop DevTools automatically uses the generated loopback address", () => {
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
        return { apiBaseUrl: "http://192.168.3.20:18000", devtoolsApiBaseUrl: "http://127.0.0.1:18000" };
      },
    }),
    "http://127.0.0.1:18000",
  );
  assert.equal(localConfigReads, 1);
  assert.deepEqual(storageReads, ["linkcv_local_debug_enabled", "linkcv_api_base_url"]);
});

test("real-device develop automatically uses LAN while false explicitly disables it", () => {
  for (const platform of ["ios", "android"]) {
    for (const preference of ["", true, false]) {
      global.wx = {
        getExtConfigSync: () => ({}),
        getStorageSync: (key) => key === "linkcv_local_debug_enabled" ? preference : "",
        getDeviceInfo: () => ({platform}),
        getAccountInfoSync: () => ({miniProgram: {envVersion: "develop"}}),
      };
      assert.equal(resolveApiBaseUrl({readLocalConfig: () => ({apiBaseUrl: "http://192.168.3.20:8000", devtoolsApiBaseUrl: "http://127.0.0.1:8000"})}), preference === false ? "https://linkresume.cn" : "http://192.168.3.20:8000");
    }
  }
});

test("develop uses LAN when platform metadata is unavailable", () => {
  global.wx = {
    getExtConfigSync: () => ({}),
    getStorageSync: () => "",
    getSystemInfoSync: () => {
      throw new Error("platform metadata unavailable");
    },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  };
  assert.equal(resolveApiBaseUrl({readLocalConfig: () => ({apiBaseUrl: "http://192.168.3.20:8000"})}), "http://192.168.3.20:8000");
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

test("DevTools can explicitly disable automatic local routing", () => {
  global.wx = {
    getDeviceInfo: () => ({ platform: "devtools" }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    getStorageSync: key => key === "linkcv_local_debug_enabled" ? false : "",
  };
  assert.equal(resolveApiBaseUrl({ readLocalConfig: () => { throw new Error("must not read"); } }), "https://linkresume.cn");
});

test("modern device metadata selects DevTools and explicit URL still takes precedence", () => {
  let override = "";
  global.wx = {
    getDeviceInfo: () => ({ platform: "devtools" }),
    getSystemInfoSync: () => { throw new Error("must use modern API"); },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    getStorageSync: key => key === "linkcv_api_base_url" ? override : "",
  };
  const options = { readLocalConfig: () => ({ devtoolsApiBaseUrl: "http://127.0.0.1:18000", apiBaseUrl: "http://192.168.1.2:18000" }) };
  assert.equal(resolveApiBaseUrl(options), "http://127.0.0.1:18000");
  override = "http://127.0.0.1:8000";
  assert.equal(resolveApiBaseUrl(options), override);
});

test("trial release and unknown environments never read development sources on any platform", () => {
  for (const envVersion of ["trial", "release", "", "unknown", undefined]) {
    for (const platform of ["devtools", "ios", "android"]) {
      let storageReads = 0, deviceReads = 0, localReads = 0;
      global.wx = {
        getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
        getDeviceInfo: () => { deviceReads++; return { platform }; },
        getStorageSync: key => { storageReads++; return key === "linkcv_local_debug_enabled" ? true : "http://127.0.0.1:8000"; },
      };
      assert.equal(resolveApiBaseUrl({ readLocalConfig: () => {
        localReads++;
        return { apiBaseUrl: "http://192.168.1.2:8000", devtoolsApiBaseUrl: "http://127.0.0.1:8000" };
      } }), "https://linkresume.cn");
      assert.deepEqual([storageReads, deviceReads, localReads], [0, 0, 0]);
    }
  }
});

test("trial and release preserve HTTPS ext config and reject HTTP despite developer overrides", () => {
  for (const envVersion of ["trial", "release"]) {
    let apiBaseUrl = "https://service.example.test/";
    global.wx = {
      getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
      getExtConfigSync: () => ({ apiBaseUrl }),
      getStorageSync: () => { throw new Error("must not read developer storage"); },
    };
    assert.equal(resolveApiBaseUrl(), "https://service.example.test");
    apiBaseUrl = "http://127.0.0.1:8000";
    assert.throws(resolveApiBaseUrl, /必须使用 HTTPS/);
  }
});
