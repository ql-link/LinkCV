const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
const { getStatusBarHeight } = require("../../utils/system");
async function collect(method, options, prefetchKey) {
  const items = [],
    seen = new Set();
  let cursor;
  do {
    const load = () => method({ ...options, limit: 100, cursor });
    const body = await (prefetchKey && !cursor
      ? require('../../services/tabPrefetch').take(prefetchKey, load)
      : load());
    items.push(...body.items);
    cursor = body.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error("重复的分页游标");
    seen.add(cursor);
  } while (cursor);
  return items;
}
Page({
  data: {
    statusBarHeight: getStatusBarHeight(),
    activeTab: "schedule",
    scheduleSheetOpen: false,
    sessionId: "",
    date: c.dateParts().date,
    dateLabel: c.dayLabel(c.dateParts().date),
    loading: false,
    refresherTriggered: false,
    guest: true,
    error: "",
    keyword: "",
    searchFocused: false,
    filter: "all",
    applications: [],
    visibleApplications: [],
    sessions: [],
    timeline: c.timeline([], c.dateParts().date),
    filters: [
      { value: "all", label: "全部" },
      { value: "pending", label: "待投递" },
      { value: "applied", label: "已投递" },
      { value: "offer", label: "Offer" },
      { value: "terminated", label: "已终止" },
    ],
  },
  onShow() {
    this._openingApplication = false;
    if (this.getTabBar && this.getTabBar())
      this.getTabBar().setData({
        selected: 1,
        hidden: this.data.scheduleSheetOpen || !!this.data.sessionId,
      });
    const initial = !this._shown;
    this._shown = true;
    return this.loadPage({ initial });
  },
  onUnload() {
    this._request = (this._request || 0) + 1;
  },
  onReady() {
    require('../../services/tabResources').prepare();
  },
  async loadPage({ initial = false } = {}) {
    const token = (this._request = (this._request || 0) + 1);
    if (!auth.hasSession()) {
      this.setData({
        guest: true,
        loading: false,
        applications: [],
        visibleApplications: [],
        sessions: [],
        error: "",
        timeline: c.timeline([], this.data.date),
      });
      return;
    }
    this.setData({
      loading: !this.data.applications.length && !this.data.sessions.length,
      guest: false,
      error: "",
    });
    try {
      const day = this.data.date;
      this.setData({ dateLabel: c.dayLabel(day) });
      const options = {
        startAt: c.iso(day, "00:00"),
        endAt: c.iso(c.shiftDate(day, 1), "00:00"),
      };
      const [applications, sessions] = await Promise.all([
        collect(api.listApplications, { scope: "active" }, initial ? 'applications' : ''),
        collect(api.listSessions, options, initial ? 'sessions:' + day : ''),
      ]);
      if (token !== this._request) return;
      this.setData({
        applications: applications.map((a) => c.applicationCard(a)),
        sessions: sessions.map(c.sessionCard),
        timeline: c.timeline(sessions, day),
      });
      this.applyFilters();
    } catch (error) {
      if (token === this._request)
        this.setData({ error: c.errorText(error), guest: !auth.hasSession() });
    } finally {
      if (token === this._request) this.setData({ loading: false });
    }
  },
  async handleRefresherRefresh() {
    if (this.data.refresherTriggered) return;
    this.setData({ refresherTriggered: true });
    try {
      await this.loadPage();
    } finally {
      this.setData({ refresherTriggered: false });
    }
  },
  retryLoad() {
    return this.loadPage();
  },
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },
  changeDate(e) {
    this.setData({ date: e.detail.value });
    return this.loadPage();
  },
  focusSearch() {
    this.setData({ searchFocused: true });
  },
  blurSearch() {
    this.setData({ searchFocused: false });
  },
  search(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilters();
  },
  filter(e) {
    this.setData({ filter: e.currentTarget.dataset.value });
    this.applyFilters();
  },
  applyFilters() {
    const { keyword, filter, applications } = this.data;
    this.setData({
      visibleApplications: applications.filter(
        (a) =>
          (!keyword ||
            `${a.company_name_snapshot} ${a.job_title_snapshot}`
              .toLowerCase()
              .includes(keyword.trim().toLowerCase())) &&
          (filter === "all" ||
            (filter === "pending" && a.phase === "pending" && a.canAdvance) ||
            (filter === "applied" && a.phase === "applied" && a.canAdvance) ||
            (filter === "offer" && a.tone === "offer") ||
            (filter === "terminated" && !a.canTerminate)),
      ),
    });
  },
  openApplication(e) {
    if (this._openingApplication) return;
    this._openingApplication = true;
    wx.showLoading?.({ title: "正在打开…", mask: true });
    wx.navigateTo({
      url: "/pages/career/application?id=" + encodeURIComponent(e.currentTarget.dataset.id),
      success: () => { this._openingApplication = false; wx.hideLoading?.(); },
      fail: () => {
        this._openingApplication = false;
        wx.hideLoading?.();
        wx.showToast({ title: "页面打开失败，请重试", icon: "none" });
      },
    });
  },
  openSession(e) {
    this.setData({ sessionId: e.currentTarget.dataset.id });
    if (this.getTabBar && this.getTabBar())
      this.getTabBar().setData({ hidden: true });
  },
  closeSession() {
    this.setData({ sessionId: "" });
    if (this.getTabBar && this.getTabBar())
      this.getTabBar().setData({ hidden: false });
  },
  addSchedule() {
    this.setData({ scheduleSheetOpen: true });
    if (this.getTabBar && this.getTabBar())
      this.getTabBar().setData({ hidden: true });
  },
  closeSchedule(e) {
    this.setData({ scheduleSheetOpen: false });
    if (this.getTabBar && this.getTabBar())
      this.getTabBar().setData({ hidden: false });
    if (e.detail && e.detail.refresh) return this.loadPage();
  },
  scheduleSaved(e) {
    this.closeSchedule({ detail: {} });
    this.setData({ date: e.detail.date || this.data.date });
    return this.loadPage();
  },
  goLogin() {
    wx.navigateTo({
      url: `/pages/login/index?returnTo=${encodeURIComponent("/pages/career/index")}`,
    });
  },
});
module.exports.collect = collect;
