import { describe, expect, it } from "vitest";

import { renderDatasetMarkdown } from "./datasetMarkdown";

describe("renderDatasetMarkdown", () => {
  it("turns Mermaid fences into escaped source placeholders", () => {
    const html = renderDatasetMarkdown("```mermaid\ngraph TD\nA[<script>] --> B\n```");

    expect(html).toContain('class="dataset-mermaid-placeholder"');
    expect(html).toContain('data-mermaid-placeholder="true"');
    expect(html).toContain("graph TD\nA[&lt;script&gt;] --&gt; B\n");
    expect(html).not.toContain("<script>");
  });

  it("keeps ordinary fenced code and existing Markdown safety rules unchanged", () => {
    const html = renderDatasetMarkdown([
      "```text",
      "<script>window.bad = true</script>",
      "```",
      "",
      "![architecture](https://example.test/architecture.png)",
      "",
      "[docs](https://example.test/docs)",
    ].join("\n"));

    expect(html).toContain('<pre><code class="language-text">&lt;script&gt;window.bad = true&lt;/script&gt;\n</code></pre>');
    expect(html).toContain("[图片：architecture]");
    expect(html).not.toContain("<img");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
