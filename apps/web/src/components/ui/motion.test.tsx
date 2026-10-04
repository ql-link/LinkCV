import { useRef } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, Popover } from "../../v3/primitives";
import { MotionPresence, useContentMotion } from "./motion";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function FormDialog({ open }: { open: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return <MotionPresence>{open && <Dialog label="编辑资料" width={480} onClose={() => undefined}>
    <label>名称<input defaultValue="" /></label>
    <button ref={anchor}>更多选项</button>
    <Popover anchorRef={anchor} open={false} onClose={() => undefined}>未打开的菜单</Popover>
  </Dialog>}</MotionPresence>;
}

function exitDuration() {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = original(element);
    if (element.classList.contains("ui-motion-dialog")) Object.defineProperty(style, "animationDuration", { value: "0.18s" });
    return style;
  });
}

describe("浮层过渡的生命周期", () => {
  it("关闭立即归还焦点并停止交互，未打开的嵌套菜单不会阻止退出", async () => {
    vi.useFakeTimers(); exitDuration();
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const view = render(<FormDialog open />);
    const dialog = screen.getByRole("dialog", { name: "编辑资料" });
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveFocus();
    view.rerender(<FormDialog open={false} />);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(dialog.closest("[inert]")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(dialog).not.toBeInTheDocument();
    trigger.remove();
  });

  it("快速关闭再打开使用新的表单，旧的退出定时器不会删除新弹窗", async () => {
    vi.useFakeTimers(); exitDuration();
    const view = render(<FormDialog open />);
    const previous = screen.getByRole("dialog");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "旧草稿" } });
    view.rerender(<FormDialog open={false} />);
    view.rerender(<FormDialog open />);
    const current = screen.getByRole("dialog");
    expect(current).not.toBe(previous);
    expect(within(current).getByRole("textbox")).toHaveValue("");
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(previous).not.toBeInTheDocument();
    expect(current).toBeInTheDocument();
    expect(within(current).getByRole("textbox")).toHaveFocus();
  });
});

function Content({ tab, initial = true }: { tab: string; initial?: boolean }) {
  const ref = useContentMotion<HTMLDivElement>(tab, { initial });
  return <div ref={ref} role="region" aria-label="内容"><input aria-label="未保存的名称" /><span>{tab}</span></div>;
}

describe("页内内容过渡", () => {
  it("页面首次挂载和数据更新不重复淡入，只在用户切换视图时播放", () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as typeof original;
    try {
      const view = render(<Content tab="看板" initial={false} />);
      view.rerender(<Content tab="看板" initial={false} />);
      expect(animate).not.toHaveBeenCalled();
      view.rerender(<Content tab="列表" initial={false} />);
      expect(animate).toHaveBeenCalledOnce();
    } finally { HTMLElement.prototype.animate = original; }
  });

  it("切换不重建 DOM、不清空输入或滚动，连续切换会取消上一次动画", () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as typeof original;
    try {
      const view = render(<Content tab="列表" />);
      const input = screen.getByRole("textbox"); const region = screen.getByRole("region");
      fireEvent.change(input, { target: { value: "待保存" } }); input.focus(); region.scrollTop = 120;
      view.rerender(<Content tab="看板" />);
      expect(screen.getByRole("textbox")).toBe(input);
      expect(input).toHaveValue("待保存"); expect(input).toHaveFocus(); expect(region.scrollTop).toBe(120);
      expect(cancel).toHaveBeenCalled(); expect(animate).toHaveBeenCalledTimes(2);
    } finally { HTMLElement.prototype.animate = original; }
  });

  it("减少动态效果时直接切换内容", () => {
    const animate = vi.fn(); const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as typeof original;
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    try {
      const view = render(<Content tab="一月" />); view.rerender(<Content tab="二月" />);
      expect(screen.getByText("二月")).toBeInTheDocument(); expect(animate).not.toHaveBeenCalled();
    } finally { HTMLElement.prototype.animate = original; }
  });
});
