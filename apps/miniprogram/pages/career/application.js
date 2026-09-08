const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
Page({
  data: {
    id: "",
    loading: true,
    error: "",
    app: null,
    sessions: [],
    history: false,
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
        app: null,
        sessions: [],
      });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const body = await api.getApplication(this.data.id);
      const sessions = [];
      let cursor;
      do {
        const page = await api.listSessions({
          applicationId: this.data.id,
          scope: "all",
          limit: 100,
          cursor,
        });
        sessions.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor);
      const app = c.applicationView(body.application, sessions);
      const ordered = sessions.map(c.sessionCard).reverse();
      const activeSession = ordered.find((item) => item.application_stage_id === (app.current_stage && app.current_stage.id) && item.status === "scheduled");
      this.setData({
        app,
        previewSessions: ordered.slice(0, 2),
        primaryAction: app.canAdvance ? app.phase === "pending" ? {mode:"stage", label:"记录投递信息"} : activeSession ? {mode:"record", sessionId:activeSession.id, label:"填写面试记录"} : app.canSchedule ? {mode:"schedule", label:"添加安排"} : {mode:"stage",label:"添加下一阶段"} : app.tone === "offer" ? {mode:"offer",label:"编辑 Offer 信息"} : null,
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
      this.setData({ error: c.errorText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  openSession(e) {
    wx.navigateTo({
      url: `/pages/career/session?id=${encodeURIComponent(e.currentTarget.dataset.id)}`,
    });
  },
  openForm(e) {
    wx.navigateTo({
      url: `/pages/career/form?applicationId=${encodeURIComponent(this.data.id)}&mode=${e.currentTarget.dataset.mode}`,
    });
  },
  primary() {
    const action = this.data.primaryAction;
    if (!action) return;
    wx.navigateTo({url: "/pages/career/form?applicationId=" + encodeURIComponent(this.data.id) + "&mode=" + action.mode + (action.sessionId ? "&sessionId=" + encodeURIComponent(action.sessionId) : "")});
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
    if (this.data.app.canAdvance && this.data.app.phase !== "pending") items.unshift({label:"添加下一阶段",mode:"stage"});
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
