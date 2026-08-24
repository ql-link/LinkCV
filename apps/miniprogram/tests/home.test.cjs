const test = require("node:test");
const assert = require("node:assert/strict");

async function withHomePage(authMock, wxMock, run) {
  const authPath = require.resolve("../services/auth");
  const previousAuth = require.cache[authPath];
  const previousPage = global.Page;
  const previousWx = global.wx;
  let pageDefinition;
  require.cache[authPath] = { exports: authMock };
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = wxMock;
  const pagePath = require.resolve("../pages/home");
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
    if (previousAuth) require.cache[authPath] = previousAuth;
    else delete require.cache[authPath];
    global.Page = previousPage;
    global.wx = previousWx;
  }
}

test("guest home launch performs no identity or network calls", async () => {
  let loggedInState = null;
  await withHomePage(
    { hasSession: () => false },
    {
      navigateTo() { throw new Error("navigateTo not expected on load"); },
      switchTab() { throw new Error("switchTab not expected on load"); },
      reLaunch() { throw new Error("reLaunch not expected on load"); },
      request() { throw new Error("no network call expected on the guest home"); },
      login() { throw new Error("wx.login must not be called on the guest home"); },
    },
    async (page) => {
      page.onLoad({});
      page.onShow();
      loggedInState = page.data.loggedIn;
    },
  );

  assert.equal(loggedInState, false);
});

test("home forwards a scan scene to the confirm page instead of the login gate", async () => {
  const relaunches = [];
  await withHomePage(
    { hasSession: () => false },
    {
      reLaunch: ({ url }) => relaunches.push(url),
      navigateTo() { throw new Error("guest login gate must not open for a scan"); },
      switchTab() { throw new Error("switchTab not expected for a scan"); },
      request() { throw new Error("no network call expected"); },
    },
    async (page) => {
      page.onLoad({ scene: encodeURIComponent("login:abc-123") });
    },
  );

  assert.deepEqual(relaunches, [`/pages/confirm/index?scene=${encodeURIComponent("login:abc-123")}`]);
});

test("home primary action opens the login page for guests", async () => {
  const navigations = [];
  await withHomePage(
    { hasSession: () => false },
    {
      navigateTo: ({ url }) => navigations.push(url),
      switchTab() { throw new Error("guests cannot switch to resumes"); },
      request() { throw new Error("no network call expected"); },
    },
    async (page) => {
      page.onLoad({});
      page.handlePrimaryAction();
    },
  );

  assert.deepEqual(navigations, ["/pages/login/index"]);
});

test("home primary action opens resumes directly when logged in", async () => {
  const switches = [];
  let loggedInStateAfterShow = null;
  await withHomePage(
    { hasSession: () => true },
    {
      switchTab: ({ url }) => switches.push(url),
      navigateTo() { throw new Error("logged-in users must not be asked to log in again"); },
      request() { throw new Error("no network call expected"); },
    },
    async (page) => {
      page.onLoad({});
      page.handlePrimaryAction();
    },
  );

  await withHomePage(
    { hasSession: () => false },
    {
      switchTab() { throw new Error("switchTab not expected"); },
      request() { throw new Error("no network call expected"); },
    },
    async (page) => {
      page.onShow();
      loggedInStateAfterShow = page.data.loggedIn;
    },
  );

  assert.deepEqual(switches, ["/pages/resumes/index"]);
  assert.equal(loggedInStateAfterShow, false);
});
