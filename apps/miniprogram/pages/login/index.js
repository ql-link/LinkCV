const auth = require("../../services/auth");
const { getStatusBarHeight } = require("../../utils/system");

const DEFAULT_RETURN_TARGET = "/pages/resumes/index";
const RETURN_TARGETS = new Set([
  "/pages/resumes/index",
  "/pages/profile/index",
]);

function decodeOption(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return "";
  }
}

function resolveReturnTarget(options) {
  const candidate = decodeOption(
    options && (options.returnTo || options.returnUrl || options.redirect),
  );
  return RETURN_TARGETS.has(candidate) ? candidate : DEFAULT_RETURN_TARGET;
}

Page({
  data: {
    loading: true,
    statusBarHeight: getStatusBarHeight(),
    submitting: false,
    agreementAccepted: false,
    agreementActionHint: "",
    privacyReady: false,
    privacySupported: false,
    privacyAuthorizationRequired: false,
    privacyContractName: "《LinkResume 小程序隐私保护指引》",
    returnTo: DEFAULT_RETURN_TARGET,
    message: "让每一次投递更有底气 · 随时随地同步查阅",
  },

  onLoad(options) {
    const scene = decodeOption(options && options.scene);
    if (scene) {
      wx.reLaunch({ url: `/pages/confirm/index?scene=${encodeURIComponent(scene)}` });
      return;
    }

    this.setData({ returnTo: resolveReturnTarget(options) });
    if (auth.hasSession()) {
      wx.switchTab({
        url: RETURN_TARGETS.has(this.data.returnTo) ? this.data.returnTo : DEFAULT_RETURN_TARGET,
      });
      return;
    }
    this.setData({ agreementAccepted: auth.hasAcceptedPrivacyAgreement() });
    this.loadPrivacySetting();
  },

  async loadPrivacySetting() {
    const setting = await auth.getPrivacySetting();
    this.setData({
      loading: false,
      privacyReady: true,
      privacySupported: setting.supported,
      privacyAuthorizationRequired: setting.needAuthorization,
      privacyContractName: setting.privacyContractName,
    });
  },

  handleAgreementChange(event) {
    this.setData({
      agreementAccepted: event.detail.value.includes("accepted"),
      agreementActionHint: "",
    });
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

  handlePrimaryAction() {
    if (!this.data.agreementAccepted) {
      this.setData({ agreementActionHint: "请先勾选隐私保护指引后再继续" });
      return;
    }
    if (
      !this.data.privacyReady
      || !this.data.privacySupported
      || this.data.submitting
    ) return;
    auth.acceptPrivacyAgreement();
    return this.handleAccountAction();
  },

  async handleAccountAction() {
    this.setData({ submitting: true, message: "正在登录…" });
    try {
      // The server reuses an existing account or creates one when allowed;
      // the client intentionally does not identify the account first.
      await auth.registerOrLogin();
      await this.enterReturnTarget();
    } catch (error) {
      this.setData({
        submitting: false,
        message: error.message || "登录失败，请稍后重试。",
      });
    }
  },

  async enterReturnTarget() {
    this.setData({ submitting: false, message: "登录成功，正在进入…" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    wx.switchTab({ url: RETURN_TARGETS.has(this.data.returnTo) ? this.data.returnTo : DEFAULT_RETURN_TARGET });
  },

  handleDismiss() {
    if (this.data.submitting) return;
    wx.switchTab({ url: RETURN_TARGETS.has(this.data.returnTo) ? this.data.returnTo : DEFAULT_RETURN_TARGET });
  },
});
