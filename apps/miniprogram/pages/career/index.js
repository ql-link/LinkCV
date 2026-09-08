const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
const { getStatusBarHeight } = require("../../utils/system");
async function collect(method, options) {
  const items = [],
    seen = new Set();
  let cursor;
  do {
    const body = await method({ ...options, limit: 100, cursor });
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
    date: c.dateParts().date,
    dateLabel: c.dayLabel(c.dateParts().date),
    loading: false,
    guest: true,
    error: "",
    keyword: "",
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
    if (this.getTabBar && this.getTabBar())
      this.getTabBar().setData({ selected: 1, hidden: this.data.scheduleSheetOpen });
    return this.loadPage();
  },
  onUnload() {
    this._request = (this._request || 0) + 1;
  },
  async loadPage() {
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
    this.setData({ loading: true, guest: false, error: "" });
    try {
      const day = this.data.date;
      this.setData({ dateLabel: c.dayLabel(day) });
      const options = {
        startAt: c.iso(day, "00:00"),
        endAt: c.iso(c.shiftDate(day, 1), "00:00"),
      };
      const [applications, sessions] = await Promise.all([
        collect(api.listApplications, { scope: "active" }),
        collect(api.listSessions, options),
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
  async onPullDownRefresh() {
    try {
      await this.loadPage();
    } finally {
      wx.stopPullDownRefresh();
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
    wx.navigateTo({
      url: `/pages/career/application?id=${encodeURIComponent(e.currentTarget.dataset.id)}`,
    });
  },
  openSession(e) {
    wx.navigateTo({
      url: `/pages/career/session?id=${encodeURIComponent(e.currentTarget.dataset.id)}`,
    });
  },
  addSchedule() {
    this.setData({scheduleSheetOpen: true});
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({hidden: true});
  },
  closeSchedule(e) {
    this.setData({scheduleSheetOpen: false});
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({hidden: false});
    if (e.detail && e.detail.refresh) return this.loadPage();
  },
  scheduleSaved(e) {
    this.closeSchedule({detail: {}});
    this.setData({date: e.detail.date || this.data.date});
    return this.loadPage();
  },
  goLogin() {
    wx.navigateTo({
      url: `/pages/login/index?returnTo=${encodeURIComponent("/pages/career/index")}`,
    });
  },
});
module.exports.collect = collect;
