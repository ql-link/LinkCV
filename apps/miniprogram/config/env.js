const runtimeConfig = require("./runtime");
const LOCAL_DEBUG_ENABLED_STORAGE_KEY = "linkcv_local_debug_enabled";

function readLocalConfig() {
  if (typeof process !== "undefined" && process.env && (process.env.NODE_ENV === "test" || process.env.npm_lifecycle_event === "test")) {
    return null;
  }
  try {
    return require("./local");
  } catch {
    return null;
  }
}

function readStorageValue(key) {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return undefined;
  }
  try {
    return wx.getStorageSync(key);
  } catch {
    return undefined;
  }
}

function readLocalConfigSafely(reader) {
  try {
    return reader();
  } catch {
    return null;
  }
}

function readAccountInfoSafely() {
  if (typeof wx === "undefined" || typeof wx.getAccountInfoSync !== "function") {
    return null;
  }
  try {
    const account = wx.getAccountInfoSync();
    if (!account || !account.miniProgram || typeof account.miniProgram.envVersion !== "string") {
      return null;
    }
    return account;
  } catch {
    return null;
  }
}

function resolveApiBaseUrl(options = {}) {
  const localConfigReader = typeof options.readLocalConfig === "function"
    ? options.readLocalConfig
    : readLocalConfig;
  return resolveBaseUrl({
    extConfigKey: "apiBaseUrl",
    developmentStorageKey: "linkcv_api_base_url",
    productionDefault: runtimeConfig.productionApiBaseUrl,
    localConfigReader,
    label: "API",
  });
}

function resolveBaseUrl({
  extConfigKey,
  developmentStorageKey,
  productionDefault,
  localConfigReader,
  label,
}) {
  const extConfig = typeof wx !== "undefined" && wx.getExtConfigSync
    ? wx.getExtConfigSync()
    : {};
  const extBaseUrl = extConfig && typeof extConfig[extConfigKey] === "string"
    ? extConfig[extConfigKey]
    : "";
  const account = readAccountInfoSafely();
  const envVersion = account ? account.miniProgram.envVersion : null;
  const isDevelop = envVersion === "develop";
  const localDebugEnabled = isDevelop
    && readStorageValue(LOCAL_DEBUG_ENABLED_STORAGE_KEY) === true;
  const localConfig = localDebugEnabled
    ? readLocalConfigSafely(localConfigReader)
    : null;
  const localOverride = localConfig && typeof localConfig[extConfigKey] === "string"
    ? localConfig[extConfigKey]
    : "";
  const developmentOverrideValue = isDevelop
    ? readStorageValue(developmentStorageKey)
    : "";
  const developmentOverride = typeof developmentOverrideValue === "string"
    ? developmentOverrideValue
    : "";
  const configured = (
    developmentOverride
    || localOverride
    || extBaseUrl
    || productionDefault
    || ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (configured) {
    if (!isDevelop && !configured.startsWith("https://")) {
      throw new Error(`体验版和正式版的小程序 ${label} 地址必须使用 HTTPS`);
    }
    return configured;
  }
  throw new Error(`未配置当前环境的小程序 ${label} 地址`);
}

module.exports = { resolveApiBaseUrl };
