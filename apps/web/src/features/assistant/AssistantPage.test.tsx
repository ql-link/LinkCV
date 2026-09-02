import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type AgentProposal, type AgentSession } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
import { AssistantPage } from "./AssistantPage";

const session: AgentSession = {
  id: "session-1",
  resume_id: "1",
  title: "新对话",
  status: "active",
  last_message_at: null,
  created_at: "2026-08-26T05:00:00Z",
  updated_at: "2026-08-26T05:00:00Z",
  messages: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AssistantPage", () => {
  it("空状态展示五个快捷任务，并在需要资料的任务中打开选择器", async () => {
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

    expect(await screen.findByText("你好，我是你的 AI 求职助手")).toBeInTheDocument();
    const workspace = screen.getByRole("region", { name: "AI 求职助手工作区" });
    expect(within(workspace).queryByRole("heading", { name: /^AI 求职助手$/ })).not.toBeInTheDocument();
    expect(within(workspace).queryByText("仅参考你主动添加的资料")).not.toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: "新建对话" })).not.toBeInTheDocument();
    for (const label of ["优化当前简历", "分析岗位匹配度", "提炼项目亮点", "准备面试问题", "复盘最近面试"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "分析岗位匹配度" }));
    expect(await screen.findByRole("dialog", { name: "选择上下文" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "岗位" }));
    await user.click(screen.getByRole("button", { name: /示例科技 · 后端工程师/ }));
    expect(screen.getByLabelText("已选上下文")).toHaveTextContent("示例科技 · 后端工程师");
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
    expect(clarificationRegion).toHaveTextContent("问题 1 / 2 · 修改范围");
    expect(clarificationRegion).toHaveTextContent("问题 2 / 2 · 目标岗位");
    await user.click(screen.getByRole("radio", { name: /项目经历/ }));
    await user.click(screen.getByRole("radio", { name: /其他/ }));
    await user.type(screen.getByRole("textbox", { name: "目标岗位的其他回答" }), "自定义岗位");
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
    await user.click(screen.getByRole("button", { name: "添加上下文" }));
    await user.click(await screen.findByRole("button", { name: /我的简历/ }));
    const input = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "请优化我的简历");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      contexts: [{ type: "resume", id: "1", version: "3" }],
    }));
    expect(await screen.findByText("我会先分析经历和目标。")).toBeInTheDocument();
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
      messages: [{
        sequence_no: 1,
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
      }],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [proposalSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: proposalSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [proposal] });

    render(<AssistantPage />);
    await user.click(await screen.findByRole("button", { name: /简历优化提案/ }));

    expect(await screen.findAllByText("张三的后端简历")).toHaveLength(2);
    expect(screen.getByText("负责接口性能优化")).toBeInTheDocument();
    expect(screen.getByText("将接口 P95 延迟降低 32%")).toBeInTheDocument();
    expect(screen.getByText("参与订单服务开发")).toBeInTheDocument();
    expect(screen.getByText("主导订单服务重构")).toBeInTheDocument();
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
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toHaveValue("请分析");
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
