import { describe, expect, it } from "vitest";
import {
  defaultSemanticDocument,
  defaultSemanticStyle,
} from "../../../api/resumeContract";
import {
  createResumeRenderRequest,
  renderResumePrintDocument,
  RESUME_RENDER_PROTOCOL_VERSION,
} from "./resumePrintDocument";

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
});
