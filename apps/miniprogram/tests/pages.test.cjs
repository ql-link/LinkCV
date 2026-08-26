const test = require("node:test");
const assert = require("node:assert/strict");
const appConfig = require("../app.json");

async function withPage(pageRelativePath, mockedModules, wxMock, run) {
  const moduleCaches = Object.entries(mockedModules).map(([modulePath, exports]) => {
    const resolved = require.resolve(modulePath);
    const previous = require.cache[resolved];
    require.cache[resolved] = { exports };
    return [resolved, previous];
  });
  const previousPage = global.Page;
  const previousWx = global.wx;
  let pageDefinition;
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = wxMock;
  const pagePath = require.resolve(pageRelativePath);
  try {
    delete require.cache[pagePath];
    require(pagePath);
    const page = {
      ...pageDefinition,
      data: { ...pageDefinition.data },
      setData(update) { Object.assign(this.data, update); },
    };
    await run(page);
  } finally {
    delete require.cache[pagePath];
    for (const [resolved, previous] of moduleCaches) {
      if (previous) require.cache[resolved] = previous;
      else delete require.cache[resolved];
    }
    global.Page = previousPage;
    global.wx = previousWx;
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const privacySetting = async () => ({
  supported: true,
  needAuthorization: false,
  privacyContractName: "《LinkResume 隐私保护指引》",
});

test("app starts on resumes and exposes only resumes and profile tabs", () => {
  assert.equal(appConfig.pages[0], "pages/resumes/index");
  assert.deepEqual(appConfig.tabBar.list, [
    { pagePath: "pages/resumes/index", text: "简历" },
    { pagePath: "pages/profile/index", text: "我的" },
  ]);
  assert.equal(appConfig.pages.includes("pages/home/index"), false);
});

test("resume detail downloads, embeds and commits the selected preview version", async () => {
  const calls = [];
  const previewImages = [];
  let finalState = null;
  await withPage("../pages/resumes/detail", {
    "../services/resumes": {
      getResume: async (id) => { calls.push(["metadata", id]); return { pdf_version_id: "9" }; },
      downloadResumePreview: async (id, versionId, filePath) => {
        calls.push(["download", id, versionId, filePath]);
        return filePath;
      },
    },
    "../services/auth": {
      getCurrentUser: () => ({ id: "7" }),
    },
    "../services/resumePreviewCache": {
      getCachedResumePreview: async () => null,
      resumePreviewPath: () => "/user/resume-42-9.png",
      validateResumePreview: async (filePath) => { calls.push(["validate", filePath]); },
      commitResumePreview: async (...args) => { calls.push(["commit", ...args]); },
      invalidateResumePreview: async (...args) => { calls.push(["invalidate", ...args]); },
      removeFile: async () => {},
    },
  }, {
    setNavigationBarTitle() {},
    previewImage(options) { previewImages.push(options); },
  }, async (page) => {
    page.data.resumeId = "resume-1";
    await Promise.all([page.retryLoad(), page.retryLoad()]);

    page.handleImagePreview();

    await page.handlePreviewError();
    await page.handlePreviewError();
    finalState = { previewPath: page.data.previewPath, error: page.data.error, loading: page.data.loading };
  });

  assert.deepEqual(previewImages, [{
    current: "/user/resume-42-9.png",
    urls: ["/user/resume-42-9.png"],
  }]);
  assert.deepEqual(calls.slice(0, 4), [
    ["metadata", "resume-1"],
    ["download", "resume-1", "9", "/user/resume-42-9.png"],
    ["validate", "/user/resume-42-9.png"],
    ["commit", "7", "resume-1", "9", "/user/resume-42-9.png"],
  ]);
  assert.deepEqual(calls.slice(4, 9), [
    ["invalidate", "7", "resume-1"],
    ["metadata", "resume-1"],
    ["download", "resume-1", "9", "/user/resume-42-9.png"],
    ["validate", "/user/resume-42-9.png"],
    ["commit", "7", "resume-1", "9", "/user/resume-42-9.png"],
  ]);
  assert.equal(finalState.previewPath, "");
  assert.equal(finalState.error, "预览图无法显示，请重新加载");
});

test("login page stays unified and requires agreement before the user opts in", async () => {
  const accepted = [];
  const registrationCalls = [];
  const toasts = [];
  const switches = [];
  await withPage("../pages/login", {
    "../services/auth": {
      acceptPrivacyAgreement() { accepted.push(true); },
      getPrivacySetting: privacySetting,
      hasAcceptedPrivacyAgreement: () => false,
      hasSession: () => false,
      registerOrLogin: async () => { registrationCalls.push(true); },
    },
  }, {
    switchTab: ({ url }) => switches.push(url),
    showToast: (options) => toasts.push(options.title),
  }, async (page) => {
    page.onLoad();
    await flush();
    assert.equal(page.data.privacyReady, true);
    assert.equal(registrationCalls.length, 0);

    page.handlePrimaryAction();
    assert.equal(page.data.agreementActionHint, "请先勾选隐私保护指引后再继续");
    assert.equal(toasts.length, 0);
    assert.equal(registrationCalls.length, 0);

    page.handleAgreementChange({ detail: { value: ["accepted"] } });
    assert.equal(page.data.agreementActionHint, "");
    await page.handlePrimaryAction();
    assert.equal(accepted.length, 1);
  });

  assert.equal(registrationCalls.length, 1);
  assert.deepEqual(switches, ["/pages/resumes/index"]);
});

test("login page reuses one explicit action for existing and new accounts", async () => {
  const registrationCalls = [];
  const switches = [];
  await withPage("../pages/login", {
    "../services/auth": {
      acceptPrivacyAgreement() {},
      getPrivacySetting: privacySetting,
      hasAcceptedPrivacyAgreement: () => true,
      hasSession: () => false,
      registerOrLogin: async () => { registrationCalls.push(true); },
    },
  }, { switchTab: ({ url }) => switches.push(url), showToast() {} }, async (page) => {
    page.onLoad({ returnTo: encodeURIComponent("/pages/profile/index") });
    await flush();
    assert.equal(page.data.message, "让每一次投递更有底气 · 随时随地同步查阅");

    page.handleAgreementChange({ detail: { value: ["accepted"] } });
    await page.handlePrimaryAction();
  });

  assert.equal(registrationCalls.length, 1);
  assert.deepEqual(switches, ["/pages/profile/index"]);
});

test("login page lets the user dismiss back to the requested tab", async () => {
  const switches = [];
  await withPage("../pages/login", {
    "../services/auth": {
      getPrivacySetting: privacySetting,
      hasAcceptedPrivacyAgreement: () => false,
      hasSession: () => false,
    },
  }, {
    switchTab: ({ url }) => switches.push(url),
    showToast() {},
  }, async (page) => {
    page.onLoad();
    await flush();
    page.handleDismiss();
  });

  assert.deepEqual(switches, ["/pages/resumes/index"]);
});

test("login page sends an already logged-in user to the verified requested tab", async () => {
  const switches = [];
  await withPage("../pages/login", {
    "../services/auth": {
      hasSession: () => true,
      hasAcceptedPrivacyAgreement: () => true,
    },
  }, {
    switchTab: ({ url }) => switches.push(url),
  }, async (page) => {
    page.onLoad({ returnTo: encodeURIComponent("/pages/profile/index") });
  });

  assert.deepEqual(switches, ["/pages/profile/index"]);
});

test("login page forwards a scan scene to the confirm page without opening the login gate", async () => {
  const relaunches = [];
  await withPage("../pages/login", {
    "../services/auth": {
      hasSession: () => false,
    },
  }, {
    reLaunch: ({ url }) => relaunches.push(url),
    switchTab() { throw new Error("a scan must not enter resumes directly"); },
    showToast() {},
  }, async (page) => {
    page.onLoad({ scene: encodeURIComponent("login:from-qrcode") });
  });

  assert.deepEqual(relaunches, [`/pages/confirm/index?scene=${encodeURIComponent("login:from-qrcode")}`]);
});

test("confirm page confirms the web login and enters resumes without an extra action", async () => {
  const callOrder = [];
  const accepted = [];
  const requests = [];
  const switches = [];
  await withPage("../pages/confirm", {
    "../services/auth": {
      acceptPrivacyAgreement: () => { accepted.push(true); },
      apiUrl: (path) => `http://127.0.0.1:8000${path}`,
      loginExistingAccount: async () => { callOrder.push("miniprogram-login"); },
      wxLoginCode: async () => { callOrder.push("confirm-code"); return "wx-code"; },
    },
  }, {
    switchTab: ({ url }) => switches.push(url),
    request(options) {
      requests.push(options);
      callOrder.push("confirm");
      queueMicrotask(() => options.success({ statusCode: 200, data: { ok: true } }));
    },
  }, async (page) => {
    page.data.scene = "login:fixture-scene";
    page.data.phase = "pending";
    page.handleAgreementChange({ detail: { value: ["accepted"] } });
    await page.handleConfirm();
  });

  assert.deepEqual(callOrder, ["confirm-code", "confirm", "miniprogram-login"]);
  assert.deepEqual(accepted, [true]);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].data, {
    scene: "login:fixture-scene",
    code: "wx-code",
    privacy_accepted: true,
  });
  assert.deepEqual(switches, ["/pages/resumes/index"]);
});

test("confirm page cancels the web login and reports the result", async () => {
  const requests = [];
  let cancelledPhase = "";
  await withPage("../pages/confirm", {
    "../services/auth": {
      apiUrl: (path) => `http://127.0.0.1:8000${path}`,
    },
  }, {
    switchTab() {},
    request(options) {
      requests.push(options);
      queueMicrotask(() => options.success({ statusCode: 200, data: { ok: true } }));
    },
  }, async (page) => {
    page.data.scene = "login:fixture-scene";
    page.data.phase = "pending";
    await page.handleCancel();
    cancelledPhase = page.data.phase;
  });

  assert.equal(requests.length, 1);
  assert.equal(cancelledPhase, "cancelled");
});

test("confirm page returns an already confirmed scan to resumes when a session exists", async () => {
  const switches = [];
  await withPage("../pages/confirm", {
    "../services/auth": {
      apiUrl: (path) => `http://127.0.0.1:8000${path}`,
      hasSession: () => true,
    },
  }, {
    switchTab: ({ url }) => switches.push(url),
    request(options) {
      queueMicrotask(() => options.success({
        statusCode: 200,
        data: { status: "success" },
      }));
    },
  }, async (page) => {
    page.data.scene = "login:confirmed-scene";
    page.loadStatus();
    await flush();
  });

  assert.deepEqual(switches, ["/pages/resumes/index"]);
});

test("confirm page without a scene falls back to the resumes tab", async () => {
  const switches = [];
  await withPage("../pages/confirm", {
    "../services/auth": {},
  }, {
    switchTab: ({ url }) => switches.push(url),
    request() { throw new Error("no request expected"); },
  }, async (page) => {
    page.onLoad({});
  });

  assert.deepEqual(switches, ["/pages/resumes/index"]);
});

test("resumes page shows a dismissible login guide instead of forcing login", async () => {
  const navigations = [];
  let guestState = null;
  let loadingState = null;
  await withPage("../pages/resumes", {
    "../services/auth": {
      hasSession: () => false,
      ensureSession: async () => {
        throw new Error("no session request expected in guest mode");
      },
    },
    "../services/resumes": {
      listResumes: async () => {
        throw new Error("no resume request expected in guest mode");
      },
    },
  }, {
    navigateTo: ({ url }) => navigations.push(url),
  }, async (page) => {
    page.onLoad();
    guestState = page.data.guest;
    loadingState = page.data.loading;

    page.goLogin();
  });

  assert.equal(guestState, true);
  assert.equal(loadingState, false);
  assert.deepEqual(navigations, ["/pages/login/index?returnTo=%2Fpages%2Fresumes%2Findex"]);
});

test("resumes page returns to the login guide when recovery fails without a session", async () => {
  let finalState = null;
  await withPage("../pages/resumes", {
    "../services/auth": {
      hasSession: () => false,
      ensureSession: async () => { throw Object.assign(new Error("会话失效"), { code: "SESSION_REQUIRED" }); },
    },
    "../services/resumes": {
      listResumes: async () => [],
    },
  }, { navigateTo() {} }, async (page) => {
    page.data.guest = false;
    await page.loadPage();
    finalState = { guest: page.data.guest, loading: page.data.loading, error: page.data.error };
  });

  assert.equal(finalState.guest, true);
  assert.equal(finalState.loading, false);
  assert.equal(finalState.error, "");
});

test("resumes page keeps the error state for network failures while logged in", async () => {
  let finalState = null;
  await withPage("../pages/resumes", {
    "../services/auth": {
      hasSession: () => true,
      ensureSession: async () => ({ nickname: "张三" }),
    },
    "../services/resumes": {
      listResumes: async () => { throw new Error("网络异常"); },
    },
  }, { navigateTo() {} }, async (page) => {
    await page.loadPage();
    finalState = { guest: page.data.guest, error: page.data.error };
  });

  assert.equal(finalState.guest, false);
  assert.equal(finalState.error, "网络异常");
});

test("resumes page lists resumes and populates preview thumbnail from cache", async () => {
  let finalItems = null;
  await withPage("../pages/resumes", {
    "../services/auth": {
      hasSession: () => true,
      ensureSession: async () => ({ id: "u1", nickname: "张三" }),
    },
    "../services/resumes": {
      listResumes: async () => [
        { id: "r1", title: "前端工程师", updated_at: "2026-08-26T10:00:00Z", pdf_version_id: "v1" },
      ],
    },
    "../services/resumePreviewCache": {
      getCachedResumePreview: async (userId, resumeId, versionId) => {
        if (userId === "u1" && resumeId === "r1" && versionId === "v1") {
          return "/tmp/cached-preview.png";
        }
        return null;
      },
      resumePreviewPath: () => "/tmp/fallback.png",
    },
  }, { navigateTo() {} }, async (page) => {
    await page.loadPage();
    await page.prefetchPreviews({ id: "u1" }, page.data.items);
    finalItems = page.data.items;
  });

  assert.equal(finalItems.length, 1);
  assert.equal(finalItems[0].title, "前端工程师");
  assert.equal(finalItems[0].previewUrl, "/tmp/cached-preview.png");
});

test("resumes page handles onPullDownRefresh silently and stops pull down refresh", async () => {
  let stopped = false;
  let loadingHistory = [];
  await withPage("../pages/resumes", {
    "../services/auth": {
      hasSession: () => true,
      ensureSession: async () => ({ id: "u1", nickname: "张三" }),
    },
    "../services/resumes": {
      listResumes: async () => [
        { id: "r1", title: "前端工程师", updated_at: "2026-08-26T10:00:00Z", pdf_version_id: "v1" },
      ],
    },
    "../services/resumePreviewCache": {
      getCachedResumePreview: async () => null,
      resumePreviewPath: () => "/tmp/fallback.png",
    },
  }, {
    stopPullDownRefresh: () => { stopped = true; },
  }, async (page) => {
    // first regular load
    await page.loadPage();
    page.data.items[0].previewUrl = "/tmp/cached-preview.png";

    // trigger pull down refresh
    const promise = page.onPullDownRefresh();
    loadingHistory.push(page.data.loading);
    await promise;
  });

  assert.equal(stopped, true);
  assert.equal(loadingHistory[0], false, "pull down refresh must remain silent without full-page loading flip");
});

test("profile tab shows a guest state without requesting account data", async () => {
  const navigations = [];
  await withPage("../pages/profile", {
    "../services/auth": {
      hasSession: () => false,
    },
    "../services/account": {
      getProfile: async () => { throw new Error("profile request must not run"); },
    },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
    navigateTo: ({ url }) => navigations.push(url),
  }, async (page) => {
    page.onLoad();
    page.onShow();
    assert.equal(page.data.guest, true);
    assert.equal(page.data.loading, false);
    page.goLogin();
  });

  assert.deepEqual(navigations, ["/pages/login/index?returnTo=%2Fpages%2Fprofile%2Findex"]);
});
