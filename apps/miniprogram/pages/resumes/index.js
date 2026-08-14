const auth = require("../../services/auth");
const resumes = require("../../services/resumes");

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
      const items = await resumes.listResumes();
      this.setData({ user, items, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "加载失败，请稍后重试" });
    }
  },

  openResume(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/resumes/detail?id=${encodeURIComponent(id)}` });
  },
});
