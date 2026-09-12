import { describe, expect, it } from "vitest";
import {
  defaultCanonicalDocument,
  defaultCanonicalPresentation,
  type LayoutPlan,
  type CanonicalResumeDocument,
} from "../../../api/resumeContract";
import {
  createResumeRenderRequest,
  renderResumePrintDocument,
  RESUME_RENDER_PROTOCOL_VERSION,
} from "./resumePrintDocument";

function canonicalFixture(): CanonicalResumeDocument {
  return {
    ...defaultCanonicalDocument,
    identity: {
      ...defaultCanonicalDocument.identity,
      name: { node_id: "node_name000000000001", value: "打印测试", source_refs: [] },
    },
    sections: [{
      node_id: "node_section000000001",
      semantic_kind: "project",
      title: { node_id: "node_title0000000001", value: "项目经历", source_refs: [] },
      entries: [],
      source_refs: [],
      blocks: [{
        node_id: "node_paragraph00000001",
        block_type: "paragraph",
        source_refs: [],
        runs: [{
          inline_type: "text",
          text: "正文",
          marks: ["bold", "underline"],
          href: null,
          style: { color: "#3478f6", font_size_pt: 11.5, highlight_color: "#fff3c4" },
        }],
      }],
    }],
  };
}

function canonicalLayoutPlan(data = canonicalFixture(), templateKey = "classic-cn"): LayoutPlan {
  return {
    schema_version: "layout-plan.v1",
    content_sha256: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    template_key: templateKey,
    regions: [{
      region_id: "main",
      order: 0,
      nodes: [
        {
          node_id: data.identity.node_id,
          semantic_kind: "identity",
          slot_id: "main_content",
        },
        ...data.sections.map((section) => ({
          node_id: section.node_id,
          semantic_kind: section.semantic_kind,
          slot_id: "main_content",
        })),
      ],
    }],
  };
}

describe("统一简历打印文档", () => {
  it("从 canonical 快照生成稳定的只读打印 DOM", () => {
    const html = renderResumePrintDocument(createResumeRenderRequest(
      "打印测试", canonicalFixture(), defaultCanonicalPresentation, undefined, canonicalLayoutPlan(),
    ));
    expect(html).toContain("data-resume-print-document");
    expect(html).toContain('data-render-protocol="1"');
    expect(html).toContain('class="resume-content resume-print-content"');
    expect(html).toContain("项目经历");
    expect(html).toContain("<strong>正文</strong>");
    expect(html).not.toContain("ProseMirror");
  });

  it("把 canonical 四边页边距写入统一打印变量", () => {
    const style = {
      ...defaultCanonicalPresentation,
      template_snapshot: {
        ...defaultCanonicalPresentation.template_snapshot,
        tokens: {
          ...defaultCanonicalPresentation.template_snapshot.tokens,
          page_margin_top_mm: 0,
          page_margin_right_mm: 10,
          page_margin_bottom_mm: 8,
          page_margin_left_mm: 10,
        },
      },
    };
    const html = renderResumePrintDocument(createResumeRenderRequest(
      "四边边距", canonicalFixture(), style, undefined, canonicalLayoutPlan(),
    ));
    expect(html).toContain("--resume-page-margin-top:0mm");
    expect(html).toContain("--resume-page-margin-right:10mm");
    expect(html).toContain("--resume-page-margin-bottom:8mm");
    expect(html).toContain("--resume-page-margin-left:10mm");
  });

  it("保留 canonical 富文本标记和稳定 node_id", () => {
    const html = renderResumePrintDocument(createResumeRenderRequest(
      "富文本打印", canonicalFixture(), defaultCanonicalPresentation, undefined, canonicalLayoutPlan(),
    ));
    expect(html).toContain("<u><strong>");
    expect(html).toContain("color:#3478f6");
    expect(html).toContain("font-size:11.5pt");
    expect(html).toContain("background-color:#fff3c4");
    expect(html.match(/node_paragraph00000001/gu)).toHaveLength(1);
  });

  it("将经过服务端授权的 canonical 图片内嵌", () => {
    const data = canonicalFixture();
    const paragraph = data.sections[0].blocks[0];
    if (paragraph.block_type !== "paragraph") throw new Error("TEST_FIXTURE_INVALID");
    paragraph.runs.push({
      node_id: "node_image000000000001",
      inline_type: "media",
      media_kind: "inline_image",
      src: "/api/resumes/1/assets/logo.png",
      alt: "标志",
      width: 48,
      width_unit: "px",
      height_px: 24,
      align: "center",
      system_fallback: false,
      source_refs: [],
    });
    const html = renderResumePrintDocument({
      protocol_version: RESUME_RENDER_PROTOCOL_VERSION,
      title: "图片",
      data,
      style: defaultCanonicalPresentation,
      layout_plan: canonicalLayoutPlan(data),
      assets: { "/api/resumes/1/assets/logo.png": "data:image/png;base64,ZmFrZQ==" },
    });
    expect(html).toContain('src="data:image/png;base64,ZmFrZQ=="');
    expect(html).not.toContain("/api/resumes/1/assets/logo.png");
  });

  it("不把未授权资源替换成可执行内容", () => {
    const html = renderResumePrintDocument({
      title: "安全",
      data: canonicalFixture(),
      style: defaultCanonicalPresentation,
      layout_plan: canonicalLayoutPlan(),
      assets: { "/private/other.png": "javascript:alert(1)" },
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script");
  });

  it("把 canonical 模板强调色写入共用打印根节点", () => {
    const style = {
      ...defaultCanonicalPresentation,
      template_snapshot: {
        ...defaultCanonicalPresentation.template_snapshot,
        tokens: {
          ...defaultCanonicalPresentation.template_snapshot.tokens,
          accent_color: "#202632",
        },
      },
    };
    const html = renderResumePrintDocument(createResumeRenderRequest(
      "强调色", canonicalFixture(), style, undefined, canonicalLayoutPlan(),
    ));
    expect(html).toContain("--preview-accent:#202632");
  });

  it("缺少服务端布局计划时不直接线性渲染 canonical 正文", () => {
    const html = renderResumePrintDocument(createResumeRenderRequest(
      "缺少布局计划", canonicalFixture(), defaultCanonicalPresentation,
    ));

    expect(html).toContain('data-render-state="unavailable"');
    expect(html).toContain('class="resume-render-unavailable"');
    expect(html).toContain("预览不可用");
    expect(html).not.toContain("项目经历");
    expect(html).not.toContain("正文");
  });
});
