const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
const detail = require("../../utils/careerDetail");
Page({
  data: {
    id: "",
    loading: true,
    error: "",
    app: null,
    sessions: [],
    history: false,
    sessionId: "",
    scheduleSheetOpen: false,
  },
  onLoad(options) {
    this.setData({ id: options.id || "" });
  },
  onShow() { if (this._ready) return this.load(); },
  onReady() {
    this._ready = true;
    wx.hideLoading?.();
    return this.load();
  },
  onUnload() { this._disposed = true; this._loadId = (this._loadId || 0) + 1; },
  async load() {
    const loadId = this._loadId = (this._loadId || 0) + 1;
    const current = () => !this._disposed && loadId === this._loadId;
    if (!auth.hasSession()) {
      this.setData({
        loading: false,
        error: "登录已失效，请返回求职页重新登录。",
        app: null,
        sessions: [],
      });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const applicationPromise = api.getApplication(this.data.id).then(body => {
        if (current()) this.setData({ app: c.applicationView(body.application), job: detail.jobContent(body.application), progress: detail.progress(body.application) });
        return body;
      });
      const sessionsPromise = (async () => {
        const sessions = [], seen = new Set();
        let cursor;
        do {
          const page = await api.listSessions({applicationId: this.data.id, scope: "all", limit: 100, cursor});
          if (!current()) return sessions;
          sessions.push(...page.items);
          cursor = page.next_cursor;
          if (cursor && seen.has(cursor)) throw new Error("重复的分页游标");
          if (cursor) seen.add(cursor);
        } while (cursor);
        return sessions;
      })();
      const [body, sessions] = await Promise.all([applicationPromise, sessionsPromise]);
      if (!current()) return;
      const app = c.applicationView(body.application, sessions);
      const ordered = sessions.map(c.sessionCard).reverse();
      const activeSession = ordered.find(
        (item) =>
          item.application_stage_id ===
            (app.current_stage && app.current_stage.id) &&
          item.status === "scheduled",
      );
      this.setData({
        app,
        job: detail.jobContent(body.application),
        progress: detail.progress(body.application, sessions),
        previewSessions: ordered.slice(0, 2),
        primaryAction: app.canAdvance
          ? app.phase === "pending"
            ? { mode: "stage", label: "记录投递信息" }
            : activeSession
              ? {
                  mode: "record",
                  sessionId: activeSession.id,
                  label: "填写面试记录",
                }
              : app.canSchedule
                ? { mode: "schedule", label: "添加安排" }
                : { mode: "stage", label: "添加下一阶段" }
          : app.tone === "offer"
            ? { mode: "offer", label: "编辑 Offer 信息" }
            : null,
        sessions: sessions.map(c.sessionCard).reverse(),
        currentSessions: sessions
          .filter(
            (s) =>
              s.application_stage_id ===
              (app.current_stage && app.current_stage.id),
          )
          .map(c.sessionCard)
          .reverse(),
      });
    } catch (e) {
      if (current()) this.setData({ error: c.errorText(e) });
    } finally {
      if (current()) this.setData({ loading: false });
    }
  },
  openSession(e) {
    this.setData({ sessionId: e.currentTarget.dataset.id });
  },
  closeSession() {
    this.setData({ sessionId: "" });
  },
  stage() {
    if (this.data.loading || !this.data.app) return;
    if (this.data.app.stage_state === "scheduled") {
      const s = this.data.currentSessions.find((s) => s.status === "scheduled");
      if (s) this.setData({ sessionId: s.id });
      wx.showToast({ title: "请先处理当前面试安排", icon: "none" });
      return;
    }
    this.setData({ scheduleSheetOpen: true });
  },
  closeSchedule() {
    this.setData({ scheduleSheetOpen: false });
    return this.load();
  },
  openForm(e) {
    wx.navigateTo({
      url: `/pages/career/form?applicationId=${encodeURIComponent(this.data.id)}&mode=${e.currentTarget.dataset.mode}`,
    });
  },
  primary() {
    const action = this.data.primaryAction;
    if (!action) return;
    wx.navigateTo({
      url:
        "/pages/career/form?applicationId=" +
        encodeURIComponent(this.data.id) +
        "&mode=" +
        action.mode +
        (action.sessionId
          ? "&sessionId=" + encodeURIComponent(action.sessionId)
          : ""),
    });
  },
  toggleHistory() {
    this.setData({ history: !this.data.history });
  },
  openMaterial(e) {
    wx.navigateTo({
      url: `/pages/career/material?applicationId=${encodeURIComponent(this.data.id)}&kind=${e.currentTarget.dataset.kind}`,
    });
  },
  more() {
    const items = [{ label: "查看岗位内容", kind: "job" }];
    if (this.data.app.canAdvance && this.data.app.phase !== "pending")
      items.unshift({ label: "添加下一阶段", mode: "stage" });
    if (this.data.app.resume_version_id)
      items.push({ label: "查看投递简历", kind: "resume" });
    if (this.data.app.canTerminate)
      items.push({ label: "终止求职", mode: "terminate" });
    wx.showActionSheet({
      itemList: items.map((i) => i.label),
      success: ({ tapIndex }) => {
        const item = items[tapIndex];
        if (item.mode) this.openForm({ currentTarget: { dataset: item } });
        else this.openMaterial({ currentTarget: { dataset: item } });
      },
    });
  },
});
