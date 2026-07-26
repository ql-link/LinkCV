import { describe, expect, it } from "vitest";
import {
  defaultSemanticDocument,
  editorDocumentToMarkdown,
  resumeDocumentFromMarkdown,
  resumeDocumentToMarkdown,
} from "./resumeContract";
import { renderResumeMarkdown } from "../parser/resumeMarkdown";

describe("resume semantic contract adapter", () => {
  it("renders semantic fields as editable markdown", () => {
    const document = {
      ...defaultSemanticDocument,
      sections: {
        ...defaultSemanticDocument.sections,
        skills: [{ id: "skill_001", name: "Python", level: null, keywords: ["FastAPI"] }],
      },
    };

    expect(resumeDocumentToMarkdown(document)).toContain("# 张三");
    expect(resumeDocumentToMarkdown(document)).toContain("- Python：FastAPI");
  });

  it("stores editor markdown in the official custom section escape hatch", () => {
    const markdown = "# 张三\n\n## 经历\n正文";
    const document = resumeDocumentFromMarkdown(markdown, defaultSemanticDocument);

    expect(document.schema_version).toBe("1.0");
    expect(document.sections.custom_sections[0].items[0].content).toEqual({
      format: "markdown",
      content: "# 张三\n\n## 经历\n正文",
    });
    expect(JSON.stringify(document)).not.toContain('"type":"doc"');
    expect(resumeDocumentToMarkdown(document)).toBe(markdown);
  });

  it("serializes Tiptap nodes instead of persisting the editor document JSON", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "张三" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "后端工程师", marks: [{ type: "bold" }] }],
        },
      ],
    });

    expect(markdown).toBe("# 张三\n\n**后端工程师**");
  });

  it("preserves private images and their editor layout metadata", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [
        {
          type: "avatarImage",
          attrs: { src: "/api/resumes/1/assets/avatar.png", size: 108, alt: "头像" },
        },
        {
          type: "resumeImage",
          attrs: {
            src: "/api/resumes/1/assets/project.png",
            width: 60,
            widthUnit: "%",
            align: "right",
            alt: "项目图",
          },
        },
      ],
    });
    const html = renderResumeMarkdown(markdown);

    expect(markdown).toContain('"linkcv-avatar:108"');
    expect(markdown).toContain('"linkcv-image:60:%:right"');
    expect(html).toContain('data-type="avatar-image"');
    expect(html).toContain('data-type="resume-image"');
  });

  it("renders raw HTML as text instead of executable markup", () => {
    const html = renderResumeMarkdown('<img src="x" onerror="alert(1)">');

    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=\"x\"");
  });
});
