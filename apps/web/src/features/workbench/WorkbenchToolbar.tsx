import type { Editor } from "@tiptap/react";
import { AnimatePresence, motion } from "motion/react";
import {
  Baseline,
  Bold,
  Highlighter,
  IndentIncrease,
  Italic,
  List,
  Sparkles,
  Underline,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type AgentSelectionContext } from "../../api/client";

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
  const applied = type === "color"
    ? Boolean(editor.getAttributes("textStyle").color)
    : editor.isActive("highlight");
  useDismissPopover(open, () => setOpen(false), anchorRef);

  return (
    <div ref={anchorRef} className="workbench-popover-anchor">
      <ToolButton label={label} active={open || applied} onClick={() => setOpen((value) => !value)}><Icon aria-hidden="true" size={18} /></ToolButton>
      <AnchoredPopover open={open} className="color-popover">
        {colors.map((color) => (
          <motion.button
            type="button"
            key={color}
            className="color-swatch"
            style={{ background: color }}
            aria-label={`${label} ${color}`}
            whileTap={{ scale: 0.9 }}
            onMouseDown={(event) => event.preventDefault()}
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

export const selectionAgentActions = ["优化表达", "生成亮点", "调整专业度", "解释内容", "继续改写"] as const;

async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function agentSelectionContext(editor: Editor): Promise<AgentSelectionContext | null> {
  const { from, to } = editor.state.selection;
  const selectedText = editor.state.doc.textBetween(from, to, "\n").trim();
  if (!selectedText) return null;
  const blockIds = new Set<string>();
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return;
    const anchor = node.firstChild;
    if (anchor?.type.name === "resumeBlockAnchor" && typeof anchor.attrs.blockId === "string") {
      blockIds.add(anchor.attrs.blockId);
    }
  });
  if (!blockIds.size) return null;
  return {
    block_ids: [...blockIds],
    from,
    to,
    selected_text: selectedText,
    selected_text_hash: await sha256Text(selectedText),
  };
}

function SelectionAgentControl({
  editor,
  onAgentAction,
}: {
  editor: Editor;
  onAgentAction: (instruction: string, selection: AgentSelectionContext) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  useDismissPopover(open, () => setOpen(false), anchorRef);

  return (
    <div ref={anchorRef} className="workbench-popover-anchor selection-agent-anchor">
      <button
        type="button"
        className={`selection-agent-trigger${open ? " is-open" : ""}`}
        aria-label="AI 修改"
        aria-expanded={open}
        aria-haspopup="menu"
        title="AI 修改"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles aria-hidden="true" size={17} />
        <span>AI 修改</span>
      </button>
      <AnchoredPopover open={open} className="selection-agent-menu">
        <div className="selection-agent-menu-head">
          <span><Sparkles aria-hidden="true" size={14} />用 AI 处理所选内容</span>
          <small>结果将在右侧助手中展示</small>
        </div>
        <div role="menu" aria-label="所选文字 AI 快捷操作">
          {selectionAgentActions.map((action) => (
            <button
              type="button"
              role="menuitem"
              key={action}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                void agentSelectionContext(editor).then((selection) => {
                  if (selection) onAgentAction(action, selection);
                });
                setOpen(false);
              }}
            >
              {action}
            </button>
          ))}
        </div>
      </AnchoredPopover>
    </div>
  );
}

export function SelectionFormattingToolbar({
  editor,
  onAgentAction,
}: {
  editor: Editor;
  onAgentAction: (instruction: string, selection: AgentSelectionContext) => void;
}) {
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
    <div className="selection-formatting-toolbar" role="toolbar" aria-label="所选文字工具栏">
      <ToolButton label="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold aria-hidden="true" size={18} /></ToolButton>
      <ToolButton label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic aria-hidden="true" size={18} /></ToolButton>
      <ToolButton label="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline aria-hidden="true" size={18} /></ToolButton>
      <ColorControl editor={editor} type="color" />
      <ColorControl editor={editor} type="highlight" />
      <Divider />
      <ToolButton label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List aria-hidden="true" size={18} /></ToolButton>
      <ToolButton label="增加缩进" disabled={!editor.can().sinkListItem("listItem")} onClick={() => editor.chain().focus().sinkListItem("listItem").run()}><IndentIncrease aria-hidden="true" size={18} /></ToolButton>
      <Divider />
      <SelectionAgentControl editor={editor} onAgentAction={onAgentAction} />
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
