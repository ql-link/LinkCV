import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResumeStore } from "../store/resumeStore";
import { WorkspaceLayout, WorkspaceNavigation } from "./WorkspaceLayout";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("WorkspaceNavigation", () => {
  it("使用顶部胶囊导航切换简历、JD 和资料库，并标记当前模块", () => {
    render(<WorkspaceNavigation active="jobs" email="user@example.test" />);

    expect(screen.getByRole("navigation", { name: "工作区导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "JD 中心" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "模板" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "全部简历" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/resumes");

    fireEvent.click(screen.getByRole("link", { name: "资料库" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/datasets");

    window.history.replaceState(null, "", "/jobs");
    const resumesLink = screen.getByRole("link", { name: "全部简历" });
    const preventNativeNavigation = (event: MouseEvent) => event.preventDefault();
    resumesLink.addEventListener("click", preventNativeNavigation);
    fireEvent.click(resumesLink, { metaKey: true });
    resumesLink.removeEventListener("click", preventNativeNavigation);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/jobs");
  });

  it("个人资料入口保留当前账号提示并直接进入账号页", () => {
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

    const accountLink = screen.getByRole("link", { name: "个人资料" });
    expect(accountLink).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("当前账号：测试用户")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(accountLink);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/account");
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
