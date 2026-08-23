import MarkdownIt from "markdown-it";
import {
  INLINE_FONT_SIZE_CLOSE_MARKER,
  normalizeInlineFontSize,
} from "../lib/resumeInlineStyle";
import { isInlineIconName } from "../lib/resumeInlineIcon";

type Block =
  | { type: "markdown"; content: string }
  | { type: "side"; align: "left" | "right"; content: string; leftWidth?: number }
  | { type: "text-align"; align: "left" | "center" | "right"; content: string }
  | { type: "wide"; kind: "sidebar" | "main" | "meta" | "trio"; content: string };

const inlineIconNames = new Set([
  "Mail",
  "Phone",
  "MapPin",
  "Globe",
  "Github",
  "Linkedin",
  "GraduationCap",
  "Briefcase",
  "Award",
  "Star",
  "Calendar",
  "Code2",
]);

const inlineIconShapes: Record<string, string> = {
  Mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 6L2 7"/>',
  Phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92Z"/>',
  MapPin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  Globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  Github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.8a13.4 13.4 0 0 0-7 0C4.8.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 8 18v4"/>',
  Linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6ZM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/>',
  GraduationCap: '<path d="m2 10 10-5 10 5-10 5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5M22 10v6"/>',
  Briefcase: '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2 12h20M12 12v3"/>',
  Award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>',
  Star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1Z"/>',
  Calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  Code2: '<path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16"/>',
};

function renderInlineIcon(name: string) {
  const shape = inlineIconShapes[name] ?? inlineIconShapes.Star;
  return `<span data-inline-icon data-icon-name="${escapeAttribute(name)}" class="resume-inline-icon"><svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shape}</svg></span>`;
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

type InlineRule = Parameters<typeof md.inline.ruler.before>[2];
const inlineFontSizeRule: InlineRule = (state, silent) => {
  const source = state.src.slice(state.pos);
  const opening = source.match(/^\[\[linkcv-size:(\d+(?:\.\d+)?)pt\]\]/);
  if (opening) {
    const points = normalizeInlineFontSize(opening[1]);
    if (points == null || !source.slice(opening[0].length).includes(INLINE_FONT_SIZE_CLOSE_MARKER)) return false;
    if (!silent) {
      const token = state.push("linkcv_font_size_open", "span", 1);
      token.attrSet("style", `font-size:${points}pt`);
    }
    state.pos += opening[0].length;
    return true;
  }
  if (!source.startsWith(INLINE_FONT_SIZE_CLOSE_MARKER)) return false;
  if (!silent) state.push("linkcv_font_size_close", "span", -1);
  state.pos += INLINE_FONT_SIZE_CLOSE_MARKER.length;
  return true;
};

md.inline.ruler.before("emphasis", "linkcv_font_size", inlineFontSizeRule);

const inlineIconRule: InlineRule = (state, silent) => {
  const match = state.src.slice(state.pos).match(/^\[\[linkcv-icon:([A-Za-z0-9]+)\]\]/);
  const name = match?.[1];
  if (!match || !isInlineIconName(name)) return false;
  if (!silent) {
    const token = state.push("linkcv_inline_icon", "span", 0);
    token.meta = { name };
  }
  state.pos += match[0].length;
  return true;
};

md.inline.ruler.before("emphasis", "linkcv_inline_icon", inlineIconRule);
md.renderer.rules.linkcv_inline_icon = (tokens, index) => `<span data-inline-icon data-icon-name="${tokens[index].meta.name}" class="resume-inline-icon"></span>`;

const defaultImageRenderer = md.renderer.rules.image;
const defaultLinkOpenRenderer = md.renderer.rules.link_open;

function isDomainLikeHref(href: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:[/:?#].*)?$/i.test(
    href,
  );
}

function normalizeLinkHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed) return href;

  try {
    const parsedUrl = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    const csdnSubdomainMatch = parsedUrl.hostname.match(/^([a-z0-9-]+)\.blog\.csdn\.net$/i);

    if (csdnSubdomainMatch) {
      const userName = csdnSubdomainMatch[1];
      const path = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname;
      return `https://blog.csdn.net/${userName}${path}${parsedUrl.search}${parsedUrl.hash}`;
    }
  } catch {
    // Fall through to the generic normalization rules below.
  }

  if (
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return href;
  }

  return isDomainLikeHref(trimmed) ? `https://${trimmed}` : href;
}

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const hrefIndex = token.attrIndex("href");

  if (hrefIndex >= 0) {
    const href = token.attrs?.[hrefIndex]?.[1];
    if (href) token.attrs![hrefIndex][1] = normalizeLinkHref(href);
  }

  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");

  return defaultLinkOpenRenderer
    ? defaultLinkOpenRenderer(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const srcIndex = token.attrIndex("src");

  if (srcIndex >= 0) {
    const src = token.attrs?.[srcIndex]?.[1];
    if (src) {
      const normalized = normalizeAssetSrc(src);
      token.attrs![srcIndex][1] = normalized;

      if (normalized !== src && normalized.startsWith("/__local_asset__")) {
        token.attrSet("data-local-asset", "true");
        if (token.content) token.attrSet("data-original-alt", token.content);
        token.content = "";
      }
    }
  }

  const src = srcIndex >= 0 ? token.attrs?.[srcIndex]?.[1] ?? "" : "";
  const title = token.attrGet("title") ?? "";
  const alt = escapeAttribute(token.content || "简历图片");
  const escapedSrc = escapeAttribute(src);
  const inlineImageV2 = title.match(/^linkcv-inline-image-v2:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (inlineImageV2) {
    const width = Math.min(240, Math.max(16, Number(inlineImageV2[1]) || 72));
    const height = Math.min(240, Math.max(16, Number(inlineImageV2[2]) || 24));
    return `<img data-inline-image data-src="${escapedSrc}" data-width="${width}" data-height="${height}" data-alt="${alt}" class="resume-inline-image" style="width:${width}px;height:${height}px" src="${escapedSrc}" width="${width}" height="${height}" alt="${alt}">`;
  }
  const legacyInlineImage = title.match(/^linkcv-inline-image:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (legacyInlineImage) {
    const width = Math.min(240, Math.max(16, Number(legacyInlineImage[1]) || 72));
    const aspectRatio = Math.min(20, Math.max(0.1, Number(legacyInlineImage[2]) || 3));
    const height = Math.min(240, Math.max(16, width / aspectRatio));
    return `<img data-inline-image data-src="${escapedSrc}" data-width="${width}" data-height="${Number(height.toFixed(2))}" data-aspect-ratio="${aspectRatio}" data-alt="${alt}" class="resume-inline-image" style="width:${width}px;height:${Number(height.toFixed(2))}px" src="${escapedSrc}" width="${width}" height="${Number(height.toFixed(2))}" alt="${alt}">`;
  }
  const avatar = title.match(/^linkcv-avatar:(\d+)$/);
  if (avatar) {
    const size = Math.min(220, Math.max(56, Number(avatar[1]) || 96));
    return `<figure data-type="avatar-image" data-src="${escapedSrc}" data-size="${size}" data-alt="${alt}" class="resume-media-node resume-avatar" style="width:${size}px;height:${size}px"><img src="${escapedSrc}" alt="${alt}"></figure>`;
  }
  const bodyImage = title.match(/^linkcv-image:(\d+(?:\.\d+)?):(%|px):(left|center|right|full)$/);
  if (bodyImage) {
    const widthUnit = bodyImage[2];
    const maximum = widthUnit === "%" ? 100 : 794;
    const width = Math.min(maximum, Math.max(0.1, Number(bodyImage[1]) || 55));
    const align = bodyImage[3];
    return `<div data-type="resume-image" data-src="${escapedSrc}" data-width="${width}" data-width-unit="${widthUnit}" data-align="${align}" data-alt="${alt}" class="resume-media-node resume-image align-${align}" style="width:${width}${widthUnit}"><img src="${escapedSrc}" alt="${alt}"></div>`;
  }

  return defaultImageRenderer
    ? defaultImageRenderer(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

function escapeAttribute(value: string) {
  return value.replace(/"/g, "&quot;");
}

function isLocalAbsolutePath(src: string) {
  return (
    src.startsWith("/Users/") ||
    src.startsWith("/Volumes/") ||
    src.startsWith("/private/") ||
    src.startsWith("/tmp/")
  );
}

function normalizeAssetSrc(src: string) {
  const trimmed = src.trim();
  if (
    !trimmed ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("/__local_asset__")
  ) {
    return src;
  }

  if (isLocalAbsolutePath(trimmed)) {
    return `/__local_asset__?path=${encodeURIComponent(trimmed)}`;
  }

  return src;
}

function rewriteAttribute(tag: string, name: string, value: string) {
  const attributePattern = new RegExp(`\\s${name}\\s*=\\s*(["']).*?\\1`, "i");
  const escapedValue = value.replace(/"/g, "&quot;");

  if (attributePattern.test(tag)) {
    return tag.replace(attributePattern, ` ${name}="${escapedValue}"`);
  }

  return tag.replace(/\s*\/?>$/, (ending) =>
    ending.includes("/") ? ` ${name}="${escapedValue}" />` : ` ${name}="${escapedValue}">`,
  );
}

function removeAttribute(tag: string, name: string) {
  const attributePattern = new RegExp(`\\s${name}\\s*=\\s*(["']).*?\\1`, "i");
  return tag.replace(attributePattern, "");
}

function rewriteHtmlImageSources(html: string) {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    if (!srcMatch) return tag;

    const originalSrc = srcMatch[2];
    const normalizedSrc = normalizeAssetSrc(originalSrc);
    let nextTag = rewriteAttribute(tag, "src", normalizedSrc);

    if (normalizedSrc !== originalSrc && normalizedSrc.startsWith("/__local_asset__")) {
      const altMatch = nextTag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      const originalAlt = altMatch?.[2] ?? "";

      nextTag = rewriteAttribute(nextTag, "data-local-asset", "true");
      if (originalAlt) {
        nextTag = rewriteAttribute(nextTag, "data-original-alt", originalAlt);
      }
      nextTag = removeAttribute(nextTag, "alt");
      nextTag = rewriteAttribute(nextTag, "alt", "");
    }

    return nextTag;
  });
}

function tokenizeCustomBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];

  const flushMarkdown = () => {
    if (buffer.length === 0) return;
    const content = buffer.join("\n").trim();
    if (content) blocks.push({ type: "markdown", content });
    buffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const wideStart = line.match(/^::::\s*(sidebar|main|meta|trio)\s*$/);
    const start = line.match(/^:::\s*(left|right)(?:\s+(\d+(?:\.\d+)?))?\s*$/);
    const textAlignStart = line.match(/^:::\s*text-align\s+(left|center|right)\s*$/);

    if (!wideStart && !start && !textAlignStart) {
      buffer.push(line);
      continue;
    }

    flushMarkdown();

    if (wideStart) {
      const kind = wideStart[1] as "sidebar" | "main" | "meta" | "trio";
      const content: string[] = [];
      index += 1;

      while (index < lines.length && !/^::::\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }

      blocks.push({ type: "wide", kind, content: content.join("\n").trim() });
      continue;
    }

    if (textAlignStart) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !/^:::\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      blocks.push({
        type: "text-align",
        align: textAlignStart[1] as "left" | "center" | "right",
        content: content.join("\n").trim(),
      });
      continue;
    }

    if (!start) continue;

    const align = start[1] as "left" | "right";
    const parsedLeftWidth = Number(start[2]);
    const leftWidth = align === "left" && Number.isFinite(parsedLeftWidth)
      ? Math.min(80, Math.max(30, parsedLeftWidth))
      : undefined;
    const content: string[] = [];
    index += 1;

    while (index < lines.length && !/^:::\s*$/.test(lines[index])) {
      content.push(lines[index]);
      index += 1;
    }

    blocks.push({ type: "side", align, content: content.join("\n").trim(), leftWidth });
  }

  flushMarkdown();
  return blocks;
}

function renderMarkdownContent(content: string, inline = false) {
  const icons: string[] = [];
  const tokenized = content.replace(/:icon\[([A-Za-z0-9]+)\]:/g, (source, name: string) => {
    if (!inlineIconNames.has(name)) return source;
    const token = `LINKCVICONPLACEHOLDER${icons.length}Z`;
    icons.push(name);
    return token;
  });
  let html = inline ? md.renderInline(tokenized) : md.render(tokenized);
  icons.forEach((name, index) => {
    html = html.split(`LINKCVICONPLACEHOLDER${index}Z`).join(
      renderInlineIcon(name),
    );
  });
  return rewriteHtmlImageSources(html);
}

function renderSideContent(content: string) {
  return renderMarkdownContent(content, true);
}

function renderTextAlignedContent(content: string, align: "left" | "center" | "right") {
  const rendered = renderMarkdownContent(content);
  return rendered.replace(/^<(p|h[1-3])\b[^>]*>/, (tag) => rewriteAttribute(tag, "style", `text-align:${align}`));
}

function renderPair(left: string, right: string, leftWidth = 70) {
  return `<div class="resume-row" data-type="resume-row" data-block="pair" data-left-width="${leftWidth}"><p class="resume-row-left">${renderSideContent(
    left,
  )}</p><p class="resume-row-right">${renderSideContent(right)}</p></div>`;
}

export function renderResumeMarkdown(source: string) {
  const blocks = tokenizeCustomBlocks(source);
  const html: string[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (block.type === "markdown") {
      html.push(renderMarkdownContent(block.content));
      continue;
    }

    if (block.type === "text-align") {
      html.push(renderTextAlignedContent(block.content, block.align));
      continue;
    }

    if (block.type === "wide") {
      const next = blocks[index + 1];
      if (
        (block.kind === "sidebar" || block.kind === "main") &&
        next?.type === "wide" &&
        (next.kind === "sidebar" || next.kind === "main") &&
        next.kind !== block.kind
      ) {
        const sidebar = block.kind === "sidebar" ? block : next;
        const main = block.kind === "main" ? block : next;
        html.push(
          `<div class="resume-columns" data-type="resume-columns"><section class="resume-column resume-column-sidebar" data-type="resume-column" data-column="sidebar">${renderResumeMarkdown(sidebar.content)}</section><section class="resume-column resume-column-main" data-type="resume-column" data-column="main">${renderResumeMarkdown(main.content)}</section></div>`,
        );
        index += 1;
        continue;
      }

      if (block.kind === "meta" || block.kind === "trio") {
        const expected = block.kind === "meta" ? 4 : 3;
        const lines = block.content.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines.length === expected) {
          const className = block.kind === "meta" ? "resume-meta-row" : "resume-trio-row";
          const itemName = block.kind === "meta" ? "meta" : "trio";
          html.push(
            `<div class="${className}" data-type="${className}">${lines
              .map((line) => `<p data-${itemName}-cell>${renderSideContent(line)}</p>`)
              .join("")}</div>`,
          );
          continue;
        }
      }

      html.push(renderMarkdownContent(`:::: ${block.kind}\n${block.content}\n::::`));
      continue;
    }

    const next = blocks[index + 1];
    if (next?.type === "side" && next.align !== block.align) {
      const left = block.align === "left" ? block.content : next.content;
      const right = block.align === "right" ? block.content : next.content;
      const leftWidth = block.align === "left" ? block.leftWidth : next.leftWidth;
      html.push(renderPair(left, right, leftWidth));
      index += 1;
      continue;
    }

    html.push(
      `<div class="resume-row single ${escapeAttribute(
        block.align,
      )}" data-block="${escapeAttribute(block.align)}">${renderSideContent(
        block.content,
      )}</div>`,
    );
  }

  return html.join("\n");
}
