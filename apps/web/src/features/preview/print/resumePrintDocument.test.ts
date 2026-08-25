import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  defaultSemanticDocument,
  defaultSemanticStyle,
} from "../../../api/resumeContract";
import {
  createResumeRenderRequest,
  renderResumePrintDocument,
  RESUME_RENDER_PROTOCOL_VERSION,
} from "./resumePrintDocument";
import { resumeDocumentFromEditorDocument } from "../../workbench/resumeEditorPersistence";

describe("统一简历打印文档", () => {
  it("从同一份快照生成稳定的只读打印 DOM", () => {
    const data = {
      ...defaultSemanticDocument,
      basics: { ...defaultSemanticDocument.basics, name: "打印测试" },
      sections: {
        ...defaultSemanticDocument.sections,
        custom_sections: [{
          id: "custom",
          title: "项目",
          items: [{
            id: "item",
            title: "统一渲染",
            subtitle: null,
            content: { format: "markdown" as const, content: "**正文**" },
            source_refs: [],
          }],
        }],
      },
    };
    const html = renderResumePrintDocument(createResumeRenderRequest("打印测试", data, defaultSemanticStyle));

    expect(html).toContain('data-resume-print-document');
    expect(html).toContain('data-render-protocol="1"');
    expect(html).toContain('class="resume-content resume-print-content"');
    expect(html).toContain("统一渲染");
    expect(html).toContain("<strong>正文</strong>");
    expect(html).not.toContain("ProseMirror");
  });

  it("将经过服务端授权的图片内嵌，并保留图片节点的行内语义", () => {
    const data = {
      ...defaultSemanticDocument,
      sections: {
        ...defaultSemanticDocument.sections,
        custom_sections: [{
          id: "custom",
          title: "图片",
          items: [{
            id: "item",
            title: null,
            subtitle: null,
            content: { format: "markdown" as const, content: "![标志](/private/logo.png \"linkcv-inline-image-v2:48:24\")" },
            source_refs: [],
          }],
        }],
      },
    };
    const html = renderResumePrintDocument({
      protocol_version: RESUME_RENDER_PROTOCOL_VERSION,
      title: "图片",
      data,
      style: defaultSemanticStyle,
      assets: { "/private/logo.png": "data:image/png;base64,ZmFrZQ==" },
    });

    expect(html).toContain('src="data:image/png;base64,ZmFrZQ=="');
    expect(html).toContain('data-inline-image');
    expect(html).not.toContain("/private/logo.png");
  });

  it("不把未授权的外部资源替换成可执行内容", () => {
    const html = renderResumePrintDocument({
      title: "安全",
      data: defaultSemanticDocument,
      style: defaultSemanticStyle,
      assets: { "/private/other.png": "javascript:alert(1)" },
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script");
  });

  it("将历史邮箱链接渲染为普通文本", () => {
    const data = {
      ...defaultSemanticDocument,
      sections: {
        ...defaultSemanticDocument.sections,
        custom_sections: [{
          id: "contact",
          title: "联系方式",
          items: [{
            id: "email",
            title: null,
            subtitle: null,
            content: {
              format: "markdown" as const,
              content: "[zhangsan@example.com](mailto:zhangsan@example.com)",
            },
            source_refs: [],
          }],
        }],
      },
    };

    const html = renderResumePrintDocument(
      createResumeRenderRequest("邮箱纯文本", data, defaultSemanticStyle),
    );

    expect(html).toContain("zhangsan@example.com");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain('<a href="mailto:');
  });

  it("uses the manifest for columns and a non-persisted system avatar", () => {
    const style = {
      ...defaultSemanticStyle,
      manifest: {
        renderer_key: "columns" as const,
        regions: [
          { id: "sidebar", kind: "sidebar" as const, order: 0 },
          { id: "main", kind: "main" as const, order: 1 },
        ],
        slots: [
          { id: "sidebar", region_id: "sidebar", accepts: ["basics" as const, "avatar" as const], required: false, fallback: false, order: 0 },
          { id: "main", region_id: "main", accepts: ["custom" as const], required: false, fallback: true, order: 1 },
        ],
        avatar: { visibility: "show" as const, fallback_asset: "system-default" as const, size: 88 },
      },
    };
    const html = renderResumePrintDocument(createResumeRenderRequest("模板投射", defaultSemanticDocument, style));

    expect(html).toContain('data-type="resume-columns"');
    expect(html).toContain('data-column="sidebar"');
    expect(html).toContain('/templates/avatar-cat.jpg');
    expect(defaultSemanticDocument.basics.photo).toBeNull();
  });

  it("直接渲染规范 Tiptap 内容并保留全部富文本标记与布局节点", () => {
    const editorDocument: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, textAlign: "center" },
          content: [{ type: "text", text: "张三" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "resumeBlockAnchor", attrs: { blockId: "blk_2222222222222222", semanticKind: "work" } },
            { type: "text", text: "工作经历" },
          ],
        },
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "重点正文",
            marks: [
              { type: "bold" },
              { type: "underline" },
              { type: "textStyle", attrs: { color: "#3478f6", fontSize: "11.5pt" } },
              { type: "highlight", attrs: { color: "#fff3c4" } },
            ],
          }],
        },
        {
          type: "resumeRow",
          attrs: { leftWidth: 62 },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "虚构公司" }] },
            { type: "paragraph", content: [{ type: "text", text: "2024 - 至今" }] },
          ],
        },
        {
          type: "paragraph",
          content: [{
            type: "inlineImage",
            attrs: {
              src: "/api/resumes/1/assets/company.png",
              width: 48,
              height: 24,
              aspectRatio: 2,
              alt: "公司标志",
            },
          }],
        },
      ],
    };
    const data = resumeDocumentFromEditorDocument(editorDocument, defaultSemanticDocument);
    const html = renderResumePrintDocument(
      createResumeRenderRequest("富文本打印", data, defaultSemanticStyle),
    );

    expect(html).toContain("<strong>重点正文</strong>");
    expect(html).toContain("<u><strong>");
    expect(html).toContain("color:#3478f6");
    expect(html).toContain("font-size:11.5pt");
    expect(html).toContain("background-color:#fff3c4");
    expect(html).toContain('data-type="resume-row"');
    expect(html).toContain('data-left-width="62"');
    expect(html).toContain('data-inline-image');
    expect(html.match(/blk_2222222222222222/gu)).toHaveLength(1);
  });
});
