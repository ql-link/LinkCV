function getStatusBarHeight() {
  try {
    if (typeof wx !== "undefined" && wx.getWindowInfo) {
      return wx.getWindowInfo().statusBarHeight || 0;
    }
    if (typeof wx !== "undefined" && wx.getSystemInfoSync) {
      return wx.getSystemInfoSync().statusBarHeight || 0;
    }
  } catch (error) {
    // 基础库异常时退回 0，由页面自身最小间距兜底。
  }
  return 0;
}

module.exports = { getStatusBarHeight };
