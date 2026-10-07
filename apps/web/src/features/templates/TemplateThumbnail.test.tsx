import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCanonicalDocument, defaultCanonicalPresentation, type LayoutPlan } from "../../api/resumeContract";
import { TemplateThumbnail } from "./TemplateThumbnail";

const layoutPlan: LayoutPlan = {
  schema_version: "layout-plan.v1",
  content_sha256: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  template_key: "classic-cn",
  regions: [{ region_id: "main", order: 0, nodes: [{
    node_id: defaultCanonicalDocument.identity.node_id,
    semantic_kind: "identity",
    slot_id: "main_content",
  }] }],
};

function template(name = "缩略图测试") {
  return {
    data: { ...defaultCanonicalDocument, identity: { ...defaultCanonicalDocument.identity,
      name: { node_id: "node_name000000000001", value: name, source_refs: [] },
    } },
    style: defaultCanonicalPresentation,
    layout_plan: layoutPlan,
  };
}

let notify: IntersectionObserverCallback;
let target: Element;
const disconnect = vi.fn();

beforeEach(() => {
  disconnect.mockClear();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe(element: Element) { target = element; }
    disconnect = disconnect;
  });
});
afterEach(() => vi.unstubAllGlobals());

function enterViewport(isIntersecting: boolean) {
  act(() => notify([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
}

describe("TemplateThumbnail", () => {
  it("只在可见区域附近创建完整预览，离开后释放，返回时恢复", () => {
    const { container, unmount } = render(<TemplateThumbnail template={template()} />);
    const placeholder = container.querySelector(".tpl-card-thumb");
    expect(placeholder).toBeInTheDocument();
    expect(screen.queryByLabelText("简历只读预览")).not.toBeInTheDocument();

    enterViewport(true);
    expect(screen.getByLabelText("简历只读预览")).toHaveTextContent("缩略图测试");
    enterViewport(false);
    expect(screen.queryByLabelText("简历只读预览")).not.toBeInTheDocument();
    expect(placeholder).toBeInTheDocument();
    enterViewport(true);
    expect(screen.getByLabelText("简历只读预览")).toHaveTextContent("缩略图测试");

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("离屏期间更新模板后显示最新内容", () => {
    const { rerender } = render(<TemplateThumbnail template={template()} />);
    enterViewport(true);
    enterViewport(false);
    rerender(<TemplateThumbnail template={template("新模板示例")} />);
    expect(screen.queryByText("新模板示例")).not.toBeInTheDocument();
    enterViewport(true);
    expect(screen.getByLabelText("简历只读预览")).toHaveTextContent("新模板示例");
    expect(screen.queryByText("缩略图测试")).not.toBeInTheDocument();
  });

  it("浏览器不支持可见性观察时仍显示预览", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<TemplateThumbnail template={template()} />);
    expect(screen.getByLabelText("简历只读预览")).toHaveTextContent("缩略图测试");
  });
});
