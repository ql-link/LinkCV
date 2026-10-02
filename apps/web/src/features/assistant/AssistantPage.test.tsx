import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, type AgentContextSnapshot, type AgentProposal, type AgentSession } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
import { useResumeStore } from "../../store/resumeStore";
import { useActiveSessionStore, useSessionStore } from "../../v3/sessionStore";
import { AssistantPage, parseAgentTimestamp } from "./AssistantPage";

vi.mock("../datasets/DatasetsPage", () => ({
  DatasetsPage: ({ embedded }: { embedded?: boolean }) => (
    <section aria-label="嵌入式资料库" data-embedded={embedded ? "true" : "false"} />
  ),
}));

vi.mock("../preview/ResumePreview", () => ({
  ResumePreview: () => <section aria-label="简历只读预览" />,
}));

vi.mock("../workbench/ResumeWorkbench", () => ({
  ResumeWorkbench: ({ embedded, externalRefreshVersion, onClose, onAgentSelectionChange }: {
    embedded?: boolean;
    externalRefreshVersion?: number;
    onClose?: () => void;
    onAgentSelectionChange?: (context: {
      block_ids: string[];
      from: number;
      to: number;
      selected_text: string;
      selected_text_hash: string;
    }) => void;
  }) => (
    <section
      aria-label="嵌入式简历编辑器"
      data-embedded={embedded ? "true" : "false"}
      data-refresh-version={externalRefreshVersion ?? 0}
    >
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
  vi.spyOn(api, "getAgentModels").mockResolvedValue({ models: [{ id: "1", name: "deepseek/deepseek-v4-flash" }], defaultModelId: "1" });
  vi.spyOn(api, "getActiveAgentRun").mockResolvedValue({ run: null });
  // 侧栏与首页共用的会话列表存在全局 store 里，每个用例前清空
  useSessionStore.setState({ sessions: [], status: "idle", error: null, runningIds: [] });
  useActiveSessionStore.setState({ activeId: null });
  // 首页卡片数据：默认新用户（没有简历、没有面试和岗位）
  vi.spyOn(api, "getResumeOverview").mockResolvedValue({ resumes: [], active_imports: [], failed_imports: [] } as never);
  vi.spyOn(api, "listResumes").mockResolvedValue({ resumes: [] });
  vi.spyOn(api, "listInterviewSessions").mockResolvedValue({ items: [], next_cursor: null });
  vi.spyOn(api, "listJobApplications").mockResolvedValue({ items: [], next_cursor: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("AssistantPage", () => {
  it("首页数据未齐时只占位，不先显示通用问候或临时模型文案，输入草稿不受影响", async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.listInterviewSessions>>) => void;
    let finishModel!: (value: Awaited<ReturnType<typeof api.getAgentModels>>) => void;
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.mocked(api.listInterviewSessions).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.mocked(api.getAgentModels).mockReturnValue(new Promise((resolve) => { finishModel = resolve; }));
    const { container } = render(<AssistantPage />);
    await act(async () => undefined);
    expect(container.querySelector(".assistant-home-title")).toHaveTextContent("");
    expect(container.querySelector(".assistant-home-sub")).toHaveTextContent("");
    expect(container.querySelector(".assistant-model-trigger")).not.toHaveTextContent("正在读取模型");
    expect(screen.queryByText(/今天想推进什么/)).not.toBeInTheDocument();
    expect(screen.queryByText(/先准备第一份简历/)).not.toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    fireEvent.input(input, { target: { textContent: "未发送的草稿" } });
    await act(async () => { finish({ items: [], next_cursor: null }); finishModel({ models: [{ id: "1", name: "示例模型" }], defaultModelId: "1" }); });
    expect(await screen.findByRole("heading", { name: /先准备第一份简历/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "示例模型" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBe(input);
    expect(input).toHaveTextContent("未发送的草稿");
  });

  it("首页接口失败不会冒充没有安排，允许原位重试", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.mocked(api.listInterviewSessions).mockRejectedValueOnce(new Error("offline"));
    render(<AssistantPage />);
    expect(await screen.findByRole("heading", { name: "首页信息暂时无法读取" })).toBeInTheDocument();
    expect(screen.queryByText(/今天没有安排|先准备第一份简历/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: /先准备第一份简历/ })).toBeInTheDocument();
  });

  it("默认简历晚到时只添加引用标签，不重建正在输入的编辑区或丢失焦点", async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.getResumeOverview>>) => void;
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.mocked(api.getResumeOverview).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.spyOn(api, "getResume").mockResolvedValue({ resume: { data: defaultCanonicalDocument } } as never);
    render(<AssistantPage />);
    const input = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    input.focus();
    fireEvent.input(input, { target: { textContent: "我正在写的问题" } });
    await act(async () => { finish({ resumes: [{ id: "late-resume", title: "测试简历", lock_version: 1, source_type: "blank", created_at: session.created_at, updated_at: session.updated_at }], active_imports: [], failed_imports: [] } as never); });
    await waitFor(() => expect(document.querySelector(".assistant-home-resume-chip")).toHaveTextContent("测试简历"));
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveTextContent("我正在写的问题");
  });

  it("历史会话读取中不展示新对话首页，迟到的旧会话也不能覆盖当前会话", async () => {
    const other = { ...session, id: "session-2", title: "第二条对话", messages: [{ sequence_no: 1, role: "user" as const, content: "第二条对话的内容", created_at: session.created_at }] };
    let finish!: (value: { session: AgentSession }) => void;
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [session, other] });
    vi.spyOn(api, "getAgentSession").mockImplementation((id) => id === session.id ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ session: other }));
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    render(<StrictMode><AssistantPage sessionId={session.id} /></StrictMode>);
    expect(screen.getByRole("status", { name: "正在读取对话…" })).toBeInTheDocument();
    expect(screen.queryByLabelText("开始使用 AI 求职助手")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "第二条对话" }));
    expect(await screen.findByText("第二条对话的内容")).toBeInTheDocument();
    await act(async () => { finish({ session: { ...session, messages: [{ sequence_no: 1, role: "user", content: "迟到的旧内容", created_at: session.created_at }] } }); });
    expect(screen.queryByText("迟到的旧内容")).not.toBeInTheDocument();
    expect(screen.getByText("第二条对话的内容")).toBeInTheDocument();
    expect(useActiveSessionStore.getState().activeId).toBe(other.id);
  });

  it("用 V3 外壳包裹，侧栏最近对话读 sessionStore，点击后打开对应会话并高亮", async () => {
    const user = userEvent.setup();
    const listed = { ...session, title: "字节三面 · 系统设计" };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [listed] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: listed });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });

    render(<AssistantPage />);
    const sidebar = await screen.findByRole("complementary", { name: "工作区侧栏" });
    expect(within(sidebar).getByRole("link", { name: "首页" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("complementary", { name: "对话列表" })).not.toBeInTheDocument();

    await user.click(await within(sidebar).findByRole("button", { name: "字节三面 · 系统设计" }));
    await waitFor(() => expect(api.getAgentSession).toHaveBeenCalledWith("session-1"));
    expect(window.location.pathname).toBe("/assistant/session-1");
    await waitFor(() => expect(useActiveSessionStore.getState().activeId).toBe("session-1"));
    expect(within(sidebar).getByRole("button", { name: "字节三面 · 系统设计" })).toHaveAttribute("aria-current", "page");

    await user.click(within(sidebar).getAllByRole("button", { name: "新建对话" })[0]);
    expect(window.location.pathname).toBe("/assistant");
    await waitFor(() => expect(useActiveSessionStore.getState().activeId).toBeNull());
  });

  it("把服务端无时区的 UTC 时间按 UTC 解析，避免刷新后进度多出八小时", () => {
    expect(parseAgentTimestamp("2026-09-24T12:35:00")).toBe(Date.parse("2026-09-24T12:35:00Z"));
    expect(parseAgentTimestamp("2026-09-24T20:35:00+08:00")).toBe(Date.parse("2026-09-24T12:35:00Z"));
  });

  it.each([
    ["resumes", undefined, "/resumes"],
    ["templates", undefined, "/templates"],
    ["career", "applications", "/career/applications"],
    ["career", "schedule", "/career/schedule"],
    ["datasets", undefined, "/datasets"],
  ] as const)("旧的助手内嵌模块地址 %s 直接跳到独立页面", async (section, view, target) => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    window.history.replaceState(null, "", "/assistant/workspace/" + section);

    render(<AssistantPage workspaceSection={section} careerView={view} />);

    await waitFor(() => expect(window.location.pathname).toBe(target));
    expect(screen.queryByRole("region", { name: "嵌入式资料库" })).not.toBeInTheDocument();
  });

  it("点击消息里的简历引用在右侧只读预览，可跳到编辑器，Esc 关闭", async () => {
    const user = userEvent.setup();
    const routedSession: AgentSession = {
      ...session,
      messages: [{
        sequence_no: 1,
        role: "user",
        content: "帮我把项目经历改得更适合字节的后端岗",
        contexts: [{ type: "resume", id: "7", resume_id: "7", version: "2", label: "后端工程师 · 字节跳动" }],
        created_at: session.created_at,
      }],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [routedSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: routedSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    const getResume = vi.spyOn(api, "getResume").mockResolvedValue({
      resume: {
        id: "7",
        title: "后端工程师 · 字节跳动",
        source_type: "blank",
        lock_version: 2,
        created_at: session.created_at,
        updated_at: session.updated_at,
        template_id: null,
        data: defaultCanonicalDocument,
        style: defaultCanonicalPresentation,
      },
    });

    render(<AssistantPage sessionId="session-1" />);
    // 简历显示为气泡上方的小标签，右上角汇总「1 个文件」
    expect(await screen.findByRole("button", { name: "查看本会话的 1 个文件" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "引用文件 后端工程师 · 字节跳动" }));

    const panel = await screen.findByRole("complementary", { name: "文件预览" });
    await waitFor(() => expect(getResume).toHaveBeenCalledWith("7"));
    expect(await within(panel).findByRole("region", { name: "简历只读预览" })).toBeInTheDocument();
    expect(within(panel).getByRole("tab", { name: /后端工程师 · 字节跳动/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "查看本会话的 1 个文件" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "文件预览" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看本会话的 1 个文件" }));
    await user.click(within(await screen.findByRole("complementary", { name: "文件预览" })).getByRole("button", { name: "在编辑器中打开" }));
    expect(window.location.pathname).toBe("/resumes/7/edit");
  });

  it("只有一项修改时按钮为「忽略 / 采用」，采用后收起为摘要并可展开回看", async () => {
    const user = userEvent.setup();
    const proposal: AgentProposal = {
      id: "proposal-refresh",
      run_id: "run-refresh",
      resume_id: "1",
      base_lock_version: 1,
      data: defaultCanonicalDocument,
      style: defaultCanonicalPresentation,
      summary: "更新教育经历学校名称",
      operations: [{
        op: "replace_target_text",
        target: { selected_text: "Q 业大学" },
        new_text: "安徽工业大学",
        expected_text_hash: `sha256:${"a".repeat(64)}`,
      }],
      status: "pending",
      applied_lock_version: null,
      expires_at: "2026-09-24T08:00:00Z",
      created_at: session.created_at,
    };
    const proposalSession: AgentSession = {
      ...session,
      title: "修改教育经历",
      messages: [{
        sequence_no: 1,
        role: "user",
        run_id: "run-refresh",
        content: "把学校名称改为安徽工业大学",
        contexts: [{ type: "resume", id: "1", resume_id: "1", version: "1", label: "后端开发简历" }],
        created_at: session.created_at,
      }],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [proposalSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: proposalSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [proposal] });
    const confirm = vi.spyOn(api, "confirmAgentProposal").mockResolvedValue({
      resume: {
        id: "1",
        title: "后端开发简历",
        source_type: "blank",
        lock_version: 2,
        created_at: "2026-09-14T02:00:00Z",
        updated_at: "2026-09-23T04:00:00Z",
        template_id: null,
        data: defaultCanonicalDocument,
        style: defaultCanonicalPresentation,
      },
    });
    useResumeStore.setState({
      resumes: [{
        id: "1",
        title: "后端开发简历",
        source_type: "blank",
        lock_version: 1,
        created_at: "2026-09-14T02:00:00Z",
        updated_at: "2026-09-14T03:00:00Z",
      }],
      saveStatus: "idle",
      error: null,
    });

    render(<AssistantPage sessionId="session-1" />);
    const card = await screen.findByLabelText("待确认简历修改提案");
    expect(within(card).getByText("目标简历「后端开发简历」")).toBeInTheDocument();
    expect(within(card).queryByRole("tablist")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "忽略" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /全部采用/ })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "采用" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("proposal-refresh", "assistant"));
    expect(useResumeStore.getState().resumes[0].lock_version).toBe(2);
    const summary = await screen.findByLabelText("待确认简历修改提案");
    expect(summary).toHaveTextContent("已处理 1 处修改建议");
    expect(summary).toHaveTextContent("已采用 1");
    await user.click(within(summary).getByRole("button", { name: /查看详情/ }));
    expect(screen.getByText("✓ 已写入简历")).toBeInTheDocument();
  });

  it("按列表顺序应用当前卡片内的全部待确认修改", async () => {
    const user = userEvent.setup();
    const proposal = (id: string, selectedText: string): AgentProposal => ({
      id,
      run_id: "run-batch",
      resume_id: "resume-batch",
      base_lock_version: 1,
      data: defaultCanonicalDocument,
      style: defaultCanonicalPresentation,
      summary: `修改 ${selectedText}`,
      operations: [{
        op: "replace_target_text",
        target: { selected_text: selectedText },
        new_text: `${selectedText}（已优化）`,
        expected_text_hash: `sha256:${"a".repeat(64)}`,
      }],
      status: "pending",
      applied_lock_version: null,
      expires_at: "2026-09-24T08:00:00Z",
      created_at: session.created_at,
    });
    const proposals = [proposal("proposal-batch-1", "第一项"), proposal("proposal-batch-2", "第二项")];
    const proposalSession: AgentSession = {
      ...session,
      title: "批量应用提案",
      messages: [
        { sequence_no: 1, role: "user", run_id: "run-batch", content: "统一优化两项内容", created_at: session.created_at },
        { sequence_no: 2, role: "assistant", run_id: "run-batch", content: "已生成两项修改", created_at: session.updated_at },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [proposalSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: proposalSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals });
    const confirm = vi.spyOn(api, "confirmAgentProposal").mockImplementation(async (proposalId) => ({
      resume: {
        id: "resume-batch",
        title: "批量测试简历",
        source_type: "blank",
        lock_version: proposalId === "proposal-batch-1" ? 2 : 3,
        created_at: session.created_at,
        updated_at: session.updated_at,
        template_id: null,
        data: defaultCanonicalDocument,
        style: defaultCanonicalPresentation,
      },
    }));

    render(<AssistantPage sessionId="session-1" />);
    const panel = await screen.findByLabelText("待确认简历修改提案");
    expect(within(panel).getByText("建议修改 · 2 处")).toBeInTheDocument();
    expect(within(panel).getAllByRole("tab")).toHaveLength(2);
    expect(within(panel).getByRole("button", { name: "采用此项" })).toBeVisible();
    await user.click(within(panel).getByRole("button", { name: "全部采用（2）" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls.map(([proposalId]) => proposalId)).toEqual([
      "proposal-batch-1",
      "proposal-batch-2",
    ]);
    const summary = await screen.findByLabelText("待确认简历修改提案");
    await waitFor(() => expect(summary).toHaveTextContent("已处理 2 处修改建议"));
    expect(summary).toHaveTextContent("已采用 2");
  });

  it("采用此项后自动切到下一项待确认，忽略的项在标签上标记", async () => {
    const user = userEvent.setup();
    const proposal = (id: string, summary: string): AgentProposal => ({
      id,
      run_id: "run-step",
      resume_id: "resume-step",
      base_lock_version: 1,
      data: defaultCanonicalDocument,
      style: defaultCanonicalPresentation,
      summary,
      operations: [{
        op: "replace_target_text",
        target: { selected_text: `${summary}原文` },
        new_text: `${summary}建议`,
        expected_text_hash: `sha256:${"c".repeat(64)}`,
      }],
      status: "pending",
      applied_lock_version: null,
      expires_at: "2026-09-24T08:00:00Z",
      created_at: session.created_at,
    });
    const proposals = [proposal("p1", "项目经历"), proposal("p2", "专业技能"), proposal("p3", "个人总结")];
    const stepSession: AgentSession = {
      ...session,
      messages: [
        { sequence_no: 1, role: "user", run_id: "run-step", content: "改得更适合后端岗", created_at: session.created_at },
        { sequence_no: 2, role: "assistant", run_id: "run-step", content: "起草了 3 处修改", created_at: session.updated_at },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [stepSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: stepSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals });
    vi.spyOn(api, "confirmAgentProposal").mockResolvedValue({
      resume: {
        id: "resume-step", title: "测试简历", source_type: "blank", lock_version: 2,
        created_at: session.created_at, updated_at: session.updated_at, template_id: null,
        data: defaultCanonicalDocument, style: defaultCanonicalPresentation,
      },
    });
    vi.spyOn(api, "rejectAgentProposal").mockResolvedValue({ proposal: { ...proposals[1], status: "rejected" } });

    render(<AssistantPage sessionId="session-1" />);
    const card = await screen.findByLabelText("待确认简历修改提案");
    expect(within(card).getByText("项目经历原文")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "采用此项" }));
    expect(await within(card).findByText("专业技能原文")).toBeInTheDocument();
    expect(within(card).getByText("已采用 1 · 待确认 2")).toBeInTheDocument();
    expect(within(card).getByRole("tab", { name: /专业技能/ })).toHaveAttribute("aria-selected", "true");

    await user.click(within(card).getByRole("button", { name: "忽略" }));
    expect(await within(card).findByText("个人总结原文")).toBeInTheDocument();
    expect(within(card).getByRole("tab", { name: /专业技能/ })).toHaveTextContent("已忽略");
    expect(within(card).getByRole("button", { name: "采用" })).toBeInTheDocument();
  });

  it("全部应用遇到冲突时保留已成功项并停止后续修改", async () => {
    const user = userEvent.setup();
    const proposal = (id: string, selectedText: string): AgentProposal => ({
      id,
      run_id: "run-batch-conflict",
      resume_id: "resume-batch",
      base_lock_version: 1,
      data: defaultCanonicalDocument,
      style: defaultCanonicalPresentation,
      summary: `修改 ${selectedText}`,
      operations: [{
        op: "replace_target_text",
        target: { selected_text: selectedText },
        new_text: `${selectedText}（已优化）`,
        expected_text_hash: `sha256:${"b".repeat(64)}`,
      }],
      status: "pending",
      applied_lock_version: null,
      expires_at: "2026-09-24T08:00:00Z",
      created_at: session.created_at,
    });
    const proposals = [
      proposal("proposal-batch-success", "第一项"),
      proposal("proposal-batch-conflict", "第二项"),
      proposal("proposal-batch-unhandled", "第三项"),
    ];
    const proposalSession: AgentSession = {
      ...session,
      title: "批量应用冲突",
      messages: [
        { sequence_no: 1, role: "user", run_id: "run-batch-conflict", content: "统一优化三项内容", created_at: session.created_at },
        { sequence_no: 2, role: "assistant", run_id: "run-batch-conflict", content: "已生成三项修改", created_at: session.updated_at },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [proposalSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: proposalSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals });
    const confirm = vi.spyOn(api, "confirmAgentProposal")
      .mockResolvedValueOnce({
        resume: {
          id: "resume-batch",
          title: "批量测试简历",
          source_type: "blank",
          lock_version: 2,
          created_at: session.created_at,
          updated_at: session.updated_at,
          template_id: null,
          data: defaultCanonicalDocument,
          style: defaultCanonicalPresentation,
        },
      })
      .mockRejectedValueOnce(new ApiRequestError(409, "TARGET_STALE"));

    render(<AssistantPage sessionId="session-1" />);
    const panel = await screen.findByLabelText("待确认简历修改提案");
    await user.click(within(panel).getByRole("button", { name: "全部采用（3）" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls.map(([proposalId]) => proposalId)).toEqual([
      "proposal-batch-success",
      "proposal-batch-conflict",
    ]);
    expect(await screen.findByText(/已应用 1 项，批量处理已停止/)).toBeInTheDocument();
    // 只剩最后 1 项待确认：不再显示「全部采用」，按钮为「采用」
    expect(within(panel).getByRole("button", { name: "采用" })).toBeEnabled();
    expect(within(panel).queryByRole("button", { name: /全部采用/ })).not.toBeInTheDocument();
    expect(within(panel).getByText("已采用 1 · 待确认 1")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "上一项修改" }));
    expect(within(panel).getAllByText("无法应用").length).toBeGreaterThan(0);
    await user.click(within(panel).getByRole("button", { name: "上一项修改" }));
    expect(within(panel).getByText("✓ 已写入简历")).toBeInTheDocument();
  });

  it("@ 引用简历时以显式引用发送，不再携带编辑器选区", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "listAgentContexts").mockImplementation(async ({ type } = {}) => ({
      contexts: type === "resume"
        ? [{ type: "resume", id: "2", version: "1", label: "Java 开发实习简历" }]
        : [],
    }));
    const stream = vi.spyOn(api, "streamAgentMessage").mockResolvedValue(undefined);

    render(<AssistantPage />);
    const input = await screen.findByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(input, "@");
    expect(await screen.findByRole("option", { name: /Java 开发实习简历/ })).toBeInTheDocument();
    await user.keyboard("{Tab}");
    await user.type(input, "请分析");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      contexts: [{ type: "resume", id: "2", version: "1", presentation: "mention" }],
    }));
    expect(stream.mock.calls[0]?.[1]).not.toHaveProperty("selection_context");
  });

  it("在侧栏删除当前会话后回到新对话", async () => {
    const user = userEvent.setup();
    const listedSession: AgentSession = {
      ...session,
      title: "待整理对话",
      messages: [{ sequence_no: 1, role: "user", content: "旧的问题", created_at: session.created_at }],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [listedSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: listedSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    const deleteSession = vi.spyOn(api, "deleteAgentSession").mockResolvedValue(undefined);

    render(<AssistantPage sessionId="session-1" />);
    expect(await screen.findByText("旧的问题")).toBeInTheDocument();
    await waitFor(() => expect(useActiveSessionStore.getState().activeId).toBe("session-1"));

    await user.click(await screen.findByRole("button", { name: "待整理对话 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    const confirmDialog = screen.getByRole("dialog", { name: "删除这条对话？" });
    await user.click(within(confirmDialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith("session-1"));
    await waitFor(() => expect(window.location.pathname).toBe("/assistant"));
    await waitFor(() => expect(screen.queryByText("旧的问题")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "待整理对话" })).not.toBeInTheDocument();
  });

  it("打开已被删除的会话地址时回到新对话", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "getAgentSession").mockRejectedValue(new ApiRequestError(404, "AGENT_SESSION_NOT_FOUND"));
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    window.history.replaceState(null, "", "/assistant/session-gone");

    render(<AssistantPage sessionId="session-gone" />);

    await waitFor(() => expect(window.location.pathname).toBe("/assistant"));
    expect(await screen.findByText("这条对话不存在或已被删除，已为你打开新对话。")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBeInTheDocument();
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

    const recentGroup = await screen.findByRole("complementary", { name: "工作区侧栏" });
    await within(recentGroup).findByRole("button", { name: "较早的对话" });
    const sessionTitles = () => Array.from(recentGroup.querySelectorAll(".v3-side-session-open"))
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

    const recentGroup = await screen.findByRole("complementary", { name: "工作区侧栏" });
    await within(recentGroup).findByRole("button", { name: "较早的对话" });
    const sessionTitles = () => Array.from(recentGroup.querySelectorAll(".v3-side-session-open"))
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

  it("每条用户消息和助手回复都显示时间并复制各自正文", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const routedSession: AgentSession = {
      ...session,
      messages: [
        { sequence_no: 1, role: "user", content: "请分析岗位", created_at: session.created_at },
        { sequence_no: 2, role: "assistant", content: "**这是回答**", created_at: session.created_at },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [routedSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: routedSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });

    const { container } = render(<AssistantPage sessionId="session-1" />);
    await screen.findByText("这是回答");
    const messages = container.querySelectorAll(".assistant-message");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.querySelector(".message-actions time")).toHaveAttribute("datetime", session.created_at);
    expect(messages[1]?.querySelector(".message-actions time")).toHaveAttribute("datetime", session.created_at);

    await user.click(within(messages[0] as HTMLElement).getByRole("button", { name: "复制消息" }));
    await user.click(within(messages[1] as HTMLElement).getByRole("button", { name: "复制消息" }));
    expect(writeText).toHaveBeenNthCalledWith(1, "请分析岗位");
    expect(writeText).toHaveBeenNthCalledWith(2, "**这是回答**");
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

  it.each(["run.completed", "run.failed"] as const)("恢复的对话收到 %s 后，同步失败不改变真实终态", async (terminal) => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [session] });
    vi.mocked(api.getActiveAgentRun).mockResolvedValue({
      run: { run_id: "run-active", status: "running", started_at: session.created_at },
    });
    vi.spyOn(api, "getAgentSession").mockResolvedValueOnce({ session })
      .mockRejectedValue(new ApiRequestError(401, "UNAUTHORIZED"));
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "streamAgentRun").mockImplementation(async (_runId, _signal, onEvent) => {
      onEvent({ type: "assistant.delta", runId: "run-active", delta: "恢复的分析结果" });
      onEvent(terminal === "run.completed"
        ? { type: terminal, runId: "run-active" }
        : { type: terminal, runId: "run-active", error: "AGENT_UNAVAILABLE" });
    });
    render(<AssistantPage sessionId="session-1" />);
    expect(await screen.findByText("恢复的分析结果")).toBeVisible();
    await waitFor(() => expect(api.getAgentSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument());
    if (terminal === "run.completed") expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    else expect(screen.getByText("生成未完成")).toBeVisible();
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
    // @ 引用的文件在气泡里渲染为蓝色文字（234:2），不再带图标
    expect(reference).toHaveAttribute("data-context-type", "dataset");
    expect(reference.querySelector("svg")).not.toBeInTheDocument();
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

    // 新用户（没有简历）：问候语 + 三张引导卡
    expect(await screen.findByRole("heading", { level: 1, name: /先准备第一份简历吧。/ })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "新建第一份简历" })).toHaveAttribute("href", "/resumes/new");
    expect(screen.getByRole("link", { name: "设置求职方向" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "安装浏览器插件" })).toHaveAttribute("href", "/career/applications");
    expect(screen.getAllByRole("button", { name: "新建对话" }).length).toBeGreaterThan(0);

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
    expect(screen.getByRole("option", { name: /资料1\.md/ })).toHaveTextContent("资料");
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
    expect(within(menu).getByText("选择模型")).toBeInTheDocument();
    // 名字里带 DeepSeek 的模型用 deepseek 厂商图标
    expect(within(menu).getByRole("menuitemradio").querySelector("img")).toHaveAttribute("data-vendor", "deepseek");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(1);
  });

  it("点击模型选择器外部时收起模型菜单", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });

    render(<AssistantPage />);

    await user.click(await screen.findByRole("button", { name: "deepseek/deepseek-v4-flash" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { level: 1 }));

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
    vi.mocked(api.getAgentModels).mockRejectedValueOnce(new Error("unavailable"));
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

  it("澄清时显式选择另一份简历会提交替换原简历的意图", async () => {
    const user = userEvent.setup();
    const sourceResume = { type: "resume" as const, id: "1", version: "3", label: "原简历", presentation: "mention" as const };
    const nextResume = { type: "resume" as const, id: "2", version: "1", label: "目标简历", presentation: "mention" as const };
    const clarification = {
      version: 1 as const,
      questions: [{
        id: "target",
        header: "目标简历",
        question: "要使用哪份简历？",
        options: [{ id: "current", label: "原简历" }, { id: "other", label: "另一份简历" }],
      }],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "listAgentContexts").mockResolvedValue({ contexts: [sourceResume, nextResume] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({
      session: {
        ...session,
        messages: [
          { sequence_no: 1, role: "user", content: "请修改原简历", contexts: [sourceResume], created_at: session.created_at },
          { sequence_no: 2, role: "assistant", message_type: "clarification", clarification, content: "请确认目标简历", created_at: session.created_at },
        ],
      },
    });
    const stream = vi.spyOn(api, "streamAgentMessage")
      .mockImplementationOnce(async (_id, _payload, _signal, onEvent) => {
        onEvent({ type: "run.started", runId: "run-1" });
        onEvent({ type: "clarification.requested", runId: "run-1", clarification });
        onEvent({ type: "run.completed", runId: "run-1" });
      })
      .mockImplementationOnce(async (_id, _payload, _signal, onEvent) => {
        onEvent({ type: "run.started", runId: "run-2" });
        onEvent({ type: "run.completed", runId: "run-2" });
      });

    render(<AssistantPage />);
    await user.click(screen.getByRole("button", { name: "添加资料" }));
    let picker = await screen.findByRole("dialog", { name: "选择资料" });
    await user.click(within(picker).getByRole("button", { name: /原简历/ }));
    await user.click(within(picker).getByRole("button", { name: "添加 1 项" }));
    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "请修改原简历");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("region", { name: "需要你确认" })).toHaveTextContent("先点下方“添加资料”选择目标简历");
    await user.click(screen.getByRole("button", { name: "添加资料" }));
    picker = await screen.findByRole("dialog", { name: "选择资料" });
    await user.click(within(picker).getByRole("button", { name: /目标简历/ }));
    await user.click(within(picker).getByRole("button", { name: "添加 1 项" }));
    await user.click(screen.getByRole("radio", { name: /另一份简历/ }));
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(stream.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      reply_to_sequence_no: 2,
      replace_inherited_resume: true,
      contexts: [expect.objectContaining({ type: "resume", id: "2" })],
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
        {
          sequence_no: 4,
          role: "assistant",
          run_id: "run-1",
          content: "已生成简历修改提案",
          created_at: session.updated_at,
        },
      ],
    };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [proposalSession] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: proposalSession });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [proposal, { ...proposal, id: "proposal-2", summary: "第二项修改", operations: [{ ...proposal.operations![0], new_text: "另一项优化内容" }] }] });

    render(<AssistantPage />);
    await user.click(await screen.findByRole("button", { name: "简历优化提案" }));

    expect(window.location.pathname).toBe("/assistant/session-1");
    // 右上角汇总本会话引用的文件（岗位资料不能预览，只统计简历）
    expect(await screen.findByRole("button", { name: "查看本会话的 1 个文件" })).toBeInTheDocument();
    const card = screen.getByLabelText("待确认简历修改提案");
    expect(within(card).getByText("目标简历「张三的后端简历」")).toBeInTheDocument();
    expect(within(card).getByText("建议修改 · 2 处")).toBeInTheDocument();
    expect(within(card).getByText("2 项待确认")).toBeInTheDocument();

    expect(screen.getByText("负责接口性能优化")).toBeInTheDocument();
    expect(screen.getByText("将接口 P95 延迟降低 32%")).toBeInTheDocument();
    expect(screen.getByText("参与订单服务开发")).toBeInTheDocument();
    expect(screen.getByText("主导订单服务重构")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("删除该条目")).toBeInTheDocument();
    const inlineProposalPanel = screen.getByLabelText("待确认简历修改提案");
    const proposalReply = screen.getByText("已生成简历修改提案").closest(".assistant-message");
    expect(proposalReply?.nextElementSibling).toBe(inlineProposalPanel);
    expect(within(inlineProposalPanel).getByText("删除该条目")).toBeVisible();
    expect(screen.queryByRole("button", { name: "2 项修改待确认 · 查看修改" })).not.toBeInTheDocument();

    expect(screen.getByText("1 / 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "上一项修改" })).toBeDisabled();
    expect(screen.queryByText("另一项优化内容")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一项修改" }));
    expect(screen.getByText("另一项优化内容")).toBeVisible();
    expect(screen.queryByText("将接口 P95 延迟降低 32%")).not.toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "下一项修改" })).toBeDisabled();
    expect(screen.queryByText(/基于版本/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收起修改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开修改" })).not.toBeInTheDocument();
    expect(screen.getByText("另一项优化内容")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "2 项修改待确认 · 查看修改" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "上一项修改" }));
    expect(screen.getByText("将接口 P95 延迟降低 32%")).toBeVisible();

    const stream = vi.spyOn(api, "streamAgentMessage").mockResolvedValue(undefined);
    const reject = vi.spyOn(api, "rejectAgentProposal");
    vi.mocked(api.getAgentSession).mockResolvedValue({ session: { ...proposalSession, messages: [
      ...proposalSession.messages,
      { role: "user", sequence_no: 5, run_id: "run-2", content: "解释一下缓存", created_at: "2026-08-27T09:00:00Z" },
      { role: "assistant", sequence_no: 6, run_id: "run-2", content: "缓存说明", created_at: "2026-08-27T09:01:00Z" },
    ] } });
    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "解释一下缓存");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("缓存说明");
    expect(stream).toHaveBeenCalledOnce();
    expect(reject).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "2 项修改待确认 · 查看修改" })).not.toBeInTheDocument();
    expect(screen.getByText("历史修改建议 · 建议修改 · 2 处")).toBeVisible();
    expect(screen.getByText("将接口 P95 延迟降低 32%")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续调整" }));
    expect(screen.getByText("继续调整所选修改建议")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(stream.mock.calls[1][1].revision_proposal_id).toBe("proposal-1");
  });

  it.each([401, 503])("已完成对话的历史同步返回 %s 时保留回复，不误报对话失败", async (status) => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "createAgentSession").mockResolvedValue({ session });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    const getSession = vi.spyOn(api, "getAgentSession").mockRejectedValue(new ApiRequestError(status, "UNAUTHORIZED"));
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-sync" });
      onEvent({ type: "assistant.delta", runId: "run-sync", delta: "已经完成的分析结果" });
      onEvent({ type: "run.completed", runId: "run-sync" });
    });
    render(<AssistantPage />);
    await user.type(await screen.findByRole("textbox", { name: "告诉助手你想完成什么" }), "分析简历");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument());
    expect(screen.getByText("已经完成的分析结果")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "告诉助手你想完成什么" })).toHaveTextContent("");
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
    expect(alert).toHaveClass("v3-toast");
    expect(alert.parentElement).toBe(document.body);
    expect(container.contains(alert)).toBe(false);
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
    const history: AgentSession = {
      ...session,
      messages: [{ sequence_no: 1, role: "assistant", content: "之前的回答", created_at: session.created_at }],
    };
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "getAgentSession").mockResolvedValueOnce({ session: history }).mockResolvedValue({
      session: { ...history, messages: [
        ...history.messages,
        { sequence_no: 2, role: "user", content: "请分析", created_at: session.created_at },
        { sequence_no: 3, role: "assistant", content: "新的回复", created_at: session.created_at },
      ] },
    });
    vi.spyOn(api, "streamAgentMessage").mockImplementation(async (_id, _payload, _signal, onEvent) => {
      onEvent({ type: "run.started", runId: "run-1" });
      onEvent({ type: "assistant.delta", runId: "run-1", delta: "新的回复" });
      onEvent({ type: "run.completed", runId: "run-1" });
    });

    // 消息区只在对话中出现（首页空闲状态没有消息区），先打开一条已有对话
    const { container } = render(<AssistantPage sessionId="session-1" />);
    await screen.findByText("之前的回答");
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

describe("Figma 文件与截图交互", () => {
  it("明确的文档生成请求使用本地示例，保存时作为 .md 上传到资料库，关闭面板保留标签", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    const stream = vi.spyOn(api, "streamAgentMessage");
    const create = vi.spyOn(api, "createAgentSession");
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({ id: "88", file_name: "面试准备.md" } as Awaited<ReturnType<typeof api.uploadDataset>>);
    const user = userEvent.setup();
    render(<AssistantPage />);
    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "生成一份面试准备文档");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(await screen.findByRole("button", { name: "打开" }));
    const panel = screen.getByRole("complementary", { name: "文件预览" });
    expect(within(panel).getByRole("heading", { name: "面试准备" })).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "保存到资料库" }));
    expect(await screen.findByText("已保存到资料库：面试准备.md。")).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
    const [file, , folderId] = upload.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("面试准备.md");
    expect(folderId).toBe("");
    expect(stream).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole("button", { name: "关闭预览" }));
    await user.click(screen.getByRole("button", { name: "查看本会话的 1 个文件" }));
    expect(screen.getByRole("tab", { name: "面试准备.md" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "已保存" })).toBeDisabled();
  });

  it("资料库已有同名文件时带时间后缀保留两份", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    const upload = vi.spyOn(api, "uploadDataset")
      .mockRejectedValueOnce(new ApiRequestError(409, "DATASET_NAME_CONFLICT"))
      .mockResolvedValueOnce({ id: "89", file_name: "面试准备-1002.md" } as Awaited<ReturnType<typeof api.uploadDataset>>);
    const user = userEvent.setup();
    render(<AssistantPage />);
    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "生成一份面试准备文档");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(await screen.findByRole("button", { name: "打开" }));
    const panel = screen.getByRole("complementary", { name: "文件预览" });
    await user.click(within(panel).getByRole("button", { name: "保存到资料库" }));
    expect(await screen.findByText("已保存到资料库：面试准备-1002.md。")).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(((upload.mock.calls[1][0]) as File).name).toMatch(/^面试准备-\d+\.md$/);
  });

  it("保存到资料库失败时提示，文档仍然未保存且可以重试", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    vi.spyOn(api, "uploadDataset").mockRejectedValue(new ApiRequestError(500, "HTTP_500"));
    const user = userEvent.setup();
    render(<AssistantPage />);
    await user.type(screen.getByRole("textbox", { name: "告诉助手你想完成什么" }), "生成一份面试准备文档");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(await screen.findByRole("button", { name: "打开" }));
    const panel = screen.getByRole("complementary", { name: "文件预览" });
    await user.click(within(panel).getByRole("button", { name: "保存到资料库" }));
    expect(await screen.findByText("保存到资料库失败，请稍后重试。")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "保存到资料库" })).toBeEnabled();
  });

  it("粘贴截图可移除或发送，发送后以缩略图打开图片预览", async () => {
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [] });
    const stream = vi.spyOn(api, "streamAgentMessage");
    const user = userEvent.setup();
    render(<AssistantPage />);
    const editor = screen.getByRole("textbox", { name: "告诉助手你想完成什么" });
    await user.type(editor, "看一下这个页面");
    const file = new File(["fake"], "页面截图.png", { type: "image/png" });
    fireEvent.paste(editor, { clipboardData: { items: [{ type: file.type, getAsFile: () => file }], getData: () => "" } });
    expect(await screen.findByRole("button", { name: "移除截图 页面截图.png" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(screen.getByRole("button", { name: "预览截图 页面截图.png" }));
    expect(screen.getByRole("complementary", { name: "文件预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放大图片" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "移除截图 页面截图.png" })).not.toBeInTheDocument();
    expect(stream).not.toHaveBeenCalled();
  });

  it("预览不可用文件后，用户消息引用禁用，AI 引用也标记不可用", async () => {
    const context: AgentContextSnapshot = { type: "dataset", id: "deleted", label: "已删除资料.md" };
    const listed = { ...session, messages: [{ role: "user" as const, sequence_no: 1, content: "按 @已删除资料.md 整理", contexts: [context], created_at: session.created_at }, { role: "assistant" as const, sequence_no: 2, content: "已删除资料.md 中提到这些内容。", created_at: session.created_at }] };
    vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions: [listed] });
    vi.spyOn(api, "getAgentSession").mockResolvedValue({ session: listed });
    vi.spyOn(api, "listAgentProposals").mockResolvedValue({ proposals: [] });
    vi.spyOn(api, "getDatasetContent").mockRejectedValue(new ApiRequestError(404, "DATASET_NOT_FOUND"));
    render(<AssistantPage sessionId="session-1" />);
    const reference = await screen.findByRole("button", { name: "引用文件 已删除资料.md" });
    await userEvent.click(reference);
    expect(await screen.findByText("这个文件已不可用")).toBeInTheDocument();
    expect(reference).toBeDisabled();
    expect(screen.getByRole("link", { name: "已删除资料.md" })).toHaveAttribute("aria-disabled", "true");
  });
});
