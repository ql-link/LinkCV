import { describe, expect, it } from "vitest";
import { renderPreviewEditorContent, resumePreviewStyle } from "./PreviewPanel";

describe("workbench preview content", () => {
  it("injects the persisted accent color into every preview paper", () => {
    const style = resumePreviewStyle({
      fontFamily: "serif",
      fontSize: 9.5,
      lineHeight: 1.25,
      pageMargin: 11,
      verticalPageMargin: 9,
    }, "#202632");

    expect(style).toMatchObject({
      "--preview-accent": "#202632",
      "--resume-font-size": "9.5pt",
      "--resume-line-height": 1.25,
    });
  });

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

  it("renders ordered-list starts and nested lists from the editor snapshot", () => {
    const html = renderPreviewEditorContent({
      type: "doc",
      content: [{
        type: "orderedList",
        attrs: { start: 3 },
        content: [{
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "外层" }] },
            {
              type: "bulletList",
              content: [{
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "内层" }] }],
              }],
            },
          ],
        }],
      }],
    });

    expect(html).toContain('<ol start="3"><li>');
    expect(html).toContain("<ul><li><p>内层</p></li></ul>");
  });
});
