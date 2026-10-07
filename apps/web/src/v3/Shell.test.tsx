import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AgentSession } from "../api/client";
import { setLocale } from "../i18n";
import { V3Shell } from "./Shell";
import { useSessionStore } from "./sessionStore";

vi.mock("../workspacePageLoaders", () => ({ preloadWorkspacePage: vi.fn() }));

function resize(width: number) {
  act(() => {
    window.innerWidth = width;
    window.dispatchEvent(new Event("resize"));
  });
}

describe("工作区响应式导航", () => {
  beforeEach(() => {
    setLocale("zh-CN", false);
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("matchMedia", undefined);
    vi.spyOn(api, "listJobApplications").mockResolvedValue({ items: [], next_cursor: null });
    useSessionStore.setState({ sessions: [], status: "ready", collapsedGroups: { pin: false, recent: false } });
    window.history.replaceState(null, "", "/resumes");
  });
  afterEach(() => { act(() => setLocale("zh-CN", false)); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("窄屏打开导航后限制背景交互，Escape 关闭并还原焦点", async () => {
    const user = userEvent.setup();
    render(<V3Shell active="resumes"><button>页面操作</button></V3Shell>);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "打开工作区导航" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "工作区导航" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("inert");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("选择页面关闭抽屉并进入对应路由", async () => {
    const user = userEvent.setup();
    render(<V3Shell active="resumes">页面内容</V3Shell>);
    await user.click(screen.getByRole("button", { name: "打开工作区导航" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "资料库" }));
    expect(window.location.pathname).toBe("/datasets");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("抽屉不显示叉号，点击内部保持打开，点击外部关闭并还原焦点", async () => {
    const user = userEvent.setup();
    render(<V3Shell active="resumes">页面内容</V3Shell>);
    const trigger = screen.getByRole("button", { name: "打开工作区导航" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "工作区导航" });
    expect(within(dialog).queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    await user.click(dialog);
    expect(dialog).toBeInTheDocument();
    await user.click(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("新建对话关闭抽屉并执行页面回调", async () => {
    const onNewConversation = vi.fn();
    const user = userEvent.setup();
    render(<V3Shell active="home" onNewConversation={onNewConversation}>页面内容</V3Shell>);
    await user.click(screen.getByRole("button", { name: "打开工作区导航" }));
    await user.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "新建对话" })[0]);
    expect(onNewConversation).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("打开抽屉时切换英文更新导航文案并保留关闭行为", async () => {
    const user = userEvent.setup();
    render(<V3Shell active="resumes">页面内容</V3Shell>);
    const trigger = screen.getByRole("button", { name: "打开工作区导航" });
    await user.click(trigger);
    act(() => setLocale("en-US", false));
    const dialog = screen.getByRole("dialog", { name: "Workspace navigation" });
    expect(trigger).toHaveAccessibleName("Open workspace navigation");
    expect(within(dialog).getByRole("navigation", { name: "Workspace navigation" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "New conversation" })).toHaveLength(1);
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("link", { name: "Library" }));
    expect(window.location.pathname).toBe("/datasets");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("拉宽窗口恢复桌面侧栏，再缩小时抽屉保持关闭", async () => {
    const user = userEvent.setup();
    render(<V3Shell active="resumes">页面内容</V3Shell>);
    await user.click(screen.getByRole("button", { name: "打开工作区导航" }));
    resize(1440);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "工作区导航" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开工作区导航" })).not.toBeInTheDocument();
    resize(390);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开工作区导航" })).toHaveAttribute("aria-expanded", "false");
  });

  it("抽屉入场缩放期间，高亮使用未缩放的菜单布局位置", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.matches(".v3-side-row.is-active") ? 240 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.matches(".v3-side-row.is-active") ? 100 + 240 * 0.96 : 100;
      return { top, bottom: top + 44 * 0.96, left: 0, right: 188, x: 0, y: top, width: 188, height: 44 * 0.96, toJSON: () => ({}) };
    });
    const user = userEvent.setup();
    render(<V3Shell active="mock">页面内容</V3Shell>);
    await user.click(screen.getByRole("button", { name: "打开工作区导航" }));
    const dialog = screen.getByRole("dialog", { name: "工作区导航" });
    await waitFor(() => expect(dialog.querySelector(".v3-side-indicator")).toHaveStyle({ transform: "translateY(240px)" }));
  });

  it("编辑器等整窗页面不显示工作区导航", () => {
    render(<V3Shell active="none" bare>编辑器</V3Shell>);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开工作区导航" })).not.toBeInTheDocument();
  });

  it("Pin 保存后移到独立分组，取消后回到最近对话，两栏分别收起展开", async () => {
    resize(1440);
    const session = { id: "pin-session", title: "测试对话", pinned: false, updated_at: "2026-10-06T00:00:00Z" } as AgentSession;
    useSessionStore.setState({ sessions: [session] });
    const update = vi.spyOn(api, "updateAgentSession")
      .mockResolvedValueOnce({ session: { ...session, pinned: true } })
      .mockResolvedValueOnce({ session });
    const user = userEvent.setup();
    render(<V3Shell active="home">页面内容</V3Shell>);
    expect(screen.queryByRole("region", { name: "Pin" })).not.toBeInTheDocument();
    const recent = screen.getByRole("region", { name: "最近对话" });
    await user.click(within(recent).getByRole("button", { name: "测试对话 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(update).toHaveBeenCalledWith(session.id, { pinned: true });
    const pin = await screen.findByRole("region", { name: "Pin" });
    expect(pin.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(within(pin).getByRole("button", { name: "测试对话" })).toBeInTheDocument());
    expect(within(recent).queryByRole("button", { name: "测试对话" })).not.toBeInTheDocument();
    await user.click(within(pin).getByRole("button", { name: "收起Pin" }));
    expect(within(pin).queryByRole("button", { name: "测试对话" })).not.toBeInTheDocument();
    expect(within(recent).getByRole("button", { name: "收起最近对话" })).toHaveAttribute("aria-expanded", "true");
    await user.click(within(recent).getByRole("button", { name: "收起最近对话" }));
    await user.click(within(pin).getByRole("button", { name: "展开Pin" }));
    await user.click(within(pin).getByRole("button", { name: "测试对话 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "取消 Pin" }));
    await waitFor(() => expect(useSessionStore.getState().sessions[0].pinned).toBe(false));
    expect(screen.queryByRole("region", { name: "Pin" })).not.toBeInTheDocument();
    await user.click(within(recent).getByRole("button", { name: "展开最近对话" }));
    expect(within(recent).getByRole("button", { name: "测试对话" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建对话" })).toHaveLength(1);
  });

  it("Pin 保存失败显示错误且会话保留在原分组", async () => {
    resize(1440);
    useSessionStore.setState({ sessions: [{ id: "failure-session", title: "失败测试", pinned: false } as AgentSession] });
    vi.spyOn(api, "updateAgentSession").mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<V3Shell active="home">页面内容</V3Shell>);
    await user.click(screen.getByRole("button", { name: "失败测试 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pin 状态保存失败，请重试");
    expect(within(screen.getByRole("region", { name: "最近对话" })).getByRole("button", { name: "失败测试" })).toBeInTheDocument();
  });
});
