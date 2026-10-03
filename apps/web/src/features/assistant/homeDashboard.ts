import { t, useLocale } from "@/i18n";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type InterviewSessionSummary,
  type JobApplicationSummary,
  type ResumeSummary,
} from "../../api/client";
import { resumeDocumentToMarkdown } from "../../api/resumeContract";
import { evaluateResumeCompleteness } from "../workbench/resumeCompleteness";
import { useResumeStore } from "../../store/resumeStore";

// 首页卡片规则（Figma「01.1 首页 · 状态变体」右侧「首页卡片规则」）：
// 三个卡片位各自按顺序取第一个满足条件的候选；新用户固定三张引导卡。
// 选哪张卡、卡上的数字和时间都由规则直接读数据，不经过 AI。

export type HomeVariant = "new" | "offer" | "today" | "deadline" | "idle";

export type HomeCard =
  | { kind: "firstResume" }
  | { kind: "target" }
  | { kind: "plugin" }
  | { kind: "offer"; company: string; applicationId: string }
  | { kind: "today"; session: InterviewSessionSummary; others: number }
  | { kind: "deadline"; session: InterviewSessionSummary; daysLeft: number }
  | { kind: "week"; sessions: InterviewSessionSummary[] }
  | { kind: "compare"; offers: JobApplicationSummary[] }
  | { kind: "resumeTodo"; resume: ResumeSummary; score: number; missing: string }
  | { kind: "resumeRecent"; resume: ResumeSummary; score: number | null }
  | { kind: "jobs" }
  | { kind: "pipeline"; applications: JobApplicationSummary[]; hint: string };

export type HomeDashboard = {
  variant: HomeVariant;
  cards: HomeCard[];
  todayCount: number;
  offerCompany: string | null;
  deadline: { company: string; daysLeft: number } | null;
};

export type HomeInput = {
  now: Date;
  resumes: ResumeSummary[];
  latestResumeScore: { score: number; missing: string | null } | null;
  sessions: InterviewSessionSummary[];
  applications: JobApplicationSummary[];
};

// 这两个阈值是设计假设（规则说明「待确认」一节），产品确认后再调整
export const RESUME_TODO_THRESHOLD = 90;
export const DEADLINE_DAYS = 3;

const DAY = 86_400_000;

export function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function startOfWeek(date: Date) {
  const result = startOfDay(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function isActiveApplication(application: JobApplicationSummary) {
  return application.status === "active" && application.lifecycle_status !== "terminated" && !application.archived_at;
}

// 笔试 / 在线测评：阶段名里带「笔试」「测评」，或是一段开放作答时间窗
function isWrittenTest(session: InterviewSessionSummary) {
  return /笔试|测评|测试/u.test(session.stage_label) || session.schedule_kind === "open_window";
}

function deadlineOf(session: InterviewSessionSummary) {
  return new Date(session.answer_plan_end_at ?? session.end_at);
}

export function latestResume(resumes: ResumeSummary[]) {
  return [...resumes].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())[0] ?? null;
}

export function buildHomeDashboard(input: HomeInput): HomeDashboard {
  const { now, resumes, sessions, applications } = input;
  if (resumes.length === 0) {
    return {
      variant: "new",
      cards: [{ kind: "firstResume" }, { kind: "target" }, { kind: "plugin" }],
      todayCount: 0,
      offerCompany: null,
      deadline: null,
    };
  }

  const todayStart = startOfDay(now).getTime();
  const tomorrowStart = todayStart + DAY;
  const weekStart = startOfWeek(now).getTime();
  const weekEnd = weekStart + 7 * DAY;
  const scheduled = sessions
    .filter((session) => session.status === "scheduled")
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
  const today = scheduled.filter((session) => {
    const start = new Date(session.start_at).getTime();
    return start >= todayStart && start < tomorrowStart;
  });
  const deadlineSession = scheduled.find((session) => {
    if (!isWrittenTest(session)) return false;
    const end = deadlineOf(session).getTime();
    return end >= now.getTime() && end < todayStart + (DEADLINE_DAYS + 1) * DAY;
  }) ?? null;
  const active = applications.filter(isActiveApplication);
  // applications 的 offer_status = received 即「收到 Offer、还没回复」
  const offers = active.filter((application) => application.offer_status === "received");

  // 位置 1 · 最紧急的事
  let first: HomeCard;
  let variant: HomeVariant;
  if (offers.length > 0) {
    first = { kind: "offer", company: offers[0].company_name_snapshot, applicationId: offers[0].id };
    variant = "offer";
  } else if (today.length > 0) {
    first = { kind: "today", session: today[0], others: today.length - 1 };
    variant = "today";
  } else if (deadlineSession) {
    const daysLeft = Math.max(0, Math.round((startOfDay(deadlineOf(deadlineSession)).getTime() - todayStart) / DAY));
    first = { kind: "deadline", session: deadlineSession, daysLeft };
    variant = "deadline";
  } else {
    first = {
      kind: "week",
      sessions: scheduled.filter((session) => {
        const start = new Date(session.start_at).getTime();
        return start >= weekStart && start < weekEnd;
      }),
    };
    variant = "idle";
  }

  // 位置 2 · 简历
  let second: HomeCard;
  const recent = latestResume(resumes)!;
  const score = input.latestResumeScore;
  if (offers.length >= 2) {
    second = { kind: "compare", offers: offers.slice(0, 2) };
  } else if (score && score.score < RESUME_TODO_THRESHOLD && score.missing) {
    second = { kind: "resumeTodo", resume: recent, score: score.score, missing: score.missing };
  } else {
    second = { kind: "resumeRecent", resume: recent, score: score?.score ?? null };
  }

  // 位置 3 · 机会：空闲日推荐岗位，其余情况看求职进度；进度为 0 时退回推荐岗位（不显示数值为 0 的卡）
  let third: HomeCard;
  if (first.kind === "week" || active.length === 0) {
    third = { kind: "jobs" };
  } else {
    third = { kind: "pipeline", applications: active, hint: pipelineHint(active, now) };
  }

  return {
    variant,
    cards: [first, second, third],
    todayCount: today.length,
    offerCompany: offers[0]?.company_name_snapshot ?? null,
    deadline: first.kind === "deadline" ? { company: first.session.company_name, daysLeft: first.daysLeft } : null,
  };
}

function pipelineHint(active: JobApplicationSummary[], now: Date) {
  const offer = active.find((application) => application.offer_status === "received");
  if (offer) return t("{value0} Offer 待回复", { value0: offer.company_name_snapshot });
  const waiting = active.find((application) => application.stage_state === "awaiting_result");
  if (waiting) return t("{value0}{value1}结果待出", { value0: waiting.company_name_snapshot, value1: waiting.current_stage_label });
  const weekAgo = now.getTime() - 7 * DAY;
  const fresh = active.filter((application) => application.applied_at && new Date(application.applied_at).getTime() >= weekAgo).length;
  if (fresh > 0) return t("本周新增 {value0} 个投递", { value0: fresh });
  return t("按阶段查看每个岗位");
}

// 岗位看板插图的四列：待投递 / 笔试 / 面试 / Offer
export function pipelineColumns(applications: JobApplicationSummary[]) {
  const counts = { pending: 0, test: 0, interview: 0, offer: 0 };
  for (const application of applications) {
    const stage = application.current_stage?.stage_type;
    if (application.offer_status !== "none" || application.current_stage_type === "offer") counts.offer += 1;
    else if (application.phase === "pending") counts.pending += 1;
    else if (stage === "written_test" || stage === "assessment") counts.test += 1;
    else counts.interview += 1;
  }
  return counts;
}

export function greetingPrefix(now: Date) {
  const hour = now.getHours();
  if (hour < 11) return t("早上好");
  if (hour < 13) return t("中午好");
  if (hour < 18) return t("下午好");
  return t("晚上好");
}

// AI 生成问候副标题与快捷指令没有接口，按位置 1 的主题给固定文案
export function homeCopy(dashboard: HomeDashboard) {
  switch (dashboard.variant) {
    case "new":
      return {
        title: t("先准备第一份简历吧。"),
        subtitle: t("也可以直接在下面告诉我你的经历，我来起草。"),
        chips: [t("帮我写第一版简历"), t("简历该写几页"), t("我适合什么岗位")],
      };
    case "offer":
      return {
        title: t("{value0}的 Offer 还没回复。", { value0: dashboard.offerCompany }),
        subtitle: t("对比一下手上的机会，再决定怎么回复。"),
        chips: [t("比较手上的 Offer"), t("帮我写回复邮件"), t("谈薪建议")],
      };
    case "today":
      return {
        title: t("今天想推进什么？"),
        subtitle: t("今天有 {value0} 场面试或笔试。", { value0: dashboard.todayCount }),
        chips: [t("帮我准备今天的面试"), t("模拟一轮面试"), t("按 JD 改简历")],
      };
    case "deadline":
      return {
        title: t("今天想推进什么？"),
        subtitle: dashboard.deadline!.daysLeft === 0
          ? t("{value0}的笔试今天截止。", { value0: dashboard.deadline!.company })
          : t("{value0}的笔试 {value1} 天后截止。", { value0: dashboard.deadline!.company, value1: dashboard.deadline!.daysLeft }),
        chips: [t("帮我准备笔试"), t("按 JD 改简历"), t("复盘上周面试")],
      };
    default:
      return {
        title: t("今天没有安排。"),
        subtitle: t("适合补一段项目经历，或者看看新岗位。"),
        chips: [t("帮我找合适的岗位"), t("润色项目经历"), t("复盘上周面试")],
      };
  }
}

type LoadState = { status: "loading" } | { status: "ready"; input: HomeInput; markdown: string | null; defaultResume: ResumeSummary | null } | { status: "error" };

// 读首页需要的三类数据：简历（含最近一份的完整度）、本周与未来几天的面试、岗位进度
export function useHomeDashboard(enabled: boolean) {
  const locale = useLocale();
  const userId = useResumeStore((store) => store.user?.id);
  const [attempt, setAttempt] = useState(0);
  const [scope, setScope] = useState({ userId, enabled, revision: 0 });
  if (scope.userId !== userId || scope.enabled !== enabled) setScope({ userId, enabled, revision: scope.revision + 1 });
  const key = `${scope.revision}:${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState }>({ key, state: { status: "loading" } });
  // A new visit/account must not render the previous dashboard for one frame.
  const state: LoadState = result.key === key ? result.state : { status: "loading" };
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const now = new Date();
    const rangeStart = startOfWeek(now);
    const rangeEnd = new Date(rangeStart.getTime() + 14 * DAY);
    void (async () => {
      try {
        const [resumes, sessions, applications] = await Promise.all([
          useResumeStore.getState().listResumes()
            .then(() => useResumeStore.getState().resumes)
            .catch(() => api.listResumes().then((result) => result.resumes)),
          api.listInterviewSessions({ start_at: rangeStart.toISOString(), end_at: rangeEnd.toISOString() })
            .then((result) => result.items),
          api.listJobApplications({ scope: "active" })
            .then((result) => result.items),
        ]);
        let markdown: string | null = null;
        const recent = latestResume(resumes);
        if (recent) {
          // 完整度用编辑器同一套前端规则；列表里带预览数据时直接用，否则读一次详情
          const data = recent.preview?.data ?? await api.getResume(recent.id).then((result) => result.resume.data).catch(() => null);
          if (data) {
            markdown = resumeDocumentToMarkdown(data);
          }
        }
        if (cancelled) return;
        setResult({ key, state: { status: "ready", input: { now, resumes, latestResumeScore: null, sessions, applications }, markdown, defaultResume: recent } });
      } catch {
        if (!cancelled) setResult({ key, state: { status: "error" } });
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, key]);
  const localized = useMemo(() => {
    if (state.status !== "ready") return state;
    const score = state.markdown === null ? null : evaluateResumeCompleteness(state.markdown);
    const latestResumeScore = score ? { score: score.score, missing: score.checks.find((item) => item.status !== "passed")?.label ?? null } : null;
    return { status: "ready" as const, dashboard: buildHomeDashboard({ ...state.input, latestResumeScore }), defaultResume: state.defaultResume };
  }, [state, locale]);
  return { ...localized, retry: () => setAttempt((value) => value + 1) };
}
