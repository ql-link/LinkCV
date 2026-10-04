import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { useResumeStore } from "@/store/resumeStore";
import { LandingPage } from "./LandingPage";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(min-width: 1024px)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

describe("LandingPage", () => {
  it("展示已确认的 Hero、五个场景和六项细节，开始使用进入真实项目", () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("写好你的经历，走向下一次机会");
    expect(container.querySelectorAll(".fl-case-card")).toHaveLength(5);
    expect(container.querySelectorAll(".df-card")).toHaveLength(6);
    expect(screen.getByTitle("LinkResume 产品互动演示 · 示例数据")).toHaveAttribute("src", "/landing-demo.html");
    expect(screen.getAllByRole("link", { name: "开始使用" })).toHaveLength(3);
    for (const link of screen.getAllByRole("link", { name: "开始使用" })) {
      expect(link).toHaveAttribute("href", "https://linkresume.cn/resumes");
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "皖ICP备2026017322号" })).toHaveAttribute("href", "https://beian.miit.gov.cn/");
    for (const anchor of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))) {
      expect(container.querySelector(anchor.getAttribute("href")!)).not.toBeNull();
    }
  });

  it("展开导航后可定位细节区并收起菜单", () => {
    render(<LandingPage />);
    const product = screen.getByRole("button", { name: "产品" });
    fireEvent.click(product);
    const models = screen.getByRole("link", { name: "多模型选择" });
    expect(models).toHaveAttribute("href", "#feature-models");
    fireEvent.click(models);
    expect(product).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "多模型选择" })).not.toBeInTheDocument();
  });

  it("手机菜单打开时锁定背景，选择目录后恢复滚动", () => {
    const { container } = render(<LandingPage />);
    document.body.style.overflow = "auto";
    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }));
    expect(document.body.style.overflow).toBe("hidden");
    const menu = container.querySelector(".fl-mobile-menu") as HTMLElement;
    fireEvent.click(within(menu).getByRole("button", { name: "产品" }));
    fireEvent.click(within(menu).getByRole("link", { name: "多模型选择" }));
    expect(screen.queryByRole("button", { name: "关闭导航菜单" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("挂载公共落地页不安装演示接口、不覆盖真实账号", () => {
    const fetch = window.fetch;
    const me = api.me;
    const user = useResumeStore.getState().user;
    const authStatus = useResumeStore.getState().authStatus;
    render(<LandingPage />);
    expect(window.fetch).toBe(fetch);
    expect(api.me).toBe(me);
    expect(useResumeStore.getState().user).toBe(user);
    expect(useResumeStore.getState().authStatus).toBe(authStatus);
  });
});
