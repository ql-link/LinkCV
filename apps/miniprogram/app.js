const { resolveApiBaseUrl } = require("./config/env");

App({
  onLaunch() {
    try {
      this.globalData.apiBaseUrl = resolveApiBaseUrl();
    } catch (error) {
      this.globalData.configError = error.message;
    }
  },
  globalData: {
    apiBaseUrl: "",
    configError: "",
  },
});
