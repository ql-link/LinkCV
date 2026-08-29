import type { JSONContent } from "@tiptap/core";
import { inlineIconMarkdown, isInlineIconName } from "../lib/resumeInlineIcon";
import type { InlineIconName } from "../lib/resumeInlineIcon";
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

/**
 * The pre-canonical snapshot shape is kept as a read adapter for data that can
 * still be returned while the maintenance-window cutover is in progress. It
 * must never be sent for a new write.
 */
export type LegacyResumeDocument = {
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

export type LegacyResumePresentation = {
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

export type CanonicalNodeId = string;
export type CanonicalSourceId = string;

export type CanonicalSourceReferenced = {
  node_id: CanonicalNodeId;
  source_refs: CanonicalSourceId[];
};

export type CanonicalTextValue = CanonicalSourceReferenced & {
  value: string;
};

export type CanonicalContact = CanonicalSourceReferenced & {
  contact_kind: "phone" | "email" | "website" | "location" | "github" | "linkedin" | "other";
  value: string;
  label?: string | null;
};

export type CanonicalInlineStyle = {
  color: string | null;
  font_size_pt: number | null;
  highlight_color: string | null;
};

export type CanonicalTextRun = {
  inline_type: "text";
  text: string;
  marks: Array<"bold" | "italic" | "underline" | "strike" | "code">;
  href: string | null;
  style: CanonicalInlineStyle;
};

export type CanonicalInlineIcon = {
  inline_type: "icon";
  name: InlineIconName;
};

export type CanonicalMediaReference = CanonicalSourceReferenced & {
  media_kind: "avatar" | "resume_image" | "inline_image";
  src: string;
  alt: string | null;
  width: number | null;
  width_unit: "px" | "%" | null;
  height_px: number | null;
  align: "left" | "center" | "right" | "full" | null;
  system_fallback: boolean;
};

export type CanonicalInlineMedia = CanonicalMediaReference & {
  inline_type: "media";
  media_kind: "inline_image";
};

export type CanonicalParagraphBlock = CanonicalSourceReferenced & {
  block_type: "paragraph";
  runs: Array<CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia>;
};

export type CanonicalListItem = CanonicalSourceReferenced & {
  runs: Array<CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia>;
};

export type CanonicalListBlock = {
  node_id: CanonicalNodeId;
  block_type: "ordered_list" | "bullet_list";
  start: number | null;
  items: CanonicalListItem[];
};

export type CanonicalMediaBlock = CanonicalMediaReference & {
  block_type: "media";
  media_kind: "resume_image";
  height_px: null;
  system_fallback: false;
};

export type CanonicalRowCell = CanonicalSourceReferenced & {
  // v1 row cells are projected to one direct TipTap paragraph.  Keep the
  // runtime type as an array for ergonomic JSON construction; the shared
  // schema and backend enforce minItems=maxItems=1 and paragraph-only items.
  blocks: CanonicalParagraphBlock[];
};

export type CanonicalRowBlock = CanonicalSourceReferenced & {
  block_type: "row";
  row_kind: "pair" | "meta" | "trio";
  cells: CanonicalRowCell[];
  left_width_percent: number | null;
};

export type CanonicalContentBlock =
  | CanonicalParagraphBlock
  | CanonicalListBlock
  | CanonicalMediaBlock
  | CanonicalRowBlock;

export type CanonicalEntryFields = Partial<Record<
  "name" | "organization" | "role" | "location" | "start_date" | "end_date" | "url" | "degree" | "major",
  CanonicalTextValue | null
>>;

export type CanonicalResumeEntry = CanonicalSourceReferenced & {
  fields: CanonicalEntryFields;
  blocks: CanonicalContentBlock[];
};

export type CanonicalResumeSection = CanonicalSourceReferenced & {
  semantic_kind: "profile" | "work" | "education" | "project" | "skills" | "activity" | "interests" | "certificates" | "awards" | "languages" | "custom";
  title: CanonicalTextValue | null;
  /** Optional for canonical rows written before structured title icons. */
  title_icon?: CanonicalInlineIcon | null;
  entries: CanonicalResumeEntry[];
  blocks: CanonicalContentBlock[];
};

export type CanonicalSourceDisposition = {
  source_id: CanonicalSourceId;
  outcome: "mapped" | "transformed" | "dropped";
  target_node_ids: CanonicalNodeId[];
  reason_code: string | null;
};

export type CanonicalResumeIdentity = {
  node_id: CanonicalNodeId;
  name: CanonicalTextValue | null;
  headline: CanonicalTextValue | null;
  contacts: CanonicalContact[];
  avatar: (CanonicalMediaReference & { media_kind: "avatar" }) | null;
};

/** CanonicalResumeDocument v1 from contracts/resume/canonical-resume.schema.json. */
export type CanonicalResumeDocument = {
  schema_version: "canonical-resume.v1";
  document_id: CanonicalNodeId;
  identity: CanonicalResumeIdentity;
  sections: CanonicalResumeSection[];
  source_dispositions: CanonicalSourceDisposition[];
};

export type TemplateDefinition = {
  schema_version: "template-definition.v1";
  template_key: string;
  semantic_labels: {
    profile: string;
    work: string;
    education: string;
    project: string;
    skills: string;
    activity: string;
    interests: string;
    certificates: string;
    awards: string;
    languages: string;
  };
  regions: Array<{
    region_id: string;
    region_kind: "header" | "sidebar" | "main" | "footer";
    order: number;
  }>;
  slots: Array<{
    slot_id: string;
    region_id: string;
    accepts: Array<"identity" | "profile" | "work" | "education" | "project" | "skills" | "activity" | "interests" | "certificates" | "awards" | "languages" | "custom">;
    universal_fallback: boolean;
    order: number;
  }>;
  tokens: {
    font_family: string;
    font_size_pt: number;
    line_height: number;
    accent_color: string;
    page_margin_mm: number;
    vertical_page_margin_mm?: number | null;
    page_margin_top_mm?: number | null;
    page_margin_right_mm?: number | null;
    page_margin_bottom_mm?: number | null;
    page_margin_left_mm?: number | null;
  };
  avatar: {
    visibility: "show" | "hide";
    fallback_asset: "system-default" | "none";
    size_px: number;
    region_id: string;
  };
};

export type PresentationSettings = {
  smart_one_page?: boolean;
  font_scale?: number | null;
  line_height?: number | null;
  accent_color?: string | null;
  page_margin_mm?: number | null;
  vertical_page_margin_mm?: number | null;
  page_margin_top_mm?: number | null;
  page_margin_right_mm?: number | null;
  page_margin_bottom_mm?: number | null;
  page_margin_left_mm?: number | null;
  avatar_size_px?: number | null;
  sidebar_width_percent?: number | null;
};

/** ResumePresentation v1. Values are intentionally opaque to the editor. */
export type CanonicalResumePresentation = {
  schema_version: "resume-presentation.v1";
  portable: PresentationSettings;
  template_scoped: Record<string, PresentationSettings>;
  template_snapshot: TemplateDefinition;
};

export type LayoutPlan = {
  schema_version: "layout-plan.v1";
  /** Backend-owned canonical digest. The Web client must not reproduce it. */
  content_sha256: string;
  template_key: string;
  regions: Array<{
    region_id: string;
    order: number;
    nodes: Array<{
      node_id: CanonicalNodeId;
      semantic_kind: "identity" | "profile" | "work" | "education" | "project" | "skills" | "activity" | "interests" | "certificates" | "awards" | "languages" | "custom";
      slot_id: string;
    }>;
  }>;
};

/**
 * Keep the historical aliases source-compatible for the migration window.
 * API/store boundaries use the payload unions below so canonical responses can
 * flow through the Web without making every legacy editor helper unsafe.
 */
export type ResumeDocument = LegacyResumeDocument;
/** Internal conversion helper input; runtime API DTOs are canonical-only. */
export type ResumeDocumentRead = CanonicalResumeDocument | LegacyResumeDocument;
export type ResumePresentation = LegacyResumePresentation;
/** Internal conversion helper input; runtime API DTOs are canonical-only. */
export type ResumePresentationRead = CanonicalResumePresentation | LegacyResumePresentation;

export function isCanonicalResumeDocument(value: unknown): value is CanonicalResumeDocument {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { schema_version?: unknown }).schema_version === "canonical-resume.v1"
    && (value as { identity?: unknown }).identity
    && Array.isArray((value as { sections?: unknown }).sections),
  );
}

export function isCanonicalResumePresentation(value: unknown): value is CanonicalResumePresentation {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { schema_version?: unknown }).schema_version === "resume-presentation.v1"
    && (value as { template_snapshot?: unknown }).template_snapshot,
  );
}

export function isCanonicalLayoutPlan(value: unknown): value is LayoutPlan {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { schema_version?: unknown }).schema_version === "layout-plan.v1"
    && Array.isArray((value as { regions?: unknown }).regions),
  );
}

export function resumeDocumentTitle(document: ResumeDocumentRead): string {
  if (isCanonicalResumeDocument(document)) return document.identity.name?.value ?? "";
  return document.basics.name;
}

export function resumePresentationTemplateKey(style: ResumePresentationRead): string {
  return isCanonicalResumePresentation(style)
    ? style.template_snapshot.template_key
    : style.template_key;
}

export function resumePresentationTemplateDefinition(style: ResumePresentationRead): TemplateDefinition | null {
  return isCanonicalResumePresentation(style) ? style.template_snapshot : null;
}

export function resumePresentationAccentColor(style: ResumePresentationRead): string {
  if (!isCanonicalResumePresentation(style)) return normalizeResumeAccentColor(style.accent_color);
  const key = style.template_snapshot.template_key;
  const scoped = style.template_scoped[key] ?? {};
  return normalizeResumeAccentColor(
    scoped.accent_color ?? style.portable.accent_color ?? style.template_snapshot.tokens.accent_color,
  );
}

export function resumePresentationPageMargin(style: ResumePresentationRead): number {
  return resumePresentationPageMargins(style).left;
}

export function resumePresentationVerticalPageMargin(style: ResumePresentationRead): number {
  return resumePresentationPageMargins(style).top;
}

export type ResumePageMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function finiteMargin(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resumePresentationPageMargins(style: ResumePresentationRead): ResumePageMargins {
  if (!isCanonicalResumePresentation(style)) {
    return {
      top: style.page.margin_top_mm,
      right: style.page.margin_right_mm,
      bottom: style.page.margin_bottom_mm,
      left: style.page.margin_left_mm,
    };
  }
  const key = style.template_snapshot.template_key;
  const scoped = style.template_scoped[key] ?? {};
  const tokens = style.template_snapshot.tokens;
  const horizontal = scoped.page_margin_mm
    ?? style.portable.page_margin_mm
    ?? tokens.page_margin_mm;
  const vertical = scoped.vertical_page_margin_mm
    ?? style.portable.vertical_page_margin_mm
    ?? tokens.vertical_page_margin_mm
    ?? tokens.page_margin_mm;
  return {
    top: finiteMargin(
      scoped.page_margin_top_mm
        ?? style.portable.page_margin_top_mm
        ?? tokens.page_margin_top_mm,
      finiteMargin(vertical, tokens.page_margin_mm),
    ),
    right: finiteMargin(
      scoped.page_margin_right_mm
        ?? style.portable.page_margin_right_mm
        ?? tokens.page_margin_right_mm,
      finiteMargin(horizontal, tokens.page_margin_mm),
    ),
    bottom: finiteMargin(
      scoped.page_margin_bottom_mm
        ?? style.portable.page_margin_bottom_mm
        ?? tokens.page_margin_bottom_mm,
      finiteMargin(vertical, tokens.page_margin_mm),
    ),
    left: finiteMargin(
      scoped.page_margin_left_mm
        ?? style.portable.page_margin_left_mm
        ?? tokens.page_margin_left_mm,
      finiteMargin(horizontal, tokens.page_margin_mm),
    ),
  };
}

export function resumePresentationAvatarSize(style: ResumePresentationRead): number {
  if (!isCanonicalResumePresentation(style)) return style.manifest.avatar.size;
  const key = style.template_snapshot.template_key;
  const scoped = style.template_scoped[key] ?? {};
  const value = scoped.avatar_size_px ?? style.portable.avatar_size_px;
  return typeof value === "number" && Number.isFinite(value) ? value : 96;
}

export function withResumePresentationAvatarSize(
  style: LegacyResumePresentation,
  size: number,
): LegacyResumePresentation;
export function withResumePresentationAvatarSize(
  style: CanonicalResumePresentation,
  size: number,
): CanonicalResumePresentation;
export function withResumePresentationAvatarSize(
  style: ResumePresentationRead,
  size: number,
): ResumePresentationRead {
  if (!isCanonicalResumePresentation(style)) {
    return {
      ...style,
      manifest: {
        ...style.manifest,
        avatar: { ...style.manifest.avatar, size },
      },
    };
  }
  const key = style.template_snapshot.template_key;
  return {
    ...style,
    template_scoped: {
      ...style.template_scoped,
      [key]: {
        ...style.template_scoped[key],
        avatar_size_px: size,
      },
    },
  };
}

export const DEFAULT_RESUME_ACCENT_COLOR = "#3478f6";

export function normalizeResumeAccentColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value)
    ? value
    : DEFAULT_RESUME_ACCENT_COLOR;
}

export const defaultSemanticDocument: LegacyResumeDocument = {
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

export const defaultSemanticStyle: LegacyResumePresentation = {
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

export const defaultCanonicalDocument: CanonicalResumeDocument = {
  schema_version: "canonical-resume.v1",
  document_id: "node_document0000000001",
  identity: {
    node_id: "node_identity0000000001",
    name: null,
    headline: null,
    contacts: [],
    avatar: null,
  },
  sections: [],
  source_dispositions: [],
};

export const defaultCanonicalTemplateDefinition: TemplateDefinition = {
  schema_version: "template-definition.v1",
  template_key: "classic-cn",
  semantic_labels: {
    profile: "个人简介",
    work: "工作经历",
    education: "教育经历",
    project: "项目经历",
    skills: "专业技能",
    activity: "实践经历",
    interests: "兴趣爱好",
    certificates: "证书",
    awards: "荣誉奖项",
    languages: "语言能力",
  },
  regions: [{ region_id: "main", region_kind: "main", order: 0 }],
  slots: [{
    slot_id: "main_content",
    region_id: "main",
    accepts: ["identity", "profile", "work", "education", "project", "skills", "activity", "interests", "certificates", "awards", "languages", "custom"],
    universal_fallback: true,
    order: 0,
  }],
  tokens: {
    font_family: "source-han-serif",
    font_size_pt: 14,
    line_height: 1.55,
    accent_color: "#2F4858",
    page_margin_mm: 16,
    vertical_page_margin_mm: 14,
  },
  avatar: {
    visibility: "hide",
    fallback_asset: "none",
    size_px: 96,
    region_id: "main",
  },
};

export const defaultCanonicalPresentation: CanonicalResumePresentation = {
  schema_version: "resume-presentation.v1",
  portable: { smart_one_page: false },
  template_scoped: { "classic-cn": {} },
  template_snapshot: defaultCanonicalTemplateDefinition,
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
  document: LegacyResumeDocument,
  contentKey: ResumeDocument["semantic_sections"][number]["content_key"],
  fallback: string,
  customSectionId: string | null = null,
) {
  return document.semantic_sections.find(
    (section) => section.content_key === contentKey
      && section.custom_section_id === customSectionId,
  )?.display_title ?? fallback;
}

function canonicalRunToMarkdown(
  run: CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia,
) {
  if (run.inline_type === "icon") return inlineIconMarkdown(run.name);
  if (run.inline_type === "media") {
    if (!run.src || run.src.startsWith("data:") || run.src.startsWith("blob:")) return "";
    return `![${run.alt ?? "行内图片"}](${run.src})`;
  }
  let value = run.text;
  for (const mark of run.marks) {
    if (mark === "bold") value = `**${value}**`;
    if (mark === "italic") value = `*${value}*`;
    if (mark === "underline") value = `[[linkcv-underline]]${value}[[/linkcv-underline]]`;
    if (mark === "strike") value = `~~${value}~~`;
    if (mark === "code") value = `\`${value}\``;
  }
  if (run.href && !isResumeEmailLink(run.href)) value = `[${value}](${run.href})`;
  if (run.style.highlight_color) value = `[[linkcv-highlight:${run.style.highlight_color}]]${value}[[/linkcv-highlight]]`;
  if (run.style.color) value = `[[linkcv-color:${run.style.color}]]${value}[[/linkcv-color]]`;
  if (run.style.font_size_pt != null) value = `${inlineFontSizeOpenMarker(run.style.font_size_pt)}${value}${INLINE_FONT_SIZE_CLOSE_MARKER}`;
  return value;
}

function canonicalBlockToMarkdown(block: CanonicalContentBlock): string {
  if (block.block_type === "media") {
    if (!block.src || block.src.startsWith("data:") || block.src.startsWith("blob:")) return "";
    return `![${block.alt ?? "简历图片"}](${block.src})`;
  }
  if (block.block_type === "paragraph") return block.runs.map(canonicalRunToMarkdown).join("");
  if (block.block_type === "row") {
    return block.cells.map((cell) => cell.blocks.map(canonicalBlockToMarkdown).filter(Boolean).join("\n")).join(" ｜ ");
  }
  return block.items.map((item, index) => {
    const marker = block.block_type === "ordered_list" ? `${(block.start ?? 1) + index}.` : "-";
    return `${marker} ${item.runs.map(canonicalRunToMarkdown).join("")}`;
  }).join("\n");
}

function canonicalDocumentToMarkdown(document: CanonicalResumeDocument) {
  const lines: string[] = [];
  const identity = document.identity;
  if (identity.name?.value) lines.push(`# ${identity.name.value}`);
  if (identity.headline?.value) lines.push("", identity.headline.value);
  if (identity.contacts.length) lines.push("", identity.contacts.map((contact) => contact.label ? `${contact.label}：${contact.value}` : contact.value).join(" ｜ "));
  if (identity.avatar && !identity.avatar.system_fallback && identity.avatar.src) {
    lines.push("", `![${identity.avatar.alt ?? "简历头像"}](${identity.avatar.src} "linkcv-avatar:${identity.avatar.width ?? 96}")`);
  }
  for (const section of document.sections) {
    const title = section.title?.value ?? "";
    const titleIcon = section.title_icon && isInlineIconName(section.title_icon.name)
      ? inlineIconMarkdown(section.title_icon.name)
      : "";
    if (title || titleIcon) {
      lines.push("", `## ${[titleIcon, title].filter(Boolean).join(" ")}`);
    }
    for (const entry of section.entries) {
      const heading = entry.fields.name?.value ?? entry.fields.organization?.value ?? entry.fields.role?.value;
      if (heading) lines.push("", `### ${heading}`);
      for (const key of ["organization", "role", "location", "start_date", "end_date", "degree", "major", "url"] as const) {
        const field = entry.fields[key];
        if (field?.value && field.value !== heading) lines.push(`${field.value}`);
      }
      for (const block of entry.blocks) {
        const value = canonicalBlockToMarkdown(block);
        if (value) lines.push("", value);
      }
    }
    for (const block of section.blocks) {
      const value = canonicalBlockToMarkdown(block);
      if (value) lines.push("", value);
    }
  }
  return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

export function hasCanonicalEditorSections(document: LegacyResumeDocument) {
  return document.semantic_sections.length > 0
    && document.semantic_sections.every((section) => section.content_key === "custom_sections")
    && document.semantic_sections.every((section) => section.custom_section_id);
}

export function resumeDocumentToMarkdown(document: ResumeDocumentRead) {
  if (isCanonicalResumeDocument(document)) return canonicalDocumentToMarkdown(document);
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
  previous: LegacyResumeDocument,
): LegacyResumeDocument {
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
  // Keep marker-looking title text in the legacy adapter.  The canonical
  // cutover owns the structured ``title_icon`` field; until then removing a
  // marker here would make a legal heading icon impossible to round-trip.
  const cleanTitle = (value: string) => value
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

export function styleToEditorSettings(style: LegacyResumePresentation): EditorSettings;
export function styleToEditorSettings(style: CanonicalResumePresentation): EditorSettings;
export function styleToEditorSettings(style: ResumePresentationRead): EditorSettings;
export function styleToEditorSettings(style: ResumePresentationRead): EditorSettings {
  if (isCanonicalResumePresentation(style)) {
    const scoped = style.template_scoped[style.template_snapshot.template_key] ?? {};
    const tokens = style.template_snapshot.tokens;
    const fontScale = scoped.font_scale ?? style.portable.font_scale ?? 1;
    const fontSize = tokens.font_size_pt * (typeof fontScale === "number" && Number.isFinite(fontScale) ? fontScale : 1);
    const lineHeight = scoped.line_height ?? style.portable.line_height ?? tokens.line_height;
    const margins = resumePresentationPageMargins(style);
    const pageMargin = margins.left;
    const verticalPageMargin = margins.top;
    const accentColor = scoped.accent_color ?? style.portable.accent_color ?? tokens.accent_color;
    const supportedThemes = [
      "classic-technical",
      "administrative-sidebar",
      "campus-professional",
      "civic-service",
      "creative-orange",
      "modern",
      "compact",
    ] as const;
    const theme = supportedThemes.find((candidate) => style.template_snapshot.template_key.startsWith(candidate)) ?? "classic";
    const persistedFontFamily = tokens.font_family === "source-han-serif"
      ? '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif'
      : tokens.font_family;
    const fontFamily = /PingFang SC|Microsoft YaHei|system-ui/u.test(persistedFontFamily)
      ? '"LinkCV Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
      : persistedFontFamily;
    void accentColor;
    return {
      fontFamily,
      fontSize,
      lineHeight,
      pageMargin,
      verticalPageMargin,
      theme,
      smartOnePage: style.portable.smart_one_page ?? false,
      showSource: false,
    };
  }
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
  previous: LegacyResumePresentation,
): LegacyResumePresentation;
export function editorSettingsToStyle(
  settings: EditorSettings,
  previous: CanonicalResumePresentation,
): CanonicalResumePresentation;
export function editorSettingsToStyle(
  settings: EditorSettings,
  previous: ResumePresentationRead,
): ResumePresentationRead;
export function editorSettingsToStyle(
  settings: EditorSettings,
  previous: ResumePresentationRead,
): ResumePresentationRead {
  if (isCanonicalResumePresentation(previous)) {
    const key = previous.template_snapshot.template_key;
    const tokens = previous.template_snapshot.tokens;
    const previousScoped = previous.template_scoped[key] ?? {};
    const fontScale = tokens.font_size_pt > 0
      ? settings.fontSize / tokens.font_size_pt
      : previousScoped.font_scale ?? previous.portable.font_scale ?? 1;
    const previousSettings = styleToEditorSettings(previous);
    const horizontalMarginChanged = settings.pageMargin !== previousSettings.pageMargin;
    const verticalMarginChanged = settings.verticalPageMargin !== previousSettings.verticalPageMargin;
    const edgeOverrides: PresentationSettings = {
      ...(horizontalMarginChanged
        ? {
            page_margin_left_mm: settings.pageMargin,
            page_margin_right_mm: settings.pageMargin,
          }
        : {}),
      ...(verticalMarginChanged
        ? {
            page_margin_top_mm: settings.verticalPageMargin,
            page_margin_bottom_mm: settings.verticalPageMargin,
          }
        : {}),
    };
    return {
      ...previous,
      portable: {
        ...previous.portable,
        smart_one_page: settings.smartOnePage,
        line_height: settings.lineHeight,
        page_margin_mm: settings.pageMargin,
        vertical_page_margin_mm: settings.verticalPageMargin,
        accent_color: previous.portable.accent_color ?? null,
      },
      template_scoped: {
        ...previous.template_scoped,
        [key]: {
          ...previousScoped,
          ...edgeOverrides,
          font_scale: Number.isFinite(fontScale) ? fontScale : 1,
          line_height: settings.lineHeight,
          page_margin_mm: settings.pageMargin,
          vertical_page_margin_mm: settings.verticalPageMargin,
        },
      },
    };
  }
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
