import MarkdownIt from "markdown-it";

type Block =
  | { type: "markdown"; content: string }
  | { type: "side"; align: "left" | "right"; content: string };

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: false,
});

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
    const start = line.match(/^:::\s*(left|right)\s*$/);

    if (!start) {
      buffer.push(line);
      continue;
    }

    flushMarkdown();

    const align = start[1] as "left" | "right";
    const content: string[] = [];
    index += 1;

    while (index < lines.length && !/^:::\s*$/.test(lines[index])) {
      content.push(lines[index]);
      index += 1;
    }

    blocks.push({ type: "side", align, content: content.join("\n").trim() });
  }

  flushMarkdown();
  return blocks;
}

function renderSideContent(content: string) {
  return rewriteHtmlImageSources(md.renderInline(content));
}

function renderPair(left: string, right: string) {
  return `<div class="resume-row" data-block="pair"><div class="resume-row-left">${renderSideContent(
    left,
  )}</div><div class="resume-row-right">${renderSideContent(right)}</div></div>`;
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
      html.push(renderPair(left, right));
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
