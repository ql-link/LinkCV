const test = require("node:test");
const assert = require("node:assert/strict");

async function withProfilePage(mockedModules, wxMock, run) {
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
  const pagePath = require.resolve("../pages/profile");
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

test("profile page loads nickname and downloads existing avatar", async () => {
  const downloads = [];
  let finalState = null;
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "张三", avatar_url: "/api/miniprogram/account/avatar" }),
      downloadAvatar: async (filePath) => {
        downloads.push(filePath);
        return filePath;
      },
    },
    "../services/auth": {},
    "../utils/system": { getStatusBarHeight: () => 20 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    await page.loadProfile();
    finalState = { nickname: page.data.nickname, avatar: page.data.localAvatarPath };
  });

  assert.deepEqual(downloads, ["/user-data/account-avatar"]);
  assert.equal(finalState.nickname, "张三");
  assert.equal(finalState.avatar, "/user-data/account-avatar");
});

test("profile page uploads chosen avatar as data url", async () => {
  const uploads = [];
  let finalState = null;
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "张三", avatar_url: null }),
      downloadAvatar: async () => { throw new Error("not expected"); },
      uploadAvatarDataUrl: async (dataUrl, fileName) => {
        uploads.push({ dataUrl, fileName });
      },
    },
    "../services/auth": {},
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
    getFileSystemManager: () => ({
      readFile({ success }) { success({ data: "aGVsbG8=" }); },
    }),
  }, async (page) => {
    await page.loadProfile();
    await page.handleChooseAvatar({ detail: { avatarUrl: "http://tmp/wx-avatar.png" } });
    finalState = page.data.localAvatarPath;
  });

  assert.deepEqual(uploads, [{
    dataUrl: "data:image/png;base64,aGVsbG8=",
    fileName: "avatar",
  }]);
  assert.equal(finalState, "http://tmp/wx-avatar.png");
});

test("profile page saves nickname and syncs stored user", async () => {
  const patches = [];
  const navigations = [];
  let finalState = null;
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "微信用户abc", avatar_url: null }),
      downloadAvatar: async () => { throw new Error("not expected"); },
      updateNickname: async (nickname) => ({ nickname, avatar_url: null }),
    },
    "../services/auth": {
      updateStoredUser: (patch) => { patches.push(patch); },
    },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
    navigateBack() { navigations.push(true); },
  }, async (page) => {
    await page.loadProfile();

    page.handleNicknameInput({ detail: { value: "  张三  " } });
    await page.handleSave();

    finalState = { nickname: page.data.nickname, message: page.data.message };
  });

  assert.deepEqual(patches, [{ nickname: "张三" }]);
  assert.deepEqual(navigations, [true]);
  assert.equal(finalState.message, "");
});

test("profile page rejects empty nickname without calling api", async () => {
  const updates = [];
  let finalState = null;
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "微信用户abc", avatar_url: null }),
      downloadAvatar: async () => { throw new Error("not expected"); },
      updateNickname: async (nickname) => {
        updates.push(nickname);
        return { nickname, avatar_url: null };
      },
    },
    "../services/auth": {},
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
    navigateBack() {},
  }, async (page) => {
    await page.loadProfile();

    page.handleNicknameInput({ detail: { value: "   " } });
    await page.handleSave();

    finalState = page.data.message;
  });

  assert.deepEqual(updates, []);
  assert.equal(finalState, "昵称不能为空");
});
