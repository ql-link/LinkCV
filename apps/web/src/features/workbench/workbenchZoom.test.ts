import { describe, expect, it, vi } from "vitest";
import { getTwoPageFitScale, getWheelZoomScale, handleWheelZoom } from "./workbenchZoom";

describe("workbench wheel zoom", () => {
  it("只在按下 Command 或 Ctrl 时缩放", () => {
    expect(getWheelZoomScale(1, { ctrlKey: false, metaKey: false, deltaY: -1 })).toBeNull();
    expect(getWheelZoomScale(1, { ctrlKey: true, metaKey: false, deltaY: -1 })).toBe(1.08);
    expect(getWheelZoomScale(1, { ctrlKey: false, metaKey: true, deltaY: 1 })).toBe(0.92);
  });

  it("缩放范围保持在 50% 到 160%", () => {
    expect(getWheelZoomScale(1.6, { ctrlKey: true, metaKey: false, deltaY: -1 })).toBe(1.6);
    expect(getWheelZoomScale(0.5, { ctrlKey: true, metaKey: false, deltaY: 1 })).toBe(0.5);
  });

  it("按工作区宽度把两张 A4 和页间空隙完整放下", () => {
    expect(getTwoPageFitScale(1470, 96)).toBe(0.8526);
    expect(getTwoPageFitScale(2000, 96)).toBe(1);
    expect(getTwoPageFitScale(390, 32)).toBe(0.2221);
  });

  it("双页适配后的临时缩放允许低于普通模式下限", () => {
    expect(getWheelZoomScale(0.22, { ctrlKey: true, metaKey: false, deltaY: -1 }, 0.1)).toBe(0.3);
  });

  it("普通滚轮保持页面滚动，修饰键滚轮才阻止默认行为", () => {
    const preventDefault = vi.fn();
    const setScale = vi.fn();

    expect(handleWheelZoom(1, { ctrlKey: false, metaKey: false, deltaY: 1, preventDefault }, setScale)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(setScale).not.toHaveBeenCalled();

    expect(handleWheelZoom(1, { ctrlKey: true, metaKey: false, deltaY: -1, preventDefault }, setScale)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(setScale).toHaveBeenCalledWith(1.08);
  });
});
