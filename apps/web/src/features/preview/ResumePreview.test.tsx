import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  defaultCanonicalDocument,
  defaultCanonicalPresentation,
  type LayoutPlan,
  type CanonicalResumeDocument,
} from "../../api/resumeContract";
import { ResumePreview } from "./ResumePreview";

const layoutPlan: LayoutPlan = {
  schema_version: "layout-plan.v1",
  content_sha256: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  template_key: "classic-cn",
  regions: [{
    region_id: "main",
    order: 0,
    nodes: [{
      node_id: defaultCanonicalDocument.identity.node_id,
      semantic_kind: "identity",
      slot_id: "main_content",
    }],
  }],
};

describe("ResumePreview", () => {
  it("多页正文按原始 A4 尺寸测量并把溢出的段落移到下一页", () => {
    const data: CanonicalResumeDocument = {
      ...defaultCanonicalDocument,
      sections: [{
        node_id: "node_section000000001",
        semantic_kind: "project",
        title: { node_id: "node_title0000000001", value: "项目经历", source_refs: [] },
        entries: [],
        source_refs: [],
        blocks: ["第一页正文", "第二页正文"].map((text, index) => ({
          node_id: `node_paragraph0000000${index + 1}`,
          block_type: "paragraph",
          source_refs: [],
          runs: [{ inline_type: "text", text, marks: [], href: null, style: { color: null, font_size_pt: null, highlight_color: null } }],
        })),
      }],
    };
    const plan: LayoutPlan = {
      ...layoutPlan,
      regions: [{ ...layoutPlan.regions[0], nodes: [...layoutPlan.regions[0].nodes, {
        node_id: data.sections[0].node_id, semantic_kind: "project", slot_id: "main_content",
      }] }],
    };
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.closest(".resume-paper")) expect(this.closest<HTMLElement>(".resume-paper")?.style.scale).toBe("1");
      const top = this.matches("p") ? (this.textContent === "第二页正文" ? 620 : 120) : 0;
      const height = this.matches("p") ? 500 : 20;
      return { top, bottom: top + height, height, width: 600, left: 0, right: 600, x: 0, y: top, toJSON: () => ({}) };
    });
    try {
      const { container } = render(<ResumePreview data={data} style={defaultCanonicalPresentation} layoutPlan={plan} firstPageOnly />);
      expect(container.querySelector(".resume-paper")).toHaveAttribute("data-page-count", "2");
      const secondParagraph = Array.from(container.querySelectorAll("p")).find((element) => element.textContent === "第二页正文");
      expect(secondParagraph?.previousElementSibling).toHaveClass("share-page-break");
      expect(container.querySelector<HTMLElement>(".resume-paper")?.style.scale).toBe("");
    } finally {
      measure.mockRestore();
    }
  });

  it("第一页预览忽略智能一页且不修改已保存的版式，完整预览仍保留设置", () => {
    const style = {
      ...defaultCanonicalPresentation,
      portable: { ...defaultCanonicalPresentation.portable, smart_one_page: true },
    };
    const { container, rerender } = render(
      <ResumePreview data={defaultCanonicalDocument} style={style} layoutPlan={layoutPlan} firstPageOnly />,
    );
    expect(container.querySelector(".resume-readonly-preview-first-page")).toBeInTheDocument();
    expect(container.querySelector(".resume-paper")).not.toHaveClass("smart-one-page");
    expect(container.querySelector(".resume-paper")).toHaveAttribute("data-page-count", "1");
    expect(style.portable.smart_one_page).toBe(true);

    rerender(<ResumePreview data={defaultCanonicalDocument} style={style} layoutPlan={layoutPlan} mode="full" />);
    expect(container.querySelector(".resume-paper")).toHaveClass("smart-one-page");
    expect(container.querySelector(".resume-readonly-preview-first-page")).not.toBeInTheDocument();
  });

  it("缺少服务端布局计划时显示受控不可用状态", () => {
    render(<ResumePreview data={defaultCanonicalDocument} style={defaultCanonicalPresentation} />);

    expect(screen.getByRole("status")).toHaveTextContent("预览不可用");
    expect(screen.getByRole("article")).toHaveAttribute("data-render-state", "unavailable");
  });

  it("把服务端布局计划传给统一打印渲染器", () => {
    const { container } = render(
      <ResumePreview
        data={{
          ...defaultCanonicalDocument,
          identity: {
            ...defaultCanonicalDocument.identity,
            name: {
              node_id: "node_name000000000001",
              value: "打印测试",
              source_refs: [],
            },
          },
        }}
        style={defaultCanonicalPresentation}
        layoutPlan={layoutPlan}
      />,
    );

    expect(container.querySelector("[data-resume-print-document]")).toHaveAttribute(
      "data-render-state",
      "pending",
    );
    expect(container).toHaveTextContent("打印测试");
  });
});
