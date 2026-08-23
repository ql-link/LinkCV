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
    saving: false,
    nickname: "",
    serverNickname: "",
    localAvatarPath: "",
    message: "",
  },

  onLoad() {
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true, message: "" });
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
      }
    } catch (error) {
      this.setData({
        loading: false,
        message: error.message || "资料加载失败，请稍后重试",
      });
    }
  },

  async handleChooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.saving) return;
    this.setData({ saving: true, message: "" });
    try {
      const dataUrl = await readAvatarAsDataUrl(filePath);
      await account.uploadAvatarDataUrl(dataUrl, "avatar");
      this.setData({ saving: false, localAvatarPath: filePath });
    } catch (error) {
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
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      this.setData({ message: "昵称不能为空" });
      return;
    }
    if (this.data.saving || nickname === this.data.serverNickname) {
      wx.navigateBack();
      return;
    }
    this.setData({ saving: true, message: "" });
    try {
      const profile = await account.updateNickname(nickname);
      auth.updateStoredUser({ nickname: profile.nickname });
      this.setData({ saving: false, serverNickname: profile.nickname });
      wx.navigateBack();
    } catch (error) {
      this.setData({
        saving: false,
        message: error.message || "昵称保存失败，请重试",
      });
    }
  },
});
