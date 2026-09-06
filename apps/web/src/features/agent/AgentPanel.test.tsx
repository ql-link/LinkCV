import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type AgentProposal, type AgentSession } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
import { AgentMarkdown, AgentPanel, AgentUserAvatar } from "./AgentPanel";

const session: AgentSession = {
  id: "session-1",
  resume_id: "resume-1",
  title: "简历助手",
  pinned: false,
  status: "active",
  last_message_at: null,
  created_at: "2026-08-20T08:00:00Z",
  updated_at: "2026-08-20T08:00:00Z",
  messages: [],
};

const proposal: AgentProposal = {
  id: "proposal-1",
  run_id: "run-1",
  resume_id: "resume-1",
  base_lock_version: 2,
  data: defaultCanonicalDocument,
  style: defaultCanonicalPresentation,
  summary: "突出项目中的量化成果",
  status: "pending",
  applied_lock_version: null,
  expires_at: "2026-08-27T08:00:00Z",
  created_at: "2026-08-20T08:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AgentPanel", () => {
  it("渲染常用 Markdown 块级与行内语法并阻止原始 HTML 执行", () => {
    const { container } = render(<AgentMarkdown content={`# 一级标题

---

| 位置 | 建议 |
| --- | --- |
| 项目 | **补充量化结果** |

1. 第一项
2. 第二项

> 引用说明

[参考链接](https://example.com) 与 ~~删除内容~~、\`行内代码\`

\`\`\`ts
const value = 1;
\`\`\`

![远程图片](https://example.com/image.png)

<script>alert("unsafe")</script>`} />);

    expect(screen.getByRole("heading", { level: 2, name: "一级标题" })).toHaveClass("is-level-1");
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "位置" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "补充量化结果" })).toBeInTheDocument();
    expect(screen.getByText("第一项")).toBeInTheDocument();
    expect(screen.getByText("第二项")).toBeInTheDocument();
    expect(container.querySelector("blockquote")).toHaveTextContent("引用说明");
    expect(screen.getByRole("link", { name: "参考链接" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.querySelector("s")).toHaveTextContent("删除内容");
    expect(container.querySelector("pre code")).toHaveTextContent("const value = 1;");
    expect(screen.getByRole("img", { name: "远程图片" })).toHaveTextContent("[图片：远程图片]");
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container).toHaveTextContent('<script>alert("unsafe")</script>');
  });

  it("用户消息头像使用当前用户图片，并在缺少图片时回退到昵称首字", async () => {
    class LoadedImage extends EventTarget {
      complete = true;
      naturalWidth = 32;
      crossOrigin: string | null = null;
      referrerPolicy = "";
      src = "";
    }
    vi.stubGlobal("Image", LoadedImage);

    const { rerender } = render(<AgentUserAvatar avatarUrl="/api/assets/user-avatar.png" displayName="测试用户" />);
    expect(await screen.findByRole("img", { name: "测试用户的头像" })).toHaveAttribute("src", "/api/assets/user-avatar.png");

    rerender(<AgentUserAvatar avatarUrl={null} displayName="测试用户" />);
    expect(screen.getByLabelText("测试用户的头像")).toHaveTextContent("测");
  });

  it("使用截图对应的欢迎语、快捷操作和紧凑输入入口", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });

    render(
      <AgentPanel
        resumeId="resume-1"
        onBeforeConfirm={vi.fn().mockResolvedValue(true)}
        onApplied={vi.fn()}
      />,
    );

    expect(await screen.findByText("你好！我是你的 AI 简历助手")).toBeInTheDocument();
    expect(screen.getByText("智能优化，高效提升")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "优化内容" }));
    expect(screen.getByLabelText("告诉助手你想改善什么")).toHaveValue("让经历更贴合目标岗位");
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  it("把选中文字作为上下文带入真实 Agent 请求", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session });
    const streamMessage = vi.spyOn(api, "streamAgentMessage").mockResolvedValue(undefined);
    const onBeforeRun = vi.fn().mockResolvedValue(true);
    const selectionContext = {
      block_ids: ["blk_1234567890abcdef"],
      from: 10,
      to: 19,
      selected_text: "负责平台性能优化",
      selected_text_hash: `sha256:${"a".repeat(64)}`,
    };

    render(
      <AgentPanel
        resumeId="resume-1"
        draft={{ id: 1, instruction: "优化表达", selectionContext }}
        onBeforeRun={onBeforeRun}
        onBeforeConfirm={vi.fn().mockResolvedValue(true)}
        onApplied={vi.fn()}
      />,
    );

    expect(await screen.findByText("已选内容")).toBeInTheDocument();
    expect(screen.getByText("负责平台性能优化")).toBeInTheDocument();
    expect(screen.getByLabelText("告诉助手你想改善什么")).toHaveValue("优化表达");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(streamMessage).toHaveBeenCalled());
    expect(onBeforeRun).toHaveBeenCalledOnce();
    expect(streamMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      content: "优化表达",
      selection_context: selectionContext,
    }));
  });

  it("流式展示回答与提案，并在用户确认后应用到简历", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [proposal] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        messages: [
          { sequence_no: 1, role: "user", content: "帮我优化项目经历", created_at: session.created_at },
          { sequence_no: 2, role: "assistant", content: "我整理了一份修改提案。", created_at: session.created_at },
        ],
      },
    });
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "assistant.delta", runId: "run-1", delta: "我整理了一份修改提案。" });
      onEvent({ type: "proposal.created", runId: "run-1", proposal });
      onEvent({ type: "run.completed", runId: "run-1" });
    });
    const confirm = vi.spyOn(api, "confirmAgentProposal").mockResolvedValue({ resume: {} as never });
    const onBeforeConfirm = vi.fn().mockResolvedValue(true);
    const onApplied = vi.fn().mockResolvedValue(undefined);

    render(<AgentPanel resumeId="resume-1" onBeforeConfirm={onBeforeConfirm} onApplied={onApplied} />);

    expect(await screen.findByText("你好！我是你的 AI 简历助手")).toBeInTheDocument();
    await user.type(screen.getByLabelText("告诉助手你想改善什么"), "帮我优化项目经历");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("我整理了一份修改提案。")).toBeInTheDocument();
    expect(screen.getByText("突出项目中的量化成果")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "应用到简历" }));

    await waitFor(() => expect(onBeforeConfirm).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith("proposal-1");
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("保存当前编辑失败时不应用提案", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [session] });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [proposal] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session });
    const confirm = vi.spyOn(api, "confirmAgentProposal");

    render(
      <AgentPanel
        resumeId="resume-1"
        onBeforeConfirm={vi.fn().mockResolvedValue(false)}
        onApplied={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "历史对话" }));
    await user.click(await screen.findByRole("button", { name: /简历助手/ }));
    expect(await screen.findByText("突出项目中的量化成果")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "应用到简历" }));
    await waitFor(() => expect(confirm).not.toHaveBeenCalled());
  });

  it("默认打开空白新对话，并且只在用户进入历史记录后加载旧会话", async () => {
    const user = userEvent.setup();
    const listSessions = vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [session] });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    const getSession = vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        messages: [{
          sequence_no: 1,
          role: "assistant",
          content: "这是历史对话",
          created_at: session.created_at,
        }],
      },
    });

    render(
      <AgentPanel
        resumeId="resume-1"
        onBeforeConfirm={vi.fn().mockResolvedValue(true)}
        onApplied={vi.fn()}
      />,
    );
    expect(await screen.findByText("你好！我是你的 AI 简历助手")).toBeInTheDocument();
    expect(listSessions).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "历史对话" }));
    expect(await screen.findByRole("button", { name: /简历助手/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /简历助手/ }));

    expect(await screen.findByText("这是历史对话")).toBeInTheDocument();
    expect(getSession).toHaveBeenCalledWith("session-1");
    expect(api.listAgentProposals).toHaveBeenCalledWith("resume-1", "session-1");
  });

  it("把结构化澄清问题显示在输入框上方，并携带问题序号提交完整回答", async () => {
    const user = userEvent.setup();
    const clarification = {
      version: 1 as const,
      questions: [
        {
          id: "experience",
          header: "修改范围",
          question: "你希望修改哪段经历？",
          options: [
            { id: "internship", label: "实习经历", description: "只处理最近一段实习" },
            { id: "project", label: "项目经历", description: "只处理项目内容" },
          ],
        },
        {
          id: "target_role",
          header: "目标岗位",
          question: "你准备投递什么岗位？",
          options: [
            { id: "operation", label: "用户运营" },
            { id: "product", label: "产品经理" },
          ],
        },
      ],
    };
    const clarificationSession = {
      ...session,
      messages: [
        { sequence_no: 1, role: "user" as const, content: "让经历更贴合目标岗位", created_at: session.created_at },
        {
          sequence_no: 2,
          role: "assistant" as const,
          message_type: "clarification" as const,
          clarification,
          content: "需要补充修改范围和目标岗位。",
          created_at: session.created_at,
        },
      ],
    };
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession")
      .mockResolvedValueOnce({ session: clarificationSession })
      .mockResolvedValueOnce({
        session: {
          ...session,
          messages: [
            ...clarificationSession.messages,
            { sequence_no: 3, role: "user", content: "修改范围：实习经历\n目标岗位：用户运营", created_at: session.created_at },
          ],
        },
      });
    const streamMessage = vi.spyOn(api, "streamAgentMessage")
      .mockImplementationOnce(async (_id, _payload, _signal, onEvent) => {
        onEvent({ type: "run.started", runId: "run-1" });
        onEvent({ type: "clarification.requested", runId: "run-1", clarification });
        onEvent({ type: "run.completed", runId: "run-1" });
      })
      .mockResolvedValueOnce(undefined);

    render(
      <AgentPanel
        resumeId="resume-1"
        onBeforeConfirm={vi.fn().mockResolvedValue(true)}
        onApplied={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("告诉助手你想改善什么"), "让经历更贴合目标岗位");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("region", { name: "需要你确认" })).toBeInTheDocument();
    expect(screen.getByLabelText("告诉助手你想改善什么")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "提交回答" }));
    expect(screen.getAllByText("请选择一个选项或填写其他答案。")).toHaveLength(2);
    await user.click(screen.getByRole("radio", { name: /实习经历/ }));
    await user.click(screen.getByRole("radio", { name: /用户运营/ }));
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    await waitFor(() => expect(streamMessage).toHaveBeenCalledTimes(2));
    expect(streamMessage.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      content: "修改范围：实习经历\n目标岗位：用户运营",
      reply_to_sequence_no: 2,
    }));
  });

  it("新建对话后忽略上一条流式请求迟到的消息和提案", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    let emitLateEvent: ((event: Parameters<Parameters<typeof api.streamAgentMessage>[3]>[0]) => void) | undefined;
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      emitLateEvent = onEvent;
      onEvent({ type: "run.started", runId: "run-old" });
      await new Promise(() => undefined);
    });
    vi.spyOn(api, "cancelAgentRun").mockResolvedValue({ run_id: "run-old", status: "cancelled" });

    render(
      <AgentPanel
        resumeId="resume-1"
        onBeforeConfirm={vi.fn().mockResolvedValue(true)}
        onApplied={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("告诉助手你想改善什么"), "旧对话请求");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(emitLateEvent).toBeDefined());
    await user.click(screen.getByRole("button", { name: "新建对话" }));

    emitLateEvent?.({ type: "assistant.delta", runId: "run-old", delta: "不应出现的旧回答" });
    emitLateEvent?.({ type: "proposal.created", runId: "run-old", proposal });

    expect(screen.getByText("你好！我是你的 AI 简历助手")).toBeInTheDocument();
    expect(screen.queryByText("不应出现的旧回答")).not.toBeInTheDocument();
    expect(screen.queryByText("突出项目中的量化成果")).not.toBeInTheDocument();
  });
});
