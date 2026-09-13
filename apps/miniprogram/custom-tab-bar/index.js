Component({
  properties: {
    selected: { type: Number, value: 0 },
    hidden: { type: Boolean, value: false },
  },
  data: {
    list: [
      {
        pagePath: "/pages/resumes/index",
        text: "简历",
        icon: "resume",
      },
      {
        pagePath: "/pages/career/index",
        text: "求职",
        icon: "career",
      },
      {
        pagePath: "/pages/profile/index",
        text: "我的",
        icon: "profile",
      },
    ],
  },
  methods: {
    switchTab(event) {
      if (this._switching) return;
      const data = event.currentTarget.dataset;
      const url = data.path;
      if (!this.data.list.some(item => item.pagePath === url)) return;
      const previous = this.data.selected;
      this._switching = true;
      this.setData({ selected: Number(data.index) });
      wx.switchTab({
        url,
        fail: () => {
          this.setData({ selected: previous });
          wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
        },
        complete: () => {
          this._switching = false;
        },
      });
    },
  },
});
