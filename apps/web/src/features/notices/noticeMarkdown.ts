import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, index, options);
};

markdown.renderer.rules.image = (tokens, index) => {
  const alt = markdown.utils.escapeHtml(tokens[index].content || "图片");
  return `<span class="notice-markdown-image" role="img" aria-label="${alt}">[图片：${alt}]</span>`;
};

export function renderNoticeMarkdown(source: string) {
  return markdown.render(source);
}

type MarkdownToken = ReturnType<MarkdownIt["parse"]>[number];

/** 预览最多展示的顶层块数量（标题、段落、列表各算一块）。 */
const PREVIEW_BLOCK_LIMIT = 3;
/** 预览中单个列表最多保留的条目数。 */
const PREVIEW_LIST_ITEM_LIMIT = 2;

function isListBlock(block: MarkdownToken[]) {
  const first = block[0];
  return Boolean(
    first && first.nesting === 1 && (first.type === "bullet_list_open" || first.type === "ordered_list_open"),
  );
}

function capListItems(block: MarkdownToken[]): { tokens: MarkdownToken[]; truncated: boolean } {
  if (!isListBlock(block)) return { tokens: block, truncated: false };
  const kept: MarkdownToken[] = [block[0]];
  let items = 0;
  let truncated = false;
  for (let i = 1; i < block.length; i += 1) {
    const token = block[i];
    if (token.type === "list_item_open") {
      if (items >= PREVIEW_LIST_ITEM_LIMIT) {
        truncated = true;
        break;
      }
      items += 1;
    }
    kept.push(token);
  }
  if (truncated) {
    kept.push(block[block.length - 1]);
  }
  return { tokens: kept, truncated };
}

/**
 * 生成通知正文的重点预览：保留前几个顶层块（列表只取前两项），
 * truncated 表示还有剩余内容需要"点击查看详情"展开。
 */
export function splitNoticePreview(source: string): { previewHtml: string; truncated: boolean } {
  const tokens = markdown.parse(source, {});
  const blocks: MarkdownToken[][] = [];
  let current: MarkdownToken[] = [];
  let depth = 0;
  for (const token of tokens) {
    current.push(token);
    if (token.nesting === 1) depth += 1;
    else if (token.nesting === -1) depth -= 1;
    if (depth === 0 && token.nesting !== 1) {
      blocks.push(current);
      current = [];
    }
  }

  let truncated = blocks.length > PREVIEW_BLOCK_LIMIT;
  const selected: MarkdownToken[] = [];
  for (const block of blocks.slice(0, PREVIEW_BLOCK_LIMIT)) {
    const capped = capListItems(block);
    if (capped.truncated) {
      truncated = true;
    }
    selected.push(...capped.tokens);
  }
  return {
    previewHtml: markdown.renderer.render(selected, markdown.options, {}),
    truncated,
  };
}
