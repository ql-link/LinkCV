import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockInterviewPage } from "./MockInterviewPage";
import { MockInterviewError, type MockTurnEvent } from "./mockInterviewApi";
import { interview, question, report } from "./__tests__/fixtures";
import { clearPageCache } from "@/v3/pageCache";

const mocks = vi.hoisted(() => ({ listResumes: vi.fn(), listJobApplications: vi.fn(), listInterviewSessions: vi.fn(), listDatasets: vi.fn(), listAll: vi.fn(), get: vi.fn(), create: vi.fn(), answer: vi.fn(), skip: vi.fn(), retryReply: vi.fn(), retry: vi.fn(), speechCapability: vi.fn(), finish: vi.fn() }));
vi.mock("@/api/client", async (original) => ({ ...await original<typeof import("@/api/client")>(), api: mocks }));
vi.mock("./mockInterviewApi", async (original) => ({ ...await original<typeof import("./mockInterviewApi")>(), mockInterviewApi: mocks }));
vi.mock("@/v3/Shell", () => ({ V3Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("./voice/VoiceInputButton", () => ({ VoiceInputButton: () => <button>语音输入</button>, voiceInputFooterHint: () => "Enter 发送" }));
function go(path: string) { window.history.pushState(null, "", path); }
async function* events(...items: MockTurnEvent[]) { for (const item of items) yield item; }

beforeEach(() => {
  clearPageCache(); vi.resetAllMocks();
  mocks.listResumes.mockResolvedValue({ resumes: [{ id: "1", title: "张三的简历", updated_at: "2026-09-30T00:00:00Z" }] });
  mocks.listJobApplications.mockResolvedValue({ items: [], next_cursor: null });
  mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
  mocks.listDatasets.mockResolvedValue({ datasets: [] });
  mocks.listAll.mockResolvedValue({ items: [], next_cursor: null });
  mocks.get.mockResolvedValue({ mock_interview: interview() });
  mocks.create.mockResolvedValue({ mock_interview: interview({ status: "preparing" }) });
  mocks.speechCapability.mockResolvedValue({ stt: false, tts: false });
});
afterEach(() => { vi.useRealTimers(); go("/"); });

describe("模拟面试真实契约的页面消费", () => {
  it("新建发送严格 API 字段，保留资料出题开关", async () => {
    go("/mock-interviews/new"); render(<MockInterviewPage view="new" />);
    await waitFor(() => expect(screen.getByLabelText("简历")).toHaveTextContent("张三的简历"));
    fireEvent.click(screen.getByRole("button", { name: /更多设置/ }));
    const dialog = screen.getByRole("dialog", { name: "更多设置" });
    fireEvent.click(within(dialog).getByRole("switch", { name: "参考资料参与出题" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "开始面试" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ resume_id: "1", answer_mode: "text", materials_in_questions: true });
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("display");
    await waitFor(() => expect(window.location.pathname).toBe("/mock-interviews/10"));
  });
  it("后台准备通过轮询恢复，回答推进至下一题", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let detail = interview({ status: "preparing", questions: [], current_question_id: null });
    mocks.get.mockImplementation(async () => ({ mock_interview: detail }));
    render(<MockInterviewPage view="session" interviewId="10" />);
    expect(await screen.findByRole("heading", { name: "面试官正在准备题目" })).toBeInTheDocument();
    detail = interview();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(await screen.findByLabelText("你的回答")).toBeEnabled();
    const next = question({ id: "102", sequence_no: 2, parent_id: "101", kind: "follow_up", content: "如何处理缓存失效？" });
    mocks.answer.mockImplementation(() => events(
      { type: "answer.accepted", question_id: "101", skipped: false, lock_version: 2 },
      { type: "interviewer.delta", content: next.content },
      { type: "interviewer.turn", status: "in_progress", action: "follow_up", question: next, closing_message: null, lock_version: 3 },
    ));
    detail = interview({ questions: [question({ answer_status: "answered", answer_text: "缓存读压力" }), next], current_question_id: "102", lock_version: 3 });
    fireEvent.change(screen.getByLabelText("你的回答"), { target: { value: "缓存读压力" } });
    fireEvent.keyDown(screen.getByLabelText("你的回答"), { key: "Enter" });
    expect(await screen.findByText(next.content)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("你的回答")).toBeEnabled());
    expect(mocks.answer.mock.calls[0][2]).toMatch(/^[\w.-]{8,64}$/);
  });
  it("回答已保存但回复失败时不允许重复回答，提供单独重试", async () => {
    const stored = interview({ needs_reply: true, questions: [question({ answer_status: "answered", answer_text: "已存回答" })] });
    mocks.get.mockResolvedValue({ mock_interview: stored });
    mocks.retryReply.mockReturnValue(events({ type: "interviewer.failed", error: "LLM_PROVIDER_ERROR" }));
    render(<MockInterviewPage view="session" interviewId="10" />);
    const retry = await screen.findByRole("button", { name: "重试面试官回复" });
    expect(screen.getByLabelText("你的回答")).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.retryReply).toHaveBeenCalledWith("10", expect.any(AbortSignal)));
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(await screen.findByText("回答已保存，面试官回复没有完成")).toBeInTheDocument();
  });
  it("网络未确认的相同回答重试使用相同幂等键", async () => {
    mocks.answer.mockImplementation(async function* () { throw new TypeError("network"); });
    render(<MockInterviewPage view="session" interviewId="10" />);
    const input = await screen.findByLabelText("你的回答");
    fireEvent.change(input, { target: { value: "相同的回答" } }); fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input).toHaveValue("相同的回答"));
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledTimes(2));
    expect(mocks.answer.mock.calls[0][2]).toBe(mocks.answer.mock.calls[1][2]);
  });
  it("新用户读取真实空列表，不生成示例练习记录", async () => {
    render(<MockInterviewPage view="home" />);
    expect(await screen.findByRole("heading", { name: "还没有面试安排，也还没练过" })).toBeInTheDocument();
    expect(mocks.listAll).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /练习记录/ })).toBeDisabled();
  });
  it("报告展示后端的 not_found 判定与真实资料出处", async () => {
    const result = report(); result.fact_check = { status: "completed", items: [{ claim: "缓存数据", verdict: "not_found", quote: "", question_sequence_no: 1, note: "未找到", source: null }] };
    mocks.get.mockResolvedValue({ mock_interview: interview({ status: "completed", report: result, current_question_id: null, questions: [question({ answer_status: "answered", answer_text: "缓存数据", evaluation: result.questions[0] })] }) });
    render(<MockInterviewPage view="report" interviewId="10" />);
    expect(await screen.findByText("无据可查")).toBeInTheDocument();
    expect(screen.getByText("无资料出处")).toBeInTheDocument();
  });
  it("后端拒绝已有活跃场次时保留表单并给出提示", async () => {
    mocks.create.mockRejectedValue(new MockInterviewError("MOCK_INTERVIEW_IN_PROGRESS"));
    render(<MockInterviewPage view="new" />);
    await waitFor(() => expect(screen.getByLabelText("简历")).toHaveTextContent("张三的简历"));
    fireEvent.click(screen.getByRole("button", { name: "开始面试" }));
    expect(await screen.findByText("已有一场进行中的模拟面试")).toBeInTheDocument();
  });
  it("资料核验按后端题号关联主问题及追问，不依赖声称文字匹配回答", async () => {
    const result = report();
    result.fact_check = { status: "completed", items: [{ claim: "归纳后的性能数字", verdict: "conflict", quote: "资料中的性能数字", question_sequence_no: 2, note: "数据不一致", source: { dataset_id: "7", title: "虚构项目资料", version: "v1", position: "第 1 段", text: "资料中的性能数字" } }] };
    mocks.get.mockResolvedValue({ mock_interview: interview({ status: "completed", report: result, current_question_id: null, questions: [question({ answer_status: "answered", answer_text: "缓存设计", evaluation: result.questions[0] }), question({ id: "102", sequence_no: 2, parent_id: "101", kind: "follow_up", answer_status: "answered", answer_text: "压测数据来自两轮测试" })] }) });
    render(<MockInterviewPage view="report" interviewId="10" />);
    const row = await screen.findByRole("button", { name: "Q1 缓存设计，75 分" });
    expect(within(row).getByText("1 处资料冲突")).toBeInTheDocument();
    fireEvent.click(row);
    expect(within(screen.getByRole("dialog")).getByText("虚构项目资料")).toBeInTheDocument();
  });
});
