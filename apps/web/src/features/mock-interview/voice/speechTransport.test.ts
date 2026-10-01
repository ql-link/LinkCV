import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInterviewApi } from "../mockInterviewApi";
import { interview } from "../__tests__/fixtures";
import { openSpeech, SpeechPlayback } from "./speechTransport";
import worklet from "./pcmCapture.worklet.js?raw";
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0; bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  constructor(readonly url: string) { FakeSocket.instances.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  close = vi.fn(() => { this.readyState = 3; queueMicrotask(() => this.onclose?.({ code: 1000, reason: "" })); });
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
beforeEach(() => { vi.spyOn(mockInterviewApi, "get").mockResolvedValue({ mock_interview: interview() }); FakeSocket.instances = []; vi.stubGlobal("WebSocket", FakeSocket); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("识别通道", () => {
  it("连接同源 WS，发送 PCM、接受部分结果并用 stop 完成会话", async () => {
    const partial = vi.fn(); const connection = await openSpeech("10", "101", "voice_answer", partial);
    const socket = FakeSocket.instances[0]; const url = new URL(socket.url);
    expect(url.protocol).toBe("ws:"); expect(url.host).toBe(window.location.host); expect(url.searchParams.get("purpose")).toBe("voice_answer");
    const pcm = new ArrayBuffer(640); connection.push(pcm); expect(socket.send).toHaveBeenCalledWith(pcm);
    socket.receive({ type: "partial", text: "部分文字" }); expect(partial).toHaveBeenCalledWith("部分文字");
    const result = connection.stop(); expect(socket.send).toHaveBeenLastCalledWith('{"type":"stop"}');
    socket.receive({ type: "final", session_id: "a".repeat(32), text: "回答", duration_ms: 20, partial: false });
    expect(await result).toMatchObject({ text: "回答", session_id: "a".repeat(32) }); expect(socket.close).toHaveBeenCalled();
  });
  it("异常断开与超过缓冲限制时不能产生成功识别稿", async () => {
    const connection = await openSpeech("10", "101", "voice_input", vi.fn());
    FakeSocket.instances[0].onclose?.({ code: 4401, reason: "" });
    await expect(connection.stop()).rejects.toThrow("UNAUTHORIZED");
    const next = await openSpeech("10", "101", "voice_input", vi.fn());
    FakeSocket.instances[1].bufferedAmount = 2 * 1024 * 1024; next.push(new ArrayBuffer(640));
    await expect(next.stop()).rejects.toThrow("MOCK_INTERVIEW_SPEECH_FAILED");
  });
  it("停止后超时或取消关闭连接", async () => {
    vi.useFakeTimers(); const connection = await openSpeech("10", "101", "voice_input", vi.fn());
    const pending = connection.stop(); void pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(30_001); await expect(pending).rejects.toThrow("MOCK_INTERVIEW_SPEECH_FAILED");
    const controller = new AbortController(); const next = await openSpeech("10", "101", "voice_input", vi.fn(), controller.signal);
    controller.abort(); await expect(next.stop()).rejects.toThrow("MOCK_INTERVIEW_SPEECH_FAILED");
  });
});
describe("PCM 和播放", () => {
  it.each([44_100, 48_000])("%i Hz 连续输入重采样为 16 kHz PCM16，不丢分块相位", (sampleRate) => {
    let Processor!: new () => { process: (inputs: Float32Array[][]) => boolean; port: { onmessage: (() => void) | null; postMessage: (value: unknown) => void } };
    const emitted: unknown[] = [];
    class Base { port = { onmessage: null, postMessage: (value: unknown) => emitted.push(value) }; }
    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", worklet)(Base, (_name: string, ctor: typeof Processor) => { Processor = ctor; }, sampleRate);
    const capture = new Processor(); let remaining = sampleRate / 10;
    while (remaining) { const count = Math.min(128, remaining); capture.process([[new Float32Array(count).fill(.5)]]); remaining -= count; }
    capture.port.onmessage?.();
    const audio = emitted.filter((value): value is ArrayBuffer => value instanceof ArrayBuffer).flatMap((value) => [...new Int16Array(value)]);
    expect(audio).toHaveLength(1600); expect(new Set(audio)).toEqual(new Set([16384]));
  });
  it("播放按句排序，打断时释放音频 URL 并清除队列", async () => {
    const audios: Array<{ onended: (() => void) | null; pause: ReturnType<typeof vi.fn> }> = [];
    class FakeAudio { onended = null; onerror = null; pause = vi.fn(); removeAttribute = vi.fn(); play = vi.fn(async () => undefined); constructor() { audios.push(this); } }
    vi.stubGlobal("Audio", FakeAudio); const create = vi.fn(() => "blob:audio"); const revoke = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(create); vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
    const playback = new SpeechPlayback(); const first = playback.enqueue(new Blob(["1"])); const second = playback.enqueue(new Blob(["2"]));
    await Promise.resolve(); expect(audios).toHaveLength(1);
    playback.stop(); await first; await second;
    expect(audios).toHaveLength(1); expect(audios[0].pause).toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith("blob:audio");
  });
});
