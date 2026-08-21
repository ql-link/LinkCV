import type { Editor } from "@tiptap/react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Columns2,
  Eraser,
  Highlighter,
  Image,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Paintbrush,
  Redo2,
  Smile,
  Underline,
  Undo2,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { inlineIconComponents, inlineIconNames, type InlineIconName } from "./editorExtensions";
import { convertCurrentLineToResumeRow, convertResumeRowToParagraph } from "./editorCommands";

const textColors = ["#1d1d1f", "#3478f6", "#34c759", "#ff9f0a", "#ff3b30", "#8a8a8e"];
const highlightColors = ["#fff3c4", "#d1f5db", "#dbe8ff", "#ffe0d1", "#f0f0f0"];

type ToolButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
};

function ToolButton({ label, active, disabled, children, onClick }: ToolButtonProps) {
  return (
    <motion.button
      type="button"
      className={`workbench-tool-button${active ? " active" : ""}`}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={label}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", bounce: 0, duration: 0.32 }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </motion.button>
  );
}

function Divider() {
  return <span className="workbench-toolbar-divider" aria-hidden="true" />;
}

type AnchoredPopoverProps = {
  open: boolean;
  className?: string;
  children: React.ReactNode;
};

function AnchoredPopover({ open, className = "", children }: AnchoredPopoverProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`workbench-popover ${className}`}
          initial={{ opacity: 0, scale: 0.92, y: -3 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: -3 }}
          transition={{ type: "spring", bounce: 0, duration: 0.3 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useDismissPopover(open: boolean, close: () => void, anchorRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, close, open]);
}

function ColorControl({ editor, type }: { editor: Editor; type: "color" | "highlight" }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const colors = type === "color" ? textColors : highlightColors;
  const Icon = type === "color" ? Paintbrush : Highlighter;
  const label = type === "color" ? "文字颜色" : "高亮颜色";
  useDismissPopover(open, () => setOpen(false), anchorRef);
  return (
    <div ref={anchorRef} className="workbench-popover-anchor">
      <ToolButton label={label} active={open} onClick={() => setOpen((value) => !value)}><Icon size={15} /></ToolButton>
      <AnchoredPopover open={open} className="color-popover">
        {colors.map((color) => (
          <motion.button
            type="button"
            key={color}
            className="color-swatch"
            style={{ background: color }}
            aria-label={`${label} ${color}`}
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              if (type === "color") editor.chain().focus().setColor(color).run();
              else editor.chain().focus().toggleHighlight({ color }).run();
              setOpen(false);
            }}
          />
        ))}
      </AnchoredPopover>
    </div>
  );
}

function LinkControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const selectionRef = useRef({ from: 0, to: 0 });
  const anchorRef = useRef<HTMLDivElement | null>(null);
  useDismissPopover(open, () => setOpen(false), anchorRef);
  const submit = () => {
    const href = url.trim();
    if (!href) return;
    editor.chain().focus().setTextSelection(selectionRef.current).setLink({ href }).run();
    setOpen(false);
  };
  return (
    <div ref={anchorRef} className="workbench-popover-anchor">
      <ToolButton label="插入链接" active={open || editor.isActive("link")} onClick={() => {
        selectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
        setUrl(editor.getAttributes("link").href ?? "");
        setOpen((value) => !value);
      }}><LinkIcon size={15} /></ToolButton>
      <AnchoredPopover open={open} className="link-popover">
        <input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" onKeyDown={(event) => event.key === "Enter" && submit()} />
        <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={submit}>插入</motion.button>
      </AnchoredPopover>
    </div>
  );
}

function IconControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  useDismissPopover(open, () => setOpen(false), anchorRef);
  return (
    <div ref={anchorRef} className="workbench-popover-anchor">
      <ToolButton label="插入图标" active={open} onClick={() => setOpen((value) => !value)}><Smile size={15} /></ToolButton>
      <AnchoredPopover open={open} className="icon-popover">
        {inlineIconNames.map((name: InlineIconName) => {
          const Icon = inlineIconComponents[name];
          return <motion.button
            type="button"
            key={name}
            whileTap={{ scale: 0.9 }}
            title={name}
            onClick={() => {
              editor.chain().focus().insertContent({ type: "inlineIcon", attrs: { name } }).run();
              setOpen(false);
            }}
          ><Icon size={16} /></motion.button>;
        })}
      </AnchoredPopover>
    </div>
  );
}

function readImage(file: File, resumeId: string, onLoad: (src: string) => void, onError: (message: string) => void) {
  if (!file.type.startsWith("image/")) {
    onError("请选择图片文件");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    onError("图片不能超过 8MB");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => onError("图片读取失败");
  reader.onload = () => {
    if (typeof reader.result !== "string") {
      onError("图片读取失败");
      return;
    }
    const preview = new window.Image();
    preview.onload = () => {
      void api.uploadResumeAsset(resumeId, { file_name: file.name, data_url: reader.result as string })
        .then(({ asset }) => onLoad(asset.url))
        .catch((error) => onError(`图片上传失败：${(error as Error).message}`));
    };
    preview.onerror = () => onError("图片已损坏或格式不受支持");
    preview.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function ImageControl({ editor, resumeId, avatar = false, onNotice }: { editor: Editor; resumeId: string; avatar?: boolean; onNotice: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const insert = (file: File) => {
    readImage(file, resumeId, (src) => {
      if (!avatar) {
        editor.chain().focus().insertContent({ type: "resumeImage", attrs: { src, width: 55, widthUnit: "%", align: "center", alt: file.name } }).run();
        return;
      }

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
    }, onNotice);
  };
  return (
    <>
      <ToolButton label={avatar ? "上传或更换头像" : "插入正文图片"} onClick={() => inputRef.current?.click()}>
        {avatar ? <UserRound size={15} /> : <Image size={15} />}
      </ToolButton>
      <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) insert(file);
        event.target.value = "";
      }} />
    </>
  );
}

function RowLayoutControl({ editor, onNotice }: { editor: Editor; onNotice: (message: string) => void }) {
  const active = editor.isActive("resumeRow");
  const leftWidth = Number(editor.getAttributes("resumeRow").leftWidth) || 70;

  const toggleLayout = () => {
    const changed = active
      ? convertResumeRowToParagraph(editor)
      : convertCurrentLineToResumeRow(editor);

    if (!changed) {
      onNotice(active ? "当前左右栏无法还原" : "请先把光标放在要分栏的正文行中");
      return;
    }

    editor.view.focus();
  };

  return (
    <div className={`row-layout-control${active ? " active" : ""}`}>
      <ToolButton
        label={active ? "取消左右分栏" : "为当前行添加右侧内容"}
        active={active}
        onClick={toggleLayout}
      >
        <Columns2 size={15} />
      </ToolButton>
      {active && (
        <label className="row-width-field">
          <span>左栏</span>
          <input
            type="number"
            min="30"
            max="80"
            step="1"
            value={leftWidth}
            aria-label="左右布局左栏宽度百分比"
            onChange={(event) => {
              const next = Math.min(80, Math.max(30, Number(event.target.value)));
              if (Number.isFinite(next)) editor.chain().focus().updateAttributes("resumeRow", { leftWidth: next }).run();
            }}
          />
          <span>%</span>
        </label>
      )}
    </div>
  );
}

export function WorkbenchToolbar({ editor, resumeId, onNotice }: { editor: Editor | null; resumeId: string; onNotice: (message: string) => void }) {
  const [, refresh] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const update = () => refresh((value) => value + 1);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  if (!editor) return null;
  return (
    <div className="workbench-toolbar" role="toolbar" aria-label="简历格式工具栏">
      <ToolButton label="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></ToolButton>
      <ToolButton label="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></ToolButton>
      <Divider />
      <select
        className="workbench-block-select"
        aria-label="段落样式"
        value={editor.isActive("heading", { level: 1 }) ? "1" : editor.isActive("heading", { level: 2 }) ? "2" : editor.isActive("heading", { level: 3 }) ? "3" : "p"}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "p") editor.chain().focus().setParagraph().run();
          else editor.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run();
        }}
      >
        <option value="p">正文</option><option value="1">标题 1</option><option value="2">标题 2</option><option value="3">标题 3</option>
      </select>
      <Divider />
      <ToolButton label="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolButton>
      <ToolButton label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolButton>
      <ToolButton label="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15} /></ToolButton>
      <ToolButton label="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser size={15} /></ToolButton>
      <ColorControl editor={editor} type="color" />
      <ColorControl editor={editor} type="highlight" />
      <Divider />
      <ToolButton label="左对齐" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft size={15} /></ToolButton>
      <ToolButton label="居中" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter size={15} /></ToolButton>
      <ToolButton label="右对齐" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight size={15} /></ToolButton>
      <Divider />
      <ToolButton label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></ToolButton>
      <ToolButton label="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></ToolButton>
      <Divider />
      <LinkControl editor={editor} />
      <ImageControl editor={editor} resumeId={resumeId} onNotice={onNotice} />
      <ImageControl editor={editor} resumeId={resumeId} avatar onNotice={onNotice} />
      <IconControl editor={editor} />
      <RowLayoutControl editor={editor} onNotice={onNotice} />
    </div>
  );
}
