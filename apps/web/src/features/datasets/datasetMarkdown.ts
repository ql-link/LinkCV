import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

export const DATASET_MERMAID_PLACEHOLDER_SELECTOR = "[data-mermaid-placeholder]";

const defaultFenceRenderer = markdown.renderer.rules.fence;
const lineBreakTagPattern = /<br[ \t]*\/?>/giu;

const parserPageMetadataLinePattern = /^ {0,3}<!--\s*(?:WORD|ODL)_PAGE:\d+\s*-->[ \t\r]*$/iu;
const linkParseTableStartLinePattern = /^ {0,3}<!--\s*LINKPARSE_TABLE_START\b[^>]*-->(?:[ \t]+章节[：:][^\r\n]*?[ \t]+页码[：:][ \t]*第[ \t]*\d+[ \t]*页)?[ \t\r]*$/iu;
const linkParseTableEndLinePattern = /^ {0,3}<!--\s*LINKPARSE_TABLE_END\b[^>]*-->[ \t\r]*$/iu;
const linkParseSectionLinePattern = /^ {0,3}章节[：:][^\r\n]*[ \t\r]*$/u;
const linkParsePageLinePattern = /^ {0,3}页码[：:][ \t]*第[ \t]*\d+[ \t]*页[ \t\r]*$/u;

function stripDatasetParserMetadata(source: string) {
  const output: string[] = [];
  let activeFence: { character: "`" | "~"; length: number } | null = null;
  let pendingTableMetadata = false;

  for (const line of source.split("\n")) {
    if (activeFence) {
      output.push(line);
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t\r]*$/u)?.[1];
      if (closing?.[0] === activeFence.character && closing.length >= activeFence.length) {
        activeFence = null;
      }
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (opening) {
      activeFence = { character: opening[0] as "`" | "~", length: opening.length };
      pendingTableMetadata = false;
      output.push(line);
      continue;
    }

    if (parserPageMetadataLinePattern.test(line) || linkParseTableEndLinePattern.test(line)) {
      continue;
    }
    if (linkParseTableStartLinePattern.test(line)) {
      pendingTableMetadata = true;
      continue;
    }
    if (
      pendingTableMetadata
      && (linkParseSectionLinePattern.test(line) || linkParsePageLinePattern.test(line))
    ) {
      continue;
    }
    if (line.trim()) pendingTableMetadata = false;
    output.push(line);
  }

  return output.join("\n");
}

function isMermaidFence(info: string) {
  return info.trim().split(/\s+/u)[0]?.toLowerCase() === "mermaid";
}

function renderTextWithSafeLineBreaks(content: string) {
  return content
    .split(lineBreakTagPattern)
    .map((segment) => markdown.utils.escapeHtml(segment))
    .join("<br>");
}

markdown.renderer.rules.text = (tokens, index) => renderTextWithSafeLineBreaks(tokens[index].content);

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
  return markdown.render(stripDatasetParserMetadata(source));
}
