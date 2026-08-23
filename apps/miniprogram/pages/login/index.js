const auth = require("../../services/auth");

Page({
  data: {
    loading: true,
    submitting: false,
    agreementAccepted: false,
    privacyReady: false,
    privacySupported: false,
    privacyAuthorizationRequired: false,
    privacyContractName: "《LinkCV 小程序隐私保护指引》",
    accountStatusReady: false,
    accountRegistered: false,
    accountStatusError: "",
    message: "正在识别当前微信账号…",
  },

  onLoad(options) {
    const scene = decodeURIComponent((options && options.scene) || "");
    if (scene) {
      wx.reLaunch({ url: `/pages/confirm/index?scene=${encodeURIComponent(scene)}` });
      return;
    }
    if (auth.hasSession()) {
      wx.switchTab({ url: "/pages/resumes/index" });
      return;
    }
    this.setData({ agreementAccepted: auth.hasAcceptedPrivacyAgreement() });
    this.loadPrivacySetting();
    this.loadAccountStatus();
  },

  async loadPrivacySetting() {
    const setting = await auth.getPrivacySetting();
    this.setData({
      privacyReady: true,
      privacySupported: setting.supported,
      privacyAuthorizationRequired: setting.needAuthorization,
      privacyContractName: setting.privacyContractName,
    });
  },

  handleAgreementChange(event) {
    this.setData({ agreementAccepted: event.detail.value.includes("accepted") });
  },

  async openPrivacyContract() {
    try {
      await auth.openPrivacyContract();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  handlePrivacyAuthorization() {
    return this.handlePrimaryAction();
  },

  async loadAccountStatus() {
    this.setData({
      loading: true,
      accountStatusReady: false,
      accountStatusError: "",
      message: "正在识别当前微信账号…",
    });
    try {
      const registered = await auth.getAccountStatus();
      this.setData({
        loading: false,
        accountStatusReady: true,
        accountRegistered: registered,
        message: registered
          ? "已找到你的 LinkCV 账号，确认后即可登录。"
          : "当前微信尚未注册，确认后将创建 LinkCV 账号。",
      });
    } catch (error) {
      this.setData({
        loading: false,
        accountStatusReady: false,
        accountStatusError: error.message || "账号识别失败，请稍后重试。",
        message: error.message || "账号识别失败，请稍后重试。",
      });
    }
  },

  handlePrimaryAction() {
    if (!this.data.agreementAccepted) {
      wx.showToast({ title: "请先阅读并勾选隐私保护指引", icon: "none" });
      return;
    }
    if (
      !this.data.privacyReady
      || !this.data.privacySupported
      || this.data.submitting
      || !this.data.accountStatusReady
    ) return;
    auth.acceptPrivacyAgreement();
    return this.handleAccountAction();
  },

  async handleAccountAction() {
    const registered = this.data.accountRegistered;
    this.setData({
      submitting: true,
      message: registered ? "正在登录…" : "正在注册…",
    });
    try {
      if (registered) await auth.loginExistingAccount();
      else await auth.registerOrLogin();
      wx.switchTab({ url: "/pages/resumes/index" });
    } catch (error) {
      if (registered && error.code === "PRIVACY_AGREEMENT_REQUIRED") {
        this.setData({
          submitting: false,
          accountRegistered: false,
          message: "未找到原账号，确认后将为当前微信创建 LinkCV 账号。",
        });
        return;
      }
      this.setData({
        submitting: false,
        message: error.message || (registered ? "登录失败，请稍后重试。" : "注册失败，请稍后重试。"),
      });
    }
  },

  handleDismiss() {
    if (this.data.submitting) return;
    wx.switchTab({ url: "/pages/home/index" });
  },
});
