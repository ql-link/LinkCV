const test = require("node:test");
const assert = require("node:assert/strict");

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
  privacyContractName: "《LinkCV 隐私保护指引》",
});

test("resume detail retry loads the same resume again", async () => {
  const calls = [];
  await withPage("../pages/resumes/detail", {
    "../services/resumes": {
      getResume: async (id) => {
        calls.push(id);
        return { title: "示例简历", data: { basics: {}, sections: {} } };
      },
    },
  }, { setNavigationBarTitle() {} }, async (page) => {
    page.data.resumeId = "resume-1";
    await page.retryLoad();
  });

  assert.deepEqual(calls, ["resume-1"]);
});

test("login page requires agreement before registering after the user opts in", async () => {
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
      getAccountStatus: async () => false,
      registerOrLogin: async () => { registrationCalls.push(true); },
    },
  }, {
    switchTab: ({ url }) => switches.push(url),
    showToast: (options) => toasts.push(options.title),
  }, async (page) => {
    page.onLoad();
    await flush();
    assert.equal(page.data.privacyReady, true);
    assert.equal(page.data.accountStatusReady, true);
    assert.equal(page.data.accountRegistered, false);
    assert.equal(registrationCalls.length, 0);

    page.handlePrimaryAction();
    assert.deepEqual(toasts, ["请先阅读并勾选隐私保护指引"]);
    assert.equal(registrationCalls.length, 0);

    page.handleAgreementChange({ detail: { value: ["accepted"] } });
    await page.handlePrimaryAction();
    assert.equal(accepted.length, 1);
  });

  assert.equal(registrationCalls.length, 1);
  assert.deepEqual(switches, ["/pages/resumes/index"]);
});

test("login page logs into an existing account and never registers", async () => {
  const loginCalls = [];
  const registrationCalls = [];
  await withPage("../pages/login", {
    "../services/auth": {
      acceptPrivacyAgreement() {},
      getPrivacySetting: privacySetting,
      hasAcceptedPrivacyAgreement: () => true,
      hasSession: () => false,
      getAccountStatus: async () => true,
      loginExistingAccount: async () => { loginCalls.push(true); },
      registerOrLogin: async () => { registrationCalls.push(true); },
    },
  }, { switchTab() {}, showToast() {} }, async (page) => {
    page.onLoad();
    await flush();
    assert.equal(page.data.accountRegistered, true);

    page.handleAgreementChange({ detail: { value: ["accepted"] } });
    await page.handlePrimaryAction();
  });

  assert.equal(loginCalls.length, 1);
  assert.equal(registrationCalls.length, 0);
});

test("login page lets the user dismiss back to the guest home", async () => {
  const switches = [];
  await withPage("../pages/login", {
    "../services/auth": {
      getPrivacySetting: privacySetting,
      hasAcceptedPrivacyAgreement: () => false,
      hasSession: () => false,
      getAccountStatus: async () => false,
    },
  }, {
    switchTab: ({ url }) => switches.push(url),
    showToast() {},
  }, async (page) => {
    page.onLoad();
    await flush();
    page.handleDismiss();
  });

  assert.deepEqual(switches, ["/pages/home/index"]);
});

test("login page sends an already logged-in user straight to resumes", async () => {
  const switches = [];
  await withPage("../pages/login", {
    "../services/auth": { hasSession: () => true },
  }, {
    switchTab: ({ url }) => switches.push(url),
  }, async (page) => {
    page.onLoad();
  });

  assert.deepEqual(switches, ["/pages/resumes/index"]);
});

test("login page forwards a scan scene to the confirm page without opening the login gate", async () => {
  const relaunches = [];
  const accountStatusCalls = [];
  await withPage("../pages/login", {
    "../services/auth": {
      hasSession: () => false,
      getAccountStatus: async () => {
        accountStatusCalls.push(true);
        return false;
      },
    },
  }, {
    reLaunch: ({ url }) => relaunches.push(url),
    switchTab() { throw new Error("a scan must not enter resumes directly"); },
    showToast() {},
  }, async (page) => {
    page.onLoad({ scene: encodeURIComponent("login:from-qrcode") });
  });

  assert.deepEqual(relaunches, [`/pages/confirm/index?scene=${encodeURIComponent("login:from-qrcode")}`]);
  assert.equal(accountStatusCalls.length, 0);
});

test("confirm page confirms the web login and enters resumes without an extra action", async () => {
  const loginCalls = [];
  const requests = [];
  const switches = [];
  await withPage("../pages/confirm", {
    "../services/auth": {
      apiUrl: (path) => `http://127.0.0.1:8000${path}`,
      loginExistingAccount: async () => { loginCalls.push(true); },
      wxLoginCode: async () => "wx-code",
    },
  }, {
    switchTab: ({ url }) => switches.push(url),
    request(options) {
      requests.push(options);
      queueMicrotask(() => options.success({ statusCode: 200, data: { ok: true } }));
    },
  }, async (page) => {
    page.data.scene = "login:fixture-scene";
    page.data.phase = "pending";
    page.handleAgreementChange({ detail: { value: ["accepted"] } });
    await page.handleConfirm();
  });

  assert.equal(loginCalls.length, 1);
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

test("confirm page without a scene falls back to the guest home", async () => {
  const switches = [];
  await withPage("../pages/confirm", {
    "../services/auth": {},
  }, {
    switchTab: ({ url }) => switches.push(url),
    request() { throw new Error("no request expected"); },
  }, async (page) => {
    page.onLoad({});
  });

  assert.deepEqual(switches, ["/pages/home/index"]);
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
  assert.deepEqual(navigations, ["/pages/login/index"]);
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
