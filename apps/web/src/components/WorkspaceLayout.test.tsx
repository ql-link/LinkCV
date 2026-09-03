import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResumeStore } from "../store/resumeStore";
import { CareerNavigation, WorkspaceLayout, WorkspaceNavigation, WorkspacePageHero } from "./WorkspaceLayout";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("WorkspaceNavigation", () => {
  it("按简历、模板、AI 助手、求职中心和资料库的顺序渲染顶部导航，并标记当前模块", () => {
    const onItemIntent = vi.fn();
    render(<WorkspaceNavigation active="career" email="user@example.test" onItemIntent={onItemIntent} />);

    expect(screen.getByRole("navigation", { name: "工作区导航" })).toBeInTheDocument();
    const brandLink = screen.getByRole("link", { name: "LinkResume 首页" });
    expect(brandLink).toHaveClass("no-underline", "hover:no-underline");
    expect(brandLink.querySelector(".ui-brand-wordmark")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "岗位库" })).not.toBeInTheDocument();
    const resumesLink = screen.getByRole("link", { name: "我的简历" });
    const assistantLink = screen.getByRole("link", { name: "AI 助手" });
    const templatesLink = screen.getByRole("link", { name: "简历模板" });
    const interviewsLink = screen.getByRole("link", { name: "求职中心" });
    expect(interviewsLink).toHaveAttribute("aria-current", "page");
    expect(Array.from(screen.getByRole("navigation", { name: "工作区导航" }).querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual([
      "/resumes",
      "/templates",
      "/assistant",
      "/career/jobs",
      "/datasets",
    ]);
    expect(assistantLink.querySelector('img[src*="assistant-feather-outline"]')).toBeInTheDocument();
    expect(templatesLink).toHaveAttribute("href", "/templates");
    expect(assistantLink).toHaveAttribute("href", "/assistant");
    expect(interviewsLink).toHaveAttribute("href", "/career/jobs");
    expect(resumesLink.style.getPropertyValue("--nav-item-color")).toBe("var(--ui-accent)");
    expect(templatesLink.style.getPropertyValue("--nav-item-color")).toBe("var(--ui-template-accent)");
    expect(assistantLink.style.getPropertyValue("--nav-item-color")).toBe("var(--ui-assistant-accent)");
    expect(assistantLink.style.getPropertyValue("--nav-item-glow")).toContain("var(--ui-assistant-accent)");
    expect(interviewsLink.style.getPropertyValue("--nav-item-color")).toBe("var(--ui-career-accent)");
    expect(interviewsLink.style.getPropertyValue("--nav-item-glow")).toContain("var(--ui-career-accent)");
    expect(screen.queryByRole("link", { name: "个人资料" })).not.toBeInTheDocument();

    fireEvent.mouseEnter(templatesLink);
    fireEvent.focus(interviewsLink);
    expect(onItemIntent).toHaveBeenCalledWith("/templates");
    expect(onItemIntent).toHaveBeenCalledWith("/career/jobs");

    fireEvent.click(screen.getByRole("link", { name: "我的简历" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/resumes");

    fireEvent.click(screen.getByRole("link", { name: "简历模板" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/templates");

    fireEvent.click(assistantLink);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/assistant");

    fireEvent.click(screen.getByRole("link", { name: "资料库" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/datasets");

    fireEvent.click(screen.getByRole("link", { name: "求职中心" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/career/jobs");

    window.history.replaceState(null, "", "/jobs");
    const preventNativeNavigation = (event: MouseEvent) => event.preventDefault();
    resumesLink.addEventListener("click", preventNativeNavigation);
    fireEvent.click(resumesLink, { metaKey: true });
    resumesLink.removeEventListener("click", preventNativeNavigation);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/jobs");
  });

  it("从导航移除个人资料按钮，并通过右上角头像进入账号页", () => {
    useResumeStore.setState({
      user: { id: "1", email: "user@example.test", nickname: "测试用户", is_admin: false, avatar_url: null },
    });
    render(
      <WorkspaceNavigation
        active="account"
        email="user@example.test"
        nickname="测试用户"
      />,
    );

    const navigation = screen.getByRole("navigation", { name: "工作区导航" });
    expect(navigation).not.toHaveTextContent("个人资料");
    expect(navigation.querySelector('[aria-current="page"]')).not.toBeInTheDocument();

    const accountLink = screen.getByRole("link", { name: "打开个人资料，当前账号：测试用户" });
    expect(accountLink).toHaveAttribute("href", "/account");
    expect(accountLink).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(accountLink);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/account");
  });

  it("求职中心移除总览并使用四个按流程排序的子导航", () => {
    render(<CareerNavigation active="applications" />);

    const navigation = screen.getByRole("navigation", { name: "求职中心导航" });
    const links = Array.from(navigation.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual(["岗位库", "求职进程", "面试排期", "记录复盘"]);
    expect(screen.queryByRole("link", { name: "总览" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "求职进程" })).toHaveAttribute("href", "/career/applications");
    expect(screen.getByRole("link", { name: "求职进程" })).toHaveAttribute("aria-current", "page");
  });

  it("模块页头把图标、标题和描述放在同一信息行", () => {
    const { container } = render(
      <WorkspacePageHero
        icon={<span>图标</span>}
        tone="template"
        title="简历模板"
        description="浏览当前可用版式。"
      />,
    );

    const summary = container.querySelector(".page-hero-module-summary");
    expect(summary).toContainElement(screen.getByRole("heading", { name: "简历模板" }));
    expect(summary).toHaveTextContent("浏览当前可用版式。");
    expect(container.querySelector(".page-hero-module-mark.is-template")).toBeInTheDocument();
    expect(container.querySelector(".page-hero-eyebrow")).not.toBeInTheDocument();
  });

  it("工作区布局不再渲染左侧导航", () => {
    useResumeStore.setState({
      user: { id: "1", email: "user@example.test", nickname: "测试用户", is_admin: false, avatar_url: null },
    });

    const { container } = render(
      <WorkspaceLayout active="resumes">
        <main>页面内容</main>
      </WorkspaceLayout>,
    );

    expect(container.querySelector(".dashboard-sidebar")).not.toBeInTheDocument();
    expect(container.querySelector(".dashboard-topbar")).toBeInTheDocument();
    expect(screen.getByText("页面内容")).toBeInTheDocument();
  });
});
