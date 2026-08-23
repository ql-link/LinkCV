import { mergeAttributes, Node, type Extensions } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Award,
  Briefcase,
  Calendar,
  Code2,
  GitFork,
  Globe,
  GraduationCap,
  ContactRound,
  Mail,
  MapPin,
  Maximize2,
  Phone,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { resumeInlineIconOptions, type InlineIconName } from "../../lib/resumeInlineIcon";
import { useResumeStore } from "../../store/resumeStore";
import { exitResumeRowToBlankParagraph } from "./editorCommands";

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

function uploadImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("图片不能超过 8MB"));
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
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isAvatar = node.type.name === "avatarImage";
  const size = isAvatar ? Number(node.attrs.size) : Number(node.attrs.width);
  const widthUnit = isAvatar ? "px" : node.attrs.widthUnit === "px" ? "px" : "%";
  const align = node.attrs.align as string | undefined;
  const [widthDraft, setWidthDraft] = useState(String(size));
  const [error, setError] = useState("");

  useEffect(() => setWidthDraft(String(size)), [size]);

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
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
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
      if (isAvatar) updateAttributes({ size: Math.round(Math.min(220, Math.max(56, nextPx))) });
      else if (widthUnit === "px") applyBodyWidth(nextPx, "px");
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
      as={isAvatar ? "figure" : "div"}
      className={`resume-media-node ${isAvatar ? "resume-avatar" : `resume-image align-${align}`}${selected ? " is-selected" : ""}`}
      style={isAvatar ? { width: size, height: size } : { width: `${size}${widthUnit}` }}
      data-drag-handle
    >
      {selected && (
        <div className="media-context-toolbar" contentEditable={false}>
          {!isAvatar ? (
            <>
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
            </>
          ) : (
            <label className="media-size-field avatar-size-field" aria-label="头像尺寸">
              <input
                type="number"
                min="56"
                max="220"
                step="1"
                value={widthDraft}
                onChange={(event) => setWidthDraft(event.target.value)}
                onBlur={() => {
                  const nextValue = Number(widthDraft);
                  if (Number.isFinite(nextValue)) updateAttributes({ size: Math.round(Math.min(220, Math.max(56, nextValue))) });
                  else setWidthDraft(String(size));
                }}
              />
              <output>px</output>
            </label>
          )}
          <input
            className="media-alt-field"
            aria-label={isAvatar ? "头像替代文字" : "图片替代文字"}
            value={node.attrs.alt ?? ""}
            placeholder="替代文字"
            onChange={(event) => updateAttributes({ alt: event.target.value })}
          />
          {error && <em className="media-error" role="alert">{error}</em>}
          <button aria-label="更换图片" onClick={() => void replace()}><Upload size={14} /></button>
          {!isAvatar && <button aria-label="删除图片" onClick={deleteNode}><Trash2 size={14} /></button>}
        </div>
      )}
      <img ref={imageRef} src={node.attrs.src} alt={node.attrs.alt || (isAvatar ? "简历头像" : "简历图片")} draggable={false} />
      {selected && <button className="media-resize-handle" contentEditable={false} aria-label="拖拽调整图片尺寸" onPointerDown={startResize} />}
    </NodeViewWrapper>
  );
}

export const AvatarImage = Node.create({
  name: "avatarImage",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ src: { default: "" }, size: { default: 96 }, alt: { default: "简历头像" } }),
  parseHTML: () => [{
    tag: "figure[data-type='avatar-image']",
    getAttrs: (element) => element instanceof HTMLElement ? {
      src: element.dataset.src ?? "",
      size: Number(element.dataset.size) || 96,
      alt: element.dataset.alt ?? "简历头像",
    } : false,
  }],
  renderHTML: ({ HTMLAttributes }) => ["figure", mergeAttributes(HTMLAttributes, { "data-type": "avatar-image" })],
  addNodeView: () => ReactNodeViewRenderer(MediaNodeView),
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

function ResumeRowView({ node, editor, getPos }: NodeViewProps) {
  const [active, setActive] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const draggingPointer = useRef<number | null>(null);
  const leftWidth = normalizeResumeRowWidth(dragWidth ?? node.attrs.leftWidth);

  const updateWidthFromClientX = (clientX: number, element: HTMLElement) => {
    const row = element.closest<HTMLElement>(".resume-layout-row");
    if (!row) return leftWidth;
    const bounds = row.getBoundingClientRect();
    const next = resumeRowWidthFromClientX(clientX, bounds.left, bounds.width);
    setDragWidth(next);
    return next;
  };

  const commitWidth = (width: number) => {
    const position = getPos();
    if (typeof position === "number") {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, leftWidth: width }));
    }
    setDragWidth(null);
  };

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

  return (
    <NodeViewWrapper
      className={`resume-layout-row${active ? " is-active" : ""}`}
      style={{ "--resume-row-left": `${leftWidth}%` } as React.CSSProperties}
    >
      <NodeViewContent />
      {editor.isEditable && <button
        type="button"
        role="separator"
        aria-label="调整左右分栏比例"
        aria-orientation="vertical"
        aria-valuemin={RESUME_ROW_WIDTH_MIN}
        aria-valuemax={RESUME_ROW_WIDTH_MAX}
        aria-valuenow={leftWidth}
        aria-valuetext={`左栏 ${leftWidth}%，右栏 ${100 - leftWidth}%`}
        className="resume-row-divider"
        contentEditable={false}
        data-dragging={dragWidth !== null}
        title="拖动调整左右分栏比例；双击恢复各 50%"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          draggingPointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateWidthFromClientX(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (draggingPointer.current !== event.pointerId) return;
          updateWidthFromClientX(event.clientX, event.currentTarget);
        }}
        onPointerUp={(event) => {
          if (draggingPointer.current !== event.pointerId) return;
          const next = updateWidthFromClientX(event.clientX, event.currentTarget);
          draggingPointer.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          commitWidth(next);
        }}
        onPointerCancel={() => {
          draggingPointer.current = null;
          setDragWidth(null);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          commitWidth(50);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 5 : 1;
          let next = leftWidth;
          if (event.key === "ArrowLeft") next = normalizeResumeRowWidth(leftWidth - step);
          else if (event.key === "ArrowRight") next = normalizeResumeRowWidth(leftWidth + step);
          else if (event.key === "Home") next = RESUME_ROW_WIDTH_MIN;
          else if (event.key === "End") next = RESUME_ROW_WIDTH_MAX;
          else return;
          event.preventDefault();
          commitWidth(next);
        }}
      >
        <span className="resume-row-divider-value" aria-hidden="true">{leftWidth}%</span>
      </button>}
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

export function resumeRowWidthFromClientX(clientX: number, rowLeft: number, rowWidth: number) {
  if (!Number.isFinite(rowWidth) || rowWidth <= 0) return 50;
  return normalizeResumeRowWidth(((clientX - rowLeft) / rowWidth) * 100);
}

export const ResumeRow = Node.create({
  name: "resumeRow",
  group: "block",
  content: "paragraph paragraph",
  defining: true,
  isolating: true,
  addKeyboardShortcuts() {
    return {
      Enter: () => exitResumeRowToBlankParagraph(this.editor),
    };
  },
  addAttributes: () => ({ leftWidth: { default: 50 } }),
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
  }),
  parseHTML: () => [{
    tag: "img[data-inline-image]",
    getAttrs: (element) => element instanceof HTMLElement ? {
      src: element.dataset.src ?? element.getAttribute("src") ?? "",
      width: Number(element.dataset.width) || 72,
      height: Number(element.dataset.height) || null,
      aspectRatio: Number(element.dataset.aspectRatio) || 3,
      alt: element.dataset.alt ?? element.getAttribute("alt") ?? "行内图片",
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
  Underline,
  FontSize,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
  Placeholder.configure({ placeholder: "直接输入你的简历内容…" }),
  AvatarImage,
  ResumeImage,
  ResumeRow,
  ResumeColumn,
  ResumeColumns,
  ResumeMetaRow,
  ResumeTrioRow,
  InlineImage,
  InlineIcon,
];
