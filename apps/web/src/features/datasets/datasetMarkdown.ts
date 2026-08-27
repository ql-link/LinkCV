import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

export const DATASET_MERMAID_PLACEHOLDER_SELECTOR = "[data-mermaid-placeholder]";

const defaultFenceRenderer = markdown.renderer.rules.fence;

function isMermaidFence(info: string) {
  return info.trim().split(/\s+/u)[0]?.toLowerCase() === "mermaid";
}

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, index, options);
};

markdown.renderer.rules.image = (tokens, index) => {
  const alt = markdown.utils.escapeHtml(tokens[index].content || "图片");
  return `<span class="dataset-markdown-image" role="img" aria-label="${alt}">[图片：${alt}]</span>`;
};

markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (!isMermaidFence(token.info)) {
    return defaultFenceRenderer
      ? defaultFenceRenderer(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  }

  const source = markdown.utils.escapeHtml(token.content);
  return [
    '<div class="dataset-mermaid-placeholder" data-mermaid-placeholder="true">',
    '<pre class="dataset-mermaid-fallback"><code>',
    source,
    "</code></pre>",
    "</div>\n",
  ].join("");
};

export function renderDatasetMarkdown(source: string) {
  return markdown.render(source);
}
