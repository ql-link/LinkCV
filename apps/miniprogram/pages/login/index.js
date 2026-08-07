// pages/login/index.js
// LinkCV 扫码登录确认页：解析小程序码 scene，确认后把 wx.login() 的 code
// 与 scene/mode/昵称/头像 multipart 提交后端 /api/auth/wechat/confirm。
const app = getApp();

function loginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => (res.code ? resolve(res.code) : reject(new Error("wx.login 未返回 code"))),
      fail: reject,
    });
  });
}

function submitWithAvatar(scene, mode, code, nickname, avatarPath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${app.globalData.apiBaseUrl}/api/auth/wechat/confirm`,
      filePath: avatarPath,
      name: "avatar",
      formData: { scene, code, mode, nickname: nickname || "" },
      success: (res) => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(res.data) });
        } catch (error) {
          reject(error);
        }
      },
      fail: reject,
    });
  });
}

function submitWithoutAvatar(scene, mode, code, nickname) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBaseUrl}/api/auth/wechat/confirm`,
      method: "POST",
      header: { "content-type": "application/x-www-form-urlencoded" },
      data: { scene, code, mode, nickname: nickname || "" },
      success: (res) => resolve({ statusCode: res.statusCode, body: res.data }),
      fail: reject,
    });
  });
}

Page({
  data: {
    scene: "",
    mode: "login",
    nickname: "",
    avatarPath: "",
    avatarUrl: "",
    confirming: false,
    done: false,
    error: "",
  },

  onLoad(options) {
    const encoded = options.scene || "";
    let scene = encoded;
    try {
      scene = decodeURIComponent(encoded);
    } catch (error) {
      // 保留原始值继续解析
    }
    const mode = scene.split(":")[0] === "bind" ? "bind" : "login";
    this.setData({ scene, mode });
  },

  onChooseAvatar(event) {
    const avatarPath = event.detail.avatarUrl;
    this.setData({ avatarPath, avatarUrl: avatarPath });
  },

  onNicknameInput(event) {
    this.setData({ nickname: event.detail.value });
  },

  async onConfirm() {
    const { scene, mode, nickname, avatarPath, confirming, done } = this.data;
    if (confirming || done) {
      return;
    }
    if (!scene) {
      this.setData({ error: "缺少扫码参数，请从二维码进入本页面" });
      return;
    }
    this.setData({ confirming: true, error: "" });
    try {
      const code = await loginCode();
      let result;
      if (avatarPath) {
        result = await submitWithAvatar(scene, mode, code, nickname, avatarPath);
      } else {
        result = await submitWithoutAvatar(scene, mode, code, nickname);
      }
      if (result.statusCode === 200 && result.body && result.body.ok === true) {
        this.setData({ done: true, confirming: false });
      } else {
        const errorCode =
          result.body && result.body.error ? result.body.error : "CONFIRM_FAILED";
        this.setData({ confirming: false, error: `确认失败：${errorCode}` });
      }
    } catch (error) {
      this.setData({ confirming: false, error: "网络异常，请稍后重试" });
    }
  },
});
