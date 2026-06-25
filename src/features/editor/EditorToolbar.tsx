import {
  Bold,
  Code2,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Paintbrush,
  Pilcrow,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";

export type EditorCommand =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "clear"
  | "color"
  | "background"
  | "unordered"
  | "ordered"
  | "code"
  | "quote"
  | "link"
  | "image"
  | "leftRight";

type EditorToolbarProps = {
  onCommand: (command: EditorCommand) => void;
};

const controls = [
  { command: "paragraph", label: "正文", icon: Pilcrow },
  { command: "h1", label: "H1", icon: Heading1 },
  { command: "h2", label: "H2", icon: Heading2 },
  { command: "h3", label: "H3", icon: Heading3 },
  { command: "bold", label: "加粗", icon: Bold },
  { command: "italic", label: "斜体", icon: Italic },
  { command: "underline", label: "下划线", icon: Underline },
  { command: "strike", label: "删除线", icon: Strikethrough },
  { command: "clear", label: "清除格式", icon: Eraser },
  { command: "color", label: "字体颜色", icon: Paintbrush },
  { command: "background", label: "背景色", icon: Highlighter },
  { command: "unordered", label: "无序列表", icon: List },
  { command: "ordered", label: "有序列表", icon: ListOrdered },
  { command: "code", label: "代码块", icon: Code2 },
  { command: "quote", label: "引用", icon: Quote },
  { command: "link", label: "链接", icon: Link },
  { command: "image", label: "图片", icon: Image },
] as const;

export function EditorToolbar({ onCommand }: EditorToolbarProps) {
  return (
    <div className="editor-toolbar" aria-label="Markdown 工具栏">
      {controls.map((control) => (
        <button
          key={control.command}
          className="tool-button"
          title={control.label}
          onClick={() => onCommand(control.command)}
        >
          <control.icon size={14} />
          <span>{control.label}</span>
        </button>
      ))}
      <button className="tool-button wide" onClick={() => onCommand("leftRight")}>
        ::: left / right
      </button>
    </div>
  );
}
