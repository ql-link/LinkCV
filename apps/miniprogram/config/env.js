const runtimeConfig = require("./runtime");

function resolveApiBaseUrl() {
  const extConfig = typeof wx !== "undefined" && wx.getExtConfigSync
    ? wx.getExtConfigSync()
    : {};
  const extApiBaseUrl = extConfig && typeof extConfig.apiBaseUrl === "string"
    ? extConfig.apiBaseUrl
    : "";
  const account = typeof wx !== "undefined" && wx.getAccountInfoSync
    ? wx.getAccountInfoSync()
    : null;
  const envVersion = account && account.miniProgram
    ? account.miniProgram.envVersion
    : "develop";
  const developmentOverride = envVersion === "develop"
    && typeof wx !== "undefined"
    && wx.getStorageSync
    ? wx.getStorageSync("linkcv_api_base_url")
    : "";
  const defaultApiBaseUrl = envVersion === "develop"
    ? runtimeConfig.developmentApiBaseUrl
    : runtimeConfig.productionApiBaseUrl;
  const configured = (
    (typeof developmentOverride === "string" ? developmentOverride : "")
    || extApiBaseUrl
    || defaultApiBaseUrl
    || ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (configured) {
    if (envVersion !== "develop" && !configured.startsWith("https://")) {
      throw new Error("体验版和正式版的小程序 API 地址必须使用 HTTPS");
    }
    return configured;
  }
  throw new Error("未配置当前环境的小程序 API 地址");
}

module.exports = { resolveApiBaseUrl };
