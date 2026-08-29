const auth = require("../../services/auth");
const account = require("../../services/account");
const { getStatusBarHeight } = require("../../utils/system");

const AVATAR_CACHE_PATH = () => `${wx.env.USER_DATA_PATH}/account-avatar`;

function inferAvatarMime(path) {
  if (/\.jpe?g(\?|$)/i.test(path)) return "image/jpeg";
  if (/\.webp(\?|$)/i.test(path)) return "image/webp";
  return "image/png";
}

function readAvatarAsDataUrl(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: "base64",
      success: (result) => resolve(`data:${inferAvatarMime(filePath)};base64,${result.data}`),
      fail: (result) => reject(new Error(result.errMsg || "读取头像失败")),
    });
  });
}

Page({
  data: {
    statusBarHeight: getStatusBarHeight(),
    loading: true,
    guest: false,
    saving: false,
    loggingOut: false,
    nickname: "",
    serverNickname: "",
    editingNickname: false,
    hasChanges: false,
    localAvatarPath: "",
    resumeCount: 0,
    chatCount: 0,
    message: "",
  },

  onLoad() {
    this.refreshPage();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    if (!auth.hasSession()) {
      this.enterGuestMode();
      return;
    }
    if (this.data.guest) this.loadProfile();
  },

  refreshPage() {
    if (!auth.hasSession()) {
      this.enterGuestMode();
      return;
    }
    this.loadProfile();
  },

  enterGuestMode() {
    this.setData({
      loading: false,
      guest: true,
      saving: false,
      loggingOut: false,
      nickname: "",
      serverNickname: "",
      editingNickname: false,
      hasChanges: false,
      localAvatarPath: "",
      resumeCount: 0,
      chatCount: 0,
      message: "",
    });
  },

  goLogin() {
    wx.navigateTo({
      url: `/pages/login/index?returnTo=${encodeURIComponent("/pages/profile/index")}`,
    });
  },

  async loadProfile() {
    if (!auth.hasSession()) {
      this.enterGuestMode();
      return;
    }
    this.setData({ loading: true, guest: false, editingNickname: false, message: "" });
    try {
      let resumeCount = 0;
      try {
        const resumes = require("../../services/resumes");
        if (typeof resumes.listResumes === "function") {
          const items = await resumes.listResumes();
          resumeCount = Array.isArray(items) ? items.length : 0;
        }
      } catch (e) {
        resumeCount = 0;
      }
      const profile = await account.getProfile();
      this.setData({
        loading: false,
        nickname: profile.nickname,
        serverNickname: profile.nickname,
        editingNickname: false,
        hasChanges: false,
        resumeCount,
        chatCount: 0,
      });
      if (profile.avatar_url) {
        try {
          const filePath = await account.downloadAvatar(AVATAR_CACHE_PATH());
          this.setData({ localAvatarPath: filePath });
        } catch (error) {
          // 头像下载失败不阻塞资料页；用户可重新选择头像。
        }
      } else {
        this.setData({ localAvatarPath: "" });
      }
    } catch (error) {
      if (!auth.hasSession()) {
        this.enterGuestMode();
        return;
      }
      this.setData({
        loading: false,
        message: error.message || "资料加载失败，请稍后重试",
      });
    }
  },

  async handleChooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.saving || !auth.hasSession()) return;
    this.setData({ saving: true, message: "" });
    try {
      const dataUrl = await readAvatarAsDataUrl(filePath);
      await account.uploadAvatarDataUrl(dataUrl, "avatar");
      this.setData({ saving: false, localAvatarPath: filePath });
      if (typeof wx.showToast === "function") {
        wx.showToast({ title: "头像已更新", icon: "success", duration: 1500 });
      }
    } catch (error) {
      if (!auth.hasSession()) {
        this.enterGuestMode();
        return;
      }
      this.setData({
        saving: false,
        message: error.message || "头像保存失败，请重试",
      });
    }
  },

  handleNicknameInput(event) {
    const nextNickname = event.detail.value;
    this.setData({
      nickname: nextNickname,
      hasChanges: nextNickname.trim() !== this.data.serverNickname,
      message: "",
    });
  },

  handleNicknameTap() {
    if (this.data.loading || this.data.saving || this.data.guest) return;
    if (!auth.hasSession()) {
      this.enterGuestMode();
      return;
    }
    this.setData({ editingNickname: true, message: "" });
  },

  async handleNicknameBlur(event) {
    const nextNickname = (event.detail && event.detail.value != null ? event.detail.value : this.data.nickname);
    this.setData({
      nickname: nextNickname,
      editingNickname: false,
      hasChanges: nextNickname.trim() !== this.data.serverNickname,
    });
    await this.handleSave();
  },

  async handleNicknameConfirm(event) {
    const nextNickname = (event.detail && event.detail.value != null ? event.detail.value : this.data.nickname);
    this.setData({
      nickname: nextNickname,
      editingNickname: false,
      hasChanges: nextNickname.trim() !== this.data.serverNickname,
    });
    await this.handleSave();
  },

  rollbackNickname(message) {
    this.setData({
      saving: false,
      nickname: this.data.serverNickname,
      editingNickname: false,
      hasChanges: false,
      message,
    });
  },

  async handleSave() {
    if (this.data.saving) return;
    if (!auth.hasSession()) {
      this.enterGuestMode();
      return;
    }
    this.setData({ editingNickname: false });
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      this.rollbackNickname("昵称不能为空");
      return;
    }
    if (nickname === this.data.serverNickname) {
      this.setData({ message: "", hasChanges: false });
      return;
    }
    this.setData({ saving: true, message: "" });
    try {
      const profile = await account.updateNickname(nickname);
      auth.updateStoredUser({ nickname: profile.nickname });
      this.setData({
        saving: false,
        nickname: profile.nickname,
        serverNickname: profile.nickname,
        editingNickname: false,
        hasChanges: false,
      });
      if (typeof wx.showToast === "function") {
        wx.showToast({ title: "修改已保存", icon: "success", duration: 1500 });
      }
    } catch (error) {
      if (!auth.hasSession()) {
        this.enterGuestMode();
        return;
      }
      this.rollbackNickname(error.message || "昵称保存失败，请重试");
    }
  },

  async handleLogout() {
    if (this.data.loggingOut || this.data.saving) return;
    this.setData({ loggingOut: true, message: "正在退出…" });
    try {
      await auth.logout();
    } catch (error) {
      if (auth.hasSession()) {
        this.setData({ loggingOut: false, message: error.message || "退出失败，请重试" });
        return;
      }
    }
    this.enterGuestMode();
  },
});
