const auth = require("../../services/auth");
const resumes = require("../../services/resumes");
const { formatUpdatedAt } = require("../../utils/resume");
const { getStatusBarHeight } = require("../../utils/system");

Page({
  data: {
    loading: true,
    guest: false,
    error: "",
    items: [],
    user: null,
    statusBarHeight: getStatusBarHeight(),
  },

  onLoad() {
    if (!auth.hasSession()) {
      this.enterGuestMode();
      return;
    }
    this.loadPage();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (!auth.hasSession()) {
      if (!this.data.guest) this.enterGuestMode();
      return;
    }
    if (this.data.guest) this.loadPage();
  },

  onPullDownRefresh() {
    if (!auth.hasSession()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadPage().finally(() => wx.stopPullDownRefresh());
  },

  enterGuestMode() {
    this.setData({ guest: true, loading: false, error: "", items: [], user: null });
  },

  goLogin() {
    wx.navigateTo({
      url: `/pages/login/index?returnTo=${encodeURIComponent("/pages/resumes/index")}`,
    });
  },

  async loadPage() {
    this.setData({ loading: true, error: "", guest: false });
    try {
      const user = await auth.ensureSession();
      const records = await resumes.listResumes();
      const items = records.map((item) => ({
        ...item,
        updatedAtLabel: formatUpdatedAt(item.updated_at),
      }));
      this.setData({ user, items, loading: false });
    } catch (error) {
      if (!auth.hasSession()) {
        this.enterGuestMode();
        return;
      }
      this.setData({ loading: false, error: error.message || "加载失败，请稍后重试" });
    }
  },
});
