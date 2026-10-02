// 模拟面试的演示数据层：本地假数据，存 localStorage，只供自动化测试与离线演示使用。
// 生产页面走 mockInterviewLive.ts 的真实接口；门面 mockInterviewApi.ts 默认指向真实实现。
import {
  ACTIVE_STATUSES,
  MockInterviewError,
  type MockAnswerMode,
  type MockDimension,
  type MockInterviewApi,
  type MockInterviewCreateInput,
  type MockInterviewDetail,
  type MockInterviewQuestion,
  type MockInterviewReport,
  type MockInterviewStatus,
  type MockInterviewSummary,
  type MockQuestionEvaluation,
  type MockRecognition,
  type MockRecognitionOptions,
  type MockSignalVerdict,
  type MockTranscriptChange,
  type MockTurnEvent,
} from "./mockInterviewTypes";
import { changeRatio } from "./mockInterviewText";
import { notifyMockInterviews } from "./mockInterviewEvents";

/* ───────────── 内存 + localStorage 存储 ───────────── */

const MOCK_STORE_KEY = "linkresume.mock-interviews.demo.v3";
const PREPARE_MS = 2400;
const EVALUATE_MS = 2600;

type Store = { items: MockInterviewDetail[]; seq: number };

let memory: Store | null = null;

function now() {
  return new Date().toISOString();
}

function load(): Store {
  if (memory) return memory;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(MOCK_STORE_KEY) : null;
    memory = raw ? (JSON.parse(raw) as Store) : seedStore();
  } catch {
    memory = seedStore();
  }
  return memory;
}

function save() {
  try {
    if (memory && typeof localStorage !== "undefined") localStorage.setItem(MOCK_STORE_KEY, JSON.stringify(memory));
  } catch { /* 存储不可用时只保留内存数据 */ }
  notifyMockInterviews();
}

export function resetMockInterviewStore(seed = true) {
  memory = seed ? seedStore() : { items: [], seq: 100 };
  save();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function delay(ms = 180) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function find(id: string) {
  const item = load().items.find((entry) => entry.id === id);
  if (!item) throw new MockInterviewError("MOCK_INTERVIEW_NOT_FOUND", "这场模拟面试不存在或已被删除。");
  return item;
}

function nextId() {
  const store = load();
  store.seq += 1;
  return String(store.seq);
}

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toSummary(item: MockInterviewDetail): MockInterviewSummary {
  const { materials: _m, current_question_id: _c, answered_main_questions: _a, needs_reply: _n, questions: _q, report: _r, transcript_corrected_at: _t, recordings_deleted: _d, ...summary } = item;
  return summary;
}

/* ───────────── 题库与示例报告（虚构内容） ───────────── */

const PLAN = [
  { topic: "调度平台的分片设计", main: "你在简历里写了「调度平台支撑日均千万级任务」，能讲讲任务是怎么分片的吗？分片键是怎么选的？", follow: "如果某个分片突然成为热点，你会怎么发现并处理？", signals: ["分片键选择依据", "热点识别手段", "迁移时的一致性"] },
  { topic: "分片迁移与一致性", main: "扩容时分片需要迁移，你们是怎么做到迁移过程中任务不重复、不丢失的？", follow: "双写期间如果源分片所在节点宕机，版本号还没同步到新分片，这时候会发生什么？你会怎么处理？", signals: ["双写或切换方案", "版本号 / 幂等", "故障回滚"] },
  { topic: "短链服务系统设计", main: "如果让你设计一个短链服务，日均生成一亿条短链，你会怎么设计？", follow: "发号器用号段模式的话，号段服务挂了怎么办？", signals: ["发号策略", "存储选型", "缓存与热点"] },
  { topic: "线上故障排查", main: "讲一次你印象最深的线上故障，你是怎么定位的？", follow: "事后你们做了哪些改进来避免同类问题？", signals: ["定位路径清晰", "量化影响", "复盘与改进"] },
  { topic: "团队协作", main: "你和产品对需求优先级有分歧时，一般怎么推进？", follow: "有没有一次你最终没能说服对方的例子？", signals: ["对齐目标", "数据支撑", "结果复盘"] },
  { topic: "消息队列", main: "你们用 Kafka 的时候，怎么保证消费不丢不重？", follow: "消费者 rebalance 期间会有什么问题？", signals: ["提交位点策略", "幂等消费", "rebalance 影响"] },
  { topic: "缓存一致性", main: "缓存和数据库的一致性你们是怎么处理的？", follow: "延迟双删里的延迟时间你是怎么定的？", signals: ["更新顺序", "失效策略", "兜底方案"] },
  { topic: "职业规划", main: "未来三年你希望自己在技术上往哪个方向发展？", follow: "为什么觉得这个岗位能帮你实现？", signals: ["方向清晰", "与岗位关联", "可执行计划"] },
  { topic: "性能优化", main: "说一个你做过的性能优化，优化前后指标分别是多少？", follow: "瓶颈是怎么定位到的？", signals: ["量化指标", "定位方法", "方案取舍"] },
  { topic: "自我介绍", main: "先用两分钟做个自我介绍吧，重点讲和这个岗位相关的经历。", follow: "你觉得自己最大的短板是什么？", signals: ["重点突出", "与岗位相关", "时长控制"] },
];

const SAMPLE_ANSWERS = [
  "我们按任务所属的业务租户加任务 ID 取模分片，租户保证局部性，取模让分布均匀。热点主要靠每个分片的队列积压监控，超过阈值会把租户拆到独立分片。",
  "迁移用的是双写加版本号：先把新分片加入写路径，旧分片继续承担读，任务带版本号，消费时比较版本号做幂等。确认追平后再切读。",
  "发号用号段模式，每个实例一次取一千个号，存储用 MySQL 分库加 Redis 缓存热点短链，读多写少所以缓存命中率很高。",
  "有一次调度延迟突然升高，我先看了分片积压，发现是一个租户批量补数据，把它限流后恢复，之后加了租户级配额。",
  "我会先对齐大家要达成的业务目标，再拿数据说明两个方案的收益，最后按影响面排优先级。",
];

function makeQuestion(interview: MockInterviewDetail, planIndex: number, kind: "main" | "follow_up", parentId: string | null): MockInterviewQuestion {
  const plan = PLAN[planIndex % PLAN.length];
  return {
    id: nextId(),
    parent_id: parentId,
    sequence_no: interview.questions.length + 1,
    kind,
    plan_index: planIndex,
    topic: plan.topic,
    depth_level: kind === "main" ? 2 : 3,
    content: kind === "main" ? plan.main : plan.follow,
    answer_status: "pending",
    answer_text: null,
    answered_at: null,
    evaluation: null,
    answer_source: null,
    audio_duration_ms: null,
    has_recording: false,
    raw_transcript: null,
    transcript_state: null,
    correction: null,
    re_evaluate_count: 0,
    evaluation_history: null,
  };
}

function evaluationFor(planIndex: number, skipped: boolean, seed: number): MockQuestionEvaluation {
  const plan = PLAN[planIndex % PLAN.length];
  if (skipped) {
    return { skipped: true, score: 0, achieved_depth: 0, signals: plan.signals.map((signal) => ({ signal, verdict: "miss", evidence: "" })), factual_errors: [], highlights: [], weaknesses: [], reference_answer: "" };
  }
  const verdicts: MockSignalVerdict["verdict"][] = seed % 3 === 0 ? ["hit", "hit", "partial"] : seed % 3 === 1 ? ["hit", "partial", "miss"] : ["hit", "hit", "hit"];
  const score = [78, 64, 92, 71, 85][seed % 5];
  return {
    skipped: false,
    score,
    achieved_depth: score >= 85 ? 3 : 2,
    signals: plan.signals.map((signal, index) => ({ signal, verdict: verdicts[index] ?? "miss", evidence: verdicts[index] === "miss" ? "" : SAMPLE_ANSWERS[seed % SAMPLE_ANSWERS.length].slice(0, 26) })),
    factual_errors: [],
    highlights: ["结构清楚，先给方案再讲原因", "有具体的监控指标支撑判断"],
    weaknesses: score < 80 ? ["故障场景下的边界没有展开", "没有说明方案的代价"] : ["可以补充方案的量化收益"],
    reference_answer: "先说明分片键的选择依据（均匀性、局部性、可扩展），再讲热点识别（积压、QPS 分位数监控）与处置（拆分、限流、预分片），最后补充迁移中的一致性保障（双写 + 版本号 + 幂等消费，追平后切读）。",
  };
}

function buildReport(interview: MockInterviewDetail): MockInterviewReport {
  const roots = interview.questions.filter((question) => question.kind === "main");
  const questions = roots.map((root, index) => ({ topic: PLAN[root.plan_index % PLAN.length].topic, sequence_no: root.sequence_no, ...(root.evaluation ?? evaluationFor(root.plan_index, root.answer_status === "skipped", index)) }));
  const average = questions.length ? questions.reduce((sum, item) => sum + item.score, 0) / questions.length : 0;
  const dimensions: MockDimension[] = [
    { key: "professional_depth", score: 4, weight: 0.3, evidence: "双写加版本号做幂等", comment: "方案成型，边界场景展开不够。" },
    { key: "structure", score: 4, weight: 0.2, evidence: "先说分片键，再说热点", comment: "回答先结论后细节，层次清楚。" },
    ...(interview.company_name ? [{ key: "job_fit" as const, score: 4, weight: 0.2, evidence: "日均千万级任务", comment: "高并发与分布式经验与岗位要求吻合。" }] : []),
    { key: "resume_consistency", score: 5, weight: 0.15, evidence: "按租户加任务 ID 取模", comment: "回答与简历描述一致。" },
    { key: "communication", score: 3, weight: 0.15, evidence: "", comment: interview.answer_mode === "voice" ? "语速偏快，长停顿较多。" : "表述偶有跳跃。" },
  ];
  const dimensionScore = Math.round((dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) / dimensions.reduce((sum, item) => sum + item.weight, 0)) * 20 * 10) / 10;
  const total = Math.round((average * 0.7 + dimensionScore * 0.3) * 10) / 10;
  const answered = roots.filter((root) => root.answer_status === "answered").length;
  return {
    rubric_version: interview.answer_mode === "voice" ? "v2" : "v1",
    answer_mode: interview.answer_mode,
    voice_metrics: interview.answer_mode === "voice"
      ? { chars_per_minute: 268, long_pauses: 4, filler_ratio: 0.031, answer_duration_ms: 612_000, reference: { chars_per_minute: [180, 240], long_pauses: [0, 3], filler_ratio: [0, 0.03] }, tip: "语速偏快，关键结论前可以稍作停顿。" }
      : null,
    headline: "项目细节扎实，但故障边界与一致性权衡讲得不够深",
    summary: "你对调度平台的分片与迁移方案非常熟悉，能用具体指标支撑判断；追问到节点宕机、版本号未同步等边界场景时，回答停留在方案层面，没有说明代价与兜底。建议准备 2–3 个故障推演。",
    total_score: total,
    question_average: Math.round(average * 100) / 100,
    dimension_score: dimensionScore,
    dimensions,
    questions,
    fact_check: interview.materials.length
      ? { status: "completed", items: [{ claim: "调度平台日均千万级任务", verdict: "consistent", quote: "平台日均调度任务约 1200 万", dataset_id: interview.materials[0].dataset_id, file_name: interview.materials[0].file_name }] }
      : { status: "not_requested", items: [] },
    resume_risks: ["简历写「主导」迁移方案，但回答中多次使用「我们」，面试官可能追问个人贡献。"],
    improvements: ["准备节点宕机、网络分区下的迁移推演", "每个方案补一句代价与取舍", "用 STAR 结构讲故障案例"],
    off_topic_detected: false,
    low_confidence: answered < 2 || roots.filter((root) => root.answer_status === "skipped").length > roots.length / 2,
  };
}

function baseInterview(input: Partial<MockInterviewDetail>): MockInterviewDetail {
  return {
    id: uuid(),
    status: "preparing",
    source_type: "job_application",
    job_application_id: null,
    resume_id: null,
    job_description_id: null,
    repeat_of_id: null,
    resume_title: "后端开发 · 2026",
    company_name: null,
    job_title: null,
    target_role: null,
    stage_label: null,
    interview_type: "comprehensive",
    difficulty: "intermediate",
    question_count: 5,
    follow_up_enabled: true,
    language: "zh",
    answer_mode: "text",
    total_score: null,
    low_confidence: false,
    error_code: null,
    started_at: null,
    finished_at: null,
    created_at: now(),
    lock_version: 1,
    materials: [],
    current_question_id: null,
    answered_main_questions: 0,
    needs_reply: false,
    questions: [],
    report: null,
    transcript_corrected_at: null,
    recordings_deleted: false,
    ...input,
  };
}

// 示例记录：两场已完成（一场文字、一场语音），供「练习记录」和评估报告展示
function seedStore(): Store {
  const store: Store = { items: [], seq: 100 };
  memory = store;
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const completed = (answerMode: MockAnswerMode, days: number, company: string, job: string, stage: string) => {
    const interview = baseInterview({ status: "completed", company_name: company, job_title: job, stage_label: stage, answer_mode: answerMode, interview_type: "technical", created_at: daysAgo(days), started_at: daysAgo(days), finished_at: new Date(Date.parse(daysAgo(days)) + 32 * 60_000).toISOString(), materials: [{ dataset_id: "9001", file_name: "调度平台设计文档.md", version: "1" }] });
    for (let index = 0; index < 5; index += 1) {
      const main = makeQuestion(interview, index, "main", null);
      main.answer_status = "answered";
      main.answer_text = SAMPLE_ANSWERS[index];
      main.answered_at = interview.started_at;
      main.answer_source = answerMode === "voice" ? "voice" : "text";
      main.evaluation = evaluationFor(index, false, index);
      if (answerMode === "voice") {
        main.has_recording = true;
        main.audio_duration_ms = 90_000 + index * 12_000;
        main.raw_transcript = SAMPLE_ANSWERS[index].replace("版本号", "版本好").replace("幂等", "密等");
        main.transcript_state = "original";
      }
      interview.questions.push(main);
      if (index < 2) {
        const follow = makeQuestion(interview, index, "follow_up", main.id);
        follow.answer_status = "answered";
        follow.answer_text = "会先暂停该分片的迁移，按版本号回放源分片的写日志，确认新分片追平后再恢复。";
        follow.answer_source = main.answer_source;
        interview.questions.push(follow);
      }
    }
    interview.answered_main_questions = 5;
    interview.report = buildReport(interview);
    interview.total_score = interview.report.total_score;
    store.items.push(interview);
  };
  completed("text", 6, "示例跳动", "后端开发", "二面");
  completed("voice", 2, "示例跳动", "后端开发", "三面");
  return store;
}

/* ───────────── 状态推进（模拟后台任务） ───────────── */

function schedulePreparation(id: string) {
  setTimeout(() => {
    const item = load().items.find((entry) => entry.id === id);
    if (!item || item.status !== "preparing") return;
    item.status = "in_progress";
    item.started_at = now();
    const first = makeQuestion(item, 0, "main", null);
    item.questions.push(first);
    item.current_question_id = first.id;
    item.lock_version += 1;
    save();
  }, PREPARE_MS);
}

function scheduleEvaluation(id: string) {
  setTimeout(() => {
    const item = load().items.find((entry) => entry.id === id);
    if (!item || item.status !== "evaluating") return;
    item.questions.filter((question) => question.kind === "main").forEach((root, index) => {
      root.evaluation = evaluationFor(root.plan_index, root.answer_status === "skipped", index);
    });
    item.report = buildReport(item);
    item.total_score = item.report.total_score;
    item.low_confidence = item.report.low_confidence;
    item.status = "completed";
    item.finished_at = now();
    item.lock_version += 1;
    save();
  }, EVALUATE_MS);
}

// 服务端回合规则：每题最多追问 1 次（假数据简化），关闭追问或跳过时直接下一题，最后一题后结束
function advance(item: MockInterviewDetail, current: MockInterviewQuestion, skipped: boolean): { action: "follow_up" | "next" | "finish"; question: MockInterviewQuestion | null; closing: string | null } {
  const rootId = current.parent_id ?? current.id;
  const root = item.questions.find((question) => question.id === rootId)!;
  const followCount = item.questions.filter((question) => question.parent_id === rootId).length;
  if (!skipped && item.follow_up_enabled && followCount < 1) {
    const follow = makeQuestion(item, root.plan_index, "follow_up", rootId);
    item.questions.push(follow);
    return { action: "follow_up", question: follow, closing: null };
  }
  const nextPlan = root.plan_index + 1;
  if (nextPlan >= item.question_count) {
    return { action: "finish", question: null, closing: "今天的面试就到这里，感谢你的时间。评估报告稍后生成，可以在练习记录里查看。" };
  }
  const main = makeQuestion(item, nextPlan, "main", null);
  item.questions.push(main);
  return { action: "next", question: main, closing: null };
}

async function* turnStream(item: MockInterviewDetail, questionId: string, answer: string | null, source: MockInterviewQuestion["answer_source"]): AsyncGenerator<MockTurnEvent> {
  const current = item.questions.find((question) => question.id === questionId);
  if (!current || item.current_question_id !== questionId) throw new MockInterviewError("MOCK_INTERVIEW_QUESTION_MISMATCH", "这道题已经不是当前题，请刷新后再试。");
  const skipped = answer === null;
  current.answer_status = skipped ? "skipped" : "answered";
  current.answer_text = answer;
  current.answered_at = now();
  current.answer_source = skipped ? null : source;
  if (current.kind === "main" && !skipped) item.answered_main_questions += 1;
  item.lock_version += 1;
  save();
  yield { type: "answer.accepted", question_id: questionId, skipped, lock_version: item.lock_version };

  const result = advance(item, current, skipped);
  const text = result.question?.content ?? result.closing ?? "";
  // 模拟流式输出：每 2 个字一段
  for (let index = 0; index < text.length; index += 2) {
    await delay(28);
    yield { type: "interviewer.delta", content: text.slice(index, index + 2) };
  }
  item.current_question_id = result.question?.id ?? null;
  if (result.action === "finish") {
    item.status = "evaluating";
    item.report = { ...(item.report ?? ({} as MockInterviewReport)), closing_message: result.closing ?? "" } as MockInterviewReport;
    scheduleEvaluation(item.id);
  }
  item.lock_version += 1;
  save();
  yield { type: "interviewer.turn", status: item.status, action: result.action, question: result.question ? clone(result.question) : null, closing_message: result.closing, lock_version: item.lock_version };
}

/* ───────────── 对外接口（与 /api/mock-interviews 一一对应） ───────────── */

export const demoMockInterviewApi: MockInterviewApi = {
  // GET /api/mock-interviews
  async list(params: { status?: MockInterviewStatus; job_application_id?: string; resume_id?: string } = {}) {
    await delay();
    const items = load().items
      .filter((item) => (!params.status || item.status === params.status)
        && (!params.job_application_id || item.job_application_id === params.job_application_id)
        && (!params.resume_id || item.resume_id === params.resume_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(toSummary);
    return { items: clone(items), next_cursor: null as string | null };
  },

  // GET /api/mock-interviews/:id
  async get(id: string) {
    await delay(120);
    return { mock_interview: clone(find(id)) };
  },

  // POST /api/mock-interviews
  async create(input: MockInterviewCreateInput) {
    await delay(300);
    if (!input.job_application_id && !input.resume_id) throw new MockInterviewError("VALIDATION_ERROR", "请选择求职记录或简历。");
    if (load().items.some((item) => ACTIVE_STATUSES.includes(item.status))) throw new MockInterviewError("MOCK_INTERVIEW_IN_PROGRESS", "已有一场进行中的模拟面试，请先完成或放弃它。");
    if ((input.material_ids?.length ?? 0) > 10) throw new MockInterviewError("MOCK_INTERVIEW_MATERIAL_INVALID", "最多选择 10 份参考资料。");
    const stage = input.display?.stage_label ?? null;
    const interview = baseInterview({
      source_type: input.job_application_id ? "job_application" : "resume",
      job_application_id: input.job_application_id ?? null,
      resume_id: input.resume_id ?? null,
      job_description_id: input.job_description_id ?? null,
      resume_title: input.display?.resume_title ?? "我的简历",
      company_name: input.display?.company_name ?? null,
      job_title: input.display?.job_title ?? null,
      target_role: input.target_role ?? null,
      stage_label: stage,
      interview_type: input.interview_type ?? (stage?.startsWith("HR") ? "hr" : "comprehensive"),
      difficulty: input.difficulty ?? "intermediate",
      question_count: Math.max(3, Math.min(10, input.question_count ?? 5)),
      follow_up_enabled: input.follow_up_enabled ?? true,
      language: input.language ?? "zh",
      answer_mode: input.answer_mode ?? "text",
      materials: (input.display?.materials ?? []).map((material) => ({ ...material, version: "1" })),
    });
    load().items.push(interview);
    save();
    schedulePreparation(interview.id);
    return { mock_interview: clone(interview) };
  },

  // POST /api/mock-interviews/:id/answers（SSE）
  answer(id: string, body: { question_id: string; answer?: string; speech_session_id?: string }) {
    const item = find(id);
    if (item.status !== "in_progress") throw new MockInterviewError("MOCK_INTERVIEW_STATE_INVALID");
    const text = (body.answer ?? "").trim() || (body.speech_session_id ? SAMPLE_ANSWERS[item.answered_main_questions % SAMPLE_ANSWERS.length] : "");
    if (!text) throw new MockInterviewError("VALIDATION_ERROR", "回答不能为空。");
    const source = item.answer_mode === "voice" ? "voice" : body.speech_session_id ? "voice_input" : "text";
    return turnStream(item, body.question_id, text.slice(0, 8000), source);
  },

  // POST /api/mock-interviews/:id/skip（SSE）
  skip(id: string, body: { question_id: string }) {
    const item = find(id);
    if (item.status !== "in_progress") throw new MockInterviewError("MOCK_INTERVIEW_STATE_INVALID");
    return turnStream(item, body.question_id, null, null);
  },

  // POST /api/mock-interviews/:id/finish
  async finish(id: string) {
    await delay();
    const item = find(id);
    if (item.status !== "in_progress") throw new MockInterviewError("MOCK_INTERVIEW_STATE_INVALID");
    item.current_question_id = null;
    item.questions = item.questions.filter((question) => question.answer_status !== "pending");
    if (item.answered_main_questions === 0) {
      item.status = "abandoned";
      item.finished_at = now();
    } else {
      item.status = "evaluating";
      scheduleEvaluation(item.id);
    }
    item.lock_version += 1;
    save();
    return { mock_interview: clone(item) };
  },

  // POST /api/mock-interviews/:id/abandon
  async abandon(id: string) {
    await delay();
    const item = find(id);
    if (!["preparing", "preparation_failed", "in_progress"].includes(item.status)) throw new MockInterviewError("MOCK_INTERVIEW_STATE_INVALID");
    item.status = "abandoned";
    item.finished_at = now();
    item.current_question_id = null;
    item.lock_version += 1;
    save();
    return { mock_interview: clone(item) };
  },

  // POST /api/mock-interviews/:id/retry
  async retry(id: string) {
    await delay();
    const item = find(id);
    if (item.status === "preparation_failed") { item.status = "preparing"; schedulePreparation(item.id); }
    else if (item.status === "evaluation_failed") { item.status = "evaluating"; scheduleEvaluation(item.id); }
    else throw new MockInterviewError("MOCK_INTERVIEW_STATE_INVALID");
    item.error_code = null;
    item.lock_version += 1;
    save();
    return { mock_interview: clone(item) };
  },

  // POST /api/mock-interviews/:id/repeat
  async repeat(id: string) {
    const source = find(id);
    const { mock_interview } = await demoMockInterviewApi.create({
      job_application_id: source.job_application_id ?? undefined,
      resume_id: source.resume_id ?? (source.job_application_id ? undefined : "1"),
      interview_type: source.interview_type,
      difficulty: source.difficulty,
      question_count: source.question_count,
      follow_up_enabled: source.follow_up_enabled,
      language: source.language,
      answer_mode: source.answer_mode,
      display: { resume_title: source.resume_title, company_name: source.company_name ?? undefined, job_title: source.job_title ?? undefined, stage_label: source.stage_label ?? undefined, materials: source.materials },
    });
    const created = find(mock_interview.id);
    created.repeat_of_id = source.id;
    save();
    return { mock_interview: clone(created) };
  },

  // DELETE /api/mock-interviews/:id
  async remove(id: string) {
    await delay();
    const item = find(id);
    if (ACTIVE_STATUSES.includes(item.status)) throw new MockInterviewError("MOCK_INTERVIEW_STATE_INVALID", "进行中的场次不能删除。");
    const store = load();
    store.items = store.items.filter((entry) => entry.id !== id);
    store.items.forEach((entry) => { if (entry.repeat_of_id === id) entry.repeat_of_id = null; });
    save();
    return { deleted: true };
  },

  // GET /api/mock-interviews/speech-capability
  async speechCapability() {
    await delay(80);
    return { stt: true, tts: true };
  },

  // WS /api/mock-interviews/:id/speech 的替身：停止后一次性返回示例识别稿
  startRecognition(id: string, options: MockRecognitionOptions): MockRecognition {
    const startedAt = Date.now();
    let cancelled = false;
    return {
      cancel() { cancelled = true; },
      async stop() {
        await delay(900);
        if (cancelled) throw new MockInterviewError("MOCK_INTERVIEW_SPEECH_FAILED", "识别已取消。");
        const item = find(id);
        if (options.failIfSilent?.()) throw new MockInterviewError("MOCK_INTERVIEW_SPEECH_FAILED", "语音识别失败，请重录或改用文字。");
        const text = SAMPLE_ANSWERS[item.answered_main_questions % SAMPLE_ANSWERS.length];
        return { session_id: uuid().replace(/-/g, "").slice(0, 32).padEnd(32, "0"), text, duration_ms: Date.now() - startedAt, partial: false };
      },
    };
  },

  // 演示数据没有真实录音
  async recording() {
    return null;
  },

  // POST /api/mock-interviews/:id/reply:retry（演示数据的回合不会丢失，没有可重新生成的回复）
  async *retryReply(id: string): AsyncGenerator<MockTurnEvent> {
    find(id);
    yield { type: "interviewer.failed", error: "MOCK_INTERVIEW_STATE_INVALID" };
  },

  // POST /api/mock-interviews/:id/transcripts:correct
  async correctTranscripts(id: string) {
    await delay(1200);
    const item = find(id);
    if (item.status !== "completed" || item.answer_mode !== "voice") throw new MockInterviewError("MOCK_INTERVIEW_STATE_INVALID");
    if (item.transcript_corrected_at) throw new MockInterviewError("MOCK_INTERVIEW_TRANSCRIPT_ALREADY_CORRECTED", "本场识别稿已经修正过一次。");
    item.transcript_corrected_at = now();
    const items = item.questions.filter((question) => question.answer_source === "voice").map((question) => {
      const changes: MockTranscriptChange[] = [];
      if (question.raw_transcript?.includes("版本好")) changes.push({ original: "版本好", corrected: "版本号", reason: "同音字" });
      if (question.raw_transcript?.includes("密等")) changes.push({ original: "密等", corrected: "幂等", reason: "术语" });
      if (changes.length && question.transcript_state !== "edited") {
        question.answer_text = changes.reduce((text, change) => text.replace(change.original, change.corrected), question.raw_transcript ?? "");
        question.transcript_state = "corrected";
        question.correction = { changes };
      }
      return { question_id: question.id, state: question.transcript_state, changes };
    });
    item.lock_version += 1;
    save();
    return { items, mock_interview: clone(item) };
  },

  // PUT /api/mock-interviews/:id/questions/:qid/transcript
  async editTranscript(id: string, questionId: string, text: string) {
    await delay();
    const item = find(id);
    if (item.recordings_deleted) throw new MockInterviewError("MOCK_INTERVIEW_RECORDING_NOT_FOUND", "录音已删除，不能再修改识别稿。");
    const question = item.questions.find((entry) => entry.id === questionId);
    if (!question?.raw_transcript) throw new MockInterviewError("MOCK_INTERVIEW_NOT_FOUND");
    if (changeRatio(question.raw_transcript, text) > 0.15) throw new MockInterviewError("MOCK_INTERVIEW_TRANSCRIPT_CORRECTION_REJECTED", "修改幅度超过原识别稿的 15%，只能修正错字和术语。");
    question.answer_text = text.trim();
    question.transcript_state = "edited";
    item.lock_version += 1;
    save();
    return { mock_interview: clone(item) };
  },

  // POST /api/mock-interviews/:id/questions/:qid/re-evaluate
  async reEvaluate(id: string, questionId: string) {
    await delay(1400);
    const item = find(id);
    const root = item.questions.find((entry) => entry.id === questionId && entry.kind === "main");
    if (!root || !item.report) throw new MockInterviewError("MOCK_INTERVIEW_NOT_FOUND");
    const family = item.questions.filter((entry) => entry.id === root.id || entry.parent_id === root.id);
    if (!family.some((entry) => entry.transcript_state === "corrected" || entry.transcript_state === "edited")) throw new MockInterviewError("MOCK_INTERVIEW_STATE_INVALID", "识别稿修正或修改后才能重新评估。");
    if (root.re_evaluate_count >= 3) throw new MockInterviewError("MOCK_INTERVIEW_RE_EVALUATE_LIMIT", "每道题最多重新评估 3 次。");
    const before = root.evaluation?.score ?? 0;
    const after = Math.min(100, Math.round(before + 6));
    root.evaluation_history = [...(root.evaluation_history ?? []), { score: before, evaluated_at: now() }];
    root.evaluation = { ...(root.evaluation ?? evaluationFor(root.plan_index, false, 0)), score: after };
    root.re_evaluate_count += 1;
    const previousTotal = item.report.total_score;
    const reportQuestion = item.report.questions.find((entry) => entry.sequence_no === root.sequence_no);
    if (reportQuestion) reportQuestion.score = after;
    const average = item.report.questions.reduce((sum, entry) => sum + entry.score, 0) / item.report.questions.length;
    item.report.question_average = Math.round(average * 100) / 100;
    item.report.total_score = Math.round((average * 0.7 + item.report.dimension_score * 0.3) * 10) / 10;
    item.report.re_evaluations = [...(item.report.re_evaluations ?? []), { question_id: root.id, before, after, at: now() }];
    item.total_score = item.report.total_score;
    item.lock_version += 1;
    save();
    return { question_id: root.id, evaluation: clone(root.evaluation), re_evaluate_count: root.re_evaluate_count, remaining: 3 - root.re_evaluate_count, total_score: item.report.total_score, previous_total_score: previousTotal, mock_interview: clone(item) };
  },

  // DELETE /api/mock-interviews/:id/recordings
  async deleteRecordings(id: string) {
    await delay();
    const item = find(id);
    item.recordings_deleted = true;
    item.questions.forEach((question) => { question.has_recording = false; });
    item.lock_version += 1;
    save();
    return { mock_interview: clone(item) };
  },
};

