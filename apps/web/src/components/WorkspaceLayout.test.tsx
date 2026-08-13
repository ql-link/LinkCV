import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResumeStore } from "../store/resumeStore";
import { WorkspaceLayout, WorkspaceSidebar } from "./WorkspaceLayout";

afterEach(() => {
  vi.restoreAllMocks();
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

    fireEvent.click(screen.getByRole("button", { name: "资料库" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/datasets");
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

  it("侧边栏不再提供退出登录入口，退出统一收敛到用户中心", () => {
    useResumeStore.setState({
      user: { id: "1", email: "user@example.test", nickname: "测试用户", is_admin: false, avatar_url: null },
    });

    render(<WorkspaceLayout active="resumes"><div>简历列表</div></WorkspaceLayout>);
    expect(screen.queryByRole("button", { name: "退出登录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "退出" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /测试用户/ })).toBeInTheDocument();
  });
});
