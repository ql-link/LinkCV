import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";

import { createResumeBlockId } from "./editorExtensions";
import { paginationPluginKey } from "./paginationPlugin";
import type { ResumeColumnSide, ResumeSectionKind } from "./resumeSectionOrder";

/**
 * 大纲 V2（Figma 1244:156）的派生信息：每个模块在正文里的范围、一行摘要、所在页，
 * 以及光标所在模块。全部从编辑器文档和分页装饰计算，不经过后端。
 */

/** 个人信息行没有 blockId，大纲里统一用这个 key 指代 */
export const IDENTITY_KEY = "identity";

export type OutlineSectionRun = {
  key: string;
  nodeId: string | null;
  kind: ResumeSectionKind;
  side: ResumeColumnSide | null;
  /** 模块第一个节点（标题 2，个人信息为容器开头）的位置 */
  from: number;
  /** 模块最后一个节点之后的位置 */
  to: number;
  /** 标题节点的位置；个人信息为标题 1 */
  headingPos: number;
  /** 容器内容的起点，用来把分页断点限定在同一栏 */
  containerFrom: number;
  nodes: ProseMirrorNode[];
};

export type OutlineSectionInfo = {
  summary: OutlineSectionSummary;
  page: number;
};

type Container = { side: ResumeColumnSide | null; from: number; node: ProseMirrorNode };

function blockAnchor(node: ProseMirrorNode) {
  const first = node.firstChild;
  return first?.type.name === "resumeBlockAnchor" ? first : null;
}

function headingBlockId(node: ProseMirrorNode) {
  const value = blockAnchor(node)?.attrs.blockId;
  return typeof value === "string" ? value : null;
}

function isHeading(node: ProseMirrorNode, level: number) {
  return node.type.name === "heading" && node.attrs.level === level;
}

// 与 resumeSectionOrderGroups 保持一致：只有一组分栏时按栏拆分，否则整篇文档是一个容器
function outlineContainers(doc: ProseMirrorNode): Container[] {
  const columns: { node: ProseMirrorNode; pos: number }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === "resumeColumns") columns.push({ node, pos: offset });
  });
  if (columns.length !== 1) return [{ side: null, from: 0, node: doc }];
  const containers: Container[] = [];
  columns[0].node.forEach((column, offset) => {
    const variant = column.attrs?.variant;
    if (column.type.name !== "resumeColumn" || (variant !== "sidebar" && variant !== "main")) return;
    containers.push({ side: variant, from: columns[0].pos + 2 + offset, node: column });
  });
  return containers;
}

export function outlineSectionRuns(doc: ProseMirrorNode): OutlineSectionRun[] {
  const runs: OutlineSectionRun[] = [];
  for (const container of outlineContainers(doc)) {
    const children: { node: ProseMirrorNode; pos: number }[] = [];
    container.node.forEach((node, offset) => children.push({ node, pos: container.from + offset }));
    const firstSection = children.findIndex(({ node }) => isHeading(node, 2) && headingBlockId(node));
    const prefix = firstSection < 0 ? children : children.slice(0, firstSection);
    const name = prefix.find(({ node }) => isHeading(node, 1));
    if (name) {
      const last = prefix[prefix.length - 1];
      runs.push({
        key: IDENTITY_KEY,
        nodeId: null,
        kind: "identity",
        side: container.side,
        from: prefix[0].pos,
        to: last.pos + last.node.nodeSize,
        headingPos: name.pos,
        containerFrom: container.from,
        nodes: prefix.map(({ node }) => node),
      });
    }
    if (firstSection < 0) continue;
    let current: OutlineSectionRun | null = null;
    for (const { node, pos } of children.slice(firstSection)) {
      const nodeId = isHeading(node, 2) ? headingBlockId(node) : null;
      if (nodeId) {
        const value = blockAnchor(node)?.attrs.semanticKind;
        current = {
          key: nodeId,
          nodeId,
          kind: typeof value === "string" ? value as ResumeSectionKind : "custom",
          side: container.side,
          from: pos,
          to: pos + node.nodeSize,
          headingPos: pos,
          containerFrom: container.from,
          nodes: [node],
        };
        runs.push(current);
        continue;
      }
      if (!current) continue;
      current.nodes.push(node);
      current.to = pos + node.nodeSize;
    }
  }
  return runs;
}

const DEGREES = ["博士", "硕士", "本科", "大专", "专科"];

function identityContacts(nodes: readonly ProseMirrorNode[]) {
  const kinds = new Set<string>();
  let avatar = false;
  nodes.forEach((root) => root.descendants((node) => {
    if (node.type.name === "avatarImage") avatar = true;
    const contact = node.type.name === "resumeBlockAnchor" ? node.attrs.contactKind : null;
    if (typeof contact === "string") kinds.add(contact);
    return true;
  }));
  // 不是所有简历都有 contactKind 锚点，按正文里的联系方式兜底识别
  const content = nodes.filter((node) => !isHeading(node, 1)).map((node) => node.textContent).join("\n");
  if (/1\d{2}[\s-]?\d{4}[\s-]?\d{4}|\d{3,4}-\d{7,8}/u.test(content)) kinds.add("phone");
  if (/[\w.+-]+@[\w-]+\.[\w.]+/u.test(content)) kinds.add("email");
  if (/github\.com/iu.test(content)) kinds.add("github");
  if (/linkedin\.com/iu.test(content)) kinds.add("linkedin");
  return [
    avatar ? "avatar" : null,
    ...["phone", "email", "github", "linkedin", "website", "location"].filter((kind) => kinds.has(kind)),
  ].filter((kind): kind is string => Boolean(kind));
}

export type OutlineSectionSummary =
  | { type: "identity"; contacts: string[] }
  | { type: "empty" }
  | { type: "entries"; entries: number; bullets: number; degrees: string[] }
  | { type: "bullets"; bullets: number }
  | { type: "text"; chars: number };

/** 摘要：段数（经历表头行 / 标题 3）、要点数、教育的学历、联系方式类型 */
export function outlineSectionSummary(run: Pick<OutlineSectionRun, "kind" | "nodes">): OutlineSectionSummary {
  if (run.kind === "identity") return { type: "identity", contacts: identityContacts(run.nodes) };
  const body = run.nodes.slice(1);
  const text = body.map((node) => node.textContent).join("\n").trim();
  if (!text) return { type: "empty" };
  let entries = 0;
  let bullets = 0;
  const visit = (node: ProseMirrorNode) => {
    if (node.type.name === "resumeRow" || isHeading(node, 3)) entries += 1;
    if (node.type.name === "listItem") bullets += 1;
    return node.type.name !== "listItem";
  };
  body.forEach((root) => {
    if (visit(root)) root.descendants(visit);
  });
  if (entries > 0) {
    const degrees = run.kind === "education" && bullets === 0 ? DEGREES.filter((degree) => text.includes(degree)) : [];
    return { type: "entries", entries, bullets, degrees };
  }
  if (bullets > 0) return { type: "bullets", bullets };
  return { type: "text", chars: text.replace(/\s+/gu, "").length };
}

type PageBreakMark = { position: number; page: number };

/** 分页插件把断点画成 key 为 page-break-<位置>-<页码>-… 的 widget 装饰 */
export function outlinePageBreaks(state: EditorState): PageBreakMark[] {
  const decorations = paginationPluginKey.getState(state);
  if (!decorations) return [];
  return decorations.find().flatMap((decoration) => {
    const key = (decoration.spec as { key?: unknown }).key;
    if (typeof key !== "string") return [];
    const match = /^page-break-(\d+)-(\d+)-/u.exec(key);
    return match ? [{ position: decoration.from, page: Number(match[2]) }] : [];
  });
}

export function outlineSectionPage(run: OutlineSectionRun, breaks: readonly PageBreakMark[]) {
  return breaks.reduce((page, mark) => (
    mark.position >= run.containerFrom && mark.position <= run.headingPos ? Math.max(page, mark.page) : page
  ), 1);
}

export type OutlineSnapshot = {
  info: Map<string, OutlineSectionInfo>;
  runs: OutlineSectionRun[];
  pageCount: number;
  currentKey: string | null;
};

export function currentOutlineKey(state: EditorState, runs: readonly OutlineSectionRun[]) {
  const { from } = state.selection;
  return runs.find((run) => from >= run.from && from <= run.to)?.key ?? null;
}

export function outlineSnapshot(state: EditorState): OutlineSnapshot {
  const runs = outlineSectionRuns(state.doc);
  const breaks = outlinePageBreaks(state);
  const info = new Map<string, OutlineSectionInfo>();
  runs.forEach((run) => info.set(run.key, { summary: outlineSectionSummary(run), page: outlineSectionPage(run, breaks) }));
  return {
    info,
    runs,
    pageCount: Math.max(1, ...breaks.map((mark) => mark.page)),
    currentKey: currentOutlineKey(state, runs),
  };
}

function findRun(editor: Editor, key: string) {
  return outlineSectionRuns(editor.state.doc).find((run) => run.key === key) ?? null;
}

/** 重命名只替换标题文字，保留 blockId 与 semanticKind */
export function renameOutlineSection(editor: Editor, nodeId: string, title: string) {
  const name = title.trim();
  const run = findRun(editor, nodeId);
  if (!run || !name) return false;
  const heading = run.nodes[0];
  const anchor = blockAnchor(heading);
  if (heading.textContent === name) return false;
  const start = run.headingPos + 1 + (anchor?.nodeSize ?? 0);
  const end = run.headingPos + heading.nodeSize - 1;
  editor.view.dispatch(editor.state.tr.replaceWith(start, end, editor.state.schema.text(name)));
  return true;
}

/** 删除整个模块（标题和其下内容），保留在撤销历史里 */
export function deleteOutlineSection(editor: Editor, nodeId: string) {
  const run = findRun(editor, nodeId);
  if (!run) return false;
  const { state } = editor;
  const container = run.containerFrom === 0 ? state.doc : state.doc.resolve(run.containerFrom).parent;
  const tr = container.content.size === run.to - run.from
    ? state.tr.replaceWith(run.from, run.to, state.schema.nodes.paragraph.create())
    : state.tr.delete(run.from, run.to);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * 新模块插入到光标所在模块之后；光标不在任何模块里时追加到最后。
 * 返回新标题的 blockId，方便自定义模块直接进入重命名。
 */
export function insertOutlineSection(editor: Editor, kind: ResumeSectionKind, title: string) {
  const { state } = editor;
  const runs = outlineSectionRuns(state.doc);
  if (!runs.length) return null;
  const currentKey = currentOutlineKey(state, runs);
  const current = runs.find((run) => run.key === currentKey);
  const anchorRun = current
    ?? [...runs].reverse().find((run) => run.kind !== "identity")
    ?? runs[runs.length - 1];
  const sameSide = runs.filter((run) => run.side === anchorRun.side);
  // 光标在个人信息里时插到同一栏的第一个模块之前，避免把模块塞进页眉
  const position = anchorRun.kind === "identity"
    ? (sameSide.find((run) => run.kind !== "identity")?.from ?? anchorRun.to)
    : anchorRun.to;
  const blockId = createResumeBlockId();
  const { schema } = state;
  const heading = schema.nodes.heading.create(
    { level: 2 },
    [schema.nodes.resumeBlockAnchor.create({ blockId, semanticKind: kind }), schema.text(title)],
  );
  const paragraph = schema.nodes.paragraph.create();
  const tr = state.tr.insert(position, [heading, paragraph]);
  const caret = position + heading.nodeSize + 1;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size)))).scrollIntoView();
  editor.view.dispatch(tr);
  return blockId;
}

export type OutlineModuleOption = { kind: ResumeSectionKind; title: string; hint: string };

/** 「添加模块」只列出文档里还没有的常用模块 */
export const OUTLINE_MODULE_OPTIONS: OutlineModuleOption[] = [
  { kind: "profile", title: "个人总结", hint: "用 2–3 句话概括定位与优势" },
  { kind: "work", title: "工作经历", hint: "公司、职位与主要成果" },
  { kind: "project", title: "项目经历", hint: "项目背景、职责与结果" },
  { kind: "education", title: "教育经历", hint: "学校、专业与学历" },
  { kind: "skills", title: "专业技能", hint: "技术栈与熟练程度" },
  { kind: "activity", title: "校园经历", hint: "社团、学生工作、竞赛" },
  { kind: "certificates", title: "证书资质", hint: "语言、职业或技术认证" },
  { kind: "awards", title: "获奖荣誉", hint: "奖项名称、级别与时间" },
  { kind: "languages", title: "语言能力", hint: "语种与熟练程度" },
  { kind: "interests", title: "兴趣爱好", hint: "与岗位相关的个人特长" },
];

export function availableModuleOptions(presentKinds: ReadonlySet<ResumeSectionKind>) {
  return OUTLINE_MODULE_OPTIONS.filter((option) => !presentKinds.has(option.kind));
}
