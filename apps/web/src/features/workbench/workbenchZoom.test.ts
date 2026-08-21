import { describe, expect, it, vi } from "vitest";
import { getWheelZoomScale, handleWheelZoom } from "./workbenchZoom";

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

  it("允许局部预览指定独立的缩放范围", () => {
    const options = { minScale: 0.3, maxScale: 1.2, step: 0.08 };

    expect(getWheelZoomScale(1.2, { ctrlKey: true, metaKey: false, deltaY: -1 }, options)).toBe(1.2);
    expect(getWheelZoomScale(0.3, { ctrlKey: false, metaKey: true, deltaY: 1 }, options)).toBe(0.3);
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
