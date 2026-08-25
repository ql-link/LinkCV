import { describe, expect, it } from "vitest";
import { renderPreviewEditorContent } from "./PreviewPanel";

describe("workbench preview content", () => {
  it("renders the projected editor tree without a Markdown round trip", () => {
    const html = renderPreviewEditorContent({
      type: "doc",
      content: [{
        type: "resumeColumns",
        content: [
          {
            type: "resumeColumn",
            attrs: { variant: "sidebar" },
            content: [{
              type: "paragraph",
              content: [{
                type: "text",
                text: "侧栏重点",
                marks: [
                  { type: "underline" },
                  { type: "textStyle", attrs: { color: "#3478f6" } },
                ],
              }],
            }],
          },
          {
            type: "resumeColumn",
            attrs: { variant: "main" },
            content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "张三" }] }],
          },
        ],
      }],
    });

    expect(html).toContain('data-type="resume-columns"');
    expect(html).toContain('data-column="sidebar"');
    expect(html).toContain("<u>侧栏重点</u>");
    expect(html).toContain("color:#3478f6");
  });

  it("keeps already-sanitized legacy HTML compatible", () => {
    expect(renderPreviewEditorContent("<h1>历史简历</h1>")).toBe("<h1>历史简历</h1>");
  });
});
