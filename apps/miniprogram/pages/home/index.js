const auth = require("../../services/auth");
const { getStatusBarHeight } = require("../../utils/system");

Page({
  data: {
    loggedIn: false,
    statusBarHeight: getStatusBarHeight(),
  },

  onLoad(options) {
    const scene = decodeURIComponent(options.scene || "");
    if (scene) {
      wx.reLaunch({ url: `/pages/confirm/index?scene=${encodeURIComponent(scene)}` });
      return;
    }
    this.refreshLoginState();
  },

  onShow() {
    this.refreshLoginState();
  },

  refreshLoginState() {
    this.setData({ loggedIn: auth.hasSession() });
  },

  handlePrimaryAction() {
    if (this.data.loggedIn) {
      wx.switchTab({ url: "/pages/resumes/index" });
      return;
    }
    wx.navigateTo({ url: "/pages/login/index" });
  },
});
