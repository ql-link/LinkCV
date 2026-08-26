const auth = require("../../services/auth");
const cache = require("../../services/resumePreviewCache");
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

  async loadPage() {
    this.setData({ loading: true, error: "", guest: false });
    try {
      const user = await auth.ensureSession();
      const records = await resumes.listResumes();
      const items = records.map((item) => ({
        ...item,
        updatedAtLabel: formatUpdatedAt(item.updated_at),
        previewUrl: "",
      }));
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
