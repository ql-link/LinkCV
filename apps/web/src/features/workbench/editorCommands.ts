import type { Editor } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { InlineIconName } from "../../lib/resumeInlineIcon";

export type WorkbenchBlockCommandId =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "ordered-list"
  | "resume-row"
  | "image"
  | "avatar"
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
  { id: "avatar", label: "上传或更换头像", keywords: ["照片", "avatar"] },
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

export function convertResumeRowToParagraph(editor: Editor) {
  return editor.commands.command(({ state, dispatch }) => {
    const { $from } = state.selection;
    let rowDepth = $from.depth;
    while (rowDepth > 0 && $from.node(rowDepth).type.name !== "resumeRow") rowDepth -= 1;
    if (rowDepth === 0) return false;

    const row = $from.node(rowDepth);
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType || row.childCount !== 2) return false;

    const left = row.child(0);
    const right = row.child(1);
    const separator = left.content.size > 0 && right.content.size > 0
      ? Fragment.from(state.schema.text("　"))
      : Fragment.empty;
    const content = left.content.append(separator).append(right.content);
    const paragraph = paragraphType.create(left.attrs, content);
    const from = $from.before(rowDepth);
    const transaction = state.tr.replaceWith(from, from + row.nodeSize, paragraph);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(from + paragraph.nodeSize - 1)));
    dispatch?.(transaction.scrollIntoView());
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
