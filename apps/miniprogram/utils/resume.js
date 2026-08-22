function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function richText(value) {
  return value && typeof value === "object" ? text(value.content) : "";
}

function dateRange(item) {
  const start = text(item.start_date);
  const end = item.current ? "至今" : text(item.end_date);
  return [start, end].filter(Boolean).join(" - ");
}

function highlights(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => richText(item && item.content)).filter(Boolean);
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

function mapItems(items, fields) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    id: text(item.id),
    title: fields.title(item),
    subtitle: fields.subtitle ? fields.subtitle(item) : "",
    meta: fields.meta ? fields.meta(item) : dateRange(item),
    content: fields.content ? fields.content(item) : richText(item.summary),
    highlights: highlights(item.highlights),
  }));
}

function toDisplayResume(resume) {
  const document = resume && resume.data ? resume.data : {};
  const basics = document.basics || {};
  const source = document.sections || {};
  const sections = [];
  const add = (title, items) => {
    if (items.length) sections.push({ title, items });
  };
  add("工作经历", mapItems(source.work_experiences, {
    title: (item) => text(item.organization),
    subtitle: (item) => text(item.position),
  }));
  add("项目经历", mapItems(source.projects, {
    title: (item) => text(item.name),
    subtitle: (item) => text(item.role),
  }));
  add("教育经历", mapItems(source.educations, {
    title: (item) => text(item.institution),
    subtitle: (item) => [text(item.study_type), text(item.area)].filter(Boolean).join(" · "),
  }));
  add("专业技能", mapItems(source.skills, {
    title: (item) => text(item.name),
    subtitle: (item) => text(item.level),
    meta: () => "",
    content: (item) => Array.isArray(item.keywords) ? item.keywords.map(text).filter(Boolean).join("、") : "",
  }));
  if (Array.isArray(source.custom_sections)) {
    source.custom_sections.forEach((section) => add(
      text(section.title) || "其他",
      mapItems(section.items, {
        title: (item) => text(item.title),
        subtitle: (item) => text(item.subtitle),
        meta: () => "",
        content: (item) => richText(item.content),
      }),
    ));
  }
  return {
    title: text(resume && resume.title) || "未命名简历",
    name: text(basics.name),
    headline: text(basics.headline),
    contacts: [text(basics.phone), text(basics.email), text(basics.location)].filter(Boolean),
    summary: richText(basics.summary),
    sections,
  };
}

module.exports = { formatUpdatedAt, toDisplayResume };
