import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./api/client";
import { useResumeStore } from "./store/resumeStore";
import { V3Shell } from "./v3/Shell";
import { useSessionStore } from "./v3/sessionStore";

const loaders = vi.hoisted(() => ({ assistant: vi.fn(), home: vi.fn() }));
vi.mock("./workspacePageLoaders", async (importOriginal) => ({
  ...await importOriginal<typeof import("./workspacePageLoaders")>(),
  loadAssistantPage: loaders.assistant,
  loadHomePage: loaders.home,
  scheduleAuthenticatedWorkspacePreload: () => () => undefined,
}));

afterEach(() => vi.restoreAllMocks());

it("真实路由进入独立首页时保留整窗，连续导航与重复点击不会闪空或重建输入框", async () => {
  let finish!: (value: { AssistantPage: typeof AssistantStub }) => void;
  function AssistantStub() {
    return createElement(V3Shell, {
      active: "home", scroll: false,
      children: createElement("input", { "aria-label": "首页草稿" }),
    });
  }
  loaders.assistant.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  loaders.home.mockResolvedValue({ HomePage: () => createElement("h1", null, "简历页面") });
  vi.spyOn(api, "listJobApplications").mockResolvedValue({ items: [], next_cursor: null });
  useSessionStore.setState({ sessions: [], status: "ready", load: vi.fn().mockResolvedValue(undefined) });
  useResumeStore.setState({
    authStatus: "authenticated",
    user: { id: "user-1", email: "user@example.test", nickname: "测试用户", is_admin: false },
    resumes: [], activeResumeId: null, dirty: false,
    hydrate: vi.fn().mockResolvedValue(undefined),
  });
  window.history.replaceState(null, "", "/resumes");
  const view = render(createElement(App));
  await screen.findByRole("heading", { name: "简历页面" });
  const shell = view.container.querySelector(".v3-content");
  const sidebar = screen.getByRole("navigation", { name: "工作区导航" });

  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  expect(window.location.pathname).toBe("/assistant");
  expect(screen.getByRole("heading", { name: "简历页面" })).toBeVisible();
  expect(view.container.querySelector(".v3-content")).toBe(shell);
  expect(screen.getByRole("navigation", { name: "工作区导航" })).toBe(sidebar);
  expect(screen.queryByRole("status", { name: "正在加载模块…" })).not.toBeInTheDocument();

  // A pending home module must not take over after the user has navigated back.
  fireEvent.click(screen.getByRole("link", { name: "我的简历" }));
  await act(async () => { finish({ AssistantPage: AssistantStub }); });
  expect(screen.getByRole("heading", { name: "简历页面" })).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  const input = await screen.findByRole("textbox", { name: "首页草稿" });
  fireEvent.change(input, { target: { value: "未发送的内容" } });
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  expect(screen.getByRole("textbox", { name: "首页草稿" })).toBe(input);
  expect(input).toHaveValue("未发送的内容");
  expect(screen.getAllByRole("navigation", { name: "工作区导航" })).toHaveLength(1);
});
