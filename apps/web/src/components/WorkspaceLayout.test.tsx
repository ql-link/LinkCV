import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResumeStore } from "../store/resumeStore";
import { WorkspaceLayout, WorkspaceSidebar } from "./WorkspaceLayout";

const originalLogout = useResumeStore.getState().logout;

afterEach(() => {
  vi.restoreAllMocks();
  useResumeStore.setState({ logout: originalLogout });
  window.history.replaceState(null, "", "/");
});

describe("WorkspaceSidebar", () => {
  it("使用统一导航切换简历、模板和 JD，并标记当前模块", () => {
    render(<WorkspaceSidebar active="jobs" email="user@example.test" />);

    expect(screen.getByRole("navigation", { name: "工作区导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JD 中心" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/resumes?view=templates");

    fireEvent.click(screen.getByRole("button", { name: "全部简历" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/resumes");
  });

  it("账号按钮直接进入个人资料", () => {
    render(
      <WorkspaceSidebar
        active="account"
        email="user@example.test"
        nickname="测试用户"
      />,
    );

    const accountButton = screen.getByRole("button", { name: /测试用户/ });
    expect(accountButton).toHaveAttribute("aria-current", "page");

    fireEvent.click(accountButton);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/account");
  });

  it("从工作区退出登录后返回欢迎页", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    useResumeStore.setState({
      user: { id: "1", email: "user@example.test", nickname: "测试用户", is_admin: false, avatar_url: null },
      logout,
    });
    window.history.replaceState(null, "", "/resumes");

    render(<WorkspaceLayout active="resumes"><div>简历列表</div></WorkspaceLayout>);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(window.location.pathname).toBe("/");
  });

  it("退出接口失败时保留当前页面并显示错误", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("network error"));
    useResumeStore.setState({
      user: { id: "1", email: "user@example.test", nickname: "测试用户", is_admin: false, avatar_url: null },
      logout,
    });
    window.history.replaceState(null, "", "/resumes");

    render(<WorkspaceLayout active="resumes"><div>简历列表</div></WorkspaceLayout>);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("退出登录失败");
    expect(window.location.pathname).toBe("/resumes");
  });
});
