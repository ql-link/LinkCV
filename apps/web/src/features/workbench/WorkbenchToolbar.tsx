import type { Editor } from "@tiptap/react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ChevronUp,
  Baseline,
  Bold,
  Highlighter,
  Italic,
  Redo2,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { INLINE_FONT_SIZE_MIN, INLINE_FONT_SIZE_MAX, INLINE_FONT_SIZE_STEP, normalizeInlineFontSize } from "../../lib/resumeInlineStyle";
import { api } from "../../api/client";
import { validateResumeImageFile } from "./resumeImageLimits";

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
          initial={{ opacity: 0, scale: 0.92, y: 3 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 3 }}
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
  const Icon = type === "color" ? Baseline : Highlighter;
  const label = type === "color" ? "文字颜色" : "高亮颜色";
  const currentColor = type === "color"
    ? editor.getAttributes("textStyle").color
    : editor.getAttributes("highlight").color;
  const applied = typeof currentColor === "string" && currentColor.length > 0;
  const clearLabel = type === "color" ? "取消文字颜色" : "取消高亮颜色";
  useDismissPopover(open, () => setOpen(false), anchorRef);

  return (
    <div ref={anchorRef} className="workbench-popover-anchor">
      <ToolButton label={label} active={open || applied} onClick={() => setOpen((value) => !value)}><Icon aria-hidden="true" size={18} /></ToolButton>
      <AnchoredPopover open={open} className="color-popover">
        <motion.button
          type="button"
          className="color-swatch color-swatch-clear"
          aria-label={clearLabel}
          title={clearLabel}
          whileTap={{ scale: 0.9 }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (type === "color") editor.chain().focus().unsetColor().run();
            else editor.chain().focus().unsetHighlight().run();
            setOpen(false);
          }}
        >
          <X aria-hidden="true" size={14} />
        </motion.button>
        {colors.map((color) => (
          <motion.button
            type="button"
            key={color}
            className={`color-swatch${currentColor === color ? " is-active" : ""}`}
            style={{ background: color }}
            aria-label={`${label} ${color}`}
            aria-pressed={currentColor === color}
            whileTap={{ scale: 0.9 }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (type === "color") editor.chain().focus().setColor(color).run();
              else editor.chain().focus().setHighlight({ color }).run();
              setOpen(false);
            }}
          />
        ))}
      </AnchoredPopover>
    </div>
  );
}

function FontSizeControl({ editor }: { editor: Editor }) {
  const sizes = new Set<number>();
  const { from, to } = editor.state.selection;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const explicit = normalizeInlineFontSize(node.marks.find((mark) => mark.type.name === "textStyle")?.attrs.fontSize);
    // Computed CSS includes template/heading sizes but excludes canvas transforms.
    const dom = editor.view.nodeDOM(pos);
    const element = dom instanceof HTMLElement ? dom : dom?.parentElement;
    const cssSize = element ? getComputedStyle(element).fontSize : "";
    const points = Number.parseFloat(cssSize) * (cssSize.endsWith("pt") ? 1 : 0.75);
    sizes.add(explicit ?? normalizeInlineFontSize(points) ?? 12);
  });
  const size = [...sizes][0] ?? 12;
  const mixed = sizes.size > 1;
  const adjust = (direction: number) => {
    if (editor.state.selection.empty) return;
    const points = Math.min(INLINE_FONT_SIZE_MAX, Math.max(INLINE_FONT_SIZE_MIN,
      Number((size + direction * INLINE_FONT_SIZE_STEP).toFixed(1))));
    editor.chain().focus().setMark("textStyle", { fontSize: points + "pt" }).run();
  };

  return (
    <div className="selection-font-size-control" role="group" aria-label="字号调整">
      <output
        aria-label="所选文字字号"
        title={mixed ? "混合字号，箭头以选区首字字号为基准统一调整" : "所选文字当前字号"}
      >
        {mixed ? "混合" : <>{size}<small>pt</small></>}
      </output>
      <div className="selection-font-size-arrows">
        <ToolButton label="增大字号" disabled={!mixed && size >= INLINE_FONT_SIZE_MAX} onClick={() => adjust(1)}>
          <ChevronUp aria-hidden="true" size={13} />
        </ToolButton>
        <ToolButton label="减小字号" disabled={!mixed && size <= INLINE_FONT_SIZE_MIN} onClick={() => adjust(-1)}>
          <ChevronDown aria-hidden="true" size={13} />
        </ToolButton>
      </div>
    </div>
  );
}

export function SelectionFormattingToolbar({ editor }: { editor: Editor }) {
  const [, refresh] = useState(0);

  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  if (editor.state.selection.empty) return null;

  return (
    <div className="selection-formatting-toolbar" data-ui-theme="light" role="toolbar" aria-label="所选文字工具栏">
      <FontSizeControl editor={editor} />
      <ToolButton label="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold aria-hidden="true" size={18} /></ToolButton>
      <ToolButton label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic aria-hidden="true" size={18} /></ToolButton>
      <ToolButton label="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline aria-hidden="true" size={18} /></ToolButton>
      <ColorControl editor={editor} type="color" />
      <ColorControl editor={editor} type="highlight" />
    </div>
  );
}

const isApplePlatform = typeof navigator !== "undefined"
  && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export function WorkbenchHistoryActions({ editor }: { editor: Editor }) {
  const [, refresh] = useState(0);

  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);

  const shortcut = (key: string) => isApplePlatform ? `⌘${key}` : `Ctrl+${key}`;
  const actions = [
    { key: "Z", label: "撤销", Icon: Undo2, run: () => editor.chain().focus().undo().run(), enabled: editor.can().undo() },
    { key: "Y", label: "重做", Icon: Redo2, run: () => editor.chain().focus().redo().run(), enabled: editor.can().redo() },
  ] as const;

  return (
    <div className="workbench-history-actions" role="group" aria-label="撤销与重做">
      {actions.map(({ key, label, Icon, run, enabled }) => (
        <button
          type="button"
          className="workbench-history-button"
          key={label}
          aria-label={`${label}（${shortcut(key)}）`}
          title={`${label}（${shortcut(key)}）`}
          disabled={!enabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={run}
        >
          <Icon aria-hidden="true" size={17} />
        </button>
      ))}
    </div>
  );
}

export type UploadedImageMetadata = { naturalWidth: number; naturalHeight: number };

export function readImage(
  file: File,
  resumeId: string,
  onLoad: (src: string, metadata: UploadedImageMetadata) => void,
  onError: (message: string) => void,
) {
  const validationMessage = validateResumeImageFile(file);
  if (validationMessage) {
    onError(validationMessage);
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
        .then(({ asset }) => onLoad(asset.url, {
          naturalWidth: preview.naturalWidth,
          naturalHeight: preview.naturalHeight,
        }))
        .catch((error) => onError(`图片上传失败：${(error as Error).message}`));
    };
    preview.onerror = () => onError("图片已损坏或格式不受支持");
    preview.src = reader.result;
  };
  reader.readAsDataURL(file);
}
