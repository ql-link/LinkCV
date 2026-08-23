import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api/client";
import { App, AppRouteLoadingFallback, resumeLoadErrorMessage, WorkspacePageBoundary } from "./App";
import { WorkspaceLayout } from "./components/WorkspaceLayout";
import { useResumeStore } from "./store/resumeStore";

describe("App landing routes", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage?.clear();
    useResumeStore.setState({
      authStatus: "authenticated",
      user: {
        id: "user-1",
        email: "user@example.test",
        nickname: "测试用户",
        is_admin: false,
      },
      activeResumeId: null,
      dirty: false,
      hydrate: vi.fn().mockResolvedValue(undefined),
    });
  });

  it.each(["/", "/home"])("已登录访问 %s 时仍展示落地页", async (path) => {
    window.history.replaceState(null, "", path);
    render(createElement(App));

    expect(
      await screen.findByRole("heading", { name: "把每一份经历，都写成下一份机会" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(path));
  });
});

describe("App not-found route", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/missing-page");
    useResumeStore.setState({
      authStatus: "authenticated",
      user: {
        id: "user-1",
        email: "user@example.test",
        nickname: "测试用户",
        is_admin: false,
      },
      activeResumeId: null,
      dirty: false,
      hydrate: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("展示 404 页面并提供公共首页入口", async () => {
    render(createElement(App));

    expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/");
  });

  it("访客访问未知地址时也展示 404 页面", async () => {
    useResumeStore.setState({ authStatus: "guest", user: null });
    render(createElement(App));

    expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/missing-page");
  });
});

describe("resumeLoadErrorMessage", () => {
  it("区分不存在、鉴权失效、数据格式和服务错误", () => {
    expect(resumeLoadErrorMessage(new ApiRequestError(404, "RESUME_NOT_FOUND"))).toContain("不存在");
    expect(resumeLoadErrorMessage(new ApiRequestError(401, "UNAUTHORIZED"))).toContain("重新登录");
    expect(resumeLoadErrorMessage(new ApiRequestError(500, "RESUME_SCHEMA_INVALID"))).toContain("数据格式");
    expect(resumeLoadErrorMessage(new ApiRequestError(503, "HTTP_503"))).toContain("服务暂时");
  });

  it("网络异常提示检查本地服务", () => {
    expect(resumeLoadErrorMessage(new TypeError("fetch failed"))).toContain("无法连接到服务");
  });
});

describe("workspace route loading", () => {
  it("模块首次挂起时保留浅色工作区导航，只替换正文区域", () => {
    const PendingPage = () => {
      throw new Promise(() => undefined);
    };
    render(createElement(WorkspaceLayout, {
      active: "templates",
      children: createElement(WorkspacePageBoundary, null, createElement(PendingPage)),
    }));

    expect(screen.getByRole("navigation", { name: "工作区导航" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "正在加载模块…" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "正在加载模块…" }).closest("[data-ui-theme]"))
      .toHaveAttribute("data-ui-theme", "light");
  });

  it("工作区冷启动的全屏兜底也固定为浅色主题", () => {
    window.history.replaceState(null, "", "/resumes/new");
    render(createElement(AppRouteLoadingFallback));

    expect(screen.getByRole("status", { name: "正在加载页面…" }).closest("[data-ui-theme]"))
      .toHaveAttribute("data-ui-theme", "light");
  });
});
