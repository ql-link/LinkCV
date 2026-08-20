import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type AgentProposal, type AgentSession } from "../../api/client";
import { defaultSemanticDocument, defaultSemanticStyle } from "../../api/resumeContract";
import { AgentPanel } from "./AgentPanel";

const session: AgentSession = {
  id: "session-1",
  resume_id: "resume-1",
  title: "简历助手",
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
  data: defaultSemanticDocument,
  style: defaultSemanticStyle,
  summary: "突出项目中的量化成果",
  status: "pending",
  applied_lock_version: null,
  expires_at: "2026-08-27T08:00:00Z",
  created_at: "2026-08-20T08:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentPanel", () => {
  it("流式展示回答与提案，并在用户确认后应用到简历", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
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

    expect(await screen.findByText("从一个具体目标开始")).toBeInTheDocument();
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
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [proposal] });
    const confirm = vi.spyOn(api, "confirmAgentProposal");

    render(
      <AgentPanel
        resumeId="resume-1"
        onBeforeConfirm={vi.fn().mockResolvedValue(false)}
        onApplied={vi.fn()}
      />,
    );

    expect(await screen.findByText("突出项目中的量化成果")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "应用到简历" }));
    await waitFor(() => expect(confirm).not.toHaveBeenCalled());
  });

  it("切换简历时清除旧会话，并且只向新简历会话发送消息", async () => {
    const user = userEvent.setup();
    const secondSession = { ...session, id: "session-2", resume_id: "resume-2" };
    let resolveSecondSessions: ((value: { sessions: AgentSession[] }) => void) | undefined;
    const secondSessions = new Promise<{ sessions: AgentSession[] }>((resolve) => {
      resolveSecondSessions = resolve;
    });
    vi.spyOn(api, "listAgentSessions").mockImplementation((resumeId) => (
      resumeId === "resume-1" ? Promise.resolve({ sessions: [session] }) : secondSessions
    ));
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "getAgentSession").mockImplementation(async (sessionId) => ({
      session: sessionId === session.id
        ? {
            ...session,
            messages: [{
              sequence_no: 1,
              role: "assistant",
              content: "这是旧简历的对话",
              created_at: session.created_at,
            }],
          }
        : secondSession,
    }));
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session: secondSession });
    const streamMessage = vi.spyOn(api, "streamAgentMessage").mockResolvedValue(undefined);

    const rendered = render(
      <AgentPanel
        resumeId="resume-1"
        onBeforeConfirm={vi.fn().mockResolvedValue(true)}
        onApplied={vi.fn()}
      />,
    );
    expect(await screen.findByText("这是旧简历的对话")).toBeInTheDocument();

    rendered.rerender(
      <AgentPanel
        resumeId="resume-2"
        onBeforeConfirm={vi.fn().mockResolvedValue(true)}
        onApplied={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("这是旧简历的对话")).not.toBeInTheDocument();
      expect(screen.getByLabelText("告诉助手你想改善什么")).toBeDisabled();
    });
    resolveSecondSessions?.({ sessions: [] });
    expect(await screen.findByText("从一个具体目标开始")).toBeInTheDocument();

    await user.type(screen.getByLabelText("告诉助手你想改善什么"), "只修改第二份简历");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(streamMessage).toHaveBeenCalled());
    expect(api.createAgentSession).toHaveBeenCalledWith("resume-2");
    expect(streamMessage.mock.calls[0]?.[0]).toBe("session-2");
    expect(streamMessage).not.toHaveBeenCalledWith(
      "session-1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
