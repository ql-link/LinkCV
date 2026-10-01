import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerModePicker } from "./AnswerModePicker";
import { VoiceInputButton } from "./VoiceInputButton";
import { VoiceReportPage, voiceMetricSpecs } from "./VoiceReportPage";
import { VoiceSessionPage } from "./VoiceSessionPage";
import { completedVoice, interview, question } from "../__tests__/fixtures";
import type { MockTurnEvent } from "../mockInterviewApi";
const mocks = vi.hoisted(() => ({ get: vi.fn(), speechCapability: vi.fn(), speechPlayback: vi.fn(), answer: vi.fn(), skip: vi.fn(), retryReply: vi.fn(), finish: vi.fn(), abandon: vi.fn(), repeat: vi.fn(), correctTranscripts: vi.fn(), reEvaluate: vi.fn(), editTranscript: vi.fn(), deleteRecordings: vi.fn(), recording: vi.fn(), openSpeech: vi.fn(), navigate: vi.fn() }));
vi.mock("../mockInterviewApi", async (original) => ({ ...await original<typeof import("../mockInterviewApi")>(), mockInterviewApi: mocks }));
vi.mock("@/v3/Shell", () => ({ V3Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/routing", async (original) => ({ ...await original<typeof import("@/routing")>(), navigateTo: mocks.navigate }));
const mic = { permission: "granted", devices: [{ id: "default", label: "测试麦克风" }], deviceId: "default", deviceLabel: "测试麦克风", level: .2, history: [0, .2], metering: true, start: vi.fn(), release: vi.fn(), selectDevice: vi.fn(), markVoice: vi.fn(), silentForMs: () => 0, currentLevel: () => .2, startCapture: vi.fn(), stopCapture: vi.fn() };
vi.mock("./useMicrophone", async (original) => ({ ...await original<typeof import("./useMicrophone")>(), useMicrophone: () => mic }));
vi.mock("./speechTransport", async (original) => ({ ...await original<typeof import("./speechTransport")>(), openSpeech: mocks.openSpeech, SpeechPlayback: class { enqueue = vi.fn(async () => undefined); drain = vi.fn(async () => undefined); stop = vi.fn(); } }));
const session = { push: vi.fn(), stop: vi.fn(), cancel: vi.fn() };
const final = { text: "我用缓存减少数据库读取压力。", session_id: "a".repeat(32), duration_ms: 1000, partial: false };
let partial: ((text: string) => void) | undefined;
async function* events(...items: MockTurnEvent[]) { yield* items; }

beforeEach(() => {
  vi.resetAllMocks(); mic.permission = "granted";
  mic.start.mockResolvedValue("granted"); mic.stopCapture.mockResolvedValue(undefined); mic.startCapture.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
  mocks.speechCapability.mockResolvedValue({ stt: true, tts: true });
  mocks.get.mockResolvedValue({ mock_interview: interview({ answer_mode: "voice" }) });
  mocks.speechPlayback.mockResolvedValue(new Blob(["audio"], { type: "audio/mpeg" }));
  mocks.openSpeech.mockImplementation(async (_id, _qid, _purpose, callback) => { partial = callback; return session; });
  session.stop.mockResolvedValue(final);
  mocks.finish.mockResolvedValue({ mock_interview: interview({ status: "evaluating" }) });
  mocks.abandon.mockResolvedValue({ mock_interview: interview({ status: "abandoned" }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("语音界面的 API 消费", () => {
  it("服务未开启时禁用语音模式", () => {
    render(<AnswerModePicker value="text" onChange={vi.fn()} speechAvailable={false} />);
    expect(screen.getByRole("radio", { name: /语音面试/ })).toBeDisabled();
  });
  it("语音输入实际开启识别连接与 PCM 采集，停止后传回一次性会话", async () => {
    const onText = vi.fn(); render(<VoiceInputButton interviewId="10" questionId="101" onText={onText} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "语音输入" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    fireEvent.click(await screen.findByRole("button", { name: "停止录音" }));
    await waitFor(() => expect(onText).toHaveBeenCalledWith(final.text, final.session_id));
    expect(mocks.openSpeech).toHaveBeenCalledWith("10", "101", "voice_input", expect.any(Function), expect.any(AbortSignal));
    expect(mic.startCapture).toHaveBeenCalledWith(session.push);
    expect(mic.stopCapture).toHaveBeenCalled();
  });
  it("识别中断保留部分文字，取消录音不提交", async () => {
    const onText = vi.fn(); session.stop.mockRejectedValue(new Error("MOCK_INTERVIEW_SPEECH_FAILED"));
    render(<VoiceInputButton interviewId="10" questionId="101" onText={onText} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "语音输入" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    await screen.findByRole("button", { name: "停止录音" });
    partial?.("已识别部分"); fireEvent.click(screen.getByRole("button", { name: "停止录音" }));
    await waitFor(() => expect(onText).toHaveBeenCalledWith("已识别部分"));
    fireEvent.click(screen.getByRole("button", { name: "重新录音" }));
    await screen.findByRole("button", { name: "停止录音" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(session.cancel).toHaveBeenCalled(); expect(onText).toHaveBeenCalledTimes(1);
  });
  it("换题或离开时关闭旧识别通道，晚到的结果不写入新题", async () => {
    let resolve!: (value: typeof final) => void;
    session.stop.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onText = vi.fn(); const view = render(<VoiceInputButton interviewId="10" questionId="101" onText={onText} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "语音输入" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    fireEvent.click(await screen.findByRole("button", { name: "停止录音" }));
    await waitFor(() => expect(session.stop).toHaveBeenCalled());
    view.rerender(<VoiceInputButton interviewId="10" questionId="102" onText={onText} />);
    await act(async () => { resolve(final); });
    expect(onText).not.toHaveBeenCalled(); expect(session.cancel).toHaveBeenCalled();
  });
  it("权限拒绝给出授权指引", async () => {
    mic.start.mockResolvedValue("denied"); render(<VoiceInputButton interviewId="10" questionId="101" onText={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "语音输入" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    expect(await screen.findByText(/麦克风权限被拒绝/)).toBeInTheDocument();
  });
  it("设备试音请求后端，作答发送 voice_answer 会话并进入下一轮", async () => {
    const next = question({ id: "102", kind: "follow_up", parent_id: "101", sequence_no: 2, content: "如何避免缓存穿透？" });
    mocks.answer.mockImplementation(() => events({ type: "answer.accepted", question_id: "101", skipped: false, lock_version: 2 }, { type: "interviewer.turn", action: "follow_up", status: "in_progress", question: next, closing_message: null, lock_version: 3 }));
    render(<VoiceSessionPage interview={interview({ answer_mode: "voice" })} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "试听" }));
    await waitFor(() => expect(screen.getByText("可以听到")).toBeInTheDocument());
    expect(mocks.speechPlayback).toHaveBeenCalledWith("10", undefined, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: "开始语音面试" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "我说完了" })).toBeEnabled());
    act(() => partial?.("缓存设计的实时字幕"));
    expect(screen.getByText("缓存设计的实时字幕")).toBeInTheDocument();
    mocks.get.mockResolvedValue({ mock_interview: interview({ answer_mode: "voice", current_question_id: "102", lock_version: 3, questions: [question({ answer_status: "answered", answer_text: final.text }), next] }) });
    fireEvent.click(screen.getByRole("button", { name: "我说完了" }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledWith("10", { question_id: "101", speech_session_id: final.session_id }, expect.any(String), expect.any(AbortSignal)));
    expect(await screen.findByText(/第 1 \/ 3 题 · 追问 1/)).toBeInTheDocument();
    expect(mocks.openSpeech.mock.calls[0][2]).toBe("voice_answer");
  });
  it("麦克风尚在打开时计时从零开始，不会把未初始化的时间当作录音超时", async () => {
    let ready!: (permission: string) => void;
    mic.start.mockImplementation(() => new Promise((resolve) => { ready = resolve; }));
    render(<VoiceSessionPage interview={interview({ answer_mode: "voice" })} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始语音面试" }));
    expect(await screen.findByText("作答中 0:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我说完了" })).toBeDisabled();
    await act(async () => { ready("granted"); });
    await waitFor(() => expect(screen.getByRole("button", { name: "我说完了" })).toBeEnabled());
    expect(session.stop).not.toHaveBeenCalled();
    expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("一次性识别会话失效后允许重新录音，不反复提交失效会话", async () => {
    mocks.answer.mockImplementation(async function* () { throw new Error("MOCK_INTERVIEW_SPEECH_SESSION_INVALID"); });
    render(<VoiceSessionPage interview={interview({ answer_mode: "voice" })} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始语音面试" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "我说完了" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "我说完了" }));
    fireEvent.click(await screen.findByRole("button", { name: "重新作答" }));
    await waitFor(() => expect(mocks.openSpeech).toHaveBeenCalledTimes(2));
    expect(mocks.answer).toHaveBeenCalledTimes(1);
  });
  it("跳过正在录音的题目时关闭识别通道并锁定再次作答", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    mocks.skip.mockImplementation(async function* () {
      await pending;
      yield { type: "answer.accepted", question_id: "101", skipped: true, lock_version: 2 };
      yield { type: "interviewer.turn", action: "finish", status: "evaluating", question: null, closing_message: "面试结束", lock_version: 3 };
    });
    render(<VoiceSessionPage interview={interview({ answer_mode: "voice" })} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始语音面试" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "我说完了" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "跳过此题" }));
    await waitFor(() => expect(mocks.skip).toHaveBeenCalledWith("10", { question_id: "101" }, expect.any(String), expect.any(AbortSignal)));
    expect(session.cancel).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "我说完了" })).not.toBeInTheDocument();
    await act(async () => { finish(); });
  });
  it("面试官生成下一题时显示 SSE 字幕，并锁定重复提交操作", async () => {
    let resume!: () => void;
    const continuation = new Promise<void>((resolve) => { resume = resolve; });
    const next = question({ id: "102", sequence_no: 2, content: "如何避免缓存穿透？" });
    mocks.answer.mockImplementation(async function* () {
      yield { type: "answer.accepted", question_id: "101", skipped: false, lock_version: 2 };
      yield { type: "interviewer.delta", content: next.content };
      await continuation;
      yield { type: "interviewer.turn", action: "next_question", status: "in_progress", question: next, closing_message: null, lock_version: 3 };
    });
    render(<VoiceSessionPage interview={interview({ answer_mode: "voice" })} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始语音面试" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "我说完了" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "我说完了" }));
    expect(await screen.findByText(next.content)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "面试官正在回复" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "跳过此题" })).toBeDisabled();
    await act(async () => { resume(); });
  });
  it("改为文字面试使用 repeat，保留后端保存的 JD 和资料设置", async () => {
    mocks.repeat.mockResolvedValue({ mock_interview: interview({ id: "11", status: "preparing" }) });
    render(<VoiceSessionPage interview={interview({ answer_mode: "voice" })} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "不方便说话？改为文字面试" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "改为文字面试？" })).getByRole("button", { name: "改为文字面试" }));
    await waitFor(() => expect(mocks.repeat).toHaveBeenCalledWith("10", "text"));
    expect(mocks.abandon).toHaveBeenCalledWith("10");
    expect(mocks.navigate).toHaveBeenCalledWith("/mock-interviews/11");
  });
  it("刷新恢复已保存的回答时只重试面试官回复", async () => {
    const saved = interview({ answer_mode: "voice", needs_reply: true, questions: [question({ answer_status: "answered", answer_text: final.text })] });
    mocks.get.mockResolvedValue({ mock_interview: saved });
    mocks.retryReply.mockReturnValue(events({ type: "interviewer.failed", error: "LLM_PROVIDER_ERROR" }));
    render(<VoiceSessionPage interview={saved} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始语音面试" }));
    expect(await screen.findByRole("button", { name: "重试面试官回复" })).toBeInTheDocument();
    expect(mocks.retryReply).toHaveBeenCalled(); expect(mocks.openSpeech).not.toHaveBeenCalled();
  });
});

describe("语音报告", () => {
  it("展示语音指标，录音通过鉴权读取接口加载", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test-recording"), revokeObjectURL: vi.fn() }));
    mocks.recording.mockResolvedValue(new Blob(["RIFF"], { type: "audio/wav" }));
    render(<VoiceReportPage interview={completedVoice()} onChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "语音表现" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Q1\s*缓存设计/ }));
    fireEvent.click(screen.getByRole("button", { name: "播放录音" }));
    expect(await screen.findByLabelText("回答录音")).toHaveAttribute("src", "blob:test-recording");
    expect(mocks.recording).toHaveBeenCalledWith("10", "101");
    fireEvent.error(screen.getByLabelText("回答录音"));
    fireEvent.click(screen.getByRole("button", { name: "重新加载录音" }));
    await waitFor(() => expect(mocks.recording).toHaveBeenCalledTimes(2));
  });
  it("重评用真实响应重新读取报告，并显示修正前得分", async () => {
    const detail = completedVoice(); detail.questions[0].transcript_state = "edited";
    const updated = completedVoice(); updated.questions[0].re_evaluate_count = 1; updated.questions[0].evaluation_history = [{ previous_score: 75, score: 80, evaluated_at: "2026-09-30T10:12:00Z" }]; updated.questions[0].evaluation!.score = 80;
    mocks.reEvaluate.mockResolvedValue({ question_id: "101", remaining: 2, total_score: 80, previous_total_score: 75 });
    mocks.get.mockResolvedValue({ mock_interview: updated });
    render(<VoiceReportPage interview={detail} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Q1\s*缓存设计/ }));
    fireEvent.click(screen.getByRole("button", { name: "重新评估" }));
    expect(await screen.findByText("修正前 75 → 80")).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith("10");
    fireEvent.click(screen.getByRole("button", { name: "查看修正前评估" }));
    expect(screen.getByText(/第 1 次重新评估.*修正前 75 → 80 分/)).toBeInTheDocument();
  });
  it("删除录音失败保留回放，成功后仍保留回答文字", async () => {
    mocks.deleteRecordings.mockRejectedValueOnce(new Error("MOCK_INTERVIEW_RECORDING_DELETE_FAILED"));
    const detail = completedVoice(); const deleted = completedVoice(); deleted.recordings_deleted = true; deleted.questions[0].has_recording = false;
    mocks.deleteRecordings.mockResolvedValueOnce({ mock_interview: deleted });
    render(<VoiceReportPage interview={detail} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "删除本场录音" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "删除本场录音？" })).getByRole("button", { name: "删除录音" }));
    expect(await screen.findByText(/录音删除失败，请重试/)).toBeInTheDocument();
    expect(screen.queryByText("本场录音已删除，识别文字与评估结果仍保留。")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "删除本场录音？" })).getByRole("button", { name: "删除录音" }));
    expect(await screen.findByText("本场录音已删除，识别文字与评估结果仍保留。")).toBeInTheDocument();
  });
  it("手动修改限制依据原识别稿，超过 15% 不可保存", () => {
    render(<VoiceReportPage interview={completedVoice()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Q1\s*缓存设计/ }));
    fireEvent.click(screen.getByRole("button", { name: "手动修改" }));
    fireEvent.change(screen.getByLabelText("修改识别稿"), { target: { value: "完全改写内容" } });
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  });
  it("指标使用后端的参考区间", () => {
    const metrics = completedVoice().report!.voice_metrics!;
    expect(voiceMetricSpecs(metrics, 1).map((item) => item.tag)).toEqual(["正常", "正常", "正常", "偏短"]);
  });
});
