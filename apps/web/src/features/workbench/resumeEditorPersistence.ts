import type { JSONContent } from "@tiptap/core";
import type { ResumeDocument, RichText } from "../../api/resumeContract";
import { stripTemplateProjectionFromEditorDocument } from "./templateLayout";

type SemanticKind = ResumeDocument["semantic_sections"][number]["semantic_kind"];

const BLOCK_ID_PATTERN = /^blk_[a-z0-9]{16,64}$/u;

function nodeText(node: JSONContent): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

function headingAnchor(node: JSONContent) {
  return node.content?.find((child) => child.type === "resumeBlockAnchor");
}

function headingBlockId(node: JSONContent) {
  const value = headingAnchor(node)?.attrs?.blockId;
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value) ? value : null;
}

function headingSemanticKind(node: JSONContent): SemanticKind | null {
  const value = headingAnchor(node)?.attrs?.semanticKind;
  return typeof value === "string" ? value as SemanticKind : null;
}

function isSectionHeading(node: JSONContent) {
  return node.type === "heading" && Number(node.attrs?.level) === 2;
}

function stableBlockId(seed: string, index: number) {
  let first = 2166136261;
  let second = 2166136261;
  for (const char of `${seed}:${index}`) {
    first = Math.imul(first ^ char.charCodeAt(0), 16777619);
    second = Math.imul(second ^ (char.charCodeAt(0) + 31), 16777619);
  }
  return `blk_${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function cleanHeadingTitle(node: JSONContent) {
  return nodeText({
    ...node,
    content: (node.content ?? []).filter((child) => child.type !== "resumeBlockAnchor"),
  }).trim() || "未命名章节";
}

function tiptapContent(value: RichText): JSONContent | null {
  return value.format === "tiptap-json" && value.content.type === "doc"
    ? value.content
    : null;
}

export function hasCanonicalTiptapSections(document: ResumeDocument) {
  if (!document.semantic_sections.length) return false;
  const custom = new Map(document.sections.custom_sections.map((section) => [section.id, section]));
  return document.semantic_sections.every((semantic) => {
    if (semantic.content_key !== "custom_sections" || !semantic.custom_section_id) return false;
    const section = custom.get(semantic.custom_section_id);
    return Boolean(
      section
      && section.items.length > 0
      && section.items.every((item) => tiptapContent(item.content)),
    );
  });
}

export function resumeDocumentToEditorDocument(document: ResumeDocument): JSONContent | null {
  if (!hasCanonicalTiptapSections(document)) return null;
  const custom = new Map(document.sections.custom_sections.map((section) => [section.id, section]));
  const content = document.semantic_sections.flatMap((semantic) => {
    const section = custom.get(semantic.custom_section_id ?? "");
    return section?.items.flatMap((item) => tiptapContent(item.content)?.content ?? []) ?? [];
  });
  return stripTemplateProjectionFromEditorDocument({ type: "doc", content }, document);
}

type PersistedBlock = {
  id: string;
  title: string;
  kind: SemanticKind;
  nodes: JSONContent[];
};

function editorBlocks(document: JSONContent, previous: ResumeDocument): PersistedBlock[] {
  const previousById = new Map(previous.semantic_sections
    .filter((section) => section.custom_section_id)
    .map((section) => [section.custom_section_id as string, section]));
  const titleCounts = new Map<string, number>();
  for (const section of previous.semantic_sections) {
    const title = section.display_title.trim();
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const previousByTitle = new Map(previous.semantic_sections
    .filter((section) => titleCounts.get(section.display_title.trim()) === 1)
    .map((section) => [section.display_title.trim(), section]));
  const basics = previous.semantic_sections.find((section) => section.semantic_kind === "basics");
  const blocks: PersistedBlock[] = [];
  let current: PersistedBlock = {
    id: basics?.custom_section_id ?? stableBlockId("基本信息", 0),
    title: basics?.display_title ?? "基本信息",
    kind: "basics",
    nodes: [],
  };
  for (const node of document.content ?? []) {
    if (!isSectionHeading(node)) {
      current.nodes.push(node);
      continue;
    }
    if (current.nodes.length > 0) blocks.push(current);
    const title = cleanHeadingTitle(node);
    const anchoredId = headingBlockId(node);
    const previousSemantic = (anchoredId ? previousById.get(anchoredId) : null)
      ?? previousByTitle.get(title);
    current = {
      id: anchoredId
        ?? previousSemantic?.custom_section_id
        ?? stableBlockId(title, blocks.length),
      title,
      kind: headingSemanticKind(node) ?? previousSemantic?.semantic_kind ?? "custom",
      nodes: [node],
    };
  }
  if (current.nodes.length > 0 || blocks.length === 0) blocks.push(current);
  return blocks;
}

function findUserAvatar(node: JSONContent): { src: string; size: number } | null {
  if (
    node.type === "avatarImage"
    && node.attrs?.systemFallback !== true
    && typeof node.attrs?.src === "string"
  ) {
    return {
      src: node.attrs.src,
      size: Math.min(220, Math.max(56, Number(node.attrs?.size) || 96)),
    };
  }
  for (const child of node.content ?? []) {
    const avatar = findUserAvatar(child);
    if (avatar) return avatar;
  }
  return null;
}

export function editorDocumentUserAvatar(document: JSONContent) {
  return findUserAvatar(document);
}

export function resumeDocumentFromEditorDocument(
  editorDocument: JSONContent,
  previous: ResumeDocument,
): ResumeDocument {
  const avatar = findUserAvatar(editorDocument);
  const canonical = stripTemplateProjectionFromEditorDocument(editorDocument, previous);
  const blocks = editorBlocks(canonical, previous);
  const previousCustom = new Map(previous.sections.custom_sections.map((section) => [section.id, section]));
  const previousSemantic = new Map(previous.semantic_sections
    .filter((section) => section.custom_section_id)
    .map((section) => [section.custom_section_id as string, section]));
  const customSections = blocks.map((block) => {
    const oldSection = previousCustom.get(block.id);
    const oldItems = oldSection?.items ?? [];
    return {
      id: block.id,
      title: block.title,
      items: [
        {
          id: oldItems[0]?.id ?? `item_${block.id.slice(4)}`,
          title: null,
          subtitle: null,
          content: {
            format: "tiptap-json" as const,
            content: { type: "doc", content: block.nodes },
          },
          source_refs: oldItems[0]?.source_refs ?? [],
        },
        ...oldItems.slice(1).map((item) => ({
          id: item.id,
          title: null,
          subtitle: null,
          // Imported provenance can span multiple legacy items. Keep those
          // stable items as empty metadata carriers; editor reconstruction
          // concatenates their empty documents without inventing content.
          content: {
            format: "tiptap-json" as const,
            content: { type: "doc", content: [] },
          },
          source_refs: item.source_refs,
        })),
      ],
    };
  });
  const semanticSections = blocks.map((block) => {
    const oldSemantic = previousSemantic.get(block.id);
    return {
      id: oldSemantic?.id ?? `sem_${block.id.slice(4)}`,
      semantic_kind: block.kind,
      display_title: block.title,
      semantic_source: oldSemantic?.semantic_source ?? "user" as const,
      semantic_confidence: oldSemantic?.semantic_confidence ?? null,
      content_key: "custom_sections" as const,
      custom_section_id: block.id,
    };
  });
  const firstHeading = canonical.content?.find((node) => (
    node.type === "heading" && Number(node.attrs?.level) === 1
  ));
  return {
    ...previous,
    basics: {
      ...previous.basics,
      name: firstHeading ? nodeText(firstHeading).trim() || previous.basics.name : previous.basics.name,
      headline: null,
      email: null,
      phone: null,
      location: null,
      photo: avatar?.src ?? previous.basics.photo,
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
