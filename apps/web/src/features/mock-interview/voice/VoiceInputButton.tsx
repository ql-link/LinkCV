// 07.2 文字面试 · 语音输入按钮（二期）：放在文字面试输入框工具栏里。
// 状态：空闲 → 录音中（计时 + 波形 + 取消 / 停止）→ 识别中 → 完成（交给 onText，文字进入输入框可编辑）/ 失败（可重录）；
// 另有权限被拒、不可用（浏览器不支持或语音服务未开启）。
// 组件渲染一整行工具栏左侧的状态区 + 右侧麦克风/停止按钮，宿主把它放进输入框底部工具栏，发送按钮跟在后面。
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/v3/Icon";
import { mockInterviewApi, type MockRecognition } from "../mockInterviewApi";
import { MAX_RECORDING_MS, microphoneSupported, useMicrophone } from "./useMicrophone";
import { Waveform, formatClock, lastSamples } from "./voiceParts";
import "./voice.css";

export type VoiceInputState = "idle" | "recording" | "recognizing" | "done" | "failed" | "denied" | "unavailable";

const RECORD_WAVE_BARS = 28;

export function VoiceInputButton({
  interviewId,
  questionId,
  onText,
  onPartial,
  disabled = false,
  onStateChange,
}: {
  interviewId: string;
  questionId: string;
  onText: (text: string, speechSessionId: string) => void;
  /** 可选：录音中实时识别出的文字（会随识别更新） */
  onPartial?: (text: string) => void;
  disabled?: boolean;
  /** 可选：录音中宿主输入框要加深描边、换底部提示 */
  onStateChange?: (state: VoiceInputState) => void;
}) {
  const [state, setState] = useState<VoiceInputState>(() => (microphoneSupported() ? "idle" : "unavailable"));
  const [speechOn, setSpeechOn] = useState<boolean | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [lastDuration, setLastDuration] = useState(0);
  const mic = useMicrophone();
  const alive = useRef(true);
  const busyRef = useRef(false);
  const recognitionRef = useRef<MockRecognition | null>(null);

  useEffect(() => () => {
    alive.current = false;
    recognitionRef.current?.cancel();
  }, []);

  // 语音服务是否开启（管理端未配置识别线路时按钮不可用）
  useEffect(() => {
    let cancelled = false;
    void mockInterviewApi.speechCapability().then((capability) => { if (!cancelled) setSpeechOn(capability.stt); }).catch(() => { if (!cancelled) setSpeechOn(false); });
    return () => { cancelled = true; };
  }, []);

  // 换题时回到空闲，丢弃上一题的识别状态
  useEffect(() => {
    setState((old) => (old === "unavailable" || old === "denied" ? old : "idle"));
    mic.release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state]);

  const startRecording = useCallback(async () => {
    if (disabled || busyRef.current) return;
    const permission = await mic.start();
    if (!alive.current) return;
    if (permission === "granted") {
      recognitionRef.current = mockInterviewApi.startRecognition(interviewId, {
        questionId,
        purpose: "voice_input",
        stream: mic.currentStream(),
        onPartial,
      });
      setStartedAt(Date.now());
      setNow(Date.now());
      setState("recording");
    } else if (permission === "denied") {
      setState("denied");
    } else if (permission === "unavailable") {
      setState("unavailable");
    } else {
      setState("failed");
    }
  }, [disabled, interviewId, mic, onPartial, questionId]);

  const cancel = useCallback(() => {
    recognitionRef.current?.cancel();
    recognitionRef.current = null;
    mic.release();
    setState("idle");
  }, [mic]);

  const stop = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const durationMs = Date.now() - startedAt;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    mic.release();
    setLastDuration(durationMs);
    setState("recognizing");
    try {
      if (!recognition) throw new Error("recognition not started");
      const result = await recognition.stop();
      if (!alive.current) return;
      onText(result.text, result.session_id);
      setState("done");
    } catch {
      if (alive.current) setState("failed");
    } finally {
      busyRef.current = false;
    }
  }, [mic, onText, startedAt]);

  const recordingMs = state === "recording" ? Math.max(0, now - startedAt) : 0;
  useEffect(() => {
    if (state === "recording" && recordingMs >= MAX_RECORDING_MS) void stop();
  }, [recordingMs, state, stop]);

  // Esc 取消录音
  useEffect(() => {
    if (state !== "recording") return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cancel, state]);

  const serviceOff = speechOn === false;
  const effective: VoiceInputState = serviceOff && state !== "recording" && state !== "recognizing" ? "unavailable" : state;
  useEffect(() => { onStateChange?.(effective); }, [effective, onStateChange]);
  const micDisabled = disabled || effective === "recognizing" || effective === "unavailable" || effective === "denied" || speechOn === null;

  return (
    <div className={`vx-vib is-${effective}`} data-state={effective}>
      <div className="vx-vib-status" aria-live="polite">
        {effective === "idle" && <span className="vx-vib-hint">打字或说话都可以，随时切换</span>}
        {effective === "recording" && (
          <span className="vx-vib-rec">
            <i className="vx-vib-dot" />
            <span className="vx-vib-time">{formatClock(recordingMs)}</span>
            <Waveform values={lastSamples(mic.history, RECORD_WAVE_BARS).map((value) => value * 1.6)} barWidth={2} gap={2} height={20} minHeight={3} />
          </span>
        )}
        {effective === "recognizing" && <span className="vx-vib-hint">正在识别最后一段…</span>}
        {effective === "done" && <span className="vx-vib-tag">语音输入 · {formatClock(lastDuration)}</span>}
        {effective === "failed" && (
          <>
            <span className="vx-vib-hint is-bad">识别中断，已识别的文字保留在输入框中</span>
            <button type="button" className="vx-vib-retry" disabled={disabled} onClick={() => void startRecording()}>重新录音</button>
          </>
        )}
        {effective === "denied" && <span className="vx-vib-hint is-warn">麦克风权限被拒绝，请在浏览器地址栏允许后重试</span>}
        {effective === "unavailable" && <span className="vx-vib-hint">当前浏览器不支持录音，或语音服务未开启；可继续打字作答</span>}
      </div>
      {effective === "recording" ? (
        <div className="vx-vib-actions">
          <button type="button" className="vx-vib-cancel" onClick={cancel}>取消</button>
          <button type="button" className="vx-vib-stop" aria-label="停止录音" onClick={() => void stop()}><span /></button>
        </div>
      ) : (
        <button
          type="button"
          className={`vx-vib-mic${micDisabled && effective !== "idle" ? " is-off" : ""}`}
          aria-label={effective === "denied" ? "麦克风权限被拒绝，点击重试" : "语音输入"}
          disabled={micDisabled && effective !== "denied"}
          onClick={() => void startRecording()}
        >
          <Icon name="mic" size={16} />
        </button>
      )}
    </div>
  );
}

// 录音中时输入框描边加深、底部提示换成「再次点击停止 · Esc 取消录音」，宿主可用此函数取文案
export function voiceInputFooterHint(state: VoiceInputState) {
  return state === "recording" ? "再次点击停止 · Esc 取消录音" : "Enter 发送 · Shift + Enter 换行";
}
