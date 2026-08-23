import { describe, expect, it } from "vitest";
import {
  defaultSemanticDocument,
  defaultSemanticStyle,
  editorSettingsToStyle,
  editorDocumentToMarkdown,
  resumeDocumentFromMarkdown,
  resumeDocumentToMarkdown,
  styleToEditorSettings,
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

  it("preserves imported structured sections when the editor markdown changes", () => {
    const previous = {
      ...defaultSemanticDocument,
      sections: {
        ...defaultSemanticDocument.sections,
        skills: [{ id: "skill_001", name: "Python", level: "熟练", keywords: ["FastAPI"] }],
        certificates: [{ id: "certificate_001", name: "示例证书", issuer: "示例机构" }],
      },
    };

    const document = resumeDocumentFromMarkdown("# 张三\n\n正文已修改", previous);

    expect(document.sections.skills).toEqual(previous.sections.skills);
    expect(document.sections.certificates).toEqual(previous.sections.certificates);
    expect(resumeDocumentToMarkdown(previous)).toContain("## 证书");
    expect(resumeDocumentToMarkdown(previous)).toContain("示例证书");
  });

  it("round-trips the smart one page setting through the persisted style", () => {
    const settings = styleToEditorSettings({ ...defaultSemanticStyle, smart_one_page: true });
    const style = editorSettingsToStyle(settings, defaultSemanticStyle);

    expect(settings.smartOnePage).toBe(true);
    expect(style.smart_one_page).toBe(true);
  });

  it("preserves the classic technical theme when editor settings are saved", () => {
    const original = {
      ...defaultSemanticStyle,
      template_key: "classic-technical-cn",
      smart_one_page: true,
    };
    const settings = styleToEditorSettings(original);

    expect(settings.theme).toBe("classic-technical");
    expect(editorSettingsToStyle(settings, original).template_key).toBe(
      "classic-technical-cn",
    );
  });

  it.each([
    "administrative-sidebar-cn",
    "campus-professional-cn",
    "civic-service-cn",
    "creative-orange-cn",
  ])("preserves the %s theme when editor settings are saved", (templateKey) => {
    const original = { ...defaultSemanticStyle, template_key: templateKey };
    const settings = styleToEditorSettings(original);

    expect(editorSettingsToStyle(settings, original).template_key).toBe(templateKey);
  });

  it("serializes professional layout nodes and inline icons back to markdown", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [
        {
          type: "resumeColumns",
          content: [
            {
              type: "resumeColumn",
              attrs: { variant: "sidebar" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "侧栏" }] }],
            },
            {
              type: "resumeColumn",
              attrs: { variant: "main" },
              content: [{
                type: "heading",
                attrs: { level: 2 },
                content: [{ type: "inlineIcon", attrs: { name: "Briefcase" } }, { type: "text", text: " 工作经历" }],
              }],
            },
          ],
        },
        {
          type: "resumeMetaRow",
          content: ["日期", "组织", "方向", "角色"].map((text) => ({
            type: "paragraph",
            content: [{ type: "text", text }],
          })),
        },
        {
          type: "resumeTrioRow",
          content: ["技能", "年限", "熟练"].map((text) => ({
            type: "paragraph",
            content: [{ type: "text", text }],
          })),
        },
      ],
    });

    expect(markdown).toContain(":::: sidebar\n侧栏\n::::");
    expect(markdown).toContain("## :icon[Briefcase]: 工作经历");
    expect(markdown).toContain(":::: meta\n日期\n组织\n方向\n角色\n::::");
    expect(markdown).toContain(":::: trio\n技能\n年限\n熟练\n::::");
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

  it("round-trips an inline font size through the markdown extension", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "重点经历",
          marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "9.5pt" } }],
        }],
      }],
    });
    const html = renderResumeMarkdown(markdown);

    expect(markdown).toBe("[[linkcv-size:9.5pt]]**重点经历**[[/linkcv-size]]");
    expect(html).toContain('<span style="font-size:9.5pt"><strong>重点经历</strong></span>');
  });

  it("round-trips a line-leading inline icon through the markdown extension", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "inlineIcon", attrs: { name: "GraduationCap" } },
          { type: "text", text: " 示例大学" },
        ],
      }],
    });
    const html = renderResumeMarkdown(markdown);

    expect(markdown).toBe(":icon[GraduationCap]: 示例大学");
    expect(html).toContain('<span data-inline-icon data-icon-name="GraduationCap" class="resume-inline-icon">');
    expect(html).toContain("</span> 示例大学");
  });

  it("persists stable resume block ids as hidden markdown anchors", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "resumeBlockAnchor", attrs: { blockId: "blk_1234567890abcdef" } },
          { type: "text", text: "负责平台性能优化" },
        ],
      }],
    });
    const html = renderResumeMarkdown(markdown);

    expect(markdown).toBe("[[linkcv-block:blk_1234567890abcdef]]负责平台性能优化");
    expect(html).toContain('data-resume-block-id="blk_1234567890abcdef"');
    expect(html).toContain('class="resume-block-anchor"');
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

  it("preserves a left-right row and its left column width", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [{
        type: "resumeRow",
        attrs: { leftWidth: 62 },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "示例大学" }] },
          { type: "paragraph", content: [{ type: "text", text: "2022 – 2026" }] },
        ],
      }],
    });

    expect(markdown).toContain("::: left 62\n示例大学");
    expect(renderResumeMarkdown(markdown)).toContain('data-left-width="62"');
  });

  it("renders raw HTML as text instead of executable markup", () => {
    const html = renderResumeMarkdown('<img src="x" onerror="alert(1)">');

    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src=\"x\"");
  });

  it("renders allowlisted icons as static SVG and leaves unknown icons as text", () => {
    const html = renderResumeMarkdown("## :icon[GraduationCap]: 教育\n\n:icon[NotAllowed]: 保持文本");

    expect(html).toContain('data-icon-name="GraduationCap"');
    expect(html).toContain("<svg");
    expect(html).toContain(":icon[NotAllowed]:");
    expect(html).not.toContain('data-icon-name="NotAllowed"');
  });
});
