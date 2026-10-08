import { t } from "@/i18n";
// 模拟面试的前端类型、错误与标签。类型与 FastAPI modules/mock_interviews/schemas.py 对齐，
// 详见 docs/api/http-contracts.md#ai-模拟面试。

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

export type MockFactualError = { description: string; severity: "minor" | "major" };

export type MockQuestionEvaluation = {
  skipped: boolean;
  score: number;
  achieved_depth: number;
  // v4：面试官实际追问到的深度与深度判定；没追问到期望深度时不扣分。
  probed_depth?: number;
  depth_status?: "met" | "short" | "not_probed" | "not_scored";
  expression?: { verdict: MockSignalVerdict["verdict"]; evidence: string; note: string } | null;
  signals: Array<MockSignalVerdict & { competency?: string; core?: boolean }>;
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
  // 假数据额外提供考点名（后端题目记录没有这个字段，考点在 plan_json 里）
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
  evaluation_history: Array<{ score: number; evaluated_at: string }> | null;
};

export type MockDimension = {
  key: "professional_depth" | "structure" | "job_fit" | "resume_consistency" | "communication" | MockCompetencyKey;
  score: number;
  weight: number;
  evidence: string;
  comment: string;
};

// 评分规则 v4：能力项由逐题要点重新归类得出，只解释分数、不参与计分。
export type MockCompetencyKey = "knowledge" | "problem_solving" | "ownership" | "motivation" | "communication" | "job_fit";
export type MockVerdictLevel = "meets" | "borderline" | "below" | "insufficient";

export type MockReportVerdict = {
  level: MockVerdictLevel;
  target: MockDifficulty;
  core_hit_rate: number;
  risk_flags: Array<{ kind: "low_question" | "major_error" | "material_conflict" | "skipped_core"; sequence_no: number | null; text: string }>;
  reasons: string[];
};

export type MockCompetency = {
  key: MockCompetencyKey;
  assessed: boolean;
  score: number | null;
  level: "strong" | "solid" | "weak" | null;
  weight: number;
  question_refs: number[];
  comment: string;
};

export type MockReportAction = {
  title: string;
  detail: string;
  priority: "high" | "normal";
  kind: "practice" | "resume" | "material";
  question_refs: number[];
  competency: string | null;
  resume_quote: string | null;
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
  verdict: "consistent" | "conflict" | "material_stronger" | "unsupported";
  quote: string;
  dataset_id: string;
  file_name: string;
};

// 页面使用的报告视图。v4 报告在数据层（reportCompat.ts）补齐旧字段，并原样保留 v4 字段供新报告页使用。
export type MockInterviewReport = {
  rubric_version: string;
  verdict?: MockReportVerdict;
  competencies?: MockCompetency[];
  actions?: MockReportAction[];
  answer_mode: MockAnswerMode;
  voice_metrics: MockVoiceMetrics | null;
  headline: string;
  summary: string;
  total_score: number;
  question_average: number;
  dimension_score: number;
  dimensions: MockDimension[];
  questions: Array<MockQuestionEvaluation & { topic: string; sequence_no: number; is_intro?: boolean }>;
  fact_check: { status: "not_requested" | "completed" | "failed"; items: MockFactCheckItem[] };
  resume_risks: string[];
  improvements: string[];
  strengths?: string[];
  practice_focus?: Array<{ topic: string; sequence_no: number; score: number; reason: string }>;
  consistency_basis?: "materials" | "model_only";
  prompt_version?: string;
  off_topic_detected: boolean;
  low_confidence: boolean;
  closing_message?: string;
  re_evaluations?: Array<{ question_id: string; before: number; after: number; at: string }>;
};

// 后端 v4 原始报告中与视图不同的字段。
export type MockInterviewReportV4Raw = Omit<MockInterviewReport, "dimensions" | "questions" | "question_average" | "dimension_score" | "resume_risks" | "improvements"> & {
  rubric_version: "v4";
  verdict: MockReportVerdict;
  dimensions: MockCompetency[];
  actions: MockReportAction[];
  questions: Array<Omit<MockQuestionEvaluation, "factual_errors"> & {
    topic: string;
    sequence_no: number;
    number: number;
    is_intro?: boolean;
    factual_errors: MockFactualError[];
  }>;
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
  total_score: number | null;
  low_confidence: boolean;
  rubric_version?: string | null;
  verdict?: MockVerdictLevel | null;
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
  // 面试以固定的自我介绍开场，它不占用 question_count。
  has_intro?: boolean;
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
  // 以下仅供假数据展示（真实接口由后端按来源快照填充）
  display?: { resume_title?: string; company_name?: string; job_title?: string; stage_label?: string; materials?: Array<{ dataset_id: string; file_name: string }> };
};

// SSE 回合事件（与后端事件名一致）
export type MockTurnEvent =
  | { type: "answer.accepted"; question_id: string; skipped: boolean; lock_version: number }
  | { type: "interviewer.delta"; content: string }
  | { type: "interviewer.turn"; status: MockInterviewStatus; action: "follow_up" | "next" | "finish"; question: MockInterviewQuestion | null; closing_message: string | null; lock_version: number }
  | { type: "interviewer.audio"; seq: number; text: string; format: "mp3"; data: string }
  | { type: "interviewer.audio_failed"; seq: number; text: string }
  | { type: "interviewer.failed"; error: string };

export class MockInterviewError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
  }
}

export const INTERVIEW_TYPE_LABELS: Record<MockInterviewType, string> = {
  get technical() { return t("技术面"); },
  get project_deep_dive() { return t("项目深挖"); },
  get comprehensive() { return t("综合面"); },
  get hr() { return t("HR 面"); },
};
export const DIFFICULTY_LABELS: Record<MockDifficulty, string> = { get junior() { return t("初级"); }, get intermediate() { return t("中级"); }, get senior() { return t("高级"); } };
export const DIMENSION_LABELS: Record<MockDimension["key"], string> = {
  get professional_depth() { return t("专业深度"); },
  get structure() { return t("表达结构"); },
  get job_fit() { return t("岗位匹配"); },
  get resume_consistency() { return t("简历一致性"); },
  get communication() { return t("沟通表现"); },
  get knowledge() { return t("知识与原理"); },
  get problem_solving() { return t("方案与权衡"); },
  get ownership() { return t("项目主导与成果"); },
  get motivation() { return t("动机与稳定性"); },
};
// v1–v3 报告的五个维度；首页能力雷达只汇总这一组，避免与 v4 能力项混在同一张图里。
export const LEGACY_DIMENSION_KEYS = ["professional_depth", "structure", "job_fit", "resume_consistency", "communication"] as const;
export const ACTIVE_STATUSES: MockInterviewStatus[] = ["preparing", "in_progress", "evaluating"];

// 数据层接口：真实实现在 mockInterviewLive.ts，演示实现（本地假数据）在 mockInterviewDemo.ts，
// 页面只通过 mockInterviewApi.ts 里的同名门面调用。
export type MockRecognitionResult = { session_id: string; text: string; duration_ms: number; partial: boolean };

// 一次实时识别：开始后持续接收麦克风音频，stop 结束并返回识别结果，cancel 丢弃。
export type MockRecognition = {
  stop(): Promise<MockRecognitionResult>;
  cancel(): void;
};

export type MockRecognitionOptions = {
  questionId: string;
  purpose: "voice_input" | "voice_answer";
  stream: MediaStream | null;
  onPartial?: (text: string) => void;
  // 仅演示实现使用：模拟整段无声时识别失败
  failIfSilent?: () => boolean;
};

export type MockInterviewApi = {
  list(params?: { status?: MockInterviewStatus; job_application_id?: string; resume_id?: string }): Promise<{ items: MockInterviewSummary[]; next_cursor: string | null }>;
  get(id: string): Promise<{ mock_interview: MockInterviewDetail }>;
  create(input: MockInterviewCreateInput): Promise<{ mock_interview: MockInterviewDetail }>;
  answer(id: string, body: { question_id: string; answer?: string; speech_session_id?: string }): AsyncGenerator<MockTurnEvent>;
  skip(id: string, body: { question_id: string }): AsyncGenerator<MockTurnEvent>;
  retryReply(id: string): AsyncGenerator<MockTurnEvent>;
  finish(id: string): Promise<{ mock_interview: MockInterviewDetail }>;
  abandon(id: string): Promise<{ mock_interview: MockInterviewDetail }>;
  retry(id: string): Promise<{ mock_interview: MockInterviewDetail }>;
  // answer_mode 可覆盖新场次的作答方式，省略时沿用原场
  repeat(id: string, options?: { answer_mode?: MockInterviewDetail["answer_mode"] }): Promise<{ mock_interview: MockInterviewDetail }>;
  remove(id: string): Promise<{ deleted: boolean }>;
  speechCapability(): Promise<{ stt: boolean; tts: boolean }>;
  startRecognition(id: string, options: MockRecognitionOptions): MockRecognition;
  // 本人语音场次的面试官语音（audio/mpeg）：省略 questionId 为设备试音，否则为当前未答题目
  speechPlayback(id: string, questionId?: string, signal?: AbortSignal): Promise<Blob>;
  correctTranscripts(id: string): Promise<{ items: Array<{ question_id: string; state: MockInterviewQuestion["transcript_state"]; changes: MockTranscriptChange[] }>; mock_interview: MockInterviewDetail }>;
  editTranscript(id: string, questionId: string, text: string): Promise<{ mock_interview: MockInterviewDetail }>;
  reEvaluate(id: string, questionId: string): Promise<{ question_id: string; evaluation: MockQuestionEvaluation | null; re_evaluate_count: number; remaining: number; total_score: number; previous_total_score: number | null; mock_interview: MockInterviewDetail }>;
  deleteRecordings(id: string): Promise<{ mock_interview: MockInterviewDetail }>;
  // 一条回答的录音（audio/wav）。演示实现没有录音，返回 null。
  recording(id: string, questionId: string): Promise<Blob | null>;
};
