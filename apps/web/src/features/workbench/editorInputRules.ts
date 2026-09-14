import { Extension, InputRule } from "@tiptap/core";
import { canJoin, findWrapping } from "@tiptap/pm/transform";

export const ResumeBulletListInputRules = Extension.create({
  name: "resumeBulletListInputRules",
  addInputRules() {
    return [new InputRule({
      // 隐藏锚点会参与 Tiptap 的文本匹配，因此用文档位置核对视觉行首。
      find: /\s*([-+*])\s$/,
      handler: ({ state, range }) => {
        const { $from, empty } = state.selection;
        const anchor = $from.parent.firstChild;
        const anchorSize = anchor?.type.name === "resumeBlockAnchor" ? anchor.nodeSize : 0;
        if (!empty || $from.parent.type.name !== "paragraph"
          || range.from !== $from.start() + anchorSize) return null;

        const type = state.schema.nodes.bulletList;
        const blockFrom = $from.before();
        const tr = state.tr.delete(range.from, range.to);
        const blockRange = tr.doc.resolve(blockFrom + 1).blockRange();
        const wrapping = blockRange && findWrapping(blockRange, type);
        if (!blockRange || !wrapping) return null;

        tr.wrap(blockRange, wrapping);
        // 合并位置取段落起点，不能把隐藏锚点后的标记起点当作列表边界。
        const before = tr.doc.resolve(blockFrom).nodeBefore;
        if (before?.type === type && canJoin(tr.doc, blockFrom)) tr.join(blockFrom);
      },
    })];
  },
});
