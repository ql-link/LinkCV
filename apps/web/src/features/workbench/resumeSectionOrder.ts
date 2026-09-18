import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * The editor already owns section order: the canonical document lists sections
 * in the order their level-2 headings appear, and the backend compiles the
 * layout plan from exactly that order.  Reordering therefore only moves editor
 * blocks; the normal save path persists the result and the canvas re-renders
 * from the editor tree without a round trip.
 */

export type ResumeSectionKind =
  | "identity"
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

export type ResumeColumnSide = "sidebar" | "main";

export type ResumeSectionOrderItem = {
  /** Canonical block id. The identity row is fixed and carries no id. */
  nodeId: string | null;
  title: string;
  kind: ResumeSectionKind;
};

export type ResumeSectionOrderGroup = {
  side: ResumeColumnSide | null;
  label: string | null;
  items: ResumeSectionOrderItem[];
};

export const identitySectionTitle = "个人信息";

/**
 * Canonical fallback order. Mirrors the server's section key order so
 * "restore default" produces the same sequence the backend would normalize to.
 */
export const canonicalSectionKindOrder: ResumeSectionKind[] = [
  "identity",
  "profile",
  "work",
  "project",
  "education",
  "skills",
  "activity",
  "interests",
  "certificates",
  "awards",
  "languages",
  "custom",
];

export const columnSideLabels: Record<ResumeColumnSide, string> = {
  sidebar: "左栏",
  main: "右栏",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function headingBlockId(node: JSONContent): string | null {
  const anchor = node.content?.find((child) => child.type === "resumeBlockAnchor");
  return typeof anchor?.attrs?.blockId === "string" ? anchor.attrs.blockId : null;
}

export function headingSemanticKind(node: JSONContent): ResumeSectionKind | null {
  const anchor = node.content?.find((child) => child.type === "resumeBlockAnchor");
  const value = anchor?.attrs?.semanticKind;
  return typeof value === "string" ? value as ResumeSectionKind : null;
}

function headingLevel(node: JSONContent): number | null {
  const level = node.attrs?.level;
  return typeof level === "number" ? level : null;
}

function headingText(node: JSONContent): string {
  const text = (node.content ?? [])
    .map((child) => (child.type === "text" ? child.text ?? "" : ""))
    .join("")
    .trim();
  return text;
}

function sectionItems(children: readonly JSONContent[]): ResumeSectionOrderItem[] {
  const items: ResumeSectionOrderItem[] = [];
  let seenSection = false;
  for (const child of children) {
    if (child.type !== "heading") continue;
    const level = headingLevel(child);
    if (level === 1 && !seenSection) {
      items.push({ nodeId: null, title: identitySectionTitle, kind: "identity" });
      continue;
    }
    if (level !== 2) continue;
    seenSection = true;
    const nodeId = headingBlockId(child);
    if (!nodeId) continue;
    items.push({
      nodeId,
      title: headingText(child) || headingSemanticKind(child) || "",
      kind: headingSemanticKind(child) ?? "custom",
    });
  }
  return items;
}

function columnSide(node: JSONContent): ResumeColumnSide | null {
  const variant = node.attrs?.variant;
  return variant === "sidebar" || variant === "main" ? variant : null;
}

export function resumeSectionOrderGroups(document: JSONContent): ResumeSectionOrderGroup[] {
  const columns = (document.content ?? []).filter((node) => node.type === "resumeColumns");
  if (columns.length === 1) {
    return (columns[0].content ?? [])
      .filter((node) => node.type === "resumeColumn")
      .flatMap((column) => {
        const side = columnSide(column);
        if (!side) return [];
        const items = sectionItems(column.content ?? []);
        return items.length ? [{ side, label: columnSideLabels[side], items }] : [];
      });
  }
  const items = sectionItems(document.content ?? []);
  return items.length ? [{ side: null, label: null, items }] : [];
}

/** Moves `from` onto `to`'s position, shifting the items in between. */
export function moveSectionItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function defaultSectionOrder<T extends { kind: ResumeSectionKind }>(items: readonly T[]): T[] {
  return [...items].sort(
    (left, right) => canonicalSectionKindOrder.indexOf(left.kind) - canonicalSectionKindOrder.indexOf(right.kind),
  );
}

function sectionStartIndexes(children: readonly ProseMirrorNode[]) {
  const starts: number[] = [];
  children.forEach((child, index) => {
    if (child.type.name !== "heading" || child.attrs?.level !== 2) return;
    if (headingBlockId(child.toJSON())) starts.push(index);
  });
  return starts;
}

function findColumn(doc: ProseMirrorNode, side: ResumeColumnSide | null) {
  if (side === null) return { contentFrom: 0, contentTo: doc.content.size, node: doc };
  let found: { contentFrom: number; contentTo: number; node: ProseMirrorNode } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== "resumeColumns") return true;
    node.forEach((column, offset) => {
      if (found || column.type.name !== "resumeColumn" || column.attrs?.variant !== side) return;
      const contentFrom = pos + 2 + offset;
      found = { contentFrom, contentTo: contentFrom + column.content.size, node: column };
    });
    return false;
  });
  return found;
}

/**
 * Reorders one group's sections to `orderedNodeIds`.  Returns false when the
 * request does not describe exactly the sections currently in that container,
 * so a stale drag can never drop or duplicate content.
 */
export function applySectionOrder(
  editor: Editor,
  side: ResumeColumnSide | null,
  orderedNodeIds: readonly string[],
): boolean {
  const { state } = editor;
  const column = findColumn(state.doc, side);
  if (!column) return false;
  const children: ProseMirrorNode[] = [];
  column.node.forEach((child) => children.push(child));
  const starts = sectionStartIndexes(children);
  const runs = starts.map((start, index) => ({
    id: headingBlockId(children[start].toJSON()) as string,
    nodes: children.slice(start, starts[index + 1] ?? children.length),
  }));
  if (runs.length !== orderedNodeIds.length) return false;
  const runById = new Map(runs.map((run) => [run.id, run]));
  if (orderedNodeIds.some((id) => !runById.has(id))) return false;
  const prefix = children.slice(0, starts[0] ?? children.length);
  const ordered = [
    ...prefix,
    ...orderedNodeIds.flatMap((id) => (runById.get(id) as { nodes: ProseMirrorNode[] }).nodes),
  ];
  if (ordered.length !== children.length) return false;
  if (ordered.every((node, index) => node === children[index])) return false;
  editor.view.dispatch(state.tr.replaceWith(column.contentFrom, column.contentTo, ordered));
  return true;
}

/** Restores every group to the canonical section order. */
export function resetSectionOrder(editor: Editor): boolean {
  let changed = false;
  for (const group of resumeSectionOrderGroups(editor.getJSON())) {
    const ordered = defaultSectionOrder(group.items)
      .flatMap((item) => (item.nodeId ? [item.nodeId] : []));
    if (applySectionOrder(editor, group.side, ordered)) changed = true;
  }
  return changed;
}
