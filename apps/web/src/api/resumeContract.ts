import type { JSONContent } from "@tiptap/core";
import { inlineIconMarkdown, isInlineIconName } from "../lib/resumeInlineIcon";
import { isResumeEmailLink } from "../lib/resumeLink";
import { inlineFontSizeOpenMarker, INLINE_FONT_SIZE_CLOSE_MARKER, normalizeInlineFontSize } from "../lib/resumeInlineStyle";

export type RichText =
  | { format: "markdown"; content: string }
  | { format: "tiptap-json"; content: JSONContent };

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
  summary: RichText | null;
  links: Array<{ id: string; label: string; url: string }>;
};

export type ResumeDocument = {
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
        content: RichText;
        source_refs: SourceRef[];
      }>;
    }>;
  };
  semantic_sections: Array<{
    id: string;
    semantic_kind:
      | "basics"
      | "profile"
      | "work"
      | "education"
      | "project"
      | "skills"
      | "activity"
      | "interests"
      | "certificates"
      | "awards"
      | "languages"
      | "custom";
    display_title: string;
    semantic_source: "import" | "model" | "user" | "system";
    semantic_confidence: number | null;
    content_key:
      | "basics"
      | "work_experiences"
      | "educations"
      | "projects"
      | "skills"
      | "certificates"
      | "awards"
      | "languages"
      | "custom_sections";
    custom_section_id: string | null;
  }>;
};

export function stripTemplatePageRegions(markdown: string) {
  const stack: Array<"sidebar" | "main" | "meta" | "trio"> = [];
  let fenced = false;
  return markdown.split("\n").filter((line) => {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      return true;
    }
    if (fenced) return true;
    const opening = line.trim().match(/^::::\s+(sidebar|main|meta|trio)\s*$/u);
    if (opening) {
      const kind = opening[1] as "sidebar" | "main" | "meta" | "trio";
      stack.push(kind);
      return kind === "meta" || kind === "trio";
    }
    if (/^::::\s*$/u.test(line.trim())) {
      const kind = stack.pop();
      return kind === "meta" || kind === "trio" || kind == null;
    }
    return true;
  }).join("\n");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function resumeDocumentContentHash(document: ResumeDocument) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(document)),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type TemplateManifest = {
  renderer_key: "flow" | "columns";
  regions: Array<{
    id: string;
    kind: "header" | "sidebar" | "main" | "footer";
    order: number;
  }>;
  slots: Array<{
    id: string;
    region_id: string;
    accepts: Array<
      | "basics"
      | "profile"
      | "work"
      | "education"
      | "project"
      | "skills"
      | "activity"
      | "interests"
      | "certificates"
      | "awards"
      | "languages"
      | "custom"
      | "avatar"
    >;
    required: boolean;
    fallback: boolean;
    order: number;
  }>;
  avatar: {
    visibility: "show" | "hide";
    fallback_asset: "system-default" | "none";
    size: number;
  };
};

export type ResumePresentation = {
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
  manifest: TemplateManifest;
};

export const DEFAULT_RESUME_ACCENT_COLOR = "#3478f6";

export function normalizeResumeAccentColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value)
    ? value
    : DEFAULT_RESUME_ACCENT_COLOR;
}

export const defaultSemanticDocument: ResumeDocument = {
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
  semantic_sections: [
    {
      id: "semantic_basics",
      semantic_kind: "basics",
      display_title: "基本信息",
      semantic_source: "system",
      semantic_confidence: null,
      content_key: "basics",
      custom_section_id: null,
    },
  ],
};

export const defaultSemanticStyle: ResumePresentation = {
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
  manifest: {
    renderer_key: "flow",
    regions: [{ id: "main", kind: "main", order: 1 }],
    slots: [
      { id: "avatar", region_id: "main", accepts: ["avatar"], required: false, fallback: false, order: 0 },
      {
        id: "main-content",
        region_id: "main",
        accepts: ["basics", "profile", "work", "education", "project", "skills", "activity", "interests", "certificates", "awards", "languages", "custom"],
        required: false,
        fallback: true,
        order: 0,
      },
    ],
    avatar: { visibility: "hide", fallback_asset: "none", size: 96 },
  },
};

type EditorSettings = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  pageMargin: number;
  verticalPageMargin: number;
  theme:
    | "classic"
    | "modern"
    | "compact"
    | "classic-technical"
    | "administrative-sidebar"
    | "campus-professional"
    | "civic-service"
    | "creative-orange";
  smartOnePage: boolean;
  showSource: boolean;
};

function richText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const candidate = value as Partial<RichText>;
  if (candidate.format === "markdown" && typeof candidate.content === "string") {
    return candidate.content;
  }
  if (
    candidate.format === "tiptap-json"
    && candidate.content
    && typeof candidate.content === "object"
  ) {
    return editorDocumentToMarkdown(candidate.content as JSONContent);
  }
  return "";
}

function datedRange(value: Record<string, unknown>) {
  const start = typeof value.start_date === "string" ? value.start_date : "";
  const end = value.current ? "至今" : typeof value.end_date === "string" ? value.end_date : "";
  return [start, end].filter(Boolean).join(" - ");
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Old structured imports already model highlights as list items.  A few
 * LinkParse/model combinations persisted the list marker a second time (and
 * encoded the separating space), so adding the current wrapper would render
 * two markers.  Only a marker followed by whitespace or a known space entity
 * is removed; values such as "-1°C" remain ordinary text.
 */
function normalizeLegacyHighlightContent(value: string) {
  let normalized = value.trim();
  while (true) {
    const marker = normalized.match(/^-[ \t]+/u)
      ?? normalized.match(/^-(?=(?:&#x20;|&#32;|&nbsp;))/iu);
    if (!marker) return normalized;

    normalized = normalized.slice(marker[0].length)
      .replace(/^(?:&#x20;|&#32;|&nbsp;)[ \t]*/iu, "");
  }
}

function appendHighlights(lines: string[], value: unknown) {
  if (!Array.isArray(value)) return;
  for (const highlight of value) {
    if (!highlight || typeof highlight !== "object") continue;
    const content = normalizeLegacyHighlightContent(
      richText((highlight as Record<string, unknown>).content),
    );
    if (content) lines.push(`- ${content}`);
  }
}

function markdownContactPart(value: { label: string; url: string }) {
  const label = optionalText(value.label);
  const url = optionalText(value.url);
  if (!url || isResumeEmailLink(url)) return label || url;
  return `[${label || url}](${url})`;
}

function semanticTitle(
  document: ResumeDocument,
  contentKey: ResumeDocument["semantic_sections"][number]["content_key"],
  fallback: string,
  customSectionId: string | null = null,
) {
  return document.semantic_sections.find(
    (section) => section.content_key === contentKey
      && section.custom_section_id === customSectionId,
  )?.display_title ?? fallback;
}

export function hasCanonicalEditorSections(document: ResumeDocument) {
  return document.semantic_sections.length > 0
    && document.semantic_sections.every((section) => section.content_key === "custom_sections")
    && document.semantic_sections.every((section) => section.custom_section_id);
}

export function resumeDocumentToMarkdown(document: ResumeDocument) {
  if (hasCanonicalEditorSections(document)) {
    const sections = new Map(document.sections.custom_sections.map((section) => [section.id, section]));
    return document.semantic_sections.map((semantic) => {
      const section = sections.get(semantic.custom_section_id ?? "");
      if (!section) return "";
      const body = section.items.map((item) => richText(item.content)).filter(Boolean).join("\n\n");
      if (section.items.length > 0 && section.items.every(
        (item) => item.content.format === "tiptap-json",
      )) return body;
      if (semantic.semantic_kind === "basics") return body;
      return [
        `## [[linkcv-block:${section.id}:${semantic.semantic_kind}]]${semantic.display_title}`,
        body,
      ].filter(Boolean).join("\n\n");
    }).filter(Boolean).join("\n\n").trim();
  }

  const lines: string[] = [];
  const { basics, sections } = document;
  if (basics.name) lines.push(`# ${basics.name}`);
  if (basics.headline) lines.push("", basics.headline);
  const contacts = [basics.phone, basics.email, basics.location]
    .map(optionalText)
    .filter(Boolean);
  const contactLinks = basics.links
    .map(markdownContactPart)
    .filter(Boolean);
  const contactParts = [...contacts, ...contactLinks];
  if (contactParts.length) lines.push("", contactParts.join(" ｜ "));
  if (basics.summary) lines.push("", richText(basics.summary));
  if (basics.photo) {
    lines.push("", `![简历头像](${basics.photo} \"linkcv-avatar:96\")`);
  }

  if (sections.work_experiences.length) {
    lines.push("", `## ${semanticTitle(document, "work_experiences", "工作经历")}`);
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
    lines.push("", `## ${semanticTitle(document, "projects", "项目经历")}`);
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
    lines.push("", `## ${semanticTitle(document, "educations", "教育经历")}`);
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
    lines.push("", `## ${semanticTitle(document, "skills", "专业技能")}`);
    for (const skill of sections.skills) {
      const keywords = skill.keywords.length ? `：${skill.keywords.join("、")}` : "";
      const level = skill.level ? `（${skill.level}）` : "";
      lines.push(`- ${skill.name}${level}${keywords}`);
    }
  }

  if (sections.certificates.length) {
    lines.push("", `## ${semanticTitle(document, "certificates", "证书")}`);
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
    lines.push("", `## ${semanticTitle(document, "awards", "荣誉奖项")}`);
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
    lines.push("", `## ${semanticTitle(document, "languages", "语言能力")}`);
    for (const raw of sections.languages) {
      const item = raw as Record<string, unknown>;
      const fluency = optionalText(item.fluency);
      lines.push(`- ${String(item.name ?? "")}${fluency ? `：${fluency}` : ""}`);
    }
  }

  for (const section of sections.custom_sections) {
    lines.push("", `## ${semanticTitle(document, "custom_sections", section.title, section.id)}`);
    for (const item of section.items) {
      if (item.title) lines.push("", `### ${item.title}`);
      if (item.subtitle) lines.push(item.subtitle);
      const content = richText(item.content);
      if (content) lines.push("", content);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function resumeDocumentFromMarkdown(
  markdown: string,
  previous: ResumeDocument,
): ResumeDocument {
  const normalized = stripTemplatePageRegions(markdown)
    .split("\n")
    .filter((line) => !/!\[[^\]]*\]\([^)]*\s+"linkcv-avatar:[^"]+"\)/u.test(line))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const lines = normalized.split("\n");
  const sections: Array<{ id: string; title: string; body: string; kind: ResumeDocument["semantic_sections"][number]["semantic_kind"] }> = [];
  const headingPattern = /^##\s+(?:\[\[linkcv-block:(blk_[a-z0-9]{16,64})(?::(basics|profile|work|education|project|skills|activity|interests|certificates|awards|languages|custom))?\]\])?(.*)$/u;
  let start = 0;
  let current: RegExpMatchArray | null = null;
  const stableBlockId = (seed: string, index: number) => {
    let hash = 2166136261;
    for (const char of `${seed}:${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const suffix = (hash >>> 0).toString(16).padStart(8, "0");
    return `blk_${suffix}${suffix}`;
  };
  const cleanTitle = (value: string) => value
    .replace(/:icon\[[^\]]+\]:/gu, "")
    .replace(/^\s+|\s+$/gu, "") || "未命名章节";
  const previousById = new Map(previous.semantic_sections.map((section) => [section.custom_section_id, section]));
  const titleCounts = new Map<string, number>();
  for (const section of previous.semantic_sections) {
    const title = section.display_title.trim();
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const previousByTitle = new Map(previous.semantic_sections
    .filter((section) => titleCounts.get(section.display_title.trim()) === 1)
    .map((section) => [section.display_title.trim(), section]));
  const pushSection = (end: number, match: RegExpMatchArray | null, index: number) => {
    const raw = lines.slice(start, end).join("\n").trim();
    if (!raw && match) return;
    const title = match ? cleanTitle(match[3] ?? "") : "基本信息";
    const id = match?.[1]
      ?? (match ? previousByTitle.get(title)?.custom_section_id : previous.semantic_sections.find((item) => item.semantic_kind === "basics")?.custom_section_id)
      ?? stableBlockId(title, index);
    const previousSemantic = previousById.get(id) ?? previousByTitle.get(title);
    sections.push({
      id,
      title,
      body: raw || `# ${previous.basics.name || "未命名简历"}`,
      kind: match
        ? (match[2] as ResumeDocument["semantic_sections"][number]["semantic_kind"] | undefined)
          ?? previousSemantic?.semantic_kind
          ?? "custom"
        : "basics",
    });
  };
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(?:```|~~~)/u.test(lines[index])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = lines[index].match(headingPattern);
    if (!match) continue;
    pushSection(index, current, sections.length);
    current = match;
    start = index + 1;
  }
  pushSection(lines.length, current, sections.length);
  const heading = normalized.match(/^#\s+(?:\[\[linkcv-block:blk_[a-z0-9]{16,64}\]\])?(.+)$/m)?.[1]?.trim();
  const customSections = sections.map((section) => ({
    id: section.id,
    title: section.title,
    items: [{
      id: `item_${section.id.slice(4)}`,
      title: null,
      subtitle: null,
      content: { format: "markdown" as const, content: section.body },
      source_refs: [],
    }],
  }));
  const semanticSections = sections.map((section) => {
    const previousSemantic = previousById.get(section.id) ?? previousByTitle.get(section.title);
    return {
      id: previousSemantic?.id ?? `sem_${section.id.slice(4)}`,
      semantic_kind: section.kind,
      display_title: section.title,
      semantic_source: previousSemantic?.semantic_source ?? "system" as const,
      semantic_confidence: previousSemantic?.semantic_confidence ?? null,
      content_key: "custom_sections" as const,
      custom_section_id: section.id,
    };
  });
  return {
    ...previous,
    basics: {
      ...previous.basics,
      name: heading || previous.basics.name,
      headline: null,
      email: null,
      phone: null,
      location: null,
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
      custom_sections: customSections,
    },
    semantic_sections: semanticSections,
  };
}

export function styleToEditorSettings(style: ResumePresentation): EditorSettings {
  const supportedThemes = [
    "classic-technical",
    "administrative-sidebar",
    "campus-professional",
    "civic-service",
    "creative-orange",
    "modern",
    "compact",
  ] as const;
  const theme = supportedThemes.find((candidate) => style.template_key.startsWith(candidate)) ?? "classic";
  const persistedFontFamily = style.font_family === "source-han-serif"
    ? '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif'
    : style.font_family;
  const fontFamily = /PingFang SC|Microsoft YaHei|system-ui/u.test(persistedFontFamily)
    ? '"LinkCV Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    : persistedFontFamily;
  return {
    fontFamily,
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
  previous: ResumePresentation,
): ResumePresentation {
  return {
    ...previous,
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
    if (mark.type === "underline") value = `[[linkcv-underline]]${value}[[/linkcv-underline]]`;
    if (mark.type === "strike") value = `~~${value}~~`;
    if (mark.type === "code") value = `\`${value}\``;
    if (
      mark.type === "link" &&
      typeof mark.attrs?.href === "string" &&
      !isResumeEmailLink(mark.attrs.href)
    ) {
      value = `[${value}](${mark.attrs.href})`;
    }
    if (
      mark.type === "highlight"
      && typeof mark.attrs?.color === "string"
      && /^#[0-9a-f]{6}$/iu.test(mark.attrs.color)
    ) {
      value = `[[linkcv-highlight:${mark.attrs.color}]]${value}[[/linkcv-highlight]]`;
    }
  }
  const textStyle = node.marks?.find((mark) => mark.type === "textStyle")?.attrs;
  const color = typeof textStyle?.color === "string" && /^#[0-9a-f]{6}$/iu.test(textStyle.color)
    ? textStyle.color
    : null;
  if (color) value = `[[linkcv-color:${color}]]${value}[[/linkcv-color]]`;
  const fontSize = normalizeInlineFontSize(textStyle?.fontSize);
  if (fontSize != null) {
    value = `${inlineFontSizeOpenMarker(fontSize)}${value}${INLINE_FONT_SIZE_CLOSE_MARKER}`;
  }
  return value;
}

function nodeText(node: JSONContent): string {
  if (node.type === "text") return markedText(node);
  if (node.type === "hardBreak") return "\n";
  if (node.type === "resumeBlockAnchor" && typeof node.attrs?.blockId === "string") {
    const semanticKind = typeof node.attrs.semanticKind === "string" ? `:${node.attrs.semanticKind}` : "";
    return `[[linkcv-block:${node.attrs.blockId}${semanticKind}]]`;
  }
  if (node.type === "inlineIcon" && isInlineIconName(node.attrs?.name)) return inlineIconMarkdown(node.attrs.name);
  if (node.type === "inlineImage") {
    const width = Math.min(240, Math.max(16, Number(node.attrs?.width) || 72));
    const aspectRatio = Math.min(20, Math.max(0.1, Number(node.attrs?.aspectRatio) || 3));
    const height = Math.min(240, Math.max(16, Number(node.attrs?.height) || width / aspectRatio));
    return markdownImage(node, `linkcv-inline-image-v2:${width}:${Number(height.toFixed(2))}`);
  }
  return (node.content ?? []).map(nodeText).join("");
}

function childBlocksMarkdown(node: JSONContent) {
  return (node.content ?? []).map(nodeMarkdown).filter(Boolean).join("\n\n");
}

function listStart(node: JSONContent) {
  const value = Number(node.attrs?.start);
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function indentMarkdown(value: string, count: number) {
  const prefix = " ".repeat(count);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function listItemMarkdown(node: JSONContent, marker: string) {
  const continuationIndent = marker.length + 1;
  let value = "";
  for (const child of node.content ?? []) {
    const childValue = child.type === "paragraph" ? nodeText(child) : nodeMarkdown(child);
    if (!childValue) continue;

    if (!value) {
      value = childValue;
      continue;
    }

    const separator = child.type === "bulletList" ? "\n" : "\n\n";
    value += `${separator}${indentMarkdown(childValue, continuationIndent)}`;
  }
  return value;
}

function listMarkdown(node: JSONContent, ordered: boolean) {
  const start = ordered ? listStart(node) : 1;
  return (node.content ?? []).map((item, index) => {
    const marker = ordered ? `${start + index}.` : "-";
    const value = listItemMarkdown(item, marker);
    return value ? `${marker} ${value}` : marker;
  }).join("\n");
}

function markdownImage(node: JSONContent, title: string) {
  const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return "";
  const alt = String(node.attrs?.alt ?? "简历图片").replace(/([\\\]])/g, "\\$1");
  const destination = src.replace(/([\\()])/g, "\\$1");
  return `![${alt}](${destination} "${title}")`;
}

function alignedBlockMarkdown(node: JSONContent, content: string) {
  const alignment = String(node.attrs?.textAlign ?? "");
  return content && ["left", "center", "right"].includes(alignment)
    ? `::: text-align ${alignment}\n${content}\n:::`
    : content;
}

function nodeMarkdown(node: JSONContent): string {
  if (node.type === "text") return markedText(node);
  if (node.type === "heading") {
    return alignedBlockMarkdown(node, `${"#".repeat(Number(node.attrs?.level ?? 2))} ${nodeText(node)}`);
  }
  if (node.type === "paragraph") return alignedBlockMarkdown(node, nodeText(node));
  if (node.type === "listItem") return listItemMarkdown(node, "-");
  if (node.type === "bulletList") return listMarkdown(node, false);
  if (node.type === "orderedList") return listMarkdown(node, true);
  if (node.type === "blockquote") return (node.content ?? []).map(nodeMarkdown)
    .join("\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  if (node.type === "codeBlock") {
    const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
    return `\`\`\`${language}\n${nodeText(node)}\n\`\`\``;
  }
  if (node.type === "horizontalRule") return "---";
  if (node.type === "resumeRow") {
    const [left, right] = node.content ?? [];
    const leftWidth = Math.min(80, Math.max(30, Number(node.attrs?.leftWidth) || 50));
    return `::: left ${leftWidth}\n${left ? nodeText(left) : ""}\n:::\n\n::: right\n${right ? nodeText(right) : ""}\n:::`;
  }
  if (node.type === "resumeColumns") {
    const columns = node.content ?? [];
    return columns.map((column, index) => {
      const variant = column.attrs?.variant === "sidebar" || column.attrs?.variant === "main"
        ? column.attrs.variant
        : index === 0 ? "sidebar" : "main";
      return `:::: ${variant}\n${childBlocksMarkdown(column)}\n::::`;
    }).join("\n\n");
  }
  if (node.type === "resumeColumn") return childBlocksMarkdown(node);
  if (node.type === "resumeMetaRow" || node.type === "resumeTrioRow") {
    const kind = node.type === "resumeMetaRow" ? "meta" : "trio";
    return `:::: ${kind}\n${(node.content ?? []).map(nodeText).join("\n")}\n::::`;
  }
  if (node.type === "inlineIcon") return nodeText(node);
  if (node.type === "inlineImage") return nodeText(node);
  if (node.type === "avatarImage") {
    if (node.attrs?.systemFallback === true) return "";
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
