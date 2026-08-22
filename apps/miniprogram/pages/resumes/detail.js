const resumes = require("../../services/resumes");
const { toDisplayResume } = require("../../utils/resume");

Page({
  data: { loading: true, error: "", retryable: false, resume: null, resumeId: "" },

  onLoad(options) {
    const id = decodeURIComponent(options.id || "");
    if (!id) {
      this.setData({ loading: false, error: "简历不存在" });
      return;
    }
    this.setData({ resumeId: id });
    this.loadResume(id);
  },

  async loadResume(id) {
    this.setData({ loading: true, error: "", retryable: false });
    try {
      const record = await resumes.getResume(id);
      wx.setNavigationBarTitle({ title: record.title || "简历详情" });
      this.setData({ loading: false, resume: toDisplayResume(record) });
    } catch (error) {
      const message = error.statusCode === 404 ? "简历不存在或无权查看" : (error.message || "加载失败");
      this.setData({ loading: false, error: message, retryable: error.statusCode !== 404 });
    }
  },

  retryLoad() {
    if (!this.data.resumeId) return Promise.resolve();
    return this.loadResume(this.data.resumeId);
  },

  backToResumes() {
    wx.reLaunch({ url: "/pages/resumes/index" });
  },
});
