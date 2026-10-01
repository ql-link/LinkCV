import { createRequestId, requestApi, requestStream } from "@/api/client";

export type MockInterviewType = "technical" | "project_deep_dive" | "hr" | "comprehensive";
export type MockDifficulty = "junior" | "intermediate" | "senior";
export type MockLanguage = "zh" | "en";
export type MockAnswerMode = "text" | "voice";
export type MockInterviewStatus =
  | "preparing"
  | "preparation_failed"
  | "in_progress"
  | "evaluating"
  | "evaluation_failed"
  | "completed"
  | "abandoned";

export type MockSignalVerdict = { signal: string; verdict: "hit" | "partial" | "miss"; evidence: string };

export type MockQuestionEvaluation = {
  skipped: boolean;
  score: number;
  achieved_depth: number;
  signals: MockSignalVerdict[];
  factual_errors: string[];
  highlights: string[];
  weaknesses: string[];
  reference_answer: string;
};

export type MockTranscriptChange = { original: string; corrected: string; reason: string };

export type MockInterviewQuestion = {
  id: string;
  parent_id: string | null;
  sequence_no: number;
  kind: "main" | "follow_up";
  plan_index: number;
  topic?: string;
  depth_level: number;
  content: string;
  answer_status: "pending" | "answered" | "skipped";
  answer_text: string | null;
  answered_at: string | null;
  evaluation: MockQuestionEvaluation | null;
  answer_source: "text" | "voice_input" | "voice" | null;
  audio_duration_ms: number | null;
  has_recording: boolean;
  raw_transcript: string | null;
  transcript_state: "original" | "corrected" | "correction_rejected" | "edited" | null;
  correction: { changes: MockTranscriptChange[] } | null;
  re_evaluate_count: number;
  evaluation_history: Array<{ score: number; previous_score: number; evaluated_at: string }> | null;
};

export type MockDimension = {
  key: "professional_depth" | "structure" | "job_fit" | "resume_consistency" | "communication";
  score: number;
  weight: number;
  evidence: string[];
  comment: string;
};

export type MockVoiceMetrics = {
  chars_per_minute: number;
  long_pauses: number;
  filler_ratio: number;
  answer_duration_ms: number;
  reference: Record<string, [number, number]>;
  tip: string;
};

export type MockFactCheckItem = {
  claim: string;
  verdict: "consistent" | "conflict" | "material_stronger" | "not_found";
  quote: string;
  question_sequence_no: number;
  note: string;
  source: { dataset_id: string; title: string; version: string; position: string; text: string } | null;
};

export type MockInterviewReport = {
  rubric_version: string;
  answer_mode: MockAnswerMode;
  voice_metrics: MockVoiceMetrics | null;
  headline: string;
  summary: string;
  total_score: number;
  question_average: number;
  dimension_score: number;
  dimensions: MockDimension[];
  questions: Array<MockQuestionEvaluation & { topic: string; sequence_no: number }>;
  fact_check: { status: "not_requested" | "completed" | "failed"; items: MockFactCheckItem[] };
  resume_risks: string[];
  improvements: string[];
  off_topic_detected: boolean;
  low_confidence: boolean;
  closing_message?: string;
  re_evaluations?: Array<{ sequence_no: number; count: number; previous_score: number; score: number; previous_total: number; total: number }>;
};

export type MockInterviewSummary = {
  id: string;
  status: MockInterviewStatus;
  source_type: "job_application" | "resume";
  job_application_id: string | null;
  resume_id: string | null;
  job_description_id: string | null;
  repeat_of_id: string | null;
  resume_title: string;
  company_name: string | null;
  job_title: string | null;
  target_role: string | null;
  stage_label: string | null;
  interview_type: MockInterviewType;
  difficulty: MockDifficulty;
  question_count: number;
  follow_up_enabled: boolean;
  language: MockLanguage;
  answer_mode: MockAnswerMode;
  materials_in_questions: boolean;
  total_score: number | null;
  low_confidence: boolean;
  error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  lock_version: number;
};

export type MockInterviewDetail = MockInterviewSummary & {
  materials: Array<{ dataset_id: string; file_name: string; version: string }>;
  current_question_id: string | null;
  answered_main_questions: number;
  needs_reply: boolean;
  questions: MockInterviewQuestion[];
  report: MockInterviewReport | null;
  transcript_corrected_at: string | null;
  recordings_deleted: boolean;
};

export type MockInterviewCreateInput = {
  job_application_id?: string;
  resume_id?: string;
  job_description_id?: string;
  job_description_text?: string;
  target_role?: string;
  interview_type?: MockInterviewType;
  difficulty?: MockDifficulty;
  question_count?: number;
  follow_up_enabled?: boolean;
  language?: MockLanguage;
  answer_mode?: MockAnswerMode;
  material_ids?: string[];
  materials_in_questions?: boolean;
};

// SSE 回合事件（与后端事件名一致）
export type MockTurnEvent =
  | { type: "answer.accepted"; question_id: string; skipped: boolean; lock_version: number }
  | { type: "interviewer.delta"; content: string }
  | { type: "interviewer.turn"; status: MockInterviewStatus; action: "follow_up" | "next_question" | "finish"; question: MockInterviewQuestion | null; closing_message: string | null; lock_version: number }
  | { type: "interviewer.audio"; seq: number; text: string; format: "mp3"; data: string }
  | { type: "interviewer.audio_failed"; seq: number; text: string }
  | { type: "interviewer.failed"; error: string };

export class MockInterviewError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
  }
}

export const INTERVIEW_TYPE_LABELS: Record<MockInterviewType, string> = {
  technical: "技术面",
  project_deep_dive: "项目深挖",
  comprehensive: "综合面",
  hr: "HR 面",
};
export const DIFFICULTY_LABELS: Record<MockDifficulty, string> = { junior: "初级", intermediate: "中级", senior: "高级" };
export const DIMENSION_LABELS: Record<MockDimension["key"], string> = {
  professional_depth: "专业深度",
  structure: "表达结构",
  job_fit: "岗位匹配",
  resume_consistency: "简历一致性",
  communication: "沟通表现",
};
export const ACTIVE_STATUSES: MockInterviewStatus[] = ["preparing", "in_progress", "evaluating"];


const BASE = "/api/mock-interviews";
const path = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
export function subscribeMockInterviews(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
type InterviewResponse = { mock_interview: MockInterviewDetail };
type ListParams = { status?: MockInterviewStatus; job_application_id?: string; resume_id?: string; cursor?: string; limit?: number };
async function mutate<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const result = await requestApi<T>(url, { method, body });
  changed();
  return result;
}

// Read complete SSE frames rather than assuming one fetch chunk is one event.
export async function* readMockTurn(response: Response): AsyncGenerator<MockTurnEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new MockInterviewError("MOCK_INTERVIEW_STREAM_INTERRUPTED");
  const decoder = new TextDecoder();
  let buffer = "";
  let accepted = false;
  let terminal = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!event || !data) continue;
        if (!["answer.accepted", "interviewer.delta", "interviewer.turn", "interviewer.failed", "interviewer.audio", "interviewer.audio_failed"].includes(event)) continue;
        const payload = JSON.parse(data) as Record<string, unknown>;
        accepted ||= event === "answer.accepted";
        terminal ||= event === "interviewer.turn" || event === "interviewer.failed";
        yield { ...payload, type: event } as MockTurnEvent;
      }
      if (done) break;
      if (buffer.length > 8 * 1024 * 1024) throw new MockInterviewError("MOCK_INTERVIEW_STREAM_INTERRUPTED");
    }
    // A replay can contain just the acceptance receipt; refresh restores its actual state.
    if (buffer.trim() || (!terminal && !accepted)) throw new MockInterviewError("MOCK_INTERVIEW_STREAM_INTERRUPTED");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function* turn(id: string, action: string, body?: unknown, key?: string, signal?: AbortSignal) {
  try {
    const response = await requestStream(`${path(id)}/${action}`, { method: "POST", body, signal, headers: key ? { "Idempotency-Key": key } : undefined });
    yield* readMockTurn(response);
  } finally { changed(); }
}

export const mockInterviewApi = {
  list(params: ListParams = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return requestApi<{ items: MockInterviewSummary[]; next_cursor: string | null }>(`${BASE}?${query}`);
  },
  async listAll(params: Omit<ListParams, "cursor" | "limit"> = {}) {
    const items: MockInterviewSummary[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const result = await mockInterviewApi.list({ ...params, limit: 100, cursor });
      items.push(...result.items);
      cursor = result.next_cursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new MockInterviewError("MOCK_INTERVIEW_PAGINATION_FAILED");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return { items, next_cursor: null };
  },
  get: (id: string) => requestApi<InterviewResponse>(path(id)),
  create: (input: MockInterviewCreateInput) => mutate<InterviewResponse>(BASE, input),
  answer: (id: string, body: { question_id: string; answer?: string; speech_session_id?: string }, key = createRequestId(), signal?: AbortSignal) => turn(id, "answers", body, key, signal),
  skip: (id: string, body: { question_id: string }, key = createRequestId(), signal?: AbortSignal) => turn(id, "skip", body, key, signal),
  retryReply: (id: string, signal?: AbortSignal) => turn(id, "reply:retry", undefined, undefined, signal),
  finish: (id: string) => mutate<InterviewResponse>(`${path(id)}/finish`),
  abandon: (id: string) => mutate<InterviewResponse>(`${path(id)}/abandon`),
  retry: (id: string) => mutate<InterviewResponse>(`${path(id)}/retry`),
  repeat: (id: string, answerMode?: MockAnswerMode) => mutate<InterviewResponse>(`${path(id)}/repeat`, answerMode ? { answer_mode: answerMode } : undefined),
  remove: (id: string) => mutate<{ deleted: boolean }>(path(id), undefined, "DELETE"),
  speechCapability: () => requestApi<{ stt: boolean; tts: boolean }>(`${BASE}/speech-capability`),
  async speechPlayback(id: string, questionId?: string, signal?: AbortSignal) {
    return (await requestStream(`${path(id)}/speech/playback`, { method: "POST", body: { question_id: questionId }, signal })).blob();
  },
  async recording(id: string, questionId: string) {
    return (await requestStream(`${path(id)}/questions/${encodeURIComponent(questionId)}/recording`)).blob();
  },
  correctTranscripts: (id: string) => mutate<{ items: Array<{ question_id: string; state: string | null; changes: MockTranscriptChange[] }>; mock_interview: MockInterviewDetail }>(`${path(id)}/transcripts:correct`),
  editTranscript: (id: string, questionId: string, text: string) => mutate<InterviewResponse>(`${path(id)}/questions/${encodeURIComponent(questionId)}/transcript`, { text }, "PUT"),
  reEvaluate: (id: string, questionId: string) => mutate<{ question_id: string; evaluation: MockQuestionEvaluation; re_evaluate_count: number; remaining: number; total_score: number; previous_total_score: number | null }>(`${path(id)}/questions/${encodeURIComponent(questionId)}/re-evaluate`),
  deleteRecordings: (id: string) => mutate<InterviewResponse>(`${path(id)}/recordings`, undefined, "DELETE"),
};

const ERRORS: Record<string, string> = {
  UNAUTHORIZED: "登录已过期，请重新登录。",
  VALIDATION_ERROR: "请检查填写内容后重试。",
  MOCK_INTERVIEW_IN_PROGRESS: "已有一场进行中的模拟面试，请先完成或放弃它。",
  MOCK_INTERVIEW_NOT_FOUND: "这场模拟面试不存在或已删除。",
  MOCK_INTERVIEW_STATE_INVALID: "场次状态已变化，请刷新后重试。",
  MOCK_INTERVIEW_QUESTION_MISMATCH: "当前题目已变化，请刷新场次后继续。",
  MOCK_INTERVIEW_MATERIAL_INVALID: "参考资料不可用，请重新选择。",
  MOCK_INTERVIEW_RESUME_REQUIRED: "请先选择可用的简历。",
  MOCK_INTERVIEW_SPEECH_UNAVAILABLE: "语音服务尚未配置，可以改用文字面试。",
  MOCK_INTERVIEW_SPEECH_FAILED: "语音识别失败，请重录或改用文字。",
  MOCK_INTERVIEW_SPEECH_EMPTY: "没有识别到回答，请重新录音。",
  MOCK_INTERVIEW_SPEECH_SESSION_INVALID: "识别会话已过期或已使用，请重新录音。",
  MOCK_INTERVIEW_STREAM_INTERRUPTED: "连接中断，请刷新场次确认回答是否已保存。",
  MOCK_INTERVIEW_RECORDING_NOT_FOUND: "录音已删除或不可用。",
  MOCK_INTERVIEW_RECORDING_STORE_FAILED: "录音保存失败，请重试提交。",
  MOCK_INTERVIEW_RECORDING_DELETE_FAILED: "录音删除失败，请重试；删除完成前保留场次记录。",
  MOCK_INTERVIEW_TRANSCRIPT_CORRECTION_REJECTED: "修改幅度超过原识别稿的 15%，只能修正错字和术语。",
  MOCK_INTERVIEW_TRANSCRIPT_ALREADY_CORRECTED: "本场识别稿已经修正过一次。",
  MOCK_INTERVIEW_RE_EVALUATE_LIMIT: "每道题最多重新评估 3 次。",
  LLM_MODEL_NOT_CONFIGURED: "管理员尚未配置面试模型，请稍后再试。",
  LLM_PROVIDER_ERROR: "模型服务暂时不可用，请稍后重试。",
};
export function mockInterviewErrorMessage(error: unknown) {
  const code = error instanceof MockInterviewError ? error.code : error instanceof Error ? error.message : "";
  if (error instanceof MockInterviewError && error.message !== error.code) return error.message;
  return ERRORS[code] ?? "操作没有完成，请稍后重试。";
}

export function changeRatio(original: string, next: string) {
  const a = original.trim();
  const b = next.trim();
  if (!a) return b ? 1 : 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return previous[b.length] / a.length;
}
