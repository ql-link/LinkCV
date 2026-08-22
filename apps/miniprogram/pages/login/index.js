const auth = require("../../services/auth");

function formRequest(path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: auth.apiUrl(path),
      method: "POST",
      header: { "content-type": "application/x-www-form-urlencoded" },
      data,
      success: resolve,
      fail: reject,
    });
  });
}

Page({
  data: {
    scene: "",
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
    phase: "checking",
    message: "正在校验本次登录请求…",
  },

  onLoad(options) {
    const scene = decodeURIComponent(options.scene || "");
    this.setData({
      scene,
      agreementAccepted: auth.hasAcceptedPrivacyAgreement(),
    });
    this.loadPrivacySetting();
    if (!scene) {
      if (auth.hasSession()) {
        wx.reLaunch({ url: "/pages/resumes/index" });
        return;
      }
      this.setData({
        loading: true,
        phase: "onboarding",
        message: "正在识别当前微信账号…",
      });
      this.loadAccountStatus();
      return;
    }
    this.loadStatus();
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
      || (this.data.phase === "onboarding" && !this.data.accountStatusReady)
    ) return;
    auth.acceptPrivacyAgreement();
    if (this.data.phase === "onboarding") {
      return this.handleAccountAction();
    }
    return this.handleConfirm();
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
      wx.reLaunch({ url: "/pages/resumes/index" });
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
        phase: "onboarding",
        message: error.message || (registered ? "登录失败，请稍后重试。" : "注册失败，请稍后重试。"),
      });
    }
  },

  loadStatus() {
    this.setData({ loading: true, phase: "checking", message: "正在校验本次登录请求…" });
    wx.request({
      url: auth.apiUrl("/api/auth/wechat/status"),
      method: "GET",
      data: { scene: this.data.scene },
      success: (response) => {
        const status = response.data && response.data.status;
        if (status === "pending") {
          this.setData({ loading: false, phase: "pending", message: "请确认是否允许当前网页登录 LinkCV。" });
        } else if (status === "success") {
          wx.reLaunch({
            url: auth.hasSession() ? "/pages/resumes/index" : "/pages/login/index",
          });
        } else if (status === "cancelled") {
          this.setData({ loading: false, phase: "cancelled", message: "已取消本次网页登录。" });
        } else {
          this.setData({ loading: false, phase: "expired", message: "登录请求已过期，请返回网页重新扫码。" });
        }
      },
      fail: () => this.setData({ loading: false, phase: "error", message: "网络异常，请稍后重试。" }),
    });
  },

  async handleConfirm() {
    if (this.data.submitting || this.data.phase !== "pending") return;
    this.setData({ submitting: true, message: "正在确认…" });
    try {
      const code = await auth.wxLoginCode();
      const response = await formRequest("/api/auth/wechat/confirm", {
        scene: this.data.scene,
        code,
        privacy_accepted: true,
      });
      if (response.statusCode !== 200) {
        throw new Error((response.data && response.data.error) || "确认失败");
      }
      await auth.loginExistingAccount();
      wx.reLaunch({ url: "/pages/resumes/index" });
    } catch (error) {
      const recoverable = error.message === "WECHAT_SERVICE_UNAVAILABLE" || error.message === "WECHAT_CODE_INVALID";
      this.setData({
        submitting: false,
        phase: recoverable ? "pending" : "error",
        message: recoverable ? "微信校验失败，请重新确认。" : (error.message || "确认失败，请重试。"),
      });
    }
  },

  async handleCancel() {
    if (this.data.submitting || this.data.phase !== "pending") return;
    this.setData({ submitting: true });
    try {
      const response = await formRequest("/api/auth/wechat/cancel", { scene: this.data.scene });
      if (response.statusCode !== 200) {
        throw new Error((response.data && response.data.error) || "取消失败");
      }
      this.setData({ submitting: false, phase: "cancelled", message: "已取消本次网页登录。" });
    } catch (error) {
      this.setData({ submitting: false, message: error.message || "取消失败，请重试。" });
    }
  },
});
