function padZero(num) {
  return num < 10 ? `0${num}` : `${num}`;
}

function parseDate(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  return isNaN(d.getTime()) ? null : d;
}

function formatRelativeDate(isoString) {
  const d = parseDate(isoString);
  if (!d) return "";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((targetDay - today) / (1000 * 60 * 60 * 24));

  const timeStr = `${padZero(d.getHours())}:${padZero(d.getMinutes())}`;

  if (diffDays === 0) return `今天 ${timeStr}`;
  if (diffDays === 1) return `明天 ${timeStr}`;
  if (diffDays === 2) return `后天 ${timeStr}`;
  if (diffDays === -1) return `昨天 ${timeStr}`;

  const month = d.getMonth() + 1;
  const date = d.getDate();
  return `${month}月${date}日 ${timeStr}`;
}

function formatSessionTimeRange(startIso, endIso) {
  const start = parseDate(startIso);
  const end = parseDate(endIso);
  if (!start) return "";

  const startTimeStr = `${padZero(start.getHours())}:${padZero(start.getMinutes())}`;
  const endTimeStr = end ? `${padZero(end.getHours())}:${padZero(end.getMinutes())}` : "";

  const relative = formatRelativeDate(startIso);
  return end ? `${relative} ~ ${endTimeStr}` : relative;
}

function formatSimpleDate(isoString) {
  const d = parseDate(isoString);
  if (!d) return "";
  const year = d.getFullYear();
  const month = padZero(d.getMonth() + 1);
  const date = padZero(d.getDate());
  return `${year}-${month}-${date}`;
}

function formatModeLabel(mode) {
  const map = {
    video: "视频面试",
    onsite: "现场面试",
    phone: "电话面试",
    other: "其他",
  };
  return map[mode] || "面试";
}

function formatStageLabel(stageType, roundNo, stageLabel) {
  if (stageLabel && stageLabel.trim()) return stageLabel.trim();
  const typeMap = {
    screening: "简历初筛",
    interview: roundNo ? `第${roundNo}轮面试` : "面试中",
    hr: "HR沟通",
    offer: "录用 Offer",
  };
  return typeMap[stageType] || "处理中";
}

module.exports = {
  formatRelativeDate,
  formatSessionTimeRange,
  formatSimpleDate,
  formatModeLabel,
  formatStageLabel,
};
