const c = require('./career');
const pad = n => String(n).padStart(2, '0');
function monthDays(month, selected) {
  const [year, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({length: 42}, (_, i) => {
    const date = new Date(Date.UTC(year, m - 1, i - offset + 1));
    const value = date.toISOString().slice(0,10);
    return {value, day: date.getUTCDate(), adjacent: value.slice(0,7) !== month, selected: value === selected};
  });
}
function shiftMonth(month, delta) {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0,7);
}
function withDuration(form, minutes) {
  if (!/^\d+$/.test(String(minutes)) || Number(minutes) <= 0) throw new Error('请输入大于 0 的整数分钟数。');
  if (!form.startDate || !form.startTime) return {...form, endDate:'', endTime:''};
  const end = new Date(new Date(c.iso(form.startDate, form.startTime)).getTime() + Number(minutes) * 60000);
  if (!Number.isFinite(end.getTime())) throw new Error('时长超出支持范围。');
  const parts = c.dateParts(end.toISOString());
  return {...form, endDate: parts.date, endTime: parts.time};
}
module.exports = {pad, monthDays, shiftMonth, withDuration};
