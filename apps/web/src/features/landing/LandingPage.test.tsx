import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("展示新版欢迎页的主要区块并把 CTA 接到对应鉴权模式", () => {
    const onLogin = vi.fn();
    const onStart = vi.fn();
    render(<LandingPage onLogin={onLogin} onStart={onStart} />);

    expect(screen.getByRole("heading", { name: /简历创作/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /每一步都在掌控之中/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /岗位信息/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始创建简历" }));
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
