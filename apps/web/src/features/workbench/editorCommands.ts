import type { Editor } from "@tiptap/react";
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { InlineIconName } from "../../lib/resumeInlineIcon";
import { normalizeResumeRowColumnWidths } from "./resumeRowColumns";

export type WorkbenchBlockCommandId =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "ordered-list"
  | "resume-row"
  | "image"
  | "inline-icon"
  | "inline-image";

export type WorkbenchBlockCommand = {
  id: WorkbenchBlockCommandId;
  label: string;
  keywords: string[];
};

export const workbenchBlockCommands: WorkbenchBlockCommand[] = [
  { id: "paragraph", label: "正文", keywords: ["文本", "paragraph"] },
  { id: "resume-row", label: "左右分栏", keywords: ["同一行左 / 右独立输入", "当前行左右对齐", "双栏", "两栏", "分栏", "左右", "日期", "columns"] },
  { id: "heading-1", label: "标题 1", keywords: ["一级标题", "h1"] },
  { id: "heading-2", label: "标题 2", keywords: ["章节", "二级标题", "h2"] },
  { id: "heading-3", label: "标题 3", keywords: ["小标题", "三级标题", "h3"] },
  { id: "bullet-list", label: "无序列表", keywords: ["分点", "项目符号", "ul"] },
  { id: "ordered-list", label: "有序列表", keywords: ["编号", "ol"] },
  { id: "image", label: "插入图片", keywords: ["正文图片", "image"] },
  { id: "inline-image", label: "插入行内图片", keywords: ["公司 Logo", "文字内嵌图片", "行内", "logo"] },
  { id: "inline-icon", label: "插入图标", keywords: ["图标", "学校", "教育", "电话", "邮箱", "icon"] },
];

export function insertInlineIcon(
  editor: Editor,
  name: InlineIconName,
  replaceRange?: { from: number; to: number },
) {
  const chain = editor.chain().focus();
  if (replaceRange) {
    chain.deleteRange(replaceRange).setTextSelection(replaceRange.from);
  }
  return chain.insertContent([
    { type: "inlineIcon", attrs: { name } },
    { type: "text", text: " " },
  ]).run();
}

/**
 * 将光标所在的普通段落替换成结构化左右行，并把非空行的光标放到右栏。
 * 两栏都是真实段落，因此改字体、页边距或导出 PDF 时不会像空格对齐那样漂移。
 */
export function convertCurrentLineToResumeRow(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from } = state.selection;
    let paragraphDepth = $from.depth;

    while (paragraphDepth > 0 && $from.node(paragraphDepth).type.name !== "paragraph") {
      paragraphDepth -= 1;
    }

    if (paragraphDepth === 0 || $from.node(paragraphDepth - 1).type.name !== "doc") return false;

    const paragraph = $from.node(paragraphDepth);
    const rowType = state.schema.nodes.resumeRow;
    const paragraphType = state.schema.nodes.paragraph;
    if (!rowType || !paragraphType) return false;

    const from = $from.before(paragraphDepth);
    const left = paragraphType.create(paragraph.attrs, paragraph.content, paragraph.marks);
    const right = paragraphType.create();
    const row = rowType.create({ leftWidth: 50 }, [left, right]);
    const transaction = state.tr.replaceWith(from, from + paragraph.nodeSize, row);
    const rightTextPosition = from + 2 + left.nodeSize;
    const targetPosition = paragraph.textContent.length === 0
      ? from + 2
      : rightTextPosition;
    transaction.setSelection(TextSelection.create(transaction.doc, targetPosition));
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}

/**
 * 把分栏行合并回一个普通段落，2/3/4 栏都适用：非空栏之间用一个全角空格分隔，
 * 文字不丢失。第一栏保留自己的定位锚点，其余栏的锚点随格子一起消失。
 */
export function convertResumeRowToParagraph(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from } = state.selection;
    let rowDepth = $from.depth;
    while (rowDepth > 0 && $from.node(rowDepth).type.name !== "resumeRow") rowDepth -= 1;
    if (rowDepth === 0) return false;

    const row = $from.node(rowDepth);
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType || row.childCount < 2) return false;

    let content = row.child(0).content;
    for (let index = 1; index < row.childCount; index += 1) {
      const cell = row.child(index);
      const inline: ProseMirrorNode[] = [];
      cell.forEach((child) => {
        if (child.type.name !== "resumeBlockAnchor") inline.push(child);
      });
      if (!inline.length) continue;
      if (content.size > 0) content = content.append(Fragment.from(state.schema.text("　")));
      content = content.append(Fragment.fromArray(inline));
    }

    const paragraph = paragraphType.create(row.child(0).attrs, content);
    const from = $from.before(rowDepth);
    const transaction = state.tr.replaceWith(from, from + row.nodeSize, paragraph);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(from + paragraph.nodeSize - 1)));
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}

/**
 * 光标当前所在的块类型，用于让插入菜单标出这一行真实处于什么状态。
 * 列表和分栏行是段落的祖先，标题本身是文本块，因此从最内层逐级向外判断。
 */
export function currentWorkbenchBlockCommandId(
  editor: Editor,
): WorkbenchBlockCommandId | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const name = node.type.name;
    if (name === "bulletList") return "bullet-list";
    if (name === "orderedList") return "ordered-list";
    if (name === "resumeRow") return "resume-row";
    if (name === "heading") {
      const level = Number(node.attrs.level);
      return level === 1 || level === 2 || level === 3
        ? (`heading-${level}` as WorkbenchBlockCommandId)
        : null;
    }
  }
  return $from.parent.type.name === "paragraph" ? "paragraph" : null;
}

export type ResumeRowColumnCount = 2 | 3 | 4;

export function setResumeRowColumns(
  editor: Editor,
  rowPosition: number,
  columns: ResumeRowColumnCount,
) {
  return editor.commands.command(({ state, dispatch }) => {
    const row = state.doc.nodeAt(rowPosition);
    if (!row || row.type.name !== "resumeRow") return false;

    const current = row.childCount;
    if (current === columns || current < 2) return false;

    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) return false;

    const kept = Math.min(current, columns);
    const cells: ProseMirrorNode[] = [];
    for (let index = 0; index < kept; index += 1) cells.push(row.child(index));

    if (columns < current) {
      const target = cells[kept - 1];
      const merged: ProseMirrorNode[] = [];
      target.forEach((child) => merged.push(child));
      for (let index = kept; index < current; index += 1) {
        // Anchors identify a cell that no longer exists; only inline content
        // moves across, so the merged run carries no dangling identity.
        const dropped: ProseMirrorNode[] = [];
        row.child(index).forEach((child) => {
          if (child.type.name !== "resumeBlockAnchor") dropped.push(child);
        });
        if (!dropped.length) continue;
        if (merged.length > 0) merged.push(state.schema.text("　"));
        merged.push(...dropped);
      }
      cells[kept - 1] = paragraphType.create(target.attrs, merged);
    } else {
      for (let index = current; index < columns; index += 1) {
        cells.push(paragraphType.create());
      }
    }

    // 栏数变化后旧占比没有对应关系，宽度回到等分。
    const transaction = state.tr.replaceWith(
      rowPosition,
      rowPosition + row.nodeSize,
      row.type.create({ ...row.attrs, columnWidths: null }, cells),
    );
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}

/**
 * 写入或清空某一行的自定义栏宽；传 null 表示恢复等分。
 * 只有 3/4 栏的分栏行才有栏宽，2 栏沿用左右比例。
 */
export function setResumeRowColumnWidths(
  editor: Editor,
  rowPosition: number,
  widths: number[] | null,
) {
  return editor.commands.command(({ state, dispatch }) => {
    const row = state.doc.nodeAt(rowPosition);
    if (!row || row.type.name !== "resumeRow" || row.childCount < 3) return false;
    const normalized = widths === null
      ? null
      : normalizeResumeRowColumnWidths(widths, row.childCount);
    if (widths !== null && !normalized) return false;
    if ((row.attrs.columnWidths ?? null) === null && normalized === null) return false;
    dispatch?.(state.tr.setNodeMarkup(rowPosition, undefined, {
      ...row.attrs,
      columnWidths: normalized,
    }));
    return true;
  });
}

export function exitResumeRowToBlankParagraph(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from } = state.selection;
    let rowDepth = $from.depth;
    while (rowDepth > 0 && $from.node(rowDepth).type.name !== "resumeRow") rowDepth -= 1;
    if (rowDepth === 0) return false;

    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) return false;

    const rowEnd = $from.after(rowDepth);
    const nextNode = state.doc.nodeAt(rowEnd);
    const nextNodeIsBlankParagraph = nextNode?.type === paragraphType
      && (nextNode.childCount === 0
        || (nextNode.childCount === 1 && nextNode.firstChild?.type.name === "resumeBlockAnchor"));
    const transaction = state.tr;
    if (!nextNodeIsBlankParagraph) {
      transaction.insert(rowEnd, paragraphType.create());
    }
    transaction.setSelection(TextSelection.create(transaction.doc, rowEnd + 1));
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}

export function removeBlankParagraphAfterResumeRow(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from, empty } = state.selection;
    const paragraph = $from.parent;
    const onlyHasBlockAnchor = paragraph.childCount === 1
      && paragraph.firstChild?.type.name === "resumeBlockAnchor";
    const visuallyBlank = paragraph.childCount === 0 || onlyHasBlockAnchor;
    const atVisualStart = $from.parentOffset === 0
      || (onlyHasBlockAnchor && $from.parentOffset === 1);
    if (
      !empty
      || paragraph.type.name !== "paragraph"
      || $from.depth !== 1
      || !visuallyBlank
      || !atVisualStart
    ) return false;

    const paragraphIndex = $from.index(0);
    if (paragraphIndex === 0 || state.doc.child(paragraphIndex - 1).type.name !== "resumeRow") return false;

    const from = $from.before();
    const transaction = state.tr.delete(from, from + paragraph.nodeSize);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(from - 1), -1));
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}

/**
 * 光标是否停在文本块的视觉行首。隐藏的 resumeBlockAnchor 占据行首两个可停靠
 * 位置（锚点前 parentOffset 0 与锚点后 parentOffset === nodeSize），都算行首。
 */
function atVisualTextblockStart($from: ResolvedPos) {
  const anchor = $from.parent.firstChild?.type.name === "resumeBlockAnchor"
    ? $from.parent.firstChild
    : null;
  return $from.parentOffset === 0 || (anchor !== null && $from.parentOffset === anchor.nodeSize);
}

/**
 * 标题行首回车：在标题上方插入一个空段落，而不是拆出一个空标题。
 * 光标留在标题行首，与段落行首回车（上方多出空行、光标不动）行为一致。
 */
export function insertParagraphBeforeHeadingStart(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.depth !== 1 || $from.parent.type.name !== "heading") return false;
    if (!atVisualTextblockStart($from)) return false;
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) return false;

    const transaction = state.tr.insert($from.before(), paragraphType.create());
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}

/**
 * 行首退格的显式处理：上一块为空行时删掉这个空行（当前行类型不变）；
 * 当前行是标题且上一块有内容时把整行合并进上一个文本块。默认的
 * joinBackward/deleteBarrier 会命中行首隐藏锚点，被锚点重建拦成空操作，
 * 而对空行直接 join 又会把标题降级成正文，所以两条路径都显式接管。
 */
export function mergeHeadingStartIntoPreviousBlock(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.depth !== 1 || !$from.parent.isTextblock) return false;
    if (!atVisualTextblockStart($from)) return false;

    const before = $from.before();
    const nodeBefore = state.doc.resolve(before).nodeBefore;
    if (!nodeBefore?.isTextblock) return false;

    const anchor = $from.parent.firstChild?.type.name === "resumeBlockAnchor"
      ? $from.parent.firstChild
      : null;
    const transaction = state.tr;
    if (nodeBefore.textContent.length === 0) {
      // 上一块是空行：删除它并把光标留在当前行行首，当前行保持原类型。
      const blankFrom = before - nodeBefore.nodeSize;
      transaction.delete(blankFrom, before);
      transaction.setSelection(TextSelection.create(transaction.doc, blankFrom + 1 + (anchor?.nodeSize ?? 0)));
    } else {
      if ($from.parent.type.name !== "heading") return false;
      // 先去掉本行的定位锚点，避免合并后残留在段落中间。
      if (anchor) transaction.delete($from.start(), $from.start() + anchor.nodeSize);
      transaction.join(before);
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(before), -1));
    }
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}

/**
 * 空行（含隐藏锚点、无可见文字）里按 Delete 时删除本空行，光标落到下一块
 * 行首。默认 joinForward 会把下一块并进空行——若下一块是标题还会把它降级。
 */
export function removeBlankLineBeforeBlock(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.depth !== 1 || !$from.parent.isTextblock) return false;
    if ($from.parent.textContent.length > 0) return false;
    if (!atVisualTextblockStart($from) && $from.parentOffset !== $from.parent.content.size) return false;

    const after = $from.after();
    const nodeAfter = state.doc.resolve(after).nodeAfter;
    if (!nodeAfter) return false;

    const anchorAfter = nodeAfter.firstChild?.type.name === "resumeBlockAnchor"
      ? nodeAfter.firstChild
      : null;
    const transaction = state.tr.delete($from.before(), after);
    transaction.setSelection(TextSelection.create(transaction.doc, $from.before() + 1 + (anchorAfter?.nodeSize ?? 0)));
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}

function hasVisibleResumeContent(node: ProseMirrorNode) {
  let visible = false;
  node.descendants((child) => {
    if (child.type.name === "resumeBlockAnchor") return false;
    if (child.isText) {
      visible = (child.text?.length ?? 0) > 0;
      return !visible;
    }
    if (child.isInline || child.isLeaf) {
      visible = true;
      return false;
    }
    return !visible;
  });
  return visible;
}

/** 去掉空列表项的一层标号，保留段落、定位锚点和光标所在的空白行。 */
export function exitVisuallyBlankResumeListItem(editor: Editor) {
  return editor.commands.command(({ state, commands }) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type.name !== "paragraph" || $from.depth < 2) return false;

    const listItem = $from.node(-1);
    if (listItem.type.name !== "listItem" || hasVisibleResumeContent(listItem)) return false;

    const anchor = $from.parent.firstChild;
    const atVisualStart = $from.parentOffset === 0
      || (anchor?.type.name === "resumeBlockAnchor" && $from.parentOffset === anchor.nodeSize);
    if (!atVisualStart) return false;

    return commands.liftListItem("listItem");
  });
}

/**
 * 删除内容已经清空的普通行或分栏；空列表项由退出列表命令保留为空白行。
 * resumeBlockAnchor 只负责稳定定位，不应让一个视觉空行变成“删不掉”的非空节点。
 */
export function removeVisuallyBlankResumeLine(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from, empty } = state.selection;
    if (!empty || !$from.parent.isTextblock || hasVisibleResumeContent($from.parent)) return false;

    const anchor = $from.parent.firstChild?.type.name === "resumeBlockAnchor"
      ? $from.parent.firstChild
      : null;
    const atVisualStart = $from.parentOffset === 0
      || (anchor !== null && $from.parentOffset === anchor.nodeSize);
    if (!atVisualStart) return false;

    let rowDepth = $from.depth;
    while (rowDepth > 0 && $from.node(rowDepth).type.name !== "resumeRow") rowDepth -= 1;

    let listItemDepth = $from.depth;
    while (listItemDepth > 0 && $from.node(listItemDepth).type.name !== "listItem") listItemDepth -= 1;

    let from: number;
    let to: number;
    let replaceWithParagraph = false;

    if (rowDepth > 0) {
      const row = $from.node(rowDepth);
      if (hasVisibleResumeContent(row)) return false;
      from = $from.before(rowDepth);
      to = $from.after(rowDepth);
      replaceWithParagraph = $from.node(rowDepth - 1).childCount === 1;
    } else if (listItemDepth > 0) {
      return false;
    } else {
      const blockDepth = $from.depth;
      const containerDepth = blockDepth - 1;
      const container = $from.node(containerDepth);
      from = $from.before(blockDepth);
      to = $from.after(blockDepth);
      replaceWithParagraph = container.childCount === 1;
    }

    const paragraphType = state.schema.nodes.paragraph;
    if (replaceWithParagraph && !paragraphType) return false;

    const transaction = replaceWithParagraph
      ? state.tr.replaceWith(from, to, paragraphType.create())
      : state.tr.delete(from, to);
    const selectionPosition = replaceWithParagraph
      ? from + 1
      : Math.min(from, transaction.doc.content.size);
    transaction.setSelection(TextSelection.near(
      transaction.doc.resolve(selectionPosition),
      selectionPosition === 0 ? 1 : -1,
    ));
    dispatch?.(transaction.scrollIntoView());
    return true;
  });
}
