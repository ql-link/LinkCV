import type { JSONContent } from "@tiptap/core";
import { isInlineIconName } from "../../../lib/resumeInlineIcon";
import { renderInlineIcon } from "../../../parser/resumeMarkdown";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value) ? value : null;
}

function safeFontSize(value: unknown) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?pt$/u.test(value)) return null;
  const points = Number(value.slice(0, -2));
  return Number.isFinite(points) && points >= 6 && points <= 48 ? value : null;
}

function safeAsset(value: unknown) {
  return typeof value === "string"
    && /^(?:https?:\/\/|\/api\/assets\/|\/api\/resumes\/|\/templates\/)/iu.test(value)
    ? value
    : "";
}

function markedText(node: JSONContent) {
  let value = escapeHtml(node.text ?? "");
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") value = `<strong>${value}</strong>`;
    else if (mark.type === "italic") value = `<em>${value}</em>`;
    else if (mark.type === "underline") value = `<u>${value}</u>`;
    else if (mark.type === "strike") value = `<s>${value}</s>`;
    else if (mark.type === "code") value = `<code>${value}</code>`;
    else if (mark.type === "link") {
      const href = typeof mark.attrs?.href === "string" && /^https?:\/\//iu.test(mark.attrs.href)
        ? mark.attrs.href
        : null;
      if (href) value = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${value}</a>`;
    } else if (mark.type === "textStyle") {
      const styles = [
        safeColor(mark.attrs?.color) ? `color:${safeColor(mark.attrs?.color)}` : "",
        safeFontSize(mark.attrs?.fontSize) ? `font-size:${safeFontSize(mark.attrs?.fontSize)}` : "",
      ].filter(Boolean).join(";");
      if (styles) value = `<span style="${styles}">${value}</span>`;
    } else if (mark.type === "highlight") {
      const color = safeColor(mark.attrs?.color);
      if (color) value = `<mark data-color="${color}" style="background-color:${color};color:inherit">${value}</mark>`;
    }
  }
  return value;
}

function inlineContent(node: JSONContent): string {
  if (node.type === "text") return markedText(node);
  if (node.type === "hardBreak") return "<br>";
  if (node.type === "resumeBlockAnchor") {
    const blockId = typeof node.attrs?.blockId === "string" && /^blk_[a-z0-9]{16,64}$/u.test(node.attrs.blockId)
      ? node.attrs.blockId
      : "";
    if (!blockId) return "";
    const semanticKind = typeof node.attrs?.semanticKind === "string"
      ? ` data-resume-semantic-kind="${escapeHtml(node.attrs.semanticKind)}"`
      : "";
    return `<span data-resume-block-id="${blockId}"${semanticKind} aria-hidden="true" class="resume-block-anchor"></span>`;
  }
  if (node.type === "inlineIcon" && isInlineIconName(node.attrs?.name)) {
    return renderInlineIcon(node.attrs.name);
  }
  if (node.type === "inlineImage") {
    const src = safeAsset(node.attrs?.src);
    if (!src) return "";
    const width = Math.min(240, Math.max(16, Number(node.attrs?.width) || 72));
    const height = Math.min(240, Math.max(16, Number(node.attrs?.height) || 24));
    const alt = escapeHtml(String(node.attrs?.alt ?? "行内图片"));
    return `<img data-inline-image data-src="${escapeHtml(src)}" data-width="${width}" data-height="${height}" data-alt="${alt}" class="resume-inline-image" style="width:${width}px;height:${height}px" src="${escapeHtml(src)}" width="${width}" height="${height}" alt="${alt}">`;
  }
  return (node.content ?? []).map(inlineContent).join("");
}

function textAlignment(node: JSONContent) {
  const alignment = node.attrs?.textAlign;
  return alignment === "left" || alignment === "center" || alignment === "right"
    ? ` style="text-align:${alignment}"`
    : "";
}

function childBlocks(node: JSONContent) {
  return (node.content ?? []).map(renderResumeEditorNode).join("");
}

export function renderResumeEditorNode(node: JSONContent): string {
  if (node.type === "doc") return childBlocks(node);
  if (node.type === "text" || node.type === "hardBreak" || node.type === "resumeBlockAnchor" || node.type === "inlineIcon" || node.type === "inlineImage") {
    return inlineContent(node);
  }
  if (node.type === "paragraph") return `<p${textAlignment(node)}>${inlineContent(node)}</p>`;
  if (node.type === "heading") {
    const level = [1, 2, 3].includes(Number(node.attrs?.level)) ? Number(node.attrs?.level) : 2;
    return `<h${level}${textAlignment(node)}>${inlineContent(node)}</h${level}>`;
  }
  if (node.type === "bulletList") return `<ul>${childBlocks(node)}</ul>`;
  if (node.type === "orderedList") {
    const start = Math.max(1, Math.round(Number(node.attrs?.start) || 1));
    return `<ol${start === 1 ? "" : ` start="${start}"`}>${childBlocks(node)}</ol>`;
  }
  if (node.type === "listItem") return `<li>${childBlocks(node)}</li>`;
  if (node.type === "blockquote") return `<blockquote>${childBlocks(node)}</blockquote>`;
  if (node.type === "codeBlock") {
    const language = typeof node.attrs?.language === "string" ? ` class="language-${escapeHtml(node.attrs.language)}"` : "";
    return `<pre><code${language}>${escapeHtml((node.content ?? []).map((child) => child.text ?? "").join(""))}</code></pre>`;
  }
  if (node.type === "horizontalRule") return "<hr>";
  if (node.type === "resumeRow") {
    const [left, right] = node.content ?? [];
    const leftWidth = Math.min(80, Math.max(30, Number(node.attrs?.leftWidth) || 50));
    return `<div class="resume-row" data-type="resume-row" data-block="pair" data-left-width="${leftWidth}" style="--resume-row-left:${leftWidth}%"><p class="resume-row-left">${left ? inlineContent(left) : ""}</p><p class="resume-row-right">${right ? inlineContent(right) : ""}</p></div>`;
  }
  if (node.type === "resumeColumns") {
    const columns = node.content ?? [];
    const sidebar = columns.find((column) => column.attrs?.variant === "sidebar") ?? columns[0];
    const main = columns.find((column) => column.attrs?.variant === "main") ?? columns[1];
    return `<div class="resume-columns" data-type="resume-columns"><section class="resume-column resume-column-sidebar" data-type="resume-column" data-column="sidebar">${sidebar ? childBlocks(sidebar) : ""}</section><section class="resume-column resume-column-main" data-type="resume-column" data-column="main">${main ? childBlocks(main) : ""}</section></div>`;
  }
  if (node.type === "resumeColumn") return childBlocks(node);
  if (node.type === "resumeMetaRow" || node.type === "resumeTrioRow") {
    const meta = node.type === "resumeMetaRow";
    const className = meta ? "resume-meta-row" : "resume-trio-row";
    const itemName = meta ? "meta" : "trio";
    return `<div class="${className}" data-type="${className}">${(node.content ?? []).map(
      (child) => `<p data-${itemName}-cell>${inlineContent(child)}</p>`,
    ).join("")}</div>`;
  }
  if (node.type === "avatarImage") {
    const src = safeAsset(node.attrs?.src);
    if (!src) return "";
    const size = Math.min(220, Math.max(56, Number(node.attrs?.size) || 96));
    const alt = escapeHtml(String(node.attrs?.alt ?? "简历头像"));
    return `<figure data-type="avatar-image" data-src="${escapeHtml(src)}" data-size="${size}" data-alt="${alt}"${node.attrs?.systemFallback === true ? ' data-system-fallback="true"' : ""} class="resume-media-node resume-avatar" style="width:${size}px;height:${size}px"><img src="${escapeHtml(src)}" alt="${alt}"></figure>`;
  }
  if (node.type === "resumeImage") {
    const src = safeAsset(node.attrs?.src);
    if (!src) return "";
    const widthUnit = node.attrs?.widthUnit === "px" ? "px" : "%";
    const width = Math.min(widthUnit === "%" ? 100 : 794, Math.max(0.1, Number(node.attrs?.width) || 55));
    const align = ["left", "center", "right", "full"].includes(String(node.attrs?.align)) ? String(node.attrs?.align) : "center";
    const alt = escapeHtml(String(node.attrs?.alt ?? "简历图片"));
    return `<div data-type="resume-image" data-src="${escapeHtml(src)}" data-width="${width}" data-width-unit="${widthUnit}" data-align="${align}" data-alt="${alt}" class="resume-media-node resume-image align-${align}" style="width:${width}${widthUnit}"><img src="${escapeHtml(src)}" alt="${alt}"></div>`;
  }
  return "";
}

export function renderResumeEditorDocument(document: JSONContent) {
  return document.type === "doc" ? childBlocks(document) : "";
}
