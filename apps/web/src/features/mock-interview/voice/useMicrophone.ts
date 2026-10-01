// 麦克风采集与音量计量：getUserMedia 取流，AnalyserNode 算 RMS 音量，供设备检测音量条和作答波形使用。
// PCM 采集依赖 AudioContext 与 AudioWorklet；不支持时可检测权限，但会提示无法采集。
import { useCallback, useEffect, useRef, useState } from "react";

export type MicPermission = "idle" | "requesting" | "granted" | "denied" | "unavailable" | "error";
export type MicDevice = { id: string; label: string };

export const LEVEL_HISTORY = 32;
// 音量高于该值视为「在说话」，用于静音检测和「开口即打断」
export const VOICE_THRESHOLD = 0.06;
// 单次录音上限 5 分钟（与后端识别通道一致）
export const MAX_RECORDING_MS = 5 * 60 * 1000;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export function microphoneSupported() {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

function permissionFromError(error: unknown): MicPermission {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "unavailable";
  return "error";
}

const emptyHistory = () => Array<number>(LEVEL_HISTORY).fill(0);

export function useMicrophone() {
  const [permission, setPermission] = useState<MicPermission>(() => (microphoneSupported() ? "idle" : "unavailable"));
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [level, setLevel] = useState(0);
  const [history, setHistory] = useState<number[]>(emptyHistory);
  const [metering, setMetering] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const requestGeneration = useRef(0);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);
  const captureRef = useRef<{ source: MediaStreamAudioSourceNode; node: AudioWorkletNode; gain: GainNode; flush: (() => void) | null } | null>(null);
  const captureGeneration = useRef(0);
  const stopCapture = useCallback(async () => {
    captureGeneration.current += 1;
    const capture = captureRef.current;
    if (!capture) return;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 200);
      capture.flush = () => { window.clearTimeout(timer); resolve(); };
      capture.node.port.postMessage("flush");
    });
    capture.source.disconnect(); capture.node.disconnect(); capture.gain.disconnect();
    capture.node.port.onmessage = null;
    if (captureRef.current === capture) captureRef.current = null;
  }, []);
  const startCapture = useCallback(async (onAudio: (frame: ArrayBuffer) => void) => {
    await stopCapture();
    const generation = captureGeneration.current;
    const stream = streamRef.current;
    const context = contextRef.current;
    if (!stream || !context?.audioWorklet) throw new Error("当前浏览器不支持语音采集，请改用文字面试。");
    await context.audioWorklet.addModule(new URL("./pcmCapture.worklet.js", import.meta.url).href);
    if (generation !== captureGeneration.current || streamRef.current !== stream) throw new DOMException("Cancelled", "AbortError");
    await context.resume();
    const node = new AudioWorkletNode(context, "mock-interview-pcm");
    const source = context.createMediaStreamSource(stream);
    const gain = context.createGain(); gain.gain.value = 0;
    const capture = { source, node, gain, flush: null as (() => void) | null };
    node.port.onmessage = ({ data }) => { if (data === "flushed") capture.flush?.(); else onAudio(data as ArrayBuffer); };
    source.connect(node).connect(gain).connect(context.destination);
    captureRef.current = capture;
  }, [stopCapture]);
  const lastVoiceRef = useRef(Date.now());
  const levelRef = useRef(0);

  const stopMeter = useCallback(() => {
    if (frameRef.current && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    const context = contextRef.current;
    contextRef.current = null;
    if (context) void context.close().catch(() => undefined);
  }, []);

  // 释放麦克风：停止所有音轨，关闭音频上下文
  const release = useCallback(() => {
    requestGeneration.current += 1;
    void stopCapture();
    stopMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    levelRef.current = 0;
    setLevel(0);
    setHistory(emptyHistory());
    setMetering(false);
  }, [stopCapture, stopMeter]);

  const startMeter = useCallback((stream: MediaStream) => {
    const Ctor = audioContextCtor();
    if (!Ctor || typeof requestAnimationFrame !== "function") return;
    try {
      const context = new Ctor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      contextRef.current = context;
      const buffer = new Uint8Array(analyser.fftSize);
      let lastPush = 0;
      const tick = (time: number) => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) {
          const value = (sample - 128) / 128;
          sum += value * value;
        }
        // RMS 放大到 0–1，正常说话约 0.2–0.6
        const value = Math.min(1, Math.sqrt(sum / buffer.length) * 5);
        levelRef.current = value;
        if (value > VOICE_THRESHOLD) lastVoiceRef.current = Date.now();
        if (time - lastPush > 70) {
          lastPush = time;
          setLevel(value);
          setHistory((old) => [...old.slice(1), value]);
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
      setMetering(true);
    } catch {
      setMetering(false);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator.mediaDevices?.enumerateDevices !== "function") return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter((device) => device.kind === "audioinput" && device.deviceId !== "communications");
      setDevices(inputs.map((device, index) => ({
        id: device.deviceId || `device-${index}`,
        label: device.label ? (device.deviceId === "default" ? device.label.replace(/^默认 - |^Default - /, "") + "（默认）" : device.label) : index === 0 ? "默认麦克风" : `麦克风 ${index + 1}`,
      })));
    } catch { /* 设备列表不可用时只显示默认麦克风 */ }
  }, []);

  // 申请麦克风并开始计量；返回最终权限状态，调用方据此切换界面
  const start = useCallback(async (nextDeviceId?: string): Promise<MicPermission> => {
    if (!microphoneSupported()) {
      setPermission("unavailable");
      return "unavailable";
    }
    release();
    const generation = requestGeneration.current;
    setPermission("requesting");
    try {
      const id = nextDeviceId ?? deviceId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: id && !id.startsWith("device-") ? { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true },
      });
      if (generation !== requestGeneration.current) {
        stream.getTracks().forEach((track) => track.stop());
        return "idle";
      }
      streamRef.current = stream;
      lastVoiceRef.current = Date.now();
      setPermission("granted");
      startMeter(stream);
      void refreshDevices();
      return "granted";
    } catch (error) {
      if (generation !== requestGeneration.current) return "idle";
      const next = permissionFromError(error);
      setPermission(next);
      return next;
    }
  }, [deviceId, refreshDevices, release, startMeter]);

  const selectDevice = useCallback(async (id: string) => {
    setDeviceId(id);
    return start(id);
  }, [start]);

  // 重新开始计算静音时长（开始作答时调用）
  const markVoice = useCallback(() => { lastVoiceRef.current = Date.now(); }, []);
  const silentForMs = useCallback(() => Date.now() - lastVoiceRef.current, []);
  const currentLevel = useCallback(() => levelRef.current, []);

  useEffect(() => release, [release]);

  const deviceLabel = devices.find((device) => device.id === deviceId)?.label ?? devices[0]?.label ?? "默认麦克风";

  return { permission, devices, deviceId: deviceId || devices[0]?.id || "", deviceLabel, level, history, metering, start, release, selectDevice, markVoice, silentForMs, currentLevel, startCapture, stopCapture };
}

export type Microphone = ReturnType<typeof useMicrophone>;
