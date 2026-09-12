import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  defaultCanonicalDocument,
  defaultCanonicalPresentation,
  type LayoutPlan,
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
