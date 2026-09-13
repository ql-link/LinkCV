const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
const detail = require("../../utils/careerDetail");
Page({
  data: {
    applicationId: "",
    kind: "job",
    loading: true,
    error: "",
    app: null,
    previewPath: "",
  },
  onLoad(options) {
    this.setData({
      applicationId: options.applicationId || "",
      kind: options.kind === "resume" ? "resume" : "job",
    });
    wx.setNavigationBarTitle({
      title: this.data.kind === "resume" ? "查看关联简历" : "岗位内容",
    });
    return this.load();
  },
  onUnload() {
    this._unloaded = true;
    this.removePreview();
  },
  removePreview() {
    const filePath = this.data.previewPath;
    if (filePath && wx.getFileSystemManager)
      wx.getFileSystemManager().unlink({ filePath, fail() {} });
  },
  async load() {
    if (!auth.hasSession()) {
      this.removePreview();
      this.setData({
        loading: false,
        error: "登录已失效，请返回求职页重新登录。",
        app: null,
        previewPath: "",
      });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const { application } = await api.getApplication(this.data.applicationId);
      this.setData({
        app: application,
        job: detail.jobContent(application),
      });
      if (this.data.kind === "resume") {
        const previewPath = await api.downloadApplicationResume(application.id);
        if (this._unloaded) {
          wx.getFileSystemManager().unlink({
            filePath: previewPath,
            fail() {},
          });
          return;
        }
        this.removePreview();
        this.setData({ previewPath });
      }
    } catch (e) {
      if (!this._unloaded) this.setData({ error: c.errorText(e) });
    } finally {
      if (!this._unloaded) this.setData({ loading: false });
    }
  },
  preview() {
    if (this.data.previewPath)
      wx.previewImage({
        urls: [this.data.previewPath],
        current: this.data.previewPath,
      });
  },
  imageError() {
    this.setData({ error: "简历预览无法显示，请重新加载。" });
  },
});
