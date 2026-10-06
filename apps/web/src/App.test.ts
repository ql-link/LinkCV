import { act, render, screen, waitFor } from "@testing-library/react";
import { createElement, lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api/client";
import {
  App,
  AppRouteLoadingFallback,
  RESUME_AUTOSAVE_INTERVAL_MS,
  resumeLoadErrorMessage,
  startResumeAutosave,
  WorkspacePageBoundary,
} from "./App";
import { WorkspaceLayout } from "./components/WorkspaceLayout";
import { useResumeStore } from "./store/resumeStore";

describe("App landing routes", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(min-width: 1024px)", media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
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

  it("已登录访问纯域名时仍展示公共落地页", async () => {
    render(createElement(App));

    expect(await screen.findByRole("heading", { name: "懂你经历的求职搭档" }, { timeout: 5000 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("已登录访问 /home 时仍展示落地页", async () => {
    window.history.replaceState(null, "", "/home");
    render(createElement(App));

    expect(
      await screen.findByRole(
        "heading",
        { name: "懂你经历的求职搭档" },
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/home"));
  });

  it("访客访问纯域名时展示落地页", async () => {
    useResumeStore.setState({ authStatus: "guest", user: null });
    render(createElement(App));

    expect(
      await screen.findByRole(
        "heading",
        { name: "懂你经历的求职搭档" },
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
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
    expect(screen.getByRole("link", { name: "回到首页" })).toHaveAttribute("href", "/assistant");
  });

  it("访客访问未知地址时也展示 404 页面", async () => {
    useResumeStore.setState({ authStatus: "guest", user: null });
    render(createElement(App));

    expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到首页" })).toHaveAttribute("href", "/");
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

describe("resume autosave cadence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("每十秒触发一次批量保存检查，而不是随每次编辑重置", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const timer = startResumeAutosave(save);

    vi.advanceTimersByTime(RESUME_AUTOSAVE_INTERVAL_MS - 1);
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(RESUME_AUTOSAVE_INTERVAL_MS);
    expect(save).toHaveBeenCalledTimes(2);
    window.clearInterval(timer);
  });
});

describe("workspace route loading", () => {
  it("切换时保留当前页面直到新模块就绪，不插入模块加载图", async () => {
    let finish!: (value: { default: () => ReturnType<typeof createElement> }) => void;
    const NextPage = lazy(() => new Promise<{ default: () => ReturnType<typeof createElement> }>((resolve) => { finish = resolve; }));
    const view = render(createElement(WorkspacePageBoundary, null, createElement("p", null, "当前页面")));
    view.rerender(createElement(WorkspacePageBoundary, null, createElement(NextPage)));
    expect(screen.getByText("当前页面")).toBeVisible();
    expect(screen.queryByRole("status", { name: "正在加载模块…" })).not.toBeInTheDocument();
    await act(async () => { finish({ default: () => createElement("p", null, "目标页面") }); });
    expect(screen.getByText("目标页面")).toBeVisible();
    expect(screen.queryByText("当前页面")).not.toBeInTheDocument();
  });

  it("连续导航时只显示最后选择的页面，迟到的模块不能覆盖它", async () => {
    let finish!: (value: { default: () => ReturnType<typeof createElement> }) => void;
    const SlowPage = lazy(() => new Promise<{ default: () => ReturnType<typeof createElement> }>((resolve) => { finish = resolve; }));
    const view = render(createElement(WorkspacePageBoundary, null, createElement("p", null, "起点")));
    view.rerender(createElement(WorkspacePageBoundary, null, createElement(SlowPage)));
    view.rerender(createElement(WorkspacePageBoundary, null, createElement("p", null, "最终页面")));
    await act(async () => { finish({ default: () => createElement("p", null, "迟到页面") }); });
    expect(screen.getByText("最终页面")).toBeVisible();
    expect(screen.queryByText("迟到页面")).not.toBeInTheDocument();
  });

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
