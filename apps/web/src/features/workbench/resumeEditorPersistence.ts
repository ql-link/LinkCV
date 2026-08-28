import type { JSONContent } from "@tiptap/core";
import {
  isCanonicalResumeDocument,
  type CanonicalContentBlock,
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
import { stripTemplateProjectionFromEditorDocument } from "./templateLayout";

type SemanticKind = ResumeDocument["semantic_sections"][number]["semantic_kind"];

const BLOCK_ID_PATTERN = /^(?:blk|node)_[a-z0-9]{16,64}$/u;

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

function canonicalAnchor(nodeId: string, semanticKind?: string): JSONContent {
  return {
    type: "resumeBlockAnchor",
    attrs: {
      blockId: nodeId,
      ...(semanticKind ? { semanticKind } : {}),
    },
  };
}

function canonicalRunToEditor(run: CanonicalTextRun | CanonicalInlineMedia): JSONContent {
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

function canonicalRunsToEditor(runs: Array<CanonicalTextRun | CanonicalInlineMedia>) {
  return runs.map(canonicalRunToEditor);
}

function canonicalCellFallbackContent(cell: CanonicalRowCell): JSONContent[] {
  const content: JSONContent[] = [];
  cell.blocks.forEach((block, blockIndex) => {
    if (block.block_type === "paragraph") {
      if (blockIndex > 0) content.push({ type: "hardBreak" });
      content.push(...canonicalRunsToEditor(block.runs));
      return;
    }
    if (block.block_type === "ordered_list" || block.block_type === "bullet_list") {
      block.items.forEach((item, itemIndex) => {
        if (blockIndex > 0 || itemIndex > 0) content.push({ type: "hardBreak" });
        if (block.block_type === "ordered_list") {
          content.push({ type: "text", text: `${(block.start ?? 1) + itemIndex}. ` });
        } else {
          content.push({ type: "text", text: "- " });
        }
        content.push(...canonicalRunsToEditor(item.runs));
      });
      return;
    }
    if (block.block_type === "media" && block.alt) content.push({ type: "text", text: block.alt });
  });
  return content;
}

function canonicalCellToEditor(
  cell: CanonicalRowCell,
  rowId: string,
  index: number,
): JSONContent {
  const source = cell.blocks.length === 1
    ? canonicalBlockToEditor(cell.blocks[0])
    : { type: "paragraph" as const, content: canonicalCellFallbackContent(cell) };
  const content = source.type === "paragraph"
    ? source.content ?? []
    : canonicalCellFallbackContent(cell);
  return {
    type: "paragraph",
    content: [
      ...(index === 0 ? [canonicalAnchor(rowId)] : []),
      canonicalAnchor(cell.node_id),
      ...content,
    ],
  };
}

function canonicalBlockToEditor(block: CanonicalContentBlock): JSONContent {
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
      content: [canonicalAnchor(block.node_id), ...canonicalRunsToEditor(block.runs)],
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
      content: block.cells.map((cell, index) => canonicalCellToEditor(cell, block.node_id, index)),
    };
  }
  return {
    type: block.block_type === "ordered_list" ? "orderedList" : "bulletList",
    attrs: {
      ...(block.block_type === "ordered_list" && block.start != null ? { start: block.start } : {}),
      nodeId: block.node_id,
    },
    content: block.items.map((item) => ({
      type: "listItem",
      content: [{
        type: "paragraph",
        content: [canonicalAnchor(item.node_id), ...canonicalRunsToEditor(item.runs)],
      }],
    })),
  };
}

function canonicalFieldLine(label: string, value: string, nodeId: string): JSONContent {
  return {
    type: "paragraph",
    content: [canonicalAnchor(nodeId), { type: "text", text: `${label}：${value}` }],
  };
}

function canonicalEntryToEditor(entry: CanonicalResumeEntry): JSONContent[] {
  const fieldLabels: Array<[keyof NonNullable<CanonicalResumeEntry["fields"]>, string]> = [
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
  const fieldNodes = fieldLabels.flatMap(([key, label]) => {
    const value = entry.fields[key];
    if (!value?.value) return [];
    return [canonicalFieldLine(label, value.value, value.node_id)];
  });
  return [
    { type: "heading", attrs: { level: 3 }, content: [canonicalAnchor(entry.node_id), ...(entry.fields.name?.value ? [{ type: "text", text: entry.fields.name.value }] : [])] },
    ...fieldNodes.filter((node) => node.content?.some((child) => child.type === "text")),
    ...entry.blocks.map(canonicalBlockToEditor),
  ];
}

function canonicalSectionToEditor(section: CanonicalResumeSection): JSONContent[] {
  const title = section.title?.value ?? "";
  return [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [canonicalAnchor(section.node_id, section.semantic_kind), ...(title ? [{ type: "text", text: title }] : [])],
    },
    ...section.entries.flatMap(canonicalEntryToEditor),
    ...section.blocks.map(canonicalBlockToEditor),
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
      content: [canonicalAnchor(identity.node_id), { type: "text", text: identity.name.value }],
    });
  }
  if (identity.headline) content.push({
    type: "paragraph",
    content: [{ type: "text", text: identity.headline.value }],
  });
  if (identity.contacts.length) content.push({
    type: "paragraph",
    content: identity.contacts.flatMap((contact, index) => [
      ...(index ? [{ type: "text", text: " ｜ " }] : []),
      { type: "text", text: contact.label ? `${contact.label}：${contact.value}` : contact.value },
    ]),
  });
  content.push(...document.sections.flatMap(canonicalSectionToEditor));
  return { type: "doc", content };
}

function editorAnchorId(node: JSONContent): string | null {
  const anchor = node.type === "resumeBlockAnchor"
    ? node
    : node.content?.find((child) => child.type === "resumeBlockAnchor");
  const value = anchor?.attrs?.blockId;
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value) ? value : null;
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

function canonicalRunsFromEditor(nodes: JSONContent[]): Array<CanonicalTextRun | CanonicalInlineMedia> {
  const result: Array<CanonicalTextRun | CanonicalInlineMedia> = [];
  for (const node of nodes) {
    if (node.type === "resumeBlockAnchor" || node.type === "hardBreak") continue;
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

/** Reverse the editing projection while keeping canonical node/source ids. */
export function canonicalResumeDocumentFromEditorDocument(
  editorDocument: JSONContent,
  previous: CanonicalResumeDocument,
): CanonicalResumeDocument {
  const canonical = stripTemplateProjectionFromEditorDocument(editorDocument, previous);
  const content = canonical.content ?? [];
  const headings = content.map((node, index) => ({ node, index })).filter(({ node }) => node.type === "heading");
  const identityHeading = headings.find(({ node }) => Number(node.attrs?.level) === 1);
  const name = identityHeading ? editorTextWithoutAnchor(identityHeading.node) : previous.identity.name?.value;
  const avatar = editorDocumentUserAvatar(editorDocument);
  const nextSections = previous.sections.map((section) => {
    const sectionHeading = headings.find(({ node }) => editorAnchorId(node) === section.node_id);
    if (!sectionHeading) return section;
    const nextHeading = headings.find(({ index, node }) => index > sectionHeading.index && Number(node.attrs?.level) === 2);
    const end = nextHeading?.index ?? content.length;
    const sectionNodes = content.slice(sectionHeading.index + 1, end);
    const entryHeadings = sectionNodes.map((node, index) => ({ node, index })).filter(({ node }) => (
      node.type === "heading" && Number(node.attrs?.level) === 3 && editorAnchorId(node)
    ));
    const entries = section.entries.map((entry) => {
      const entryHeading = entryHeadings.find(({ node }) => editorAnchorId(node) === entry.node_id);
      if (!entryHeading) return entry;
      const nextEntry = entryHeadings.find(({ index }) => index > entryHeading.index);
      const entryEnd = nextEntry?.index ?? sectionNodes.length;
      const entryNodes = sectionNodes.slice(entryHeading.index + 1, entryEnd);
      const fieldIds = new Set(Object.values(entry.fields).flatMap((field) => field ? [field.node_id] : []));
      const nextFields = Object.fromEntries(Object.entries(entry.fields).map(([key, field]) => {
        if (!field) return [key, field];
        const fieldNode = entryNodes.find((node) => editorAnchorId(node) === field.node_id);
        if (!fieldNode) return [key, field];
        const text = editorTextWithoutAnchor(fieldNode);
        const separator = text.indexOf("：");
        return [key, {
          ...field,
          value: separator >= 0 ? text.slice(separator + 1).trim() : text,
        }];
      })) as CanonicalResumeEntry["fields"];
      return {
        ...entry,
        fields: entry.fields.name && editorTextWithoutAnchor(entryHeading.node)
          ? { ...nextFields, name: { ...entry.fields.name, value: editorTextWithoutAnchor(entryHeading.node) } }
          : nextFields,
        blocks: updateCanonicalBlocks(entryNodes.filter((node) => node.type !== "heading" && !fieldIds.has(editorAnchorId(node) ?? "")), entry.blocks),
      };
    });
    const entryRanges = entryHeadings.map(({ index }) => index);
    const sectionBlocks = collectTopLevelNodes(sectionNodes, 0, entryRanges[0] ?? sectionNodes.length);
    return {
      ...section,
      title: section.title
        ? { ...section.title, value: editorTextWithoutAnchor(sectionHeading.node) }
        : section.title,
      entries,
      blocks: updateCanonicalBlocks(sectionBlocks, section.blocks),
    };
  });
  return {
    ...previous,
    identity: {
      ...previous.identity,
      name: previous.identity.name && name != null ? { ...previous.identity.name, value: name } : previous.identity.name,
      avatar: avatar && previous.identity.avatar
        ? {
          ...previous.identity.avatar,
          src: avatar.src,
          width: avatar.size,
        }
        : previous.identity.avatar,
    },
    sections: nextSections,
  };
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
