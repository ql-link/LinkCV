const ACCESS_KEY = "linkcv_access_token";
const REFRESH_KEY = "linkcv_refresh_token";
const USER_KEY = "linkcv_user";

function apiUrl(path) {
  const app = getApp();
  if (!app.globalData.apiBaseUrl) {
    throw new Error(app.globalData.configError || "服务地址未配置");
  }
  return `${app.globalData.apiBaseUrl}${path}`;
}

function rawRequest(path, method, data, header) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: apiUrl(path),
      method,
      data,
      header: header || { "content-type": "application/json" },
      success: resolve,
      fail: reject,
    });
  });
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => result.code ? resolve(result.code) : reject(new Error("微信登录失败")),
      fail: reject,
    });
  });
}

function saveSession(body) {
  wx.setStorageSync(ACCESS_KEY, body.access_token);
  wx.setStorageSync(REFRESH_KEY, body.refresh_token);
  wx.setStorageSync(USER_KEY, body.user);
  return body.user;
}

function clearSession() {
  wx.removeStorageSync(ACCESS_KEY);
  wx.removeStorageSync(REFRESH_KEY);
  wx.removeStorageSync(USER_KEY);
}

async function login() {
  const code = await wxLoginCode();
  const response = await rawRequest(
    "/api/auth/wechat/miniprogram/login",
    "POST",
    { code },
  );
  if (response.statusCode !== 200) {
    const error = new Error((response.data && response.data.error) || "登录失败");
    error.statusCode = response.statusCode;
    throw error;
  }
  return saveSession(response.data);
}

async function ensureSession() {
  const accessToken = wx.getStorageSync(ACCESS_KEY);
  if (accessToken) return wx.getStorageSync(USER_KEY) || null;
  return login();
}

async function refreshSession() {
  const refreshToken = wx.getStorageSync(REFRESH_KEY);
  if (!refreshToken) throw new Error("登录状态已失效");
  const response = await rawRequest(
    "/api/auth/wechat/miniprogram/refresh",
    "POST",
    { refresh_token: refreshToken },
  );
  if (response.statusCode !== 200) {
    const error = new Error((response.data && response.data.error) || "登录状态续期失败");
    error.statusCode = response.statusCode;
    if (response.statusCode === 401) clearSession();
    throw error;
  }
  saveSession(response.data);
  return response.data.access_token;
}

async function logout() {
  const refreshToken = wx.getStorageSync(REFRESH_KEY) || null;
  try {
    await rawRequest(
      "/api/auth/wechat/miniprogram/logout",
      "POST",
      { refresh_token: refreshToken },
    );
  } finally {
    clearSession();
  }
}

function getAccessToken() {
  return wx.getStorageSync(ACCESS_KEY) || "";
}

module.exports = {
  apiUrl,
  clearSession,
  ensureSession,
  getAccessToken,
  login,
  logout,
  refreshSession,
  wxLoginCode,
};
