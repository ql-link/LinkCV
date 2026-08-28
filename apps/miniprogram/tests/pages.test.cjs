const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const appConfig = require("../app.json");
const resumesPageConfig = require("../pages/resumes/index.json");

const profileTemplate = fs.readFileSync(path.join(__dirname, "../pages/profile/index.wxml"), "utf8");
const demoDetailScript = fs.readFileSync(path.join(__dirname, "../pages/resumes/detail.js"), "utf8");
const demoDetailTemplate = fs.readFileSync(path.join(__dirname, "../pages/resumes/detail.wxml"), "utf8");

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
  assert.equal(resumesPageConfig.disableScroll, true);
  assert.equal(resumesPageConfig.enablePullDownRefresh, false);
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

test("confirm page keeps non-admin mini-program errors in the error state", async () => {
  for (const variant of [
    { code: "ACCOUNT_DISABLED", message: "ACCOUNT_DISABLED" },
    { code: "NETWORK_ERROR", message: "网络异常" },
  ]) {
    const switches = [];
    let finalState = null;

    await withPage("../pages/confirm", {
      "../services/auth": {
        acceptPrivacyAgreement() {},
        apiUrl: (path) => `http://127.0.0.1:8000${path}`,
        loginExistingAccount: async () => {
          throw Object.assign(new Error(variant.message), { code: variant.code });
        },
        wxLoginCode: async () => "wx-code",
      },
    }, {
      switchTab: ({ url }) => switches.push(url),
      request(options) {
        queueMicrotask(() => options.success({ statusCode: 200, data: { ok: true } }));
      },
    }, async (page) => {
      page.data.scene = "login:fixture-scene";
      page.data.phase = "pending";
      page.data.agreementAccepted = true;
      await page.handleConfirm();
      finalState = {
        submitting: page.data.submitting,
        phase: page.data.phase,
        message: page.data.message,
      };
    });

    assert.deepEqual(switches, []);
    assert.deepEqual(finalState, {
      submitting: false,
      phase: "error",
      message: variant.message,
    });
  }
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

test("resumes page shows one static demo card without authentication or resume requests", async () => {
  let authenticationRequests = 0;
  let resumeRequests = 0;
  await withPage("../pages/resumes", {
    "../services/auth": {
      hasSession: () => false,
      ensureSession: async () => {
        authenticationRequests += 1;
        throw new Error("no session request expected in guest mode");
      },
    },
    "../services/resumes": {
      listResumes: async () => {
        resumeRequests += 1;
        throw new Error("no resume request expected in guest mode");
      },
    },
  }, {}, async (page) => {
    page.onLoad();
    page.onShow();
    await page.handleRefresherRefresh();

    assert.equal(page.data.guest, true);
    assert.equal(page.data.loading, false);
    assert.equal(page.data.refresherTriggered, false);
    assert.equal(page.data.items.length, 1);
    assert.equal(page.data.items[0].id, "__linkresume_demo_resume__");
    assert.equal(page.data.items[0].title, "林知遥的简历");
    assert.equal(page.data.items[0].demoLabel, "示例简历 · 内容为虚构信息");
    assert.equal(page.data.items[0].isDemo, true);
  });

  assert.equal(authenticationRequests, 0);
  assert.equal(resumeRequests, 0);
});

test("demo resume detail is fully local and does not call auth, cache or resume APIs", async () => {
  let authCalls = 0;
  let cacheCalls = 0;
  let resumeApiCalls = 0;
  const navigationTitles = [];
  await withPage("../pages/resumes/detail", {
    "../services/auth": {
      getCurrentUser: () => {
        authCalls += 1;
        throw new Error("demo detail must not inspect the session");
      },
    },
    "../services/resumes": {
      getResume: async () => {
        resumeApiCalls += 1;
        throw new Error("demo detail must not request resume metadata");
      },
      downloadResumePreview: async () => {
        resumeApiCalls += 1;
        throw new Error("demo detail must not download a preview");
      },
    },
    "../services/resumePreviewCache": {
      getCachedResumePreview: async () => {
        cacheCalls += 1;
        return null;
      },
      invalidateResumePreview: async () => { cacheCalls += 1; },
      resumePreviewPath: () => { cacheCalls += 1; return "/tmp/demo.png"; },
    },
  }, {
    setNavigationBarTitle: ({ title }) => navigationTitles.push(title),
    previewImage() { throw new Error("demo detail has no image preview"); },
  }, async (page) => {
    page.onLoad({ id: "__linkresume_demo_resume__" });
    await page.retryLoad();
    await page.handlePreviewError();

    assert.equal(page.data.loading, false);
    assert.equal(page.data.error, "");
    assert.equal(page.data.isDemo, true);
    assert.equal(page.data.previewPath, "");
    assert.equal(page.data.demoResume.name, "林知遥");
    assert.equal(page.data.demoResume.email, "lin.xxx@example.com");
    assert.equal(page.data.demoResume.phone, "138 XXXX XXXX");
    assert.equal(page.data.demoResume.experience.length, 2);
    assert.equal(page.data.demoResume.projects.length, 2);
  });

  assert.equal(authCalls, 0);
  assert.equal(cacheCalls, 0);
  assert.equal(resumeApiCalls, 0);
  assert.deepEqual(navigationTitles, ["示例简历", "示例简历"]);
});

test("resumes page returns to the static demo when recovery fails without a session", async () => {
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
    finalState = {
      guest: page.data.guest,
      loading: page.data.loading,
      error: page.data.error,
      items: page.data.items,
    };
  });

  assert.equal(finalState.guest, true);
  assert.equal(finalState.loading, false);
  assert.equal(finalState.error, "");
  assert.equal(finalState.items.length, 1);
  assert.equal(finalState.items[0].isDemo, true);
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
        { id: "__linkresume_demo_resume__", title: "示例简历 · 内容为虚构信息", isDemo: true, pdf_version_id: "demo" },
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

test("resumes page handles inner refresher silently and resets refresher state", async () => {
  let resolveRefresh;
  let finalRefresherTriggered;
  let finalLoading;
  const refreshResult = new Promise((resolve) => { resolveRefresh = resolve; });
  await withPage("../pages/resumes", {
    "../services/auth": {
      hasSession: () => true,
      ensureSession: async () => ({ id: "u1", nickname: "张三" }),
    },
    "../services/resumes": {
      listResumes: async () => refreshResult,
    },
    "../services/resumePreviewCache": {
      getCachedResumePreview: async () => null,
      resumePreviewPath: () => "/tmp/fallback.png",
    },
  }, {}, async (page) => {
    page.data.loading = false;
    page.data.items = [{ id: "r1", title: "前端工程师", updatedAtLabel: "刚刚" }];

    const promise = page.handleRefresherRefresh();
    assert.equal(page.data.refresherTriggered, true);
    assert.equal(page.data.loading, false, "inner refresher must remain silent without full-page loading flip");
    resolveRefresh([
      { id: "r1", title: "前端工程师", updated_at: "2026-08-26T10:00:00Z" },
    ]);
    await promise;
    finalRefresherTriggered = page.data.refresherTriggered;
    finalLoading = page.data.loading;
  });

  assert.equal(finalRefresherTriggered, false);
  assert.equal(finalLoading, false);
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

test("profile template keeps the avatar as the only guest login trigger", () => {
  assert.match(profileTemplate, /class="avatar-round guest-avatar"[^>]*bindtap="goLogin"/);
  assert.doesNotMatch(profileTemplate, /微信登录 \/ 注册/);
  assert.doesNotMatch(profileTemplate, /class="profile-info" bindtap="goLogin"/);
  assert.doesNotMatch(profileTemplate, /class="setting-row" bindtap=/);
  assert.doesNotMatch(profileTemplate, /class="arrow-icon" wx:if="\{\{guest\}\}"/);
  assert.match(profileTemplate, /class="btn-group" wx:if="\{\{!guest &&/);
  assert.match(profileTemplate, /bindtap="handleSave"/);
});

test("demo resume contact details stay visibly fictional and the disclaimer remains", () => {
  assert.match(demoDetailScript, /email: "lin\.xxx@example\.com"/);
  assert.match(demoDetailScript, /phone: "138 XXXX XXXX"/);
  assert.match(demoDetailTemplate, /示例简历 · 内容为虚构信息/);
  assert.match(demoDetailTemplate, /以上姓名、联系方式与经历均为虚构，仅用于示例浏览。/);
});
