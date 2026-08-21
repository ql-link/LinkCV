import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { reducedMotionState } = vi.hoisted(() => ({
  reducedMotionState: { enabled: false },
}));

vi.mock("motion/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("motion/react")>();
  return {
    ...original,
    useReducedMotion: () => reducedMotionState.enabled,
  };
});

import RandomLetterSwapNav from "./m-random-letter-swap-1";
import { RandomLetterSwap } from "./random-letter-swap";

function renderedLabel(element: HTMLElement) {
  return Array.from(
    element.querySelectorAll('[data-slot="random-letter-swap-character"]'),
    (character) => character.getAttribute("data-character") ?? "",
  ).join("");
}

describe("RandomLetterSwap", () => {
  afterEach(() => {
    reducedMotionState.enabled = false;
    vi.useRealTimers();
  });

  it("保留链接语义并为每个字符同时渲染进出卷轴", () => {
    render(<RandomLetterSwap href="#features" label="功能" />);

    const link = screen.getByRole("link", { name: "功能" });
    expect(link).toHaveAttribute("href", "#features");
    expect(renderedLabel(link)).toBe("功能");

    fireEvent.mouseEnter(link);
    expect(renderedLabel(link)).toBe("功能");
    expect(link.querySelectorAll('[data-roll-layer="outgoing"]')).toHaveLength(2);
    expect(link.querySelectorAll('[data-roll-layer="incoming"]')).toHaveLength(2);
    expect(Array.from(link.querySelectorAll('[data-roll-layer]')).every((layer) => layer.textContent)).toBe(true);

    fireEvent.mouseLeave(link);
    expect(renderedLabel(link)).toBe("功能");
    expect(link.querySelector('[data-roll-layer]')).not.toBeInTheDocument();
  });

  it("键盘聚焦也会触发动效，失焦立即恢复原文", () => {
    render(<RandomLetterSwap href="#faq" label="FAQ" />);

    const link = screen.getByRole("link", { name: "FAQ" });
    fireEvent.focus(link);
    expect(link.querySelectorAll('[data-roll-layer="incoming"]')).toHaveLength(3);

    fireEvent.blur(link);
    expect(renderedLabel(link)).toBe("FAQ");
    expect(link.querySelector('[data-roll-layer]')).not.toBeInTheDocument();
  });

  it("悬浮后获得焦点不会自行重启同一轮滚动", () => {
    render(<RandomLetterSwap href="#faq" label="FAQ" />);

    const link = screen.getByRole("link", { name: "FAQ" });
    fireEvent.mouseEnter(link);
    const firstIncomingLayer = link.querySelector('[data-roll-layer="incoming"]');

    fireEvent.focus(link);
    fireEvent.mouseEnter(link);
    expect(link.querySelector('[data-roll-layer="incoming"]')).toBe(firstIncomingLayer);

    fireEvent.mouseLeave(link);
    fireEvent.mouseEnter(link);
    expect(link.querySelector('[data-roll-layer="incoming"]')).not.toBe(firstIncomingLayer);
  });

  it("使用原始字符固定每个槽位尺寸", () => {
    const { container } = render(<RandomLetterSwap href="#features" label="JD 中心" />);

    const slots = container.querySelectorAll('[data-slot="random-letter-swap-character"]');
    const sizeCharacters = container.querySelectorAll('[data-slot="random-letter-swap-character-size"]');

    expect(slots).toHaveLength(5);
    expect(Array.from(sizeCharacters, (element) => element.textContent).join("")).toBe("JD\u00a0中心");
  });

  it("混合标签忽略空格并按可见字符从左到右依次滚动", () => {
    render(<RandomLetterSwap href="#jd" label="JD 中心" />);

    const link = screen.getByRole("link", { name: "JD 中心" });
    fireEvent.mouseEnter(link);

    const slots = link.querySelectorAll('[data-slot="random-letter-swap-character"]');
    expect(Array.from(slots, (slot) => slot.getAttribute("data-roll-delay"))).toEqual([
      "0",
      "0.035",
      "0",
      "0.07",
      "0.105",
    ]);
    expect(slots[2]?.querySelector('[data-roll-layer]')).not.toBeInTheDocument();
    expect(renderedLabel(link)).toBe("JD 中心");
  });

  it("减少动态效果时保持静态文字", () => {
    vi.useFakeTimers();
    reducedMotionState.enabled = true;
    const random = vi.spyOn(Math, "random");
    render(<RandomLetterSwap href="#features" label="功能" />);

    const link = screen.getByRole("link", { name: "功能" });
    fireEvent.mouseEnter(link);
    act(() => vi.runAllTimers());

    expect(renderedLabel(link)).toBe("功能");
    expect(link.querySelector('[data-roll-layer]')).not.toBeInTheDocument();
    expect(random).not.toHaveBeenCalled();
  });

  it("导航组合组件使用真实链接数据", () => {
    const onItemClick = vi.fn();
    const { rerender } = render(
      <RandomLetterSwapNav
        activeItem="#features"
        links={[
          { activeColor: "blue", gradient: "none", href: "#features", label: "功能" },
          { activeColor: "purple", gradient: "none", href: "#editor", label: "编辑器" },
        ]}
        onItemClick={onItemClick}
      />,
    );

    const features = screen.getByRole("link", { name: "功能" });
    const editor = screen.getByRole("link", { name: "编辑器" });
    expect(features).toHaveAttribute("href", "#features");
    expect(features).toHaveAttribute("aria-current", "location");
    expect(features).toHaveAttribute("data-active", "true");
    expect(features).toHaveClass("no-underline", "before:content-['']");
    expect(features.parentElement).toHaveClass("overflow-hidden");
    expect(editor).not.toHaveAttribute("aria-current");

    fireEvent.click(editor);
    expect(onItemClick).toHaveBeenCalledWith("#editor");

    rerender(
      <RandomLetterSwapNav
        activeItem="#features"
        links={[
          { activeColor: "blue", gradient: "none", href: "#features", label: "Features" },
          { activeColor: "purple", gradient: "none", href: "#editor", label: "Editor" },
        ]}
      />,
    );

    expect(renderedLabel(screen.getByRole("link", { name: "Features" }))).toBe("Features");
    expect(screen.queryByRole("link", { name: "功能" })).not.toBeInTheDocument();
  });

  it("字符滚动期间仍可点击导航链接", () => {
    const onItemClick = vi.fn();
    render(
      <RandomLetterSwapNav
        activeItem="/resumes"
        links={[
          { activeColor: "blue", gradient: "none", href: "/resumes", label: "全部简历" },
          { activeColor: "orange", gradient: "none", href: "/jobs", label: "JD 中心" },
        ]}
        navigationMode="client"
        onItemClick={onItemClick}
      />,
    );

    const jobs = screen.getByRole("link", { name: "JD 中心" });
    fireEvent.mouseEnter(jobs);
    expect(jobs.querySelector('[data-roll-layer="incoming"]')).toBeInTheDocument();
    fireEvent.click(jobs);

    expect(onItemClick).toHaveBeenCalledWith("/jobs");
  });
});
