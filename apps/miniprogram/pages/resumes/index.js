const auth = require("../../services/auth");
const cache = require("../../services/resumePreviewCache");
const resumes = require("../../services/resumes");
const { formatUpdatedAt } = require("../../utils/resume");
const { getStatusBarHeight } = require("../../utils/system");

const DEMO_RESUME_ID = "__linkresume_demo_resume__";
const DEMO_RESUME_LABEL = "示例简历 · 内容为虚构信息";
const DEMO_RESUME_ITEM = {
  id: DEMO_RESUME_ID,
  title: "林知遥的简历",
  demoLabel: DEMO_RESUME_LABEL,
  updatedAtLabel: "仅供体验 · 不代表真实用户",
  previewUrl: "",
  isDemo: true,
};

Page({
  data: {
    loading: true,
    guest: false,
    error: "",
    items: [],
    user: null,
    statusBarHeight: getStatusBarHeight(),
    refresherTriggered: false,
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

  handleRefresherRefresh() {
    this.setData({ refresherTriggered: true });
    if (this.data.guest || !auth.hasSession()) {
      this.setData({ refresherTriggered: false });
      return Promise.resolve();
    }
    return this.loadPage({ silent: true }).finally(() => {
      this.setData({ refresherTriggered: false });
    });
  },

  enterGuestMode() {
    this.setData({
      guest: true,
      loading: false,
      error: "",
      items: [{ ...DEMO_RESUME_ITEM }],
      user: null,
    });
  },

  async prefetchPreviews(user, items) {
    if (!user || !user.id || !Array.isArray(items) || items.length === 0) return;
    const updated = [...items];
    let changed = false;

    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      const versionId = item.pdf_version_id;
      if (!versionId) continue;

      try {
        const cached = await cache.getCachedResumePreview(user.id, item.id, versionId);
        if (cached) {
          if (updated[i].previewUrl !== cached) {
            updated[i] = { ...updated[i], previewUrl: cached };
            changed = true;
          }
          continue;
        }

        const filePath = cache.resumePreviewPath(user.id, item.id, versionId);
        resumes
          .downloadResumePreview(item.id, versionId, filePath)
          .then(async (downloaded) => {
            await cache.validateResumePreview(downloaded);
            await cache.commitResumePreview(user.id, item.id, versionId, downloaded);
            const currentItems = this.data.items || [];
            const idx = currentItems.findIndex((it) => it.id === item.id);
            if (idx >= 0) {
              this.setData({ [`items[${idx}].previewUrl`]: downloaded });
            }
          })
          .catch(() => {
            // 静默降级，保留占位
          });
      } catch {
        // 静默降级
      }
    }

    if (changed) {
      this.setData({ items: updated });
    }
  },

  async loadPage(options = {}) {
    const isSilent = Boolean(options && options.silent);
    if (!isSilent) {
      this.setData({ loading: true, error: "", guest: false });
    } else {
      this.setData({ error: "", guest: false });
    }
    try {
      const user = await auth.ensureSession();
      const records = await resumes.listResumes();
      const currentItems = this.data.items || [];
      const items = (Array.isArray(records) ? records : [])
        .filter((item) => item && String(item.id) !== DEMO_RESUME_ID && !item.isDemo)
        .map((item) => {
          const existing = currentItems.find((it) => it.id === item.id);
          const previewUrl = existing && existing.pdf_version_id === item.pdf_version_id
            ? (existing.previewUrl || "")
            : "";
          return {
            ...item,
            updatedAtLabel: formatUpdatedAt(item.updated_at),
            previewUrl,
          };
        });
      this.setData({ user, items, loading: false });
      void this.prefetchPreviews(user, items);
    } catch (error) {
      if (!auth.hasSession()) {
        this.enterGuestMode();
        return;
      }
      this.setData({ loading: false, error: error.message || "加载失败，请稍后重试" });
    }
  },
});
