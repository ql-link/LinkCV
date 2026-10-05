import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInterviewApi, resetMockInterviewStore, type MockInterviewDetail } from "../mockInterviewApi";
import { AnswerModePicker } from "./AnswerModePicker";
import { VoiceInputButton } from "./VoiceInputButton";
import { VoiceReportPage, voiceMetricSpecs } from "./VoiceReportPage";
import { VoiceSessionPage } from "./VoiceSessionPage";

vi.mock("@/v3/Shell", () => ({
  V3Shell: ({ children }: { children: React.ReactNode }) => <div className="v3">{children}</div>,
}));

const navigate = vi.fn();
vi.mock("@/routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/routing")>();
  return { ...actual, navigateTo: (path: string) => navigate(path) };
});

// 虚构麦克风：getUserMedia 返回带 stop() 的假音轨；jsdom 没有 AudioContext，所以音量计量关闭
function installMicrophone(mode: "grant" | "deny" | "none") {
  const stop = vi.fn();
  const getUserMedia = vi.fn(async () => {
    if (mode === "deny") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    return { getTracks: () => [{ stop }] } as unknown as MediaStream;
  });
  const enumerateDevices = vi.fn(async () => [{ kind: "audioinput", deviceId: "default", label: "Default - 测试麦克风", groupId: "g" }] as MediaDeviceInfo[]);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mode === "none" ? undefined : { getUserMedia, enumerateDevices },
  });
  return { getUserMedia, stop };
}

async function voiceInterview(): Promise<MockInterviewDetail> {
  const { items } = await mockInterviewApi.list();
  const voice = items.find((item) => item.answer_mode === "voice" && item.status === "completed")!;
  return (await mockInterviewApi.get(voice.id)).mock_interview;
}

async function startedVoiceInterview(): Promise<MockInterviewDetail> {
  const { mock_interview } = await mockInterviewApi.create({ resume_id: "1", answer_mode: "voice", display: { company_name: "示例科技", job_title: "后端开发", stage_label: "二面" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
  return (await mockInterviewApi.get(mock_interview.id)).mock_interview;
}

beforeEach(() => {
  resetMockInterviewStore();
  navigate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AnswerModePicker", () => {
  it("切换作答方式并显示对应说明", () => {
    installMicrophone("grant");
    const onChange = vi.fn();
    const { rerender } = render(<AnswerModePicker value="voice" onChange={onChange} speechAvailable />);
    expect(screen.getByText(/识别稿提交后不能修改/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "文字" }));
    expect(onChange).toHaveBeenCalledWith("text");
    rerender(<AnswerModePicker value="text" onChange={onChange} speechAvailable />);
    expect(screen.getByRole("radio", { name: "文字" })).toHaveAttribute("aria-checked", "true");
  });

  it("语音服务未开启时禁用语音面试并说明原因", () => {
    installMicrophone("grant");
    render(<AnswerModePicker value="text" onChange={vi.fn()} speechAvailable={false} />);
    expect(screen.getByRole("radio", { name: /语音面试/ })).toBeDisabled();
    expect(screen.getByText(/语音服务暂未开启/)).toBeInTheDocument();
  });

  it("浏览器不支持录音时也禁用语音面试", () => {
    installMicrophone("none");
    render(<AnswerModePicker value="text" onChange={vi.fn()} speechAvailable />);
    expect(screen.getByRole("radio", { name: /语音面试/ })).toBeDisabled();
    expect(screen.getByText(/当前浏览器不支持录音/)).toBeInTheDocument();
  });
});

describe("VoiceInputButton", () => {
  it("录音 → 停止 → 识别后把文字和一次性会话交给输入框", async () => {
    installMicrophone("grant");
    const onText = vi.fn();
    const interview = await voiceInterview();
    render(<VoiceInputButton interviewId={interview.id} questionId="q1" onText={onText} />);
    const mic = await screen.findByRole("button", { name: "语音输入" });
    await waitFor(() => expect(mic).toBeEnabled());
    fireEvent.click(mic);
    fireEvent.click(await screen.findByRole("button", { name: "停止录音" }));
    expect(screen.getByText("正在识别最后一段…")).toBeInTheDocument();
    await waitFor(() => expect(onText).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [text, sessionId] = onText.mock.calls[0];
    expect(text.length).toBeGreaterThan(10);
    expect(sessionId).toMatch(/^[0-9a-z]{32}$/);
    expect(screen.getByText(/^语音输入 · /)).toBeInTheDocument();
  });

  it("Esc 取消录音，不产生文字", async () => {
    const { stop } = installMicrophone("grant");
    const onText = vi.fn();
    render(<VoiceInputButton interviewId="1" questionId="q1" onText={onText} />);
    const mic = await screen.findByRole("button", { name: "语音输入" });
    await waitFor(() => expect(mic).toBeEnabled());
    fireEvent.click(mic);
    await screen.findByRole("button", { name: "停止录音" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("打字或说话都可以，随时切换")).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
  });

  it("权限被拒时提示授权", async () => {
    installMicrophone("deny");
    render(<VoiceInputButton interviewId="1" questionId="q1" onText={vi.fn()} />);
    const mic = await screen.findByRole("button", { name: "语音输入" });
    await waitFor(() => expect(mic).toBeEnabled());
    fireEvent.click(mic);
    expect(await screen.findByText("麦克风权限被拒绝，请在浏览器地址栏允许后重试")).toBeInTheDocument();
  });

  it("浏览器不支持录音时按钮不可用", () => {
    installMicrophone("none");
    render(<VoiceInputButton interviewId="1" questionId="q1" onText={vi.fn()} />);
    expect(screen.getByText(/当前浏览器不支持录音/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "语音输入" })).toBeDisabled();
  });
});

describe("VoiceSessionPage", () => {
  it("设备检测授权后开始，打断播报、作答并提交识别稿，进入下一轮", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { getUserMedia } = installMicrophone("grant");
    const interview = await startedVoiceInterview();
    render(<VoiceSessionPage interview={interview} onChanged={vi.fn()} />);
    expect(screen.getByText("开始前检查一下设备")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("已授权")).toBeInTheDocument());
    expect(getUserMedia).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "开始语音面试" }));
    expect(screen.getByText("正在提问")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打断并作答" }));
    expect(screen.getByText(/^作答中 /)).toBeInTheDocument();
    expect(screen.getByText("不会因静音自动提交")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "我说完了" }));
    expect(screen.getByText("正在识别并提交")).toBeInTheDocument();
    expect(screen.getByText("识别稿提交后不能修改，可以在评估报告中修正并重新评估")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    await waitFor(() => expect(screen.getByText(/第 1 \/ 5 题 · 追问 1/)).toBeInTheDocument());

    const stored = (await mockInterviewApi.get(interview.id)).mock_interview;
    const first = stored.questions.find((question) => question.kind === "main")!;
    expect(first.answer_status).toBe("answered");
    expect(first.answer_source).toBe("voice");

    // 结束并评估需要确认；取消后仍在面试中，确认后进入报告
    fireEvent.click(screen.getByRole("button", { name: "结束并评估" }));
    const dialog = screen.getByRole("dialog", { name: "结束并生成评估？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect((await mockInterviewApi.get(interview.id)).mock_interview.status).toBe("in_progress");
    fireEvent.click(screen.getByRole("button", { name: "结束并评估" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "结束并生成评估？" })).getByRole("button", { name: "结束并评估" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/mock-interviews/${interview.id}/report`));
  });

  it("麦克风权限被拒绝时不能开始，并给出授权指引", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installMicrophone("deny");
    const interview = await startedVoiceInterview();
    render(<VoiceSessionPage interview={interview} onChanged={vi.fn()} />);
    expect(await screen.findByText(/麦克风权限被拒绝/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始语音面试" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新检测" })).toBeInTheDocument();
  });

  it("不方便说话时放弃本场并以文字方式重新发起", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installMicrophone("grant");
    const interview = await startedVoiceInterview();
    render(<VoiceSessionPage interview={interview} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "不方便说话？改为文字面试" }));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog", { name: "改为文字面试？" })).getByRole("button", { name: "改为文字面试" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const { items } = await mockInterviewApi.list();
    expect(items.find((item) => item.id === interview.id)?.status).toBe("abandoned");
    const created = items.find((item) => item.status === "preparing")!;
    expect(created.answer_mode).toBe("text");
    expect(navigate).toHaveBeenCalledWith(`/mock-interviews/${created.id}`);
  });
});

// 虚构 AudioContext：分析器始终返回 128（无声），用于验证静音提示和整段无声判为识别失败
function installSilentAudio() {
  class FakeContext {
    createAnalyser() { return { fftSize: 1024, connect() {}, getByteTimeDomainData(buffer: Uint8Array) { buffer.fill(128); } }; }
    createMediaStreamSource() { return { connect() {} }; }
    close() { return Promise.resolve(); }
  }
  vi.stubGlobal("AudioContext", FakeContext);
}

describe("VoiceSessionPage · 静音与识别失败", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("静音 8 秒提示「还在思考吗」，不自动提交；整段无声判为识别失败并可重新作答", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installMicrophone("grant");
    installSilentAudio();
    const interview = await startedVoiceInterview();
    render(<VoiceSessionPage interview={interview} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "开始语音面试" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始语音面试" }));
    fireEvent.click(screen.getByRole("button", { name: "打断并作答" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.getByText("还在思考吗？说完请点击「我说完了」")).toBeInTheDocument();
    expect(screen.getByText(/已静音 \d+ 秒/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我说完了" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "我说完了" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText("这段语音没有识别成功。本题可以重新作答，重录不计入追问次数")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新作答" }));
    expect(screen.getByRole("button", { name: "我说完了" })).toBeInTheDocument();
    const stored = (await mockInterviewApi.get(interview.id)).mock_interview;
    expect(stored.questions.filter((question) => question.answer_status !== "pending")).toHaveLength(0);
  });
});

describe("VoiceReportPage", () => {
  it("显示语音表现四项指标", async () => {
    installMicrophone("grant");
    const interview = await voiceInterview();
    render(<VoiceReportPage interview={interview} onChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "语音表现" })).toBeInTheDocument();
    expect(screen.getByLabelText(/语速 268字\/分钟，偏快/)).toBeInTheDocument();
    expect(screen.getByLabelText(/长停顿 4次 · 超过 3 秒，略多/)).toBeInTheDocument();
    expect(screen.getByLabelText(/口头禅 3.1%/)).toBeInTheDocument();
    expect(screen.getByLabelText(/作答时长/)).toBeInTheDocument();
  });

  it("AI 修正识别稿后可在单题详情重新评估，剩余次数递减", async () => {
    installMicrophone("grant");
    const interview = await voiceInterview();
    render(<VoiceReportPage interview={interview} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 修正识别稿" }));
    expect(await screen.findByText("已修正 2 处识别错误", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已修正识别稿" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Q2\s*分片迁移与一致性/ }));
    const dialog = screen.getByRole("dialog", { name: "第 2 题详情" });
    expect(within(dialog).getByText("AI 已修正 2 处")).toBeInTheDocument();
    expect(within(dialog).getByText("版本好")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "重新评估" }));
    expect(await within(dialog).findByText("已按修正稿重新评估", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(dialog).getByText(/本题剩余 2 次重新评估机会/)).toBeInTheDocument();
  });

  it("手动修改超过 15% 时不能保存", async () => {
    installMicrophone("grant");
    const interview = await voiceInterview();
    render(<VoiceReportPage interview={interview} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Q1\s*调度平台的分片设计/ }));
    const dialog = screen.getByRole("dialog", { name: "第 1 题详情" });
    fireEvent.click(within(dialog).getAllByRole("button", { name: "手动修改" })[0]);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "修改识别稿" }), { target: { value: "完全改写成另一段话" } });
    expect(within(dialog).getByRole("button", { name: "保存修改" })).toBeDisabled();
    expect(within(dialog).getByText(/最多 15%/)).toBeInTheDocument();
  });

  it("删除录音后保留文字，不再提供回放和手动修改", async () => {
    installMicrophone("grant");
    const interview = await voiceInterview();
    render(<VoiceReportPage interview={interview} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "删除本场录音" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "删除本场录音？" })).getByRole("button", { name: "删除录音" }));
    expect(await screen.findByText("本场录音已删除，识别文字与评估结果仍保留。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Q1\s*调度平台的分片设计/ }));
    const dialog = screen.getByRole("dialog", { name: "第 1 题详情" });
    expect(within(dialog).getAllByText("录音已删除").length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("button", { name: "手动修改" })).toBeNull();
  });

  it("语音指标按参考区间判断标签", () => {
    const specs = voiceMetricSpecs({ chars_per_minute: 200, long_pauses: 5, filler_ratio: 0.01, answer_duration_ms: 600_000, reference: { chars_per_minute: [180, 240], long_pauses: [0, 3], filler_ratio: [0, 0.05] }, tip: "" }, 5);
    expect(specs.map((spec) => spec.tag)).toEqual(["正常", "略多", "正常", "正常"]);
    expect(specs[3].value).toBe("2:00");
  });
});
