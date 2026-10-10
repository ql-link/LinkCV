const auth = require("../../services/auth");
const { getStatusBarHeight } = require("../../utils/system");
const ERROR_MESSAGES = {
  WECHAT_IDENTITY_MISMATCH: "微信身份不一致，请使用网页当前账号的微信扫码。",
  ACCOUNT_CONFIRMATION_EXPIRED: "确认请求已过期，请返回网页刷新二维码。",
  ACCOUNT_CONFIRMATION_UNAVAILABLE: "确认请求已取消或已使用，请返回网页重新操作。",
  ACCOUNT_RATE_LIMITED: "操作过于频繁，请稍后重试。",
  NOT_FOUND: "当前服务未开放微信账号操作。",
};
Page({
  data: {
    statusBarHeight: getStatusBarHeight(), scene: "", phase: "pending", submitting: false,
    agreementAccepted: false, privacyReady: false, privacySupported: false,
    privacyAuthorizationRequired: false, privacyContractName: "《DrawOffer 小程序隐私保护指引》",
    message: "确认当前微信身份后，请返回网页继续注销。此操作不会登录或创建账号。",
  },
  async onLoad(options) {
    this.alive = true;
    let scene = "";
    try { scene = decodeURIComponent((options && options.scene) || ""); } catch { /* invalid QR */ }
    if (!/^del:[a-f0-9]{24}$/.test(scene)) {
      this.setData({ phase: "error", message: "无效的账号确认请求，请返回网页重新扫码。" });
      return;
    }
    this.setData({ scene, agreementAccepted: auth.hasAcceptedPrivacyAgreement() });
    const privacy = await auth.getPrivacySetting();
    if (this.alive) this.setData({ privacyReady: true, privacySupported: privacy.supported, privacyAuthorizationRequired: privacy.needAuthorization, privacyContractName: privacy.privacyContractName });
  },
  onUnload() { this.alive = false; },
  handleAgreementChange(event) { this.setData({ agreementAccepted: event.detail.value.includes("accepted") }); },
  async openPrivacyContract() {
    try { await auth.openPrivacyContract(); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
  },
  async handleConfirm() {
    if (this.data.submitting || this.data.phase !== "pending" || !this.data.agreementAccepted || !this.data.privacyReady || !this.data.privacySupported) return;
    this.setData({ submitting: true });
    try {
      auth.acceptPrivacyAgreement();
      const code = await auth.wxLoginCode();
      const response = await new Promise((resolve, reject) => wx.request({
        url: auth.apiUrl("/api/account/wechat/verification-confirm"), method: "POST",
        header: { "content-type": "application/json" }, data: { scene: this.data.scene, code },
        success: resolve, fail: () => reject(new Error("网络异常，请重试。")),
      }));
      if (response.statusCode !== 200) throw new Error(ERROR_MESSAGES[response.data && response.data.error] || "身份确认失败，请重试或返回网页刷新二维码。");
      if (this.alive) this.setData({ phase: "confirmed", submitting: false, message: "身份已确认。请返回网页输入确认文字并完成注销。" });
    } catch (error) {
      if (this.alive) this.setData({ submitting: false, message: error.message || "身份确认失败，请重试。" });
    }
  },
  handleClose() {
    this.setData({ phase: "cancelled", message: "已关闭手机确认，请在网页取消本次操作。" });
  },
});
