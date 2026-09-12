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

// Node 22 can expose an unusable experimental global localStorage to worker
// threads unless a file is configured. Install a deterministic per-test-worker
// implementation so jsdom tests behave the same on macOS, Linux and CI.
const storage = new Map<string, string>();
const localStorageStub: Storage = {
  get length() { return storage.size; },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(String(key)) ?? null,
  key: (index) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key) => { storage.delete(String(key)); },
  setItem: (key, value) => { storage.set(String(key), String(value)); },
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageStub,
});

// Radix Select relies on pointer-capture APIs that jsdom does not implement.
Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  setPointerCapture: { configurable: true, value: () => undefined },
  releasePointerCapture: { configurable: true, value: () => undefined },
  scrollIntoView: { configurable: true, value: () => undefined },
});

afterEach(() => {
  cleanup();
});
