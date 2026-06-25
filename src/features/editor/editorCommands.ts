import { EditorView } from "@codemirror/view";
import { EditorCommand } from "./EditorToolbar";

const snippets: Record<EditorCommand, { prefix: string; suffix: string; fallback: string }> = {
  paragraph: { prefix: "", suffix: "", fallback: "正文" },
  h1: { prefix: "# ", suffix: "", fallback: "一级标题" },
  h2: { prefix: "## ", suffix: "", fallback: "二级标题" },
  h3: { prefix: "### ", suffix: "", fallback: "三级标题" },
  bold: { prefix: "**", suffix: "**", fallback: "加粗文本" },
  italic: { prefix: "*", suffix: "*", fallback: "斜体文本" },
  underline: { prefix: "<u>", suffix: "</u>", fallback: "下划线文本" },
  strike: { prefix: "~~", suffix: "~~", fallback: "删除线文本" },
  clear: { prefix: "", suffix: "", fallback: "" },
  color: { prefix: '<span style="color:#c2410c">', suffix: "</span>", fallback: "彩色文本" },
  background: {
    prefix: '<mark style="background:#fff3bf">',
    suffix: "</mark>",
    fallback: "高亮文本",
  },
  unordered: { prefix: "- ", suffix: "", fallback: "列表项" },
  ordered: { prefix: "1. ", suffix: "", fallback: "列表项" },
  code: { prefix: "```\n", suffix: "\n```", fallback: "code" },
  quote: { prefix: "> ", suffix: "", fallback: "引用内容" },
  link: { prefix: "[", suffix: "](https://example.com)", fallback: "链接文本" },
  image: { prefix: "", suffix: "", fallback: "" },
  leftRight: {
    prefix: "",
    suffix: "",
    fallback: "::: left\n公司名称\n:::\n\n::: right\n岗位名称\n:::",
  },
};

export function insertEditorText(view: EditorView, text: string) {
  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
  });
  view.focus();
}

export function runEditorCommand(view: EditorView, command: EditorCommand) {
  if (command === "image") return;

  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const snippet = snippets[command];

  const replacement =
    command === "clear"
      ? selected.replace(/[*_~`>#\-\d.()[\]]/g, "")
      : `${snippet.prefix}${selected || snippet.fallback}${snippet.suffix}`;

  insertEditorText(view, replacement);
}
