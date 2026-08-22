const test = require("node:test");
const assert = require("node:assert/strict");

test("resume detail retry loads the same resume again", async () => {
  const servicePath = require.resolve("../services/resumes");
  const pagePath = require.resolve("../pages/resumes/detail");
  const previousService = require.cache[servicePath];
  const previousPage = global.Page;
  const previousWx = global.wx;
  const calls = [];
  let pageDefinition;

  require.cache[servicePath] = {
    exports: {
      getResume: async (id) => {
        calls.push(id);
        return { title: "示例简历", data: { basics: {}, sections: {} } };
      },
    },
  };
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = { setNavigationBarTitle() {} };

  try {
    delete require.cache[pagePath];
    require(pagePath);
    const page = {
      ...pageDefinition,
      data: { ...pageDefinition.data, resumeId: "resume-1" },
      setData(update) { Object.assign(this.data, update); },
    };

    await page.retryLoad();

    assert.deepEqual(calls, ["resume-1"]);
    assert.equal(page.data.loading, false);
    assert.equal(page.data.resume.title, "示例简历");
  } finally {
    delete require.cache[pagePath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
    global.Page = previousPage;
    global.wx = previousWx;
  }
});

test("direct launch waits for agreement before login or registration", async () => {
  const authPath = require.resolve("../services/auth");
  const pagePath = require.resolve("../pages/login");
  const previousAuth = require.cache[authPath];
  const previousPage = global.Page;
  const previousWx = global.wx;
  const relaunches = [];
  const toasts = [];
  let accepted = 0;
  let registrationCalls = 0;
  let pageDefinition;

  require.cache[authPath] = {
    exports: {
      acceptPrivacyAgreement() { accepted += 1; },
      getPrivacySetting: async () => ({
        supported: true,
        needAuthorization: false,
        privacyContractName: "《LinkCV 隐私保护指引》",
      }),
      hasAcceptedPrivacyAgreement: () => false,
      hasSession: () => false,
      getAccountStatus: async () => false,
      registerOrLogin: async () => { registrationCalls += 1; },
    },
  };
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {
    reLaunch: ({ url }) => relaunches.push(url),
    showToast: (options) => toasts.push(options.title),
  };

  try {
    delete require.cache[pagePath];
    require(pagePath);
    const page = {
      ...pageDefinition,
      data: { ...pageDefinition.data },
      setData(update) { Object.assign(this.data, update); },
    };

    page.onLoad({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.phase, "onboarding");
    assert.equal(page.data.privacyReady, true);
    assert.equal(page.data.accountStatusReady, true);
    assert.equal(page.data.accountRegistered, false);
    assert.equal(registrationCalls, 0);

    page.handlePrimaryAction();
    assert.deepEqual(toasts, ["请先阅读并勾选隐私保护指引"]);
    assert.equal(registrationCalls, 0);

    page.handleAgreementChange({ detail: { value: ["accepted"] } });
    await page.handlePrimaryAction();
    assert.equal(accepted, 1);
    assert.equal(registrationCalls, 1);
    assert.deepEqual(relaunches, ["/pages/resumes/index"]);
  } finally {
    delete require.cache[pagePath];
    if (previousAuth) require.cache[authPath] = previousAuth;
    else delete require.cache[authPath];
    global.Page = previousPage;
    global.wx = previousWx;
  }
});

test("direct launch shows login and never registers when the WeChat account exists", async () => {
  const authPath = require.resolve("../services/auth");
  const pagePath = require.resolve("../pages/login");
  const previousAuth = require.cache[authPath];
  const previousPage = global.Page;
  const previousWx = global.wx;
  let loginCalls = 0;
  let registrationCalls = 0;
  let pageDefinition;

  require.cache[authPath] = {
    exports: {
      acceptPrivacyAgreement() {},
      getPrivacySetting: async () => ({
        supported: true,
        needAuthorization: false,
        privacyContractName: "《LinkCV 隐私保护指引》",
      }),
      hasAcceptedPrivacyAgreement: () => true,
      hasSession: () => false,
      getAccountStatus: async () => true,
      loginExistingAccount: async () => { loginCalls += 1; },
      registerOrLogin: async () => { registrationCalls += 1; },
    },
  };
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = { reLaunch() {}, showToast() {} };

  try {
    delete require.cache[pagePath];
    require(pagePath);
    const page = {
      ...pageDefinition,
      data: { ...pageDefinition.data },
      setData(update) { Object.assign(this.data, update); },
    };

    page.onLoad({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.accountRegistered, true);

    await page.handlePrimaryAction();
    assert.equal(loginCalls, 1);
    assert.equal(registrationCalls, 0);
  } finally {
    delete require.cache[pagePath];
    if (previousAuth) require.cache[authPath] = previousAuth;
    else delete require.cache[authPath];
    global.Page = previousPage;
    global.wx = previousWx;
  }
});

test("scan confirmation enters the resume home page without an extra action", async () => {
  const authPath = require.resolve("../services/auth");
  const pagePath = require.resolve("../pages/login");
  const previousAuth = require.cache[authPath];
  const previousPage = global.Page;
  const previousWx = global.wx;
  const relaunches = [];
  const requests = [];
  let loginCalls = 0;
  let pageDefinition;

  require.cache[authPath] = {
    exports: {
      apiUrl: (path) => `http://127.0.0.1:8000${path}`,
      loginExistingAccount: async () => { loginCalls += 1; },
      wxLoginCode: async () => "wx-code",
    },
  };
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {
    reLaunch: ({ url }) => relaunches.push(url),
    request(options) {
      requests.push(options);
      queueMicrotask(() => options.success({ statusCode: 200, data: { ok: true } }));
    },
  };

  try {
    delete require.cache[pagePath];
    require(pagePath);
    const page = {
      ...pageDefinition,
      data: {
        ...pageDefinition.data,
        phase: "pending",
        scene: "login:fixture-scene",
      },
      setData(update) { Object.assign(this.data, update); },
    };

    await page.handleConfirm();

    assert.equal(loginCalls, 1);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].data, {
      scene: "login:fixture-scene",
      code: "wx-code",
      privacy_accepted: true,
    });
    assert.deepEqual(relaunches, ["/pages/resumes/index"]);
  } finally {
    delete require.cache[pagePath];
    if (previousAuth) require.cache[authPath] = previousAuth;
    else delete require.cache[authPath];
    global.Page = previousPage;
    global.wx = previousWx;
  }
});

test("an already confirmed scan resumes at the home page when a session exists", async () => {
  const authPath = require.resolve("../services/auth");
  const pagePath = require.resolve("../pages/login");
  const previousAuth = require.cache[authPath];
  const previousPage = global.Page;
  const previousWx = global.wx;
  const relaunches = [];
  let pageDefinition;

  require.cache[authPath] = {
    exports: {
      apiUrl: (path) => `http://127.0.0.1:8000${path}`,
      hasSession: () => true,
    },
  };
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {
    reLaunch: ({ url }) => relaunches.push(url),
    request(options) {
      queueMicrotask(() => options.success({
        statusCode: 200,
        data: { status: "success" },
      }));
    },
  };

  try {
    delete require.cache[pagePath];
    require(pagePath);
    const page = {
      ...pageDefinition,
      data: {
        ...pageDefinition.data,
        scene: "login:confirmed-scene",
      },
      setData(update) { Object.assign(this.data, update); },
    };

    page.loadStatus();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(relaunches, ["/pages/resumes/index"]);
  } finally {
    delete require.cache[pagePath];
    if (previousAuth) require.cache[authPath] = previousAuth;
    else delete require.cache[authPath];
    global.Page = previousPage;
    global.wx = previousWx;
  }
});
