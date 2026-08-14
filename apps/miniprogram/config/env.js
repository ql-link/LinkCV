const runtimeConfig = require("./runtime");

function resolveApiBaseUrl() {
  const extConfig = typeof wx !== "undefined" && wx.getExtConfigSync
    ? wx.getExtConfigSync()
    : {};
  const extApiBaseUrl = extConfig && typeof extConfig.apiBaseUrl === "string"
    ? extConfig.apiBaseUrl
    : "";
  const staticApiBaseUrl = typeof runtimeConfig.apiBaseUrl === "string"
    ? runtimeConfig.apiBaseUrl
    : "";
  const configured = (extApiBaseUrl || staticApiBaseUrl).trim().replace(/\/+$/, "");

  const account = typeof wx !== "undefined" && wx.getAccountInfoSync
    ? wx.getAccountInfoSync()
    : null;
  const envVersion = account && account.miniProgram
    ? account.miniProgram.envVersion
    : "develop";
  if (configured) {
    if (envVersion !== "develop" && !configured.startsWith("https://")) {
      throw new Error("体验版和正式版的小程序 API 地址必须使用 HTTPS");
    }
    return configured;
  }
  if (envVersion === "develop") return "http://127.0.0.1:8000";
  throw new Error("未配置小程序 API 地址");
}

module.exports = { resolveApiBaseUrl };
