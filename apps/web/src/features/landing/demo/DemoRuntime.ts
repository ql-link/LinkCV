import { api, type AgentSession, type AgentMessage, type AgentContextSnapshot, type AgentProposal, type ResumeRecord, type ResumeTemplate, type JobDescriptionRecord, type JobApplicationSummary, type InterviewSessionSummary, type DatasetRecord, type DatasetFolder, type UserProfile, type UserProfileData, type AccountPreferences } from "@/api/client";
import { useResumeStore } from "@/store/resumeStore";
import { useDemoMockInterviewApi, resetMockInterviewStore } from "@/features/mock-interview/mockInterviewApi";
import { setLocale } from "@/i18n";
import fixtures from "./demo-templates.json";

// This adapter is imported only by landing-demo.html. Everything lives in memory
// and is reset on reload; actual dev components still own all UI interactions.
export const templates = fixtures.map(item => ({ ...item, style: { schema_version: "resume-presentation.v1", portable: { smart_one_page: false }, template_scoped: {}, template_snapshot: item.style } })) as unknown as ResumeTemplate[];
export const product = templates.find(item => item.key === "featured-product-cn")!;
const clone = <T,>(value: T): T => structuredClone(value);
const stamp = new Date().toISOString();
let sequence = 100;
const id = (prefix: string) => `demo-${prefix}-${++sequence}`;
function dateAt(days: number, hour: number) {
  const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date.toISOString();
}
const resumeSeed: ResumeRecord = { id: "landing-demo-resume", title: "产品经理 · 张三", source_type: "template", lock_version: 1, created_at: stamp, updated_at: stamp, template_id: product.id, data: clone(product.data), style: clone(product.style), layout_plan: product.layout_plan };
if (resumeSeed.data.identity.name) resumeSeed.data.identity.name.value = "张三";
function resumeFrom(key: string, resumeId: string, title: string, updated: string): ResumeRecord {
  const template = templates.find(item => item.key === key) ?? product;
  const resume: ResumeRecord = { ...clone(resumeSeed), id: resumeId, title, template_id: template.id, data: clone(template.data), style: clone(template.style), layout_plan: template.layout_plan, updated_at: updated };
  if (resume.data.identity.name) resume.data.identity.name.value = "张三";
  return resume;
}
export const resumes = [resumeSeed, resumeFrom("muse-badge-cn", "demo-resume-growth", "增长产品经理 · 张三", dateAt(-1, 16)), resumeFrom("muse-triptych-cn", "demo-resume-platform", "平台产品经理 · 张三", dateAt(-4, 11))];
/** 列表接口附带缩略图所需的 preview，否则“我的简历”只能显示“预览不可用”。 */
const withPreview = (resume: ResumeRecord) => ({ ...clone(resume), preview: { data: clone(resume.data), style: clone(resume.style), layout_plan: resume.layout_plan } });
const resumeContext: AgentContextSnapshot = { type: "resume", id: resumeSeed.id, resume_id: resumeSeed.id, label: resumeSeed.title, version: "1", presentation: "mention" };
const profile: UserProfile = { id: "landing-demo-user", nickname: "张三", email: "zhangsan@example.com", is_admin: false, avatar_url: null, contact_email: "zhangsan@example.com", registered_at: dateAt(-30, 10), wechat_status: "unavailable", wechat_bound_at: null };
// The landing page passes its current interface language so the demo workspace matches it.
const initialLocale = new URLSearchParams(location.search).get("locale") === "en-US" ? "en-US" : "zh-CN";
setLocale(initialLocale, false);
let preferences: AccountPreferences = { locale: initialLocale, interview_reminder_enabled: true, notifications_available: false };
let userProfile: UserProfileData = { candidate_cities: ["上海", "杭州"], salary_min: 20000, salary_max: 30000, salary_currency: "CNY", salary_period: "month", employment_types: ["full_time"], school: "示例大学", school_tier: [], major: "信息管理", education_level: "bachelor", candidate_status: "experienced", graduation_year: 2020, years_experience: 5, languages: ["中文", "英语"], skills: ["产品设计", "用户研究", "数据分析"], certifications: [], honors: [], campus_experiences: [], lock_version: 1, created_at: stamp, updated_at: stamp };

function job(index: number, company: string, title: string, skills: string[]): JobDescriptionRecord {
  return { id: `demo-job-${index}`, job_title: title, company_name: company, logo_url: null, work_city: "上海", salary_text: "20–30K · 14薪", skills, source_type: "manual", source_site: null, source_url: null, lock_version: 1, updated_at: stamp, employment_type: "full_time", description: `## 岗位职责\n- 负责${title}相关产品的规划与落地。\n- 通过用户研究和数据分析发现机会，协同设计、研发推进迭代。\n- 建立业务指标，跟踪上线效果并持续优化。\n\n## 任职要求\n- 3 年以上产品工作经验。\n- 熟悉${skills.join("、")}，能够清楚表达产品决策的依据。`, education_requirement: "本科", experience_requirement: "3–5 年", work_schedule: null, work_address: "上海 · 示例办公园区", work_mode: "hybrid", salary_min: "20000", salary_max: "30000", salary_currency: "CNY", salary_period: "month", salary_months_per_year: 14, company_legal_name: company, company_industry: "互联网", company_size: "100–499 人", company_financing_stage: null, company_description: "虚构的产品团队，用于展示求职流程。", recruiter_name: null, recruiter_title: null, source_job_id: null, source_url_hash: null, imported_at: null, notes: "演示岗位", created_at: stamp };
}
const jobs = [job(1, "星河科技", "高级产品经理", ["用户研究", "B2B 产品", "数据分析"]), job(2, "青舟数据", "增长产品经理", ["增长策略", "A/B 测试", "SQL"]), job(3, "远山设计", "平台产品经理", ["需求分析", "产品设计", "跨团队协作"]), job(4, "云帆互联", "产品经理", ["产品规划", "指标体系"]), job(5, "光点软件", "商业化产品经理", ["商业化", "数据分析"]), job(6, "北辰数据", "数据产品经理", ["数据仓库", "指标体系", "SQL"]), job(7, "澄海科技", "B 端产品经理", ["权限体系", "流程引擎", "SaaS"]), job(8, "远航物流", "产品经理", ["供应链", "流程优化"])];
type SessionPlan = { application: number; day: number; hour: number; label: string; round: number; mode: "video" | "onsite" | "phone" | "other"; status: "scheduled" | "completed" };
const interviewPlan: SessionPlan[] = [
  { application: 0, day: 0, hour: 14, label: "业务二面", round: 2, mode: "onsite", status: "scheduled" },
  { application: 1, day: 0, hour: 16, label: "业务一面", round: 1, mode: "video", status: "scheduled" },
  { application: 6, day: 1, hour: 10, label: "业务一面", round: 1, mode: "video", status: "scheduled" },
  { application: 3, day: 2, hour: 19, label: "在线笔试", round: 1, mode: "other", status: "scheduled" },
  { application: 0, day: -1, hour: 10, label: "业务一面", round: 1, mode: "video", status: "completed" },
  { application: 7, day: -1, hour: 15, label: "HR 面", round: 1, mode: "phone", status: "completed" },
];
type StageSpec = { type: "screening" | "assessment" | "written_test" | "interview" | "hr" | "offer"; label: string; round?: number; state: "awaiting_schedule" | "scheduled" | "awaiting_result" | "negotiating"; pending?: boolean; offer?: boolean; color: "blue" | "green" | "purple" | "orange" | "red" | "yellow" | "gray"; applied: number };
const stageSpecs: StageSpec[] = [
  { type: "interview", label: "业务二面", round: 2, state: "scheduled", color: "blue", applied: -12 },
  { type: "interview", label: "业务一面", round: 1, state: "scheduled", color: "green", applied: -6 },
  { type: "screening", label: "简历筛选", state: "awaiting_result", color: "gray", applied: -3 },
  { type: "written_test", label: "在线笔试", state: "scheduled", color: "orange", applied: -5 },
  { type: "assessment", label: "性格测评", state: "awaiting_result", color: "purple", applied: -4 },
  { type: "screening", label: "待投递", state: "awaiting_schedule", pending: true, color: "gray", applied: 0 },
  { type: "interview", label: "业务一面", round: 1, state: "scheduled", color: "red", applied: -7 },
  { type: "offer", label: "Offer", state: "negotiating", offer: true, color: "yellow", applied: -20 },
];
function application(job: JobDescriptionRecord, index: number): JobApplicationSummary {
  const spec = stageSpecs[index] ?? stageSpecs[2];
  const legacy = spec.type === "offer" ? "offer" : spec.type === "hr" ? "hr" : spec.type === "interview" ? "interview" : "screening";
  const stageRecord = { id: `demo-stage-${index}`, application_id: `demo-application-${index}`, client_request_id: `demo-stage-${index}`, stage_type: spec.type, stage_label: spec.label, interview_round_no: spec.round ?? null, sequence_no: 1, stage_status: "active", stage_result: "pending", current_marker: 1, entered_at: dateAt(spec.applied + 1, 10), completed_at: null, created_at: stamp, updated_at: stamp } as const;
  const session = interviewPlan.find(item => item.application === index && item.status === "scheduled");
  return { id: `demo-application-${index}`, resume_id: resumeSeed.id, job_description_id: job.id, company_name_snapshot: job.company_name, job_title_snapshot: job.job_title, company_logo_url: null, job_snapshot: clone(job), resume_title_snapshot: resumeSeed.title, calendar_color: spec.color, current_stage_type: legacy, current_round_no: spec.round ?? null, current_stage_label: spec.label, stage_state: spec.state, status: "active", phase: spec.pending ? "pending" : "applied", lifecycle_status: "active", terminated_at: null, termination_reason: null, offer_status: spec.offer ? "received" : "none", offer_base_location: spec.offer ? "上海" : null, offer_received_on: spec.offer ? dateAt(-2, 10).slice(0, 10) : null, offer_reply_due_on: spec.offer ? dateAt(5, 10).slice(0, 10) : null, offer_salary: spec.offer ? "28000" : null, offer_salary_currency: spec.offer ? "CNY" : null, offer_salary_period: spec.offer ? "month" : null, offer_benefits_description: null, is_favorite: index === 0, applied_at: spec.pending ? null : dateAt(spec.applied, 10), notes: "示例求职记录。", archived_at: null, lock_version: 1, created_at: dateAt(spec.applied - 1, 10), updated_at: stamp, current_stage: stageRecord, stages: [stageRecord], next_session_id: session ? `demo-interview-${interviewPlan.indexOf(session)}` : null, next_session_start_at: session ? dateAt(session.day, session.hour) : null, next_session_end_at: session ? dateAt(session.day, session.hour + 1) : null, next_session_mode: session ? session.mode : null };
}
const applications = jobs.map(application);
function interview(plan: SessionPlan, index: number): InterviewSessionSummary {
  const application = applications[plan.application];
  const done = plan.status === "completed";
  return { id: `demo-interview-${index}`, application_id: application.id, application_stage_id: application.current_stage?.id, client_request_id: `demo-interview-${index}`, stage_type: plan.label === "HR 面" ? "hr" : plan.label === "在线笔试" ? "other" : "interview", round_no: plan.round, stage_label: plan.label, status: plan.status, round_result: done ? "passed" : "pending", start_at: dateAt(plan.day, plan.hour), end_at: dateAt(plan.day, plan.hour + 1), schedule_kind: "fixed_slot", answer_plan_start_at: null, answer_plan_end_at: null, timezone: "Asia/Shanghai", mode: plan.mode, meeting_url: null, location: plan.mode === "onsite" ? "上海 · 示例办公园区" : null, interviewer_name: "示例面试官", interviewer_title: "产品负责人", reminder_minutes: 30, preparation_note: "准备 2 分钟自我介绍，重点讲审批配置项目的判断过程。", questions_markdown: null, review_summary: done ? "表达清晰，项目数据扎实。" : null, improvement_markdown: null, prep_items: [{ id: "intro", title: "练习 2 分钟自我介绍", category: "intro", reason: "突出与岗位相关的经历", done: true }, { id: "project", title: "复盘审批配置项目", category: "project", reason: "说明决策依据和可核实的结果", done: done }, { id: "company", title: "了解团队与产品方向", category: "company", done: false }], prep_generated_at: stamp, prep_total: 3, prep_done: done ? 2 : 1, completed_at: done ? dateAt(plan.day, plan.hour + 1) : null, cancelled_at: null, cancellation_reason: null, lock_version: 1, created_at: stamp, updated_at: stamp, company_name: application.company_name_snapshot, job_title: application.job_title_snapshot, calendar_color: application.calendar_color, application_stage_state: application.stage_state };
}
const interviews = interviewPlan.map(interview);
const folders: DatasetFolder[] = [{ id: "demo-folder-1", name: "项目与作品", dataset_count: 3, created_at: stamp, updated_at: stamp }, { id: "demo-folder-2", name: "面试准备", dataset_count: 3, created_at: stamp, updated_at: stamp }, { id: "demo-folder-3", name: "求职材料", dataset_count: 2, created_at: stamp, updated_at: stamp }];
const datasetFiles: [string, number][] = [["审批配置项目复盘.md", 0], ["产品作品集.md", 0], ["权限模板体系方案.md", 0], ["产品经理面试题.md", 1], ["自我介绍草稿.md", 1], ["星河科技二面准备.md", 1], ["求职信 · 星河科技.md", 2], ["作品集说明.md", 2]];
const datasets: DatasetRecord[] = datasetFiles.map(([file_name, folder], index) => ({ id: `demo-dataset-${index}`, folder_id: folders[folder].id, folder_name: folders[folder].name, file_name, file_format: "md", file_size: 2048 + index * 600, asset_kind: "document", upload_status: "succeeded", parse_status: "succeeded", failure_reason: null, created_at: dateAt(-index, 10), content_revision: "1", content_updated_at: stamp }));
const contents: Record<string, string> = {
  "demo-dataset-0": "# 审批配置项目复盘\n\n## 背景\n用户配置审批流程时经常中途退出。\n\n## 行动\n开展两轮原型测试，梳理配置步骤，优化字段说明和即时预览。\n\n## 结果\n灰度期任务完成率从 71% 提升至 86%。\n\n## 复盘\n下一步验证复杂分支场景，并跟踪上线后的长期表现。",
  "demo-dataset-1": "# 产品作品集\n\n## 审批配置\n从问题识别、方案测试到灰度验证的完整过程。\n\n## 数据看板\n围绕核心使用路径建立指标，帮助团队判断迭代方向。",
  "demo-dataset-2": "# 产品经理面试题\n\n1. 如何判断一个需求是否值得做？\n2. 讲一次用数据推动决策的经历。\n3. 项目没有达到预期时，你会怎么复盘？\n4. 如何协调研发与业务的优先级？",
  "demo-dataset-3": "# 自我介绍草稿\n\n我是张三，有五年产品工作经验。最近负责审批配置的体验优化，通过用户研究与原型测试推动方案迭代。希望在新的团队中继续做能够解决实际问题的产品。",
};
function history(key: string, title: string, turns: string[], pinned = false): AgentSession {
  return { id: key, title, status: "active", pinned, selected_model_id: "demo-deepseek", created_at: dateAt(-2, 9), updated_at: dateAt(-1, 14), last_message_at: dateAt(-1, 14), messages: turns.map((content, index): AgentMessage => ({ sequence_no: index + 1, role: index % 2 ? "assistant" : "user", content, created_at: stamp, ...(index === 0 ? { contexts: [clone(resumeContext)] } : {}) })) };
}
export const sessions = [
  history("demo-chat-project", "把项目经历写得更具体", ["帮我优化审批配置项目的描述。", "这段经历有可核实的结果，我们可以把问题、行动和结果连起来。\n\n### 建议表达\n围绕审批配置中的高频问题开展两轮原型测试，优化配置路径；灰度期任务完成率从 **71% 提升至 86%**。\n\n面试时可以继续讲：你如何发现问题、选择方案，以及怎样评估灰度效果。", "面试官问我怎么确定是配置路径的问题，我应该怎么答？", "先讲证据，再讲验证。可以这样组织：\n\n1. **发现异常**：配置漏斗中某些步骤的退出比例较高。\n2. **补充观察**：通过用户访谈和操作回放，确认理解成本与步骤切换是主要障碍。\n3. **验证方案**：两轮原型测试观察任务完成情况，再用灰度数据检查变化。\n\n这里的内容是演示示例；正式回答时，应替换成你实际采用的方法。"], true),
  history("demo-chat-interview", "准备今天的产品经理面试", ["今天要面试高级产品经理，帮我安排一下准备重点。", "可以把准备分成三部分：\n\n### 先练开场\n用 2 分钟讲清你的经历、擅长解决的问题，以及为什么对这个岗位感兴趣。\n\n### 深挖一个项目\n以审批配置为例，准备问题识别、方案取舍、跨团队推进和效果验证。\n\n### 留出提问\n了解团队当前的产品阶段、岗位目标和入职后最重要的任务。\n\n我们可以从自我介绍开始。", "帮我模拟第一个问题。", "**你如何判断一个产品需求是否值得做？**\n\n先给出你的判断框架，再用一个具体项目说明。你可以从用户问题、业务价值、验证成本和实施风险四个角度回答。"]),
  history("demo-chat-jd", "分析高级产品经理岗位", ["这个岗位和我的简历有哪些匹配的地方？", "从示例岗位描述看，最相关的是三点：\n\n- **用户研究**：审批配置项目展示了从用户问题出发的改进过程。\n- **B2B 产品设计**：能够描述复杂业务流程与配置体验。\n- **效果验证**：灰度期间使用任务完成率评估方案。\n\n还可以补充产品规划与跨团队协调的具体例子，让岗位匹配的证据更完整。"]),
  history("demo-chat-intro", "打磨两分钟自我介绍", ["帮我把自我介绍说得更自然一点。", "可以先用这版练习：\n\n> 我是张三，有五年产品工作经验。最近主要负责审批配置的体验优化，从用户研究、原型测试到灰度上线都参与推进。我比较擅长把复杂流程拆成清晰的使用路径，并用数据验证改动效果。希望在新的团队里，继续做能解决实际问题的产品。\n\n表达时不必逐字背诵，围绕经历、能力和求职方向展开即可。"]),
];
const proposals: (AgentProposal & { session_id: string })[] = [];
const cancelledRuns = new Set<string>();
const sessionFor = (key: string) => { const value = sessions.find(item => item.id === key); if (!value) throw new Error("演示会话不存在"); return value; };
const resumeFor = (key: string) => { const value = resumes.find(item => item.id === key); if (!value) throw new Error("演示简历不存在"); return value; };
const applicationFor = (key: string) => { const value = applications.find(item => item.id === key); if (!value) throw new Error("演示求职记录不存在"); return value; };
const interviewFor = (key: string) => { const value = interviews.find(item => item.id === key); if (!value) throw new Error("演示面试不存在"); return value; };
const detail = (key: string) => ({ session: clone(interviewFor(key)), application: clone(applicationFor(interviewFor(key).application_id)), assets: [] });
const touch = <T extends { lock_version: number; updated_at: string }>(item: T, patch: Partial<T>) => { Object.assign(item, patch, { lock_version: item.lock_version + 1, updated_at: new Date().toISOString() }); return clone(item); };
const recommendation = () => ({ state: "ready" as const, resume: { id: resumeSeed.id, title: resumeSeed.title }, items: jobs.slice(0, 3).map((job, index) => ({ job_id: job.id, job_title: job.job_title, company_name: job.company_name, logo_url: null, score: [92, 87, 84][index], application_status: "active" })), pending_count: 0, can_compute: false });

export function demoReply(question: string, followUp: boolean) {
  if (/面试|模拟|问题|自我介绍/u.test(question)) return "我们先围绕今天的产品经理面试练一轮。\n\n### 面试问题\n请介绍一次你从用户问题出发，推动产品优化的经历。\n\n可以按 **背景 → 判断 → 行动 → 结果** 来回答。以示例审批配置项目为例，讲清楚你发现了什么问题、为什么选择优化配置路径，以及怎样验证 71% 到 86% 的变化。\n\n你可以先说一版，我会继续追问决策依据和结果。";
  if (/岗位|JD|匹配|求职|投递/u.test(question)) return "根据示例简历和高级产品经理岗位，建议突出以下三项：\n\n1. **用户研究**：两轮原型测试如何帮助你发现问题。\n2. **复杂流程设计**：配置路径优化背后的方案取舍。\n3. **数据验证**：用任务完成率检验改动效果。\n\n下一步可以在项目经历中补充你负责的范围，以及与研发、设计协作的具体过程。";
  if (/简历|经历|项目|修改|优化|具体/u.test(question)) return "这段项目经历可以保留事实，把行动和结果写得更紧密。\n\n### 推荐表达\n围绕审批配置中的高频问题开展两轮原型测试，优化配置路径；灰度期任务完成率从 **71% 提升至 86%**。\n\n重点是说明你做了哪些判断，以及如何验证方案。下方提供了一条可确认的示例修改，你可以采用，也可以继续提出调整要求。";
  return followUp ? "可以继续细化。先选一个具体例子，补充你负责的范围和判断依据，再讲实际行动与可核实的结果。\n\n比如审批配置项目：你如何发现流程中的障碍、比较候选方案，并通过原型测试与灰度数据验证效果？\n\n这是示例对话。你也可以继续问简历优化、岗位匹配或面试准备。" : "我们可以从你的求职目标开始。\n\n- **完善简历**：梳理项目中的行动与结果。\n- **分析岗位**：找到要求与经历之间的证据。\n- **准备面试**：练习自我介绍和项目追问。\n\n你想先推进哪一步？这是可交互的示例对话。";
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
let installed = false;
export function installDemoRuntime() {
  if (document.documentElement.dataset.landingDemo !== "true") throw new Error("Demo runtime requires the isolated landing demo document");
  if (installed) return;
  installed = true;
  // Catch any API not explicitly implemented below; never proxy demo input.
  const fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(raw, location.origin).pathname.startsWith("/api/")) return Promise.resolve(new Response(JSON.stringify({ error: "此操作暂未接入本地演示" }), { status: 501, headers: { "Content-Type": "application/json" } }));
    return fetch(input, init);
  };
  api.me = async () => ({ user: clone(profile) });
  api.getResume = async key => ({ resume: clone(resumeFor(key)) });
  api.listResumeTemplates = async () => ({ templates: clone(templates) });
  api.getResumeTemplate = async key => ({ template: clone(templates.find(item => item.id === key) ?? product) });
  api.listResumes = async () => ({ resumes: resumes.map(withPreview) });
  api.getResumeOverview = async () => ({ resumes: resumes.map(withPreview), active_imports: [], failed_imports: [], next_failed_cursor: null });
  api.updateResume = async (key, patch) => ({ resume: touch(resumeFor(key), patch) });
  api.createResume = async payload => { const template = templates.find(item => item.id === payload.template_id) ?? product; const resume = { ...clone(resumeSeed), id: id("resume"), title: payload.title, template_id: template.id, data: clone(template.data), style: clone(template.style), layout_plan: template.layout_plan }; resumes.unshift(resume); return { resume: clone(resume) }; };
  api.applyResumeTemplate = async (key, patch) => { const template = templates.find(item => item.id === patch.template_id) ?? product; return { resume: touch(resumeFor(key), { ...patch, style: clone(template.style), template_id: template.id, layout_plan: template.layout_plan }) }; };
  api.copyResume = async (key, payload) => { const resume = { ...clone(resumeFor(key)), id: id("resume"), title: payload.title }; resumes.unshift(resume); return { resume: clone(resume) }; };
  api.deleteResume = async key => { const index = resumes.findIndex(item => item.id === key); if (index >= 0) resumes.splice(index, 1); return { deleted: true }; };
  api.listAgentSessions = async () => ({ sessions: clone(sessions) });
  api.getAgentSession = async key => ({ session: clone(sessionFor(key)) });
  api.getActiveAgentRun = async () => ({ run: null });
  api.getAgentModels = async () => ({ models: [{ id: "demo-deepseek", name: "DeepSeek V4" }, { id: "demo-gpt", name: "GPT-5.4" }], defaultModelId: "demo-deepseek" });
  api.getAgentReadiness = async () => ({ ready: true });
  api.createAgentSession = async (title, modelId) => { const session = history(id("chat"), title ?? "新对话", []); session.selected_model_id = modelId ?? "demo-deepseek"; sessions.unshift(session); return { session: clone(session) }; };
  api.updateAgentSession = async (key, patch) => { const session = sessionFor(key); Object.assign(session, patch, patch.modelId !== undefined ? { selected_model_id: patch.modelId } : {}, { updated_at: new Date().toISOString() }); return { session: clone(session) }; };
  api.deleteAgentSession = async key => { const index = sessions.findIndex(item => item.id === key); if (index >= 0) sessions.splice(index, 1); };
  api.listAgentContexts = async (options = {}) => {
    const contexts: AgentContextSnapshot[] = [...resumes.map(item => ({ ...resumeContext, id: item.id, resume_id: item.id, label: item.title })), ...datasets.map(item => ({ type: "dataset" as const, id: item.id, label: item.file_name })), ...jobs.map(item => ({ type: "job" as const, id: item.id, label: `${item.company_name} · ${item.job_title}` })), { type: "user_profile", id: profile.id, label: "张三的求职资料" }];
    return { contexts: contexts.filter(item => (!options.type || options.type === item.type) && (!options.search || item.label.includes(options.search))).slice(0, options.limit ?? 20) };
  };
  api.listAgentProposals = async (resumeId, sessionId) => ({ proposals: clone(proposals.filter(item => (!sessionId || item.session_id === sessionId) && (!resumeId || item.resume_id === resumeId))) });
  api.cancelAgentRun = async runId => { cancelledRuns.add(runId); return { run_id: runId, status: "cancelled" }; };
  api.streamAgentMessage = async (key, payload, signal, emit) => {
    const session = sessionFor(key); const runId = id("run");
    const time = new Date().toISOString();
    const contexts = payload.contexts?.map(ref => ({ ...ref, label: ref.type === "resume" ? resumeFor(ref.id).title : "示例资料" }));
    session.messages.push({ sequence_no: session.messages.length + 1, role: "user", run_id: runId, content: payload.content, contexts, created_at: time });
    if (session.title === "新对话") session.title = payload.content.slice(0, 18);
    session.updated_at = time; session.last_message_at = time;
    const original = "通过两轮原型测试优化配置路径，灰度期任务完成率从 71% 提升至 86%。";
    const canPropose = JSON.stringify(resumeSeed.data).includes(original);
    let response = demoReply(payload.content, session.messages.length > 1);
    if (!canPropose) response = response.replace("下方提供了一条可确认的示例修改，你可以采用，也可以继续提出调整要求。", "示例修改已经采用，保留当前表达即可。你可以继续追问面试准备或岗位匹配。");
    let output = "";
    emit({ type: "run.started", runId });
    emit({ type: "run.phase", runId, phase: "planning", referencedContextCount: contexts?.length ?? 0 });
    emit({ type: "assistant.activity.delta", runId, delta: "正在整理示例经历与岗位要求…" });
    try {
      await wait(650, signal);
      for (const delta of response.match(/.{1,12}/gs) ?? []) {
        if (cancelledRuns.has(runId)) throw new DOMException("Aborted", "AbortError");
        await wait(65, signal); output += delta; emit({ type: "assistant.delta", runId, delta });
      }
      if (canPropose && /简历|经历|项目|修改|优化|具体/u.test(payload.content) && !/面试/u.test(payload.content)) {
        const proposal: AgentProposal & { session_id: string } = { id: id("proposal"), session_id: key, run_id: runId, resume_id: resumeSeed.id, base_lock_version: resumeSeed.lock_version, data: null, style: null, preview: { changes: [{ target: {}, op: "replace_target_text", before: "通过两轮原型测试优化配置路径，灰度期任务完成率从 71% 提升至 86%。", after: "围绕审批配置中的高频问题开展两轮原型测试，优化配置路径；灰度期任务完成率从 71% 提升至 86%。" }] }, summary: "让项目行动与结果更清晰", status: "pending", applied_lock_version: null, expires_at: "2099-01-01T00:00:00Z", created_at: time };
        proposals.unshift(proposal); emit({ type: "proposal.created", runId, proposal: clone(proposal) });
      }
      emit({ type: "run.completed", runId });
    } catch (error) { emit({ type: "run.cancelled", runId }); if (!(error instanceof DOMException && error.name === "AbortError")) throw error; }
    finally { if (output) session.messages.push({ sequence_no: session.messages.length + 1, role: "assistant", run_id: runId, content: output, created_at: new Date().toISOString() }); cancelledRuns.delete(runId); }
  };
  api.confirmAgentProposal = async key => { const proposal = proposals.find(item => item.id === key); if (!proposal) throw new Error("演示修改不存在"); const resume = resumeFor(proposal.resume_id); if (proposal.status === "applied") return { resume: clone(resume) }; const serialized = JSON.stringify(resume.data); const change = proposal.preview!.changes[0]; const replacement = serialized.replace(String(change.before), String(change.after)); if (replacement === serialized) throw new Error("示例原文已变化，请重新生成建议"); resume.data = JSON.parse(replacement); resume.lock_version++; proposal.status = "applied"; proposal.applied_lock_version = resume.lock_version; return { resume: clone(resume) }; };
  api.rejectAgentProposal = async key => { const proposal = proposals.find(item => item.id === key); if (!proposal) throw new Error("演示修改不存在"); proposal.status = "rejected"; return { proposal: clone(proposal) }; };
  api.listJobDescriptions = async (options = {}) => ({ items: clone(jobs.filter(job => !options.keyword || `${job.company_name}${job.job_title}`.includes(options.keyword))), next_cursor: null });
  api.getJobDescription = async key => ({ job_description: clone(jobs.find(item => item.id === key) ?? jobs[0]) });
  api.updateJobDescription = async (key, patch) => ({ job_description: touch(jobs.find(item => item.id === key)!, patch) });
  api.getJobMatchRecommendations = async () => recommendation(); api.ensureJobMatchRecommendations = api.getJobMatchRecommendations;
  api.getJobMatch = async () => ({ match: { status: "ready", stale: false, score: 92, headline: "用户研究与复杂流程设计较匹配", hits: ["用户研究", "B2B 产品", "数据分析"], gaps: ["可补充产品规划实例"], highlights: { covered: ["用户研究"], missing: ["产品规划"] }, analyzed_at: stamp, error_code: null } });
  api.analyzeJobMatch = api.getJobMatch;
  api.listJobApplications = async (options = {}) => ({ items: clone(applications.filter(item => options.scope === "archived" ? Boolean(item.archived_at) : !item.archived_at)), next_cursor: null });
  api.getJobApplication = async key => ({ application: clone(applicationFor(key)) });
  api.updateJobApplication = async (key, patch) => ({ application: touch(applicationFor(key), patch) });
  api.archiveJobApplication = async key => ({ application: touch(applicationFor(key), { archived_at: stamp }) });
  api.restoreJobApplication = async key => ({ application: touch(applicationFor(key), { archived_at: null }) });
  api.deleteJobApplication = async key => { const index = applications.findIndex(item => item.id === key); if (index >= 0) applications.splice(index, 1); return { deleted: true }; };
  api.addJobApplicationStage = async (key, patch) => { const item = applicationFor(key); const stage = { ...item.current_stage!, id: id("stage"), stage_type: patch.stage_type, stage_label: patch.stage_label ?? "业务面试", interview_round_no: patch.interview_round_no ?? null, sequence_no: (item.stages?.length ?? 0) + 1 }; return { application: touch(item, { current_stage: stage, stages: [...(item.stages ?? []), stage], current_stage_label: stage.stage_label, current_stage_type: patch.stage_type === "screening" ? "screening" : patch.stage_type === "offer" ? "offer" : "interview", stage_state: "awaiting_schedule" }) }; };
  api.terminateJobApplication = async (key, patch) => ({ application: touch(applicationFor(key), { lifecycle_status: "terminated", termination_reason: patch.reason, terminated_at: stamp, status: "closed" }) });
  api.recordJobApplicationOffer = async (key, patch) => ({ application: touch(applicationFor(key), { offer_status: "received", offer_base_location: patch.base_location ?? null, offer_salary: patch.salary === undefined ? null : String(patch.salary), offer_reply_due_on: patch.reply_due_on ?? null, offer_start_on: patch.start_on ?? null, current_stage_label: "Offer" }) });
  api.listInterviewSessions = async (options = {}) => ({ items: clone(interviews.filter(item => (!options.application_id || item.application_id === options.application_id) && (!options.start_at || item.start_at >= options.start_at) && (!options.end_at || item.start_at < options.end_at) && (!options.status || item.status === options.status))), next_cursor: null });
  api.getInterviewSession = async key => detail(key);
  api.getInterviewOverview = async () => ({ metrics: { weekly_interviews: interviews.length, upcoming_interviews: interviews.filter(item => item.status === "scheduled").length, completed_interviews: interviews.filter(item => item.status === "completed").length, offers_received: applications.filter(item => item.offer_status !== "none").length }, pipeline: clone(applications), week_sessions: clone(interviews) });
  api.updateInterviewSession = async (key, patch) => { touch(interviewFor(key), patch); return detail(key); };
  api.rescheduleInterviewSession = async (key, patch) => { touch(interviewFor(key), { ...patch, end_at: patch.end_at ?? new Date(new Date(patch.start_at).getTime() + (patch.duration_minutes ?? 60) * 60000).toISOString() }); return detail(key); };
  api.updateInterviewAnswerPlan = async (key, patch) => { touch(interviewFor(key), { ...patch, answer_plan_end_at: patch.answer_plan_end_at ?? (patch.answer_plan_start_at ? new Date(new Date(patch.answer_plan_start_at).getTime() + (patch.duration_minutes ?? 60) * 60000).toISOString() : null) }); return detail(key); };
  api.generateInterviewPrepItems = async key => detail(key);
  api.completeInterviewSession = async (key, patch) => { touch(interviewFor(key), { ...patch, status: "completed", completed_at: stamp }); return detail(key); };
  api.cancelInterviewSession = async key => { touch(interviewFor(key), { status: "cancelled", cancelled_at: stamp }); return detail(key); };
  api.deleteInterviewSession = async key => { const parent = clone(applicationFor(interviewFor(key).application_id)); const index = interviews.findIndex(item => item.id === key); if (index >= 0) interviews.splice(index, 1); return { deleted: true, application: parent }; };
  api.createJobDescription = async payload => { const item = { ...clone(jobs[0]), ...payload, id: id("job") }; jobs.unshift(item); return { job_description: clone(item), application: null }; };
  api.createJobApplication = async payload => { const item = application(jobs.find(job => job.id === payload.job_description_id) ?? jobs[0], sequence++); item.id = id("application"); applications.unshift(item); return { application: clone(item) }; };
  api.createInterviewSession = async (key, patch) => { const item = { ...interview({ application: applications.indexOf(applicationFor(key)), day: 0, hour: 10, label: "业务面试", round: 1, mode: "video", status: "scheduled" }, 0), ...patch, id: id("interview"), end_at: patch.end_at ?? new Date(new Date(patch.start_at).getTime() + (patch.duration_minutes ?? 60) * 60000).toISOString() }; interviews.push(item); return detail(item.id); };
  api.listDatasets = async folder => ({ datasets: clone(datasets.filter(item => folder === undefined || folder === null || item.folder_id === folder)), limits: { max_file_bytes: 20 * 1024 * 1024, max_files_per_batch: 10, allowed_extensions: ["md", "txt", "pdf", "docx"] } });
  api.listDatasetFolders = async () => ({ folders: folders.map(folder => ({ ...folder, dataset_count: datasets.filter(item => item.folder_id === folder.id).length })), total_count: datasets.length, uncategorized_count: datasets.filter(item => !item.folder_id).length });
  api.getDataset = async key => clone(datasets.find(item => item.id === key)!);
  api.getDatasetContent = async key => ({ id: key, file_name: datasets.find(item => item.id === key)?.file_name ?? "示例资料.md", file_format: "md", markdown: contents[key] ?? "# 示例资料\n\n用于演示资料预览。", content_revision: "1", content_format: "markdown" });
  api.createDatasetFolder = async (name, description = "") => { const item = { id: id("folder"), name, description, dataset_count: 0, created_at: stamp, updated_at: stamp }; folders.push(item); return clone(item); };
  api.updateDatasetFolderDescription = async (key, description) => { const item = folders.find(item => item.id === key)!; Object.assign(item, { description }); return clone(item); };
  api.renameDatasetFolder = async (key, name) => { const item = folders.find(item => item.id === key)!; item.name = name; datasets.filter(item => item.folder_id === key).forEach(item => item.folder_name = name); return clone(item); };
  api.deleteDatasetFolder = async key => { const count = datasets.filter(item => item.folder_id === key).length; for (let index = datasets.length - 1; index >= 0; index--) if (datasets[index].folder_id === key) datasets.splice(index, 1); folders.splice(folders.findIndex(item => item.id === key), 1); return { deleted: true, affected_dataset_count: count }; };
  api.renameDataset = async (key, name) => { const item = datasets.find(item => item.id === key)!; item.file_name = name.endsWith(".md") ? name : `${name}.md`; return clone(item); };
  api.moveDataset = async (key, folder) => { const item = datasets.find(item => item.id === key)!; item.folder_id = folder; item.folder_name = folders.find(item => item.id === folder)?.name ?? null; return clone(item); };
  api.batchMoveDatasets = async (keys, folder) => { for (const key of keys) await api.moveDataset(key, folder); return { moved_count: keys.length }; };
  api.deleteDataset = async key => { const index = datasets.findIndex(item => item.id === key); if (index >= 0) datasets.splice(index, 1); return { deleted: true }; };
  api.downloadDatasetSource = async key => new Blob([contents[key] ?? "示例资料"], { type: "text/markdown" });
  api.retryDataset = async key => clone(datasets.find(item => item.id === key)!);
  api.uploadDataset = async (file, _key, folder) => { const item = { ...clone(datasets[0]), id: id("dataset"), file_name: file.name, file_format: file.name.split(".").slice(-1)[0] ?? "txt", file_size: file.size, folder_id: folder || null, created_at: stamp }; contents[item.id] = /\.(md|txt)$/i.test(file.name) ? await file.text() : "# 本地上传示例\n\n此演示不会解析二进制文件。"; datasets.push(item); return clone(item); };
  api.getAccountProfile = async () => ({ user: clone(profile), resume_count: resumes.length, recent_resumes: clone(resumes), current_session: { device_label: "演示浏览器" }, capabilities: { auth_mode: "unavailable", can_change_password: false, can_delete_account: false, deletion_confirmation_method: null } });
  api.getAccountPreferences = async () => clone(preferences);
  api.updateAccountPreferences = async patch => { preferences = { ...preferences, ...patch }; return clone(preferences); };
  api.updateAccountProfile = async nickname => { profile.nickname = nickname; return clone(profile); };
  api.updateContactEmail = async email => { profile.contact_email = email; return { contact_email: email }; };
  api.getUserProfile = async () => clone(userProfile);
  api.putUserProfile = async patch => { userProfile = { ...userProfile, ...patch, lock_version: userProfile.lock_version + 1 }; return clone(userProfile); };
  api.uploadAccountAvatar = async payload => { profile.avatar_url = payload.dataUrl; return { url: payload.dataUrl }; };
  api.deleteAccountAvatar = async () => { profile.avatar_url = null; return { ok: true }; };
  useDemoMockInterviewApi(true); resetMockInterviewStore(true);
  useResumeStore.setState({ user: clone(profile), authStatus: "authenticated", resumes: resumes.map(withPreview), resumesLoadedAt: Date.now(), activeImports: [], failedImports: [] });
}
