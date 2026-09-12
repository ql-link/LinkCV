Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: "/pages/resumes/index",
        text: "简历",
        icon: "resume",
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
      const data = event.currentTarget.dataset;
      const url = data.path;
      wx.switchTab({ url });
    },
  },
});
