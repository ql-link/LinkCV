import MarkdownIt from "markdown-it";
import {
  INLINE_FONT_SIZE_CLOSE_MARKER,
  normalizeInlineFontSize,
} from "../lib/resumeInlineStyle";
import { isInlineIconName } from "../lib/resumeInlineIcon";

type Block =
  | { type: "markdown"; content: string }
  | { type: "side"; align: "left" | "right"; content: string; leftWidth?: number };

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
md.renderer.rules.linkcv_inline_icon = (tokens, index) => `<span data-inline-icon="${tokens[index].meta.name}"></span>`;

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
    const start = line.match(/^:::\s*(left|right)(?:\s+(\d+(?:\.\d+)?))?\s*$/);

    if (!start) {
      buffer.push(line);
      continue;
    }

    flushMarkdown();

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

function renderSideContent(content: string) {
  return rewriteHtmlImageSources(md.renderInline(content));
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
      html.push(rewriteHtmlImageSources(md.render(block.content)));
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
