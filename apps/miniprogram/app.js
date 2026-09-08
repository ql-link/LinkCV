const { resolveApiBaseUrl } = require("./config/env");

App({
  onLaunch() {
    require('./services/tabResources').prepare();
    try {
      this.globalData.apiBaseUrl = resolveApiBaseUrl();
      require('./services/tabPrefetch').schedule();
    } catch (error) {
      this.globalData.configError = error.message;
    }
  },
  globalData: {
    apiBaseUrl: "",
    configError: "",
  },
});
