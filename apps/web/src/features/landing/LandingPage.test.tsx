import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("展示新版欢迎页的主要区块并把 CTA 接到对应鉴权模式", () => {
    const onLogin = vi.fn();
    const onStart = vi.fn();
    const { container } = render(<LandingPage onLogin={onLogin} onStart={onStart} />);

    expect(screen.getByRole("heading", { name: "把每一份经历，都写成下一份机会" })).toBeInTheDocument();
    const orbitResumes = screen.getAllByTestId("orbit-resume");
    expect(orbitResumes).toHaveLength(14);
    expect(new Set(orbitResumes.map((resume) => resume.dataset.resumeDesign)).size).toBe(14);
    expect(new Set(orbitResumes.map((resume) => resume.dataset.resumeTemplate)).size).toBe(7);
    expect(screen.getByRole("heading", { name: /一份简历，只是开始/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /每一步都在掌控之中/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /岗位信息/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /下一份简历，从这里开始/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "页脚导航" })).toBeInTheDocument();
    const filingLink = screen.getByRole("link", { name: "皖ICP备2026017322号" });
    expect(filingLink).toHaveAttribute("href", "https://beian.miit.gov.cn/");
    expect(filingLink).toHaveAttribute("target", "_blank");
    expect(filingLink).toHaveAttribute("rel", "noreferrer");

    const headerNav = container.querySelector("header nav");
    expect(headerNav).not.toBeNull();
    expect(within(headerNav as HTMLElement).queryByRole("link", { name: "功能" })).not.toBeInTheDocument();
    expect(within(headerNav as HTMLElement).queryByRole("link", { name: "编辑器" })).not.toBeInTheDocument();
    expect(within(headerNav as HTMLElement).queryByRole("link", { name: "JD 中心" })).not.toBeInTheDocument();
    expect(within(headerNav as HTMLElement).queryByRole("link", { name: "理念" })).not.toBeInTheDocument();
    expect(within(headerNav as HTMLElement).queryByRole("link", { name: "FAQ" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始创建简历" }));
    fireEvent.click(screen.getByRole("button", { name: "开始使用 LinkCV" }));
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));

    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
