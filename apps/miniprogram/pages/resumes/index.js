const auth = require("../../services/auth");
const resumes = require("../../services/resumes");
const { formatUpdatedAt } = require("../../utils/resume");

Page({
  data: {
    loading: true,
    error: "",
    items: [],
    user: null,
  },

  onLoad() {
    this.loadPage();
  },

  onPullDownRefresh() {
    this.loadPage().finally(() => wx.stopPullDownRefresh());
  },

  async loadPage() {
    this.setData({ loading: true, error: "" });
    try {
      const user = await auth.ensureSession();
      const records = await resumes.listResumes();
      const items = records.map((item) => ({
        ...item,
        updatedAtLabel: formatUpdatedAt(item.updated_at),
      }));
      this.setData({ user, items, loading: false });
    } catch (error) {
      if (error.code === "AGREEMENT_REQUIRED" || error.code === "PRIVACY_AGREEMENT_REQUIRED") {
        wx.reLaunch({ url: "/pages/login/index" });
        return;
      }
      this.setData({ loading: false, error: error.message || "加载失败，请稍后重试" });
    }
  },
});
