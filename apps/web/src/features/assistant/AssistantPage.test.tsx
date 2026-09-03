import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, type AgentContextSnapshot, type AgentProposal, type AgentSession } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
import { AssistantPage } from "./AssistantPage";

const session: AgentSession = {
  id: "session-1",
  resume_id: "1",
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
  vi.spyOn(api, "getAgentModel").mockResolvedValue({
    model: { adapter: "openai", name: "deepseek/deepseek-v4-flash" },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AssistantPage", () => {
  it("为每条历史对话提供置顶、重命名和删除菜单", async () => {
    const user = userEvent.setup();
    const listedSession = { ...session, title: "待整理对话", pinned: false };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [listedSession] });
    const updateSession = vi.spyOn(api, "updateAgentSession")
      .mockResolvedValueOnce({ session: { ...listedSession, pinned: true } })
      .mockResolvedValueOnce({ session: { ...listedSession, pinned: true, title: "新的对话名称" } });
    const deleteSession = vi.spyOn(api, "deleteAgentSession").mockResolvedValue(undefined);

    render(<AssistantPage />);

    await user.click(await screen.findByRole("button", { name: "待整理对话 的更多操作" }));
    const firstMenu = screen.getByRole("menu", { name: "待整理对话 的操作菜单" });
    expect(within(firstMenu).getByRole("menuitem", { name: "Pin" })).toBeInTheDocument();
    expect(within(firstMenu).getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(within(firstMenu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();

    await user.click(within(firstMenu).getByRole("menuitem", { name: "Pin" }));
    expect(updateSession).toHaveBeenNthCalledWith(1, "session-1", { pinned: true });

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

    expect(await screen.findByText("这是已恢复的回答")).toBeInTheDocument();
    expect(api.getAgentSession).toHaveBeenCalledWith("session-1");
    expect(window.location.pathname).toBe("/assistant/session-1");
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
    expect(screen.queryByText("LinkCV AI")).not.toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: /我的简历/ }));
    await user.click(screen.getByRole("button", { name: "添加 1 项" }));
    const input = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请优化我的简历");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      contexts: [{ type: "resume", id: "1", version: "3" }],
    }));
    expect(await screen.findByText("我会先分析经历和目标。")).toBeInTheDocument();
    expect(screen.getByText("我会先分析经历和目标。").closest(".assistant-message")?.querySelector(".assistant-message-feather")).toBeNull();
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
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [proposal] });

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

    await user.click(screen.getByRole("button", { name: "收起对话资料" }));
    expect(screen.queryByRole("complementary", { name: "最新一轮对话的引用资料与修改内容" })).not.toBeInTheDocument();
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
    expect(await screen.findByText("已显示的部分回复")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "停止生成" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "停止生成" }));
    expect(await screen.findByText("已停止生成")).toBeInTheDocument();
  });

  it("暂停后等待取消完成，重试不会重复用户消息或展示运行中提示", async () => {
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

    expect(input).toHaveTextContent("润色项目经历");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getAllByText("润色项目经历")).toHaveLength(2);

    finishCancellation();
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(api.streamAgentMessage).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("润色项目经历")).toHaveLength(2);
    expect(input).toHaveTextContent("润色项目经历");
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

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请分析");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("未完成的回复")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("请稍后重试");
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

    expect(await screen.findByText("已生成部分")).toBeInTheDocument();
    expect(await screen.findByText("已停止生成")).toBeInTheDocument();
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

    expect(await screen.findByText("新的回复")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
