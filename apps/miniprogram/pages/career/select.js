const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
Page({
  data: { loading: true, error: "", applications: [] },
  onShow() {
    return this.load();
  },
  async load() {
    if (!auth.hasSession()) {
      this.setData({
        loading: false,
        error: "请先登录账号。",
        applications: [],
      });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      let cursor;
      const applications = [];
      do {
        const body = await api.listApplications({ limit: 100, cursor });
        applications.push(
          ...body.items
            .map((a) => c.applicationCard(a))
            .filter((a) => a.canSchedule),
        );
        cursor = body.next_cursor;
      } while (cursor);
      this.setData({ applications });
    } catch (e) {
      this.setData({ error: c.errorText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  select(e) {
    wx.navigateTo({
      url: `/pages/career/form?mode=schedule&applicationId=${encodeURIComponent(e.currentTarget.dataset.id)}`,
    });
  },
});
