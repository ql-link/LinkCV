const test = require("node:test");
const assert = require("node:assert/strict");
function loadPage(response = { statusCode: 200, data: { ok: true } }) {
  const storage = new Map();
  const calls = [];
  global.getApp = () => ({ globalData: { apiBaseUrl: "https://linkresume.example.test" } });
  global.wx = {
    getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    getWindowInfo: () => ({ statusBarHeight: 24 }),
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    login: ({ success }) => { calls.push("wx.login"); success({ code: "fictional-code" }); },
    request: (options) => { calls.push(options); options.success(response); },
  };
  let definition;
  global.Page = (value) => { definition = value; };
  for (const file of ["../services/auth", "../pages/account-confirm/index"]) delete require.cache[require.resolve(file)];
  require("../pages/account-confirm/index");
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  return { page, calls, storage };
}
test("scan does not log in or register; confirmation requires a deliberate user action", async () => {
  const { page, calls, storage } = loadPage();
  await page.onLoad({ scene: "del:" + "a".repeat(24) });
  assert.deepEqual(calls, []);
  await page.handleConfirm();
  assert.deepEqual(calls, []);
  page.handleAgreementChange({ detail: { value: ["accepted"] } });
  await page.handleConfirm();
  assert.equal(calls[0], "wx.login");
  assert.equal(calls[1].url, "https://linkresume.example.test/api/account/wechat/verification-confirm");
  assert.deepEqual(calls[1].data, { scene: "del:" + "a".repeat(24), code: "fictional-code" });
  assert.equal(calls.length, 2);
  assert.equal(page.data.phase, "confirmed");
  assert.equal(storage.has("linkresume_access_token"), false);
});
test("wrong identity stays unconfirmed and never creates an account", async () => {
  const { page, calls } = loadPage({ statusCode: 403, data: { error: "WECHAT_IDENTITY_MISMATCH" } });
  await page.onLoad({ scene: "del:" + "b".repeat(24) });
  page.handleAgreementChange({ detail: { value: ["accepted"] } });
  await page.handleConfirm();
  assert.equal(page.data.phase, "pending");
  assert.match(page.data.message, /微信身份不一致/);
  assert.equal(calls.length, 2);
});
test("malformed scenes and closing confirmation never request identity", async () => {
  const { page, calls } = loadPage();
  await page.onLoad({ scene: "not-an-account-action" });
  page.handleAgreementChange({ detail: { value: ["accepted"] } });
  await page.handleConfirm();
  assert.equal(page.data.phase, "error");
  page.handleClose();
  assert.deepEqual(calls, []);
});
