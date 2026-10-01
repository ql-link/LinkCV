import { MockInterviewError, mockInterviewApi } from "../mockInterviewApi";

export type SpeechResult = { session_id: string; text: string; duration_ms: number; partial: boolean };
export type SpeechConnection = { push: (audio: ArrayBuffer) => void; stop: () => Promise<SpeechResult>; cancel: () => void };

export async function openSpeech(interviewId: string, questionId: string, purpose: "voice_input" | "voice_answer", onPartial: (text: string) => void, signal?: AbortSignal): Promise<SpeechConnection> {
  // Refresh an expired access cookie through HTTP before the browser's WS handshake.
  await mockInterviewApi.get(interviewId);
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const url = new URL(`/api/mock-interviews/${encodeURIComponent(interviewId)}/speech`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ question_id: questionId, purpose }).toString();
  const socket = new WebSocket(url);
  let resolveResult!: (result: SpeechResult) => void;
  let rejectResult!: (error: Error) => void;
  let settled = false;
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<SpeechResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // The server may fail while the user is still recording, before stop() awaits it.
  void result.catch(() => undefined);
  const fail = (code: string) => { if (!settled) { settled = true; rejectResult(new MockInterviewError(code)); } };
  const cancel = () => { fail("MOCK_INTERVIEW_SPEECH_FAILED"); socket.close(); };
  const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); };
  signal?.addEventListener("abort", cancel, { once: true });
  socket.onmessage = ({ data }) => {
    try {
      const event = JSON.parse(String(data));
      if (event.type === "partial") onPartial(event.text ?? "");
      else if (event.type === "final") { settled = true; resolveResult(event as SpeechResult); cleanup(); socket.close(); }
      else if (event.type === "error") { fail(event.code ?? "MOCK_INTERVIEW_SPEECH_FAILED"); cleanup(); socket.close(); }
    } catch { fail("MOCK_INTERVIEW_SPEECH_FAILED"); socket.close(); }
  };
  await new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => { cancel(); reject(new MockInterviewError("MOCK_INTERVIEW_SPEECH_FAILED")); }, 15_000);
    socket.onopen = () => { clearTimeout(timeout); resolve(); };
    socket.onerror = () => { fail("MOCK_INTERVIEW_SPEECH_FAILED"); reject(new MockInterviewError("MOCK_INTERVIEW_SPEECH_FAILED")); };
    socket.onclose = (event) => {
      const code = event.code === 4401 ? "UNAUTHORIZED" : event.reason || "MOCK_INTERVIEW_SPEECH_FAILED";
      fail(code); cleanup(); reject(new MockInterviewError(code));
    };
  });
  return {
    push(audio) {
      if (stopped || settled || socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 1024 * 1024) { cancel(); return; }
      socket.send(audio);
    },
    stop() {
      if (!stopped && !settled) {
        stopped = true;
        socket.send(JSON.stringify({ type: "stop" }));
        timeout = setTimeout(() => { cancel(); cleanup(); }, 30_000);
      }
      return result;
    },
    cancel() { cancel(); cleanup(); },
  };
}

// Queue speech sentences in order. stop() settles pending playback, including on navigation.
export class SpeechPlayback {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private current: (() => void) | null = null;
  enqueue(blob: Blob): Promise<void> {
    const generation = this.generation;
    const playback = this.tail.then(() => new Promise<void>((resolve, reject) => {
      if (generation !== this.generation) { resolve(); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      let finished = false;
      const done = (error?: Error) => {
        if (finished) return;
        finished = true;
        audio.onended = null; audio.onerror = null;
        audio.pause(); audio.removeAttribute("src");
        URL.revokeObjectURL(url);
        this.current = null;
        if (error) reject(error); else resolve();
      };
      this.current = () => done();
      audio.onended = () => done();
      audio.onerror = () => done(new Error("音频播放失败，可阅读字幕继续作答。"));
      void audio.play().catch(() => done(new Error("浏览器未允许播放声音，可阅读字幕继续作答。")));
    }));
    this.tail = playback.catch(() => undefined);
    return playback;
  }
  drain() { return this.tail; }
  stop() { this.generation += 1; this.current?.(); this.current = null; }
}
export function speechBlob(data: string) {
  return new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], { type: "audio/mpeg" });
}
