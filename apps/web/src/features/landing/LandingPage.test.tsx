import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("展示 handoff 的主要区块并把 CTA 接到对应鉴权模式", () => {
    const onLogin = vi.fn();
    const onStart = vi.fn();
    render(<LandingPage onLogin={onLogin} onStart={onStart} />);

    expect(screen.getByRole("heading", { name: /写 Markdown/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "三步，完成一份简历" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "专为简历场景打造" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建你的第一份简历" }));
    fireEvent.click(screen.getAllByRole("button", { name: "登录" })[0]);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
