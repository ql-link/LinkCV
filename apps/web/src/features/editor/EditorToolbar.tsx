import { t, useLocale } from "@/i18n";
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
import { IconButton } from "@/components/ui";

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
  disabledCommands?: EditorCommand[];
};

const controlGroups = [
  [
    { command: "paragraph", get label() { return t("正文"); }, icon: Pilcrow },
    { command: "h1", label: "H1", icon: Heading1 },
    { command: "h2", label: "H2", icon: Heading2 },
    { command: "h3", label: "H3", icon: Heading3 },
  ],
  [
    { command: "bold", get label() { return t("加粗"); }, icon: Bold },
    { command: "italic", get label() { return t("斜体"); }, icon: Italic },
    { command: "underline", get label() { return t("下划线"); }, icon: Underline },
    { command: "strike", get label() { return t("删除线"); }, icon: Strikethrough },
    { command: "clear", get label() { return t("清除格式"); }, icon: Eraser },
  ],
  [
    { command: "color", get label() { return t("字体颜色"); }, icon: Paintbrush },
    { command: "background", get label() { return t("背景色"); }, icon: Highlighter },
  ],
  [
    { command: "unordered", get label() { return t("无序列表"); }, icon: List },
    { command: "ordered", get label() { return t("有序列表"); }, icon: ListOrdered },
    { command: "code", get label() { return t("代码块"); }, icon: Code2 },
    { command: "quote", get label() { return t("引用"); }, icon: Quote },
    { command: "link", get label() { return t("链接"); }, icon: Link },
    { command: "image", get label() { return t("图片"); }, icon: Image },
  ],
] as const;

export function EditorToolbar({ onCommand, disabledCommands = [] }: EditorToolbarProps) {
  useLocale();
  return (
    <div className="editor-toolbar" aria-label={t("Markdown 工具栏")}>
      {controlGroups.map((group, index) => (
        <div className="tool-group" key={index}>
          {group.map((control) => (
            <IconButton
              key={control.command}
              className="tool-button"
              label={control.label}
              title={disabledCommands.includes(control.command) ? t("图片上传中") : control.label}
              disabled={disabledCommands.includes(control.command)}
              onClick={() => onCommand(control.command)}
            >
              <control.icon size={15} />
            </IconButton>
          ))}
        </div>
      ))}
      <button type="button" className="tool-button wide" onClick={() => onCommand("leftRight")}>
        ::: left / right
      </button>
    </div>
  );
}
