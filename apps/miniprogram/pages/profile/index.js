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
    localAvatarPath: "",
    message: "",
  },

  onLoad() {
    this.refreshPage();
  },

  onShow() {
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
      localAvatarPath: "",
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
    this.setData({ loading: true, guest: false, message: "" });
    try {
      const profile = await account.getProfile();
      this.setData({
        loading: false,
        nickname: profile.nickname,
        serverNickname: profile.nickname,
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
    this.setData({ nickname: event.detail.value });
  },

  async handleSave() {
    if (!auth.hasSession()) {
      this.enterGuestMode();
      return;
    }
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      this.setData({ message: "昵称不能为空" });
      return;
    }
    if (this.data.saving || nickname === this.data.serverNickname) {
      this.setData({ message: "" });
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
      });
    } catch (error) {
      if (!auth.hasSession()) {
        this.enterGuestMode();
        return;
      }
      this.setData({
        saving: false,
        message: error.message || "昵称保存失败，请重试",
      });
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
