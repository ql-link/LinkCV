// pages/login/index.js
// LinkResume 扫码登录确认页（对接后端 /api/auth/wechat scene 状态机）。
// 1) 浏览模式（无 scene，如审核/直接打开）：仅展示品牌与流程说明，不请求任何授权，
//    符合平台"先浏览体验功能，再自主选择授权登录"的规范要求。
// 2) 授权确认模式（扫码携带 scene）：校验 scene 后展示确认登录按钮，
//    点击后 wx.login() 换取临时 code，提交 POST /api/auth/wechat/confirm 完成登录。
const app = getApp();

Page({
  data: {
    scene: "", // 从扫码二维码解析的 scene（URL 解码后）
    hasSession: false, // 是否有扫码会话：false=浏览模式（可自由浏览），true=授权确认模式
    loading: false, // 防止重复提交锁
  },

  onLoad(options) {
    // 小程序码把 scene 塞进页面参数并 URL 编码，需要解码。
    const scene = decodeURIComponent(options.scene || "");
    if (!scene) {
      // 无 scene（如审核或用户直接打开）：进入浏览模式，
      // 仅展示品牌与流程说明，不请求任何授权，符合平台"先浏览后授权"规范。
      return;
    }
    this.setData({ scene, hasSession: true });
    // 校验 scene 是否仍有效（复用 status 接口做轻量校验，不消费状态）。
    this.validateScene(scene);
  },

  // 校验 scene 有效性：状态为 expired 视为失效；pending 等其余情况交由 confirm 兜底。
  validateScene(scene) {
    wx.request({
      url: `${app.globalData.apiBaseUrl}/api/auth/wechat/status`,
      method: "GET",
      data: { scene },
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode === 200 && body.status === "expired") {
          this.abortInvalid();
        }
      },
      fail: () => {
        // 网络异常不拦截，最终由 confirm 的返回结果兜底。
      },
    });
  },

  // 会话无效：弹窗提示后返回上一页
  abortInvalid() {
    wx.showModal({
      title: "提示",
      content: "登录会话已过期或无效",
      showCancel: false,
      confirmText: "知道了",
      success: () => {
        if (!this.goBack()) {
          wx.reLaunch({
            url: "/pages/index/index",
            fail: () => {
              wx.showToast({ title: "可关闭本页重新扫码", icon: "none" });
            },
          });
        }
      },
    });
  },

  // 确认登录：wx.login() 换临时 code，POST /api/auth/wechat/confirm 提交 { scene, code }
  async handleConfirm() {
    const { scene, loading } = this.data;
    if (loading) {
      return; // 防止重复提交
    }
    if (!scene) {
      this.abortInvalid();
      return;
    }
    this.setData({ loading: true });
    try {
      const code = await this.getWxLoginCode();
      const result = await this.requestConfirm(scene, code);
      if (result.statusCode === 200 && result.body && result.body.ok) {
        wx.showToast({ title: "登录成功", icon: "success" });
        setTimeout(() => {
          // 延迟 1 秒后跳转首页；若首页不存在（如直接打开本页）则回退上一页
          wx.reLaunch({
            url: "/pages/index/index",
            fail: () => {
              if (!this.goBack()) {
                wx.showToast({ title: "登录完成，可关闭本页", icon: "none" });
              }
            },
          });
        }, 1000);
      } else {
        this.handleConfirmError(result);
      }
    } catch (error) {
      this.handleConfirmError({});
    }
  },

  // 获取微信临时登录凭证
  getWxLoginCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => (res.code ? resolve(res.code) : reject(res)),
        fail: reject,
      });
    });
  },

  // 提交确认结果
  requestConfirm(scene, code) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${app.globalData.apiBaseUrl}/api/auth/wechat/confirm`,
        method: "POST",
        header: { "content-type": "application/x-www-form-urlencoded" },
        data: { scene, code },
        success: (res) => resolve({ statusCode: res.statusCode, body: res.data }),
        fail: reject,
      });
    });
  },

  // 错误处理：过期/重放/服务不可用给出对应提示
  handleConfirmError({ statusCode, body }) {
    this.setData({ loading: false });
    const error = (body && body.error) || "";
    const isExpired =
      statusCode === 410 || statusCode === 409 || error === "SCENE_EXPIRED" || error === "SCENE_REUSED";
    if (isExpired) {
      wx.showModal({
        title: "提示",
        content: "登录会话已过期或无效，请重新扫码",
        showCancel: false,
        confirmText: "知道了",
      });
    } else if (statusCode === 503 || error === "WECHAT_SERVICE_UNAVAILABLE") {
      wx.showToast({ title: "服务暂不可用，请稍后重试", icon: "none" });
    } else {
      wx.showToast({ title: "登录失败，请重试", icon: "error" });
    }
  },

  // 取消（拒绝）：二次确认后返回上一页，满足审核"提供取消/拒绝返回选项"要求
  handleCancel() {
    const { loading } = this.data;
    if (loading) {
      return;
    }
    wx.showModal({
      title: "提示",
      content: "确定取消本次登录吗？",
      confirmText: "确定",
      cancelText: "再想想",
      success: (res) => {
        if (res.confirm) {
          this.goBack();
        }
      },
    });
  },

  // 返回上一页；无上一页时返回 false 由调用方决定兜底
  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return true;
    }
    return false;
  },
});
