import { describe, expect, it } from "vitest";
import { installDemoStorage } from "./isolation";
import entrySource from "./main.tsx?raw";

describe("demo storage isolation", () => {
  it("不读取真实存储，演示写入和清理不修改真实数据", () => {
    const descriptors = ["localStorage", "sessionStorage"].map(name => Object.getOwnPropertyDescriptor(window, name)!);
    const realLocal = window.localStorage;
    const realSession = window.sessionStorage;
    realLocal.setItem("landing-test-real-draft", "fictional real draft");
    realSession.setItem("landing-test-real-session", "fictional session");
    try {
      installDemoStorage();
      expect(window.localStorage.getItem("landing-test-real-draft")).toBeNull();
      expect(window.sessionStorage.getItem("landing-test-real-session")).toBeNull();
      window.localStorage.setItem("landing-test-real-draft", "demo draft");
      window.sessionStorage.clear();
      expect(realLocal.getItem("landing-test-real-draft")).toBe("fictional real draft");
      expect(realSession.getItem("landing-test-real-session")).toBe("fictional session");
      installDemoStorage();
      expect(window.localStorage.length).toBe(0);
    } finally {
      Object.defineProperty(window, "localStorage", descriptors[0]);
      Object.defineProperty(window, "sessionStorage", descriptors[1]);
      realLocal.removeItem("landing-test-real-draft");
      realSession.removeItem("landing-test-real-session");
    }
  });

  it("演示入口第一条导入安装存储隔离，业务模块加载时读不到真实存储", () => {
    const firstImport = entrySource.split("\n").find(line => line.startsWith("import "));
    expect(firstImport).toBe('import "./bootstrap";');
  });
});
