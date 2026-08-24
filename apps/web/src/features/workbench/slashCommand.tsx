import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { Plugin, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { resumeInlineIconOptions, type InlineIconName } from "../../lib/resumeInlineIcon";
import { convertCurrentLineToResumeRow, insertInlineIcon, workbenchBlockCommands, type WorkbenchBlockCommand } from "./editorCommands";
import { inlineIconComponents } from "./editorExtensions";
import { readImage } from "./WorkbenchToolbar";

export type CommandMenuState = {
  x: number;
  y: number;
  query: string;
  replaceRange: { from: number; to: number } | null;
};

type LineInsertMenuOptions = {
  onOpen: (state: CommandMenuState) => void;
};

const groupedVisualLineNodeNames = new Set(["resumeRow", "resumeMetaRow", "resumeTrioRow"]);

export function editableLineStartPositions(state: EditorState) {
  const positions: number[] = [];
  state.doc.descendants((node, position, parent, index) => {
    if (!node.isTextblock || node.type.name === "codeBlock") return true;
    if (parent && groupedVisualLineNodeNames.has(parent.type.name) && index > 0) return false;
    const firstChild = node.firstChild;
    positions.push(position + 1
      + (firstChild?.type.name === "resumeBlockAnchor" ? firstChild.nodeSize : 0));
    return false;
  });
  return positions;
}

export const LineInsertMenuExtension = Extension.create<LineInsertMenuOptions>({
  name: "lineInsertMenu",

  addOptions() {
    return { onOpen: () => undefined };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const onOpen = this.options.onOpen;
    return [
      new Plugin({
        props: {
          decorations(state) {
            if (!editor.isEditable) return DecorationSet.empty;
            const positions = editableLineStartPositions(state);
            if (positions.length === 0) return DecorationSet.empty;
            return DecorationSet.create(state.doc, positions.map((position) =>
              Decoration.widget(position, () => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "resume-line-add";
                button.setAttribute("aria-label", "在此行开头插入内容");
                button.setAttribute("title", "在此行开头插入内容");
                button.setAttribute("contenteditable", "false");
                button.textContent = "+";
                button.addEventListener("mousedown", (event) => event.preventDefault());
                button.addEventListener("click", (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const bounds = button.getBoundingClientRect();
                  editor.chain().focus().setTextSelection(position).run();
                  onOpen({
                    x: Math.max(12, Math.min(bounds.right + 8, window.innerWidth - 312)),
                    y: Math.max(12, Math.min(bounds.top, window.innerHeight - 432)),
                    query: "",
                    replaceRange: null,
                  });
                });
                return button;
              }, {
                key: `line-insert-menu-${position}`,
                side: -1,
                ignoreSelection: true,
              }),
            ));
          },
        },
      }),
    ];
  },
});

export function filterWorkbenchCommands(query: string) {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return workbenchBlockCommands;
  return workbenchBlockCommands.filter((command) =>
    [command.label, ...command.keywords].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalized)),
  );
}

function chooseImage(
  resumeId: string,
  onLoad: (file: File, src: string, metadata: { naturalWidth: number; naturalHeight: number }) => void,
  onNotice: (message: string) => void,
) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) readImage(file, resumeId, (src, metadata) => onLoad(file, src, metadata), onNotice);
  };
  input.click();
}

function insertAvatar(editor: Editor, file: File, src: string) {
  let avatarPosition: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "avatarImage") {
      avatarPosition = position;
      return false;
    }
    return true;
  });
  if (avatarPosition === null) {
    editor.chain().focus().insertContentAt(0, { type: "avatarImage", attrs: { src, size: 96, alt: file.name } }).run();
  } else {
    editor.chain().focus().command(({ tr }) => {
      const node = tr.doc.nodeAt(avatarPosition as number);
      if (!node) return false;
      tr.setNodeMarkup(avatarPosition as number, undefined, { ...node.attrs, src, alt: file.name });
      return true;
    }).run();
  }
}

export function runWorkbenchBlockCommand(
  editor: Editor,
  command: WorkbenchBlockCommand,
  resumeId: string,
  onNotice: (message: string) => void,
) {
  if (command.id === "paragraph") return editor.chain().focus().setParagraph().run();
  if (command.id.startsWith("heading-")) {
    const level = Number(command.id.slice(-1)) as 1 | 2 | 3;
    return editor.chain().focus().setHeading({ level }).run();
  }
  if (command.id === "bullet-list") return editor.chain().focus().toggleBulletList().run();
  if (command.id === "ordered-list") return editor.chain().focus().toggleOrderedList().run();
  if (command.id === "resume-row") {
    const changed = convertCurrentLineToResumeRow(editor);
    if (!changed) onNotice("请先把光标放在要左右对齐的正文行中");
    return changed;
  }
  if (command.id === "inline-icon") return insertInlineIcon(editor, "Star");
  if (command.id === "inline-image") {
    chooseImage(resumeId, (file, src, metadata) => {
      const aspectRatio = metadata.naturalWidth / Math.max(1, metadata.naturalHeight);
      const width = Math.round(Math.min(120, Math.max(20, 24 * aspectRatio)));
      editor.chain().focus().insertContent([
        { type: "inlineImage", attrs: { src, width, height: 24, aspectRatio, alt: file.name } },
        { type: "text", text: " " },
      ]).run();
    }, onNotice);
    return true;
  }
  if (command.id === "image") {
    chooseImage(resumeId, (file, src) => {
      editor.chain().focus().insertContent({ type: "resumeImage", attrs: { src, width: 55, widthUnit: "%", align: "center", alt: file.name } }).run();
    }, onNotice);
    return true;
  }
  chooseImage(resumeId, (file, src) => insertAvatar(editor, file, src), onNotice);
  return true;
}

export function SlashCommandMenu({
  editor,
  resumeId,
  state,
  onClose,
  onNotice,
}: {
  editor: Editor;
  resumeId: string;
  state: CommandMenuState;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const commands = useMemo(() => filterWorkbenchCommands(state.query), [state.query]);
  const [selected, setSelected] = useState(0);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelected(0);
    setIconPickerOpen(false);
  }, [state.query]);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const execute = (command: WorkbenchBlockCommand) => {
    if (command.id === "inline-icon") {
      setIconPickerOpen(true);
      setSelectedIcon(0);
      return;
    }
    if (state.replaceRange) editor.chain().focus().deleteRange(state.replaceRange).run();
    runWorkbenchBlockCommand(editor, command, resumeId, onNotice);
    onClose();
  };

  const insertSelectedIcon = (name: InlineIconName) => {
    insertInlineIcon(editor, name, state.replaceRange ?? undefined);
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown" && iconPickerOpen) {
        event.preventDefault();
        setSelectedIcon((value) => (value + 1) % resumeInlineIconOptions.length);
      } else if (event.key === "ArrowUp" && iconPickerOpen) {
        event.preventDefault();
        setSelectedIcon((value) => (value - 1 + resumeInlineIconOptions.length) % resumeInlineIconOptions.length);
      } else if (event.key === "ArrowDown" && commands.length) {
        event.preventDefault();
        setSelected((value) => (value + 1) % commands.length);
      } else if (event.key === "ArrowUp" && commands.length) {
        event.preventDefault();
        setSelected((value) => (value - 1 + commands.length) % commands.length);
      } else if (event.key === "Enter" && iconPickerOpen) {
        event.preventDefault();
        const option = resumeInlineIconOptions[selectedIcon];
        if (option) insertSelectedIcon(option.name);
      } else if (event.key === "Enter" && commands[selected]) {
        event.preventDefault();
        execute(commands[selected]);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  return (
    <div
      ref={rootRef}
      className="workbench-command-menu"
      role="listbox"
      aria-label="插入与转换块"
      style={{ left: state.x, top: state.y }}
    >
      <div className="workbench-command-heading">
        {iconPickerOpen ? (
          <button type="button" aria-label="返回插入与转换" onClick={() => setIconPickerOpen(false)}><ChevronLeft size={14} />选择图标</button>
        ) : "插入与转换"}
      </div>
      {iconPickerOpen ? (
        <div className="workbench-inline-icon-picker" role="listbox" aria-label="选择图标">
          {resumeInlineIconOptions.map((option, index) => {
            const Icon = inlineIconComponents[option.name];
            return (
              <button
                type="button"
                role="option"
                aria-selected={index === selectedIcon}
                className={index === selectedIcon ? "is-selected" : ""}
                key={option.name}
                onMouseEnter={() => setSelectedIcon(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertSelectedIcon(option.name)}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : commands.length === 0 ? <p>没有匹配命令</p> : commands.map((command, index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === selected}
          className={index === selected ? "is-selected" : ""}
          key={command.id}
          onMouseEnter={() => setSelected(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => execute(command)}
        >
          <span>{command.label}</span>
          <small>{command.keywords[0]}</small>
        </button>
      ))}
    </div>
  );
}
