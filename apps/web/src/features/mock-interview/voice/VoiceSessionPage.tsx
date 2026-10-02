import { t, useLocale } from "@/i18n";
// 07.5 语音面试进行中（无侧栏整窗）：设备检测 → 面试官提问 → 作答 → 识别并提交 → 下一题。
// 录音用真实 getUserMedia + AnalyserNode 波形；识别走 mockInterviewApi.recognize（假数据，不连 WebSocket）。
// 面试官语音合成没有后端，用字幕逐字出现 + 波形动画表示「正在提问」。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mockInterviewPath, navigateTo, newMockInterviewPath } from "@/routing";
import { V3Shell } from "@/v3/Shell";
import { Icon } from "@/v3/Icon";
import { BeTag, ConfirmDialog, Dialog, Toast } from "@/v3/primitives";
import {
  mockInterviewApi,
  mockInterviewErrorMessage,
  subscribeMockInterviews,
  type MockInterviewDetail,
  type MockInterviewQuestion,
} from "../mockInterviewApi";
import { DeviceCheck, interviewEyebrow, interviewTitle } from "./DeviceCheck";
import { MAX_RECORDING_MS, useMicrophone } from "./useMicrophone";
import { FeatherMark, FeatherOrb, UserAvatar, Waveform, formatClock, formatElapsed, lastSamples } from "./voiceParts";
import "./voice.css";

type Phase = "check" | "asking" | "answering" | "recognizing" | "failed" | "closing";

// 静音超过该时长显示「还在思考吗」提示（不会自动提交）
export const SILENCE_HINT_MS = 8000;
// 开口打断播报的音量阈值与持续时长
const INTERRUPT_LEVEL = 0.25;
const INTERRUPT_SUSTAIN_MS = 400;
// 面试官「播报」字幕的逐字速度
const CHAR_MS = 90;

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
  useLocale();
  const [detail, setDetail] = useState(interview);
  const [phase, setPhase] = useState<Phase>("check");
  const [question, setQuestion] = useState<MockInterviewQuestion | null>(() => currentQuestion(interview));
  const [shown, setShown] = useState(0);
  const [transcript, setTranscript] = useState("");
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

  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => { setDetail(interview); }, [interview]);

  // 假数据后台推进（准备完成、评估完成）时同步本页副本
  useEffect(() => subscribeMockInterviews(() => {
    void mockInterviewApi.get(interview.id).then(({ mock_interview }) => {
      if (!mountedRef.current) return;
      setDetail(mock_interview);
    }).catch(() => undefined);
  }), [interview.id]);

  useEffect(() => {
    if (phase === "check") setQuestion(currentQuestion(detail));
  }, [detail, phase]);

  // 1 秒一跳的时钟：面试用时、作答时长、静音时长
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), phase === "answering" ? 250 : 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // 面试官逐字「播报」，播完自动开始作答
  const text = phase === "closing" ? closing : question?.content ?? "";
  useEffect(() => {
    if (phase !== "asking" && phase !== "closing") return;
    if (shown >= text.length) {
      if (phase === "asking") {
        const timer = window.setTimeout(() => beginAnswer(), 500);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    const timer = window.setTimeout(() => setShown((value) => value + 1), CHAR_MS);
    return () => window.clearTimeout(timer);
    // beginAnswer 只依赖 ref 与 setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, shown, text]);

  const beginAnswer = useCallback(() => {
    mic.markVoice();
    stoppingRef.current = false;
    setTranscript("");
    setHeard(false);
    setRecordStart(Date.now());
    setNow(Date.now());
    setPhase("answering");
  }, [mic]);

  // 提问中开口即打断：持续说话约 400ms 才算，避免扬声器回声或一声咳嗽误触发
  const loudSinceRef = useRef(0);
  useEffect(() => {
    if (phase === "asking") {
      if (mic.level > INTERRUPT_LEVEL) {
        if (!loudSinceRef.current) loudSinceRef.current = Date.now();
        else if (Date.now() - loudSinceRef.current >= INTERRUPT_SUSTAIN_MS) { loudSinceRef.current = 0; beginAnswer(); }
      } else {
        loudSinceRef.current = 0;
      }
    }
    if (phase === "answering" && mic.level > 0.08) setHeard(true);
  }, [mic.level, phase, beginAnswer]);

  const ask = useCallback((next: MockInterviewQuestion) => {
    setQuestion(next);
    setShown(0);
    setPhase("asking");
  }, []);

  const finishTurn = useCallback((result: { action: string; question: MockInterviewQuestion | null; closing: string | null }) => {
    if (result.action === "finish" || !result.question) {
      setClosing(result.closing ?? t("今天的面试就到这里，感谢你的时间。"));
      setShown(0);
      setPhase("closing");
      mic.release();
      onChanged();
      return;
    }
    ask(result.question);
  }, [ask, mic, onChanged]);

  const consume = useCallback(async (stream: AsyncGenerator<import("../mockInterviewApi").MockTurnEvent>) => {
    for await (const event of stream) {
      if (event.type === "interviewer.failed") throw new Error(event.error);
      if (event.type === "interviewer.turn") return { action: event.action, question: event.question, closing: event.closing_message };
    }
    return { action: "finish", question: null, closing: null };
  }, []);

  // 我说完了：停止录音 → 识别 → 用一次性识别会话提交
  const stopAndSubmit = useCallback(async () => {
    if (!question || stoppingRef.current) return;
    stoppingRef.current = true;
    const durationMs = Date.now() - recordStart;
    setPhase("recognizing");
    let recognized: Awaited<ReturnType<typeof mockInterviewApi.recognize>>;
    try {
      // 整段都没有声音时视为识别失败（真实识别服务同样会返回空结果）
      recognized = await mockInterviewApi.recognize(detail.id, { durationMs, fail: mic.metering && !heard });
    } catch (error) {
      if (!mountedRef.current) return;
      setTranscript("");
      setPhase("failed");
      setToast(null);
      void error;
      return;
    }
    if (!mountedRef.current) return;
    // 先把识别稿显示出来，再提交（设计稿 07.5 · 识别并提交）
    setTranscript(recognized.text);
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    if (!mountedRef.current) return;
    try {
      const result = await consume(mockInterviewApi.answer(detail.id, { question_id: question.id, speech_session_id: recognized.session_id }));
      if (!mountedRef.current) return;
      finishTurn(result);
    } catch (error) {
      if (!mountedRef.current) return;
      setPhase("answering");
      stoppingRef.current = false;
      setToast({ title: t("回答没有提交成功"), message: mockInterviewErrorMessage(error) });
    }
  }, [consume, detail.id, finishTurn, heard, mic.metering, question, recordStart]);

  // 录音满 5 分钟自动结束
  const recordingMs = phase === "answering" ? Math.max(0, now - recordStart) : 0;
  useEffect(() => {
    if (phase === "answering" && recordingMs >= MAX_RECORDING_MS) void stopAndSubmit();
  }, [phase, recordingMs, stopAndSubmit]);

  const silentMs = phase === "answering" ? mic.silentForMs() : 0;
  const silent = phase === "answering" && mic.metering && silentMs >= SILENCE_HINT_MS;

  const skip = async () => {
    if (!question || busy) return;
    setBusy("skip");
    try {
      const result = await consume(mockInterviewApi.skip(detail.id, { question_id: question.id }));
      if (mountedRef.current) finishTurn(result);
    } catch (error) {
      setToast({ title: t("没有跳过这道题"), message: mockInterviewErrorMessage(error) });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const finish = async () => {
    setBusy("finish");
    try {
      await mockInterviewApi.finish(detail.id);
      mic.release();
      onChanged();
      navigateTo(mockInterviewPath(detail.id, true));
    } catch (error) {
      setToast({ title: t("没有结束面试"), message: mockInterviewErrorMessage(error) });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const abandon = async () => {
    setBusy("abandon");
    try {
      await mockInterviewApi.abandon(detail.id);
      mic.release();
      setConfirmAbandon(false);
      onChanged();
      navigateTo(mockInterviewPath());
    } catch (error) {
      setToast({ title: t("没有放弃面试"), message: mockInterviewErrorMessage(error) });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  // 作答方式在面试中不能切换：设备检测阶段「返回修改 / 改为文字面试」都是放弃本场后重新发起
  const leaveCheck = async (target: "back" | "text") => {
    setBusy(target);
    try {
      if (["preparing", "preparation_failed", "in_progress"].includes(detail.status)) await mockInterviewApi.abandon(detail.id);
      mic.release();
      if (target === "back") {
        onChanged();
        navigateTo(newMockInterviewPath({ applicationId: detail.job_application_id ?? undefined, resumeId: detail.resume_id ?? undefined }));
        return;
      }
      const { mock_interview } = await mockInterviewApi.create({
        job_application_id: detail.job_application_id ?? undefined,
        resume_id: detail.resume_id ?? (detail.job_application_id ? undefined : "1"),
        job_description_id: detail.job_description_id ?? undefined,
        target_role: detail.target_role ?? undefined,
        interview_type: detail.interview_type,
        difficulty: detail.difficulty,
        question_count: detail.question_count,
        follow_up_enabled: detail.follow_up_enabled,
        language: detail.language,
        answer_mode: "text",
        material_ids: detail.materials.map((material) => material.dataset_id),
        display: { resume_title: detail.resume_title, company_name: detail.company_name ?? undefined, job_title: detail.job_title ?? undefined, stage_label: detail.stage_label ?? undefined, materials: detail.materials },
      });
      onChanged();
      navigateTo(mockInterviewPath(mock_interview.id));
    } catch (error) {
      setToast({ title: t("操作没有完成"), message: mockInterviewErrorMessage(error) });
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const start = () => {
    const first = currentQuestion(detail);
    if (!first) return;
    ask(first);
  };

  const elapsed = detail.started_at ? now - new Date(detail.started_at).getTime() : 0;
  const plan = question?.plan_index ?? detail.answered_main_questions;
  const follow = question ? followIndex(detail, question) : 0;
  const answeredLog = useMemo(() => detail.questions.filter((entry) => entry.answer_status !== "pending"), [detail.questions]);

  const leaveDialog = (confirmLeave === "back" || confirmLeave === "text") && (
    <ConfirmDialog
      title={confirmLeave === "text" ? t("改为文字面试？") : t("返回修改设置？")}
      description={confirmLeave === "text"
        ? t("面试中不能切换作答方式。将放弃这场语音面试，并按相同设置重新开始一场文字面试。")
        : t("将放弃这场语音面试，回到新建页修改设置后重新开始。")}
      confirmLabel={confirmLeave === "text" ? t("改为文字面试") : t("返回修改")}
      busyLabel={confirmLeave === "text" ? t("正在切换…") : t("正在返回…")}
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
  const interviewerSpeaking = phase === "asking" || phase === "closing";

  return (
    <V3Shell active="mock" bare contentClassName="vx-stage-card" scroll={false}>
      <div className={`vx-stage is-${userState}`}>
        <div className="vx-stage-head">
          <p>{interviewEyebrow(detail)}</p>
          <h1>{interviewTitle(detail, t("语音面试"))}</h1>
        </div>
        <div className="vx-progress" aria-label={t("第 {value0} / {value1} 题", { value0: plan + 1, value1: detail.question_count })}>
          <div className="vx-progress-bars">
            {Array.from({ length: detail.question_count }, (_, index) => (
              <i key={index} className={index < plan ? "is-done" : index === plan && phase !== "closing" ? "is-current" : phase === "closing" ? "is-done" : ""} />
            ))}
          </div>
          <span>{phase === "closing" ? t("已完成 {value0} 题", { value0: detail.question_count }) : t("第 {value0} / {value1} 题{value2}", { value0: plan + 1, value1: detail.question_count, value2: follow ? ` · 追问 ${follow}` : "" })}</span>
        </div>
        <div className="vx-stage-tools">
          <span className="vx-timer">{formatElapsed(elapsed)}</span>
          <button type="button" className="vx-plain" disabled={busy !== null || phase === "closing"} onClick={() => setConfirmAbandon(true)}>{t("放弃")}</button>
          <button type="button" className="vx-outline" disabled={busy !== null || phase === "closing" || phase === "recognizing"} onClick={() => setConfirmLeave("finish")}>{busy === "finish" ? t("正在结束…") : t("结束并评估")}</button>
        </div>

        {question && phase !== "closing" && (
          <div className="vx-qchip">
            <strong>Q{question.plan_index + 1}</strong>
            <span>{question.kind === "main" ? t("主问题") : t("追问 {value0}", { value0: follow })} · L{question.depth_level}</span>
          </div>
        )}

        {/* 面试官 */}
        <div className={`vx-side is-interviewer${interviewerSpeaking ? " is-speaking" : ""}`}>
          {interviewerSpeaking && <><span className="vx-ring is-r1" /><span className="vx-ring is-r2" /></>}
          <FeatherOrb className="vx-side-orb" size={interviewerSpeaking ? 156 : 112} icon={interviewerSpeaking ? 58 : 42} ring={interviewerSpeaking ? "var(--v3-dark)" : "var(--v3-cl)"} />
          <div className="vx-side-label">
            <strong>{t("面试官")}</strong>
            {interviewerSpeaking ? (
              <span className="vx-speaking"><Waveform className="is-animated" values={ASK_WAVE} barWidth={2} gap={2} height={12} minHeight={3} />{t("正在提问")}</span>
            ) : (
              <span>{phase === "recognizing" ? t("正在听你说完…") : t("等待你的回答")}</span>
            )}
          </div>
        </div>

        {/* 你 */}
        <div className={`vx-side is-user is-${userState}`}>
          {userState === "answering" && <><span className="vx-halo is-h1" /><span className="vx-halo is-h2" /></>}
          {(userState === "silent" || userState === "recognizing" || userState === "failed") && <span className="vx-user-ring" />}
          <UserAvatar className="vx-side-avatar" size={interviewerSpeaking ? 112 : 156} fontSize={interviewerSpeaking ? 38 : 52} />
          <div className="vx-side-label">
            <strong>{t("你")}</strong>
            {userState === "answering" && <span className="vx-rec"><i />{t("作答中 ")}{formatClock(recordingMs)}</span>}
            {userState === "silent" && <span className="vx-rec is-silent"><i />{t("作答中 ")}{formatClock(recordingMs)}{t(" · 已静音 ")}{Math.floor(silentMs / 1000)}{t(" 秒")}</span>}
            {userState === "recognizing" && <span className="is-strong">{t("正在识别…")}</span>}
            {userState === "failed" && <span className="is-bad">{t("识别失败")}</span>}
            {interviewerSpeaking && <span>{phase === "closing" ? t("本场作答已完成") : t("播报结束后开始作答")}</span>}
          </div>
        </div>

        {/* 字幕 */}
        <div className="vx-subtitle" aria-live="polite">
          {interviewerSpeaking && (
            <>
              <span className="vx-subtitle-label">{t("面试官 ")}<BeTag title={t("面试官语音合成需要后端；目前只显示字幕")} /></span>
              <p>{text.slice(0, shown)}<span className="vx-caret-space">{text.slice(shown)}</span></p>
            </>
          )}
          {(userState === "answering" || userState === "silent") && (
            <>
              <span className="vx-subtitle-label">{t("你 · 实时识别 ")}<BeTag title={t("实时识别需要后端识别通道；目前在说完后一次性返回识别稿")} /></span>
              <p className="is-placeholder">{heard ? t("正在聆听，说完后点击「我说完了」生成识别稿…") : t("请开始作答，识别文字会显示在这里")}</p>
            </>
          )}
          {userState === "recognizing" && (
            <>
              <span className="vx-subtitle-label">{t("你 · 识别稿")}</span>
              <p className="is-muted">{transcript || t("正在识别…")}</p>
            </>
          )}
          {userState === "failed" && (
            <>
              <span className="vx-subtitle-label">{t("你 · 已识别部分")}</span>
              <p className="is-faint">{transcript || t("没有识别到内容")}</p>
            </>
          )}
        </div>

        {userState === "silent" && <div className="vx-notice is-warn" role="status">{t("还在思考吗？说完请点击「我说完了」")}</div>}
        {userState === "recognizing" && <div className="vx-notice">{t("识别稿提交后不能修改，可以在评估报告中修正并重新评估")}</div>}
        {userState === "failed" && <div className="vx-notice is-bad" role="alert">{t("这段语音没有识别成功。本题可以重新作答，重录不计入追问次数")}</div>}

        <div className="vx-controls">
          <div className="vx-controls-left">
            <button type="button" className="vx-outline is-sub" disabled={busy !== null || phase === "recognizing" || phase === "closing"} onClick={() => void skip()}>{busy === "skip" ? t("正在跳过…") : t("跳过此题")}</button>
            <button type="button" className="vx-plain is-faint" onClick={() => setLogOpen(true)}>{t("对话记录")}</button>
          </div>
          <div className="vx-controls-center">
            {phase === "asking" && (
              <>
                <button type="button" className="vx-pill is-light" onClick={beginAnswer}><Icon name="mic" size={18} />{t("打断并作答")}</button>
                <small>{t("开口或点击即可打断播报")}</small>
              </>
            )}
            {(userState === "answering" || userState === "silent") && (
              <>
                <Waveform className="vx-live-wave" values={lastSamples(mic.history, 24).map((value) => (silent ? 0 : value * 1.6))} barWidth={3} gap={3} height={userState === "silent" ? 6 : 22} minHeight={userState === "silent" ? 3 : 4} color={silent ? "#b8b8b2" : "var(--v3-dark)"} />
                <button type="button" className="vx-pill is-dark" onClick={() => void stopAndSubmit()}><span className="vx-stop" />{t("我说完了")}</button>
                <small>{t("不会因静音自动提交")}</small>
              </>
            )}
            {userState === "recognizing" && (
              <>
                <button type="button" className="vx-pill is-busy" disabled><span className="vx-spinner" />{t("正在识别并提交")}</button>
                <small>{t("约 2 秒")}</small>
              </>
            )}
            {userState === "failed" && (
              <>
                <button type="button" className="vx-pill is-dark" onClick={beginAnswer}><Icon name="mic" size={18} />{t("重新作答")}</button>
                <small>{t("已识别的部分会被丢弃")}</small>
              </>
            )}
            {phase === "closing" && (
              <>
                <button type="button" className="vx-pill is-dark" onClick={() => navigateTo(mockInterviewPath(detail.id, true))}>{t("查看评估报告")}</button>
                <small>{t("报告生成约需 1 分钟")}</small>
              </>
            )}
          </div>
          <div className="vx-controls-right">
            <Icon name="mic" size={13} />
            <span>{mic.deviceLabel}</span>
          </div>
        </div>
      </div>

      <Dialog open={logOpen} width={600} label={t("对话记录")} onClose={() => setLogOpen(false)}>
        <div className="v3-dialog-body vx-log">
          <h2 className="v3-dialog-title">{t("对话记录")}</h2>
          <p className="v3-dialog-sub">{t("语音回答以识别稿显示；提交后不能修改，可在评估报告中修正。")}</p>
          <ol>
            {answeredLog.map((entry) => (
              <li key={entry.id}>
                <span className="vx-log-tag">Q{entry.plan_index + 1} · {entry.kind === "main" ? t("主问题") : t("追问")}</span>
                <p className="vx-log-q"><FeatherMark size={18} />{entry.content}</p>
                <p className="vx-log-a">{entry.answer_status === "skipped" ? t("（已跳过）") : entry.answer_text}</p>
              </li>
            ))}
            {question && phase !== "closing" && (
              <li>
                <span className="vx-log-tag">Q{question.plan_index + 1}{t(" · 当前")}</span>
                <p className="vx-log-q"><FeatherMark size={18} />{question.content}</p>
              </li>
            )}
          </ol>
        </div>
      </Dialog>

      {confirmLeave === "finish" && (
        <ConfirmDialog
          title={t("结束并生成评估？")}
          description={detail.answered_main_questions === 0 ? t("你还没有回答任何主问题，结束后本场记为已放弃，不生成报告。") : t("已作答的题目会进入评估，未作答的题目不计分。评估约需 1 分钟。")}
          confirmLabel={t("结束并评估")}
          busyLabel={t("正在结束…")}
          danger={false}
          busy={busy === "finish"}
          onConfirm={() => void finish().then(() => setConfirmLeave(null))}
          onCancel={() => setConfirmLeave(null)}
        />
      )}
      {leaveDialog}
      {confirmAbandon && (
        <ConfirmDialog
          title={t("放弃这场语音面试？")}
          description={t("已作答的内容不会生成评估报告，录音也不会保留。")}
          confirmLabel={t("放弃面试")}
          busyLabel={t("正在放弃…")}
          busy={busy === "abandon"}
          onConfirm={() => void abandon()}
          onCancel={() => setConfirmAbandon(false)}
        />
      )}
      {toast && <Toast kind="error" title={toast.title} message={toast.message} onDismiss={() => setToast(null)} />}
    </V3Shell>
  );
}
