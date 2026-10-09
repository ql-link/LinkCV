import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { currentOutlineKey, outlineSectionRuns } from "./outlineModel";

/**
 * 大纲打开时在正文上同步标记：光标所在模块的标题左侧出现蓝色竖条；
 * 拖动大纲行时，被拖模块整段浅蓝底，落点处显示一条蓝线。只是装饰，不写入文档。
 */
export type OutlineDragPreview = { key: string; targetKey: string; edge: "before" | "after" } | null;

type PaperState = { drag: OutlineDragPreview };

export const outlinePaperPluginKey = new PluginKey<PaperState>("resumeOutlinePaper");

function paperDecorations(state: EditorState, drag: OutlineDragPreview) {
  const runs = outlineSectionRuns(state.doc);
  const decorations: Decoration[] = [];
  const current = runs.find((run) => run.key === currentOutlineKey(state, runs));
  if (current && !drag) {
    // 用 widget 而不是标题的伪元素：不少模板已经占用了 h2::before / ::after
    decorations.push(Decoration.widget(current.headingPos + 1, () => {
      const marker = document.createElement("span");
      marker.className = "outline-current-mark";
      marker.setAttribute("contenteditable", "false");
      marker.setAttribute("aria-hidden", "true");
      return marker;
    }, { key: `outline-current-${current.key}`, side: -1, ignoreSelection: true }));
  }
  if (drag) {
    const source = runs.find((run) => run.key === drag.key);
    let position = source?.from ?? 0;
    source?.nodes.forEach((node) => {
      decorations.push(Decoration.node(position, position + node.nodeSize, { class: "outline-dragging-block" }));
      position += node.nodeSize;
    });
    const target = runs.find((run) => run.key === drag.targetKey);
    if (target) {
      if (drag.edge === "before") {
        const heading = state.doc.nodeAt(target.from);
        if (heading) decorations.push(Decoration.node(target.from, target.from + heading.nodeSize, { class: "outline-drop-before" }));
      } else {
        const last = target.nodes[target.nodes.length - 1];
        const lastPos = target.to - last.nodeSize;
        decorations.push(Decoration.node(lastPos, target.to, { class: "outline-drop-after" }));
      }
    }
  }
  return DecorationSet.create(state.doc, decorations);
}

function outlinePaperPlugin() {
  return new Plugin<PaperState>({
    key: outlinePaperPluginKey,
    state: {
      init: () => ({ drag: null }),
      apply: (tr, value) => {
        const meta = tr.getMeta(outlinePaperPluginKey) as PaperState | undefined;
        return meta ?? value;
      },
    },
    props: {
      decorations(state) {
        return paperDecorations(state, outlinePaperPluginKey.getState(state)?.drag ?? null);
      },
    },
  });
}

/** 大纲面板挂载期间注册插件，关闭面板即移除正文标记 */
export function attachOutlinePaper(editor: Editor) {
  if (editor.isDestroyed) return () => undefined;
  editor.registerPlugin(outlinePaperPlugin());
  return () => {
    if (!editor.isDestroyed) editor.unregisterPlugin(outlinePaperPluginKey);
  };
}

export function setOutlineDragPreview(editor: Editor, drag: OutlineDragPreview) {
  if (editor.isDestroyed || !outlinePaperPluginKey.getState(editor.state)) return;
  const current = outlinePaperPluginKey.getState(editor.state)?.drag ?? null;
  if (current?.key === drag?.key && current?.targetKey === drag?.targetKey && current?.edge === drag?.edge) return;
  editor.view.dispatch(editor.state.tr.setMeta(outlinePaperPluginKey, { drag }).setMeta("addToHistory", false));
}
