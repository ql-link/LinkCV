function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatUpdatedAt(value) {
  const raw = text(value);
  if (!raw) return "更新时间未知";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  try {
    return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date)}`;
  } catch (_error) {
    return `更新于 ${raw.slice(0, 10)}`;
  }
}

module.exports = { formatUpdatedAt };
