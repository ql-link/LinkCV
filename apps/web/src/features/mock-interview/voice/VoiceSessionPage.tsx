// 07.5 语音面试进行中（无侧栏整窗）：设备检测 → 面试官提问 → 作答 → 识别并提交 → 下一题。
// PCM16 经同源 WebSocket 识别，回答经 SSE 推进；语音按顺序播放。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRequestId } from "@/api/client";
import { mockInterviewPath, navigateTo, newMockInterviewPath } from "@/routing";
import { V3Shell } from "@/v3/Shell";
import { Icon } from "@/v3/Icon";
import { ConfirmDialog, Dialog, Toast } from "@/v3/primitives";
import {
  mockInterviewApi,
  mockInterviewErrorMessage,
  type MockInterviewDetail,
  type MockInterviewQuestion,
  type MockTurnEvent,
} from "../mockInterviewApi";
import { openSpeech, SpeechPlayback, speechBlob, type SpeechConnection, type SpeechResult } from "./speechTransport";
import { DeviceCheck, interviewEyebrow, interviewTitle } from "./DeviceCheck";
import { MAX_RECORDING_MS, useMicrophone } from "./useMicrophone";
import { FeatherMark, FeatherOrb, UserAvatar, Waveform, formatClock, formatElapsed, lastSamples } from "./voiceParts";
import "./voice.css";

type Phase = "check" | "asking" | "answering" | "recognizing" | "replying" | "failed" | "closing";

// 静音超过该时长显示「还在思考吗」提示（不会自动提交）
export const SILENCE_HINT_MS = 8000;
// 开口打断播报的音量阈值与持续时长
const INTERRUPT_LEVEL = 0.25;
const INTERRUPT_SUSTAIN_MS = 400;

const ASK_WAVE = [0.5, 0.9, 0.5, 0.25, 0.75, 1, 0.4, 0.25, 0.6, 0.9];

function currentQuestion(detail: MockInterviewDetail) {
  return detail.questions.find((question) => question.id === detail.current_question_id) ?? null;
}

function followIndex(detail: MockInterviewDetail, question: MockInterviewQuestion) {
  if (question.kind === "main" || !question.parent_id) return 0;
  const siblings = detail.questions.filter((entry) => entry.parent_id === question.parent_id);
  return siblings.findIndex((entry) => entry.id === question.id) + 1;
}

export function VoiceSessionPage({ interview, onChanged }: { interview: MockInterviewDetail; onChanged: () => void }) {
  const [detail, setDetail] = useState(interview);
  const [phase, setPhase] = useState<Phase>("check");
  const [question, setQuestion] = useState<MockInterviewQuestion | null>(() => currentQuestion(interview));
  const [shown, setShown] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [replyText, setReplyText] = useState("");
  const [closing, setClosing] = useState("");
  const [recordStart, setRecordStart] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [heard, setHeard] = useState(false);
  const [toast, setToast] = useState<{ title: string; message?: string } | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  // 结束 / 返回修改 / 改为文字面试都会结束本场，先确认（与文字面试一致）
  const [confirmLeave, setConfirmLeave] = useState<"finish" | "back" | "text" | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState<"abandon" | "finish" | "skip" | "back" | "text" | null>(null);
  const mic = useMicrophone();
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const playback = useRef(new SpeechPlayback());
  const controller = useRef<AbortController | null>(null);
  const captureController = useRef<AbortController | null>(null);
  const connection = useRef<SpeechConnection | null>(null);
  const attempt = useRef<{ result: SpeechResult; questionId: string; key: string } | null>(null);
  const operation = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operation.current += 1; controller.current?.abort(); captureController.current?.abort(); connection.current?.cancel(); playback.current.stop(); };
  }, []);
  useEffect(() => { setDetail((old) => interview.lock_version >= old.lock_version ? interview : old); }, [interview]);
  useEffect(() => { if (phase === "check") setQuestion(currentQuestion(detail)); }, [detail, phase]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), phase === "answering" ? 250 : 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const text = phase === "closing" ? closing : question?.content ?? "";
  const beginAnswer = useCallback(async () => {
    if (!question || detail.needs_reply) return;
    const token = ++operation.current;
    controller.current?.abort(); playback.current.stop();
    captureController.current?.abort(); connection.current?.cancel();
    const capture = new AbortController(); captureController.current = capture;
    stoppingRef.current = true; attempt.current = null;
    setTranscript(""); setHeard(false);
    // Set the clock before entering answering; a zero start looked like a 5 min timeout.
    setRecordStart(Date.now()); setNow(Date.now()); setPhase("answering");
    try {
      if (await mic.start() !== "granted") throw new Error("麦克风暂时无法打开，请检查权限后重试。");
      const session = await openSpeech(detail.id, question.id, "voice_answer", (partial) => { if (mountedRef.current && token === operation.current) setTranscript(partial); }, capture.signal);
      if (!mountedRef.current || token !== operation.current) { session.cancel(); return; }
      connection.current = session;
      await mic.startCapture(session.push);
      if (!mountedRef.current || token !== operation.current) return;
      mic.markVoice(); stoppingRef.current = false;
      setRecordStart(Date.now()); setNow(Date.now());
    } catch (error) {
      if (mountedRef.current && token === operation.current) { sessionCleanup(); setPhase("failed"); setToast({ title: "没有开始录音", message: mockInterviewErrorMessage(error) }); }
    }
    function sessionCleanup() { connection.current?.cancel(); mic.release(); stoppingRef.current = false; }
  }, [detail.id, detail.needs_reply, question, mic]);

  const loudSinceRef = useRef(0);
  useEffect(() => {
    if (phase === "asking" && busy === null) {
      if (mic.level > INTERRUPT_LEVEL) {
        if (!loudSinceRef.current) loudSinceRef.current = Date.now();
        else if (Date.now() - loudSinceRef.current >= INTERRUPT_SUSTAIN_MS) { loudSinceRef.current = 0; void beginAnswer(); }
      } else loudSinceRef.current = 0;
    }
    if (phase === "answering" && mic.level > 0.08) setHeard(true);
  }, [mic.level, phase, busy, beginAnswer]);

  const ask = useCallback(async (next: MockInterviewQuestion, alreadySpoken = false) => {
    const token = ++operation.current;
    setQuestion(next); setShown(next.content.length); setPhase("asking");
    if (!alreadySpoken) {
      controller.current?.abort(); controller.current = new AbortController();
      try {
        const audio = await mockInterviewApi.speechPlayback(detail.id, next.id, controller.current.signal);
        if (!mountedRef.current || token !== operation.current) return;
        await playback.current.enqueue(audio);
      } catch (error) {
        if (mountedRef.current && token === operation.current) setToast({ title: "语音播放没有完成", message: mockInterviewErrorMessage(error) });
      }
    } else await playback.current.drain();
    // Capture is started by an effect after the new question has rendered.
    if (mountedRef.current && token === operation.current) setAutoAnswer(next.id);
  }, [detail.id]);
  const [autoAnswer, setAutoAnswer] = useState<string | null>(null);
  useEffect(() => {
    if (autoAnswer && question?.id === autoAnswer && phase === "asking") { setAutoAnswer(null); void beginAnswer(); }
  }, [autoAnswer, question?.id, phase, beginAnswer]);

  const consume = useCallback(async (stream: AsyncGenerator<MockTurnEvent>) => {
    let result: { action: string; question: MockInterviewQuestion | null; closing: string | null } | null = null;
    playback.current.stop(); setReplyText("");
    for await (const event of stream) {
      if (event.type === "interviewer.failed") throw new Error(event.error);
      if (event.type === "interviewer.delta") { setPhase("replying"); setReplyText((value) => value + event.content); }
      if (event.type === "interviewer.audio") void playback.current.enqueue(speechBlob(event.data)).catch(() => { if (mountedRef.current) setToast({ title: "语音播放失败，可阅读字幕继续" }); });
      if (event.type === "interviewer.audio_failed") setToast({ title: "语音合成失败，可阅读字幕继续" });
      if (event.type === "interviewer.turn") result = { action: event.action, question: event.question, closing: event.closing_message };
    }
    const latest = (await mockInterviewApi.get(detail.id)).mock_interview;
    if (mountedRef.current) setDetail(latest);
    if (!result) {
      if (latest.needs_reply) throw new Error("MOCK_INTERVIEW_STREAM_INTERRUPTED");
      result = { action: latest.status === "in_progress" ? "next_question" : "finish", question: currentQuestion(latest), closing: latest.report?.closing_message ?? null };
    }
    await playback.current.drain();
    return result;
  }, [detail.id]);

  const finishTurn = useCallback((result: { action: string; question: MockInterviewQuestion | null; closing: string | null }) => {
    attempt.current = null;
    if (result.action === "finish" || !result.question) {
      setClosing(result.closing ?? "今天的面试就到这里，感谢你的时间。");
      setShown((result.closing ?? "今天的面试就到这里，感谢你的时间。").length);
      setPhase("closing"); mic.release(); onChanged(); return;
    }
    void ask(result.question, true);
  }, [ask, mic, onChanged]);

  const recover = useCallback(async (error: unknown) => {
    if (error instanceof Error && ["MOCK_INTERVIEW_SPEECH_SESSION_INVALID", "MOCK_INTERVIEW_SPEECH_EMPTY"].includes(error.message)) attempt.current = null;
    const latest = await mockInterviewApi.get(detail.id).catch(() => null);
    if (!mountedRef.current) return;
    if (latest) setDetail(latest.mock_interview);
    stoppingRef.current = false; setPhase("failed");
    setToast({ title: latest?.mock_interview.needs_reply ? "回答已保存，面试官回复没有完成" : "识别或提交没有完成", message: mockInterviewErrorMessage(error) });
  }, [detail.id]);

  const submitRecognized = useCallback(async () => {
    const pending = attempt.current;
    if (!pending) return;
    setPhase("recognizing"); stoppingRef.current = true;
    controller.current = new AbortController();
    try {
      const result = await consume(mockInterviewApi.answer(detail.id, { question_id: pending.questionId, speech_session_id: pending.result.session_id }, pending.key, controller.current.signal));
      if (mountedRef.current) finishTurn(result);
    } catch (error) { await recover(error); }
  }, [consume, detail.id, finishTurn, recover]);

  const stopAndSubmit = useCallback(async () => {
    if (!question || stoppingRef.current) return;
    stoppingRef.current = true; setPhase("recognizing");
    try {
      await mic.stopCapture();
      const recognized = await connection.current?.stop();
      if (!mountedRef.current) return;
      if (!recognized?.text.trim()) throw new Error("MOCK_INTERVIEW_SPEECH_EMPTY");
      setTranscript(recognized.text);
      attempt.current = { result: recognized, questionId: question.id, key: createRequestId() };
      await submitRecognized();
    } catch (error) { await recover(error); }
  }, [mic, question, submitRecognized, recover]);

  const retryReply = async () => {
    setBusy("skip"); setPhase("recognizing"); controller.current = new AbortController();
    try { const result = await consume(mockInterviewApi.retryReply(detail.id, controller.current.signal)); if (mountedRef.current) finishTurn(result); }
    catch (error) { await recover(error); }
    finally { if (mountedRef.current) setBusy(null); }
  };

  // 录音满 5 分钟自动结束
  const recordingMs = phase === "answering" && recordStart > 0 ? Math.max(0, now - recordStart) : 0;
  useEffect(() => {
    if (phase === "answering" && recordingMs >= MAX_RECORDING_MS) void stopAndSubmit();
  }, [phase, recordingMs, stopAndSubmit]);

  const silentMs = phase === "answering" ? mic.silentForMs() : 0;
  const silent = phase === "answering" && mic.metering && silentMs >= SILENCE_HINT_MS;

  const skip = async () => {
    if (!question || busy) return;
    setBusy("skip"); stoppingRef.current = true; setPhase("recognizing");
    controller.current?.abort(); controller.current = new AbortController();
    operation.current += 1; captureController.current?.abort(); connection.current?.cancel(); await mic.stopCapture(); playback.current.stop();
    try {
      const result = await consume(mockInterviewApi.skip(detail.id, { question_id: question.id }, createRequestId(), controller.current.signal));
      if (mountedRef.current) finishTurn(result);
    } catch (error) {
      await recover(error);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const finish = async () => {
    setBusy("finish");
    try {
      await mockInterviewApi.finish(detail.id);
      captureController.current?.abort(); connection.current?.cancel(); controller.current?.abort(); playback.current.stop(); mic.release();
      onChanged();
      navigateTo(mockInterviewPath(detail.id, true));
    } catch (error) {
      setToast({ title: "没有结束面试", message: mockInterviewErrorMessage(error) });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const abandon = async () => {
    setBusy("abandon");
    try {
      await mockInterviewApi.abandon(detail.id);
      captureController.current?.abort(); connection.current?.cancel(); controller.current?.abort(); playback.current.stop(); mic.release();
      setConfirmAbandon(false);
      onChanged();
      navigateTo(mockInterviewPath());
    } catch (error) {
      setToast({ title: "没有放弃面试", message: mockInterviewErrorMessage(error) });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  // 作答方式在面试中不能切换：设备检测阶段「返回修改 / 改为文字面试」都是放弃本场后重新发起
  const leaveCheck = async (target: "back" | "text") => {
    setBusy(target);
    try {
      if (["preparing", "preparation_failed", "in_progress"].includes(detail.status)) await mockInterviewApi.abandon(detail.id);
      captureController.current?.abort(); connection.current?.cancel(); controller.current?.abort(); playback.current.stop(); mic.release();
      if (target === "back") {
        onChanged();
        navigateTo(newMockInterviewPath({ applicationId: detail.job_application_id ?? undefined, resumeId: detail.resume_id ?? undefined }));
        return;
      }
      const { mock_interview } = await mockInterviewApi.repeat(detail.id, "text");
      onChanged();
      navigateTo(mockInterviewPath(mock_interview.id));
    } catch (error) {
      setToast({ title: "操作没有完成", message: mockInterviewErrorMessage(error) });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const start = () => {
    const first = currentQuestion(detail);
    if (!first) return;
    if (detail.needs_reply) { void retryReply(); return; }
    void ask(first);
  };

  const elapsed = detail.started_at ? now - new Date(detail.started_at).getTime() : 0;
  const plan = question?.plan_index ?? detail.answered_main_questions;
  const follow = question ? followIndex(detail, question) : 0;
  const answeredLog = useMemo(() => detail.questions.filter((entry) => entry.answer_status !== "pending"), [detail.questions]);

  const leaveDialog = (confirmLeave === "back" || confirmLeave === "text") && (
    <ConfirmDialog
      title={confirmLeave === "text" ? "改为文字面试？" : "返回修改设置？"}
      description={confirmLeave === "text"
        ? "面试中不能切换作答方式。将放弃这场语音面试，并按相同设置重新开始一场文字面试。"
        : "将放弃这场语音面试，回到新建页修改设置后重新开始。"}
      confirmLabel={confirmLeave === "text" ? "改为文字面试" : "返回修改"}
      busyLabel={confirmLeave === "text" ? "正在切换…" : "正在返回…"}
      danger={false}
      busy={busy === confirmLeave}
      onConfirm={() => { const target = confirmLeave; void leaveCheck(target).then(() => setConfirmLeave(null)); }}
      onCancel={() => setConfirmLeave(null)}
    />
  );

  if (phase === "check") {
    return (
      <V3Shell active="mock">
        <DeviceCheck interview={detail} mic={mic} busy={busy === "back" || busy === "text" ? busy : null} onStart={start} onBack={() => setConfirmLeave("back")} onSwitchToText={() => setConfirmLeave("text")} />
        {leaveDialog}
        {toast && <Toast kind="error" title={toast.title} message={toast.message} onDismiss={() => setToast(null)} />}
      </V3Shell>
    );
  }

  const userState = phase === "answering" ? (silent ? "silent" : "answering") : phase;
  const interviewerSpeaking = phase === "asking" || phase === "replying" || phase === "closing";
  const turnPending = phase === "recognizing" || phase === "replying";

  return (
    <V3Shell active="mock" bare contentClassName="vx-stage-card" scroll={false}>
      <div className={`vx-stage is-${userState}`}>
        <div className="vx-stage-head">
          <p>{interviewEyebrow(detail)}</p>
          <h1>{interviewTitle(detail, "语音面试")}</h1>
        </div>
        <div className="vx-progress" aria-label={`第 ${plan + 1} / ${detail.question_count} 题`}>
          <div className="vx-progress-bars">
            {Array.from({ length: detail.question_count }, (_, index) => (
              <i key={index} className={index < plan ? "is-done" : index === plan && phase !== "closing" ? "is-current" : phase === "closing" ? "is-done" : ""} />
            ))}
          </div>
          <span>{phase === "closing" ? `已完成 ${detail.question_count} 题` : `第 ${plan + 1} / ${detail.question_count} 题${follow ? ` · 追问 ${follow}` : ""}`}</span>
        </div>
        <div className="vx-stage-tools">
          <span className="vx-timer">{formatElapsed(elapsed)}</span>
          <button type="button" className="vx-plain" disabled={busy !== null || phase === "closing"} onClick={() => setConfirmAbandon(true)}>放弃</button>
          <button type="button" className="vx-outline" disabled={busy !== null || phase === "closing" || turnPending} onClick={() => setConfirmLeave("finish")}>{busy === "finish" ? "正在结束…" : "结束并评估"}</button>
        </div>

        {question && phase !== "closing" && (
          <div className="vx-qchip">
            <strong>Q{question.plan_index + 1}</strong>
            <span>{question.kind === "main" ? "主问题" : `追问 ${follow}`} · L{question.depth_level}</span>
          </div>
        )}

        {/* 面试官 */}
        <div className={`vx-side is-interviewer${interviewerSpeaking ? " is-speaking" : ""}`}>
          {interviewerSpeaking && <><span className="vx-ring is-r1" /><span className="vx-ring is-r2" /></>}
          <FeatherOrb className="vx-side-orb" size={interviewerSpeaking ? 156 : 112} icon={interviewerSpeaking ? 58 : 42} ring={interviewerSpeaking ? "var(--v3-dark)" : "var(--v3-cl)"} />
          <div className="vx-side-label">
            <strong>面试官</strong>
            {interviewerSpeaking ? (
              <span className="vx-speaking"><Waveform className="is-animated" values={ASK_WAVE} barWidth={2} gap={2} height={12} minHeight={3} />{phase === "asking" ? "正在提问" : "正在回复"}</span>
            ) : (
              <span>{phase === "recognizing" ? "正在听你说完…" : "等待你的回答"}</span>
            )}
          </div>
        </div>

        {/* 你 */}
        <div className={`vx-side is-user is-${userState}`}>
          {userState === "answering" && <><span className="vx-halo is-h1" /><span className="vx-halo is-h2" /></>}
          {(userState === "silent" || userState === "recognizing" || userState === "failed") && <span className="vx-user-ring" />}
          <UserAvatar className="vx-side-avatar" size={interviewerSpeaking ? 112 : 156} fontSize={interviewerSpeaking ? 38 : 52} />
          <div className="vx-side-label">
            <strong>你</strong>
            {userState === "answering" && <span className="vx-rec"><i />作答中 {formatClock(recordingMs)}</span>}
            {userState === "silent" && <span className="vx-rec is-silent"><i />作答中 {formatClock(recordingMs)} · 已静音 {Math.floor(silentMs / 1000)} 秒</span>}
            {userState === "recognizing" && <span className="is-strong">正在识别…</span>}
            {userState === "failed" && <span className="is-bad">识别失败</span>}
            {interviewerSpeaking && <span>{phase === "closing" ? "本场作答已完成" : "播报结束后开始作答"}</span>}
          </div>
        </div>

        {/* 字幕 */}
        <div className="vx-subtitle" aria-live="polite">
          {interviewerSpeaking && (
            <>
              <span className="vx-subtitle-label">面试官</span>
              {phase === "replying" ? <p>{replyText}</p> : <p>{text.slice(0, shown)}<span className="vx-caret-space">{text.slice(shown)}</span></p>}
            </>
          )}
          {(userState === "answering" || userState === "silent") && (
            <>
              <span className="vx-subtitle-label">你 · 实时识别</span>
              <p className="is-placeholder">{transcript || (heard ? "正在聆听，说完后点击「我说完了」…" : "请开始作答，识别文字会显示在这里")}</p>
            </>
          )}
          {userState === "recognizing" && (
            <>
              <span className="vx-subtitle-label">你 · 识别稿</span>
              <p className="is-muted">{transcript || "正在识别…"}</p>
            </>
          )}
          {userState === "failed" && (
            <>
              <span className="vx-subtitle-label">你 · 已识别部分</span>
              <p className="is-faint">{transcript || "没有识别到内容"}</p>
            </>
          )}
        </div>

        {userState === "silent" && <div className="vx-notice is-warn" role="status">还在思考吗？说完请点击「我说完了」</div>}
        {userState === "recognizing" && <div className="vx-notice">识别稿提交后不能修改，可以在评估报告中修正并重新评估</div>}
        {userState === "failed" && <div className="vx-notice is-bad" role="alert">{detail.needs_reply ? "回答已保存，请重试面试官回复。" : "识别或提交未完成，可以重试提交或重新作答。"}</div>}

        <div className="vx-controls">
          <div className="vx-controls-left">
            <button type="button" className="vx-outline is-sub" disabled={busy !== null || turnPending || phase === "closing" || detail.needs_reply} onClick={() => void skip()}>{busy === "skip" ? "正在跳过…" : "跳过此题"}</button>
            <button type="button" className="vx-plain is-faint" onClick={() => setLogOpen(true)}>对话记录</button>
          </div>
          <div className="vx-controls-center">
            {phase === "asking" && (
              <>
                <button type="button" className="vx-pill is-light" onClick={() => void beginAnswer()}><Icon name="mic" size={18} />打断并作答</button>
                <small>开口或点击即可打断播报</small>
              </>
            )}
            {(userState === "answering" || userState === "silent") && (
              <>
                <Waveform className="vx-live-wave" values={lastSamples(mic.history, 24).map((value) => (silent ? 0 : value * 1.6))} barWidth={3} gap={3} height={userState === "silent" ? 6 : 22} minHeight={userState === "silent" ? 3 : 4} color={silent ? "#b8b8b2" : "var(--v3-dark)"} />
                <button type="button" className="vx-pill is-dark" disabled={stoppingRef.current} onClick={() => void stopAndSubmit()}><span className="vx-stop" />我说完了</button>
                <small>不会因静音自动提交</small>
              </>
            )}
            {userState === "recognizing" && (
              <>
                <button type="button" className="vx-pill is-busy" disabled><span className="vx-spinner" />正在识别并提交</button>
                <small>识别完成后将生成面试官回复</small>
              </>
            )}
            {phase === "replying" && <button type="button" className="vx-pill is-busy" disabled><span className="vx-spinner" />面试官正在回复</button>}
            {userState === "failed" && (
              <>
                <button type="button" className="vx-pill is-dark" onClick={() => { if (detail.needs_reply) void retryReply(); else if (attempt.current) void submitRecognized(); else void beginAnswer(); }}><Icon name="mic" size={18} />{detail.needs_reply ? "重试面试官回复" : attempt.current ? "重试提交" : "重新作答"}</button>
                <small>已识别的部分会被丢弃</small>
              </>
            )}
            {phase === "closing" && (
              <>
                <button type="button" className="vx-pill is-dark" onClick={() => navigateTo(mockInterviewPath(detail.id, true))}>查看评估报告</button>
                <small>报告生成约需 1 分钟</small>
              </>
            )}
          </div>
          <div className="vx-controls-right">
            <Icon name="mic" size={13} />
            <span>{mic.deviceLabel}</span>
          </div>
        </div>
      </div>

      <Dialog open={logOpen} width={600} label="对话记录" onClose={() => setLogOpen(false)}>
        <div className="v3-dialog-body vx-log">
          <h2 className="v3-dialog-title">对话记录</h2>
          <p className="v3-dialog-sub">语音回答以识别稿显示；提交后不能修改，可在评估报告中修正。</p>
          <ol>
            {answeredLog.map((entry) => (
              <li key={entry.id}>
                <span className="vx-log-tag">Q{entry.plan_index + 1} · {entry.kind === "main" ? "主问题" : "追问"}</span>
                <p className="vx-log-q"><FeatherMark size={18} />{entry.content}</p>
                <p className="vx-log-a">{entry.answer_status === "skipped" ? "（已跳过）" : entry.answer_text}</p>
              </li>
            ))}
            {question && phase !== "closing" && (
              <li>
                <span className="vx-log-tag">Q{question.plan_index + 1} · 当前</span>
                <p className="vx-log-q"><FeatherMark size={18} />{question.content}</p>
              </li>
            )}
          </ol>
        </div>
      </Dialog>

      {confirmLeave === "finish" && (
        <ConfirmDialog
          title="结束并生成评估？"
          description={detail.answered_main_questions === 0 ? "你还没有回答任何主问题，结束后本场记为已放弃，不生成报告。" : "已作答的题目会进入评估，未作答的题目不计分。评估约需 1 分钟。"}
          confirmLabel="结束并评估"
          busyLabel="正在结束…"
          danger={false}
          busy={busy === "finish"}
          onConfirm={() => void finish().then(() => setConfirmLeave(null))}
          onCancel={() => setConfirmLeave(null)}
        />
      )}
      {leaveDialog}
      {confirmAbandon && (
        <ConfirmDialog
          title="放弃这场语音面试？"
          description="已作答的内容不会生成评估报告，录音也不会保留。"
          confirmLabel="放弃面试"
          busyLabel="正在放弃…"
          busy={busy === "abandon"}
          onConfirm={() => void abandon()}
          onCancel={() => setConfirmAbandon(false)}
        />
      )}
      {toast && <Toast kind="error" title={toast.title} message={toast.message} onDismiss={() => setToast(null)} />}
    </V3Shell>
  );
}
