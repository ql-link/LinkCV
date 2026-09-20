import { Extension, mergeAttributes, Node, type Extensions } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Award,
  Briefcase,
  Calendar,
  Check,
  Code2,
  GitFork,
  Globe,
  GraduationCap,
  ContactRound,
  ImageUp,
  Mail,
  MapPin,
  Maximize2,
  Phone,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { resumeInlineIconOptions, type InlineIconName } from "../../lib/resumeInlineIcon";
import { isResumeEmailLink, shouldAutoLinkResumeValue } from "../../lib/resumeLink";
import { useResumeStore } from "../../store/resumeStore";
import {
  exitResumeRowToBlankParagraph,
  exitVisuallyBlankResumeListItem,
  removeBlankParagraphAfterResumeRow,
  removeVisuallyBlankResumeLine,
  setResumeRowColumnWidths,
  setResumeRowColumns,
} from "./editorCommands";
import {
  equalResumeRowColumnWidths,
  normalizeResumeRowColumnWidths,
  resizeResumeRowColumns,
  resumeRowColumnTracks,
  resumeRowDividerOffsets,
} from "./resumeRowColumns";
import { RESUME_IMAGE_ACCEPT, validateResumeImageFile } from "./resumeImageLimits";
import { ResumeBulletListInputRules } from "./editorInputRules";

export const inlineIconComponents = {
  Mail,
  Phone,
  MapPin,
  Globe,
  Github: GitFork,
  Linkedin: ContactRound,
  GraduationCap,
  Briefcase,
  Award,
  Star,
  Calendar,
  Code2,
};

export type { InlineIconName } from "../../lib/resumeInlineIcon";
export const inlineIconNames = resumeInlineIconOptions.map((option) => option.name);

// Canonical node ids are the stable editor anchors. Legacy blk_ values are
// accepted only when the explicit maintenance adapter projects an old row.
const BLOCK_ID_PATTERN = /^(?:blk|node)_[a-z0-9]{16,64}$/;
const blockIdentityPluginKey = new PluginKey("resume-block-identity");

export function createResumeBlockId() {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "")
    ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `node_${random.toLowerCase()}`.slice(0, 69);
}

export function normalizeResumeBlockId(value: unknown) {
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value) ? value : null;
}

export const ResumeBlockAnchor = Node.create({
  name: "resumeBlockAnchor",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({
    blockId: { default: null },
    semanticKind: { default: null },
    role: { default: null },
    sourceRefs: { default: [] },
    fieldKey: { default: null },
    contactKind: { default: null },
    label: { default: null },
  }),
  parseHTML: () => [{
    tag: "span[data-resume-block-id]",
    getAttrs: (element) => element instanceof HTMLElement
      ? {
        blockId: normalizeResumeBlockId(element.dataset.resumeBlockId),
        semanticKind: element.dataset.resumeSemanticKind ?? null,
        role: element.dataset.resumeBlockRole ?? null,
        fieldKey: element.dataset.resumeFieldKey ?? null,
        contactKind: element.dataset.resumeContactKind ?? null,
        label: element.dataset.resumeLabel ?? null,
      }
      : false,
  }],
  renderHTML: ({ node }) => ["span", {
    "data-resume-block-id": normalizeResumeBlockId(node.attrs.blockId) ?? createResumeBlockId(),
    ...(typeof node.attrs.semanticKind === "string" ? { "data-resume-semantic-kind": node.attrs.semanticKind } : {}),
    ...(typeof node.attrs.role === "string" ? { "data-resume-block-role": node.attrs.role } : {}),
    ...(typeof node.attrs.fieldKey === "string" ? { "data-resume-field-key": node.attrs.fieldKey } : {}),
    ...(typeof node.attrs.contactKind === "string" ? { "data-resume-contact-kind": node.attrs.contactKind } : {}),
    ...(typeof node.attrs.label === "string" ? { "data-resume-label": node.attrs.label } : {}),
    "aria-hidden": "true",
    class: "resume-block-anchor",
  }],
});

export const ResumeBlockIdentity = Extension.create({
  name: "resumeBlockIdentity",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: blockIdentityPluginKey,
      appendTransaction: (_transactions, _oldState, newState) => {
        const anchorType = newState.schema.nodes.resumeBlockAnchor;
        if (!anchorType) return null;
        const missing: number[] = [];
        newState.doc.descendants((node, position) => {
          if (node.isTextblock && node.type.name !== "codeBlock") {
            const first = node.firstChild;
            if (first?.type !== anchorType || !normalizeResumeBlockId(first.attrs.blockId)) {
              missing.push(position + 1);
            }
          }
        });
        if (!missing.length) return null;
        const transaction = newState.tr;
        for (const position of missing.reverse()) {
          transaction.insert(position, anchorType.create({ blockId: createResumeBlockId() }));
        }
        return transaction;
      },
    })];
  },
});

function uploadImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const validationMessage = validateResumeImageFile(file);
    if (validationMessage) {
      reject(new Error(validationMessage));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("图片读取失败"));
        return;
      }
      const preview = new Image();
      preview.addEventListener("load", () => {
        const resumeId = useResumeStore.getState().activeResumeId;
        if (!resumeId) {
          reject(new Error("请先选择简历"));
          return;
        }
        void api.uploadResumeAsset(resumeId, { file_name: file.name, data_url: reader.result as string })
          .then(({ asset }) => resolve(asset.url))
          .catch(reject);
      }, { once: true });
      preview.addEventListener("error", () => reject(new Error("图片已损坏或格式不受支持")), { once: true });
      preview.src = reader.result;
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function MediaNodeView({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const mediaRef = useRef<HTMLElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isAvatar = node.type.name === "avatarImage";
  const size = isAvatar ? Number(node.attrs.size) : Number(node.attrs.width);
  const widthUnit = isAvatar ? "px" : node.attrs.widthUnit === "px" ? "px" : "%";
  const align = node.attrs.align as string | undefined;
  const [widthDraft, setWidthDraft] = useState(String(size));
  const [error, setError] = useState("");
  const avatarSizeRef = useRef(size);

  useEffect(() => setWidthDraft(String(size)), [size]);
  useEffect(() => { avatarSizeRef.current = size; }, [size]);

  const adjustAvatarSize = (direction: -1 | 1) => {
    const nextSize = Math.min(220, Math.max(56, avatarSizeRef.current + direction * 4));
    if (nextSize === avatarSizeRef.current) return;
    avatarSizeRef.current = nextSize;
    updateAttributes({ size: nextSize });
  };

  useEffect(() => {
    if (!isAvatar || !selected) return;
    const media = mediaRef.current;
    if (!media) return;

    const zoomAvatar = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
      if (event.target !== imageRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      adjustAvatarSize(event.deltaY < 0 ? 1 : -1);
    };

    media.addEventListener("wheel", zoomAvatar, { passive: false });
    return () => media.removeEventListener("wheel", zoomAvatar);
  }, [isAvatar, selected, updateAttributes]);

  const bodyImageBounds = () => {
    const image = imageRef.current;
    const editor = image?.closest<HTMLElement>(".ProseMirror");
    const pageWidth = editor?.getBoundingClientRect().width ?? 0;
    const lineHeight = editor ? Number.parseFloat(getComputedStyle(editor).lineHeight) : 0;
    return { pageWidth, minPx: Math.max(10, Number.isFinite(lineHeight) ? lineHeight : 0) };
  };

  const applyBodyWidth = (nextValue: number, nextUnit = widthUnit) => {
    const { pageWidth, minPx } = bodyImageBounds();
    if (!pageWidth) return;
    if (nextUnit === "px") {
      updateAttributes({ width: Math.round(Math.min(pageWidth, Math.max(minPx, nextValue))), widthUnit: "px" });
      return;
    }
    const minPercent = (minPx / pageWidth) * 100;
    updateAttributes({ width: Number(Math.min(100, Math.max(minPercent, nextValue)).toFixed(1)), widthUnit: "%" });
  };

  const changeUnit = (nextUnit: "%" | "px") => {
    const image = imageRef.current;
    const editor = image?.closest<HTMLElement>(".ProseMirror");
    if (!image || !editor) return;
    const renderedWidth = image.getBoundingClientRect().width;
    const nextValue = nextUnit === "px" ? renderedWidth : (renderedWidth / editor.getBoundingClientRect().width) * 100;
    applyBodyWidth(nextValue, nextUnit);
  };

  const replace = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = RESUME_IMAGE_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        updateAttributes({ src: await uploadImage(file), alt: node.attrs.alt || file.name });
        setError("");
      } catch (replaceError) {
        setError((replaceError as Error).message);
      }
    };
    input.click();
  };

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const image = imageRef.current;
    const content = image?.closest<HTMLElement>(".ProseMirror");
    if (!image || !content) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = image.getBoundingClientRect().width;
    const pageWidth = content.getBoundingClientRect().width;

    const move = (moveEvent: PointerEvent) => {
      const nextPx = startWidth + moveEvent.clientX - startX;
      if (widthUnit === "px") applyBodyWidth(nextPx, "px");
      else applyBodyWidth((nextPx / pageWidth) * 100, "%");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
  };

  return (
    <NodeViewWrapper
      ref={mediaRef}
      as={isAvatar ? "figure" : "div"}
      className={`resume-media-node ${isAvatar ? "resume-avatar" : `resume-image align-${align}`}${selected ? " is-selected" : ""}`}
      style={isAvatar ? { width: size, height: size } : { width: `${size}${widthUnit}` }}
      role={isAvatar ? "group" : undefined}
      aria-label={isAvatar ? "简历头像；按住 Command 或 Control 并滚动鼠标滚轮缩放，也可按住修饰键使用上下方向键调整" : undefined}
      tabIndex={isAvatar && selected ? 0 : undefined}
      data-drag-handle
      onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
        if (!isAvatar || !selected || (!event.ctrlKey && !event.metaKey)) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        adjustAvatarSize(event.key === "ArrowUp" ? 1 : -1);
      }}
    >
      {selected && isAvatar && (
        <>
          <div className="avatar-scale-hint" contentEditable={false} role="note">
            按住 <kbd>⌘</kbd> / Ctrl + 滚轮缩放
          </div>
          <button
            type="button"
            className="avatar-replace-action"
            contentEditable={false}
            aria-label="更换头像"
            onClick={() => void replace()}
          >
            <ImageUp aria-hidden="true" size={16} />
            <span>更换头像</span>
          </button>
          {error && <em className="avatar-media-error" contentEditable={false} role="alert">{error}</em>}
        </>
      )}
      {selected && !isAvatar && (
        <div className="media-context-toolbar" contentEditable={false}>
          <button aria-label="图片左对齐" onClick={() => updateAttributes({ align: "left" })}><AlignLeft size={14} /></button>
          <button aria-label="图片居中" onClick={() => updateAttributes({ align: "center" })}><AlignCenter size={14} /></button>
          <button aria-label="图片右对齐" onClick={() => updateAttributes({ align: "right" })}><AlignRight size={14} /></button>
          <button aria-label="图片通栏" onClick={() => updateAttributes({ align: "full", width: 100, widthUnit: "%" })}><Maximize2 size={14} /></button>
          <span />
          <label className="media-size-field" aria-label="图片宽度">
            <input
              type="number"
              inputMode="decimal"
              min={widthUnit === "px" ? 10 : 0.1}
              max={widthUnit === "px" ? 794 : 100}
              step={widthUnit === "px" ? 1 : 0.1}
              value={widthDraft}
              onChange={(event) => setWidthDraft(event.target.value)}
              onBlur={() => {
                const nextValue = Number(widthDraft);
                if (Number.isFinite(nextValue)) applyBodyWidth(nextValue);
                else setWidthDraft(String(size));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const nextValue = Number(widthDraft);
                  if (Number.isFinite(nextValue)) applyBodyWidth(nextValue);
                  event.currentTarget.blur();
                }
              }}
            />
            <select aria-label="图片宽度单位" value={widthUnit} onChange={(event) => changeUnit(event.target.value as "%" | "px")}>
              <option value="%">%</option>
              <option value="px">px</option>
            </select>
          </label>
          <span />
          <input
            className="media-alt-field"
            aria-label="图片替代文字"
            value={node.attrs.alt ?? ""}
            placeholder="替代文字"
            onChange={(event) => updateAttributes({ alt: event.target.value })}
          />
          {error && <em className="media-error" role="alert">{error}</em>}
          <button aria-label="更换图片" onClick={() => void replace()}><Upload size={14} /></button>
          <button aria-label="删除图片" onClick={deleteNode}><Trash2 size={14} /></button>
        </div>
      )}
      {isAvatar ? (
        <span className="resume-avatar-image-frame" contentEditable={false}>
          <img
            ref={imageRef}
            src={node.attrs.src}
            alt={node.attrs.alt || "简历头像"}
            width={size}
            height={size}
            draggable={false}
          />
        </span>
      ) : (
        <img
          ref={imageRef}
          src={node.attrs.src}
          alt={node.attrs.alt || "简历图片"}
          draggable={false}
        />
      )}
      {selected && !isAvatar && <button className="media-resize-handle" contentEditable={false} aria-label="拖拽调整图片尺寸" onPointerDown={startResize} />}
    </NodeViewWrapper>
  );
}

export const AvatarImage = Node.create({
  name: "avatarImage",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({
    src: { default: "" },
    size: { default: 96 },
    alt: { default: "简历头像" },
    systemFallback: { default: false },
    nodeId: { default: null },
    sourceRefs: { default: [] },
  }),
  parseHTML: () => [{
    tag: "figure[data-type='avatar-image']",
    getAttrs: (element) => element instanceof HTMLElement ? {
      src: element.dataset.src ?? "",
      size: Number(element.dataset.size) || 96,
      alt: element.dataset.alt ?? "简历头像",
      systemFallback: element.dataset.systemFallback === "true",
      nodeId: normalizeResumeBlockId(element.dataset.nodeId),
    } : false,
  }],
  renderHTML: ({ HTMLAttributes }) => ["figure", mergeAttributes(HTMLAttributes, { "data-type": "avatar-image" })],
  addNodeView: () => ReactNodeViewRenderer(MediaNodeView, {
    className: "resume-avatar-node-view",
  }),
});

export const ResumeImage = Node.create({
  name: "resumeImage",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({
    src: { default: "" },
    width: { default: 55 },
    widthUnit: { default: "%" },
    align: { default: "center" },
    alt: { default: "简历图片" },
    nodeId: { default: null },
    sourceRefs: { default: [] },
  }),
  parseHTML: () => [
    {
      tag: "div[data-type='resume-image']",
      getAttrs: (element) => element instanceof HTMLElement ? {
        src: element.dataset.src ?? "",
        width: Number(element.dataset.width) || 55,
        widthUnit: element.dataset.widthUnit === "px" ? "px" : "%",
        align: element.dataset.align ?? "center",
        alt: element.dataset.alt ?? "简历图片",
        nodeId: normalizeResumeBlockId(element.dataset.nodeId),
      } : false,
    },
    {
      tag: "img:not([data-inline-image])",
      getAttrs: (element) => element instanceof HTMLImageElement ? {
        src: element.getAttribute("src") || "",
        alt: element.alt || "简历图片",
      } : false,
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ["figure", mergeAttributes(HTMLAttributes, { "data-type": "resume-image" })],
  addNodeView: () => ReactNodeViewRenderer(MediaNodeView),
});

function ResumeColumnMenu({
  position,
  columns,
  onSelect,
  onClose,
}: {
  position: { x: number; y: number };
  columns: number;
  onSelect: (columns: 2 | 3 | 4) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const options: Array<2 | 3 | 4> = [2, 3, 4];
  const currentIndex = Math.max(0, options.indexOf(columns as 2 | 3 | 4));
  const [focused, setFocused] = useState(currentIndex);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !rootRef.current?.contains(target)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocused((value) => (
          event.key === "ArrowDown"
            ? (value + 1) % options.length
            : (value - 1 + options.length) % options.length
        ));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onSelect(options[focused]);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [focused, onClose, onSelect]);

  return createPortal(
    <div
      ref={rootRef}
      className="resume-column-menu"
      role="menu"
      aria-label="分栏栏数"
      style={{
        left: Math.max(12, Math.min(position.x, window.innerWidth - 212)),
        top: Math.max(12, Math.min(position.y, window.innerHeight - 168)),
      }}
    >
      <div className="resume-column-menu-heading">分栏栏数</div>
      {options.map((option) => (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={option === columns}
          className={option === focused ? "is-selected" : ""}
          key={option}
          onMouseEnter={() => setFocused(options.indexOf(option))}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(option)}
        >
          <span>{option} 栏</span>
          {option === columns && <Check aria-hidden="true" size={14} />}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function ResumeRowView({ node, editor, getPos }: NodeViewProps) {
  const [active, setActive] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const leftWidth = normalizeResumeRowWidth(node.attrs.leftWidth);
  const columns = node.childCount;
  const equalColumns = columns > 2;
  const columnWidths = equalColumns
    ? normalizeResumeRowColumnWidths(node.attrs.columnWidths, columns)
    : null;
  // 未自定义宽度时按等分渲染，分隔线位置也按等分推算。
  const effectiveWidths = columnWidths ?? equalResumeRowColumnWidths(columns);
  const dividerOffsets = equalColumns ? resumeRowDividerOffsets(effectiveWidths) : [];

  useEffect(() => {
    const updateActiveState = () => {
      const position = getPos();
      if (typeof position !== "number") {
        setActive(false);
        return;
      }

      const { from, to } = editor.state.selection;
      setActive(from > position && to < position + node.nodeSize);
    };

    updateActiveState();
    editor.on("selectionUpdate", updateActiveState);
    editor.on("transaction", updateActiveState);
    return () => {
      editor.off("selectionUpdate", updateActiveState);
      editor.off("transaction", updateActiveState);
    };
  }, [editor, getPos, node.nodeSize]);

  const applyColumns = (next: 2 | 3 | 4) => {
    setMenuAt(null);
    const position = getPos();
    if (typeof position !== "number") return;
    if (!setResumeRowColumns(editor, position, next)) return;
    editor.commands.focus();
  };

  const applyWidths = (next: number[] | null) => {
    const position = getPos();
    if (typeof position !== "number") return;
    setResumeRowColumnWidths(editor, position, next);
  };

  const startDividerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    dividerIndex: number,
  ) => {
    if (!editor.isEditable) return;
    const rowWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
    if (!rowWidth) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const base = effectiveWidths;
    let moved = false;

    const move = (moveEvent: PointerEvent) => {
      moved = true;
      const deltaPercent = ((moveEvent.clientX - startX) / rowWidth) * 100;
      applyWidths(resizeResumeRowColumns(base, dividerIndex, deltaPercent));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      // 只是点了一下分隔线时不写入宽度，未调整过的行保持不携带宽度数据。
      if (!moved) applyWidths(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  return (
    <NodeViewWrapper
      // 不要用 `columns-3` 这种名字：它会被 Tailwind 的 columns-{n} 工具类命中，
      // 把整行变成 CSS 多列容器，导致每栏被压窄、文字折成两行。
      className={`resume-layout-row${equalColumns ? ` is-equal equal-columns-${columns}` : ""}${active || menuAt ? " is-active" : ""}`}
      style={equalColumns
        ? {
          "--resume-row-columns": columns,
          ...(columnWidths
            ? { "--resume-row-tracks": resumeRowColumnTracks(columnWidths) }
            : {}),
        } as React.CSSProperties
        : { "--resume-row-left": `${leftWidth}%` } as React.CSSProperties}
      onContextMenu={(event: React.MouseEvent) => {
        if (!editor.isEditable) return;
        event.preventDefault();
        event.stopPropagation();
        setMenuAt({ x: event.clientX, y: event.clientY });
      }}
    >
      <NodeViewContent />
      {equalColumns && editor.isEditable && active && (
        <span className="resume-column-handles" contentEditable={false}>
          {dividerOffsets.map((offset, index) => (
            <button
              type="button"
              className="resume-column-handle"
              key={`divider-${index}`}
              style={{ left: `${offset}%` }}
              aria-label={`调整第 ${index + 1} 栏与第 ${index + 2} 栏的宽度`}
              title="拖动调整两栏宽度，双击恢复等分"
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => startDividerDrag(event, index)}
              onDoubleClick={() => applyWidths(null)}
            />
          ))}
        </span>
      )}
      {menuAt && (
        <ResumeColumnMenu
          position={menuAt}
          columns={columns}
          onSelect={applyColumns}
          onClose={() => setMenuAt(null)}
        />
      )}
    </NodeViewWrapper>
  );
}

export const RESUME_ROW_WIDTH_MIN = 30;
export const RESUME_ROW_WIDTH_MAX = 80;

export function normalizeResumeRowWidth(value: unknown) {
  const width = Number(value);
  if (!Number.isFinite(width)) return 50;
  return Math.min(RESUME_ROW_WIDTH_MAX, Math.max(RESUME_ROW_WIDTH_MIN, Math.round(width)));
}

export const ResumeRow = Node.create({
  name: "resumeRow",
  group: "block",
  // 2 cells keep the adjustable left/right split; 3 and 4 cells are the equal
  // columns the right-click column menu creates.  The column count is the
  // paragraph count, so the two can never drift apart.
  content: "paragraph paragraph paragraph? paragraph?",
  defining: true,
  isolating: true,
  addKeyboardShortcuts() {
    return {
      Enter: () => exitResumeRowToBlankParagraph(this.editor),
    };
  },
  addAttributes: () => ({ leftWidth: { default: 50 }, columnWidths: { default: null } }),
  parseHTML: () => [
    {
      tag: "div[data-type='resume-row']",
      getAttrs: (element) => element instanceof HTMLElement ? { leftWidth: normalizeResumeRowWidth(element.dataset.leftWidth) } : false,
    },
    { tag: "div.resume-row[data-block='pair']" },
  ],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "resume-row", "data-left-width": HTMLAttributes.leftWidth ?? 50 }), 0],
  addNodeView: () => ReactNodeViewRenderer(ResumeRowView),
});

export const ResumeRowExitKeymap = Extension.create({
  name: "resumeRowExitKeymap",
  addKeyboardShortcuts() {
    return {
      Enter: () => exitVisuallyBlankResumeListItem(this.editor),
      Backspace: () => exitVisuallyBlankResumeListItem(this.editor)
        || removeBlankParagraphAfterResumeRow(this.editor)
        || removeVisuallyBlankResumeLine(this.editor),
    };
  },
});

export const ResumeColumn = Node.create({
  name: "resumeColumn",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes: () => ({ variant: { default: "main" } }),
  parseHTML: () => [{
    tag: "section[data-type='resume-column']",
    getAttrs: (element) => element instanceof HTMLElement
      ? { variant: element.dataset.column === "sidebar" ? "sidebar" : "main" }
      : false,
  }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "section",
    mergeAttributes(HTMLAttributes, {
      "data-type": "resume-column",
      "data-column": node.attrs.variant,
      class: `resume-layout-column resume-layout-column-${node.attrs.variant}`,
    }),
    0,
  ],
});

export const ResumeColumns = Node.create({
  name: "resumeColumns",
  group: "block",
  content: "resumeColumn resumeColumn",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "div[data-type='resume-columns']" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "resume-columns", class: "resume-layout-columns" }),
    0,
  ],
});

function fixedRow(name: "resumeMetaRow" | "resumeTrioRow", count: 3 | 4, className: string) {
  return Node.create({
    name,
    group: "block",
    content: Array.from({ length: count }, () => "paragraph").join(" "),
    defining: true,
    isolating: true,
    parseHTML: () => [{ tag: `div[data-type='${className}']` }],
    renderHTML: ({ HTMLAttributes }) => [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": className, class: `resume-layout-${className.replace("resume-", "")}` }),
      0,
    ],
  });
}

export const ResumeMetaRow = fixedRow("resumeMetaRow", 4, "resume-meta-row");
export const ResumeTrioRow = fixedRow("resumeTrioRow", 3, "resume-trio-row");

function InlineIconView({ node }: NodeViewProps) {
  const Icon = inlineIconComponents[node.attrs.name as InlineIconName] ?? Star;
  return <NodeViewWrapper as="span" className="resume-inline-icon"><Icon size="1em" /></NodeViewWrapper>;
}

function InlineImageView({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const width = Math.min(240, Math.max(16, Number(node.attrs.width) || 72));
  const legacyAspectRatio = Math.min(20, Math.max(0.1, Number(node.attrs.aspectRatio) || 3));
  const height = Math.min(240, Math.max(16, Number(node.attrs.height) || width / legacyAspectRatio));
  const [widthDraft, setWidthDraft] = useState(String(width));
  const [heightDraft, setHeightDraft] = useState(String(Math.round(height)));
  useEffect(() => setWidthDraft(String(width)), [width]);
  useEffect(() => setHeightDraft(String(Math.round(height))), [height]);
  const commitSize = (dimension: "width" | "height") => {
    const draft = dimension === "width" ? widthDraft : heightDraft;
    const fallback = dimension === "width" ? width : height;
    const next = Number(draft);
    if (Number.isFinite(next)) updateAttributes({ [dimension]: Math.round(Math.min(240, Math.max(16, next))) });
    else if (dimension === "width") setWidthDraft(String(Math.round(fallback)));
    else setHeightDraft(String(Math.round(fallback)));
  };
  return (
    <NodeViewWrapper
      as="span"
      className={`resume-inline-image${selected ? " is-selected" : ""}`}
      style={{ width, height }}
    >
      {selected && (
        <span className="media-context-toolbar inline-image-toolbar" contentEditable={false}>
          <label className="media-size-field inline-image-size-field" aria-label="行内图片宽度">
            <span>宽</span>
            <input
              type="number"
              name="inline-image-width"
              autoComplete="off"
              inputMode="numeric"
              min="16"
              max="240"
              step="1"
              value={widthDraft}
              onChange={(event) => setWidthDraft(event.target.value)}
              onBlur={() => commitSize("width")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitSize("width");
                  event.currentTarget.blur();
                }
              }}
            />
            <output>px</output>
          </label>
          <label className="media-size-field inline-image-size-field" aria-label="行内图片高度">
            <span>高</span>
            <input
              type="number"
              name="inline-image-height"
              autoComplete="off"
              inputMode="numeric"
              min="16"
              max="240"
              step="1"
              value={heightDraft}
              onChange={(event) => setHeightDraft(event.target.value)}
              onBlur={() => commitSize("height")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitSize("height");
                  event.currentTarget.blur();
                }
              }}
            />
            <output>px</output>
          </label>
          <input
            className="media-alt-field"
            name="inline-image-alt"
            autoComplete="off"
            aria-label="行内图片替代文字"
            value={node.attrs.alt ?? ""}
            placeholder="例如：示例公司 Logo…"
            onChange={(event) => updateAttributes({ alt: event.target.value })}
          />
          <button type="button" aria-label="删除行内图片" onClick={deleteNode}><Trash2 size={14} /></button>
        </span>
      )}
      <img src={node.attrs.src} width={Math.round(width)} height={Math.round(height)} alt={node.attrs.alt || "行内图片"} draggable={false} />
    </NodeViewWrapper>
  );
}

export const InlineImage = Node.create({
  name: "inlineImage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    src: { default: "" },
    width: { default: 72 },
    height: { default: null },
    aspectRatio: { default: 3 },
    alt: { default: "行内图片" },
    nodeId: { default: null },
    sourceRefs: { default: [] },
  }),
  parseHTML: () => [{
    tag: "img[data-inline-image]",
    getAttrs: (element) => element instanceof HTMLElement ? {
      src: element.dataset.src ?? element.getAttribute("src") ?? "",
      width: Number(element.dataset.width) || 72,
      height: Number(element.dataset.height) || null,
      aspectRatio: Number(element.dataset.aspectRatio) || 3,
      alt: element.dataset.alt ?? element.getAttribute("alt") ?? "行内图片",
      nodeId: normalizeResumeBlockId(element.dataset.nodeId),
    } : false,
  }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "img",
    mergeAttributes(HTMLAttributes, {
      "data-inline-image": "",
      "data-src": node.attrs.src,
      "data-width": node.attrs.width,
      "data-height": node.attrs.height,
      "data-aspect-ratio": node.attrs.aspectRatio,
      "data-alt": node.attrs.alt,
      class: "resume-inline-image",
      style: `width:${node.attrs.width}px;height:${node.attrs.height ?? Math.round(node.attrs.width / node.attrs.aspectRatio)}px`,
      src: node.attrs.src,
      alt: node.attrs.alt,
      width: node.attrs.width,
      height: node.attrs.height ?? Math.round(node.attrs.width / node.attrs.aspectRatio),
    }),
  ],
  addNodeView: () => ReactNodeViewRenderer(InlineImageView),
});

export const InlineIcon = Node.create({
  name: "inlineIcon",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ name: { default: "Star" } }),
  parseHTML: () => [{
    tag: "span[data-inline-icon]",
    getAttrs: (element) => element instanceof HTMLElement ? { name: element.dataset.iconName ?? "Star" } : false,
  }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, {
    "data-inline-icon": "",
    "data-icon-name": node.attrs.name,
    class: "resume-inline-icon",
  })],
  addNodeView: () => ReactNodeViewRenderer(InlineIconView),
});

// 分栏单元格常把图片放在行首、紧贴格子边缘。inlineImage、resumeImage、avatarImage、
// inlineIcon 这类可选中的叶子 NodeView 会被 ProseMirror 渲染成 contenteditable=false
// 的孤岛：Chrome 无法在图片上发起拖选，拖选端点落在图片上时又会被吸附到图片远侧边界，
// 结果要么选不中图片，要么被迫从更上方的文字横扫（极易带上无关内容）。
// 这里对指针选区做两个补丁：
// 1. 在可选中叶子节点上按下鼠标时直接接管拖拽，锚点固定在该节点自身边界上；
// 2. 原生拖选焦点落在叶子节点视图内部、而映射出的端点没覆盖该节点时，把端点推到覆盖它的一侧。
type DOMNode = InstanceType<typeof window.Node>;

interface ResumeLeafViewDesc {
  node: PMNode;
  posBefore: number;
  posAfter: number;
  dom: DOMNode;
}

interface ResumePointerViewInternals extends EditorView {
  docView: {
    nearestDesc(dom: DOMNode, onlyNodes?: boolean): ResumeLeafViewDesc | null | undefined;
  } | null;
  input: { lastSelectionOrigin: string | null };
  domSelectionRange(): { focusNode: DOMNode | null };
}

const leafSelectionDescAt = (view: EditorView, dom: DOMNode | null): ResumeLeafViewDesc | null => {
  if (!dom) return null;
  const desc = (view as ResumePointerViewInternals).docView?.nearestDesc(dom, true);
  const node = desc?.node;
  if (!node || !node.isLeaf || !NodeSelection.isSelectable(node)) return null;
  return desc;
};

// `pos` 落在非文本容器边界时，沿 `dir` 找最近的文本位置；本身是文本位置时原样返回。
const inlinePosNear = (doc: PMNode, pos: number, dir: 1 | -1): ResolvedPos | null => {
  const $pos = doc.resolve(pos);
  if ($pos.parent.inlineContent) return $pos;
  return Selection.findFrom($pos, dir, true)?.$head ?? null;
};

// 拖拽端点落在另一个可选中叶子上时，把端点移到恰好覆盖那个叶子的一侧。
const dragHeadAt = (doc: PMNode, pos: { pos: number; inside: number }, dir: 1 | -1, ownFrom: number): ResolvedPos => {
  if (pos.inside > -1 && pos.inside !== ownFrom) {
    const hit = doc.resolve(pos.inside).nodeAfter;
    if (hit && hit.isLeaf && !hit.isText && NodeSelection.isSelectable(hit)) {
      const edge = dir > 0 ? pos.inside + hit.nodeSize : pos.inside;
      const $edge = inlinePosNear(doc, edge, dir);
      if ($edge) return $edge;
    }
  }
  return doc.resolve(pos.pos);
};

export const ResumeAtomPointerSelection = Extension.create({
  name: "resumeAtomPointerSelection",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("resumeAtomPointerSelection"),
        props: {
          createSelectionBetween(view, $anchor, $head) {
            const internals = view as ResumePointerViewInternals;
            if (internals.input?.lastSelectionOrigin !== "pointer") return null;
            const { focusNode } = internals.domSelectionRange();
            const desc = leafSelectionDescAt(view, focusNode);
            if (!desc) return null;
            const from = desc.posBefore;
            const to = desc.posAfter;
            let $nextHead: ResolvedPos | null = null;
            if ($anchor.pos <= from && $head.pos <= from) {
              $nextHead = inlinePosNear(view.state.doc, to, 1);
            } else if ($anchor.pos >= to && $head.pos >= to) {
              $nextHead = inlinePosNear(view.state.doc, from, -1);
            }
            if (!$nextHead || $nextHead.pos === $head.pos) return null;
            return TextSelection.between($anchor, $nextHead);
          },
          handleDOMEvents: {
            mousedown(view, rawEvent) {
              const event = rawEvent as MouseEvent;
              if (!view.editable || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return false;
              if (!(event.target instanceof Element)) return false;
              const desc = leafSelectionDescAt(view, event.target);
              if (!desc) return false;
              // 节点视图内的交互控件（工具条、尺寸柄等）照常走默认行为；
              // 判断范围限定在该节点的 DOM 内，避免命中编辑器根节点的 contenteditable。
              const interactive = event.target.closest("input, textarea, select, button, a, [contenteditable='true'], .media-resize-handle, .media-context-toolbar, .avatar-replace-action, .avatar-scale-hint");
              if (interactive && desc.dom.contains(interactive)) return false;
              event.preventDefault();
              if (!view.hasFocus()) view.focus();
              const win = view.dom.ownerDocument.defaultView;
              if (!win) return false;
              const atom = desc.node;
              const atomFrom = desc.posBefore;
              const atomTo = desc.posAfter;
              const setSelection = (selection: Selection) => {
                if (selection.eq(view.state.selection)) return;
                view.dispatch(view.state.tr.setSelection(selection).setMeta("pointer", true));
              };
              let disposed = false;
              const dispose = () => {
                if (disposed) return;
                disposed = true;
                win.removeEventListener("mousemove", onMove);
                win.removeEventListener("mouseup", dispose);
                win.removeEventListener("pointercancel", dispose);
              };
              const onMove = (rawMove: Event) => {
                const move = rawMove as MouseEvent;
                if (view.isDestroyed || !(move.buttons & 1)) return dispose();
                const pos = view.posAtCoords({ left: move.clientX, top: move.clientY });
                if (!pos) return;
                const doc = view.state.doc;
                if (pos.inside === atomFrom) {
                  setSelection(NodeSelection.create(doc, atomFrom));
                  return;
                }
                // 块级原子的 TextSelection 端点只能落在邻近文本块里，向上归一化会带上
                // 无关内容；拖拽块级原子只保留 NodeSelection。
                if (!atom.isInline) return;
                const forward = pos.pos >= atomTo;
                const $anchor = doc.resolve(forward ? atomFrom : atomTo);
                const $head = dragHeadAt(doc, pos, forward ? 1 : -1, atomFrom);
                let selection: Selection = TextSelection.between($anchor, $head);
                if (selection instanceof TextSelection && selection.from === atomFrom && selection.to === atomTo) {
                  selection = NodeSelection.create(doc, atomFrom);
                }
                setSelection(selection);
              };
              setSelection(NodeSelection.create(view.state.doc, atomFrom));
              win.addEventListener("mousemove", onMove);
              win.addEventListener("mouseup", dispose);
              win.addEventListener("pointercancel", dispose);
              return true;
            },
          },
        },
      }),
    ];
  },
});

export const FontSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (element) => element.style.fontSize || null,
        renderHTML: (attributes) => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
      },
    };
  },
});

export const resumeEditorExtensions: Extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  ResumeBlockAnchor,
  ResumeBlockIdentity,
  ResumeBulletListInputRules,
  Underline,
  FontSize,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    shouldAutoLink: shouldAutoLinkResumeValue,
    isAllowedUri: (value, { defaultValidate }) => (
      defaultValidate(value) && !isResumeEmailLink(value)
    ),
    HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
  }),
  Placeholder.configure({ placeholder: "直接输入你的简历内容…" }),
  AvatarImage,
  ResumeImage,
  ResumeRow,
  ResumeRowExitKeymap,
  ResumeColumn,
  ResumeColumns,
  ResumeMetaRow,
  ResumeTrioRow,
  InlineImage,
  InlineIcon,
  ResumeAtomPointerSelection,
];
