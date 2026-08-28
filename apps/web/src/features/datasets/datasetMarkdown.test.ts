import { describe, expect, it } from "vitest";

import { renderDatasetMarkdown } from "./datasetMarkdown";

describe("renderDatasetMarkdown", () => {
  it("hides Word, PDF, and LinkParse table metadata paragraphs", () => {
    const html = renderDatasetMarkdown([
      "<!-- WORD_PAGE:1 -->",
      "<!-- ODL_PAGE:1 -->",
      "",
      "# 张三",
      "",
      "13800000000 | zhangsan@example.com | 上海",
      "",
      '<!-- LINKPARSE_TABLE_START id="table-001" format="markdown" schema="gfm-table-v1" -->',
      "章节：张三",
      "页码：第 1 页",
      "| 项目<br><br>角色 | 内容 |",
      "| --- | --- |",
      "| 技能 | TypeScript |",
      '<!-- LINKPARSE_TABLE_END id="table-001" -->',
    ].join("\n"));

    expect(html).not.toContain("WORD_PAGE");
    expect(html).not.toContain("ODL_PAGE");
    expect(html).not.toContain("LINKPARSE_TABLE");
    expect(html).not.toContain("章节：张三");
    expect(html).not.toContain("页码：第 1 页");
    expect(html).toContain("<h1>张三</h1>");
    expect(html).toContain("13800000000");
    expect(html).toContain("<table>");
    expect(html).toContain("项目<br><br>角色");
    expect(html).not.toContain("&lt;br&gt;");
    expect(html).toContain("TypeScript");
  });

  it("keeps similarly named user content, ordinary comments, and fenced examples", () => {
    const html = renderDatasetMarkdown([
      "章节：项目经历 页码：第 2 页",
      "",
      "<!-- USER_NOTE: keep -->",
      "",
      "```text",
      "<!-- WORD_PAGE:3 -->",
      "<!-- ODL_PAGE:3 -->",
      '<!-- LINKPARSE_TABLE_END id="example" -->',
      "```",
    ].join("\n"));

    expect(html).toContain("章节：项目经历 页码：第 2 页");
    expect(html).toContain("&lt;!-- USER_NOTE: keep --&gt;");
    expect(html).toContain("&lt;!-- WORD_PAGE:3 --&gt;");
    expect(html).toContain("&lt;!-- ODL_PAGE:3 --&gt;");
    expect(html).toContain("LINKPARSE_TABLE_END");
  });

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

  it("renders only line break tags while keeping other inline HTML escaped", () => {
    const html = renderDatasetMarkdown("第一行<br />第二行<img src=x onerror=alert(1)>");

    expect(html).toContain("第一行<br>第二行");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });
});
