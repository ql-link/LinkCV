const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
Page({
  data: {
    id: "",
    loading: true,
    error: "",
    session: null,
    app: null,
    saving: false,
  },
  onLoad(options) {
    this.setData({ id: options.id || "" });
  },
  onShow() {
    return this.load();
  },
  async load() {
    if (!auth.hasSession()) {
      this.setData({
        loading: false,
        error: "登录已失效，请返回求职页重新登录。",
        session: null,
        app: null,
      });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const body = await api.getSession(this.data.id);
      this.setData({
        session: c.sessionView(body.session),
        app: c.applicationView(body.application),
        editable:
          !body.application.archived_at &&
          body.application.lifecycle_status === "active" &&
          body.session.status === "scheduled",
      });
    } catch (e) {
      this.setData({ error: c.errorText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  openForm(e) {
    wx.navigateTo({
      url: `/pages/career/form?applicationId=${encodeURIComponent(this.data.app.id)}&sessionId=${encodeURIComponent(this.data.id)}&mode=${e.currentTarget.dataset.mode}`,
    });
  },
  openApplication() {
    wx.navigateTo({
      url: `/pages/career/application?id=${encodeURIComponent(this.data.app.id)}`,
    });
  },
  copy(e) {
    const value = this.data.session[e.currentTarget.dataset.field];
    if (value) wx.setClipboardData({ data: value });
  },
  async complete() {
    if (
      this.data.saving ||
      !(await c.confirm(
        "确认完成本场面试？",
        "仅将本场标记为已完成，求职阶段保持不变。",
        "确认完成",
      ))
    )
      return;
    this.setData({ saving: true });
    try {
      await api.completeSession(this.data.id, {
        base_lock_version: this.data.session.lock_version,
      });
      await this.load();
    } catch (e) {
      wx.showModal({
        title: "未能完成本场面试",
        content: c.errorText(e),
        showCancel: false,
      });
    } finally {
      this.setData({ saving: false });
    }
  },
  async cancel() {
    if (
      this.data.saving ||
      !(await c.confirm(
        "取消本场安排？",
        "取消后不再显示在待进行的安排中。已有面试记录仍会保留，不终止这次求职。",
        "取消安排",
      ))
    )
      return;
    this.setData({ saving: true });
    try {
      await api.cancelSession(this.data.id, {
        base_lock_version: this.data.session.lock_version,
      });
      await this.load();
    } catch (e) {
      wx.showModal({
        title: "未能取消安排",
        content: c.errorText(e),
        showCancel: false,
      });
    } finally {
      this.setData({ saving: false });
    }
  },
  more() {
    wx.showActionSheet({
      itemList: ["修改安排", "取消本场安排"],
      success: ({ tapIndex }) =>
        tapIndex === 0
          ? this.openForm({ currentTarget: { dataset: { mode: "schedule" } } })
          : this.cancel(),
    });
  },
});
