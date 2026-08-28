import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  defaultSemanticDocument,
  defaultSemanticStyle,
  normalizeResumeAccentColor,
  editorSettingsToStyle,
  editorDocumentToMarkdown,
  resumeDocumentFromMarkdown,
  resumeDocumentToMarkdown,
  resumePresentationPageMargins,
  styleToEditorSettings,
  withResumePresentationAvatarSize,
  type CanonicalResumePresentation,
  type TemplateDefinition,
} from "./resumeContract";
import { renderResumeMarkdown } from "../parser/resumeMarkdown";

describe("resume semantic contract adapter", () => {
  it("uses a safe fallback for invalid persisted accent colors", () => {
    expect(normalizeResumeAccentColor("#202632")).toBe("#202632");
    expect(normalizeResumeAccentColor("rgb(1, 2, 3)")).toBe("#3478f6");
    expect(normalizeResumeAccentColor("#202632; color: red")).toBe("#3478f6");
  });

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

  it("keeps historical contact links in the same paragraph as typed contact fields", () => {
    const document = {
      ...defaultSemanticDocument,
      basics: {
        ...defaultSemanticDocument.basics,
        phone: "13000000000",
        email: "test@example.invalid",
        location: "杭州",
        links: [
          { id: "link_001", label: "个人网站", url: "https://example.invalid" },
          { id: "link_002", label: "备用邮箱", url: "mailto:backup@example.invalid" },
        ],
      },
    };

    const markdown = resumeDocumentToMarkdown(document);
    const html = renderResumeMarkdown(markdown);

    expect(markdown).toContain(
      "13000000000 ｜ test@example.invalid ｜ 杭州 ｜ [个人网站](https://example.invalid) ｜ 备用邮箱",
    );
    expect(markdown).not.toMatch(/\n- \[个人网站\]/u);
    expect(markdown).not.toContain("[备用邮箱](mailto:");
    expect(html).toContain("<p>13000000000 ｜ test@example.invalid ｜ 杭州 ｜ ");
    expect(html).toContain('<a href="https://example.invalid"');
    expect(html).toContain("备用邮箱");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("<ul>");
  });

  it.each([
    "- -&#x20;正文",
    "- -&#32;正文",
    "- -&nbsp;正文",
  ])("cleans only deterministic legacy highlight prefixes: %s", (legacyContent) => {
    const document = {
      ...defaultSemanticDocument,
      sections: {
        ...defaultSemanticDocument.sections,
        work_experiences: [{
          id: "work_001",
          organization: "示例公司",
          position: "后端实习生",
          start_date: null,
          end_date: null,
          current: false,
          highlights: [
            { id: "highlight_001", content: { format: "markdown" as const, content: legacyContent } },
            { id: "highlight_002", content: { format: "markdown" as const, content: "-1°C 环境测试" } },
            { id: "highlight_003", content: { format: "markdown" as const, content: "2024-2025 项目周期" } },
          ],
        }],
      },
    };

    const markdown = resumeDocumentToMarkdown(document);
    const html = renderResumeMarkdown(markdown);

    expect(markdown).toContain("- 正文");
    expect(markdown).toContain("- -1°C 环境测试");
    expect(markdown).toContain("- 2024-2025 项目周期");
    expect(markdown).not.toContain("&#x20;");
    expect(html).toContain("<li>正文</li>");
    expect(html).toContain("<li>-1°C 环境测试</li>");
    expect(html).toContain("<li>2024-2025 项目周期</li>");
  });

  it("stores every editor section as an independently identified canonical block", () => {
    const markdown = "# 张三\n\n## 经历\n正文";
    const document = resumeDocumentFromMarkdown(markdown, defaultSemanticDocument);

    expect(document.semantic_sections).toContainEqual(expect.objectContaining({
      semantic_kind: "custom",
      display_title: "经历",
      content_key: "custom_sections",
    }));
    expect(document.sections.custom_sections).toHaveLength(2);
    expect(document.sections.custom_sections[0].items[0].content).toEqual({
      format: "markdown",
      content: "# 张三",
    });
    expect(new Set(document.sections.custom_sections.map((section) => section.id)).size).toBe(2);
    expect(JSON.stringify(document)).not.toContain('"type":"doc"');
    expect(resumeDocumentToMarkdown(document)).toMatch(
      /^# 张三\n\n## \[\[linkcv-block:blk_[a-z0-9]{16,64}:custom\]\]经历\n\n正文$/u,
    );
  });

  it("canonicalizes imported structured sections without keeping a duplicate typed copy", () => {
    const previous = {
      ...defaultSemanticDocument,
      sections: {
        ...defaultSemanticDocument.sections,
        skills: [{ id: "skill_001", name: "Python", level: "熟练", keywords: ["FastAPI"] }],
        certificates: [{ id: "certificate_001", name: "示例证书", issuer: "示例机构" }],
      },
    };

    const markdown = resumeDocumentToMarkdown(previous);
    const document = resumeDocumentFromMarkdown(markdown, previous);

    expect(document.sections.skills).toEqual([]);
    expect(document.sections.certificates).toEqual([]);
    expect(document.sections.custom_sections.map((section) => section.title)).toEqual([
      "基本信息",
      "专业技能",
      "证书",
    ]);
    expect(resumeDocumentToMarkdown(previous)).toContain("## 证书");
    expect(resumeDocumentToMarkdown(previous)).toContain("示例证书");
    expect(resumeDocumentToMarkdown(document)).toContain("示例证书");
  });

  it("keeps semantic identity when a heading is renamed", () => {
    const original = resumeDocumentFromMarkdown(
      "# [[linkcv-block:blk_1111111111111111]]张三\n\n## [[linkcv-block:blk_2222222222222222]]工作经历\n\n正文",
      defaultSemanticDocument,
    );
    const classified = {
      ...original,
      semantic_sections: original.semantic_sections.map((section) => section.custom_section_id === "blk_2222222222222222"
        ? { ...section, semantic_kind: "work" as const, semantic_source: "user" as const }
        : section),
    };
    const renamed = resumeDocumentFromMarkdown(
      "# [[linkcv-block:blk_1111111111111111]]张三\n\n## [[linkcv-block:blk_2222222222222222]]职业历程\n\n正文",
      classified,
    );
    const section = renamed.semantic_sections.find((item) => item.custom_section_id === "blk_2222222222222222");

    expect(section).toMatchObject({ semantic_kind: "work", semantic_source: "user", display_title: "职业历程" });
  });

  it("removes page regions while preserving content row structures", () => {
    const document = resumeDocumentFromMarkdown(
      [
        ":::: meta",
        "# 张三",
        "电话",
        "邮箱",
        "杭州",
        "::::",
        "",
        "## 工作经历",
        "::: left 60",
        "示例公司",
        ":::",
        "::: right",
        "2024.01 - 至今",
        ":::",
      ].join("\n"),
      defaultSemanticDocument,
    );

    const serialized = resumeDocumentToMarkdown(document);
    expect(serialized).toContain(":::: meta");
    expect(serialized).toContain("杭州\n::::");
    expect(serialized).toContain("::: left 60");
    expect(serialized).toContain("::: right");
    expect(serialized).toContain("# 张三");
    expect(serialized).toContain("示例公司");
    expect(serialized).toContain("2024.01 - 至今");
  });

  it("does not interpret page-region markers inside fenced code as template layout", () => {
    const document = resumeDocumentFromMarkdown(
      "# 张三\n\n```text\n:::: sidebar\n示例文本\n::::\n```",
      defaultSemanticDocument,
    );

    expect(resumeDocumentToMarkdown(document)).toContain(
      "```text\n:::: sidebar\n示例文本\n::::\n```",
    );
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

  it("keeps presentation settings in the active template namespace", () => {
    const template: TemplateDefinition = {
      schema_version: "template-definition.v1" as const,
      template_key: "classic-cn",
      semantic_labels: {
        profile: "个人简介", work: "工作经历", education: "教育经历", project: "项目经历", skills: "专业技能",
        activity: "活动经历", interests: "兴趣爱好", certificates: "证书", awards: "奖项", languages: "语言能力",
      },
      regions: [{ region_id: "main", region_kind: "main" as const, order: 0 }],
      slots: [{
        slot_id: "all-content", region_id: "main", accepts: ["identity", "profile", "work", "education", "project", "skills", "activity", "interests", "certificates", "awards", "languages", "custom"],
        universal_fallback: true, order: 0,
      }],
      tokens: { font_family: "Source Han Serif SC", font_size_pt: 10, line_height: 1.5, accent_color: "#2F4858", page_margin_mm: 14 },
      avatar: { visibility: "show", fallback_asset: "system-default", size_px: 96, region_id: "main" },
    };
    const style: CanonicalResumePresentation = {
      schema_version: "resume-presentation.v1" as const,
      portable: {},
      template_scoped: {
        "classic-cn": { font_scale: 1.2, avatar_size_px: 120 },
        "modern-cn": { font_scale: 0.9, avatar_size_px: 80 },
      },
      template_snapshot: template,
    };
    const settings = styleToEditorSettings(style);
    expect(settings.fontSize).toBe(12);
    expect(withResumePresentationAvatarSize(style, 136).template_scoped["classic-cn"]?.avatar_size_px).toBe(136);
    const switchedBack = {
      ...style,
      template_snapshot: { ...template, template_key: "modern-cn" },
    };
    expect(styleToEditorSettings(switchedBack).fontSize).toBe(9);
    expect(styleToEditorSettings({ ...switchedBack, template_snapshot: template }).fontSize).toBe(12);
  });

  it("preserves four-edge canonical margins until the matching editor control changes", () => {
    const template: TemplateDefinition = {
      schema_version: "template-definition.v1",
      template_key: "civic-service-cn",
      semantic_labels: {
        profile: "个人简介", work: "工作经历", education: "教育经历", project: "项目经历", skills: "专业技能",
        activity: "活动经历", interests: "兴趣爱好", certificates: "证书", awards: "奖项", languages: "语言能力",
      },
      regions: [{ region_id: "main", region_kind: "main", order: 0 }],
      slots: [{
        slot_id: "all-content", region_id: "main", accepts: ["identity", "profile", "work", "education", "project", "skills", "activity", "interests", "certificates", "awards", "languages", "custom"],
        universal_fallback: true, order: 0,
      }],
      tokens: {
        font_family: "Source Han Serif SC", font_size_pt: 10, line_height: 1.5, accent_color: "#2F4858",
        page_margin_mm: 10, vertical_page_margin_mm: 0,
        page_margin_top_mm: 0, page_margin_right_mm: 10, page_margin_bottom_mm: 8, page_margin_left_mm: 10,
      },
      avatar: { visibility: "show", fallback_asset: "system-default", size_px: 94, region_id: "main" },
    };
    const style: CanonicalResumePresentation = {
      schema_version: "resume-presentation.v1",
      portable: {},
      template_scoped: { "civic-service-cn": {} },
      template_snapshot: template,
    };

    expect(resumePresentationPageMargins(style)).toEqual({ top: 0, right: 10, bottom: 8, left: 10 });
    const unchanged = editorSettingsToStyle(styleToEditorSettings(style), style);
    expect(resumePresentationPageMargins(unchanged)).toEqual({ top: 0, right: 10, bottom: 8, left: 10 });

    const changed = editorSettingsToStyle({ ...styleToEditorSettings(style), verticalPageMargin: 6 }, style);
    expect(resumePresentationPageMargins(changed)).toEqual({ top: 6, right: 10, bottom: 6, left: 10 });
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

  it("preserves ordered-list starts and nested list structure in Markdown", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [{
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "外层第一项" }] },
              {
                type: "bulletList",
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子项目 A" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子项目 B" }] }] },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "外层第二项" }] },
              {
                type: "orderedList",
                attrs: { start: 7 },
                content: [{
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "子编号" }] }],
                }],
              },
            ],
          },
        ],
      }],
    });

    expect(markdown).toBe(
      "3. 外层第一项\n   - 子项目 A\n   - 子项目 B\n4. 外层第二项\n\n   7. 子编号",
    );
    const html = renderResumeMarkdown(markdown);
    expect(html).toContain('<ol start="3">');
    expect(html).toContain("<ul>");
    expect(html).toContain("<p>外层第一项</p>");
    expect(html).toContain("<li>子项目 A</li>");
    expect(html).toContain('<ol start="7">');

    const editor = new Editor({ extensions: [StarterKit], content: html });
    try {
      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: "orderedList",
        attrs: { start: 3 },
      });
      expect(editor.getJSON().content?.[0]?.content?.[0]?.content?.[1]).toMatchObject({
        type: "bulletList",
      });
      expect(editor.getJSON().content?.[0]?.content?.[1]?.content?.[1]).toMatchObject({
        type: "orderedList",
        attrs: { start: 7 },
      });
      expect(editorDocumentToMarkdown(editor.getJSON())).toBe(markdown);
    } finally {
      editor.destroy();
    }
  });

  it("serializes email links as plain text while preserving website links", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "zhangsan@example.com",
            marks: [{ type: "link", attrs: { href: "mailto:zhangsan@example.com" } }],
          },
          { type: "text", text: " ｜ " },
          {
            type: "text",
            text: "个人主页",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      }],
    });

    expect(markdown).toBe("zhangsan@example.com ｜ [个人主页](https://example.com)");
  });

  it("renders historical mailto markdown as plain text while preserving website links", () => {
    const html = renderResumeMarkdown(
      "[zhangsan@example.com](mailto:zhangsan@example.com) ｜ [个人主页](https://example.com)",
    );

    expect(html).toContain("zhangsan@example.com");
    expect(html).not.toContain("mailto:");
    expect(html).toContain('<a href="https://example.com"');
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
        {
          type: "paragraph",
          content: [
            {
              type: "inlineImage",
              attrs: {
                src: "/api/resumes/1/assets/company.png",
                width: 84,
                height: 30,
                aspectRatio: 3.5,
                alt: "示例公司 Logo",
              },
            },
            { type: "text", text: " 示例公司 - 后端实习生" },
          ],
        },
      ],
    });
    const html = renderResumeMarkdown(markdown);

    expect(markdown).toContain('"linkcv-avatar:108"');
    expect(markdown).toContain('"linkcv-image:60:%:right"');
    expect(markdown).toContain('"linkcv-inline-image-v2:84:30"');
    expect(html).toContain('data-type="avatar-image"');
    expect(html).toContain('data-type="resume-image"');
    expect(html).toContain('data-inline-image');
    expect(html).toContain('data-width="84"');
    expect(html).toContain('data-height="30"');
  });

  it("兼容读取按宽高比保存的旧版行内图片", () => {
    const html = renderResumeMarkdown('![示例 Logo](/api/resumes/1/assets/company.png "linkcv-inline-image:84:3.5") 示例公司');

    expect(html).toContain('data-width="84"');
    expect(html).toContain('data-height="24"');
    expect(html).toContain('data-aspect-ratio="3.5"');
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

  it("不会把列表项段落对齐写成无效的块指令", () => {
    const markdown = editorDocumentToMarkdown({
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{
            type: "paragraph",
            attrs: { textAlign: "right" },
            content: [{ type: "text", text: "负责示例模块" }],
          }],
        }],
      }],
    });

    expect(markdown).toBe("- 负责示例模块");
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
