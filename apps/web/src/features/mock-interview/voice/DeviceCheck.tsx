import { t, useLocale } from "@/i18n";
// 07.4 语音面试 · 设备检测：进入语音面试前的第一步。
// 麦克风用真实 getUserMedia 取流并用 AnalyserNode 显示音量；面试官声音用浏览器自带朗读试听（真实音色需后端合成）。
import { navigateTo } from "@/routing";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/v3/Icon";
import { BeTag, Select, PageEyebrow } from "@/v3/primitives";
import { DIFFICULTY_LABELS, INTERVIEW_TYPE_LABELS, type MockInterviewDetail } from "../mockInterviewApi";
import { VOICE_THRESHOLD, type Microphone } from "./useMicrophone";

const GREETING = "你好，我是今天的面试官，我们先从自我介绍开始。";
// 电平表 32 格的点亮高度轮廓（取自设计稿）
const METER_ENVELOPE = [4, 6, 9, 12, 15, 18, 16, 13, 17, 14, 11, 9, 12, 8, 6, 5, 4, 5, 7, 9, 11, 13, 12, 10, 8, 7, 9, 11, 8, 6, 5, 4];

export function interviewEyebrow(interview: MockInterviewDetail) {
  return [interview.company_name, interview.job_title ?? interview.target_role, INTERVIEW_TYPE_LABELS[interview.interview_type], DIFFICULTY_LABELS[interview.difficulty]].filter(Boolean).join(" · ");
}

export function interviewTitle(interview: MockInterviewDetail, prefix: string) {
  return `${prefix} · ${interview.stage_label ? t("{value0}准备", { value0: interview.stage_label }) : interview.resume_title}`;
}

function SpeakerIcon() {
  useLocale();
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h2.5L9 4v10l-3.5-3H3z" />
      <path d="M12 6.5a3.5 3.5 0 0 1 0 5M14 4.5a6.5 6.5 0 0 1 0 9" />
    </svg>
  );
}

function TipIcon({ kind }: { kind: "headphone" | "quiet" | "clock" }) {
  useLocale();
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#55554f" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "headphone" && <><path d="M3 9V7a4 4 0 0 1 8 0v2" /><rect x="2" y="8.5" width="2.5" height="3.5" rx="1" /><rect x="9.5" y="8.5" width="2.5" height="3.5" rx="1" /></>}
      {kind === "quiet" && <><path d="M2 5.5h2L6.5 3v8L4 8.5H2z" /><path d="M9.5 5.5l3 3M12.5 5.5l-3 3" /></>}
      {kind === "clock" && <><circle cx="7" cy="7" r="5.2" /><path d="M7 4.3V7l1.8 1.2" /></>}
    </svg>
  );
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: string }) {
  useLocale();
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
  useLocale();
  const [speaker, setSpeaker] = useState<"idle" | "playing" | "played" | "unsupported">("idle");
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

  useEffect(() => () => { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); }, []);

  const preview = () => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      setSpeaker("unsupported");
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(GREETING);
    utterance.lang = interview.language === "en" ? "en-US" : "zh-CN";
    utterance.onend = () => setSpeaker("played");
    utterance.onerror = () => setSpeaker("played");
    setSpeaker("playing");
    synth.speak(utterance);
  };

  const micStatus = permission === "granted"
    ? <StatusPill tone="ok">{t("已授权")}</StatusPill>
    : permission === "requesting" || permission === "idle"
      ? <StatusPill tone="muted">{t("等待授权…")}</StatusPill>
      : permission === "denied"
        ? <StatusPill tone="bad">{t("未授权")}</StatusPill>
        : <StatusPill tone="bad">{t("不可用")}</StatusPill>;

  const lit = permission === "granted" ? Math.round(Math.min(1, level * 1.8) * METER_ENVELOPE.length) : 0;
  const meterState = permission !== "granted"
    ? null
    : !metering
      ? { tone: "muted", text: t("无法检测音量") }
      : level > VOICE_THRESHOLD * 1.5 || heardVoice
        ? { tone: "ok", text: t("音量正常") }
        : quietLong
          ? { tone: "warn", text: t("没有检测到声音") }
          : { tone: "muted", text: t("等待声音…") };

  const micProblem = permission === "denied"
    ? t("麦克风权限被拒绝。请在浏览器地址栏左侧的站点设置里允许使用麦克风，然后点击「重新检测」。")
    : permission === "unavailable"
      ? t("没有找到可用的麦克风，或当前浏览器不支持录音。请连接麦克风、换用最新版 Chrome / Edge / Safari，或改为文字面试。")
      : permission === "error"
        ? t("麦克风暂时无法打开，可能正被其他应用占用。关闭占用的应用后点击「重新检测」。")
        : null;

  const preparing = interview.status === "preparing";
  const count = interview.question_count;
  const deviceOptions = mic.devices.length ? mic.devices.map((device) => ({ value: device.id, label: device.label })) : [{ value: "default", label: t("默认麦克风") }];

  return (
    <div className="vx-check-page">
      <header className="vx-check-head">
        <div>
          <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: t("返回模拟面试") }, ...interviewEyebrow(interview).split(" · ")]} />
          <h1 className="v3-page-title">{interviewTitle(interview, t("模拟面试"))}</h1>
        </div>
        <button type="button" className="vx-ghost-sm" disabled={busy !== null} onClick={onBack}>{busy === "back" ? t("正在返回…") : t("返回修改")}</button>
      </header>
      <div className="vx-check-rule" />

      <section className="vx-check-card" aria-labelledby="vx-check-title">
        <h2 id="vx-check-title" className="vx-check-title">{t("开始前检查一下设备")}</h2>
        <p className="vx-check-sub">{t("面试官会用语音提问，你口头作答。")}</p>
        <div className="vx-tips">
          <span className="vx-tip"><TipIcon kind="headphone" />{t("佩戴耳机，避免回声")}</span>
          <span className="vx-tip"><TipIcon kind="quiet" />{t("安静的环境")}</span>
          <span className="vx-tip"><TipIcon kind="clock" />{t("约 ")}{count * 5}{t(" 分钟 · ")}{count}{t(" 道题")}</span>
        </div>

        <div className="vx-checks">
          <div className="vx-check-row">
            <div className="vx-check-top">
              <span className="vx-iconbox"><Icon name="mic" size={18} /></span>
              <strong>{t("麦克风")}</strong>
              {micStatus}
              <span className="vx-spacer" />
              {permission === "granted" ? (
                <div className="vx-device-select">
                  <Select size="sm" label={t("选择麦克风")} value={mic.deviceId || deviceOptions[0].value} options={deviceOptions} onChange={(id) => { void mic.selectDevice(id); setHeardVoice(false); setQuietLong(false); }} />
                </div>
              ) : permission === "requesting" || permission === "idle" ? null : (
                <button type="button" className="vx-ghost-sm is-md" onClick={() => void start()}>{t("重新检测")}</button>
              )}
            </div>
            {micProblem ? (
              <div className="vx-meter is-problem" role="alert">{micProblem}</div>
            ) : (
              <div className="vx-meter">
                <span className="vx-meter-label">{t("说句话试试")}</span>
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
              <strong>{t("面试官声音")}</strong>
              {speaker === "played" ? <StatusPill tone="ok">{t("可以听到")}</StatusPill> : speaker === "unsupported" ? <StatusPill tone="warn">{t("无法试听")}</StatusPill> : <StatusPill tone="muted">{speaker === "playing" ? t("播放中…") : t("未试听")}</StatusPill>}
              <BeTag title={t("面试官音色由后端语音合成提供；这里先用浏览器朗读试听扬声器")} />
              <span className="vx-spacer" />
              <button type="button" className="vx-listen" disabled={speaker === "playing"} onClick={preview}>
                <Icon name="play" size={12} />{t("试听")}</button>
            </div>
            <div className="vx-quote">「{GREETING}」</div>
          </div>
        </div>

        <div className="vx-check-note">
          <Icon name="alert" size={14} />
          <div>
            <p>{t("每条回答会保存录音与识别文字，报告中可回放和修正后重新评估。")}</p>
            <p>{speaker === "unsupported" ? t("当前浏览器不支持朗读试听，请直接检查系统输出设备；语音合成失败时只显示字幕。") : t("听不到声音时检查系统输出设备；语音合成失败时只显示字幕。")}</p>
          </div>
        </div>

        <div className="vx-check-actions">
          <button type="button" className="vx-text-link" disabled={busy !== null} onClick={onSwitchToText}>{busy === "text" ? t("正在切换为文字面试…") : t("不方便说话？改为文字面试")}</button>
          <span className="vx-spacer" />
          {preparing && <span className="vx-check-wait">{t("面试官正在准备题目…")}</span>}
          <button type="button" className="vx-primary" disabled={permission !== "granted" || preparing || busy !== null} onClick={onStart}>
            <Icon name="mic" size={14} />{t("开始语音面试")}</button>
        </div>
      </section>
    </div>
  );
}
