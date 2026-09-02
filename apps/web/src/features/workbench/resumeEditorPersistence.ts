import type { JSONContent } from "@tiptap/core";
import {
  isCanonicalResumeDocument,
  type CanonicalContentBlock,
  type CanonicalContact,
  type CanonicalInlineIcon,
  type CanonicalInlineMedia,
  type CanonicalResumeDocument,
  type CanonicalResumeEntry,
  type CanonicalResumeSection,
  type CanonicalRowBlock,
  type CanonicalRowCell,
  type CanonicalTextRun,
  type ResumeDocument,
  type ResumeDocumentRead,
  type RichText,
} from "../../api/resumeContract";
import { inlineIconMarkdown, isInlineIconName } from "../../lib/resumeInlineIcon";
import { stripTemplateProjectionFromEditorDocument } from "./templateLayout";

type SemanticKind = ResumeDocument["semantic_sections"][number]["semantic_kind"];

const BLOCK_ID_PATTERN = /^(?:blk|node)_[a-z0-9]{16,64}$/u;

function nodeText(node: JSONContent): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "inlineIcon" && isInlineIconName(node.attrs?.name)) {
    return inlineIconMarkdown(node.attrs.name);
  }
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

function normalizePersistedTiptapNode(node: JSONContent): JSONContent {
  const normalizedAttrs = node.type === "orderedList"
    && node.attrs
    && Object.prototype.hasOwnProperty.call(node.attrs, "type")
    && node.attrs.type === null
    ? Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== "type"))
    : node.attrs;
  return {
    ...node,
    ...(node.attrs === undefined ? {} : { attrs: normalizedAttrs }),
    ...(node.content === undefined
      ? {}
      : { content: node.content.map(normalizePersistedTiptapNode) }),
  };
}

type CanonicalSemanticKind = CanonicalResumeSection["semantic_kind"];
type CanonicalFieldKey = keyof CanonicalResumeEntry["fields"];
type CanonicalAnchorRole =
  | "identity"
  | "identity-name"
  | "identity-headline"
  | "contact"
  | "section"
  | "section-title"
  | "entry"
  | "entry-field"
  | "section-block"
  | "entry-block"
  | "row"
  | "row-cell"
  | "row-block"
  | "list"
  | "list-item"
  | "block";

type CanonicalAnchorOptions = {
  role?: CanonicalAnchorRole;
  sourceRefs?: string[];
  semanticKind?: string;
  fieldKey?: string;
  contactKind?: CanonicalContact["contact_kind"];
  label?: string | null;
};

function canonicalAnchor(nodeId: string, options: CanonicalAnchorOptions = {}): JSONContent {
  const attrs: Record<string, unknown> = {
    blockId: nodeId,
    ...(options.semanticKind ? { semanticKind: options.semanticKind } : {}),
    ...(options.role ? { role: options.role } : {}),
    ...(options.sourceRefs?.length ? { sourceRefs: options.sourceRefs } : {}),
    ...(options.fieldKey ? { fieldKey: options.fieldKey } : {}),
    ...(options.contactKind ? { contactKind: options.contactKind } : {}),
    ...(options.label != null ? { label: options.label } : {}),
  };
  return { type: "resumeBlockAnchor", attrs };
}

function canonicalRunToEditor(
  run: CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia,
): JSONContent {
  if (run.inline_type === "icon") {
    return { type: "inlineIcon", attrs: { name: run.name } };
  }
  if (run.inline_type === "media") {
    const width = run.width ?? 72;
    const height = run.height_px;
    return {
      type: "inlineImage",
      attrs: {
        src: run.src,
        width,
        height,
        aspectRatio: height && width ? width / height : 3,
        alt: run.alt ?? "行内图片",
        nodeId: run.node_id,
        sourceRefs: run.source_refs,
      },
    };
  }
  const marks: NonNullable<JSONContent["marks"]> = run.marks.map((mark) => ({ type: mark })) as NonNullable<JSONContent["marks"]>;
  if (run.href) marks.push({ type: "link", attrs: { href: run.href } } as never);
  if (run.style.color || run.style.font_size_pt != null) {
    marks.push({
      type: "textStyle",
      attrs: {
        ...(run.style.color ? { color: run.style.color } : {}),
        ...(run.style.font_size_pt != null ? { fontSize: `${run.style.font_size_pt}pt` } : {}),
      },
    } as never);
  }
  if (run.style.highlight_color) {
    marks.push({ type: "highlight", attrs: { color: run.style.highlight_color } } as never);
  }
  return {
    type: "text",
    text: run.text,
    ...(marks.length ? { marks } : {}),
  };
}

function canonicalRunsToEditor(
  runs: Array<CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia>,
) {
  return runs.map(canonicalRunToEditor);
}

function canonicalCellToEditor(
  cell: CanonicalRowCell,
  rowId: string,
  rowSourceRefs: string[],
  index: number,
): JSONContent {
  if (cell.blocks.length !== 1 || cell.blocks[0].block_type !== "paragraph") {
    throw new Error("RESUME_EDITOR_ROW_CELL_UNSUPPORTED_BLOCK");
  }
  const paragraph = cell.blocks[0];
  return {
    type: "paragraph",
    content: [
      ...(index === 0 ? [canonicalAnchor(rowId, { role: "row", sourceRefs: rowSourceRefs })] : []),
      canonicalAnchor(cell.node_id, { role: "row-cell", sourceRefs: cell.source_refs }),
      canonicalAnchor(paragraph.node_id, { role: "row-block", sourceRefs: paragraph.source_refs }),
      ...canonicalRunsToEditor(paragraph.runs),
    ],
  };
}

function canonicalBlockToEditor(
  block: CanonicalContentBlock,
  role: "section-block" | "entry-block" | "row-block" | "block" = "block",
): JSONContent {
  if (block.block_type === "media") {
    return {
      type: "resumeImage",
      attrs: {
        src: block.src,
        width: block.width ?? 55,
        widthUnit: block.width_unit ?? "%",
        align: block.align ?? "center",
        alt: block.alt ?? "简历图片",
        nodeId: block.node_id,
        sourceRefs: block.source_refs,
      },
    };
  }
  if (block.block_type === "paragraph") {
    return {
      type: "paragraph",
      content: [canonicalAnchor(block.node_id, { role, sourceRefs: block.source_refs }), ...canonicalRunsToEditor(block.runs)],
    };
  }
  if (block.block_type === "row") {
    return {
      type: block.row_kind === "pair"
        ? "resumeRow"
        : block.row_kind === "meta" ? "resumeMetaRow" : "resumeTrioRow",
      ...(block.row_kind === "pair"
        ? { attrs: { leftWidth: block.left_width_percent ?? 50 } }
        : {}),
      content: block.cells.map((cell, index) => canonicalCellToEditor(cell, block.node_id, block.source_refs, index)),
    };
  }
  return {
    type: block.block_type === "ordered_list" ? "orderedList" : "bulletList",
    attrs: {
      ...(block.block_type === "ordered_list" && block.start != null ? { start: block.start } : {}),
    },
    content: block.items.map((item, index) => ({
      type: "listItem",
      content: [{
        type: "paragraph",
        content: [
          ...(index === 0 ? [canonicalAnchor(block.node_id, { role: "list" })] : []),
          canonicalAnchor(item.node_id, { role: "list-item", sourceRefs: item.source_refs }),
          ...canonicalRunsToEditor(item.runs),
        ],
      }],
    })),
  };
}

const canonicalFieldLabels: Array<[CanonicalFieldKey, string]> = [
  ["name", "姓名"],
  ["organization", "组织"],
  ["role", "角色"],
  ["location", "地点"],
  ["start_date", "开始"],
  ["end_date", "结束"],
  ["url", "链接"],
  ["degree", "学位"],
  ["major", "专业"],
];

function canonicalFieldLine(
  key: CanonicalFieldKey,
  value: NonNullable<CanonicalResumeEntry["fields"][CanonicalFieldKey]>,
): JSONContent {
  const label = canonicalFieldLabels.find(([fieldKey]) => fieldKey === key)?.[1] ?? key;
  return {
    type: "paragraph",
    content: [
      canonicalAnchor(value.node_id, { role: "entry-field", fieldKey: key, sourceRefs: value.source_refs }),
      { type: "text", text: `${label}：${value.value}` },
    ],
  };
}

function canonicalEntryToEditor(entry: CanonicalResumeEntry): JSONContent[] {
  const name = entry.fields.name;
  return [
    {
      type: "heading",
      attrs: { level: 3 },
      content: [
        canonicalAnchor(entry.node_id, { role: "entry", sourceRefs: entry.source_refs }),
        ...(name ? [canonicalAnchor(name.node_id, { role: "entry-field", fieldKey: "name", sourceRefs: name.source_refs })] : []),
        ...(name?.value ? [{ type: "text", text: name.value }] : []),
      ],
    },
    ...canonicalFieldLabels
      .filter(([key]) => key !== "name")
      .flatMap(([key]) => {
        const value = entry.fields[key];
        return value ? [canonicalFieldLine(key, value)] : [];
      }),
    ...entry.blocks.map((block) => canonicalBlockToEditor(block, "entry-block")),
  ];
}

function canonicalSectionToEditor(section: CanonicalResumeSection): JSONContent[] {
  const title = section.title;
  return [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [
        canonicalAnchor(section.node_id, {
          role: "section",
          semanticKind: section.semantic_kind,
          sourceRefs: section.source_refs,
        }),
        ...(title ? [canonicalAnchor(title.node_id, { role: "section-title", sourceRefs: title.source_refs })] : []),
        ...(section.title_icon ? [{ type: "inlineIcon", attrs: { name: section.title_icon.name } }] : []),
        ...(title?.value ? [{ type: "text", text: title.value }] : []),
      ],
    },
    ...section.entries.flatMap(canonicalEntryToEditor),
    ...section.blocks.map((block) => canonicalBlockToEditor(block, "section-block")),
  ];
}

/**
 * Canonical documents enter TipTap as a stable editing projection.  No
 * presentation region/slot information is written into the source document.
 */
export function canonicalResumeDocumentToEditorDocument(document: CanonicalResumeDocument): JSONContent {
  const identity = document.identity;
  const content: JSONContent[] = [];
  if (identity.avatar && !identity.avatar.system_fallback) {
    content.push({
      type: "avatarImage",
      attrs: {
        src: identity.avatar.src,
        size: identity.avatar.width ?? 96,
        alt: identity.avatar.alt ?? "简历头像",
        systemFallback: false,
        nodeId: identity.avatar.node_id,
        sourceRefs: identity.avatar.source_refs,
      },
    });
  }
  if (identity.name) {
    content.push({
      type: "heading",
      attrs: { level: 1 },
      content: [
        canonicalAnchor(identity.node_id, { role: "identity", sourceRefs: [] }),
        canonicalAnchor(identity.name.node_id, { role: "identity-name", sourceRefs: identity.name.source_refs }),
        { type: "text", text: identity.name.value },
      ],
    });
  }
  if (identity.headline) {
    content.push({
      type: "paragraph",
      content: [
        canonicalAnchor(identity.headline.node_id, { role: "identity-headline", sourceRefs: identity.headline.source_refs }),
        { type: "text", text: identity.headline.value },
      ],
    });
  }
  if (identity.contacts.length) {
    content.push({
      type: "paragraph",
      content: identity.contacts.flatMap((contact, index) => [
        ...(index ? [{ type: "text", text: " ｜ " }] : []),
        canonicalAnchor(contact.node_id, {
          role: "contact",
          contactKind: contact.contact_kind,
          label: contact.label,
          sourceRefs: contact.source_refs,
        }),
        { type: "text", text: contact.label ? `${contact.label}：${contact.value}` : contact.value },
      ]),
    });
  }
  content.push(...document.sections.flatMap(canonicalSectionToEditor));
  return { type: "doc", content };
}

function directEditorAnchors(node: JSONContent): JSONContent[] {
  if (node.type === "resumeBlockAnchor") return [node];
  return (node.content ?? []).filter((child) => child.type === "resumeBlockAnchor");
}

function editorAnchorId(node: JSONContent): string | null {
  const value = directEditorAnchors(node)[0]?.attrs?.blockId;
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value) ? value : null;
}

function editorAnchorWithRole(node: JSONContent, role: CanonicalAnchorRole): JSONContent | null {
  return directEditorAnchors(node).find((anchor) => anchor.attrs?.role === role) ?? null;
}

function editorAnchorIds(node: JSONContent): string[] {
  const result: string[] = [];
  if (node.type === "resumeBlockAnchor") {
    const value = node.attrs?.blockId;
    if (typeof value === "string" && BLOCK_ID_PATTERN.test(value)) result.push(value);
  }
  for (const child of node.content ?? []) result.push(...editorAnchorIds(child));
  return result;
}

function generatedCanonicalNodeId(seed: string, index: number) {
  // Newly created editor blocks already receive a blk_ identity from the
  // editor extension. This fallback is only for a plain JSON projection used
  // by an importer or test fixture and does not calculate a content digest.
  return stableBlockId(seed, index).replace(/^blk_/u, "node_");
}

function canonicalRunsFromEditor(
  nodes: JSONContent[],
): Array<CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia> {
  const result: Array<CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia> = [];
  for (const node of nodes) {
    if (node.type === "resumeBlockAnchor" || node.type === "hardBreak") continue;
    if (node.type === "inlineIcon") {
      const name = node.attrs?.name;
      if (isInlineIconName(name)) {
        result.push({ inline_type: "icon", name });
      } else {
        result.push({
          inline_type: "text",
          text: `:icon[${String(name ?? "")}]:`,
          marks: [],
          href: null,
          style: { color: null, font_size_pt: null, highlight_color: null },
        });
      }
      continue;
    }
    if (node.type === "text") {
      const link = node.marks?.find((mark) => mark.type === "link")?.attrs?.href;
      const textStyle = node.marks?.find((mark) => mark.type === "textStyle")?.attrs;
      const highlight = node.marks?.find((mark) => mark.type === "highlight")?.attrs?.color;
      const marks = (node.marks ?? [])
        .map((mark) => mark.type)
        .filter((mark): mark is CanonicalTextRun["marks"][number] => ["bold", "italic", "underline", "strike", "code"].includes(mark));
      result.push({
        inline_type: "text" as const,
        text: node.text ?? "",
        marks,
        href: typeof link === "string" ? link : null,
        style: {
          color: typeof textStyle?.color === "string" ? textStyle.color : null,
          font_size_pt: typeof textStyle?.fontSize === "number"
            ? textStyle.fontSize
            : typeof textStyle?.fontSize === "string"
              ? Number.parseFloat(textStyle.fontSize)
              : null,
          highlight_color: typeof highlight === "string" ? highlight : null,
        },
      });
      continue;
    }
    if (node.type === "inlineImage") {
      const width = Number(node.attrs?.width);
      const height = node.attrs?.height == null ? null : Number(node.attrs.height);
      result.push({
        inline_type: "media" as const,
        node_id: typeof node.attrs?.nodeId === "string"
          ? node.attrs.nodeId
          : generatedCanonicalNodeId("inline-media", 0),
        source_refs: Array.isArray(node.attrs?.sourceRefs) ? node.attrs.sourceRefs : [],
        media_kind: "inline_image" as const,
        src: typeof node.attrs?.src === "string" ? node.attrs.src : "",
        alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : null,
        width: Number.isFinite(width) ? width : null,
        width_unit: "px" as const,
        height_px: Number.isFinite(height) ? height : null,
        align: null,
        system_fallback: false,
      });
      continue;
    }
  }
  return result;
}

function canonicalBlockFromEditor(node: JSONContent, index: number): CanonicalContentBlock | null {
  if (node.type === "resumeRow" || node.type === "resumeMetaRow" || node.type === "resumeTrioRow") {
    const rowKind = node.type === "resumeRow"
      ? "pair"
      : node.type === "resumeMetaRow" ? "meta" : "trio";
    const expected = rowKind === "pair" ? 2 : rowKind === "meta" ? 4 : 3;
    const cells = node.content ?? [];
    if (cells.length !== expected) return null;
    const firstCellAnchors = editorAnchorIds(cells[0] ?? {});
    const rowId = firstCellAnchors[0] ?? generatedCanonicalNodeId("row", index);
    const canonicalCells: CanonicalRowBlock["cells"] = cells.map((cell, cellIndex) => {
      const anchors = editorAnchorIds(cell);
      // The first cell carries the row anchor followed by cell/block anchors;
      // subsequent cells only carry their cell/block anchors.  Keep the
      // positional convention stable so rows survive an editor round-trip.
      const cellId = (cellIndex === 0 ? anchors[1] : anchors[0])
        ?? anchors[0]
        ?? generatedCanonicalNodeId(`${rowId}-cell`, cellIndex);
      const blockId = (cellIndex === 0 ? anchors[2] : anchors[1])
        ?? generatedCanonicalNodeId(`${cellId}-block`, 0);
      const runs = canonicalRunsFromEditor(cell.content ?? []);
      const blocks: CanonicalRowCell["blocks"] = [{
        node_id: blockId,
        source_refs: [],
        block_type: "paragraph",
        runs,
      }];
      return { node_id: cellId, source_refs: [], blocks };
    });
    const leftWidth = node.type === "resumeRow"
      ? Number(node.attrs?.leftWidth ?? 50)
      : null;
    if (node.type === "resumeRow" && (!Number.isFinite(leftWidth) || leftWidth == null || leftWidth < 30 || leftWidth > 80)) return null;
    return {
      node_id: rowId,
      source_refs: [],
      block_type: "row",
      row_kind: rowKind,
      cells: canonicalCells,
      left_width_percent: leftWidth,
    };
  }
  if (node.type === "paragraph") {
    const nodeId = editorAnchorId(node) ?? generatedCanonicalNodeId("paragraph", index);
    return {
      node_id: nodeId,
      source_refs: [],
      block_type: "paragraph",
      runs: canonicalRunsFromEditor(node.content ?? []),
    };
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const nodeId = typeof node.attrs?.nodeId === "string"
      ? node.attrs.nodeId
      : editorAnchorId(node.content?.[0]?.content?.[0] ?? {}) ?? generatedCanonicalNodeId("list", index);
    return {
      node_id: nodeId,
      block_type: node.type === "orderedList" ? "ordered_list" : "bullet_list",
      start: node.type === "orderedList" && Number.isFinite(Number(node.attrs?.start))
        ? Number(node.attrs?.start)
        : null,
      items: (node.content ?? []).map((item, itemIndex) => {
        const paragraph = item.content?.find((child) => child.type === "paragraph");
        return {
          node_id: editorAnchorId(paragraph ?? item) ?? generatedCanonicalNodeId(`${nodeId}-item`, itemIndex),
          source_refs: [],
          runs: canonicalRunsFromEditor(paragraph?.content ?? item.content ?? []),
        };
      }),
    };
  }
  if (node.type === "resumeImage") {
    return {
      node_id: typeof node.attrs?.nodeId === "string"
        ? node.attrs.nodeId
        : generatedCanonicalNodeId("media", index),
      source_refs: Array.isArray(node.attrs?.sourceRefs) ? node.attrs.sourceRefs : [],
      block_type: "media",
      media_kind: "resume_image",
      src: typeof node.attrs?.src === "string" ? node.attrs.src : "",
      alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : null,
      width: typeof node.attrs?.width === "number" ? node.attrs.width : null,
      width_unit: node.attrs?.widthUnit === "px" ? "px" : "%",
      height_px: null,
      align: ["left", "center", "right", "full"].includes(String(node.attrs?.align))
        ? String(node.attrs?.align) as "left" | "center" | "right" | "full"
        : null,
      system_fallback: false,
    };
  }
  return null;
}

function canonicalBlocksFromEditor(nodes: JSONContent[]): CanonicalContentBlock[] {
  return nodes.map((node, index) => canonicalBlockFromEditor(node, index)).filter(
    (block): block is CanonicalContentBlock => Boolean(block),
  );
}

function editorTextWithoutAnchor(node: JSONContent): string {
  return (node.content ?? []).filter((child) => child.type !== "resumeBlockAnchor").flatMap((child) => {
    if (child.type === "text") return [child.text ?? ""];
    return [editorTextWithoutAnchor(child)];
  }).join("").trim();
}

function preserveBlockMetadata(
  block: CanonicalContentBlock,
  previous: CanonicalContentBlock | undefined,
): CanonicalContentBlock {
  if (!previous || previous.block_type !== block.block_type) return block;
  if (block.block_type === "bullet_list" || block.block_type === "ordered_list") {
    const previousItems = previous.block_type === "bullet_list" || previous.block_type === "ordered_list"
      ? previous.items
      : [];
    return {
      ...block,
      items: block.items.map((item, index) => ({
        ...item,
        source_refs: previousItems[index]?.source_refs ?? item.source_refs,
      })),
    };
  }
  if (block.block_type === "row" && previous.block_type === "row") {
    return {
      ...block,
      source_refs: previous.source_refs,
      cells: block.cells.map((cell, cellIndex) => {
        const previousCell = previous.cells[cellIndex];
        return {
          ...cell,
          source_refs: previousCell?.source_refs ?? cell.source_refs,
          blocks: cell.blocks.map((cellBlock, blockIndex) => {
            const previousBlock = previousCell?.blocks[blockIndex];
            return previousBlock && previousBlock.block_type === cellBlock.block_type
              && "source_refs" in previousBlock && "source_refs" in cellBlock
              ? { ...cellBlock, source_refs: previousBlock.source_refs }
              : cellBlock;
          }),
        };
      }),
    };
  }
  if (!("source_refs" in block)) return block;
  const previousSourceRefs = "source_refs" in previous ? previous.source_refs : [];
  return { ...block, source_refs: previousSourceRefs };
}

function updateCanonicalBlocks(
  nodes: JSONContent[],
  previousBlocks: CanonicalContentBlock[],
) {
  const previousById = new Map(previousBlocks.map((block) => [block.node_id, block]));
  return canonicalBlocksFromEditor(nodes).map((block) => preserveBlockMetadata(block, previousById.get(block.node_id)));
}

function collectTopLevelNodes(content: JSONContent[], start: number, end: number) {
  return content.slice(start, end).filter((node) => (
    node.type !== "avatarImage"
    && node.type !== "heading"
    && node.type !== "resumeColumns"
  ));
}

/*
 * Canonical v1 is a real editing contract rather than a best-effort markdown
 * projection.  Keep the reverse adapter self contained: the legacy adapter
 * below still accepts its older, intentionally lossy shape, while this code
 * either represents every editor node or throws an actionable error.
 */
type CanonicalV1ReverseContext = {
  allocator: CanonicalV1NodeIdAllocator;
  previousNodes: Map<string, unknown>;
};

function canonicalV1NodeId(value: unknown): string | null {
  return typeof value === "string" && /^node_[a-z0-9]{16,64}$/u.test(value) ? value : null;
}

function canonicalV1PreviousSourceRefs(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const refs = (value as { source_refs?: unknown }).source_refs;
  return Array.isArray(refs) && refs.every((item) => typeof item === "string")
    ? [...new Set(refs)]
    : [];
}

function canonicalV1CollectPreviousNodes(value: unknown, result: Map<string, unknown>) {
  if (Array.isArray(value)) {
    value.forEach((item) => canonicalV1CollectPreviousNodes(item, result));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (typeof object.node_id === "string") result.set(object.node_id, value);
  Object.values(object).forEach((item) => canonicalV1CollectPreviousNodes(item, result));
}

function canonicalV1CollectCanonicalIds(value: unknown, result: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => canonicalV1CollectCanonicalIds(item, result));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const nodeId = canonicalV1NodeId(object.node_id);
  if (nodeId) result.add(nodeId);
  Object.values(object).forEach((item) => canonicalV1CollectCanonicalIds(item, result));
}

function canonicalV1CollectEditorIds(node: JSONContent, result: string[]) {
  if (node.type === "resumeBlockAnchor") {
    const anchorId = node.attrs?.blockId;
    if (typeof anchorId === "string" && BLOCK_ID_PATTERN.test(anchorId)) result.push(anchorId);
  }
  if (
    (node.type === "avatarImage" || node.type === "resumeImage" || node.type === "inlineImage")
    && typeof node.attrs?.nodeId === "string"
    && BLOCK_ID_PATTERN.test(node.attrs.nodeId)
  ) {
    result.push(node.attrs.nodeId);
  }
  (node.content ?? []).forEach((child) => canonicalV1CollectEditorIds(child, result));
}

class CanonicalV1NodeIdAllocator {
  private readonly reserved = new Set<string>();
  private readonly claimed = new Set<string>();
  private readonly counters = new Map<string, number>();

  constructor(previous: CanonicalResumeDocument) {
    canonicalV1CollectCanonicalIds(previous, this.reserved);
    // document_id is not represented by an editor node and is immutable.
    this.claimed.add(previous.document_id);
  }

  claimOrAllocate(candidate: unknown, seed: string, fallback?: unknown) {
    for (const value of [candidate, fallback]) {
      const nodeId = canonicalV1NodeId(value);
      if (nodeId && !this.claimed.has(nodeId)) {
        this.claimed.add(nodeId);
        return nodeId;
      }
    }
    let index = this.counters.get(seed) ?? 0;
    let nodeId = generatedCanonicalNodeId(seed, index);
    while (this.reserved.has(nodeId) || this.claimed.has(nodeId)) {
      index += 1;
      nodeId = generatedCanonicalNodeId(seed, index);
    }
    this.counters.set(seed, index + 1);
    this.reserved.add(nodeId);
    this.claimed.add(nodeId);
    return nodeId;
  }
}

function canonicalV1TextWithoutAnchors(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "resumeBlockAnchor") return "";
  return (node.content ?? []).map(canonicalV1TextWithoutAnchors).join("");
}

function canonicalV1AssertTextOnly(node: JSONContent, context: string) {
  for (const child of node.content ?? []) {
    const allowedIcon = context === "section-heading" && child.type === "inlineIcon";
    if (child.type !== "resumeBlockAnchor" && child.type !== "text" && child.type !== "hardBreak" && !allowedIcon) {
      throw new Error("RESUME_EDITOR_UNSUPPORTED_NESTED_STRUCTURE:" + context + ":" + String(child.type));
    }
  }
}

function canonicalV1SectionTitleIcon(node: JSONContent): CanonicalInlineIcon | null {
  const icons = (node.content ?? []).filter((child) => child.type === "inlineIcon");
  if (!icons.length) return null;
  const name = icons[0].attrs?.name;
  if (icons.length !== 1 || !isInlineIconName(name)) {
    throw new Error("RESUME_EDITOR_INVALID_SECTION_TITLE_ICON");
  }
  return { inline_type: "icon", name };
}

function canonicalV1SourceRefsForNode(
  node: JSONContent,
  nodeId: string,
  context: CanonicalV1ReverseContext,
) {
  const attrRefs = node.attrs?.sourceRefs;
  if (Array.isArray(attrRefs) && attrRefs.every((item: unknown) => typeof item === "string")) {
    return [...new Set(attrRefs)];
  }
  const anchor = directEditorAnchors(node).find((candidate) => Array.isArray(candidate.attrs?.sourceRefs));
  const anchorRefs = Array.isArray(anchor?.attrs?.sourceRefs)
    && anchor.attrs.sourceRefs.every((item: unknown) => typeof item === "string")
    ? [...new Set(anchor.attrs.sourceRefs)]
    : null;
  if (anchorRefs) return anchorRefs;
  return canonicalV1PreviousSourceRefs(context.previousNodes.get(nodeId));
}

function canonicalV1RunsFromEditor(
  nodes: JSONContent[],
  context: CanonicalV1ReverseContext,
  seed: string,
): Array<CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia> {
  const result: Array<CanonicalTextRun | CanonicalInlineIcon | CanonicalInlineMedia> = [];
  nodes.forEach((node, index) => {
    if (node.type === "resumeBlockAnchor") return;
    if (node.type === "inlineIcon") {
      const name = node.attrs?.name;
      if (isInlineIconName(name)) {
        result.push({ inline_type: "icon", name });
      } else {
        result.push({
          inline_type: "text",
          text: `:icon[${String(name ?? "")}]:`,
          marks: [],
          href: null,
          style: { color: null, font_size_pt: null, highlight_color: null },
        });
      }
      return;
    }
    if (node.type === "text") {
      if (!node.text) return;
      const link = node.marks?.find((mark) => mark.type === "link")?.attrs?.href;
      if (link != null && (typeof link !== "string" || !/^https?:\/\/[^\s]{1,2040}$/u.test(link))) {
        throw new Error("RESUME_EDITOR_INVALID_LINK");
      }
      const textStyle = node.marks?.find((mark) => mark.type === "textStyle")?.attrs;
      const highlight = node.marks?.find((mark) => mark.type === "highlight")?.attrs?.color;
      const marks = [...new Set((node.marks ?? [])
        .map((mark) => mark.type)
        .filter((mark): mark is CanonicalTextRun["marks"][number] => (
          ["bold", "italic", "underline", "strike", "code"].includes(mark)
        )))];
      const fontSize = typeof textStyle?.fontSize === "number"
        ? textStyle.fontSize
        : typeof textStyle?.fontSize === "string"
          ? Number.parseFloat(textStyle.fontSize)
          : null;
      result.push({
        inline_type: "text",
        text: node.text,
        marks,
        href: typeof link === "string" ? link : null,
        style: {
          color: typeof textStyle?.color === "string" ? textStyle.color : null,
          font_size_pt: Number.isFinite(fontSize) ? fontSize : null,
          highlight_color: typeof highlight === "string" ? highlight : null,
        },
      });
      return;
    }
    if (node.type === "hardBreak") {
      result.push({
        inline_type: "text",
        text: "\n",
        marks: [],
        href: null,
        style: { color: null, font_size_pt: null, highlight_color: null },
      });
      return;
    }
    if (node.type === "inlineImage") {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      if (!src) throw new Error("RESUME_EDITOR_MEDIA_SRC_REQUIRED");
      const width = node.attrs?.width == null ? null : Number(node.attrs.width);
      const height = node.attrs?.height == null ? null : Number(node.attrs.height);
      if (width != null && (!Number.isFinite(width) || width < 16 || width > 240)) {
        throw new Error("RESUME_EDITOR_INVALID_INLINE_MEDIA_WIDTH");
      }
      if (height != null && (!Number.isFinite(height) || height < 16 || height > 240)) {
        throw new Error("RESUME_EDITOR_INVALID_INLINE_MEDIA_HEIGHT");
      }
      const nodeId = context.allocator.claimOrAllocate(
        node.attrs?.nodeId,
        seed + "-inline-media-" + index,
      );
      const previous = context.previousNodes.get(nodeId);
      result.push({
        inline_type: "media",
        node_id: nodeId,
        source_refs: canonicalV1SourceRefsForNode(node, nodeId, context)
          || canonicalV1PreviousSourceRefs(previous),
        media_kind: "inline_image",
        src,
        alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : null,
        width: width != null && Number.isFinite(width) ? width : null,
        width_unit: "px",
        height_px: height != null && Number.isFinite(height) ? height : null,
        align: null,
        system_fallback: false,
      });
      return;
    }
    throw new Error("RESUME_EDITOR_UNSUPPORTED_INLINE_NODE:" + String(node.type));
  });
  return result;
}

function canonicalV1BlockFromEditor(
  node: JSONContent,
  index: number,
  previousBlocks: CanonicalContentBlock[],
  context: CanonicalV1ReverseContext,
  seed: string,
): CanonicalContentBlock {
  const previousAtIndex = previousBlocks[index];
  if (node.type === "resumeRow" || node.type === "resumeMetaRow" || node.type === "resumeTrioRow") {
    const rowKind = node.type === "resumeRow"
      ? "pair"
      : node.type === "resumeMetaRow" ? "meta" : "trio";
    const expected = rowKind === "pair" ? 2 : rowKind === "meta" ? 4 : 3;
    const cells = node.content ?? [];
    if (cells.length !== expected) throw new Error("RESUME_EDITOR_ROW_CARDINALITY:" + rowKind);
    const previousRow = previousAtIndex?.block_type === "row" ? previousAtIndex : undefined;
    const firstCell = cells[0];
    if (!firstCell || firstCell.type !== "paragraph") {
      throw new Error("RESUME_EDITOR_ROW_CELL_UNSUPPORTED_BLOCK");
    }
    const rowAnchor = editorAnchorWithRole(firstCell, "row")
      ?? directEditorAnchors(firstCell)[0]
      ?? null;
    const rowId = context.allocator.claimOrAllocate(
      rowAnchor?.attrs?.blockId,
      seed + "-row",
      rowAnchor ? previousRow?.node_id : undefined,
    );
    const rowSourceRefs = canonicalV1SourceRefsForNode(rowAnchor ?? firstCell, rowId, context);
    const canonicalCells: CanonicalRowBlock["cells"] = cells.map((cell, cellIndex) => {
      if (cell.type !== "paragraph") throw new Error("RESUME_EDITOR_ROW_CELL_UNSUPPORTED_BLOCK");
      const anchors = directEditorAnchors(cell);
      const cellAnchor = editorAnchorWithRole(cell, "row-cell")
        ?? anchors.find((candidate) => candidate.attrs?.blockId !== rowId)
        ?? null;
      const previousCell = previousRow?.cells[cellIndex];
      const cellId = context.allocator.claimOrAllocate(
        cellAnchor?.attrs?.blockId,
        seed + "-cell-" + cellIndex,
        cellAnchor ? previousCell?.node_id : undefined,
      );
      const blockAnchor = editorAnchorWithRole(cell, "row-block")
        ?? anchors.find((candidate) => (
          candidate.attrs?.blockId !== rowId && candidate.attrs?.blockId !== cellId
        ))
        ?? null;
      const previousCellBlock = previousCell?.blocks[0];
      const blockId = context.allocator.claimOrAllocate(
        blockAnchor?.attrs?.blockId,
        seed + "-cell-" + cellIndex + "-paragraph",
        blockAnchor ? previousCellBlock?.node_id : undefined,
      );
      return {
        node_id: cellId,
        source_refs: canonicalV1SourceRefsForNode(cellAnchor ?? cell, cellId, context),
        blocks: [{
          node_id: blockId,
          source_refs: canonicalV1SourceRefsForNode(blockAnchor ?? cell, blockId, context),
          block_type: "paragraph",
          runs: canonicalV1RunsFromEditor(
            cell.content ?? [],
            context,
            seed + "-cell-" + cellIndex,
          ),
        }],
      };
    });
    const width = node.type === "resumeRow" ? Number(node.attrs?.leftWidth ?? 50) : null;
    if (rowKind === "pair" && (width == null || !Number.isFinite(width) || width < 30 || width > 80)) {
      throw new Error("RESUME_EDITOR_INVALID_ROW_WIDTH");
    }
    return {
      node_id: rowId,
      source_refs: rowSourceRefs,
      block_type: "row",
      row_kind: rowKind,
      cells: canonicalCells,
      left_width_percent: width,
    };
  }
  if (node.type === "paragraph") {
    const nodeId = context.allocator.claimOrAllocate(
      editorAnchorId(node),
      seed + "-paragraph-" + index,
    );
    return {
      node_id: nodeId,
      source_refs: canonicalV1SourceRefsForNode(node, nodeId, context),
      block_type: "paragraph",
      runs: canonicalV1RunsFromEditor(
        node.content ?? [],
        context,
        seed + "-paragraph-" + index,
      ),
    };
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const items = node.content ?? [];
    if (!items.length) throw new Error("RESUME_EDITOR_EMPTY_LIST");
    const firstParagraph = items[0]?.type === "listItem"
      && items[0].content?.length === 1
      ? items[0].content[0]
      : null;
    if (!firstParagraph || firstParagraph.type !== "paragraph") {
      throw new Error("RESUME_EDITOR_UNSUPPORTED_NESTED_STRUCTURE:list");
    }
    const listCandidate = editorAnchorWithRole(firstParagraph, "list")?.attrs?.blockId
      ?? node.attrs?.nodeId;
    const previousList = listCandidate && previousAtIndex && (
      (node.type === "orderedList" && previousAtIndex.block_type === "ordered_list")
      || (node.type === "bulletList" && previousAtIndex.block_type === "bullet_list")
    ) ? previousAtIndex : undefined;
    const listAnchor = editorAnchorWithRole(firstParagraph, "list");
    const listId = context.allocator.claimOrAllocate(
      listAnchor?.attrs?.blockId ?? node.attrs?.nodeId,
      seed + "-list",
      previousList?.node_id,
    );
    const canonicalItems = items.map((item, itemIndex) => {
      if (item.type !== "listItem" || item.content?.length !== 1 || item.content[0].type !== "paragraph") {
        throw new Error("RESUME_EDITOR_UNSUPPORTED_NESTED_STRUCTURE:list-item");
      }
      const paragraph = item.content[0];
      const itemAnchor = editorAnchorWithRole(paragraph, "list-item")
        ?? directEditorAnchors(paragraph).find((candidate) => candidate.attrs?.blockId !== listId)
        ?? null;
      const previousItem = previousList?.items[itemIndex];
      const itemId = context.allocator.claimOrAllocate(
        itemAnchor?.attrs?.blockId,
        seed + "-list-item-" + itemIndex,
        previousItem?.node_id,
      );
      return {
        node_id: itemId,
        source_refs: canonicalV1SourceRefsForNode(itemAnchor ?? paragraph, itemId, context),
        runs: canonicalV1RunsFromEditor(
          paragraph.content ?? [],
          context,
          seed + "-list-item-" + itemIndex,
        ),
      };
    });
    let start: number | null = null;
    if (node.type === "orderedList") {
      const candidate = Number(node.attrs?.start);
      const previousStart = previousList?.block_type === "ordered_list" ? previousList.start : null;
      start = Number.isFinite(candidate) && candidate >= 1 ? candidate : previousStart ?? 1;
    }
    return {
      node_id: listId,
      block_type: node.type === "orderedList" ? "ordered_list" : "bullet_list",
      start,
      items: canonicalItems,
    };
  }
  if (node.type === "resumeImage") {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    if (!src) throw new Error("RESUME_EDITOR_MEDIA_SRC_REQUIRED");
    const mediaCandidate = node.attrs?.nodeId ?? editorAnchorId(node);
    const previousMedia = mediaCandidate && previousAtIndex?.block_type === "media"
      ? previousAtIndex
      : undefined;
    const nodeId = context.allocator.claimOrAllocate(
      node.attrs?.nodeId ?? editorAnchorId(node),
      seed + "-media-" + index,
      previousMedia?.node_id,
    );
    const width = Number(node.attrs?.width ?? previousMedia?.width ?? 55);
    if (!Number.isFinite(width) || width <= 0 || width > 794) {
      throw new Error("RESUME_EDITOR_INVALID_MEDIA_WIDTH");
    }
    const widthUnit = node.attrs?.widthUnit === "px"
      ? "px"
      : node.attrs?.widthUnit === "%"
        ? "%"
        : previousMedia?.width_unit ?? "%";
    if (widthUnit === "%" && width > 100) throw new Error("RESUME_EDITOR_INVALID_MEDIA_WIDTH");
    const align = node.attrs?.align ?? previousMedia?.align ?? "center";
    if (!["left", "center", "right", "full"].includes(String(align))) {
      throw new Error("RESUME_EDITOR_INVALID_MEDIA_ALIGN");
    }
    return {
      node_id: nodeId,
      source_refs: canonicalV1SourceRefsForNode(node, nodeId, context),
      block_type: "media",
      media_kind: "resume_image",
      src,
      alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : null,
      width,
      width_unit: widthUnit,
      height_px: null,
      align: align as "left" | "center" | "right" | "full",
      system_fallback: false,
    };
  }
  throw new Error("RESUME_EDITOR_UNSUPPORTED_BLOCK:" + String(node.type));
}

function canonicalV1BlocksFromEditor(
  nodes: JSONContent[],
  previousBlocks: CanonicalContentBlock[],
  context: CanonicalV1ReverseContext,
  seed: string,
) {
  return nodes.map((node, index) => canonicalV1BlockFromEditor(
    node,
    index,
    previousBlocks,
    context,
    seed,
  ));
}

function canonicalV1IsEmptyParagraph(node: JSONContent) {
  return node.type === "paragraph"
    && directEditorAnchors(node).length === 0
    && !(node.content ?? []).some((child) => (
      child.type === "hardBreak"
      || (child.type === "text" && Boolean(child.text))
      || (child.type !== "text" && child.type !== "resumeBlockAnchor")
    ));
}

function canonicalV1FlattenEditorNodes(nodes: JSONContent[]): JSONContent[] {
  return nodes.flatMap((node) => {
    if (node.type === "resumeColumns" || node.type === "resumeColumn") {
      const children = node.content ?? [];
      if (node.type === "resumeColumn" && children.length === 1 && canonicalV1IsEmptyParagraph(children[0])) {
        return [];
      }
      return canonicalV1FlattenEditorNodes(children);
    }
    if (node.type === "avatarImage") return [];
    return [node];
  });
}

type CanonicalV1EditorGroup = {
  key: string | null;
  identity: boolean;
  nodes: JSONContent[];
  index: number;
};

function canonicalV1PreviousSectionForHeading(
  node: JSONContent,
  previous: CanonicalResumeDocument,
) {
  const anchorId = editorAnchorId(node);
  if (anchorId) {
    const byId = previous.sections.find((section) => section.node_id === anchorId);
    if (byId) return byId;
  }
  const title = canonicalV1TextWithoutAnchors(node).trim();
  const matches = previous.sections.filter((section) => section.title?.value.trim() === title);
  return matches.length === 1 ? matches[0] : undefined;
}

function canonicalV1OrderedEditorNodes(
  editorDocument: JSONContent,
  previous: CanonicalResumeDocument,
) {
  const hasColumns = (node: JSONContent): boolean => (
    node.type === "resumeColumns"
    || node.type === "resumeColumn"
    || (node.content ?? []).some(hasColumns)
  );
  const content = canonicalV1FlattenEditorNodes(editorDocument.content ?? []);
  if (!(editorDocument.content ?? []).some(hasColumns)) return content;
  const groups: CanonicalV1EditorGroup[] = [];
  let current: CanonicalV1EditorGroup = { key: null, identity: true, nodes: [], index: 0 };
  const flush = () => {
    if (current.nodes.length) groups.push(current);
  };
  content.forEach((node, index) => {
    if (node.type === "heading" && Number(node.attrs?.level) === 2) {
      flush();
      const oldSection = canonicalV1PreviousSectionForHeading(node, previous);
      current = {
        key: editorAnchorId(node) ?? oldSection?.node_id ?? null,
        identity: false,
        nodes: [node],
        index,
      };
      return;
    }
    if (node.type === "heading" && Number(node.attrs?.level) === 1 && current.nodes.length && !current.identity) {
      flush();
      current = { key: null, identity: true, nodes: [node], index };
      return;
    }
    current.nodes.push(node);
  });
  flush();
  const sectionOrder = new Map(previous.sections.map((section, index) => [section.node_id, index]));
  return groups
    .sort((left, right) => {
      if (left.identity !== right.identity) return left.identity ? -1 : 1;
      const leftOrder = left.key == null ? Number.MAX_SAFE_INTEGER : sectionOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.key == null ? Number.MAX_SAFE_INTEGER : sectionOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .flatMap((group) => group.nodes);
}

function canonicalV1ValidSectionSemanticKind(value: unknown): value is CanonicalResumeSection["semantic_kind"] {
  return [
    "profile",
    "work",
    "education",
    "project",
    "skills",
    "activity",
    "interests",
    "certificates",
    "awards",
    "languages",
    "custom",
  ].includes(value as CanonicalResumeSection["semantic_kind"]);
}

function canonicalV1Fields(
  values: Partial<Record<CanonicalFieldKey, CanonicalResumeEntry["fields"][CanonicalFieldKey]>>,
) {
  return Object.fromEntries(canonicalFieldLabels.map(([key]) => [key, values[key] ?? null])) as CanonicalResumeEntry["fields"];
}

function canonicalV1FieldKey(
  node: JSONContent,
  previousEntry: CanonicalResumeEntry | undefined,
): CanonicalFieldKey | null {
  const anchor = editorAnchorWithRole(node, "entry-field");
  if (anchor) {
    const key = anchor.attrs?.fieldKey;
    if (!canonicalFieldLabels.some(([fieldKey]) => fieldKey === key)) {
      throw new Error("RESUME_EDITOR_UNSUPPORTED_FIELD:" + String(key));
    }
    return key as CanonicalFieldKey;
  }
  const nodeId = editorAnchorId(node);
  if (nodeId && previousEntry) {
    const match = canonicalFieldLabels.find(([key]) => previousEntry.fields[key]?.node_id === nodeId);
    if (match) return match[0];
  }
  const text = canonicalV1TextWithoutAnchors(node).trim();
  return canonicalFieldLabels.find(([, label]) => (
    text.startsWith(label + "：") || text.startsWith(label + ":")
  ))?.[0] ?? null;
}

function canonicalV1FieldValue(node: JSONContent, key: CanonicalFieldKey) {
  canonicalV1AssertTextOnly(node, "entry-field");
  let value = canonicalV1TextWithoutAnchors(node).trim();
  const label = canonicalFieldLabels.find(([fieldKey]) => fieldKey === key)?.[1] ?? key;
  if (value.startsWith(label + "：")) value = value.slice((label + "：").length).trim();
  else if (value.startsWith(label + ":")) value = value.slice((label + ":").length).trim();
  return value;
}

function canonicalV1EntryFromEditor(
  heading: JSONContent,
  body: JSONContent[],
  previousEntries: CanonicalResumeEntry[],
  index: number,
  context: CanonicalV1ReverseContext,
  seed: string,
): CanonicalResumeEntry {
  canonicalV1AssertTextOnly(heading, "entry-heading");
  const entryAnchor = editorAnchorWithRole(heading, "entry") ?? directEditorAnchors(heading)[0];
  const previousById = new Map(previousEntries.map((entry) => [entry.node_id, entry]));
  const previousAtIndex = previousEntries[index];
  const entryId = context.allocator.claimOrAllocate(
    entryAnchor?.attrs?.blockId,
    seed + "-entry",
  );
  const previousEntry = previousById.get(entryId);
  const nameAnchor = editorAnchorWithRole(heading, "entry-field")
    ?? directEditorAnchors(heading).find((anchor) => anchor !== entryAnchor);
  const nameValue = canonicalV1TextWithoutAnchors(heading).trim();
  const nameId = nameValue
    ? context.allocator.claimOrAllocate(
      nameAnchor?.attrs?.blockId,
      seed + "-field-name",
      previousEntry?.fields.name?.node_id,
    )
    : null;
  const name = nameId
    ? {
      node_id: nameId,
      source_refs: canonicalV1SourceRefsForNode(nameAnchor ?? heading, nameId, context),
      value: nameValue,
    }
    : null;
  const values: Partial<Record<CanonicalFieldKey, CanonicalResumeEntry["fields"][CanonicalFieldKey]>> = { name };
  const blockNodes: JSONContent[] = [];
  const seenFields = new Set<CanonicalFieldKey>();
  body.forEach((node) => {
    const isEntryBlock = Boolean(editorAnchorWithRole(node, "entry-block"));
    const key = isEntryBlock ? null : canonicalV1FieldKey(node, previousEntry);
    if (key) {
      if (seenFields.has(key)) throw new Error("RESUME_EDITOR_DUPLICATE_FIELD:" + key);
      seenFields.add(key);
      const value = canonicalV1FieldValue(node, key);
      if (!value) {
        values[key] = null;
        return;
      }
      const anchor = editorAnchorWithRole(node, "entry-field") ?? directEditorAnchors(node)[0];
      const fieldId = context.allocator.claimOrAllocate(
        anchor?.attrs?.blockId,
        seed + "-field-" + key,
        previousEntry?.fields[key]?.node_id,
      );
      values[key] = {
        node_id: fieldId,
        source_refs: canonicalV1SourceRefsForNode(anchor ?? node, fieldId, context),
        value,
      };
      return;
    }
    blockNodes.push(node);
  });
  return {
    node_id: entryId,
    source_refs: canonicalV1SourceRefsForNode(entryAnchor ?? heading, entryId, context),
    fields: canonicalV1Fields(values),
    blocks: canonicalV1BlocksFromEditor(
      blockNodes,
      previousEntry?.blocks ?? [],
      context,
      seed + "-block",
    ),
  };
}

function canonicalV1InferContactKind(value: string): CanonicalContact["contact_kind"] {
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value)) return "email";
  if (/^(?:https?:\/\/)?github\.com\//iu.test(value)) return "github";
  if (/^(?:https?:\/\/)?linkedin\.com\//iu.test(value)) return "linkedin";
  if (/^https?:\/\//iu.test(value)) return "website";
  if (/^\+?[\d\s()\-]{6,}$/u.test(value)) return "phone";
  return "other";
}

function canonicalV1ContactsFromEditor(
  nodes: JSONContent[],
  previousContacts: CanonicalContact[],
  context: CanonicalV1ReverseContext,
  seed: string,
): CanonicalContact[] {
  const previousById = new Map(previousContacts.map((contact) => [contact.node_id, contact]));
  const anchoredNodes = nodes.filter((node) => (
    node.type === "paragraph"
    && directEditorAnchors(node).some((anchor) => anchor.attrs?.role === "contact")
  ));
  if (anchoredNodes.length) {
    return anchoredNodes.flatMap((node, nodeIndex) => {
      canonicalV1AssertTextOnly(node, "contact");
      const contacts: CanonicalContact[] = [];
      let current: { anchor: JSONContent; text: string } | null = null;
      const flush = () => {
        if (!current) return;
        const anchor = current.anchor;
        const raw = current.text.replace(/(?:\s*[|｜;；]\s*)$/u, "").trim();
        current = null;
        if (!raw) return;
        const anchorId = anchor.attrs?.blockId;
        const contactId = context.allocator.claimOrAllocate(
          anchorId,
          seed + "-contact-" + nodeIndex + "-" + contacts.length,
        );
        const previous = previousById.get(contactId);
        const label = typeof anchor.attrs?.label === "string"
          ? anchor.attrs.label
          : previous?.label ?? null;
        let value = raw;
        if (label && (value.startsWith(label + "：") || value.startsWith(label + ":"))) {
          value = value.slice(label.length + 1).trim();
        }
        if (!value) return;
        const kind = anchor.attrs?.contactKind;
        const contactKind = ["phone", "email", "website", "location", "github", "linkedin", "other"].includes(String(kind))
          ? kind as CanonicalContact["contact_kind"]
          : previous?.contact_kind ?? canonicalV1InferContactKind(value);
        contacts.push({
          node_id: contactId,
          source_refs: canonicalV1SourceRefsForNode(anchor, contactId, context),
          contact_kind: contactKind,
          value,
          label,
        });
      };
      for (const child of node.content ?? []) {
        if (child.type === "resumeBlockAnchor" && child.attrs?.role === "contact") {
          flush();
          current = { anchor: child, text: "" };
        } else if (current) {
          if (child.type === "text") current.text += child.text ?? "";
          else if (child.type === "hardBreak") current.text += "\n";
          else if (child.type !== "resumeBlockAnchor") {
            throw new Error("RESUME_EDITOR_UNSUPPORTED_NESTED_STRUCTURE:contact");
          }
        } else if (child.type === "text" && child.text?.trim()) {
          throw new Error("RESUME_EDITOR_UNANCHORED_CONTACT_TEXT");
        }
      }
      flush();
      return contacts;
    });
  }
  const fallbackNodes = nodes.filter((node) => (
    node.type === "paragraph"
    && (
      /[|｜;；]/u.test(canonicalV1TextWithoutAnchors(node))
      || previousContacts.some((contact) => editorAnchorId(node) === contact.node_id)
    )
  ));
  let previousIndex = 0;
  return fallbackNodes.flatMap((node, nodeIndex) => {
    canonicalV1AssertTextOnly(node, "contact");
    return canonicalV1TextWithoutAnchors(node).split(/\s*[|｜;；]\s*/u).map((raw) => {
      const text = raw.trim();
      if (!text) return null;
      const previous = previousContacts[previousIndex];
      previousIndex += 1;
      const contactId = context.allocator.claimOrAllocate(
        previous?.node_id,
        seed + "-fallback-contact-" + nodeIndex + "-" + previousIndex,
      );
      let value = text;
      if (previous?.label && (value.startsWith(previous.label + "：") || value.startsWith(previous.label + ":"))) {
        value = value.slice(previous.label.length + 1).trim();
      }
      return {
        node_id: contactId,
        source_refs: previous?.source_refs ?? [],
        contact_kind: previous?.contact_kind ?? canonicalV1InferContactKind(value),
        value,
        label: previous?.label ?? null,
      };
    }).filter((contact) => contact !== null);
  }) as CanonicalContact[];
}

function canonicalV1SectionFromEditor(
  heading: JSONContent,
  body: JSONContent[],
  previousSections: CanonicalResumeSection[],
  index: number,
  context: CanonicalV1ReverseContext,
  seed: string,
): CanonicalResumeSection {
  canonicalV1AssertTextOnly(heading, "section-heading");
  const oldById = new Map(previousSections.map((section) => [section.node_id, section]));
  const oldByTitle = new Map<string, CanonicalResumeSection>();
  const ambiguousTitles = new Set<string>();
  previousSections.forEach((section) => {
    const title = section.title?.value.trim();
    if (!title || ambiguousTitles.has(title)) return;
    if (oldByTitle.has(title)) {
      oldByTitle.delete(title);
      ambiguousTitles.add(title);
    } else {
      oldByTitle.set(title, section);
    }
  });
  const headingAnchor = editorAnchorWithRole(heading, "section")
    ?? directEditorAnchors(heading)[0]
    ?? null;
  const titleIcon = canonicalV1SectionTitleIcon(heading);
  const titleValue = canonicalV1TextWithoutAnchors(heading).trim();
  const oldSection = oldById.get(headingAnchor?.attrs?.blockId ?? "")
    ?? oldByTitle.get(titleValue)
    ?? undefined;
  const sectionId = context.allocator.claimOrAllocate(
    headingAnchor?.attrs?.blockId,
    seed + "-section",
  );
  const semanticKind = canonicalV1ValidSectionSemanticKind(headingAnchor?.attrs?.semanticKind)
    ? headingAnchor?.attrs?.semanticKind
    : oldSection?.semantic_kind ?? "custom";
  const titleAnchor = editorAnchorWithRole(heading, "section-title")
    ?? directEditorAnchors(heading).find((anchor) => anchor !== headingAnchor);
  const titleId = titleValue
    ? context.allocator.claimOrAllocate(
      titleAnchor?.attrs?.blockId,
      seed + "-section-title",
      oldSection?.title?.node_id,
    )
    : null;
  const title = titleId
    ? {
      node_id: titleId,
      source_refs: canonicalV1SourceRefsForNode(titleAnchor ?? heading, titleId, context),
      value: titleValue,
    }
    : null;
  const entryPositions = body
    .map((node, bodyIndex) => ({ node, bodyIndex }))
    .filter(({ node }) => node.type === "heading" && Number(node.attrs?.level) === 3);
  const sectionBlockNodes: JSONContent[] = [];
  const firstEntryIndex = entryPositions[0]?.bodyIndex ?? body.length;
  body.slice(0, firstEntryIndex).forEach((node) => sectionBlockNodes.push(node));
  const entries = entryPositions.map(({ node, bodyIndex }, entryIndex) => {
    const nextIndex = entryPositions[entryIndex + 1]?.bodyIndex ?? body.length;
    const entryBody = body.slice(bodyIndex + 1, nextIndex);
    const entryBlocks: JSONContent[] = [];
    entryBody.forEach((entryNode) => {
      if (editorAnchorWithRole(entryNode, "section-block")) sectionBlockNodes.push(entryNode);
      else entryBlocks.push(entryNode);
    });
    return canonicalV1EntryFromEditor(
      node,
      entryBlocks,
      oldSection?.entries ?? [],
      entryIndex,
      context,
      seed + "-entry-" + entryIndex,
    );
  });
  const projectedTitleIcon = titleIcon ?? (oldSection?.title_icon ? null : undefined);
  return {
    node_id: sectionId,
    source_refs: canonicalV1SourceRefsForNode(headingAnchor ?? heading, sectionId, context),
    semantic_kind: semanticKind,
    title,
    ...(projectedTitleIcon !== undefined ? { title_icon: projectedTitleIcon } : {}),
    entries,
    blocks: canonicalV1BlocksFromEditor(
      sectionBlockNodes,
      oldSection?.blocks ?? [],
      context,
      seed + "-section-block",
    ),
  };
}

function canonicalV1AvatarNodes(node: JSONContent, result: JSONContent[]) {
  if (node.type === "avatarImage" && node.attrs?.systemFallback !== true) result.push(node);
  (node.content ?? []).forEach((child) => canonicalV1AvatarNodes(child, result));
}

function canonicalV1SourceDispositions(
  previous: CanonicalResumeDocument,
  next: CanonicalResumeDocument,
): CanonicalResumeDocument["source_dispositions"] {
  const sourceTargets = new Map<string, string[]>();
  const visit = (value: unknown, key?: string) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    const nodeId = canonicalV1NodeId(object.node_id);
    const refs = object.source_refs;
    if (nodeId && Array.isArray(refs)) {
      refs.filter((item): item is string => typeof item === "string").forEach((sourceId) => {
        const targets = sourceTargets.get(sourceId) ?? [];
        if (!targets.includes(nodeId)) targets.push(nodeId);
        sourceTargets.set(sourceId, targets);
      });
    }
    Object.entries(object).forEach(([childKey, child]) => {
      if (childKey !== "source_dispositions") visit(child, childKey);
    });
  };
  visit(next);
  return previous.source_dispositions.map((disposition) => {
    const targets = sourceTargets.get(disposition.source_id) ?? [];
    if (targets.length) {
      return {
        ...disposition,
        outcome: disposition.outcome === "transformed" ? "transformed" : "mapped",
        target_node_ids: targets,
        reason_code: disposition.outcome === "transformed" ? disposition.reason_code : null,
      };
    }
    if (disposition.outcome === "dropped") return disposition;
    return {
      ...disposition,
      outcome: "dropped",
      target_node_ids: [],
      reason_code: "user_removed",
    };
  });
}

function canonicalV1Reverse(
  editorDocument: JSONContent,
  previous: CanonicalResumeDocument,
): CanonicalResumeDocument {
  if (editorDocument.type !== "doc") throw new Error("RESUME_EDITOR_DOCUMENT_REQUIRED");
  const editorIds: string[] = [];
  canonicalV1CollectEditorIds(editorDocument, editorIds);
  if (editorIds.length !== new Set(editorIds).size) {
    throw new Error("RESUME_EDITOR_DUPLICATE_NODE_ID");
  }
  const context: CanonicalV1ReverseContext = {
    allocator: new CanonicalV1NodeIdAllocator(previous),
    previousNodes: new Map<string, unknown>(),
  };
  canonicalV1CollectPreviousNodes(previous, context.previousNodes);
  const content = canonicalV1OrderedEditorNodes(editorDocument, previous);
  const sectionPositions = content
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === "heading" && Number(node.attrs?.level) === 2);
  const firstSectionIndex = sectionPositions[0]?.index ?? content.length;
  const identityNodes = content.slice(0, firstSectionIndex);
  const identityHeadings = identityNodes.filter(
    (node) => node.type === "heading" && Number(node.attrs?.level) === 1,
  );
  if (identityHeadings.length > 1) throw new Error("RESUME_EDITOR_DUPLICATE_IDENTITY");
  const identityHeading = identityHeadings[0];
  identityNodes.forEach((node) => {
    if (node === identityHeading || node.type === "paragraph") return;
    throw new Error("RESUME_EDITOR_UNSUPPORTED_IDENTITY_NODE:" + String(node.type));
  });
  const previousIdentity = previous.identity;
  let identityId = previousIdentity.node_id;
  if (identityHeading) {
    canonicalV1AssertTextOnly(identityHeading, "identity-heading");
    const identityAnchor = editorAnchorWithRole(identityHeading, "identity")
      ?? directEditorAnchors(identityHeading)[0];
    identityId = context.allocator.claimOrAllocate(
      identityAnchor?.attrs?.blockId,
      "identity",
      previousIdentity.node_id,
    );
  } else {
    context.allocator.claimOrAllocate(previousIdentity.node_id, "identity");
  }
  const nameAnchor = identityHeading
    ? editorAnchorWithRole(identityHeading, "identity-name")
      ?? directEditorAnchors(identityHeading).find((anchor) => anchor.attrs?.role !== "identity")
    : null;
  const nameValue = identityHeading ? canonicalV1TextWithoutAnchors(identityHeading).trim() : "";
  const nameId = nameValue
    ? context.allocator.claimOrAllocate(
      nameAnchor?.attrs?.blockId,
      "identity-name",
      previousIdentity.name?.node_id,
    )
    : null;
  const name = nameId
    ? {
      node_id: nameId,
      source_refs: canonicalV1SourceRefsForNode(nameAnchor ?? identityHeading!, nameId, context),
      value: nameValue,
    }
    : null;
  const identityParagraphs = identityNodes.filter((node) => node.type === "paragraph");
  const hasContactRole = (node: JSONContent) => directEditorAnchors(node).some(
    (anchor) => anchor.attrs?.role === "contact",
  );
  const looksLikeOldContact = (node: JSONContent) => (
    hasContactRole(node)
    || previousIdentity.contacts.some((contact) => editorAnchorId(node) === contact.node_id)
    || (previousIdentity.contacts.length > 0 && /[|｜;；]/u.test(canonicalV1TextWithoutAnchors(node)))
  );
  const anchoredHeadline = identityParagraphs.find((node) => editorAnchorWithRole(node, "identity-headline"));
  const oldHeadline = identityParagraphs.find((node) => (
    previousIdentity.headline && editorAnchorId(node) === previousIdentity.headline.node_id
  ));
  const headlineNode = anchoredHeadline
    ?? oldHeadline
    ?? identityParagraphs.find((node) => !looksLikeOldContact(node));
  if (headlineNode) canonicalV1AssertTextOnly(headlineNode, "identity-headline");
  const headlineValue = headlineNode ? canonicalV1TextWithoutAnchors(headlineNode).trim() : "";
  const headlineAnchor = headlineNode
    ? editorAnchorWithRole(headlineNode, "identity-headline") ?? directEditorAnchors(headlineNode)[0]
    : null;
  const headlineId = headlineValue
    ? context.allocator.claimOrAllocate(
      headlineAnchor?.attrs?.blockId,
      "identity-headline",
      previousIdentity.headline?.node_id,
    )
    : null;
  const headline = headlineId
    ? {
      node_id: headlineId,
      source_refs: canonicalV1SourceRefsForNode(headlineAnchor ?? headlineNode!, headlineId, context),
      value: headlineValue,
    }
    : null;
  const contactNodes = identityParagraphs.filter((node) => node !== headlineNode && looksLikeOldContact(node));
  const contacts = canonicalV1ContactsFromEditor(
    contactNodes,
    previousIdentity.contacts,
    context,
    "identity",
  );
  const avatarNodes: JSONContent[] = [];
  canonicalV1AvatarNodes(editorDocument, avatarNodes);
  if (avatarNodes.length > 1) throw new Error("RESUME_EDITOR_DUPLICATE_AVATAR");
  const avatarNode = avatarNodes[0];
  const avatar = avatarNode
    ? (() => {
      const src = typeof avatarNode.attrs?.src === "string" ? avatarNode.attrs.src : "";
      if (!src) throw new Error("RESUME_EDITOR_AVATAR_SRC_REQUIRED");
      const size = Number(avatarNode.attrs?.size ?? previousIdentity.avatar?.width ?? 96);
      if (!Number.isFinite(size) || size < 56 || size > 220) {
        throw new Error("RESUME_EDITOR_INVALID_AVATAR_SIZE");
      }
      const nodeId = context.allocator.claimOrAllocate(
        avatarNode.attrs?.nodeId,
        "identity-avatar",
        previousIdentity.avatar?.node_id,
      );
      return {
        node_id: nodeId,
        source_refs: canonicalV1SourceRefsForNode(avatarNode, nodeId, context),
        media_kind: "avatar" as const,
        src,
        alt: typeof avatarNode.attrs?.alt === "string" ? avatarNode.attrs.alt : null,
        width: size,
        width_unit: "px" as const,
        height_px: null,
        align: null,
        system_fallback: false,
      };
    })()
    : null;
  const sections = sectionPositions.map(({ index: start }, sectionIndex) => {
    const nextStart = sectionPositions[sectionIndex + 1]?.index ?? content.length;
    return canonicalV1SectionFromEditor(
      content[start],
      content.slice(start + 1, nextStart),
      previous.sections,
      sectionIndex,
      context,
      "section-" + sectionIndex,
    );
  });
  const next: CanonicalResumeDocument = {
    ...previous,
    identity: {
      ...previous.identity,
      node_id: identityId,
      name,
      headline,
      contacts,
      avatar,
    },
    sections,
  };
  return {
    ...next,
    source_dispositions: canonicalV1SourceDispositions(previous, next),
  };
}

/** Reverse the editing projection while keeping canonical node/source ids. */
export function canonicalResumeDocumentFromEditorDocument(
  editorDocument: JSONContent,
  previous: CanonicalResumeDocument,
): CanonicalResumeDocument {
  return canonicalV1Reverse(editorDocument, previous);
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

export function resumeDocumentToEditorDocument(document: ResumeDocument): JSONContent | null;
export function resumeDocumentToEditorDocument(document: CanonicalResumeDocument): JSONContent | null;
export function resumeDocumentToEditorDocument(document: ResumeDocumentRead): JSONContent | null;
export function resumeDocumentToEditorDocument(document: ResumeDocumentRead): JSONContent | null {
  if (isCanonicalResumeDocument(document)) return canonicalResumeDocumentToEditorDocument(document);
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
): ResumeDocument;
export function resumeDocumentFromEditorDocument(
  editorDocument: JSONContent,
  previous: CanonicalResumeDocument,
): CanonicalResumeDocument;
export function resumeDocumentFromEditorDocument(
  editorDocument: JSONContent,
  previous: ResumeDocumentRead,
): ResumeDocumentRead;
export function resumeDocumentFromEditorDocument(
  editorDocument: JSONContent,
  previous: ResumeDocumentRead,
): ResumeDocumentRead {
  if (isCanonicalResumeDocument(previous)) {
    return canonicalResumeDocumentFromEditorDocument(editorDocument, previous);
  }
  const avatar = findUserAvatar(editorDocument);
  const canonical = normalizePersistedTiptapNode(
    stripTemplateProjectionFromEditorDocument(editorDocument, previous),
  );
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
