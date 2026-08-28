const auth = require("../../services/auth");
const cache = require("../../services/resumePreviewCache");
const resumes = require("../../services/resumes");

const DEMO_RESUME_ID = "__linkresume_demo_resume__";
const DEMO_RESUME = {
  label: "示例简历 · 内容为虚构信息",
  name: "林知遥",
  role: "产品设计师 / UX Designer",
  location: "杭州 · 可远程",
  email: "lin.xxx@example.com",
  phone: "138 XXXX XXXX",
  summary: "专注于把复杂工具变成清晰、易用的产品体验。擅长从用户研究、信息架构到交互落地，和工程团队一起交付可持续迭代的产品。",
  experience: [
    {
      company: "星河工作室",
      role: "高级产品设计师",
      period: "2022.03 — 2025.06",
      details: [
        "负责协作产品从调研到上线的完整设计流程，推动核心任务完成率提升 32%。",
        "建立组件和内容规范，协同 4 人设计团队缩短交付周期。",
      ],
    },
    {
      company: "远岸科技",
      role: "产品设计师",
      period: "2020.07 — 2022.02",
      details: [
        "为中小企业客户设计数据看板与移动端工作流，持续优化信息层级和操作反馈。",
        "通过可用性测试沉淀 20 余条设计原则，支持多个业务团队复用。",
      ],
    },
  ],
  projects: [
    {
      name: "团队知识空间",
      description: "从零搭建文档导航与权限协作体验，帮助团队更快找到并复用信息。",
    },
    {
      name: "新手引导重构",
      description: "将首次使用流程拆成渐进式任务，降低理解成本并提升关键功能触达。",
    },
  ],
  skills: ["用户研究", "交互设计", "信息架构", "原型设计", "设计系统", "Figma"],
  education: {
    school: "南岸大学",
    major: "数字媒体艺术 · 学士",
    period: "2016 — 2020",
  },
};

function isDemoResumeId(id) {
  return String(id || "") === DEMO_RESUME_ID;
}

Page({
  data: {
    loading: true,
    progress: 0,
    error: "",
    resumeId: "",
    previewPath: "",
    isDemo: false,
    demoResume: DEMO_RESUME,
  },

  onLoad(options) {
    const id = decodeURIComponent(options.id || "");
    if (!id) {
      this.setData({ loading: false, error: "简历不存在" });
      return;
    }
    if (isDemoResumeId(id)) {
      this.showDemo(id);
      return;
    }
    wx.setNavigationBarTitle({ title: "简历预览" });
    this.setData({ resumeId: id });
    void this.openPreview(id);
  },

  showDemo(id) {
    if (typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title: "示例简历" });
    }
    this.setData({
      loading: false,
      progress: 100,
      error: "",
      resumeId: id,
      previewPath: "",
      isDemo: true,
      demoResume: DEMO_RESUME,
    });
  },

  openPreview(id) {
    if (isDemoResumeId(id)) {
      this.showDemo(id);
      return Promise.resolve();
    }
    if (this.openingPromise) return this.openingPromise;
    const task = this.loadPreview(id).finally(() => {
      if (this.openingPromise === task) this.openingPromise = null;
    });
    this.openingPromise = task;
    return task;
  },

  async loadPreview(id) {
    if (isDemoResumeId(id)) {
      this.showDemo(id);
      return;
    }
    this.setData({ loading: true, progress: 0, error: "", previewPath: "", isDemo: false });
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
    if (!this.data.resumeId || isDemoResumeId(this.data.resumeId) || this.recoveringPreview) return;
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
