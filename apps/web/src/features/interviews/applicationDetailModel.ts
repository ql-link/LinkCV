import { t } from "@/i18n";
import { reviewStatusText } from "./reviewReport";
import type {
  ApplicationStageRecord,
  InterviewSessionSummary,
  JobApplicationSummary,
} from "@/api/client";
import { applicationStageMatchesSession, projectApplicationProgress } from "./applicationProgress";
import { formatOfferDate, offerDeadline, parseOfferDate } from "./offerDates";

/**
 * View model for the 04.C01 job progress page. The page has exactly one
 * primary "next step" action whose copy depends on stage × in-stage state.
 * Scheduled sessions complete by time: once a session's end time passes it
 * is treated as completed and the stage waits for a result, so no state
 * offers a manual "mark completed" action.
 */

export type DetailTone = "blue" | "green" | "orange" | "gray" | "red" | "dark";

export type DetailAction =
  | "record-applied"
  | "advance"
  | "schedule"
  | "record-review"
  | "answer-plan"
  | "reschedule"
  | "cancel-session"
  | "record-offer"
  | "accept-offer"
  | "edit-offer"
  | "decline-offer"
  | "view-review";

export type DetailChip = { label: string; tone: DetailTone };

export type DetailStep = {
  key: string;
  label: string;
  meta: string;
  state: "done" | "current" | "next" | "failed" | "offer" | "todo";
};

export type DetailTile =
  | { kind: "date"; head: string; day: string; foot: string }
  | { kind: "status"; title: string; sub: string; tone: DetailTone };

export type DetailButton = { action: DetailAction; label: string; danger?: boolean };

export type DetailNextAction = {
  lead: string;
  tile: DetailTile;
  chips: DetailChip[];
  title: string;
  detail: string;
  hint: string | null;
  primary: (DetailButton & { variant: "dark" | "outline" }) | null;
  secondary: DetailButton[];
};

export type DetailHistoryItem = {
  id: string;
  date: string;
  title: string;
  chip: DetailChip;
  detail: string;
  dot: DetailTone | "hollow";
  highlight: DetailTone | null;
  sessionId: string | null;
};

export type DetailInfoRow = { label: string; value: string; tone?: DetailTone };

export type ApplicationDetailModel = {
  ended: boolean;
  pending: boolean;
  /** The current stage is a verbal offer; the formal one arrives as a new Offer stage. */
  verbalOffer: boolean;
  headerMeta: string;
  /** Canonical stage copy, shared with cards and lists. */
  currentLabel: string;
  steps: DetailStep[];
  next: DetailNextAction;
  history: DetailHistoryItem[];
  offerCard: { title: string; action: string; rows: DetailInfoRow[] } | null;
  deliveryRows: DetailInfoRow[];
};

const DAY = 24 * 60 * 60 * 1000;
const pad = (value: number) => String(value).padStart(2, "0");

export function formatMonthDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

export function formatClock(value: string): string {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRange(start: string, end: string): string {
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  return sameDay
    ? `${formatMonthDay(start)} ${formatClock(start)}–${formatClock(end)}`
    : `${formatMonthDay(start)} ${formatClock(start)} – ${formatMonthDay(end)} ${formatClock(end)}`;
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function daysBetween(from: string, now: Date): number {
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(from))) / DAY));
}

/** Time decides completion: an elapsed scheduled session counts as completed. */
export function effectiveSessionStatus(
  session: Pick<InterviewSessionSummary, "status" | "end_at">,
  now: Date = new Date(),
): InterviewSessionSummary["status"] {
  return session.status === "scheduled" && new Date(session.end_at).getTime() <= now.getTime()
    ? "completed"
    : session.status;
}

function modeLabel(session: InterviewSessionSummary): string {
  if (session.mode === "video") return t("视频面试");
  if (session.mode === "onsite") return t("现场");
  if (session.mode === "phone") return t("电话");
  return t("其他方式");
}

function interviewerText(session: InterviewSessionSummary, withRole: boolean): string | null {
  if (!session.interviewer_name) return null;
  if (withRole) return t("面试官 {value0}", { value0: session.interviewer_name });
  return session.interviewer_title
    ? `${session.interviewer_name}（${session.interviewer_title}）`
    : session.interviewer_name;
}

function sessionLine(session: InterviewSessionSummary, withRole = false): string {
  if (session.schedule_kind === "open_window") {
    const plan = session.answer_plan_start_at && session.answer_plan_end_at
      ? t(" · 我的作答计划 {value0}", { value0: formatRange(session.answer_plan_start_at, session.answer_plan_end_at) })
      : "";
    return t("开放窗口 {value0}", { value0: formatRange(session.start_at, session.end_at) }) + plan;
  }
  return [formatRange(session.start_at, session.end_at), modeLabel(session), interviewerText(session, withRole)]
    .filter(Boolean)
    .join(" · ");
}

function stageKind(stage: Pick<ApplicationStageRecord, "stage_type">): string {
  if (stage.stage_type === "written_test") return t("笔试");
  if (stage.stage_type === "assessment") return t("测评");
  if (stage.stage_type === "ai_interview") return t("AI 面试");
  if (stage.stage_type === "hr") return t("HR 面");
  return t("面试");
}

/** Saved reviews read as a score; edited records ask for a fresh one. */
export function reviewLabel(session: InterviewSessionSummary): string {
  return reviewStatusText(session);
}

function offerDateText(value: string | null | undefined): string | null {
  const date = parseOfferDate(value);
  return date ? `${pad(date.getMonth() + 1)}.${pad(date.getDate())}` : null;
}

function questionCount(session: InterviewSessionSummary): number {
  return (session.questions_markdown ?? "").split("\n").filter((line) => /^\s*(\d+[.)、]|[-*])\s+/.test(line)).length;
}

function sessionForStage(
  stage: ApplicationStageRecord,
  sessions: InterviewSessionSummary[],
): InterviewSessionSummary | undefined {
  return sessions.find((session) => session.status !== "cancelled" && (
    session.application_stage_id
      ? session.application_stage_id === stage.id
      : session.stage_label.trim() === stage.stage_label.trim()
  ));
}

function offerSalaryText(application: JobApplicationSummary): string | null {
  if (!application.offer_salary) return null;
  const period = application.offer_salary_period === "year"
    ? t(" / 年")
    : application.offer_salary_period === "month"
      ? t(" / 月")
      : "";
  return `${application.offer_salary}${period}`;
}

function sourceText(application: JobApplicationSummary): string | null {
  if (application.applied_channel?.trim()) return application.applied_channel.trim();
  const value = application.job_snapshot.source_platform ?? application.job_snapshot.source_channel;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Records created before stage history existed only carry the flat current
 * stage fields; project them into a single stage so the page stays readable.
 */
function legacyStage(
  application: JobApplicationSummary,
  columnKey: string,
  label: string,
): ApplicationStageRecord {
  const ended = columnKey === "ended";
  const stageType: ApplicationStageRecord["stage_type"] = application.current_stage_type === "offer"
    ? "offer"
    : columnKey === "assessment"
      ? "assessment"
      : columnKey === "written_test"
        ? "written_test"
        : application.current_stage_type === "screening"
          ? "screening"
          : "interview";
  return {
    id: `legacy-${application.id}`,
    application_id: application.id,
    client_request_id: `legacy-${application.id}`,
    stage_type: stageType,
    stage_label: application.current_stage_label?.trim() || label,
    interview_round_no: application.current_round_no,
    sequence_no: 1,
    stage_status: ended ? "completed" : "active",
    stage_result: application.status === "rejected" ? "rejected" : "pending",
    current_marker: ended ? null : 1,
    entered_at: application.applied_at ?? application.updated_at,
    completed_at: ended ? application.updated_at : null,
    created_at: application.created_at,
    updated_at: application.updated_at,
  };
}

export function buildApplicationDetail(
  application: JobApplicationSummary,
  allSessions: InterviewSessionSummary[],
  now: Date = new Date(),
): ApplicationDetailModel {
  const progress = projectApplicationProgress(application);
  const sessions = allSessions
    .filter((session) => session.application_id === application.id)
    .map((session) => ({ ...session, status: effectiveSessionStatus(session, now) }))
    .sort((left, right) => new Date(right.start_at).getTime() - new Date(left.start_at).getTime());
  const recorded = [...(application.stages ?? [])].sort((left, right) => left.sequence_no - right.sequence_no);
  const stages = recorded.length || progress.isPending ? recorded : [legacyStage(application, progress.columnKey, progress.stageLabel)];
  const current = application.current_stage ?? stages.find((stage) => stage.current_marker === 1) ?? null;
  const currentSession = sessions.find((session) => (
    session.status !== "cancelled" && applicationStageMatchesSession(application, session)
  ));
  const pending = progress.isPending;
  const ended = progress.columnKey === "ended";
  const offer = !ended && application.current_stage_type === "offer";
  const offerReceived = offer && application.offer_status === "received";
  const hasOcStage = stages.some((stage) => stage.stage_type === "oc");
  // Before HR 面/OC had their own types, an Offer stage without a formal offer stood for OC.
  const verbalOffer = offer && application.offer_status === "none"
    && (current?.stage_type === "oc" || !hasOcStage);
  const isLegacyOc = (stage: ApplicationStageRecord) => (
    stage.stage_type === "offer" && application.offer_status === "none" && !hasOcStage && stage.id === current?.id
  );
  const rejected = application.status === "rejected" || application.termination_reason === "company_rejected";
  const accepted = application.offer_status === "accepted";
  const resumeTitle = application.resume_title_snapshot;
  const source = sourceText(application);

  // Stage state is projected by the server, and also by time on the client so
  // a page left open past the end time still moves to "waiting for result".
  const scheduledSession = currentSession?.status === "scheduled" ? currentSession : undefined;
  const elapsedSession = currentSession?.status === "completed" ? currentSession : undefined;
  const stageState = application.stage_state === "scheduled" && !scheduledSession && elapsedSession
    ? "awaiting_result"
    : application.stage_state;

  const stageLabel = (stage: ApplicationStageRecord) => (
    stage.stage_type === "oc" || isLegacyOc(stage)
      ? stage.id === current?.id ? t("OC · 口头意向") : "OC"
      : stage.stage_type === "offer"
      ? "Offer"
      : stage.stage_type === "screening"
        // Legacy screening labels (初筛, 等待后续通知…) share one canonical step.
        ? t("筛选中")
        : stage.stage_label
  );

  /* ── Stepper ── */
  const steps: DetailStep[] = [];
  if (pending) {
    steps.push({ key: "pending", label: t("待投递"), meta: t("{value0} 导入", { value0: formatMonthDay(application.created_at) }), state: "current" });
    for (const [key, label, meta] of [["screening", t("筛选中"), ""], ["test", t("笔试 / 测评"), ""], ["interview", t("面试"), t("可多轮")], ["offer", "Offer", ""]] as const) {
      steps.push({ key, label, meta, state: "todo" });
    }
  } else {
    steps.push({ key: "applied", label: t("已投递"), meta: formatMonthDay(application.applied_at ?? application.created_at), state: "done" });
    for (const stage of stages) {
      const isCurrent = !ended && stage.id === current?.id;
      const session = sessionForStage(stage, sessions);
      if (stage.stage_type === "oc") {
        steps.push({
          key: stage.id,
          label: stageLabel(stage),
          meta: formatMonthDay(application.oc_communicated_at ?? stage.entered_at),
          state: isCurrent ? "current" : "done",
        });
        continue;
      }
      if (stage.stage_type === "offer") {
        const received = application.offer_status !== "none";
        steps.push({
          key: stage.id,
          label: stageLabel(stage),
          meta: received ? t("{value0} · 已收到", { value0: offerDateText(application.offer_received_on) ?? formatMonthDay(stage.entered_at) }) : formatMonthDay(stage.entered_at),
          state: received ? "offer" : isCurrent ? "current" : "done",
        });
        continue;
      }
      if (stage.stage_result === "rejected" || (ended && stage === stages[stages.length - 1] && rejected)) {
        steps.push({ key: stage.id, label: stageLabel(stage), meta: t("{value0} · 未通过", { value0: formatMonthDay(stage.completed_at ?? stage.entered_at) }), state: "failed" });
        continue;
      }
      if (isCurrent) {
        const meta = stageState === "awaiting_result" && session && session.status === "completed"
          ? stage.stage_type === "interview" || stage.stage_type === "hr"
            ? t("{value0} · 已面完", { value0: formatMonthDay(session.start_at) })
            : t("{value0} · 已考完", { value0: formatMonthDay(session.start_at) })
          : session?.schedule_kind === "open_window"
            ? `${formatMonthDay(session.start_at)}–${formatMonthDay(session.end_at)}`
            : session
              ? formatMonthDay(session.start_at)
              : t("{value0} 起", { value0: formatMonthDay(stage.entered_at) });
        steps.push({ key: stage.id, label: stageLabel(stage), meta, state: "current" });
        continue;
      }
      // Long tracks drop the "passed" suffix so each step label stays on one line.
      const passed = stage.stage_result === "passed" && stages.length < 5;
      steps.push({
        key: stage.id,
        label: stage.stage_type === "screening" ? t("筛选") : stageLabel(stage),
        meta: passed
          ? t("{value0} · 已通过", { value0: formatMonthDay(stage.completed_at ?? session?.start_at ?? stage.entered_at) })
          : formatMonthDay(stage.completed_at ?? session?.start_at ?? stage.entered_at),
        state: "done",
      });
    }
    if (!ended && !offer) {
      steps.push({
        key: "next",
        label: t("下一阶段"),
        meta: current?.stage_type === "screening" ? t("由结果决定") : "",
        state: "next",
      });
    }
  }

  /* ── Next action ── */
  const label = current?.stage_label ?? progress.stageLabel;
  const kind = current ? stageKind(current) : t("面试");
  let next: DetailNextAction;
  if (pending) {
    next = {
      lead: t("下一步"),
      tile: { kind: "status", title: t("待投递"), sub: t("{value0} 天", { value0: daysBetween(application.created_at, now) }), tone: "gray" },
      chips: [{ label: t("待投递"), tone: "gray" }],
      title: t("投递后，记录这次求职从哪一步开始"),
      detail: t("可直接进入筛选中，也可以跳到笔试、面试或 Offer"),
      hint: null,
      primary: { action: "record-applied", label: t("记录投递"), variant: "dark" },
      secondary: [],
    };
  } else if (ended) {
    const last = stages[stages.length - 1];
    const lastLabel = last ? stageLabel(last) : progress.stageLabel;
    const reviewed = sessions.filter((session) => session.review_summary?.trim()).length;
    const status = rejected
      ? { sub: t("未通过"), tone: "red" as const, title: t("流程已结束：{value0}未通过", { value0: lastLabel }), chip: t("结束阶段：{value0}", { value0: lastLabel }) }
      : accepted
        ? { sub: t("已接受"), tone: "green" as const, title: t("流程已结束：已接受 Offer"), chip: t("已接受 Offer") }
        : application.offer_status === "declined"
          ? { sub: t("已婉拒"), tone: "gray" as const, title: t("流程已结束：已婉拒 Offer"), chip: t("已婉拒 Offer") }
          : { sub: t("已放弃"), tone: "gray" as const, title: t("流程已结束：主动放弃"), chip: t("结束阶段：{value0}", { value0: lastLabel }) };
    next = {
      lead: t("当前"),
      tile: { kind: "status", title: t("已结束"), sub: status.sub, tone: status.tone },
      chips: [{ label: t("已结束"), tone: "gray" }, { label: status.chip, tone: status.tone === "gray" ? "gray" : status.tone }],
      title: status.title,
      detail: [
        application.terminated_at ? t("{value0} {value1}", { value0: formatMonthDay(application.terminated_at), value1: rejected ? t("收到拒信") : t("结束") }) : null,
        t("共经历 {value0} 个阶段", { value0: stages.length }),
        reviewed ? t("{value0} 场面试有复盘", { value0: reviewed }) : null,
      ].filter(Boolean).join(" · "),
      hint: null,
      primary: { action: "view-review", label: t("查看复盘"), variant: "outline" },
      secondary: [],
    };
  } else if (offerReceived) {
    const deadline = offerDeadline(application.offer_reply_due_on, now);
    next = {
      lead: t("下一步"),
      tile: { kind: "status", title: "Offer", sub: t("已收到"), tone: "green" },
      chips: [
        { label: "Offer", tone: "dark" },
        { label: t("已收到"), tone: "green" },
        deadline
          ? { label: deadline.label, tone: deadline.daysLeft < 0 ? "red" : "orange" }
          : { label: t("待你决定"), tone: "orange" },
      ],
      title: t("已收到正式 Offer，待你决定"),
      detail: [
        application.offer_base_location,
        offerSalaryText(application),
        application.offer_benefits_description,
        offerDateText(application.offer_reply_due_on) ? t("回复截止 {value0}", { value0: offerDateText(application.offer_reply_due_on) }) : null,
      ].filter(Boolean).join(" · ") || t("Offer 详情待补充"),
      hint: null,
      primary: { action: "accept-offer", label: t("接受 Offer"), variant: "dark" },
      secondary: [{ action: "edit-offer", label: t("修改 Offer 信息") }, { action: "decline-offer", label: t("婉拒"), danger: true }],
    };
  } else if (offer && !verbalOffer) {
    next = {
      lead: t("下一步"),
      tile: { kind: "status", title: "Offer", sub: t("待补充"), tone: "green" },
      chips: [{ label: "Offer", tone: "dark" }, { label: t("信息待补充"), tone: "orange" }],
      title: t("补充正式 Offer 信息"),
      detail: t("记录收到日期、回复截止和薪酬，方便按时回复"),
      hint: null,
      primary: { action: "edit-offer", label: t("记录正式 Offer"), variant: "dark" },
      secondary: [],
    };
  } else if (offer) {
    next = {
      lead: t("下一步"),
      tile: { kind: "status", title: "OC", sub: t("口头意向"), tone: "blue" },
      chips: [{ label: t("Offer 阶段"), tone: "dark" }, { label: t("口头意向"), tone: "blue" }, { label: t("正式 Offer 未到"), tone: "orange" }],
      title: t("已收到口头意向，等待正式 Offer"),
      detail: [
        current ? t("{value0} 收到口头意向", { value0: formatMonthDay(application.oc_communicated_at ?? current.entered_at) }) : null,
        application.oc_salary_text ? t("口头薪酬 {value0}", { value0: application.oc_salary_text }) : null,
        application.oc_start_text ? t("预计到岗 {value0}", { value0: application.oc_start_text }) : null,
        current?.stage_type === "oc" ? null : application.notes?.trim() || null,
      ].filter(Boolean).join(" · "),
      hint: null,
      primary: { action: "record-offer", label: t("记录正式 Offer"), variant: "dark" },
      secondary: [],
    };
  } else if (current?.stage_type === "screening" || application.current_stage_type === "screening" && !current) {
    const days = daysBetween(current?.entered_at ?? application.applied_at ?? application.created_at, now) + 1;
    next = {
      lead: t("下一步"),
      tile: { kind: "status", title: t("筛选中"), sub: t("第 {value0} 天", { value0: days }), tone: "blue" },
      chips: [{ label: t("筛选中"), tone: "blue" }, { label: t("等待结果"), tone: "orange" }],
      title: t("等待简历筛选结果"),
      detail: [
        source
          ? t("{value0} 通过{value1}投递", { value0: formatMonthDay(application.applied_at), value1: source })
          : t("{value0} 投递", { value0: formatMonthDay(application.applied_at) }),
        resumeTitle,
      ].filter(Boolean).join(" · "),
      hint: null,
      primary: { action: "advance", label: t("进入下一阶段"), variant: "dark" },
      secondary: [],
    };
  } else if (stageState === "awaiting_schedule") {
    next = {
      lead: t("下一步"),
      tile: { kind: "status", title: t("待安排"), sub: "", tone: "orange" },
      chips: [{ label, tone: "blue" }, { label: t("等待安排"), tone: "orange" }],
      title: t("安排{value0}时间", { value0: label }),
      detail: t("已收到{value0}通知，还没填时间", { value0: label }),
      hint: null,
      primary: { action: "schedule", label: t("安排{value0}时间", { value0: label }), variant: "dark" },
      secondary: [],
    };
  } else if (scheduledSession) {
    const start = new Date(scheduledSession.start_at);
    const end = new Date(scheduledSession.end_at);
    const openWindow = scheduledSession.schedule_kind === "open_window";
    const anchor = openWindow ? end : start;
    const daysLeft = Math.round((startOfDay(anchor) - startOfDay(now)) / DAY);
    next = {
      lead: t("下一步"),
      tile: {
        kind: "date",
        head: openWindow
          ? t("{value0}月 · 截止", { value0: anchor.getMonth() + 1 })
          : t("{value0}月 · 周{value1}", { value0: anchor.getMonth() + 1, value1: t("日一二三四五六")[anchor.getDay()] }),
        day: String(anchor.getDate()),
        foot: formatClock(anchor.toISOString()),
      },
      chips: [
        { label, tone: "blue" },
        { label: t("已安排"), tone: "blue" },
        openWindow
          ? { label: t("截止前完成"), tone: "gray" }
          : daysLeft >= 1
            ? { label: t("还有 {value0} 天", { value0: daysLeft }), tone: "orange" }
            : { label: t("今天"), tone: "orange" },
        ...((scheduledSession.prep_total ?? 0) > 0
          ? [{ label: t("准备清单 {value0}/{value1}", { value0: scheduledSession.prep_done ?? 0, value1: scheduledSession.prep_total }), tone: "gray" as const }]
          : []),
      ],
      title: openWindow
        ? t("{value0} 前完成{value1}", { value0: `${formatMonthDay(scheduledSession.end_at)} ${formatClock(scheduledSession.end_at)}`, value1: label })
        : label,
      detail: sessionLine(scheduledSession, true),
      hint: openWindow
        ? t("截止时间过后自动进入「等待结果」，无需手动标记完成")
        : t("{value0}结束（{value1}）后自动进入「等待结果」，无需手动标记完成", { value0: kind, value1: formatClock(scheduledSession.end_at) }),
      primary: openWindow
        ? { action: "answer-plan", label: t("作答计划"), variant: "dark" }
        : { action: "record-review", label: t("记录与复盘"), variant: "dark" },
      secondary: [{ action: "reschedule", label: t("修改安排") }, { action: "cancel-session", label: t("取消本场") }],
    };
  } else {
    const days = elapsedSession ? daysBetween(elapsedSession.end_at, now) : 0;
    const asked = elapsedSession ? questionCount(elapsedSession) : 0;
    next = {
      lead: t("下一步"),
      tile: { kind: "status", title: t("等结果"), sub: days ? t("已 {value0} 天", { value0: days }) : t("今天结束"), tone: "orange" },
      chips: [{ label, tone: "blue" }, { label: t("等待结果"), tone: "orange" }],
      title: t("{value0}已结束，等待{value1}结果", { value0: label, value1: kind }),
      detail: elapsedSession
        ? [formatRange(elapsedSession.start_at, elapsedSession.end_at), modeLabel(elapsedSession), asked ? t("已记录 {value0} 个问题", { value0: asked }) : null].filter(Boolean).join(" · ")
        : t("有新进展时在这里添加下一阶段"),
      hint: null,
      primary: { action: "advance", label: t("通过，添加下一轮"), variant: "dark" },
      secondary: [],
    };
  }

  /* ── Stage history ── */
  const history: DetailHistoryItem[] = [...stages].reverse().map((stage) => {
    const session = sessionForStage(stage, sessions);
    const isCurrent = !ended && stage.id === current?.id;
    const isFailed = stage.stage_result === "rejected" || (ended && rejected && stage === stages[stages.length - 1]);
    let chip: DetailChip;
    let dot: DetailHistoryItem["dot"] = "green";
    if (isFailed) {
      chip = { label: t("未通过"), tone: "red" };
      dot = "red";
    } else if (stage.stage_type === "oc") {
      chip = isCurrent ? { label: t("待正式 Offer"), tone: "blue" } : { label: t("已转正式"), tone: "green" };
      dot = isCurrent ? "blue" : "green";
    } else if (stage.stage_type === "offer") {
      chip = application.offer_status === "none"
        ? { label: t("待正式 Offer"), tone: "blue" }
        : application.offer_status === "accepted"
          ? { label: t("已接受"), tone: "green" }
          : application.offer_status === "declined"
            ? { label: t("已婉拒"), tone: "gray" }
            : { label: t("已收到"), tone: "green" };
      dot = isCurrent && application.offer_status === "none" ? "blue" : "green";
    } else if (isCurrent) {
      chip = stage.stage_type === "screening" || stageState === "awaiting_result"
        ? { label: t("等待结果"), tone: stage.stage_type === "screening" ? "blue" : "orange" }
        : stageState === "awaiting_schedule"
          ? { label: t("等待安排"), tone: "orange" }
          : { label: t("已安排"), tone: "blue" };
      dot = chip.tone === "orange" ? "orange" : "blue";
    } else if (stage.stage_result === "skipped") {
      chip = { label: t("已跳过"), tone: "gray" };
      dot = "hollow";
    } else {
      chip = { label: t("已通过"), tone: "green" };
    }
    const detail = session
      ? session.schedule_kind === "open_window" && session.status === "completed"
        ? t("截止前完成 · {value0}", { value0: formatRange(session.start_at, session.end_at) })
        : session.status === "completed" && stage.stage_type !== "interview" && stage.stage_type !== "hr"
          ? t("{value0} 完成", { value0: formatRange(session.start_at, session.end_at) })
          : session.status === "completed"
            ? `${sessionLine(session)} · ${reviewLabel(session)}`
            : sessionLine(session)
      : stage.stage_type === "oc"
        ? [application.oc_salary_text ? t("口头薪酬 {value0}", { value0: application.oc_salary_text }) : null, application.oc_contact].filter(Boolean).join(" · ") || t("已收到口头意向")
      : stage.stage_type === "screening"
        ? isCurrent ? t("招聘方暂未回复。筛选阶段不需要安排时间。") : t("已通过简历筛选")
        : stage.stage_type === "offer"
          ? application.offer_status === "none"
            ? hasOcStage ? t("正式 Offer 信息待补充") : application.notes?.trim() || t("已收到口头意向，等待正式 Offer")
            : [application.offer_base_location, offerSalaryText(application)].filter(Boolean).join(" · ") || t("已收到正式 Offer")
          : isCurrent && stageState === "awaiting_schedule"
            ? t("{value0}链接与时间待招聘方确认。", { value0: kind })
            : t("暂无安排记录");
    return {
      id: stage.id,
      date: stage.stage_type === "oc" && application.oc_communicated_at
        ? formatMonthDay(application.oc_communicated_at)
        : formatMonthDay(isCurrent ? session?.start_at ?? stage.entered_at : stage.completed_at ?? session?.start_at ?? stage.entered_at),
      title: stage.stage_type === "screening"
        ? t("简历筛选")
        : stage.stage_type === "oc" || isLegacyOc(stage)
          ? t("OC · 口头意向")
          : stage.stage_type === "offer" ? t("正式 Offer") : stage.stage_label,
      chip,
      detail,
      dot,
      highlight: isCurrent ? "blue" : isFailed ? "red" : null,
      sessionId: session?.id ?? null,
    };
  });
  if (application.applied_at) {
    history.push({
      id: "applied",
      date: formatMonthDay(application.applied_at),
      title: t("提交投递"),
      chip: { label: t("已投递"), tone: "gray" },
      detail: [source, resumeTitle].filter(Boolean).join(" · ") || t("已记录投递"),
      dot: "hollow",
      highlight: null,
      sessionId: null,
    });
  }

  /* ── Side cards ── */
  const offerCard = offerReceived || (ended && application.offer_status !== "none")
    ? {
      title: t("Offer 信息"),
      action: t("编辑"),
      rows: [
        { label: t("工作地点"), value: application.offer_base_location || "—" },
        { label: t("薪资"), value: offerSalaryText(application) || "—" },
        { label: t("福利"), value: application.offer_benefits_description || "—" },
        ...([
          [t("收到日期"), formatOfferDate(application.offer_received_on)],
          [t("回复截止"), formatOfferDate(application.offer_reply_due_on)],
          [t("预计入职"), formatOfferDate(application.offer_start_on)],
          [t("试用期"), application.offer_probation?.trim() || null],
        ] as const).filter(([, value]) => value).map(([rowLabel, value]) => ({ label: rowLabel, value: value! })),
        {
          label: t("状态"),
          value: application.offer_status === "accepted" ? t("已接受") : application.offer_status === "declined" ? t("已婉拒") : t("已收到 · 待决定"),
          tone: application.offer_status === "declined" ? "gray" as const : "green" as const,
        },
      ],
    }
    : verbalOffer
      ? {
        title: t("口头意向"),
        action: t("记录 Offer"),
        rows: [
          { label: t("沟通时间"), value: current ? formatMonthDay(application.oc_communicated_at ?? current.entered_at) : "—" },
          ...(application.oc_contact ? [{ label: t("沟通方式"), value: application.oc_contact }] : []),
          ...(application.oc_salary_text ? [{ label: t("口头薪酬"), value: application.oc_salary_text }] : []),
          ...(application.oc_start_text ? [{ label: t("预计到岗"), value: application.oc_start_text }] : []),
          { label: t("Offer 状态"), value: t("未收到书面"), tone: "orange" as const },
        ],
      }
      : null;

  const deliveryRows: DetailInfoRow[] = [
    { label: t("投递日期"), value: application.applied_at ? formatMonthDay(application.applied_at) : t("未投递") },
    { label: t("投递渠道"), value: source ?? "—" },
    { label: t("投递简历"), value: resumeTitle ?? t("未关联") },
  ];

  const headerMeta = ended
    ? t("已结束")
    : pending
      ? t("导入 {value0} 天", { value0: daysBetween(application.created_at, now) })
      : t("已投递 {value0} 天", { value0: daysBetween(application.applied_at ?? application.created_at, now) });

  return { ended, pending, verbalOffer, headerMeta, currentLabel: progress.stageLabel, steps, next, history, offerCard, deliveryRows };
}
