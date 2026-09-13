const { getStatusBarHeight } = require('../../utils/system');
Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false },
    managedBack: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    fallback: { type: String, value: '/pages/resumes/index' },
  },
  data: { statusBarHeight: 0 },
  lifetimes: { attached() { this.updateMetrics(); } },
  pageLifetimes: { resize() { this.updateMetrics(); } },
  methods: {
    updateMetrics() { this.setData({ statusBarHeight: getStatusBarHeight() }); },
    goBack() {
      if (this.properties.disabled) return;
      if (this.properties.managedBack) { this.triggerEvent('back'); return; }
      wx.navigateBack({ fail: () => wx.switchTab({ url: this.properties.fallback }) });
    },
  },
});
