import type { Editor } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

/**
 * 将光标所在的普通段落替换成结构化左右行，并把光标放到右栏。
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
    const row = rowType.create({ leftWidth: 70 }, [left, right]);
    const transaction = state.tr.replaceWith(from, from + paragraph.nodeSize, row);
    const rightTextPosition = from + 2 + left.nodeSize;
    transaction.setSelection(TextSelection.create(transaction.doc, rightTextPosition));
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
