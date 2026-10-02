// 模拟面试真实数据层：对接 /api/mock-interviews（契约见 docs/api/http-contracts.md#ai-模拟面试）。
// 页面通过 mockInterviewApi.ts 的门面调用；这里负责请求、SSE 回合流、录音读取和语音识别 WebSocket。
import { ApiRequestError, apiRequest, createApiRequestId, refreshApiSession } from "@/api/client";
import { MOCK_INTERVIEW_ERROR_MESSAGES } from "./mockInterviewText";
import { notifyMockInterviews } from "./mockInterviewEvents";
import {
  MockInterviewError,
  type MockInterviewApi,
  type MockInterviewCreateInput,
  type MockInterviewDetail,
  type MockInterviewSummary,
  type MockRecognition,
  type MockRecognitionOptions,
  type MockRecognitionResult,
  type MockTurnEvent,
} from "./mockInterviewTypes";

const BASE = "/api/mock-interviews";
const LIST_PAGE_SIZE = 100;
// 列表最多翻 5 页（500 场），足够覆盖个人使用，也避免异常游标造成无限请求。
const LIST_MAX_PAGES = 5;
const TURN_EVENTS = new Set([
  "answer.accepted",
  "interviewer.delta",
  "interviewer.audio",
  "interviewer.audio_failed",
  "interviewer.turn",
  "interviewer.failed",
]);

function enc(value: string) {
  return encodeURIComponent(value);
}

function toMockError(error: unknown): unknown {
  if (error instanceof ApiRequestError) {
    // 后端错误体为 {error: CODE}，ApiRequestError.message 即错误码
    return new MockInterviewError(error.message, MOCK_INTERVIEW_ERROR_MESSAGES[error.message]);
  }
  return error;
}

async function call<T>(path: string, options: Parameters<typeof apiRequest>[1] = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, options);
  } catch (error) {
    throw toMockError(error);
  }
}

// 带一次会话刷新的 fetch：流式与二进制响应不能走 apiRequest（它会按 JSON 解析）。
async function authedFetch(path: string, init: RequestInit, retryAuth = true): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { "X-Request-ID": createApiRequestId(), ...init.headers },
    credentials: "include",
  });
  if (response.status === 401 && retryAuth && !init.signal?.aborted && (await refreshApiSession())) {
    return authedFetch(path, init, false);
  }
  return response;
}

async function errorFrom(response: Response): Promise<MockInterviewError> {
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  const code = typeof data.error === "string" ? data.error : `HTTP_${response.status}`;
  return new MockInterviewError(code, MOCK_INTERVIEW_ERROR_MESSAGES[code]);
}

function parseFrame(frame: string): MockTurnEvent | null {
  const lines = frame.split("\n");
  const name = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const raw = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!name || !raw || !TURN_EVENTS.has(name)) return null;
  try {
    return { type: name, ...(JSON.parse(raw) as Record<string, unknown>) } as MockTurnEvent;
  } catch {
    // 单帧损坏或未知事件不应中断整个回合流
    return null;
  }
}

// 面试官回合 SSE：每个流都以 interviewer.turn 或 interviewer.failed 结束，没有终止事件视为连接中断。
async function* turnStream(path: string, body: unknown, idempotencyKey?: string): AsyncGenerator<MockTurnEvent> {
  const response = await authedFetch(path, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw await errorFrom(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseFrame(frame);
        if (!event) continue;
        if (event.type === "interviewer.turn" || event.type === "interviewer.failed") terminal = true;
        yield event;
        if (terminal) return;
      }
      if (done) break;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    notifyMockInterviews();
  }
  throw new MockInterviewError("MOCK_INTERVIEW_TURN_FAILED");
}

function idempotencyKey() {
  // 后端要求 8–64 位 [A-Za-z0-9_.:-]
  return `mi-${createApiRequestId()}`;
}

async function mutate<T>(path: string, options: Parameters<typeof apiRequest>[1] = { method: "POST" }): Promise<T> {
  const result = await call<T>(path, options);
  notifyMockInterviews();
  return result;
}

const PCM_RATE = 16000;

// 把麦克风流转成 16 kHz 单声道 PCM16 二进制帧，通过 WebSocket 发给后端识别。
class SpeechRecognition implements MockRecognition {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private settled = false;
  private readonly ready: Promise<void>;
  private readonly result: Promise<MockRecognitionResult>;
  private resolveResult!: (value: MockRecognitionResult) => void;
  private rejectResult!: (reason: unknown) => void;

  constructor(interviewId: string, private readonly options: MockRecognitionOptions) {
    this.result = new Promise<MockRecognitionResult>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // 未被 stop() 消费时的失败不应变成未处理的 rejection
    this.result.catch(() => undefined);
    this.ready = this.open(interviewId);
    this.ready.catch(() => undefined);
  }

  private fail(code: string) {
    if (this.settled) return;
    this.settled = true;
    this.teardownAudio();
    this.rejectResult(new MockInterviewError(code, MOCK_INTERVIEW_ERROR_MESSAGES[code]));
  }

  private open(interviewId: string): Promise<void> {
    const { questionId, purpose, stream } = this.options;
    if (!stream) {
      this.fail("MOCK_INTERVIEW_SPEECH_FAILED");
      return Promise.reject(new Error("no stream"));
    }
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${scheme}://${window.location.host}${BASE}/${enc(interviewId)}/speech?question_id=${enc(questionId)}&purpose=${purpose}`;
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      socket.onopen = () => {
        try {
          this.startCapture(stream, socket);
          resolve();
        } catch (error) {
          this.fail("MOCK_INTERVIEW_SPEECH_FAILED");
          reject(error);
        }
      };
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        try {
          const data = JSON.parse(message.data) as Record<string, unknown>;
          if (data.type === "partial" && typeof data.text === "string") this.options.onPartial?.(data.text);
          else if (data.type === "final" && !this.settled) {
            this.settled = true;
            this.teardownAudio();
            this.resolveResult({
              session_id: String(data.session_id ?? ""),
              text: String(data.text ?? ""),
              duration_ms: Number(data.duration_ms ?? 0),
              partial: Boolean(data.partial),
            });
          } else if (data.type === "error") this.fail(String(data.code ?? "MOCK_INTERVIEW_SPEECH_FAILED"));
        } catch {
          // 忽略无法解析的帧
        }
      };
      socket.onerror = () => { this.fail("MOCK_INTERVIEW_SPEECH_FAILED"); reject(new Error("socket error")); };
      socket.onclose = (event) => {
        // 4403 同源校验失败，4409 场次或题目状态不符；其余在未收到 final 时按识别失败处理
        if (!this.settled) this.fail(event.code === 4409 ? "MOCK_INTERVIEW_STATE_INVALID" : "MOCK_INTERVIEW_SPEECH_FAILED");
        reject(new Error("socket closed"));
      };
    });
  }

  private startCapture(stream: MediaStream, socket: WebSocket) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("AudioContext unavailable");
    // 浏览器会按 sampleRate 重采样；不支持指定采样率时抛错，由调用方按识别失败处理
    const context = new Ctor({ sampleRate: PCM_RATE });
    const source = context.createMediaStreamSource(stream);
    const node = context.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i += 1) {
        const value = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
      }
      socket.send(pcm.buffer);
    };
    source.connect(node);
    node.connect(context.destination);
    this.context = context;
    this.source = source;
    this.node = node;
  }

  private teardownAudio() {
    this.node?.disconnect();
    this.source?.disconnect();
    if (this.node) this.node.onaudioprocess = null;
    void this.context?.close().catch(() => undefined);
    this.node = null;
    this.source = null;
    this.context = null;
  }

  async stop(): Promise<MockRecognitionResult> {
    try {
      await this.ready;
    } catch {
      return this.result;
    }
    this.teardownAudio();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "stop" }));
    return this.result;
  }

  cancel() {
    this.settled = true;
    this.teardownAudio();
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) this.socket.close();
  }
}

export const liveMockInterviewApi: MockInterviewApi = {
  async list(params = {}) {
    const items: MockInterviewSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: String(LIST_PAGE_SIZE) });
      if (params.status) query.set("status", params.status);
      if (params.job_application_id) query.set("job_application_id", params.job_application_id);
      if (params.resume_id) query.set("resume_id", params.resume_id);
      if (cursor) query.set("cursor", cursor);
      const result = await call<{ items: MockInterviewSummary[]; next_cursor: string | null }>(`${BASE}?${query}`);
      items.push(...result.items);
      if (!result.next_cursor) return { items, next_cursor: null };
      cursor = result.next_cursor;
    }
    return { items, next_cursor: cursor ?? null };
  },

  get: (id) => call<{ mock_interview: MockInterviewDetail }>(`${BASE}/${enc(id)}`),

  create(input: MockInterviewCreateInput) {
    // display 只给演示数据展示用；后端按来源快照填充，且拒绝未知字段
    const { display: _display, ...body } = input;
    void _display;
    return mutate<{ mock_interview: MockInterviewDetail }>(BASE, { method: "POST", body });
  },

  answer: (id, body) => turnStream(`${BASE}/${enc(id)}/answers`, body, idempotencyKey()),
  skip: (id, body) => turnStream(`${BASE}/${enc(id)}/skip`, body, idempotencyKey()),
  retryReply: (id) => turnStream(`${BASE}/${enc(id)}/reply:retry`, undefined),

  finish: (id) => mutate(`${BASE}/${enc(id)}/finish`),
  abandon: (id) => mutate(`${BASE}/${enc(id)}/abandon`),
  retry: (id) => mutate(`${BASE}/${enc(id)}/retry`),
  repeat: (id) => mutate(`${BASE}/${enc(id)}/repeat`),
  remove: (id) => mutate(`${BASE}/${enc(id)}`, { method: "DELETE" }),

  speechCapability: () => call<{ stt: boolean; tts: boolean }>(`${BASE}/speech-capability`),

  startRecognition: (id, options) => new SpeechRecognition(id, options),

  correctTranscripts: (id) => mutate(`${BASE}/${enc(id)}/transcripts:correct`),
  editTranscript: (id, questionId, text) =>
    mutate(`${BASE}/${enc(id)}/questions/${enc(questionId)}/transcript`, { method: "PUT", body: { text } }),
  reEvaluate: (id, questionId) => mutate(`${BASE}/${enc(id)}/questions/${enc(questionId)}/re-evaluate`),
  deleteRecordings: (id) => mutate(`${BASE}/${enc(id)}/recordings`, { method: "DELETE" }),

  async recording(id, questionId) {
    const response = await authedFetch(`${BASE}/${enc(id)}/questions/${enc(questionId)}/recording`, { method: "GET" });
    if (response.status === 404) return null;
    if (!response.ok) throw await errorFrom(response);
    return response.blob();
  },
};
