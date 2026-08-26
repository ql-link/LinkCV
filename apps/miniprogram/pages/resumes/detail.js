const auth = require("../../services/auth");
const cache = require("../../services/resumePreviewCache");
const resumes = require("../../services/resumes");

Page({
  data: {
    loading: true,
    progress: 0,
    error: "",
    resumeId: "",
    previewPath: "",
    scaleValue: 1,
  },

  onLoad(options) {
    const id = decodeURIComponent(options.id || "");
    if (!id) {
      this.setData({ loading: false, error: "简历不存在" });
      return;
    }
    wx.setNavigationBarTitle({ title: "简历预览" });
    this.setData({ resumeId: id });
    void this.openPreview(id);
  },

  openPreview(id) {
    if (this.openingPromise) return this.openingPromise;
    const task = this.loadPreview(id).finally(() => {
      if (this.openingPromise === task) this.openingPromise = null;
    });
    this.openingPromise = task;
    return task;
  },

  async loadPreview(id) {
    this.setData({ loading: true, progress: 0, error: "", previewPath: "" });
    let pendingFilePath = "";
    try {
      const user = auth.getCurrentUser();
      if (!user || !user.id) throw new Error("登录状态已失效");
      const resume = await resumes.getResume(id);
      const versionId = resume.pdf_version_id;
      let filePath = await cache.getCachedResumePreview(user.id, id, versionId);
      if (filePath) {
        this.setData({ loading: false, progress: 100, previewPath: filePath });
        return;
      }

      filePath = cache.resumePreviewPath(user.id, id, versionId);
      pendingFilePath = filePath;
      const downloadedPath = await resumes.downloadResumePreview(
        id,
        versionId,
        filePath,
        ({ progress }) => this.setData({ progress: Math.max(0, Math.min(100, progress || 0)) }),
      );
      await cache.validateResumePreview(downloadedPath);
      await cache.commitResumePreview(user.id, id, versionId, downloadedPath);
      pendingFilePath = "";
      this.setData({ loading: false, progress: 100, previewPath: downloadedPath });
    } catch (error) {
      if (pendingFilePath) await cache.removeFile(pendingFilePath);
      let message = error.message || "加载失败";
      if (error.statusCode === 404) message = "简历不存在或无权查看";
      if (error.statusCode === 413) message = "简历内容过长，暂时无法生成预览图";
      if (error.statusCode >= 500) message = "预览图生成失败，请稍后重试";
      this.setData({ loading: false, error: message });
    }
  },

  retryLoad() {
    if (!this.data.resumeId) return Promise.resolve();
    this.imageRecoveryAttempts = 0;
    return this.openPreview(this.data.resumeId);
  },

  async handlePreviewError() {
    if (!this.data.resumeId || this.recoveringPreview) return;
    if ((this.imageRecoveryAttempts || 0) >= 1) {
      this.setData({ previewPath: "", error: "预览图无法显示，请重新加载" });
      return;
    }
    this.imageRecoveryAttempts = (this.imageRecoveryAttempts || 0) + 1;
    this.recoveringPreview = true;
    try {
      const user = auth.getCurrentUser();
      if (user && user.id) await cache.invalidateResumePreview(user.id, this.data.resumeId);
      this.setData({ previewPath: "" });
      await this.openPreview(this.data.resumeId);
    } finally {
      this.recoveringPreview = false;
    }
  },

  zoomIn() {
    const next = Math.min(4, Number(((this.data.scaleValue || 1) + 0.5).toFixed(1)));
    this.setData({ scaleValue: next });
  },

  zoomOut() {
    const next = Math.max(1, Number(((this.data.scaleValue || 1) - 0.5).toFixed(1)));
    this.setData({ scaleValue: next });
  },

  resetZoom() {
    this.setData({ scaleValue: 1 });
  },

  handleImagePreview() {
    if (!this.data.previewPath) return;
    wx.previewImage({
      current: this.data.previewPath,
      urls: [this.data.previewPath],
    });
  },

  backToResumes() {
    wx.reLaunch({ url: "/pages/resumes/index" });
  },
});
