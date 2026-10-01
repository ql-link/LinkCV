// 07.4 语音面试 · 设备检测：进入语音面试前的第一步。
// 麦克风用 getUserMedia 取流并用 AnalyserNode 显示音量；试听播放后端合成的面试官声音。
import { navigateTo } from "@/routing";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/v3/Icon";
import { Select, PageEyebrow } from "@/v3/primitives";
import { DIFFICULTY_LABELS, INTERVIEW_TYPE_LABELS, mockInterviewApi, type MockInterviewDetail } from "../mockInterviewApi";
import { VOICE_THRESHOLD, type Microphone } from "./useMicrophone";

import { SpeechPlayback } from "./speechTransport";
// 电平表 32 格的点亮高度轮廓（取自设计稿）
const METER_ENVELOPE = [4, 6, 9, 12, 15, 18, 16, 13, 17, 14, 11, 9, 12, 8, 6, 5, 4, 5, 7, 9, 11, 13, 12, 10, 8, 7, 9, 11, 8, 6, 5, 4];

export function interviewEyebrow(interview: MockInterviewDetail) {
  return [interview.company_name, interview.job_title ?? interview.target_role, INTERVIEW_TYPE_LABELS[interview.interview_type], DIFFICULTY_LABELS[interview.difficulty]].filter(Boolean).join(" · ");
}

export function interviewTitle(interview: MockInterviewDetail, prefix: string) {
  return `${prefix} · ${interview.stage_label ? `${interview.stage_label}准备` : interview.resume_title}`;
}

function SpeakerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h2.5L9 4v10l-3.5-3H3z" />
      <path d="M12 6.5a3.5 3.5 0 0 1 0 5M14 4.5a6.5 6.5 0 0 1 0 9" />
    </svg>
  );
}

function TipIcon({ kind }: { kind: "headphone" | "quiet" | "clock" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#55554f" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "headphone" && <><path d="M3 9V7a4 4 0 0 1 8 0v2" /><rect x="2" y="8.5" width="2.5" height="3.5" rx="1" /><rect x="9.5" y="8.5" width="2.5" height="3.5" rx="1" /></>}
      {kind === "quiet" && <><path d="M2 5.5h2L6.5 3v8L4 8.5H2z" /><path d="M9.5 5.5l3 3M12.5 5.5l-3 3" /></>}
      {kind === "clock" && <><circle cx="7" cy="7" r="5.2" /><path d="M7 4.3V7l1.8 1.2" /></>}
    </svg>
  );
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: string }) {
  return (
    <span className={`vx-status is-${tone}`}>
      {tone === "ok" ? <Icon name="check" size={10} strokeWidth={2.2} /> : tone === "muted" ? null : <Icon name="alert" size={10} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function DeviceCheck({
  interview,
  mic,
  onStart,
  onBack,
  onSwitchToText,
  busy,
}: {
  interview: MockInterviewDetail;
  mic: Microphone;
  onStart: () => void;
  onBack: () => void;
  onSwitchToText: () => void;
  busy: "back" | "text" | null;
}) {
  const [speaker, setSpeaker] = useState<"idle" | "playing" | "played" | "unsupported">("idle");
  const playback = useRef(new SpeechPlayback());
  const controller = useRef<AbortController | null>(null);
  const [heardVoice, setHeardVoice] = useState(false);
  const [quietLong, setQuietLong] = useState(false);
  const grantedAt = useRef(0);
  const { permission, level, metering, start } = mic;

  // 进入即申请麦克风
  useEffect(() => {
    if (permission === "idle") void start();
  }, [permission, start]);

  useEffect(() => {
    if (permission === "granted") grantedAt.current = Date.now();
  }, [permission]);

  // 说过话即认为音量正常；授权 4 秒后仍没有声音则提示「没有检测到声音」
  useEffect(() => {
    if (level > VOICE_THRESHOLD * 1.5) { setHeardVoice(true); setQuietLong(false); }
  }, [level]);
  useEffect(() => {
    if (permission !== "granted" || !metering || heardVoice) return;
    const timer = window.setTimeout(() => setQuietLong(true), 4000);
    return () => window.clearTimeout(timer);
  }, [permission, metering, heardVoice]);

  useEffect(() => () => { controller.current?.abort(); playback.current.stop(); }, []);

  const preview = async () => {
    controller.current?.abort(); playback.current.stop();
    const current = new AbortController(); controller.current = current;
    setSpeaker("playing");
    try {
      const audio = await mockInterviewApi.speechPlayback(interview.id, undefined, current.signal);
      if (current.signal.aborted) return;
      await playback.current.enqueue(audio);
      if (!current.signal.aborted) setSpeaker("played");
    } catch { if (!current.signal.aborted) setSpeaker("unsupported"); }
  };

  const micStatus = permission === "granted"
    ? <StatusPill tone="ok">已授权</StatusPill>
    : permission === "requesting" || permission === "idle"
      ? <StatusPill tone="muted">等待授权…</StatusPill>
      : permission === "denied"
        ? <StatusPill tone="bad">未授权</StatusPill>
        : <StatusPill tone="bad">不可用</StatusPill>;

  const lit = permission === "granted" ? Math.round(Math.min(1, level * 1.8) * METER_ENVELOPE.length) : 0;
  const meterState = permission !== "granted"
    ? null
    : !metering
      ? { tone: "muted", text: "无法检测音量" }
      : level > VOICE_THRESHOLD * 1.5 || heardVoice
        ? { tone: "ok", text: "音量正常" }
        : quietLong
          ? { tone: "warn", text: "没有检测到声音" }
          : { tone: "muted", text: "等待声音…" };

  const micProblem = permission === "denied"
    ? "麦克风权限被拒绝。请在浏览器地址栏左侧的站点设置里允许使用麦克风，然后点击「重新检测」。"
    : permission === "unavailable"
      ? "没有找到可用的麦克风，或当前浏览器不支持录音。请连接麦克风、换用最新版 Chrome / Edge / Safari，或改为文字面试。"
      : permission === "error"
        ? "麦克风暂时无法打开，可能正被其他应用占用。关闭占用的应用后点击「重新检测」。"
        : null;

  const preparing = interview.status === "preparing";
  const count = interview.question_count;
  const deviceOptions = mic.devices.length ? mic.devices.map((device) => ({ value: device.id, label: device.label })) : [{ value: "default", label: "默认麦克风" }];

  return (
    <div className="vx-check-page">
      <header className="vx-check-head">
        <div>
          <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: "返回模拟面试" }, ...interviewEyebrow(interview).split(" · ")]} />
          <h1 className="v3-page-title">{interviewTitle(interview, "模拟面试")}</h1>
        </div>
        <button type="button" className="vx-ghost-sm" disabled={busy !== null} onClick={onBack}>{busy === "back" ? "正在返回…" : "返回修改"}</button>
      </header>
      <div className="vx-check-rule" />

      <section className="vx-check-card" aria-labelledby="vx-check-title">
        <h2 id="vx-check-title" className="vx-check-title">开始前检查一下设备</h2>
        <p className="vx-check-sub">面试官会用语音提问，你口头作答。</p>
        <div className="vx-tips">
          <span className="vx-tip"><TipIcon kind="headphone" />佩戴耳机，避免回声</span>
          <span className="vx-tip"><TipIcon kind="quiet" />安静的环境</span>
          <span className="vx-tip"><TipIcon kind="clock" />约 {count * 5} 分钟 · {count} 道题</span>
        </div>

        <div className="vx-checks">
          <div className="vx-check-row">
            <div className="vx-check-top">
              <span className="vx-iconbox"><Icon name="mic" size={18} /></span>
              <strong>麦克风</strong>
              {micStatus}
              <span className="vx-spacer" />
              {permission === "granted" ? (
                <div className="vx-device-select">
                  <Select size="sm" label="选择麦克风" value={mic.deviceId || deviceOptions[0].value} options={deviceOptions} onChange={(id) => { void mic.selectDevice(id); setHeardVoice(false); setQuietLong(false); }} />
                </div>
              ) : permission === "requesting" || permission === "idle" ? null : (
                <button type="button" className="vx-ghost-sm is-md" onClick={() => void start()}>重新检测</button>
              )}
            </div>
            {micProblem ? (
              <div className="vx-meter is-problem" role="alert">{micProblem}</div>
            ) : (
              <div className="vx-meter">
                <span className="vx-meter-label">说句话试试</span>
                <span className="vx-meter-bars" aria-hidden="true">
                  {METER_ENVELOPE.map((height, index) => (
                    <i key={index} className={index < lit ? "is-lit" : ""} style={{ height: index < lit ? height : 3 }} />
                  ))}
                </span>
                <span className="vx-spacer" />
                {meterState && <span className={`vx-meter-state is-${meterState.tone}`} aria-live="polite">{meterState.text}</span>}
              </div>
            )}
          </div>
          <div className="vx-check-divider" />
          <div className="vx-check-row">
            <div className="vx-check-top">
              <span className="vx-iconbox"><SpeakerIcon /></span>
              <strong>面试官声音</strong>
              {speaker === "played" ? <StatusPill tone="ok">可以听到</StatusPill> : speaker === "unsupported" ? <StatusPill tone="warn">无法试听</StatusPill> : <StatusPill tone="muted">{speaker === "playing" ? "播放中…" : "未试听"}</StatusPill>}
              <span className="vx-spacer" />
              <button type="button" className="vx-listen" disabled={speaker === "playing"} onClick={preview}>
                <Icon name="play" size={12} />
                试听
              </button>
            </div>
            <div className="vx-quote">「{interview.language === "en" ? "Hello, I am your interviewer today. Let's start with a brief introduction." : "你好，我是今天的面试官，我们先从自我介绍开始。"}」</div>
          </div>
        </div>

        <div className="vx-check-note">
          <Icon name="alert" size={14} />
          <div>
            <p>每条回答会保存录音与识别文字，报告中可回放和修正后重新评估。</p>
            <p>{speaker === "unsupported" ? "语音合成或播放失败，请检查系统输出设备后重试；也可以阅读字幕继续。" : "听不到声音时检查系统输出设备；语音合成失败时只显示字幕。"}</p>
          </div>
        </div>

        <div className="vx-check-actions">
          <button type="button" className="vx-text-link" disabled={busy !== null} onClick={onSwitchToText}>{busy === "text" ? "正在切换为文字面试…" : "不方便说话？改为文字面试"}</button>
          <span className="vx-spacer" />
          {preparing && <span className="vx-check-wait">面试官正在准备题目…</span>}
          <button type="button" className="vx-primary" disabled={permission !== "granted" || interview.status !== "in_progress" || busy !== null} onClick={() => { controller.current?.abort(); playback.current.stop(); onStart(); }}>
            <Icon name="mic" size={14} />
            开始语音面试
          </button>
        </div>
      </section>
    </div>
  );
}
