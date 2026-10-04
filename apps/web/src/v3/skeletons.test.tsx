import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./skeletons";

afterEach(() => vi.useRealTimers());

describe("Reveal", () => {
  it("数据已经就绪时直接显示内容，不做交叉淡化", () => {
    render(<Reveal loading={false} placeholder={<span>骨架</span>}><span>内容</span></Reveal>);
    expect(screen.getByText("内容")).toBeInTheDocument();
    expect(screen.queryByText("骨架")).not.toBeInTheDocument();
    expect(document.querySelector(".v3-reveal-ghost")).toBeNull();
  });

  it("骨架显示过一段时间后，数据到达时内容直接出现在最终位置，骨架作为残影淡出后移除", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<div><Reveal loading placeholder={<span>骨架</span>}><p>内容</p></Reveal></div>);
    expect(screen.getByText("骨架")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(400); });
    rerender(<div><Reveal loading={false} placeholder={<span>骨架</span>}><p>内容</p></Reveal></div>);
    // 内容不包任何外层，直接是父元素的子节点
    expect(container.firstElementChild?.firstElementChild?.tagName).toBe("P");
    expect(document.querySelector(".v3-reveal-ghost")).toHaveTextContent("骨架");
    act(() => { vi.advanceTimersByTime(320); });
    expect(screen.queryByText("骨架")).not.toBeInTheDocument();
    expect(screen.getByText("内容")).toBeInTheDocument();
  });

  it("很快返回的数据不做交叉淡化，避免一闪", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Reveal loading placeholder={<span>骨架</span>}><span>内容</span></Reveal>);
    act(() => { vi.advanceTimersByTime(60); });
    rerender(<Reveal loading={false} placeholder={<span>骨架</span>}><span>内容</span></Reveal>);
    expect(document.querySelector(".v3-reveal-ghost")).toBeNull();
    expect(screen.getByText("内容")).toBeInTheDocument();
  });
});
