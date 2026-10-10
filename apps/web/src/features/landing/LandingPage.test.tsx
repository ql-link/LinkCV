import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/i18n";
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
afterEach(() => setLocale("zh-CN"));

describe("LandingPage", () => {
  it("按 Figma 新稿展示 Hero、五个功能场景、六张细节卡和常见问题，免费开始进入真实项目", () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("懂你经历的求职搭档");
    expect(container.querySelectorAll(".fs-block")).toHaveLength(5);
    expect(container.querySelectorAll(".dc-card")).toHaveLength(6);
    expect(screen.getByRole("img", { name: "DrawOffer 交流群 QQ 二维码" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "首页 · 示例数据" })).toHaveAttribute("src", expect.stringContaining("zh-CN/home"));
    const starts = screen.getAllByRole("link", { name: "免费开始" });
    expect(starts).toHaveLength(3);
    for (const link of starts) expect(link).toHaveAttribute("href", "/resumes");
    expect(screen.getByRole("link", { name: "看 2 分钟演示" })).toHaveAttribute("href", "#demo");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "皖ICP备2026017322号" })).toHaveAttribute("href", "https://beian.miit.gov.cn/");
    for (const anchor of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))) {
      expect(container.querySelector(anchor.getAttribute("href")!)).not.toBeNull();
    }
  });

  it.each(["http://localhost:5173", "https://dev.example.test", "https://linkresume.cn"])("工作区链接保留当前环境 %s", (origin) => {
    const { container } = render(<LandingPage />);
    const links = [...screen.getAllByRole("link", { name: "免费开始" }), ...Array.from(container.querySelectorAll<HTMLAnchorElement>(".fs-copy a"))];
    expect(links).toHaveLength(8);
    for (const link of links) {
      const target = new URL(link.getAttribute("href")!, origin);
      expect(target.origin).toBe(origin);
      expect(target.pathname).toBe("/resumes");
    }
  });

  it("语言按钮在中英文之间切换整页文案和演示语言", () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole("button", { name: "切换语言" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The job-search partner that knows your story");
    expect(screen.getAllByRole("link", { name: "Start free" })).toHaveLength(3);
    expect(screen.getByRole("img", { name: "Home · Sample data" })).toHaveAttribute("src", expect.stringContaining("en-US/home"));
    expect(document.documentElement.lang).toBe("en-US");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("懂你经历的求职搭档");
  });

  it("常见问题默认展开第一项，点击后切换展开项", () => {
    render(<LandingPage />);
    const first = screen.getByRole("button", { name: "DrawOffer 免费吗？" });
    const second = screen.getByRole("button", { name: "支持导入哪些格式的简历？" });
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/支持 PDF、Word（DOCX）和 Markdown/)).toBeVisible();
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
