// pages/login/index.js
// LinkResume 授权确认页：双模式页面。
// 1) 浏览模式（无 session_id，如审核/直接打开）：仅展示品牌与流程说明，不请求任何授权，
//    符合平台"先浏览体验功能，再自主选择授权登录"的规范要求。
// 2) 授权确认模式（扫码携带 session_id）：验证会话后展示确认登录按钮，
//    提交 POST /oauth/authorize 完成授权。
const app = getApp();

Page({
  data: {
    sessionId: "", // 从上一页路由参数获取的会话 ID
    hasSession: false, // 是否有扫码会话：false=浏览模式（可自由浏览），true=授权确认模式
    loading: false, // 防止重复提交锁
  },

  onLoad(options) {
    const sessionId = options.session_id || "";
    if (!sessionId) {
      // 无会话（如审核或用户直接打开）：进入浏览模式，
      // 仅展示品牌与流程说明，不请求任何授权，符合平台"先浏览后授权"规范。
      return;
    }
    this.setData({ sessionId, hasSession: true });
    // 验证会话是否有效（复用 consent 接口做轻量校验，返回数据不再使用）
    this.validateSession(sessionId);
  },

  // 校验会话有效性
  validateSession(sessionId) {
    wx.request({
      url: `${app.globalData.apiBaseUrl}/oauth/consent`,
      method: "GET",
      data: { session_id: sessionId },
      success: (res) => {
        const body = res.data || {};
        if (!(res.statusCode === 200 && body.code === 0)) {
          this.abortInvalid();
        }
      },
      fail: () => {
        this.abortInvalid();
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
          wx.reLaunch({ url: "/pages/index/index" });
        }
      },
    });
  },

  // 确认登录：POST /oauth/authorize { session_id, action: 'allow' }
  async handleConfirm() {
    const { sessionId, loading } = this.data;
    if (loading) {
      return; // 防止重复提交
    }
    if (!sessionId) {
      this.abortInvalid();
      return;
    }
    this.setData({ loading: true });
    try {
      const result = await this.requestAuthorize(sessionId, "allow");
      if (result.statusCode === 200 && result.body && result.body.code === 0) {
        wx.showToast({ title: "授权成功", icon: "success" });
        setTimeout(() => {
          // 延迟 1 秒后跳转首页；若首页不存在（如直接打开本页）则回退上一页
          wx.reLaunch({
            url: "/pages/index/index",
            fail: () => {
              if (!this.goBack()) {
                wx.showToast({ title: "授权完成，可关闭本页", icon: "none" });
              }
            },
          });
        }, 1000);
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: "授权失败，请重试", icon: "error" });
      }
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: "授权失败，请重试", icon: "error" });
    }
  },

  // 提交授权结果
  requestAuthorize(sessionId, action) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${app.globalData.apiBaseUrl}/oauth/authorize`,
        method: "POST",
        header: { "content-type": "application/x-www-form-urlencoded" },
        data: { session_id: sessionId, action },
        success: (res) => resolve({ statusCode: res.statusCode, body: res.data }),
        fail: reject,
      });
    });
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
