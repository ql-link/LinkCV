import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, type AgentContextSnapshot, type AgentProposal, type AgentSession } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
import { useResumeStore } from "../../store/resumeStore";
import { AssistantPage } from "./AssistantPage";

vi.mock("../datasets/DatasetsPage", () => ({
  DatasetsPage: ({ embedded }: { embedded?: boolean }) => (
    <section aria-label="嵌入式资料库" data-embedded={embedded ? "true" : "false"} />
  ),
}));

vi.mock("../workbench/ResumeWorkbench", () => ({
  ResumeWorkbench: ({ embedded, onClose, onAgentSelectionChange }: {
    embedded?: boolean;
    onClose?: () => void;
    onAgentSelectionChange?: (context: {
      block_ids: string[];
      from: number;
      to: number;
      selected_text: string;
      selected_text_hash: string;
    }) => void;
  }) => (
    <section aria-label="嵌入式简历编辑器" data-embedded={embedded ? "true" : "false"}>
      <button type="button" onClick={onClose}>关闭简历</button>
      <button type="button" onClick={() => onAgentSelectionChange?.({
        block_ids: ["node_location000000001"],
        from: 10,
        to: 13,
        selected_text: "123",
        selected_text_hash: `sha256:${"a".repeat(64)}`,
      })}>模拟选区</button>
    </section>
  ),
}));

const originalResumeStore = useResumeStore.getState();

const session: AgentSession = {
  id: "session-1",
  title: "新对话",
  pinned: false,
  status: "active",
  last_message_at: null,
  created_at: "2026-08-26T05:00:00Z",
  updated_at: "2026-08-26T05:00:00Z",
  messages: [],
};

beforeEach(() => {
  window.history.replaceState(null, "", "/assistant");
  useResumeStore.setState({
    ...originalResumeStore,
    resumes: [],
    activeResumeId: null,
  }, true);
  vi.spyOn(api, "getAgentModel").mockResolvedValue({
    model: { adapter: "openai", name: "deepseek/deepseek-v4-flash" },
  });
  vi.spyOn(api, "getActiveAgentRun").mockResolvedValue({ run: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("AssistantPage", () => {
  it("在新建对话下方只保留资料库，并在助手页内切换资料视图", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });

    render(<AssistantPage />);

    const shortcuts = await screen.findByRole("navigation", { name: "助手快捷入口" });
    expect(within(shortcuts).queryByRole("link", { name: "简历" })).not.toBeInTheDocument();
    const datasetsButton = within(shortcuts).getByRole("button", { name: "资料库" });
    expect(datasetsButton.querySelector(".lucide-folder-open")).toBeInTheDocument();

    await user.click(datasetsButton);
    expect(screen.getByRole("region", { name: "嵌入式资料库" })).toHaveAttribute("data-embedded", "true");
    expect(window.location.pathname).toBe("/assistant");

    await user.click(datasetsButton);
    expect(screen.queryByRole("region", { name: "嵌入式资料库" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AI 求职助手工作区" })).toBeInTheDocument();
  });

  it("从右上角选择简历后嵌入编辑器并自动完全收起左栏", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    const listResumes = vi.fn().mockResolvedValue(undefined);
    const loadResume = vi.fn().mockResolvedValue(undefined);
    useResumeStore.setState({
      resumes: [{
        id: "resume-1",
        title: "Java 开发实习简历",
        source_type: "blank",
        lock_version: 1,
        created_at: "2026-09-14T02:00:00Z",
        updated_at: "2026-09-14T03:00:00Z",
      }],
      listResumes,
      loadResume,
    });

    render(<AssistantPage />);

    expect(screen.queryByRole("link", { name: "待投清单" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "我的简历" }));
    expect(listResumes).toHaveBeenCalledOnce();
    const picker = screen.getByRole("dialog", { name: "选择我的简历" });
    await user.click(within(picker).getByRole("button", { name: /Java 开发实习简历/ }));

    await waitFor(() => expect(loadResume).toHaveBeenCalledWith("resume-1"));
    expect(screen.getByRole("region", { name: "嵌入式简历编辑器" })).toHaveAttribute("data-embedded", "true");
    expect(screen.queryByRole("complementary", { name: "对话列表" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开会话侧栏" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "展开会话侧栏" }));
    expect(screen.getByRole("complementary", { name: "对话列表" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起会话侧栏" })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "关闭简历" }));
    expect(screen.queryByRole("region", { name: "嵌入式简历编辑器" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "对话列表" })).toBeInTheDocument();
  });

  it("从嵌入式简历发送消息时保存草稿并携带稳定选区", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        messages: [{
          sequence_no: 1,
          role: "user",
          content: "删除这处占位内容",
          contexts: [{
            type: "resume",
            id: "1",
            version: "1",
            presentation: "implicit",
            resume_id: "1",
            label: "Java 开发实习简历",
            updated_at: "2026-09-14T03:00:00Z",
          }],
          created_at: "2026-09-14T03:05:00Z",
        }],
      },
    });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    const stream = vi.spyOn(api, "streamAgentMessage").mockResolvedValue(undefined);
    const saveCurrentResume = vi.fn().mockResolvedValue(undefined);
    useResumeStore.setState({
      resumes: [{
        id: "1",
        title: "Java 开发实习简历",
        source_type: "blank",
        lock_version: 1,
        created_at: "2026-09-14T02:00:00Z",
        updated_at: "2026-09-14T03:00:00Z",
      }],
      listResumes: vi.fn().mockResolvedValue(undefined),
      loadResume: vi.fn().mockResolvedValue(undefined),
      saveCurrentResume,
      error: null,
    });
    render(<AssistantPage />);
    await user.click(await screen.findByRole("button", { name: "我的简历" }));
    await user.click(within(screen.getByRole("dialog", { name: "选择我的简历" }))
      .getByRole("button", { name: /Java 开发实习简历/ }));
    await user.click(await screen.findByRole("button", { name: "模拟选区" }));
    const input = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "删除这处占位内容");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(saveCurrentResume).toHaveBeenCalledOnce();
    expect(stream.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      contexts: [{ type: "resume", id: "1", presentation: "implicit" }],
      selection_context: expect.objectContaining({
        block_ids: ["node_location000000001"],
        selected_text: "123",
      }),
    }));
    expect(await screen.findByText("删除这处占位内容")).toBeInTheDocument();
    expect(screen.queryByLabelText("引用文件 Java 开发实习简历")).not.toBeInTheDocument();
  });

  it.each(["1", "2"])("打开简历后优先使用显式引用 %s，跨简历不携带选区", async (explicitId) => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "listAgentContexts").mockImplementation(async ({ type } = {}) => ({
      contexts: type === "resume"
        ? [{ type: "resume", id: explicitId, version: "1", label: "Java 开发实习简历" }]
        : [],
    }));
    const stream = vi.spyOn(api, "streamAgentMessage").mockResolvedValue(undefined);
    useResumeStore.setState({
      resumes: [{
        id: "1",
        title: "Java 开发实习简历",
        source_type: "blank",
        lock_version: 1,
        created_at: "2026-09-14T02:00:00Z",
        updated_at: "2026-09-14T03:00:00Z",
      }],
      listResumes: vi.fn().mockResolvedValue(undefined),
      loadResume: vi.fn().mockResolvedValue(undefined),
      saveCurrentResume: vi.fn().mockResolvedValue(undefined),
      error: null,
    });

    render(<AssistantPage />);
    await user.click(await screen.findByRole("button", { name: "我的简历" }));
    await user.click(within(screen.getByRole("dialog", { name: "选择我的简历" }))
      .getByRole("button", { name: /Java 开发实习简历/ }));
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.click(await screen.findByRole("button", { name: "模拟选区" }));
    await user.type(input, "@");
    expect(await screen.findByRole("option", { name: /Java 开发实习简历/ })).toBeInTheDocument();
    await user.keyboard("{Tab}");
    await user.type(input, "请分析");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      contexts: [{
        type: "resume",
        id: explicitId,
        version: "1",
        presentation: "mention",
      }],
    }));
    if (explicitId === "2") {
      expect(stream.mock.calls[0]?.[1]).not.toHaveProperty("selection_context");
    } else {
      expect(stream.mock.calls[0]?.[1]).toHaveProperty("selection_context");
    }
  });

  it("切换嵌入式简历时不会沿用上一份简历的选区", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    const stream = vi.spyOn(api, "streamAgentMessage").mockResolvedValue(undefined);
    useResumeStore.setState({
      resumes: [
        {
          id: "1", title: "第一份简历", source_type: "blank", lock_version: 1,
          created_at: "2026-09-14T02:00:00Z", updated_at: "2026-09-14T03:00:00Z",
        },
        {
          id: "2", title: "第二份简历", source_type: "blank", lock_version: 1,
          created_at: "2026-09-14T02:00:00Z", updated_at: "2026-09-14T03:00:00Z",
        },
      ],
      listResumes: vi.fn().mockResolvedValue(undefined),
      loadResume: vi.fn().mockResolvedValue(undefined),
      saveCurrentResume: vi.fn().mockResolvedValue(undefined),
      error: null,
    });

    render(<AssistantPage />);
    await user.click(await screen.findByRole("button", { name: "我的简历" }));
    await user.click(within(screen.getByRole("dialog", { name: "选择我的简历" }))
      .getByRole("button", { name: /第一份简历/ }));
    await user.click(await screen.findByRole("button", { name: "模拟选区" }));
    await user.click(screen.getByRole("button", { name: "我的简历" }));
    await user.click(within(screen.getByRole("dialog", { name: "选择我的简历" }))
      .getByRole("button", { name: /第二份简历/ }));
    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "优化当前简历");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      contexts: [{ type: "resume", id: "2", presentation: "implicit" }],
    }));
    expect(stream.mock.calls[0]?.[1]).not.toHaveProperty("selection_context");
  });

  it("为每条历史对话提供置顶、重命名和删除菜单", async () => {
    const user = userEvent.setup();
    const listedSession = { ...session, title: "待整理对话", pinned: false };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [listedSession] });
    const updateSession = vi.spyOn(api, "updateAgentSession")
      .mockResolvedValueOnce({ session: { ...listedSession, pinned: true } })
      .mockResolvedValueOnce({ session: { ...listedSession, pinned: true, title: "新的对话名称" } });
    const deleteSession = vi.spyOn(api, "deleteAgentSession").mockResolvedValue(undefined);

    render(<AssistantPage />);

    expect(await screen.findByRole("region", { name: "最近对话" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "待整理对话 的更多操作" }));
    const firstMenu = screen.getByRole("menu", { name: "待整理对话 的操作菜单" });
    expect(firstMenu).not.toHaveClass("is-above");
    expect(within(firstMenu).getByRole("menuitem", { name: "Pin" })).toBeInTheDocument();
    expect(within(firstMenu).getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(within(firstMenu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();

    await user.click(within(firstMenu).getByRole("menuitem", { name: "Pin" }));
    expect(updateSession).toHaveBeenNthCalledWith(1, "session-1", { pinned: true });
    const pinnedGroup = await screen.findByRole("region", { name: "Pinned" });
    expect(within(pinnedGroup).getByRole("button", { name: "待整理对话" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "最近对话" })).queryByRole("button", { name: "待整理对话" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "待整理对话 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const renameInput = screen.getByRole("textbox", { name: "重命名对话 待整理对话" });
    await user.clear(renameInput);
    await user.type(renameInput, "新的对话名称{Enter}");
    await waitFor(() => expect(updateSession).toHaveBeenNthCalledWith(2, "session-1", { title: "新的对话名称" }));

    await user.click(await screen.findByRole("button", { name: "新的对话名称 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("删除这条对话？");
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith("session-1"));
    expect(screen.queryByText("新的对话名称")).not.toBeInTheDocument();
  });

  it("仅在存在置顶会话时显示 Pinned 分组", async () => {
    const user = userEvent.setup();
    const pinnedSession = { ...session, id: "session-pinned", title: "置顶对话", pinned: true };
    const recentSession = { ...session, id: "session-recent", title: "普通对话", pinned: false };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [pinnedSession, recentSession] });
    vi.spyOn(api, "updateAgentSession").mockResolvedValue({
      session: { ...pinnedSession, pinned: false },
    });

    render(<AssistantPage />);

    const pinnedGroup = await screen.findByRole("region", { name: "Pinned" });
    expect(within(pinnedGroup).getByRole("button", { name: "置顶对话" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "最近对话" })).getByRole("button", { name: "普通对话" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "置顶对话 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "Unpin" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Pinned" })).not.toBeInTheDocument());
    const recentGroup = screen.getByRole("region", { name: "最近对话" });
    expect(within(recentGroup).getByRole("button", { name: "置顶对话" })).toBeInTheDocument();
    expect(within(recentGroup).getByRole("button", { name: "普通对话" })).toBeInTheDocument();
  });

  it("可分别收起和展开 Pinned 与最近对话", async () => {
    const user = userEvent.setup();
    const pinnedSession = { ...session, id: "session-pinned", title: "置顶对话", pinned: true };
    const recentSession = { ...session, id: "session-recent", title: "普通对话", pinned: false };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [pinnedSession, recentSession] });

    render(<AssistantPage />);

    expect(await screen.findByRole("button", { name: "置顶对话" })).toBeVisible();
    expect(screen.getByRole("button", { name: "普通对话" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收起 Pinned" }));
    expect(screen.getByRole("button", { name: "展开 Pinned" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "置顶对话" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "普通对话" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "展开 Pinned" }));
    expect(screen.getByRole("button", { name: "置顶对话" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收起最近对话" }));
    expect(screen.getByRole("button", { name: "展开最近对话" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "普通对话" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开最近对话" }));
    expect(screen.getByRole("button", { name: "普通对话" })).toBeVisible();
  });

  it("打开历史会话时保持最近对话的原有顺序", async () => {
    const user = userEvent.setup();
    const newestSession = { ...session, id: "session-newest", title: "最近更新的对话", updated_at: "2026-08-26T06:00:00Z" };
    const olderSession = { ...session, id: "session-older", title: "较早的对话", updated_at: "2026-08-26T05:00:00Z" };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [newestSession, olderSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: { ...olderSession, updated_at: "2026-08-26T07:00:00Z" },
    });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });

    render(<AssistantPage />);

    const recentGroup = await screen.findByRole("region", { name: "最近对话" });
    const sessionTitles = () => Array.from(recentGroup.querySelectorAll(".assistant-session-open > span"))
      .map((element) => element.textContent);
    expect(sessionTitles()).toEqual(["最近更新的对话", "较早的对话"]);

    await user.click(within(recentGroup).getByRole("button", { name: "较早的对话" }));

    await waitFor(() => expect(api.getAgentSession).toHaveBeenCalledWith("session-older"));
    expect(sessionTitles()).toEqual(["最近更新的对话", "较早的对话"]);
  });

  it("历史会话发起新消息时才移动到最近对话首位", async () => {
    const user = userEvent.setup();
    const newestSession = { ...session, id: "session-newest", title: "最近更新的对话", updated_at: "2026-08-26T06:00:00Z" };
    const olderSession = { ...session, id: "session-older", title: "较早的对话", updated_at: "2026-08-26T05:00:00Z" };
    const refreshedOlderSession = {
      ...olderSession,
      updated_at: "2026-08-26T07:00:00Z",
      messages: [{ sequence_no: 1, role: "user" as const, content: "继续这个话题", created_at: "2026-08-26T07:00:00Z" }],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [newestSession, olderSession] });
    vi.spyOn(api, "getAgentSession")
      .mockResolvedValueOnce({ session: olderSession })
      .mockResolvedValueOnce({ session: refreshedOlderSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    let finishStream!: () => void;
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-promote" });
      await new Promise<void>((resolve) => {
        finishStream = resolve;
      });
      onEvent({ type: "run.completed", runId: "run-promote" });
    });

    render(<AssistantPage />);

    const recentGroup = await screen.findByRole("region", { name: "最近对话" });
    const sessionTitles = () => Array.from(recentGroup.querySelectorAll(".assistant-session-open > span"))
      .map((element) => element.textContent);
    await user.click(within(recentGroup).getByRole("button", { name: "较早的对话" }));
    await waitFor(() => expect(api.getAgentSession).toHaveBeenCalledWith("session-older"));

    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "继续这个话题");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(api.streamAgentMessage).toHaveBeenCalledOnce());
    expect(sessionTitles()).toEqual(["较早的对话", "最近更新的对话"]);
    finishStream();
    await waitFor(() => expect(api.getAgentSession).toHaveBeenCalledTimes(2));
  });

  it("可拖动或通过键盘调整最近对话栏宽度", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    const { container } = render(<AssistantPage />);

    const shell = container.querySelector<HTMLDivElement>(".assistant-shell");
    expect(shell).not.toBeNull();
    vi.spyOn(shell!, "getBoundingClientRect").mockReturnValue({
      x: 40,
      y: 0,
      left: 40,
      right: 1900,
      top: 0,
      bottom: 1000,
      width: 1860,
      height: 1000,
      toJSON: () => ({}),
    });

    const separator = screen.getByRole("separator", { name: "调整最近对话栏宽度" });
    expect(separator).toHaveAttribute("aria-valuenow", "240");
    expect(shell).toHaveStyle({ "--assistant-sidebar-width": "240px" });

    fireEvent.pointerDown(separator, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 280 });
    fireEvent.pointerMove(separator, { pointerId: 1, pointerType: "mouse", clientX: 360 });
    expect(separator).toHaveAttribute("aria-valuenow", "320");
    expect(shell).toHaveStyle({ "--assistant-sidebar-width": "320px" });
    fireEvent.pointerUp(separator, { pointerId: 1, pointerType: "mouse", clientX: 360 });

    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "220");
    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "420");
  });

  it("通过独立会话路由直接恢复对应对话", async () => {
    const routedSession: AgentSession = {
      ...session,
      title: "可深链会话",
      messages: [
        { sequence_no: 1, role: "user", content: "请分析岗位", created_at: session.created_at },
        { sequence_no: 2, role: "assistant", content: "这是已恢复的回答", created_at: session.created_at },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [routedSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: routedSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });

    render(<AssistantPage sessionId="session-1" />);

    await waitFor(() => expect(screen.getByText("这是已恢复的回答")).toBeInTheDocument());
    expect(api.getAgentSession).toHaveBeenCalledWith("session-1");
    expect(window.location.pathname).toBe("/assistant/session-1");
    expect(screen.getAllByRole("button", { name: "添加资料" })).toHaveLength(1);
  });

  it("刷新后重新连接仍在运行的对话并恢复输出", async () => {
    const runningSession: AgentSession = {
      ...session,
      title: "生成中的对话",
      messages: [
        { sequence_no: 1, role: "user", content: "请继续分析", created_at: session.created_at },
      ],
    };
    const completedSession: AgentSession = {
      ...runningSession,
      messages: [
        ...runningSession.messages,
        { sequence_no: 2, role: "assistant", content: "完整分析结果", created_at: session.created_at },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [runningSession] });
    vi.mocked(api.getActiveAgentRun).mockResolvedValue({
      run: { run_id: "run-active", status: "running", started_at: session.created_at },
    });
    vi.spyOn(api, "getAgentSession")
      .mockResolvedValueOnce({ session: runningSession })
      .mockResolvedValueOnce({ session: completedSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "streamAgentRun").mockImplementation(async (_runId, _signal, onEvent) => {
      onEvent({ type: "run.phase", runId: "run-active", phase: "drafting", referencedContextCount: 0 });
      onEvent({ type: "assistant.delta", runId: "run-active", delta: "正在生成的内容" });
      onEvent({ type: "run.completed", runId: "run-active" });
    });

    render(<AssistantPage sessionId="session-1" />);

    expect(await screen.findByText("完整分析结果")).toBeInTheDocument();
    expect(api.streamAgentRun).toHaveBeenCalledWith(
      "run-active",
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument();
  });

  it("离开助手页面只断开浏览器订阅，不取消后台运行", async () => {
    const runningSession: AgentSession = {
      ...session,
      messages: [
        { sequence_no: 1, role: "user", content: "请分析", created_at: session.created_at },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [runningSession] });
    vi.mocked(api.getActiveAgentRun).mockResolvedValue({
      run: { run_id: "run-active", status: "running", started_at: session.created_at },
    });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: runningSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "streamAgentRun").mockImplementation(async (_runId, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    const cancel = vi.spyOn(api, "cancelAgentRun").mockResolvedValue({
      run_id: "run-active",
      status: "cancelled",
    });

    const view = render(<AssistantPage sessionId="session-1" />);
    expect(await screen.findByRole("button", { name: "停止生成" })).toBeInTheDocument();
    view.unmount();

    expect(cancel).not.toHaveBeenCalled();
  });

  it("把历史用户消息中的文件引用渲染为正文内联单元", async () => {
    const routedSession: AgentSession = {
      ...session,
      title: "带资料的会话",
      messages: [{
        sequence_no: 1,
        role: "user",
        content: "你好 @资料1.md 这是什么",
        contexts: [{ type: "dataset", id: "21", version: "hash-1", label: "资料1.md" }],
        created_at: session.created_at,
      }],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [routedSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: routedSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });

    render(<AssistantPage sessionId="session-1" />);

    const reference = await screen.findByLabelText("引用文件 资料1.md");
    const message = reference.closest(".assistant-message");
    expect(message).toHaveTextContent("你好 资料1.md 这是什么");
    expect(message).not.toHaveTextContent("@资料1.md");
    expect(reference.querySelector(".lucide-database")).toBeInTheDocument();
    expect(within(message as HTMLElement).queryByLabelText("本轮引用资料")).not.toBeInTheDocument();
  });

  it("按 Markdown 层级渲染语义标题", async () => {
    const routedSession: AgentSession = {
      ...session,
      title: "Markdown 标题会话",
      messages: [{
        sequence_no: 1,
        role: "assistant",
        content: "# 一级标题\n正文内容\n## 二级标题\n### 三级标题",
        created_at: session.created_at,
      }],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [routedSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: routedSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });

    render(<AssistantPage sessionId="session-1" />);

    expect(await screen.findByRole("heading", { level: 2, name: "一级标题" })).toHaveClass("is-level-1");
    expect(screen.getByRole("heading", { level: 3, name: "二级标题" })).toHaveClass("is-level-2");
    expect(screen.getByRole("heading", { level: 4, name: "三级标题" })).toHaveClass("is-level-3");
    expect(screen.getByText("正文内容").tagName).toBe("P");
  });

  it("按设计稿展示空状态，并通过批量资料弹窗添加上下文", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "listAgentContexts").mockResolvedValue({
      contexts: [{
        type: "job",
        id: "12",
        version: "2",
        label: "示例科技 · 后端工程师",
        description: "上海",
        updated_at: "2026-08-26T05:00:00Z",
      }],
    });

    render(<AssistantPage />);

    expect(await screen.findByText("你好，今天想完成什么？")).toBeInTheDocument();
    const workspace = screen.getByRole("region", { name: "AI 求职助手工作区" });
    expect(within(workspace).queryByRole("heading", { name: /^AI 求职助手$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("仅使用你主动选择的简历与资料")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建对话" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析岗位匹配度" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加资料" }));
    expect(await screen.findByRole("dialog", { name: "选择资料" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "岗位" }));
    await user.click(screen.getByRole("button", { name: /示例科技 · 后端工程师/ }));
    expect(screen.getByRole("button", { name: "添加 1 项" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加 1 项" }));
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toHaveTextContent("示例科技 · 后端工程师");
  });

  it("输入 @ 后按资料前缀搜索，并用 Tab 选择第一项", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    const listContexts = vi.spyOn(api, "listAgentContexts").mockImplementation(async (options = {}) => {
      const { type, search } = options;
      const contexts: AgentContextSnapshot[] = type === "dataset"
        ? ([
            { type: "dataset", id: "21", version: "hash-1", label: "资料1.md" },
            { type: "dataset", id: "22", version: "hash-2", label: "资料2.pdf" },
          ] satisfies AgentContextSnapshot[]).filter((item) => !search || item.label.startsWith(search))
        : ([{ type: "resume", id: "1", version: "3", label: "后端简历" }] satisfies AgentContextSnapshot[])
            .filter((item) => !search || item.label.startsWith(search));
      return { contexts };
    });

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });

    await user.type(input, "@");
    expect(await screen.findByRole("listbox", { name: "可引用的资料和简历" })).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "简历" })).toHaveTextContent("后端简历");
    expect(screen.getByRole("group", { name: "资料" })).toHaveTextContent("资料1.md");
    await waitFor(() => {
      expect(listContexts).toHaveBeenCalledWith({ type: "dataset", search: "", prefix: true, limit: 4 });
      expect(listContexts).toHaveBeenCalledWith({ type: "resume", search: "", prefix: true, limit: 4 });
    });

    await user.keyboard("资料");
    expect(await screen.findByRole("option", { name: /资料1\.md/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /资料1\.md/ }).querySelector(".lucide-database")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /资料2\.pdf/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(listContexts).toHaveBeenCalledWith({ type: "dataset", search: "资料", prefix: true, limit: 4 });
      expect(listContexts).toHaveBeenCalledWith({ type: "resume", search: "资料", prefix: true, limit: 4 });
    });

    await user.keyboard("{Tab}");
    expect(screen.queryByRole("listbox", { name: "可引用的资料和简历" })).not.toBeInTheDocument();
    const editor = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    expect(editor).toHaveTextContent("资料1.md");
    const token = editor.querySelector('[data-context-value="@资料1.md"]');
    expect(token).toBeInTheDocument();
    expect(screen.queryByLabelText("已选上下文")).not.toBeInTheDocument();

    await user.keyboard("这是什么");
    const range = document.createRange();
    range.setStartBefore(token!);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await user.keyboard("你好 ");
    expect(editor).toHaveTextContent("你好 资料1.md 这是什么");
  });

  it("中文输入法组合期间不重设光标，确认候选词后再同步输入", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });

    render(<AssistantPage />);
    const editor = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    editor.focus();
    const focus = vi.spyOn(editor, "focus");

    fireEvent.compositionStart(editor);
    editor.textContent = "n";
    fireEvent.input(editor, { data: "n", inputType: "insertCompositionText", isComposing: true });
    editor.textContent = "ni";
    fireEvent.input(editor, { data: "i", inputType: "insertCompositionText", isComposing: true });

    expect(focus).not.toHaveBeenCalled();
    expect(editor).toHaveTextContent("ni");

    editor.textContent = "你";
    fireEvent.compositionEnd(editor, { data: "你" });

    expect(editor).toHaveTextContent("你");
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  it("粘贴消息气泡文字时只保留纯文本，不带入来源 HTML 样式", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });

    render(<AssistantPage />);
    const editor = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(editor, "前后");
    const textNode = editor.firstChild;
    expect(textNode).not.toBeNull();
    const range = document.createRange();
    range.setStart(textNode!, 1);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => type === "text/plain"
          ? "复制内容"
          : '<span style="background:#f1f2f3;text-shadow:1px 1px #000">复制内容</span>',
      },
    });

    await waitFor(() => expect(editor).toHaveTextContent("前复制内容后"));
    expect(editor.querySelector("span")).not.toBeInTheDocument();
    expect(editor.innerHTML).not.toContain("background");
    expect(editor.innerHTML).not.toContain("text-shadow");
  });

  it("模型菜单展示当前绑定的真实模型，不伪造可切换项", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });

    render(<AssistantPage />);

    await user.click(await screen.findByRole("button", { name: "deepseek/deepseek-v4-flash" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: /deepseek\/deepseek-v4-flash/ })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByText("openai · 当前模型")).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(1);
  });

  it("点击模型选择器外部时收起模型菜单", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });

    render(<AssistantPage />);

    await user.click(await screen.findByRole("button", { name: "deepseek/deepseek-v4-flash" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByText("你好，今天想完成什么？"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("输入内容前禁用发送，输入内容后启用发送", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });

    render(<AssistantPage />);

    const sendButton = await screen.findByRole("button", { name: "发送" });
    expect(sendButton).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "你好");

    expect(sendButton).toBeEnabled();
  });

  it("当前模型查询失败时明确显示不可用，不回退为虚构模型", async () => {
    vi.mocked(api.getAgentModel).mockRejectedValueOnce(new Error("unavailable"));
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });

    render(<AssistantPage />);

    expect(await screen.findByRole("button", { name: "模型不可用" })).toBeInTheDocument();
    expect(screen.queryByText("LinkResume AI")).not.toBeInTheDocument();
  });

  it("展示结构化澄清并按 AgentPanel 格式携带回答序号提交", async () => {
    const user = userEvent.setup();
    const clarification = {
      version: 1 as const,
      questions: [
        {
          id: "scope",
          header: "修改范围",
          question: "你希望修改哪段经历？",
          allow_custom: false,
          options: [{ id: "project", label: "项目经历" }, { id: "work", label: "工作经历" }],
        },
        {
          id: "role",
          header: "目标岗位",
          question: "你准备投递什么岗位？",
          allow_custom: true,
          options: [{ id: "backend", label: "后端开发" }, { id: "frontend", label: "前端开发" }],
        },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        messages: [
          { sequence_no: 1, role: "user", content: "请帮我优化", created_at: session.created_at },
          { sequence_no: 2, role: "assistant", message_type: "clarification", clarification, content: "继续前需要确认：", created_at: session.created_at },
        ],
      },
    });
    const stream = vi.spyOn(api, "streamAgentMessage").mockImplementationOnce(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "clarification.requested", runId: "run-1", clarification });
      onEvent({ type: "assistant.delta", runId: "run-1", delta: "继续前需要确认：" });
      onEvent({ type: "run.completed", runId: "run-1" });
    }).mockImplementationOnce(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-2" });
      onEvent({ type: "assistant.delta", runId: "run-2", delta: "收到回答" });
      onEvent({ type: "run.completed", runId: "run-2" });
    });

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请帮我优化");
    await user.click(screen.getByRole("button", { name: "发送" }));

    const clarificationRegion = await screen.findByRole("region", { name: "需要你确认" });
    expect(clarificationRegion).toHaveTextContent("你希望修改哪段经历？");
    expect(clarificationRegion).toHaveTextContent("1 / 2");
    await user.click(screen.getByRole("button", { name: "收起主动询问" }));
    expect(screen.getByRole("button", { name: "展开主动询问" })).toHaveAttribute("aria-expanded", "false");
    expect(clarificationRegion).not.toHaveTextContent("你希望修改哪段经历？");
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开主动询问" }));
    expect(screen.getByRole("button", { name: "收起主动询问" })).toHaveAttribute("aria-expanded", "true");
    expect(clarificationRegion).toHaveTextContent("你希望修改哪段经历？");
    await user.click(screen.getByRole("radio", { name: /项目经历/ }));
    await user.click(screen.getByRole("button", { name: /下一题/ }));
    expect(clarificationRegion).toHaveTextContent("2 / 2");
    expect(clarificationRegion).toHaveTextContent("你准备投递什么岗位？");
    const customAnswer = screen.getByRole("textbox", { name: "目标岗位的其他回答" });
    expect(customAnswer).toBeVisible();
    await user.type(customAnswer, "自定义岗位");
    expect(screen.getByRole("radio", { name: /其他/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(stream.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      content: "修改范围：项目经历\n目标岗位：自定义岗位",
      reply_to_sequence_no: 2,
      clarification_answers: [
        { question_id: "scope", option_id: "project" },
        { question_id: "role", option_id: "__other__", value: "自定义岗位" },
      ],
    }));
  });

  it("发送时保留展示快照，但只向 Agent 发送精简上下文引用", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "listAgentContexts").mockResolvedValue({
      contexts: [{
        type: "resume",
        id: "1",
        version: "3",
        label: "我的简历",
        updated_at: "2026-08-26T05:00:00Z",
      }],
    });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        title: "优化我的简历",
        messages: [
          { sequence_no: 1, role: "user", content: "请优化我的简历", contexts: [], created_at: session.created_at },
          { sequence_no: 2, role: "assistant", content: "我会先分析经历和目标。", created_at: session.created_at },
        ],
      },
    });
    const stream = vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "run.phase", runId: "run-1", phase: "loading_context", referencedContextCount: 1 });
      onEvent({ type: "assistant.delta", runId: "run-1", delta: "我会先分析经历和目标。" });
      onEvent({ type: "run.completed", runId: "run-1" });
    });

    render(<AssistantPage />);
    await user.click(screen.getByRole("button", { name: "添加资料" }));
    const contextPicker = await screen.findByRole("dialog", { name: "选择资料" });
    await user.click(within(contextPicker).getByRole("button", { name: /我的简历/ }));
    await user.click(screen.getByRole("button", { name: "添加 1 项" }));
    const input = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请优化我的简历");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      contexts: [{ type: "resume", id: "1", version: "3", presentation: "mention" }],
    }));
    expect(await screen.findByText("我会先分析经历和目标。")).toBeInTheDocument();
    expect(screen.getByText("我会先分析经历和目标。").closest(".assistant-message")?.querySelector(".assistant-message-feather")).toBeNull();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBeEmptyDOMElement());
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }).querySelector("[data-context-key]")).not.toBeInTheDocument();
    expect(screen.queryByText("对话已完成")).not.toBeInTheDocument();
    expect(screen.queryByText("你可以继续追问，或确认待处理的简历修改提案。")).not.toBeInTheDocument();
  });

  it("提案展示目标简历名称和全部真实前后差异", async () => {
    const user = userEvent.setup();
    const proposal: AgentProposal = {
      id: "proposal-1",
      run_id: "run-1",
      resume_id: "1",
      base_lock_version: 3,
      data: defaultCanonicalDocument,
      style: defaultCanonicalPresentation,
      summary: "突出量化成果",
      operations: [
        {
          op: "replace_target_text",
          target: { selected_text: "负责接口性能优化" },
          new_text: "将接口 P95 延迟降低 32%",
          expected_text_hash: `sha256:${"a".repeat(64)}`,
        },
        {
          op: "replace_target_text",
          target: { selected_text: "参与订单服务开发" },
          new_text: "主导订单服务重构",
          expected_text_hash: `sha256:${"b".repeat(64)}`,
        },
        {
          op: "delete_target",
          target: { selected_text: "1" },
          new_text: "",
          expected_text_hash: `sha256:${"c".repeat(64)}`,
        },
      ],
      status: "pending",
      applied_lock_version: null,
      expires_at: "2026-08-27T08:00:00Z",
      created_at: session.created_at,
    };
    const proposalSession: AgentSession = {
      ...session,
      title: "简历优化提案",
      messages: [
        {
          sequence_no: 1,
          role: "user",
          content: "先分析岗位",
          contexts: [{ type: "job", id: "9", label: "旧一轮岗位资料" }],
          created_at: "2026-08-26T04:59:00Z",
        },
        {
          sequence_no: 2,
          role: "assistant",
          content: "已完成岗位分析",
          created_at: "2026-08-26T04:59:30Z",
        },
        {
          sequence_no: 3,
          role: "user",
          content: "请优化简历",
          contexts: [{
            type: "resume",
            id: "1",
            resume_id: "1",
            version: "3",
            label: "张三的后端简历",
          }],
          created_at: session.created_at,
        },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [proposalSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: proposalSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [proposal, { ...proposal, id: "proposal-2", summary: "第二项修改", operations: [{ ...proposal.operations![0], new_text: "另一项优化内容" }] }] });

    render(<AssistantPage />);
    await user.click(await screen.findByRole("button", { name: "简历优化提案" }));

    expect(window.location.pathname).toBe("/assistant/session-1");
    const recallToggle = screen.getByRole("button", { name: "展开对话资料" });
    expect(recallToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "最新一轮对话的引用资料与修改内容" })).not.toBeInTheDocument();

    await user.click(recallToggle);

    const recallDrawer = screen.getByRole("complementary", { name: "最新一轮对话的引用资料与修改内容" });
    expect(within(recallDrawer).getByText("引用资料")).toBeInTheDocument();
    expect(within(recallDrawer).getByText("1 项")).toBeInTheDocument();
    expect(within(recallDrawer).getByText("修改内容")).toBeInTheDocument();
    expect(within(recallDrawer).getByText("1 个文件")).toBeInTheDocument();
    expect(within(recallDrawer).getAllByText("张三的后端简历")).toHaveLength(2);
    expect(within(recallDrawer).queryByText("旧一轮岗位资料")).not.toBeInTheDocument();

    const referencesToggle = within(recallDrawer).getByRole("button", { name: "展开引用资料" });
    const modificationsToggle = within(recallDrawer).getByRole("button", { name: "展开修改内容" });
    expect(referencesToggle).toHaveAttribute("aria-expanded", "false");
    expect(modificationsToggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("assistant-recall-references")).not.toBeVisible();
    expect(document.getElementById("assistant-recall-modifications")).not.toBeVisible();

    await user.click(referencesToggle);
    expect(referencesToggle).toHaveAttribute("aria-expanded", "true");
    expect(referencesToggle).toHaveAccessibleName("收起引用资料");
    expect(document.getElementById("assistant-recall-references")).toBeVisible();
    expect(document.getElementById("assistant-recall-modifications")).not.toBeVisible();

    await user.click(modificationsToggle);
    expect(modificationsToggle).toHaveAttribute("aria-expanded", "true");
    expect(modificationsToggle).toHaveAccessibleName("收起修改内容");
    expect(document.getElementById("assistant-recall-modifications")).toBeVisible();

    await user.click(referencesToggle);
    await user.click(modificationsToggle);
    expect(document.getElementById("assistant-recall-references")).not.toBeVisible();
    expect(document.getElementById("assistant-recall-modifications")).not.toBeVisible();

    expect(screen.getByText("负责接口性能优化")).toBeInTheDocument();
    expect(screen.getByText("将接口 P95 延迟降低 32%")).toBeInTheDocument();
    expect(screen.getByText("参与订单服务开发")).toBeInTheDocument();
    expect(screen.getByText("主导订单服务重构")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("删除该条目")).toBeInTheDocument();

    expect(screen.getByText("1 / 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "上一项修改" })).toBeDisabled();
    expect(screen.queryByText("另一项优化内容")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一项修改" }));
    expect(screen.getByText("另一项优化内容")).toBeVisible();
    expect(screen.queryByText("将接口 P95 延迟降低 32%")).not.toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "下一项修改" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "收起修改" }));
    expect(screen.getByText("另一项优化内容")).not.toBeVisible();
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBeVisible();
    expect(screen.getByText("确认后才会写入简历")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2 项修改待确认 · 查看修改" }));
    expect(screen.getByText("另一项优化内容")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "上一项修改" }));
    expect(screen.getByText("将接口 P95 延迟降低 32%")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收起对话资料" }));
    expect(screen.queryByRole("complementary", { name: "最新一轮对话的引用资料与修改内容" })).not.toBeInTheDocument();

    const stream = vi.spyOn(api, "streamAgentMessage").mockResolvedValue(undefined);
    const reject = vi.spyOn(api, "rejectAgentProposal");
    vi.mocked(api.getAgentSession).mockResolvedValue({ session: { ...proposalSession, messages: [
      ...proposalSession.messages,
      { role: "user", sequence_no: 4, run_id: "run-2", content: "解释一下缓存", created_at: "2026-08-27T09:00:00Z" },
      { role: "assistant", sequence_no: 5, run_id: "run-2", content: "缓存说明", created_at: "2026-08-27T09:01:00Z" },
    ] } });
    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "解释一下缓存");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("缓存说明");
    expect(stream).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "收起修改" })).not.toBeInTheDocument();
    expect(reject).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "2 项修改待确认 · 查看修改" }));
    expect(screen.getByText("历史修改建议 · 2 项待确认修改")).toBeVisible();
    expect(screen.getByText("将接口 P95 延迟降低 32%")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续调整" }));
    expect(screen.getByText("继续调整所选修改建议")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(stream.mock.calls[1][1].revision_proposal_id).toBe("proposal-1");
  });

  it("生成中只保留输入区的停止入口，并保留已显示内容", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "assistant.delta", runId: "run-1", delta: "已显示的部分回复" });
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    vi.spyOn(api, "cancelAgentRun").mockResolvedValue({ run_id: "run-1", status: "cancelled" });

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请分析");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(api.streamAgentMessage).toHaveBeenCalledOnce());
    expect(await screen.findByText("已显示的部分回复")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "停止生成" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "停止生成" }));
    expect(await screen.findByText("已停止生成")).toBeInTheDocument();
  });

  it("在思考区累计工具阶段文字，并在最终正文开始前一次清空", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "listAgentContexts").mockResolvedValue({ contexts: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        messages: [
          { sequence_no: 1, role: "user", content: "准备面试", created_at: session.created_at },
          { sequence_no: 2, role: "assistant", content: "面试重点包括项目证据。", created_at: session.created_at },
        ],
      },
    });
    let beginFinalResponse!: () => void;
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-activity" });
      onEvent({ type: "assistant.activity.delta", runId: "run-activity", delta: "I'll read the router skill." });
      onEvent({ type: "assistant.activity.delta", runId: "run-activity", delta: "\n读取授权简历上下文…\n" });
      onEvent({ type: "assistant.activity.delta", runId: "run-activity", delta: "\nI'll inspect the resume." });
      await new Promise<void>((resolve) => {
        beginFinalResponse = resolve;
      });
      onEvent({ type: "assistant.activity.clear", runId: "run-activity" });
      onEvent({ type: "assistant.delta", runId: "run-activity", delta: "面试重点包括" });
      onEvent({ type: "assistant.delta", runId: "run-activity", delta: "项目证据。" });
      onEvent({ type: "run.completed", runId: "run-activity" });
    });

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "准备面试");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("I'll inspect the resume.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看过程" }));
    expect(screen.getByText(/I'll read the router skill\.[\s\S]*读取授权简历上下文…[\s\S]*I'll inspect the resume\./)).toBeInTheDocument();

    await act(async () => beginFinalResponse());
    expect(await screen.findByText("面试重点包括项目证据。")).toBeInTheDocument();
    expect(screen.queryByText("I'll inspect the resume.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看过程" })).not.toBeInTheDocument();
  });

  it("按 callKey 原位更新修改任务状态，不重复堆叠同一步骤", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        messages: [{ sequence_no: 1, role: "user", content: "清理占位内容", created_at: session.created_at }],
      },
    });
    let finishStream!: () => void;
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-plan" });
      onEvent({ type: "assistant.activity.delta", runId: "run-plan", delta: "\n串行执行简历修改计划…\n" });
      onEvent({
        type: "assistant.activity.status",
        runId: "run-plan",
        callKey: "plan:task:1",
        label: "修改任务 1/2：定位内容",
        status: "running",
      });
      onEvent({
        type: "assistant.activity.status",
        runId: "run-plan",
        callKey: "plan:task:1",
        label: "修改任务 1/2：已生成待确认修改",
        status: "succeeded",
      });
      await new Promise<void>((resolve) => { finishStream = resolve; });
      onEvent({ type: "run.completed", runId: "run-plan" });
    });

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "清理占位内容");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("修改任务 1/2：已生成待确认修改 ✓")).toBeInTheDocument();
    expect(screen.queryByText("修改任务 1/2：定位内容…")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看过程" }));
    expect(screen.getAllByText("修改任务 1/2：已生成待确认修改 ✓")).toHaveLength(2);
    finishStream();
  });

  it("发送后不在消息区顶部重复展示召回状态标题", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    let finishStream: () => void = () => {};
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "run.phase", runId: "run-1", phase: "loading_context", referencedContextCount: 0 });
      await new Promise<void>((resolve) => {
        finishStream = resolve;
      });
      onEvent({ type: "run.completed", runId: "run-1" });
    });

    const { container } = render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "你好");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("正在读取所选资料…")).toBeInTheDocument();
    expect(screen.queryByText("正在召回相关资料")).not.toBeInTheDocument();
    expect(container.querySelector(".assistant-state-header")).not.toBeInTheDocument();

    finishStream();
    await waitFor(() => expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument());
  });

  it("暂停后不把已发送 query 回填输入框，手动重试也不会重复用户消息", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "streamAgentMessage")
      .mockImplementationOnce(async (_id, _payload, signal, onEvent) => {
        onEvent({ type: "run.started", runId: "run-1" });
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      })
      .mockRejectedValueOnce(new ApiRequestError(409, "AGENT_RUN_IN_PROGRESS"));
    let finishCancellation: () => void = () => {};
    vi.spyOn(api, "cancelAgentRun").mockImplementation(() => new Promise((resolve) => {
      finishCancellation = () => resolve({ run_id: "run-1", status: "cancelled" });
    }));

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "润色项目经历");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(await screen.findByRole("button", { name: "停止生成" }));

    const clearedInput = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    expect(clearedInput).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getAllByText("润色项目经历")).toHaveLength(1);

    await act(async () => {
      finishCancellation();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "润色项目经历");
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(api.streamAgentMessage).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("润色项目经历")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toHaveTextContent("润色项目经历");
  });

  it("流失败时保留已显示回复与可重试草稿", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "assistant.delta", runId: "run-1", delta: "未完成的回复" });
      throw new Error("network disconnected");
    });

    const { container } = render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请分析");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(api.streamAgentMessage).toHaveBeenCalledOnce());
    expect(await screen.findByText("未完成的回复")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("请稍后重试");
    expect(alert).toHaveClass("ui-feedback-notice", "is-floating");
    expect(alert.parentElement).toBe(document.body);
    expect(container.querySelector(".assistant-error-notice")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toHaveTextContent("请分析");
  });

  it("收到 run.cancelled 后刷新会话仍保留停止终态", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        messages: [{ sequence_no: 1, role: "user", content: "请分析", created_at: session.created_at }],
      },
    });
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "assistant.delta", runId: "run-1", delta: "已生成部分" });
      onEvent({ type: "run.cancelled", runId: "run-1" });
    });

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请分析");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(api.streamAgentMessage).toHaveBeenCalledOnce());
    expect(await screen.findByText("已生成部分")).toBeInTheDocument();
    expect(await screen.findByText("已停止生成")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBeEmptyDOMElement();
  });

  it("用户上移消息区时新增消息不抢滚动", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: { ...session, messages: [] },
    });
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "assistant.delta", runId: "run-1", delta: "新的回复" });
      onEvent({ type: "run.completed", runId: "run-1" });
    });

    const { container } = render(<AssistantPage />);
    const viewport = container.querySelector<HTMLDivElement>(".assistant-message-viewport");
    expect(viewport).not.toBeNull();
    if (!viewport) return;
    const scrollTo = vi.fn();
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      scrollTo: { configurable: true, writable: true, value: scrollTo },
    });
    fireEvent.scroll(viewport);

    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请分析");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(api.streamAgentMessage).toHaveBeenCalledOnce());
    expect(await screen.findByText("新的回复")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
