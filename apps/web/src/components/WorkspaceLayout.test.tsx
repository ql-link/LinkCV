import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSidebar } from "./WorkspaceLayout";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("WorkspaceSidebar", () => {
  it("使用统一导航切换简历、模板和 JD，并标记当前模块", () => {
    const onLogout = vi.fn();
    render(<WorkspaceSidebar active="jobs" email="user@example.test" onLogout={onLogout} />);

    expect(screen.getByRole("navigation", { name: "工作区导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JD 中心" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/resumes?view=templates");

    fireEvent.click(screen.getByRole("button", { name: "全部简历" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/resumes");

    fireEvent.click(screen.getByRole("button", { name: "user@example.test" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
