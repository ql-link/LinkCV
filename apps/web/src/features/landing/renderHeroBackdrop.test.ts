import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHeroBackdrop } from "./renderHeroBackdrop";

let frames: Map<number, FrameRequestCallback>;
let intersect: IntersectionObserverCallback;
let resize: ResizeObserverCallback;
let gl: ReturnType<typeof fakeGL>;

function fakeGL() {
  return {
    createShader: vi.fn(() => ({})), createProgram: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})), createTexture: vi.fn(() => ({})),
    shaderSource: vi.fn(), compileShader: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true),
    useProgram: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(), getAttribLocation: vi.fn(() => 0), enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(), activeTexture: vi.fn(), bindTexture: vi.fn(), pixelStorei: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(),
    uniform1i: vi.fn(), uniform1f: vi.fn(), uniform2f: vi.fn(), getUniformLocation: vi.fn((_program, name) => name), viewport: vi.fn(), drawArrays: vi.fn(),
    deleteShader: vi.fn(), deleteTexture: vi.fn(), deleteBuffer: vi.fn(), deleteProgram: vi.fn(),
  };
}
function setup() {
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(gl as unknown as WebGLRenderingContext);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ width: 1280, height: 896 } as DOMRect);
  return { canvas };
}
function step(time: number) {
  const pending = Array.from(frames.values());
  frames.clear();
  pending.forEach(callback => callback(time));
}

beforeEach(() => {
  gl = fakeGL();
  frames = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((frame: number) => frames.delete(frame)));
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { intersect = callback; } observe() {} disconnect() {} });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("renderHeroBackdrop", () => {
  it("GPU 不可用或初始化失败时返回静态回退并释放已分配资源", () => {
    const { canvas } = setup();
    vi.spyOn(canvas, "getContext").mockReturnValue(null);
    expect(renderHeroBackdrop(canvas, false, vi.fn(), vi.fn())).toBeNull();
    vi.spyOn(canvas, "getContext").mockReturnValue(gl as unknown as WebGLRenderingContext);
    gl.getProgramParameter.mockReturnValue(false);
    expect(renderHeroBackdrop(canvas, false, vi.fn(), vi.fn())).toBeNull();
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it("连续绘制时相位缓慢推进，首帧立即显示材质，卸载取消后续绘制", () => {
    const { canvas } = setup();
    const ready = vi.fn();
    const dispose = renderHeroBackdrop(canvas, false, ready, vi.fn())!;
    expect(ready).toHaveBeenCalledOnce();
    step(1000); step(1050); step(1100);
    expect(ready).toHaveBeenCalledOnce();
    expect(gl.uniform1f.mock.calls.map(call => call[1])).toEqual([0, 0, 0.05, 0.1]);
    expect(gl.drawArrays).toHaveBeenCalledTimes(4);
    dispose(); step(1200);
    expect(gl.drawArrays).toHaveBeenCalledTimes(4);
    expect(frames.size).toBe(0);
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
    expect(gl.createTexture).not.toHaveBeenCalled();
  });

  it("滚出视口或隐藏标签页时暂停，回来后从同一相位继续", () => {
    const { canvas } = setup();
    const dispose = renderHeroBackdrop(canvas, false, vi.fn(), vi.fn())!;
    step(1000); step(1050);
    intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(frames.size).toBe(0);
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    step(50000);
    expect(gl.uniform1f).toHaveBeenLastCalledWith("u_time", 0.05);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    dispose();
  });

  it("减少动态效果仅绘制固定相位，尺寸变化重绘但始终不启动动画循环", () => {
    const { canvas } = setup();
    const ready = vi.fn();
    const dispose = renderHeroBackdrop(canvas, true, ready, vi.fn())!;
    expect(gl.drawArrays).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    resize([], {} as ResizeObserver);
    document.dispatchEvent(new Event("visibilitychange"));
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(gl.uniform1f.mock.calls.map(call => call[1])).toEqual([0, 0]);
    expect(frames.size).toBe(0);
    dispose();
  });

  it("高密度大屏仍限制绘制分辨率", () => {
    const { canvas } = setup();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ width: 3840, height: 2160 } as DOMRect);
    vi.stubGlobal("devicePixelRatio", 3);
    const dispose = renderHeroBackdrop(canvas, true, vi.fn(), vi.fn())!;
    expect(canvas.width).toBeLessThanOrEqual(1920);
    expect(canvas.height).toBeLessThanOrEqual(1440);
    dispose();
  });

  it("GPU context 丢失后保持静态回退，后续可见性变化不会重启失效的动画", () => {
    const { canvas } = setup();
    const failure = vi.fn();
    const dispose = renderHeroBackdrop(canvas, false, vi.fn(), failure)!;
    step(1000);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(failure).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    dispose();
  });
});
