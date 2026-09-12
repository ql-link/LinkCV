const test = require("node:test");
const assert = require("node:assert/strict");

async function withProfilePage(mockedModules, wxMock, run) {
  const mergedModules = {
    "../services/resumes": { listResumes: async () => [] },
    ...mockedModules,
  };
  const moduleCaches = Object.entries(mergedModules).map(([modulePath, exports]) => {
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
    "../services/resumes": {
      listResumes: async () => [{ id: "res_1" }, { id: "res_2" }],
    },
    "../services/auth": { hasSession: () => true },
    "../utils/system": { getStatusBarHeight: () => 20 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    await page.loadProfile();
    finalState = {
      nickname: page.data.nickname,
      avatar: page.data.localAvatarPath,
      resumeCount: page.data.resumeCount,
      chatCount: page.data.chatCount,
    };
  });

  assert.deepEqual(downloads, ["/user-data/account-avatar"]);
  assert.equal(finalState.nickname, "张三");
  assert.equal(finalState.avatar, "/user-data/account-avatar");
  assert.equal(finalState.resumeCount, 2);
  assert.equal(finalState.chatCount, 0);
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
    "../services/auth": { hasSession: () => true },
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

test("profile nickname switches to a focused edit state and reload resets the draft", async () => {
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "张三", avatar_url: null }),
    },
    "../services/auth": { hasSession: () => true },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    await page.loadProfile();
    assert.equal(page.data.editingNickname, false);

    page.handleNicknameTap();
    assert.equal(page.data.editingNickname, true);

    page.handleNicknameInput({ detail: { value: "  李四  " } });
    await page.loadProfile();
    assert.deepEqual({
      editingNickname: page.data.editingNickname,
      nickname: page.data.nickname,
      hasChanges: page.data.hasChanges,
    }, {
      editingNickname: false,
      nickname: "张三",
      hasChanges: false,
    });
  });
});

test("profile nickname cannot be edited before the persisted profile loads", async () => {
  await withProfilePage({
    "../services/account": {},
    "../services/auth": { hasSession: () => true },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    assert.equal(page.data.loading, true);
    assert.equal(page.data.serverNickname, "");

    page.handleNicknameTap();

    assert.equal(page.data.editingNickname, false);
  });
});

test("profile page saves nickname on confirm and syncs stored user", async () => {
  const patches = [];
  const toasts = [];
  let finalState = null;
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "微信用户abc", avatar_url: null }),
      downloadAvatar: async () => { throw new Error("not expected"); },
      updateNickname: async (nickname) => ({ nickname, avatar_url: null }),
    },
    "../services/auth": {
      hasSession: () => true,
      updateStoredUser: (patch) => { patches.push(patch); },
    },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
    showToast: (options) => toasts.push(options),
  }, async (page) => {
    await page.loadProfile();

    page.handleNicknameTap();
    await page.handleNicknameConfirm({ detail: { value: "  张三  " } });

    finalState = {
      nickname: page.data.nickname,
      serverNickname: page.data.serverNickname,
      editingNickname: page.data.editingNickname,
      hasChanges: page.data.hasChanges,
      message: page.data.message,
    };
  });

  assert.deepEqual(patches, [{ nickname: "张三" }]);
  assert.deepEqual(toasts, [{ title: "修改已保存", icon: "success", duration: 1500 }]);
  assert.deepEqual(finalState, {
    nickname: "张三",
    serverNickname: "张三",
    editingNickname: false,
    hasChanges: false,
    message: "",
  });
});

test("profile page saves nickname on blur", async () => {
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
    "../services/auth": {
      hasSession: () => true,
      updateStoredUser: () => {},
    },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    await page.loadProfile();
    page.handleNicknameTap();
    await page.handleNicknameBlur({ detail: { value: "  李四  " } });
    finalState = {
      nickname: page.data.nickname,
      serverNickname: page.data.serverNickname,
      editingNickname: page.data.editingNickname,
      hasChanges: page.data.hasChanges,
    };
  });

  assert.deepEqual(updates, ["李四"]);
  assert.deepEqual(finalState, {
    nickname: "李四",
    serverNickname: "李四",
    editingNickname: false,
    hasChanges: false,
  });
});

test("profile nickname confirm and blur send at most one update while saving", async () => {
  const updates = [];
  let resolveUpdate;
  const pendingUpdate = new Promise((resolve) => { resolveUpdate = resolve; });
  let finalState = null;
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "微信用户abc", avatar_url: null }),
      downloadAvatar: async () => { throw new Error("not expected"); },
      updateNickname: async (nickname) => {
        updates.push(nickname);
        return pendingUpdate;
      },
    },
    "../services/auth": {
      hasSession: () => true,
      updateStoredUser: () => {},
    },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    await page.loadProfile();
    page.handleNicknameTap();

    const confirmPromise = page.handleNicknameConfirm({ detail: { value: "李四" } });
    const blurPromise = page.handleNicknameBlur({ detail: { value: "李四" } });
    assert.deepEqual(updates, ["李四"]);

    resolveUpdate({ nickname: "李四", avatar_url: null });
    await Promise.all([confirmPromise, blurPromise]);
    finalState = { saving: page.data.saving, hasChanges: page.data.hasChanges };
  });

  assert.deepEqual(updates, ["李四"]);
  assert.deepEqual(finalState, { saving: false, hasChanges: false });
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
    "../services/auth": { hasSession: () => true },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    await page.loadProfile();

    page.handleNicknameTap();
    await page.handleNicknameConfirm({ detail: { value: "   " } });

    finalState = {
      nickname: page.data.nickname,
      serverNickname: page.data.serverNickname,
      message: page.data.message,
      editingNickname: page.data.editingNickname,
      hasChanges: page.data.hasChanges,
      saving: page.data.saving,
    };
  });

  assert.deepEqual(updates, []);
  assert.deepEqual(finalState, {
    nickname: "微信用户abc",
    serverNickname: "微信用户abc",
    message: "昵称不能为空",
    editingNickname: false,
    hasChanges: false,
    saving: false,
  });
});

test("profile page rolls back nickname when update fails and allows editing again", async () => {
  const updates = [];
  let finalState = null;
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "微信用户abc", avatar_url: null }),
      downloadAvatar: async () => { throw new Error("not expected"); },
      updateNickname: async (nickname) => {
        updates.push(nickname);
        throw new Error("网络暂时不可用");
      },
    },
    "../services/auth": { hasSession: () => true },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    await page.loadProfile();
    page.handleNicknameTap();
    await page.handleNicknameConfirm({ detail: { value: "李四" } });

    finalState = {
      nickname: page.data.nickname,
      serverNickname: page.data.serverNickname,
      message: page.data.message,
      editingNickname: page.data.editingNickname,
      hasChanges: page.data.hasChanges,
      saving: page.data.saving,
    };
    page.handleNicknameTap();
    finalState.editingAfterRetry = page.data.editingNickname;
  });

  assert.deepEqual(updates, ["李四"]);
  assert.deepEqual(finalState, {
    nickname: "微信用户abc",
    serverNickname: "微信用户abc",
    message: "网络暂时不可用",
    editingNickname: false,
    hasChanges: false,
    saving: false,
    editingAfterRetry: true,
  });
});

test("profile tab logs out and returns to its guest state", async () => {
  let active = true;
  let logoutCalls = 0;
  let finalState = null;
  await withProfilePage({
    "../services/account": {
      getProfile: async () => ({ nickname: "张三", avatar_url: null }),
      downloadAvatar: async () => { throw new Error("not expected"); },
    },
    "../services/auth": {
      hasSession: () => active,
      logout: async () => { logoutCalls += 1; active = false; },
    },
    "../utils/system": { getStatusBarHeight: () => 0 },
  }, {
    env: { USER_DATA_PATH: "/user-data" },
  }, async (page) => {
    await page.loadProfile();
    page.handleNicknameTap();
    await page.handleLogout();
    finalState = {
      guest: page.data.guest,
      loading: page.data.loading,
      editingNickname: page.data.editingNickname,
    };
  });

  assert.equal(logoutCalls, 1);
  assert.deepEqual(finalState, { guest: true, loading: false, editingNickname: false });
});
