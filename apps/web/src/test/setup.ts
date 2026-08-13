import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom 没有 WebGL 上下文，@paper-design/shaders-react 的着色器组件（登录页
// GrainGradient、落地页 FlutedGlass）在测试中挂载会抛未处理错误
// （value.decode is not a function）。统一 mock 为占位组件，避免影响测试结果。
vi.mock("@paper-design/shaders-react", () => {
  const Placeholder = () => null;
  return {
    GrainGradient: Placeholder,
    FlutedGlass: Placeholder,
  };
});

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];

  disconnect() {}
  observe() {}
  takeRecords() { return []; }
  unobserve() {}
}

globalThis.IntersectionObserver = IntersectionObserverStub;

afterEach(() => {
  cleanup();
});
