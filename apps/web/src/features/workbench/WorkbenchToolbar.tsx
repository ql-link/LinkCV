import type { Editor } from "@tiptap/react";
import { AnimatePresence, motion } from "motion/react";
import {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Check,
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  Minus,
  Pilcrow,
  Plus,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { INLINE_FONT_SIZE_MAX, INLINE_FONT_SIZE_MIN, INLINE_FONT_SIZE_STEP, normalizeInlineFontSize } from "../../lib/resumeInlineStyle";
import { isResumeEmailLink } from "../../lib/resumeLink";
import { api } from "../../api/client";
import { validateResumeImageFile } from "./resumeImageLimits";

const textColors = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#3478f6", "#af52de", "#8a8a8e"];
// 浅色在前、饱和色在后，铺成两行网格；弹层里的第一格是「无背景」。
const highlightColors = [
  "#fff3c4", "#d1f5db", "#dbe8ff", "#ffe0d1", "#f3e3ff", "#f0f0f0",
  "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#3478f6", "#af52de", "#8a8a8e",
];

type ToolButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  caret?: boolean;
};

function ToolButton({ label, active, disabled, children, onClick, caret }: ToolButtonProps) {
  return (
    <motion.button
      type="button"
      className={`workbench-tool-button${active ? " active" : ""}${caret ? " has-caret" : ""}`}
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
      {caret ? <ChevronDown className="workbench-tool-caret" aria-hidden="true" size={13} /> : null}
    </motion.button>
  );
}

type AnchoredPopoverProps = {
  open: boolean;
  className?: string;
  role?: React.AriaRole;
  ariaLabel?: string;
  children: React.ReactNode;
};

export function AnchoredPopover({ open, className = "", role, ariaLabel, children }: AnchoredPopoverProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`workbench-popover ${className}`}
          role={role}
          aria-label={ariaLabel}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ type: "spring", bounce: 0, duration: 0.3 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function useDismissPopover(open: boolean, close: () => void, anchorRef: React.RefObject<HTMLDivElement | null>) {
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

function selectionHasInlineFontSize(editor: Editor) {
  const { from, to } = editor.state.selection;
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (found || !node.isText) return;
    const explicit = node.marks.find((mark) => mark.type.name === "textStyle")?.attrs.fontSize;
    found = normalizeInlineFontSize(explicit) !== null;
  });
  return found;
}

function FontSizeControl({ editor }: { editor: Editor }) {
  const sizes = new Set<number>();
  const { from, to } = editor.state.selection;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const explicit = normalizeInlineFontSize(node.marks.find((mark) => mark.type.name === "textStyle")?.attrs.fontSize);
    // 计算样式包含标题和主题字号，但不含画布缩放。
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
      <ToolButton label="减小字号" disabled={!mixed && size <= INLINE_FONT_SIZE_MIN} onClick={() => adjust(-1)}>
        <Minus aria-hidden="true" size={14} />
      </ToolButton>
      <output
        aria-label="所选文字字号"
        title={mixed ? "混合字号，箭头以选区首字字号为基准统一调整" : "所选文字当前字号"}
      >
        {mixed ? "混合" : <>{size}<small>pt</small></>}
      </output>
      <ToolButton label="增大字号" disabled={!mixed && size >= INLINE_FONT_SIZE_MAX} onClick={() => adjust(1)}>
        <Plus aria-hidden="true" size={14} />
      </ToolButton>
    </div>
  );
}

function FontControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const textColor = editor.getAttributes("textStyle").color;
  const highlightColor = editor.getAttributes("highlight").color;
  const applied = (typeof textColor === "string" && textColor.length > 0)
    || (typeof highlightColor === "string" && highlightColor.length > 0)
    || selectionHasInlineFontSize(editor);
  useDismissPopover(open, () => setOpen(false), anchorRef);

  const pickTextColor = (color: string | null) => {
    if (color) editor.chain().focus().setColor(color).run();
    else editor.chain().focus().unsetColor().run();
    setOpen(false);
  };
  const pickHighlight = (color: string | null) => {
    if (color) editor.chain().focus().setHighlight({ color }).run();
    else editor.chain().focus().unsetHighlight().run();
    setOpen(false);
  };

  return (
    <div ref={anchorRef} className="workbench-popover-anchor">
      <ToolButton label="字体" active={open || applied} caret onClick={() => setOpen((value) => !value)}>
        <Baseline aria-hidden="true" size={18} />
      </ToolButton>
      <AnchoredPopover open={open} className="color-popover" role="group" ariaLabel="字体">
        <div className="color-section">
          <span className="color-section-label"><ALargeSmall aria-hidden="true" size={13} />字号</span>
          <div className="color-section-row">
            <FontSizeControl editor={editor} />
          </div>
        </div>
        <div className="color-section">
          <span className="color-section-label"><Baseline aria-hidden="true" size={13} />字体颜色</span>
          <div className="color-section-row">
            <motion.button
              type="button"
              className={`color-letter is-none${textColor ? "" : " is-active"}`}
              aria-label="取消文字颜色"
              aria-pressed={!textColor}
              title="取消文字颜色"
              whileTap={{ scale: 0.9 }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pickTextColor(null)}
            >
              <span aria-hidden="true">A</span>
              <span className="color-slash" aria-hidden="true" />
            </motion.button>
            {textColors.map((color) => (
              <motion.button
                type="button"
                key={color}
                className={`color-letter${textColor === color ? " is-active" : ""}`}
                style={{ color }}
                aria-label={`文字颜色 ${color}`}
                aria-pressed={textColor === color}
                title={`文字颜色 ${color}`}
                whileTap={{ scale: 0.9 }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickTextColor(color)}
              >
                <span aria-hidden="true">A</span>
              </motion.button>
            ))}
          </div>
        </div>
        <div className="color-section">
          <span className="color-section-label"><Highlighter aria-hidden="true" size={13} />背景颜色</span>
          <div className="color-section-row color-blocks">
            <motion.button
              type="button"
              className={`color-block is-none${highlightColor ? "" : " is-active"}`}
              aria-label="取消背景颜色"
              aria-pressed={!highlightColor}
              title="取消背景颜色"
              whileTap={{ scale: 0.9 }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pickHighlight(null)}
            >
              <span className="color-slash" aria-hidden="true" />
            </motion.button>
            {highlightColors.map((color) => (
              <motion.button
                type="button"
                key={color}
                className={`color-block${highlightColor === color ? " is-active" : ""}`}
                style={{ background: color }}
                aria-label={`背景颜色 ${color}`}
                aria-pressed={highlightColor === color}
                title={`背景颜色 ${color}`}
                whileTap={{ scale: 0.9 }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickHighlight(color)}
              />
            ))}
          </div>
        </div>
        <motion.button
          type="button"
          className="color-reset"
          aria-label="恢复默认颜色"
          title="同时清除文字颜色和背景颜色"
          whileTap={{ scale: 0.98 }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            editor.chain().focus().unsetColor().unsetHighlight().run();
            setOpen(false);
          }}
        >
          恢复默认
        </motion.button>
      </AnchoredPopover>
    </div>
  );
}

function LinkControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const active = editor.isActive("link");
  const currentHref = typeof editor.getAttributes("link").href === "string"
    ? editor.getAttributes("link").href as string
    : "";
  useDismissPopover(open, () => { setOpen(false); setError(""); }, anchorRef);

  const apply = () => {
    const href = value.trim();
    if (!href) {
      setError("请输入链接地址");
      return;
    }
    if (isResumeEmailLink(href)) {
      setError("邮箱属于简历联系方式，不设为链接");
      return;
    }
    if (!editor.chain().focus().extendMarkRange("link").setLink({ href }).run()) {
      setError("链接地址无效，请填写完整网址");
      return;
    }
    setOpen(false);
    setError("");
  };

  return (
    <div ref={anchorRef} className="workbench-popover-anchor">
      <ToolButton
        label="链接"
        active={open || active}
        onClick={() => {
          if (open) {
            setOpen(false);
            setError("");
            return;
          }
          setValue(currentHref);
          setError("");
          setOpen(true);
        }}
      >
        <Link2 aria-hidden="true" size={18} />
      </ToolButton>
      <AnchoredPopover open={open} className="link-popover">
        <input
          className="link-popover-field"
          type="url"
          inputMode="url"
          aria-label="链接地址"
          placeholder="https://example.com"
          value={value}
          onChange={(event) => { setValue(event.target.value); setError(""); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
        {error ? <p className="link-popover-error" role="alert">{error}</p> : null}
        <div className="link-popover-actions">
          {active ? (
            <motion.button
              type="button"
              className="link-popover-button"
              whileTap={{ scale: 0.97 }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setOpen(false);
              }}
            >
              取消链接
            </motion.button>
          ) : null}
          <motion.button
            type="button"
            className="link-popover-button is-primary"
            whileTap={{ scale: 0.97 }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={apply}
          >
            应用
          </motion.button>
        </div>
      </AnchoredPopover>
    </div>
  );
}

type SelectionMenuOption = {
  label: string;
  Icon: typeof AlignLeft;
  isActive: () => boolean;
  run: () => void;
};

function SelectionMenu({
  label,
  icon,
  options,
}: {
  label: string;
  icon: React.ReactNode;
  options: SelectionMenuOption[];
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  useDismissPopover(open, () => setOpen(false), anchorRef);

  return (
    <div ref={anchorRef} className="workbench-popover-anchor">
      <ToolButton label={label} active={open} caret onClick={() => setOpen((value) => !value)}>
        {icon}
      </ToolButton>
      <AnchoredPopover open={open} className="selection-menu-popover" role="menu" ariaLabel={label}>
        {options.map(({ label: optionLabel, Icon, isActive, run }) => (
          <motion.button
            type="button"
            key={optionLabel}
            role="menuitemradio"
            aria-checked={isActive()}
            className={`selection-menu-item${isActive() ? " is-active" : ""}`}
            whileTap={{ scale: 0.98 }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { run(); setOpen(false); }}
          >
            <Icon aria-hidden="true" size={16} />
            <span>{optionLabel}</span>
            {isActive() ? <Check aria-hidden="true" size={14} /> : null}
          </motion.button>
        ))}
      </AnchoredPopover>
    </div>
  );
}

const blockTypeOptions: { label: string; level: 1 | 2 | 3 | null; Icon: typeof AlignLeft }[] = [
  { label: "正文", level: null, Icon: Pilcrow },
  { label: "一级标题", level: 1, Icon: Heading1 },
  { label: "二级标题", level: 2, Icon: Heading2 },
  { label: "三级标题", level: 3, Icon: Heading3 },
];

function BlockTypeControl({ editor }: { editor: Editor }) {
  const options = blockTypeOptions.map(({ label, level, Icon }) => ({
    label,
    Icon,
    isActive: () => (level === null ? editor.isActive("paragraph") : editor.isActive("heading", { level })),
    run: () => {
      if (level === null) editor.chain().focus().setParagraph().run();
      else editor.chain().focus().setHeading({ level }).run();
    },
  }));

  return <SelectionMenu label="本行类型" icon={<Type aria-hidden="true" size={18} />} options={options} />;
}

const alignOptions: { label: string; align: "left" | "center" | "right"; Icon: typeof AlignLeft }[] = [
  { label: "左对齐", align: "left", Icon: AlignLeft },
  { label: "居中对齐", align: "center", Icon: AlignCenter },
  { label: "右对齐", align: "right", Icon: AlignRight },
];

function AlignControl({ editor }: { editor: Editor }) {
  const options = alignOptions.map(({ label, align, Icon }) => ({
    label,
    Icon,
    isActive: () => editor.isActive({ textAlign: align }),
    run: () => { editor.chain().focus().setTextAlign(align).run(); },
  }));
  const activeAlign = alignOptions.find(({ align }) => editor.isActive({ textAlign: align })) ?? alignOptions[0];
  const ActiveIcon = activeAlign.Icon;

  return <SelectionMenu label="对齐方式" icon={<ActiveIcon aria-hidden="true" size={18} />} options={options} />;
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
      <ToolButton label="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold aria-hidden="true" size={18} /></ToolButton>
      <ToolButton label="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough aria-hidden="true" size={18} /></ToolButton>
      <ToolButton label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic aria-hidden="true" size={18} /></ToolButton>
      <ToolButton label="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline aria-hidden="true" size={18} /></ToolButton>
      <LinkControl editor={editor} />
      <FontControl editor={editor} />
      <span className="selection-toolbar-divider" aria-hidden="true" />
      <BlockTypeControl editor={editor} />
      <AlignControl editor={editor} />
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
