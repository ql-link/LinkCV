import type { JSONContent } from "@tiptap/core";
import { inlineIconMarkdown, isInlineIconName } from "../lib/resumeInlineIcon";
import { inlineFontSizeOpenMarker, INLINE_FONT_SIZE_CLOSE_MARKER, normalizeInlineFontSize } from "../lib/resumeInlineStyle";

export type RichTextV1 = {
  format: "markdown";
  content: string;
};

export type SourceRef = {
  field: string;
  source: "extracted_markdown";
  start_line: number;
  end_line: number;
  quote: string;
};

export type ResumeBasics = {
  name: string;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  photo: string | null;
  summary: RichTextV1 | null;
  links: Array<{ id: string; label: string; url: string }>;
};

export type ResumeDocumentV1 = {
  schema_version: "1.0";
  basics: ResumeBasics;
  sections: {
    work_experiences: Array<Record<string, unknown> & { id: string }>;
    educations: Array<Record<string, unknown> & { id: string }>;
    projects: Array<Record<string, unknown> & { id: string }>;
    skills: Array<{ id: string; name: string; level: string | null; keywords: string[] }>;
    certificates: Array<Record<string, unknown> & { id: string }>;
    awards: Array<Record<string, unknown> & { id: string }>;
    languages: Array<Record<string, unknown> & { id: string }>;
    custom_sections: Array<{
      id: string;
      title: string;
      items: Array<{
        id: string;
        title: string | null;
        subtitle: string | null;
        content: RichTextV1;
        source_refs: SourceRef[];
      }>;
    }>;
  };
};

export type ResumeStyleV1 = {
  schema_version: "1.0";
  template_key: string;
  font_family: string;
  font_size: number;
  line_height: number;
  accent_color: string;
  smart_one_page: boolean;
  page: {
    size: "A4";
    margin_top_mm: number;
    margin_right_mm: number;
    margin_bottom_mm: number;
    margin_left_mm: number;
  };
  section_order: string[];
};

export const defaultSemanticDocument: ResumeDocumentV1 = {
  schema_version: "1.0",
  basics: {
    name: "张三",
    headline: "后端开发工程师",
    email: null,
    phone: null,
    location: null,
    photo: null,
    summary: null,
    links: [],
  },
  sections: {
    work_experiences: [],
    educations: [],
    projects: [],
    skills: [],
    certificates: [],
    awards: [],
    languages: [],
    custom_sections: [],
  },
};

export const defaultSemanticStyle: ResumeStyleV1 = {
  schema_version: "1.0",
  template_key: "classic-cn",
  font_family: "source-han-serif",
  font_size: 14,
  line_height: 1.55,
  accent_color: "#2F4858",
  smart_one_page: false,
  page: {
    size: "A4",
    margin_top_mm: 14,
    margin_right_mm: 16,
    margin_bottom_mm: 14,
    margin_left_mm: 16,
  },
  section_order: ["basics", "work_experiences", "projects", "educations", "skills"],
};

type EditorSettings = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  pageMargin: number;
  verticalPageMargin: number;
  theme: "classic" | "modern" | "compact" | "classic-technical";
  smartOnePage: boolean;
  showSource: boolean;
};

function richText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const content = (value as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function datedRange(value: Record<string, unknown>) {
  const start = typeof value.start_date === "string" ? value.start_date : "";
  const end = value.current ? "至今" : typeof value.end_date === "string" ? value.end_date : "";
  return [start, end].filter(Boolean).join(" - ");
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function appendHighlights(lines: string[], value: unknown) {
  if (!Array.isArray(value)) return;
  for (const highlight of value) {
    if (!highlight || typeof highlight !== "object") continue;
    const content = richText((highlight as Record<string, unknown>).content);
    if (content) lines.push(`- ${content}`);
  }
}

export function resumeDocumentToMarkdown(document: ResumeDocumentV1) {
  const editorSection = document.sections.custom_sections.find(
    (section) => section.id === "custom_section_editor",
  );
  const editorItem = editorSection?.items.find((item) => item.id === "custom_item_editor");
  if (editorItem) return editorItem.content.content;

  const lines: string[] = [];
  const { basics, sections } = document;
  if (basics.name) lines.push(`# ${basics.name}`);
  if (basics.headline) lines.push("", basics.headline);
  const contacts = [basics.phone, basics.email, basics.location].filter(Boolean);
  if (contacts.length) lines.push("", contacts.join(" ｜ "));
  if (basics.summary) lines.push("", richText(basics.summary));
  if (basics.links.length) {
    for (const link of basics.links) lines.push(`- [${link.label}](${link.url})`);
  }
  if (basics.photo) {
    lines.push("", `![简历头像](${basics.photo} \"linkcv-avatar:96\")`);
  }

  if (sections.work_experiences.length) {
    lines.push("", "## 工作经历");
    for (const raw of sections.work_experiences) {
      const item = raw as Record<string, unknown>;
      lines.push("", `### ${String(item.organization ?? "")} - ${String(item.position ?? "")}`);
      const location = optionalText(item.location);
      if (location) lines.push(location);
      const range = datedRange(item);
      if (range) lines.push(range);
      const summary = richText(item.summary);
      if (summary) lines.push("", summary);
      appendHighlights(lines, item.highlights);
    }
  }

  if (sections.projects.length) {
    lines.push("", "## 项目经历");
    for (const raw of sections.projects) {
      const item = raw as Record<string, unknown>;
      lines.push("", `### ${String(item.name ?? "")}`);
      const details = [optionalText(item.role), datedRange(item)].filter(Boolean);
      if (details.length) lines.push(details.join(" ｜ "));
      const url = optionalText(item.url);
      if (url) lines.push(`[项目链接](${url})`);
      const summary = richText(item.summary);
      if (summary) lines.push("", summary);
      appendHighlights(lines, item.highlights);
    }
  }

  if (sections.educations.length) {
    lines.push("", "## 教育经历");
    for (const raw of sections.educations) {
      const item = raw as Record<string, unknown>;
      lines.push("", `### ${String(item.institution ?? "")}`);
      const detail = [item.study_type, item.area].filter(Boolean).join(" · ");
      if (detail) lines.push(String(detail));
      const range = datedRange(item);
      if (range) lines.push(range);
      const score = optionalText(item.score);
      if (score) lines.push(`成绩：${score}`);
      const summary = richText(item.summary);
      if (summary) lines.push("", summary);
      appendHighlights(lines, item.highlights);
    }
  }

  if (sections.skills.length) {
    lines.push("", "## 专业技能");
    for (const skill of sections.skills) {
      const keywords = skill.keywords.length ? `：${skill.keywords.join("、")}` : "";
      const level = skill.level ? `（${skill.level}）` : "";
      lines.push(`- ${skill.name}${level}${keywords}`);
    }
  }

  if (sections.certificates.length) {
    lines.push("", "## 证书");
    for (const raw of sections.certificates) {
      const item = raw as Record<string, unknown>;
      const details = [optionalText(item.issuer), datedRange(item)].filter(Boolean);
      lines.push("", `### ${String(item.name ?? "")}`);
      if (details.length) lines.push(details.join(" ｜ "));
      const url = optionalText(item.url);
      if (url) lines.push(`[证书链接](${url})`);
    }
  }

  if (sections.awards.length) {
    lines.push("", "## 荣誉奖项");
    for (const raw of sections.awards) {
      const item = raw as Record<string, unknown>;
      const details = [optionalText(item.awarder), datedRange(item)].filter(Boolean);
      lines.push("", `### ${String(item.title ?? "")}`);
      if (details.length) lines.push(details.join(" ｜ "));
      const summary = richText(item.summary);
      if (summary) lines.push("", summary);
    }
  }

  if (sections.languages.length) {
    lines.push("", "## 语言能力");
    for (const raw of sections.languages) {
      const item = raw as Record<string, unknown>;
      const fluency = optionalText(item.fluency);
      lines.push(`- ${String(item.name ?? "")}${fluency ? `：${fluency}` : ""}`);
    }
  }

  for (const section of sections.custom_sections) {
    lines.push("", `## ${section.title}`);
    for (const item of section.items) {
      if (item.title) lines.push("", `### ${item.title}`);
      if (item.subtitle) lines.push(item.subtitle);
      if (item.content.content) lines.push("", item.content.content);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function resumeDocumentFromMarkdown(
  markdown: string,
  previous: ResumeDocumentV1,
): ResumeDocumentV1 {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const preservedCustomSections = previous.sections.custom_sections.filter(
    (section) => section.id !== "custom_section_editor",
  );
  return {
    ...previous,
    basics: { ...previous.basics, name: heading || previous.basics.name },
    sections: {
      ...previous.sections,
      custom_sections: [
        ...preservedCustomSections,
        {
          id: "custom_section_editor",
          title: "简历正文",
          items: [
            {
              id: "custom_item_editor",
              title: null,
              subtitle: null,
              content: { format: "markdown", content: markdown },
              source_refs: [],
            },
          ],
        },
      ],
    },
  };
}

export function styleToEditorSettings(style: ResumeStyleV1): EditorSettings {
  const theme = style.template_key.startsWith("classic-technical")
    ? "classic-technical"
    : style.template_key.startsWith("modern")
      ? "modern"
      : style.template_key.startsWith("compact")
        ? "compact"
        : "classic";
  return {
    fontFamily: style.font_family === "source-han-serif"
      ? '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif'
      : style.font_family,
    fontSize: style.font_size,
    lineHeight: style.line_height,
    pageMargin: style.page.margin_left_mm,
    verticalPageMargin: style.page.margin_top_mm,
    theme,
    smartOnePage: style.smart_one_page,
    showSource: false,
  };
}

export function editorSettingsToStyle(
  settings: EditorSettings,
  previous: ResumeStyleV1,
): ResumeStyleV1 {
  return {
    ...previous,
    template_key: `${settings.theme}-cn`,
    font_family: settings.fontFamily.includes("Source Han Serif") ? "source-han-serif" : settings.fontFamily,
    font_size: settings.fontSize,
    line_height: settings.lineHeight,
    smart_one_page: settings.smartOnePage,
    page: {
      ...previous.page,
      margin_top_mm: settings.verticalPageMargin,
      margin_right_mm: settings.pageMargin,
      margin_bottom_mm: settings.verticalPageMargin,
      margin_left_mm: settings.pageMargin,
    },
  };
}

function markedText(node: JSONContent) {
  let value = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") value = `**${value}**`;
    if (mark.type === "italic") value = `*${value}*`;
    if (mark.type === "link" && typeof mark.attrs?.href === "string") value = `[${value}](${mark.attrs.href})`;
  }
  const fontSize = normalizeInlineFontSize(
    node.marks?.find((mark) => mark.type === "textStyle")?.attrs?.fontSize,
  );
  if (fontSize != null) {
    value = `${inlineFontSizeOpenMarker(fontSize)}${value}${INLINE_FONT_SIZE_CLOSE_MARKER}`;
  }
  return value;
}

function nodeText(node: JSONContent): string {
  if (node.type === "text") return markedText(node);
  if (node.type === "hardBreak") return "\n";
  if (node.type === "inlineIcon" && isInlineIconName(node.attrs?.name)) return inlineIconMarkdown(node.attrs.name);
  return (node.content ?? []).map(nodeText).join("");
}

function markdownImage(node: JSONContent, title: string) {
  const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return "";
  const alt = String(node.attrs?.alt ?? "简历图片").replace(/([\\\]])/g, "\\$1");
  const destination = src.replace(/([\\()])/g, "\\$1");
  return `![${alt}](${destination} "${title}")`;
}

function nodeMarkdown(node: JSONContent): string {
  if (node.type === "text") return markedText(node);
  if (node.type === "heading") return `${"#".repeat(Number(node.attrs?.level ?? 2))} ${nodeText(node)}`;
  if (node.type === "paragraph") return nodeText(node);
  if (node.type === "listItem") return (node.content ?? []).map(nodeMarkdown).join("\n");
  if (node.type === "bulletList") return (node.content ?? []).map((item) => `- ${nodeMarkdown(item)}`).join("\n");
  if (node.type === "orderedList") return (node.content ?? []).map((item, index) => `${index + 1}. ${nodeMarkdown(item)}`).join("\n");
  if (node.type === "resumeRow") {
    const [left, right] = node.content ?? [];
    const leftWidth = Math.min(80, Math.max(30, Number(node.attrs?.leftWidth) || 50));
    return `::: left ${leftWidth}\n${left ? nodeText(left) : ""}\n:::\n\n::: right\n${right ? nodeText(right) : ""}\n:::`;
  }
  if (node.type === "avatarImage") {
    const size = Math.min(220, Math.max(56, Number(node.attrs?.size) || 96));
    return markdownImage(node, `linkcv-avatar:${size}`);
  }
  if (node.type === "resumeImage") {
    const widthUnit = node.attrs?.widthUnit === "px" ? "px" : "%";
    const maximum = widthUnit === "%" ? 100 : 794;
    const width = Math.min(maximum, Math.max(0.1, Number(node.attrs?.width) || 55));
    const align = ["left", "center", "right", "full"].includes(String(node.attrs?.align))
      ? String(node.attrs?.align)
      : "center";
    return markdownImage(node, `linkcv-image:${width}:${widthUnit}:${align}`);
  }
  return (node.content ?? []).map(nodeMarkdown).filter(Boolean).join("\n\n");
}

export function editorDocumentToMarkdown(document: JSONContent) {
  return (document.content ?? []).map(nodeMarkdown).filter(Boolean).join("\n\n").trim();
}
