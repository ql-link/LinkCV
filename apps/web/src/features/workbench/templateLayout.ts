import type { JSONContent } from "@tiptap/core";
import type {
  CanonicalContentBlock,
  CanonicalResumeDocument,
  LayoutPlan,
  ResumeDocument,
  ResumeDocumentRead,
  TemplateDefinition,
  TemplateManifest,
} from "../../api/resumeContract";
import {
  editorDocumentToMarkdown,
  isCanonicalLayoutPlan,
  isCanonicalResumeDocument,
  resumeDocumentToMarkdown,
  stripTemplatePageRegions,
} from "../../api/resumeContract";

type SemanticKind = ResumeDocument["semantic_sections"][number]["semantic_kind"];
type TemplateSlot = TemplateManifest["slots"][number];

type CanonicalProjectionNode = {
  node: JSONContent;
  nodeId: string | null;
  parentId: string;
  order: number;
};

export const SYSTEM_DEFAULT_AVATAR = "/templates/avatar-cat.jpg";

function blockAnchorIds(node: JSONContent): string[] {
  const own = node.type === "resumeBlockAnchor" && typeof node.attrs?.blockId === "string"
    ? [node.attrs.blockId]
    : [];
  return [...own, ...(node.content ?? []).flatMap(blockAnchorIds)];
}

function assertExactlyOnceContentIds(sourceIds: string[], target: JSONContent) {
  if (sourceIds.length !== new Set(sourceIds).size) {
    throw new Error("RESUME_CONTENT_ID_DUPLICATED");
  }
  const targetIds = blockAnchorIds(target);
  for (const id of sourceIds) {
    if (targetIds.filter((candidate) => candidate === id).length !== 1) {
      throw new Error("RESUME_CONTENT_COMPOSITION_INVALID");
    }
  }
}

function markdownAnchorIds(markdown: string) {
  return [...markdown.matchAll(/\[\[linkcv-block:(blk_[a-z0-9]{16,64})(?::[a-z]+)?\]\]/gu)]
    .map((match) => match[1]);
}

function assertExactlyOnceMarkdownIds(sourceIds: string[], target: string) {
  if (sourceIds.length !== new Set(sourceIds).size) {
    throw new Error("RESUME_CONTENT_ID_DUPLICATED");
  }
  const targetIds = markdownAnchorIds(target);
  for (const id of sourceIds) {
    if (targetIds.filter((candidate) => candidate === id).length !== 1) {
      throw new Error("RESUME_CONTENT_COMPOSITION_INVALID");
    }
  }
}

function emptyParagraph(): JSONContent {
  return { type: "paragraph" };
}

function withoutEmptyColumnPlaceholder(content: JSONContent[] | undefined) {
  if (
    content?.length === 1
    && content[0].type === "paragraph"
    && !(content[0].content?.length)
  ) return [];
  return content ?? [];
}

function resumeColumn(variant: "sidebar" | "main", content: JSONContent[]): JSONContent {
  return {
    type: "resumeColumn",
    attrs: { variant },
    content: content.length > 0 ? content : [emptyParagraph()],
  };
}

function isSectionHeading(node: JSONContent) {
  return node.type === "heading" && Number(node.attrs?.level) === 2;
}

function isBasicsHeading(node: JSONContent) {
  return node.type === "heading" && Number(node.attrs?.level) === 1;
}

function nodeText(node: JSONContent): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

function containsUserAvatar(node: JSONContent): boolean {
  if (node.type === "avatarImage" && node.attrs?.systemFallback !== true) return true;
  return (node.content ?? []).some(containsUserAvatar);
}

type ContentBlock = {
  kind: SemanticKind | "basics";
  semanticOrder: number;
  nodes: JSONContent[];
};

function headingBlockId(node: JSONContent) {
  const anchor = node.content?.find((child) => child.type === "resumeBlockAnchor");
  return typeof anchor?.attrs?.blockId === "string" ? anchor.attrs.blockId : null;
}

function headingSemanticKind(node: JSONContent): SemanticKind | null {
  const value = node.content?.find((child) => child.type === "resumeBlockAnchor")?.attrs?.semanticKind;
  return typeof value === "string" ? value as SemanticKind : null;
}

function legacySemanticMetadata(document: ResumeDocument) {
  const byId = new Map<string, { kind: SemanticKind; order: number }>();
  const byTitle = new Map<string, { kind: SemanticKind; order: number }>();
  document.semantic_sections.forEach((section, index) => {
    const metadata = { kind: section.semantic_kind, order: index };
    if (section.custom_section_id) byId.set(section.custom_section_id, metadata);
    // Compatibility for imported typed snapshots before their first canonical save.
    if (!byTitle.has(section.display_title.trim())) byTitle.set(section.display_title.trim(), metadata);
  });
  return { byId, byTitle };
}

function editorBlocks(
  content: JSONContent[],
  document: ResumeDocument,
  restoreSemanticOrder: boolean,
): ContentBlock[] {
  const metadata = legacySemanticMetadata(document);
  const blocks: ContentBlock[] = [];
  const basicsOrder = document.semantic_sections.findIndex(
    (section) => section.semantic_kind === "basics",
  );
  let current: ContentBlock = {
    kind: "basics",
    semanticOrder: basicsOrder < 0 ? 0 : basicsOrder,
    nodes: [],
  };
  for (const node of content) {
    // A columns manifest may place the basics region after a section region.
    // Keep the H1/contact block identifiable so restoring the canonical order
    // does not attach it to the preceding section merely because it appeared
    // later in the projected DOM.
    if (isBasicsHeading(node) && current.kind !== "basics") {
      if (current.nodes.length > 0) blocks.push(current);
      current = {
        kind: "basics",
        semanticOrder: basicsOrder < 0 ? 0 : basicsOrder,
        nodes: [node],
      };
      continue;
    }
    if (isSectionHeading(node)) {
      if (current.nodes.length > 0) blocks.push(current);
      const sectionMetadata = (headingBlockId(node) && metadata.byId.get(headingBlockId(node) ?? ""))
        || metadata.byTitle.get(nodeText(node).trim());
      current = {
        kind: headingSemanticKind(node) ?? sectionMetadata?.kind ?? "custom",
        semanticOrder: sectionMetadata?.order ?? Number.MAX_SAFE_INTEGER,
        nodes: [node],
      };
      continue;
    }
    current.nodes.push(node);
  }
  if (current.nodes.length > 0) blocks.push(current);
  return restoreSemanticOrder
    ? blocks.map((block, index) => ({ block, index })).sort(
      (left, right) => left.block.semanticOrder - right.block.semanticOrder
        || left.index - right.index,
    ).map(({ block }) => block)
    : blocks;
}

function legacyTargetSlot(block: ContentBlock, slots: TemplateSlot[]) {
  const explicit = slots.find((slot) => !slot.fallback && slot.accepts.includes(block.kind));
  return explicit ?? slots.find((slot) => slot.fallback);
}

type MarkdownBlock = {
  kind: SemanticKind | "basics";
  markdown: string;
};

function markdownBlocks(markdown: string, document: ResumeDocument): MarkdownBlock[] {
  const metadata = legacySemanticMetadata(document);
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let start = 0;
  let kind: SemanticKind | "basics" = "basics";
  const flush = (end: number) => {
    const value = lines.slice(start, end).join("\n").trim();
    if (value) blocks.push({ kind, markdown: value });
  };
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(?:```|~~~)/u.test(lines[index])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = lines[index].match(/^##\s+(?:\[\[linkcv-block:(blk_[a-z0-9]{16,64})(?::(basics|profile|work|education|project|skills|activity|interests|certificates|awards|languages|custom))?\]\])?(.*)$/u);
    if (!match) continue;
    flush(index);
    const title = (match[3] ?? "").replace(/:icon\[[^\]]+\]:/gu, "").trim();
    kind = (match[2] as SemanticKind | undefined)
      ?? (match[1] ? metadata.byId.get(match[1]) : null)?.kind
      ?? metadata.byTitle.get(title)?.kind
      ?? "custom";
    start = index;
  }
  flush(lines.length);
  return blocks;
}

function flattenCanonicalProjection(nodes: JSONContent[]): JSONContent[] {
  return nodes.flatMap((node) => {
    if (node.type === "resumeColumns" || node.type === "resumeColumn") {
      return flattenCanonicalProjection(node.content ?? []);
    }
    return [node];
  });
}

function canonicalNodeId(node: JSONContent): string | null {
  const blockId = blockAnchorIds(node)[0];
  if (typeof blockId === "string") return blockId;
  const mediaId = node.attrs?.nodeId;
  return typeof mediaId === "string" ? mediaId : null;
}

function canonicalNodeOrder(document: CanonicalResumeDocument) {
  const order = new Map<string, number>();
  let cursor = 0;
  const visitBlock = (block: CanonicalContentBlock) => {
    order.set(block.node_id, cursor++);
    if (block.block_type === "ordered_list" || block.block_type === "bullet_list") {
      for (const item of block.items) order.set(item.node_id, cursor++);
    }
    if (block.block_type === "row") {
      for (const cell of block.cells) {
        order.set(cell.node_id, cursor++);
        for (const cellBlock of cell.blocks) visitBlock(cellBlock);
      }
    }
  };
  order.set(document.identity.node_id, cursor++);
  if (document.identity.name) order.set(document.identity.name.node_id, cursor++);
  if (document.identity.headline) order.set(document.identity.headline.node_id, cursor++);
  for (const contact of document.identity.contacts) order.set(contact.node_id, cursor++);
  if (document.identity.avatar) order.set(document.identity.avatar.node_id, cursor++);
  for (const section of document.sections) {
    order.set(section.node_id, cursor++);
    if (section.title) order.set(section.title.node_id, cursor++);
    for (const entry of section.entries) {
      order.set(entry.node_id, cursor++);
      for (const value of Object.values(entry.fields)) if (value) order.set(value.node_id, cursor++);
      for (const block of entry.blocks) visitBlock(block);
    }
    for (const block of section.blocks) visitBlock(block);
  }
  return order;
}

function canonicalProjectionGroups(
  content: JSONContent[],
  document: CanonicalResumeDocument,
): CanonicalProjectionNode[] {
  const parentById = new Map<string, string>();
  const order = canonicalNodeOrder(document);
  const sectionIds = new Set(document.sections.map((section) => section.node_id));
  const mapBlockToParent = (block: CanonicalContentBlock, parentId: string) => {
    parentById.set(block.node_id, parentId);
    if (block.block_type === "ordered_list" || block.block_type === "bullet_list") {
      for (const item of block.items) parentById.set(item.node_id, parentId);
    }
    if (block.block_type === "row") {
      for (const cell of block.cells) {
        parentById.set(cell.node_id, parentId);
        for (const cellBlock of cell.blocks) mapBlockToParent(cellBlock, parentId);
      }
    }
  };
  for (const section of document.sections) {
    for (const entry of section.entries) {
      parentById.set(entry.node_id, section.node_id);
      for (const block of entry.blocks) {
        mapBlockToParent(block, section.node_id);
      }
    }
    for (const block of section.blocks) {
      mapBlockToParent(block, section.node_id);
    }
  }
  let currentParent = document.identity.node_id;
  return flattenCanonicalProjection(content).map((node, index) => {
    const nodeId = canonicalNodeId(node);
    if (node.type === "heading" && Number(node.attrs?.level) === 2 && nodeId && sectionIds.has(nodeId)) {
      currentParent = nodeId;
    }
    const parentId = nodeId && sectionIds.has(nodeId)
      ? nodeId
      : nodeId && parentById.get(nodeId)
        ? parentById.get(nodeId) as string
        : currentParent;
    return { node, nodeId, parentId, order: order.get(nodeId ?? "") ?? Number.MAX_SAFE_INTEGER - content.length + index };
  });
}

function assertCanonicalPlanCoverage(
  plan: LayoutPlan,
  document: CanonicalResumeDocument,
  groups: CanonicalProjectionNode[],
) {
  const expected = [document.identity.node_id, ...document.sections.map((section) => section.node_id)];
  const assigned = plan.regions.flatMap((region) => region.nodes.map((node) => node.node_id));
  if (assigned.length !== new Set(assigned).size || expected.some((id) => assigned.filter((candidate) => candidate === id).length !== 1)) {
    throw new Error("LAYOUT_PLAN_COVERAGE_INVALID");
  }
  const identityHasVisibleContent = Boolean(
    document.identity.name
    || document.identity.headline
    || document.identity.contacts.length
    || (document.identity.avatar && !document.identity.avatar.system_fallback),
  );
  const visibleRoots = identityHasVisibleContent
    ? expected
    : document.sections.map((section) => section.node_id);
  for (const id of visibleRoots) {
    if (!groups.some((group) => group.parentId === id)) throw new Error("RESUME_CONTENT_COMPOSITION_INVALID");
  }
}

function canonicalRegionContent(
  editorDocument: JSONContent,
  document: CanonicalResumeDocument,
  plan: LayoutPlan,
  template: TemplateDefinition,
) {
  const groups = canonicalProjectionGroups(editorDocument.content ?? [], document);
  assertCanonicalPlanCoverage(plan, document, groups);
  const regionContent = new Map(plan.regions.map((region) => [region.region_id, [] as JSONContent[]]));
  const nodeToRegion = new Map<string, string>();
  for (const region of plan.regions) {
    for (const node of region.nodes) nodeToRegion.set(node.node_id, region.region_id);
  }
  for (const group of groups) {
    if (group.node.type === "avatarImage") {
      if (template.avatar.visibility === "hide" || group.node.attrs?.systemFallback === true) continue;
      const avatarRegion = regionContent.get(template.avatar.region_id);
      if (!avatarRegion) throw new Error("TEMPLATE_AVATAR_REGION_INVALID");
      avatarRegion.push({
        ...group.node,
        attrs: { ...group.node.attrs, size: template.avatar.size_px, systemFallback: false },
      });
      continue;
    }
    const regionId = nodeToRegion.get(group.parentId);
    if (!regionId) throw new Error("LAYOUT_PLAN_COVERAGE_INVALID");
    regionContent.get(regionId)?.push(group.node);
  }
  for (const [regionId, nodes] of regionContent) {
    const sorted = nodes.map((node, index) => ({ node, index, order: canonicalNodeOrder(document).get(canonicalNodeId(node) ?? "") ?? Number.MAX_SAFE_INTEGER }))
      .sort((left, right) => left.order - right.order || left.index - right.index)
      .map(({ node }) => node);
    regionContent.set(regionId, sorted);
  }
  return regionContent;
}

/**
 * Consume the backend LayoutPlan.  The Web client only maps an already chosen
 * canonical node to its region; it never evaluates slot `accepts` or chooses a
 * fallback slot.
 */
export function composeEditorDocumentForLayoutPlan(
  editorDocument: JSONContent,
  document: CanonicalResumeDocument,
  plan: LayoutPlan,
  template: TemplateDefinition,
): JSONContent {
  if (!isCanonicalLayoutPlan(plan) || plan.template_key !== template.template_key) {
    throw new Error("LAYOUT_PLAN_TEMPLATE_MISMATCH");
  }
  const regions = [...template.regions].sort((left, right) => left.order - right.order);
  const regionContent = canonicalRegionContent(editorDocument, document, plan, template);
  const hasUserAvatar = (editorDocument.content ?? []).some(containsUserAvatar);
  if (
    template.avatar.visibility === "show"
    && !hasUserAvatar
    && template.avatar.fallback_asset === "system-default"
  ) {
    const avatarRegion = regionContent.get(template.avatar.region_id);
    if (!avatarRegion) throw new Error("TEMPLATE_AVATAR_REGION_INVALID");
    avatarRegion.unshift(avatarNode(SYSTEM_DEFAULT_AVATAR, template.avatar.size_px, true));
  }
  const sourceIds = blockAnchorIds(editorDocument);
  if (template.regions.some((region) => region.region_kind === "sidebar")) {
    const sidebar = regions.filter((region) => region.region_kind === "sidebar");
    const main = regions.filter((region) => region.region_kind === "main");
    if (sidebar.length !== 1 || main.length !== 1) throw new Error("LAYOUT_PLAN_COLUMNS_INVALID");
    const header = regions.filter((region) => region.region_kind === "header").flatMap((region) => regionContent.get(region.region_id) ?? []);
    const footer = regions.filter((region) => region.region_kind === "footer").flatMap((region) => regionContent.get(region.region_id) ?? []);
    const result = {
      type: "doc",
      content: [
        ...header,
        {
          type: "resumeColumns",
          content: [
            resumeColumn("sidebar", regionContent.get(sidebar[0].region_id) ?? []),
            resumeColumn("main", regionContent.get(main[0].region_id) ?? []),
          ],
        },
        ...footer,
      ],
    } satisfies JSONContent;
    assertExactlyOnceContentIds(sourceIds, result);
    return result;
  }
  const result = {
    type: "doc",
    content: regions.flatMap((region) => regionContent.get(region.region_id) ?? []),
  } satisfies JSONContent;
  assertExactlyOnceContentIds(sourceIds, result);
  return result;
}

export function composeResumeMarkdownForLayoutPlan(
  editorDocument: JSONContent,
  document: CanonicalResumeDocument,
  plan: LayoutPlan,
  template: TemplateDefinition,
) {
  return editorDocumentToMarkdown(composeEditorDocumentForLayoutPlan(editorDocument, document, plan, template));
}

function stripCanonicalProjectionFromEditorDocument(
  editorDocument: JSONContent,
  document: CanonicalResumeDocument,
) {
  const sourceIds = blockAnchorIds(editorDocument);
  const flattened = flattenCanonicalProjection(editorDocument.content ?? [])
    .filter((node) => !(node.type === "avatarImage" && node.attrs?.systemFallback === true));
  const groups = canonicalProjectionGroups(flattened, document);
  const sectionOrder = new Map<string, number>([
    [document.identity.node_id, -1],
    ...document.sections.map((section, index) => [section.node_id, index] as const),
  ]);
  const result = {
    ...editorDocument,
    content: groups
      .map((group, index) => ({ group, index }))
      .sort((left, right) => (sectionOrder.get(left.group.parentId) ?? Number.MAX_SAFE_INTEGER)
        - (sectionOrder.get(right.group.parentId) ?? Number.MAX_SAFE_INTEGER)
        || left.group.order - right.group.order
        || left.index - right.index)
      .map(({ group }) => group.node),
  };
  assertExactlyOnceContentIds(sourceIds, result);
  return result;
}

/**
 * Removes presentation-owned page regions from an editor tree. The returned
 * document is safe to persist: semantic blocks are restored to their content
 * order, while column containers and template-provided avatar nodes are not
 * copied into the content snapshot.
 */
export function stripTemplateProjectionFromEditorDocument(
  editorDocument: JSONContent,
  resumeDocument: ResumeDocumentRead,
): JSONContent {
  if (editorDocument.type !== "doc") return editorDocument;
  if (isCanonicalResumeDocument(resumeDocument)) {
    return stripCanonicalProjectionFromEditorDocument(editorDocument, resumeDocument);
  }
  const sourceIds = blockAnchorIds(editorDocument);
  const sourceContent = editorDocument.content ?? [];
  const columnGroups = sourceContent.filter((node) => node.type === "resumeColumns");
  const ordinaryContent = sourceContent.filter(
    (node) => node.type !== "resumeColumns" && node.type !== "avatarImage",
  );
  const columnContent = columnGroups.flatMap((group) => {
    const columns = group.content ?? [];
    const main = columns.find((column) => column.attrs?.variant === "main") ?? columns[1];
    const sidebar = columns.find((column) => column.attrs?.variant === "sidebar") ?? columns[0];
    return [
      withoutEmptyColumnPlaceholder(main?.content),
      withoutEmptyColumnPlaceholder(sidebar?.content),
    ];
  });
  const unorderedBlocks = [ordinaryContent, ...columnContent].flatMap((nodes) => editorBlocks(
    nodes.filter((node) => node.type !== "avatarImage"),
    resumeDocument,
    false,
  ));
  const blocks = columnGroups.length > 0
    ? unorderedBlocks.map((block, index) => ({ block, index })).sort(
      (left, right) => left.block.semanticOrder - right.block.semanticOrder
        || left.index - right.index,
    ).map(({ block }) => block)
    : unorderedBlocks;
  const result = {
    ...editorDocument,
    content: blocks.flatMap((block) => block.nodes),
  };
  assertExactlyOnceContentIds(sourceIds, result);
  return result;
}

/**
 * Legacy read-only adapter for snapshots produced before canonical cutover.
 * Canonical renderers must call compose*ForLayoutPlan below; this path is not
 * a write dependency and is intentionally kept isolated during migration.
 */
export function composeResumeMarkdownForTemplate(
  document: ResumeDocument,
  manifest: TemplateManifest,
) {
  const source = stripTemplatePageRegions(resumeDocumentToMarkdown(document))
    .split("\n")
    .filter((line) => !/!\[[^\]]*\]\([^)]*\s+"linkcv-avatar:[^"]+"\)/u.test(line))
    .join("\n");
  const regions = [...manifest.regions].sort((left, right) => left.order - right.order);
  const slots = [...manifest.slots].sort((left, right) => left.order - right.order);
  const projected = new Map(regions.map((region) => [region.id, [] as string[]]));
  const avatarSlot = slots.find((slot) => slot.accepts.includes("avatar"));
  if (manifest.avatar.visibility === "show" && avatarSlot) {
    const systemFallback = !document.basics.photo && manifest.avatar.fallback_asset === "system-default";
    const source = document.basics.photo ?? (systemFallback ? SYSTEM_DEFAULT_AVATAR : null);
    if (source) projected.get(avatarSlot.region_id)?.push(
      `![简历头像](${source} "linkcv-avatar:${manifest.avatar.size}${systemFallback ? ":system" : ""}")`,
    );
  }
  for (const block of markdownBlocks(source, document)) {
    const slot = legacyTargetSlot({ kind: block.kind, semanticOrder: 0, nodes: [] }, slots);
    if (!slot) throw new Error("TEMPLATE_MANIFEST_FALLBACK_MISSING");
    projected.get(slot.region_id)?.push(block.markdown);
  }
  const sourceIds = markdownAnchorIds(source);
  if (manifest.renderer_key === "flow") {
    const result = regions.flatMap((region) => projected.get(region.id) ?? []).join("\n\n").trim();
    assertExactlyOnceMarkdownIds(sourceIds, result);
    return result;
  }
  const sidebarRegions = regions.filter((region) => region.kind === "sidebar");
  const mainRegions = regions.filter((region) => region.kind === "main");
  if (sidebarRegions.length !== 1 || mainRegions.length !== 1) {
    throw new Error("TEMPLATE_MANIFEST_COLUMNS_INVALID");
  }
  const [sidebar] = sidebarRegions;
  const [main] = mainRegions;
  const header = regions.filter((region) => region.kind === "header")
    .flatMap((region) => projected.get(region.id) ?? []);
  const footer = regions.filter((region) => region.kind === "footer")
    .flatMap((region) => projected.get(region.id) ?? []);
  const columns = [
    `:::: sidebar\n${(projected.get(sidebar.id) ?? []).join("\n\n")}\n::::`,
    `:::: main\n${(projected.get(main.id) ?? []).join("\n\n")}\n::::`,
  ].join("\n\n");
  const result = [...header, columns, ...footer].filter(Boolean).join("\n\n").trim();
  assertExactlyOnceMarkdownIds(sourceIds, result);
  return result;
}

function avatarNode(source: string, size: number, systemFallback: boolean): JSONContent {
  return {
    type: "avatarImage",
    attrs: { src: source, size, systemFallback },
  };
}

function visibleAvatar(
  existing: JSONContent | undefined,
  manifest: TemplateManifest,
  userPhoto: string | null,
) {
  if (manifest.avatar.visibility === "hide") return null;
  if (userPhoto) return avatarNode(userPhoto, manifest.avatar.size, false);
  if (existing && existing.attrs?.systemFallback !== true) {
    return { ...existing, attrs: { ...existing.attrs, size: manifest.avatar.size } };
  }
  return manifest.avatar.fallback_asset === "system-default"
    ? avatarNode(SYSTEM_DEFAULT_AVATAR, manifest.avatar.size, true)
    : null;
}

/** Legacy read-only manifest adapter; canonical content never enters this path. */
export function composeEditorDocumentForTemplate(
  editorDocument: JSONContent,
  manifest: TemplateManifest,
  userPhoto: string | null,
  resumeDocument: ResumeDocument,
): JSONContent {
  if (editorDocument.type !== "doc") return editorDocument;

  const sourceContent = editorDocument.content ?? [];
  const flattened = sourceContent.flatMap((node) => node.type === "resumeColumns"
    ? (node.content ?? []).flatMap((column) => column.content ?? [])
    : [node]);
  const existingAvatar = flattened.find((node) => node.type === "avatarImage");
  const canonical = stripTemplateProjectionFromEditorDocument(editorDocument, resumeDocument);
  const sourceIds = blockAnchorIds(canonical);
  const avatar = visibleAvatar(existingAvatar, manifest, userPhoto);
  const regions = [...manifest.regions].sort((left, right) => left.order - right.order);
  const slots = [...manifest.slots].sort((left, right) => left.order - right.order);
  const regionContent = new Map(regions.map((region) => [region.id, [] as JSONContent[]]));
  if (avatar) {
    const avatarSlot = slots.find((slot) => slot.accepts.includes("avatar"));
    if (avatarSlot) {
      regionContent.get(avatarSlot.region_id)?.push(avatar);
    }
  }
  const blocks = editorBlocks(canonical.content ?? [], resumeDocument, false);
  const blockIds = blocks.flatMap((block) => block.nodes
    .filter(isSectionHeading)
    .map(headingBlockId)
    .filter((value): value is string => Boolean(value)));
  if (blockIds.length !== new Set(blockIds).size) {
    throw new Error("RESUME_CONTENT_ID_DUPLICATED");
  }
  for (const block of blocks) {
    const slot = legacyTargetSlot(block, slots);
    if (!slot) throw new Error("TEMPLATE_MANIFEST_FALLBACK_MISSING");
    regionContent.get(slot.region_id)?.push(...block.nodes);
  }
  if (manifest.renderer_key === "flow") {
    const result = {
      ...canonical,
      content: regions.flatMap((region) => regionContent.get(region.id) ?? []),
    };
    assertExactlyOnceContentIds(sourceIds, result);
    return result;
  }

  const sidebarRegions = regions.filter((region) => region.kind === "sidebar");
  const mainRegions = regions.filter((region) => region.kind === "main");
  if (sidebarRegions.length !== 1 || mainRegions.length !== 1) {
    throw new Error("TEMPLATE_MANIFEST_COLUMNS_INVALID");
  }
  const [sidebar] = sidebarRegions;
  const [main] = mainRegions;
  const beforeColumns = regions
    .filter((region) => region.kind === "header")
    .flatMap((region) => regionContent.get(region.id) ?? []);
  const afterColumns = regions
    .filter((region) => region.kind === "footer")
    .flatMap((region) => regionContent.get(region.id) ?? []);
  const result = {
    ...canonical,
    content: [
      ...beforeColumns,
      {
        type: "resumeColumns",
        content: [
          resumeColumn("sidebar", regionContent.get(sidebar.id) ?? []),
          resumeColumn("main", regionContent.get(main.id) ?? []),
        ],
      },
      ...afterColumns,
    ],
  };
  assertExactlyOnceContentIds(sourceIds, result);
  return result;
}
