const c = require("../../utils/career");
const t = require("../../utils/careerTime");
// 挂在日期控件下面的月历挂窗：和面试时间选择器共用同一套月历排布，但不做遮罩覆盖，
// 外层点击收起的责任在调用方，这里只负责选日期和翻月。
Component({
  properties: {
    date: { type: String, value: "" },
  },
  data: {
    weeks: [],
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
    month: "",
    monthLabel: "",
  },
  observers: {
    date(date) {
      if (date) this.render(date.slice(0, 7), date);
    },
  },
  methods: {
    noop() {},
    render(month, selected) {
      const days = t.monthDays(month, selected);
      const [year, label] = month.split("-");
      this.setData({
        month,
        monthLabel: `${year}年${Number(label)}月`,
        weeks: Array.from({ length: 6 }, (_, i) => ({
          key: days[i * 7].value,
          days: days.slice(i * 7, i * 7 + 7),
        })),
      });
    },
    navigate(e) {
      this.render(
        t.shiftMonth(this.data.month, Number(e.currentTarget.dataset.delta)),
        this.properties.date,
      );
    },
    selectDate(e) {
      const date = e.currentTarget.dataset.date;
      if (date) this.triggerEvent("select", { date });
    },
  },
});
