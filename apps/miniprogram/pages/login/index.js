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
    phase: "checking",
    message: "正在校验本次登录请求…",
  },

  onLoad(options) {
    const scene = decodeURIComponent(options.scene || "");
    if (!scene) {
      wx.reLaunch({ url: "/pages/resumes/index" });
      return;
    }
    this.setData({ scene });
    this.loadStatus();
  },

  loadStatus() {
    wx.request({
      url: auth.apiUrl("/api/auth/wechat/status"),
      method: "GET",
      data: { scene: this.data.scene },
      success: (response) => {
        const status = response.data && response.data.status;
        if (status === "pending") {
          this.setData({ loading: false, phase: "pending", message: "请确认是否允许当前网页登录 LinkCV。" });
        } else if (status === "success") {
          this.setData({ loading: false, phase: "confirmed", message: "本次网页登录已确认。" });
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
      });
      if (response.statusCode !== 200) {
        throw new Error((response.data && response.data.error) || "确认失败");
      }
      await auth.login();
      this.setData({ submitting: false, phase: "confirmed", message: "网页已登录，可以继续查看简历。" });
      wx.showToast({ title: "登录已确认", icon: "success" });
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

  openResumes() {
    wx.reLaunch({ url: "/pages/resumes/index" });
  },
});
