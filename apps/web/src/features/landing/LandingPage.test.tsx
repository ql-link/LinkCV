import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("展示新版欢迎页的主要区块并把 CTA 接到对应鉴权模式", () => {
    const onLogin = vi.fn();
    const onStart = vi.fn();
    render(<LandingPage onLogin={onLogin} onStart={onStart} />);

    expect(screen.getByRole("heading", { name: /把经历，写成/ })).toBeInTheDocument();
    const orbitResumes = screen.getAllByTestId("orbit-resume");
    expect(orbitResumes).toHaveLength(14);
    expect(new Set(orbitResumes.map((resume) => resume.dataset.resumeDesign)).size).toBe(14);
    expect(new Set(orbitResumes.map((resume) => resume.dataset.resumeTemplate)).size).toBe(7);
    expect(screen.getByRole("heading", { name: /一份简历，只是开始/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /每一步都在掌控之中/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /岗位信息/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /下一份简历，从这里开始/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "页脚导航" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始创建简历" }));
    fireEvent.click(screen.getByRole("button", { name: "开始使用 LinkCV" }));
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));

    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
