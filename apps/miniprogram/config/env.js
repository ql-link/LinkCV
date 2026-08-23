const runtimeConfig = require("./runtime");

function resolveApiBaseUrl() {
  return resolveBaseUrl({
    extConfigKey: "apiBaseUrl",
    developmentStorageKey: "linkcv_api_base_url",
    developmentDefault: runtimeConfig.developmentApiBaseUrl,
    productionDefault: runtimeConfig.productionApiBaseUrl,
    label: "API",
  });
}

function resolveBaseUrl({ extConfigKey, developmentStorageKey, developmentDefault, productionDefault, label }) {
  const extConfig = typeof wx !== "undefined" && wx.getExtConfigSync
    ? wx.getExtConfigSync()
    : {};
  const extBaseUrl = extConfig && typeof extConfig[extConfigKey] === "string"
    ? extConfig[extConfigKey]
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
    ? wx.getStorageSync(developmentStorageKey)
    : "";
  const defaultApiBaseUrl = envVersion === "develop"
    ? developmentDefault
    : productionDefault;
  const configured = (
    (typeof developmentOverride === "string" ? developmentOverride : "")
    || extBaseUrl
    || defaultApiBaseUrl
    || ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (configured) {
    if (envVersion !== "develop" && !configured.startsWith("https://")) {
      throw new Error(`体验版和正式版的小程序 ${label} 地址必须使用 HTTPS`);
    }
    return configured;
  }
  throw new Error(`未配置当前环境的小程序 ${label} 地址`);
}

module.exports = { resolveApiBaseUrl };
