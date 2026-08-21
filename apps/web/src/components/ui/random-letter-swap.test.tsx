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

describe("RandomLetterSwap", () => {
  afterEach(() => {
    reducedMotionState.enabled = false;
    vi.useRealTimers();
  });

  it("保留链接语义并在逐字扰动后恢复原文", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<RandomLetterSwap href="#features" label="功能" />);

    const link = screen.getByRole("link", { name: "功能" });
    expect(link).toHaveAttribute("href", "#features");
    expect(link).toHaveTextContent("功能");

    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(1));
    expect(link).not.toHaveTextContent("功能");

    act(() => vi.runAllTimers());
    expect(link).toHaveTextContent("功能");
  });

  it("键盘聚焦也会触发动效，失焦立即恢复原文", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<RandomLetterSwap href="#faq" label="FAQ" />);

    const link = screen.getByRole("link", { name: "FAQ" });
    fireEvent.focus(link);
    act(() => vi.advanceTimersByTime(1));
    expect(link).not.toHaveTextContent("FAQ");

    fireEvent.blur(link);
    expect(link).toHaveTextContent("FAQ");
  });

  it("减少动态效果时保持静态文字", () => {
    vi.useFakeTimers();
    reducedMotionState.enabled = true;
    const random = vi.spyOn(Math, "random");
    render(<RandomLetterSwap href="#features" label="功能" />);

    const link = screen.getByRole("link", { name: "功能" });
    fireEvent.mouseEnter(link);
    act(() => vi.runAllTimers());

    expect(link).toHaveTextContent("功能");
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

    expect(screen.getByRole("link", { name: "Features" })).toHaveTextContent("Features");
    expect(screen.queryByRole("link", { name: "功能" })).not.toBeInTheDocument();
  });
});
