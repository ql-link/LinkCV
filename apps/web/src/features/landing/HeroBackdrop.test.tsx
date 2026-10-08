import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroBackdrop } from "./HeroBackdrop";
import { renderHeroBackdrop } from "./renderHeroBackdrop";

vi.mock("./renderHeroBackdrop", () => ({ renderHeroBackdrop: vi.fn() }));

beforeEach(() => vi.mocked(renderHeroBackdrop).mockReset());
afterEach(() => vi.restoreAllMocks());

describe("HeroBackdrop", () => {
  it("减少动态效果时请求单帧代码渲染，无需等待任何图片加载", () => {
    const { container } = render(<HeroBackdrop reduced />);
    const [canvas, reduced, ready] = vi.mocked(renderHeroBackdrop).mock.calls[0];
    expect(canvas).toBe(container.querySelector("canvas"));
    expect(reduced).toBe(true);
    expect(container.querySelector("img")).toBeNull();
    act(ready);
    expect(container.firstChild).toHaveAttribute("data-renderer", "static");
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("成功绘制后显示生成的材质，GPU 失败时回退到 CSS 背景", () => {
    const { container } = render(<HeroBackdrop reduced={false} />);
    const [, , ready, failure] = vi.mocked(renderHeroBackdrop).mock.calls[0];
    expect(container.firstChild).toHaveAttribute("data-renderer", "fallback");
    act(ready);
    expect(container.firstChild).toHaveAttribute("data-renderer", "procedural");
    act(failure);
    expect(container.firstChild).toHaveAttribute("data-renderer", "fallback");
  });

  it("动态偏好切换先释放旧渲染器；静态渲染器也在卸载时释放", () => {
    const animatedDispose = vi.fn();
    const staticDispose = vi.fn();
    vi.mocked(renderHeroBackdrop).mockReturnValueOnce(animatedDispose).mockReturnValueOnce(staticDispose);
    const { container, rerender, unmount } = render(<HeroBackdrop reduced={false} />);
    act(vi.mocked(renderHeroBackdrop).mock.calls[0][2]);
    rerender(<HeroBackdrop reduced />);
    expect(animatedDispose).toHaveBeenCalledOnce();
    expect(vi.mocked(renderHeroBackdrop).mock.calls[1][1]).toBe(true);
    act(vi.mocked(renderHeroBackdrop).mock.calls[1][2]);
    expect(container.firstChild).toHaveAttribute("data-renderer", "static");
    unmount();
    expect(staticDispose).toHaveBeenCalledOnce();
  });
});
