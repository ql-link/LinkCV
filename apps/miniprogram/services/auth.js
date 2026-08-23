const ACCESS_KEY = "linkcv_access_token";
const REFRESH_KEY = "linkcv_refresh_token";
const USER_KEY = "linkcv_user";
const PRIVACY_AGREEMENT_KEY = "linkcv_privacy_agreement_v1";
const DEFAULT_PRIVACY_CONTRACT_NAME = "《LinkCV 小程序隐私保护指引》";

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
      fail: (result) => reject(new Error(result.errMsg || "网络请求失败")),
    });
  });
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => result.code ? resolve(result.code) : reject(new Error("微信登录失败")),
      fail: (result) => reject(new Error(result.errMsg || "微信登录失败")),
    });
  });
}

function saveSession(body) {
  const previousUser = wx.getStorageSync(USER_KEY);
  if (previousUser && String(previousUser.id) !== String(body.user && body.user.id)) {
    void require("./resumePreviewCache").clearResumePreviewCache();
  }
  wx.setStorageSync(ACCESS_KEY, body.access_token);
  wx.setStorageSync(REFRESH_KEY, body.refresh_token);
  wx.setStorageSync(USER_KEY, body.user);
  return body.user;
}

function clearSession() {
  wx.removeStorageSync(ACCESS_KEY);
  wx.removeStorageSync(REFRESH_KEY);
  wx.removeStorageSync(USER_KEY);
  void require("./resumePreviewCache").clearResumePreviewCache();
}

function agreementRequiredError() {
  const error = new Error("请先阅读并同意隐私保护指引");
  error.code = "AGREEMENT_REQUIRED";
  return error;
}

function acceptPrivacyAgreement() {
  wx.setStorageSync(PRIVACY_AGREEMENT_KEY, true);
}

function hasAcceptedPrivacyAgreement() {
  return wx.getStorageSync(PRIVACY_AGREEMENT_KEY) === true;
}

function hasSession() {
  return Boolean(wx.getStorageSync(ACCESS_KEY));
}

function getPrivacySetting() {
  if (typeof wx.getPrivacySetting !== "function") {
    return Promise.resolve({
      supported: false,
      needAuthorization: false,
      privacyContractName: DEFAULT_PRIVACY_CONTRACT_NAME,
    });
  }
  return new Promise((resolve) => {
    wx.getPrivacySetting({
      success: (result) => resolve({
        supported: true,
        needAuthorization: Boolean(result.needAuthorization),
        privacyContractName: result.privacyContractName || DEFAULT_PRIVACY_CONTRACT_NAME,
      }),
      fail: () => resolve({
        supported: false,
        needAuthorization: false,
        privacyContractName: DEFAULT_PRIVACY_CONTRACT_NAME,
      }),
    });
  });
}

function openPrivacyContract() {
  if (typeof wx.openPrivacyContract !== "function") {
    return Promise.reject(new Error("当前微信版本暂不支持打开隐私保护指引"));
  }
  return new Promise((resolve, reject) => {
    wx.openPrivacyContract({
      success: resolve,
      fail: (result) => reject(new Error(result.errMsg || "隐私保护指引暂时无法打开")),
    });
  });
}

function responseError(response, fallback) {
  const code = response.data && response.data.error;
  const error = new Error(code || fallback);
  error.code = code || undefined;
  error.statusCode = response.statusCode;
  return error;
}

async function authenticate(allowRegistration) {
  const code = await wxLoginCode();
  const response = await rawRequest(
    "/api/auth/wechat/miniprogram/login",
    "POST",
    { code, privacy_accepted: allowRegistration },
  );
  if (response.statusCode !== 200) {
    throw responseError(response, `登录失败（HTTP ${response.statusCode || "未知"}）`);
  }
  return saveSession(response.data);
}

async function loginExistingAccount() {
  return authenticate(false);
}

async function registerOrLogin() {
  if (!hasAcceptedPrivacyAgreement()) throw agreementRequiredError();
  return authenticate(true);
}

async function getAccountStatus() {
  const code = await wxLoginCode();
  const response = await rawRequest(
    "/api/auth/wechat/miniprogram/account-status",
    "POST",
    { code },
  );
  if (response.statusCode !== 200) {
    throw responseError(response, `账号识别失败（HTTP ${response.statusCode || "未知"}）`);
  }
  return Boolean(response.data && response.data.registered);
}

async function ensureSession() {
  const accessToken = wx.getStorageSync(ACCESS_KEY);
  if (accessToken) return wx.getStorageSync(USER_KEY) || null;
  throw agreementRequiredError();
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

function getCurrentUser() {
  return wx.getStorageSync(USER_KEY) || null;
}

module.exports = {
  acceptPrivacyAgreement,
  apiUrl,
  clearSession,
  ensureSession,
  getAccessToken,
  getCurrentUser,
  getAccountStatus,
  getPrivacySetting,
  hasAcceptedPrivacyAgreement,
  hasSession,
  loginExistingAccount,
  logout,
  openPrivacyContract,
  registerOrLogin,
  refreshSession,
  wxLoginCode,
};
