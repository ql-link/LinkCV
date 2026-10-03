import { t, getLocale } from "@/i18n";
import type { InterviewSessionRecord, JobApplicationRecord } from "@/api/client";

/**
 * The application API keeps a small state machine.  These labels are the
 * product-facing projection of that state machine, not a second API state.
 */
export type ApplicationProgressColumnKey =
  | "pending"
  | "screening"
  | "assessment"
  | "written_test"
  | "interview"
  | "offer"
  | "ended";

export type ApplicationProgressSource = Pick<
  JobApplicationRecord,
  | "current_stage_type"
  | "current_stage_label"
  | "stage_state"
  | "status"
  | "offer_status"
  | "archived_at"
  | "applied_at"
  | "phase"
  | "lifecycle_status"
  | "termination_reason"
  | "current_stage"
>;

/**
 * The API keeps the Offer lifecycle values as data; this is the single
 * product-facing copy projection used by cards, lists, and detail views.
 * `none` is intentionally explicit because it also represents a historical
 * record whose Offer update did not persist successfully.
 */
export function offerStatusLabel(status: JobApplicationRecord["offer_status"]): string {
  return status === "none"
    ? t("Offer 状态待确认")
    : status === "declined"
      ? t("已主动结束")
      : t("已收到 Offer");
}

/**
 * The application list endpoint adds the next scheduled session to the
 * progress state.  Keep these fields optional so the projection remains
 * usable with the record shape used by detail views and older fixtures.
 */
export type ApplicationProgressScheduleSource = ApplicationProgressSource & {
  next_session_start_at?: string | null;
  next_session_end_at?: string | null;
};

export type ApplicationProgressLabelOptions = {
  now?: Date;
  currentStageCompleted?: boolean;
};

type ApplicationStageSource = Pick<
  JobApplicationRecord,
  "current_stage_type" | "current_stage_label" | "current_round_no" | "current_stage"
>;

export function applicationStageMatchesSession(
  application: ApplicationStageSource,
  session: Pick<InterviewSessionRecord, "application_stage_id" | "stage_type" | "round_no" | "stage_label">,
): boolean {
  if (application.current_stage && session.application_stage_id) {
    return application.current_stage.id === session.application_stage_id;
  }
  if (application.current_stage_type === "screening" && session.stage_type === "other") {
    return application.current_stage_label.trim() === session.stage_label.trim();
  }
  if (application.current_stage_type !== session.stage_type) return false;
  if (application.current_stage_type === "interview") {
    return application.current_round_no === session.round_no;
  }
  return application.current_stage_label.trim() === session.stage_label.trim();
}

export type ApplicationProgressProjection = {
  columnKey: ApplicationProgressColumnKey;
  /** Canonical stage copy used in list rows, cards, and the detail side panel. */
  stageLabel: string;
  /** Primary status copy used in the detail header and status fields. */
  statusLabel: string;
  /** Optional supporting copy for an unsubmitted record. */
  supportingLabel: string | null;
  /** Accessible/product copy for the current progress indicator. */
  primaryLabel: string;
  isPending: boolean;
  isWaiting: boolean;
  isAssessment: boolean;
};

export const APPLICATION_PROGRESS_COLUMNS: Array<{
  key: ApplicationProgressColumnKey;
  label: string;
}> = [
  { key: "pending", get label() { return t("待投递"); } },
  { key: "screening", get label() { return t("筛选中"); } },
  { key: "assessment", get label() { return t("测评"); } },
  { key: "written_test", get label() { return t("笔试"); } },
  { key: "interview", get label() { return t("面试中"); } },
  { key: "offer", label: "Offer" },
  { key: "ended", get label() { return t("已结束"); } },
];

const PENDING_LABEL = "待投递";
const PENDING_SUPPORTING_LABEL = "等待确认投递";
const DEFAULT_SCREENING_LABEL = "筛选中";
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;
const DAY_IN_MILLISECONDS = 24 * HOUR_IN_MILLISECONDS;

function isActive(application: ApplicationProgressSource): boolean {
  return application.lifecycle_status !== "terminated"
    && application.status === "active"
    && application.archived_at === null;
}

function legacyStableStageType(application: ApplicationProgressSource) {
  if (application.current_stage_type === "hr") return "interview";
  if (application.current_stage_type !== "screening") {
    return application.current_stage_type;
  }
  const label = application.current_stage_label.trim().toLocaleLowerCase();
  if (label.includes("笔试")) return "written_test";
  if (label.includes("测评") || label.includes("assessment")) return "assessment";
  return "screening";
}

/**
 * Screening has one canonical product-facing label.  Assessment labels remain
 * descriptive (apart from the historical `测评中`/`笔试中` aggregate labels),
 * while all ordinary screening labels—including legacy waiting and screening
 * rounds—project to the single screening column.
 */
export function normalizeApplicationStageLabel(
  application: Pick<ApplicationProgressSource, "current_stage_type" | "current_stage_label" | "current_stage">,
): string {
  if (application.current_stage) return application.current_stage.stage_label;
  const label = application.current_stage_label.trim();
  if (application.current_stage_type === "offer") return "Offer";
  if (application.current_stage_type !== "screening") return label || t("当前阶段");
  if (label === "测评中") return t("测评");
  if (label === "笔试中") return t("笔试");
  if (label.includes("笔试") || label.includes("测评") || /assessment/i.test(label)) {
    return label || t("当前阶段");
  }
  return label === PENDING_LABEL ? PENDING_LABEL : DEFAULT_SCREENING_LABEL;
}

function terminalStatusLabel(application: ApplicationProgressSource): string | null {
  if (application.archived_at) return t("已归档");
  if (application.lifecycle_status === "terminated") {
    if (application.termination_reason === "company_rejected") return t("未通过");
    if (application.termination_reason === "user_withdrew" || application.termination_reason === "offer_declined") return t("已主动结束");
    return t("已终止");
  }
  if (application.status === "rejected") return t("未通过");
  if (application.status === "withdrawn") return t("已主动结束");
  if (application.status === "closed") {
    return application.offer_status === "declined" ? t("已主动结束") : t("已结束");
  }
  return null;
}

export function projectApplicationProgress(
  application: ApplicationProgressSource,
): ApplicationProgressProjection {
  const active = isActive(application);
  const normalizedStageLabel = normalizeApplicationStageLabel(application);
  const stableStageType = application.current_stage?.stage_type
    ?? legacyStableStageType(application);
  const phase = application.phase
    ?? (application.applied_at || application.current_stage || application.current_stage_type !== "screening"
      ? "applied"
      : "pending");
  const isPending = active && phase === "pending";
  const isWaiting = active
    && application.stage_state === "awaiting_result"
    && (stableStageType === "interview" || stableStageType === "ai_interview");
  const isAssessment = active
    && (stableStageType === "assessment" || stableStageType === "written_test");
  const isAcceptedOffer = application.archived_at === null
    && application.status === "closed"
    && application.offer_status === "accepted";
  const terminalLabel = terminalStatusLabel(application);

  if (isAcceptedOffer) {
    return {
      columnKey: "offer",
      stageLabel: normalizedStageLabel,
      statusLabel: t("已收到 Offer"),
      supportingLabel: null,
      primaryLabel: t("已收到 Offer"),
      isPending: false,
      isWaiting: false,
      isAssessment: false,
    };
  }

  if (terminalLabel) {
    return {
      columnKey: "ended",
      stageLabel: normalizedStageLabel,
      statusLabel: terminalLabel,
      supportingLabel: null,
      primaryLabel: terminalLabel,
      isPending: false,
      isWaiting: false,
      isAssessment: false,
    };
  }

  if (isPending) {
    return {
      columnKey: "pending",
      stageLabel: t(PENDING_LABEL),
      statusLabel: t(PENDING_LABEL),
      supportingLabel: t(PENDING_SUPPORTING_LABEL),
      primaryLabel: t(PENDING_LABEL),
      isPending: true,
      isWaiting: false,
      isAssessment: false,
    };
  }

  if (active && stableStageType === "offer") {
    const statusLabel = offerStatusLabel(application.offer_status);
    return {
      columnKey: "offer",
      stageLabel: normalizedStageLabel,
      statusLabel,
      supportingLabel: null,
      primaryLabel: statusLabel,
      isPending: false,
      isWaiting: false,
      isAssessment: false,
    };
  }

  const columnKey: ApplicationProgressColumnKey = stableStageType === "screening"
    ? "screening"
    : stableStageType === "assessment"
      ? "assessment"
      : stableStageType === "written_test"
        ? "written_test"
        : "interview";
  const statusLabel = application.stage_state === "awaiting_schedule"
    ? t("等待安排")
    : application.stage_state === "awaiting_result"
      ? t("等待结果")
      : t("进行中");
  return {
    columnKey,
    stageLabel: normalizedStageLabel,
    statusLabel,
    supportingLabel: null,
    primaryLabel: statusLabel,
    isPending: false,
    isWaiting,
    isAssessment,
  };
}

function scheduledProgressColumn(
  projection: ApplicationProgressProjection,
): boolean {
  return projection.columnKey === "assessment"
    || projection.columnKey === "written_test"
    || projection.columnKey === "interview";
}

function validTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Exact schedule copy retained for non-countdown contexts. */
export function formatApplicationScheduleDateTime(value: string): string {
  const date = new Date(value);
  return t("{value0}月{value1}日 {value2}:{value3}", { value0: date.getMonth() + 1, value1: date.getDate(), value2: String(date.getHours()).padStart(2, "0"), value3: String(date.getMinutes()).padStart(2, "0") });
}

/**
 * Returns the schedule-specific status for assessment/interview progress.
 * A null result means that the card has no valid schedule, or that its
 * progress belongs to another product state whose existing copy is retained.
 */
export function applicationScheduleStatusLabel(
  application: ApplicationProgressScheduleSource,
  { now, currentStageCompleted = false }: ApplicationProgressLabelOptions = {},
): string | null {
  const projection = projectApplicationProgress(application);
  if (!scheduledProgressColumn(projection)) return null;

  if (currentStageCompleted) return t("已完成");

  const startAt = application.next_session_start_at;
  const start = validTimestamp(startAt);
  const end = validTimestamp(application.next_session_end_at);
  if (start === null || end === null || end <= start || !startAt) return null;

  const currentTime = (now ?? new Date()).getTime();
  if (!Number.isFinite(currentTime)) return null;
  if (currentTime >= end) return t("等待结果");
  if (currentTime >= start) return t("正在进行");

  const untilStart = start - currentTime;
  if (untilStart <= HOUR_IN_MILLISECONDS * 24) {
    return t("{value0} 小时后", { value0: Math.max(1, Math.ceil(untilStart / HOUR_IN_MILLISECONDS)) });
  }
  return t("{value0} 天后", { value0: Math.ceil(untilStart / DAY_IN_MILLISECONDS) });
}

export function applicationProgressLabel(
  application: ApplicationProgressScheduleSource,
  options: ApplicationProgressLabelOptions = {},
): string {
  const projection = projectApplicationProgress(application);
  if (projection.columnKey === "offer" || application.current_stage_type === "offer") {
    return projection.statusLabel;
  }
  if (projection.columnKey === "ended") return `${projection.stageLabel} · ${projection.statusLabel}`;
  if (projection.supportingLabel) {
    return `${projection.stageLabel} · ${projection.supportingLabel}`;
  }
  const scheduleLabel = applicationScheduleStatusLabel(application, options);
  if (scheduleLabel) return `${projection.stageLabel} · ${scheduleLabel}`;
  if (scheduledProgressColumn(projection)) {
    return `${projection.stageLabel} · ${projection.statusLabel}`;
  }
  return `${projection.stageLabel} · ${projection.statusLabel}`;
}

export function applicationStatusLabel(application: ApplicationProgressSource): string {
  return projectApplicationProgress(application).statusLabel;
}

export function applicationProgressToneClass(
  application: ApplicationProgressScheduleSource,
  options: ApplicationProgressLabelOptions = {},
): string {
  const projection = projectApplicationProgress(application);
  if (application.status === "closed" && application.offer_status === "accepted") return "is-offer";
  if (projection.columnKey === "ended") {
    if (application.status === "rejected") return "is-danger";
    return "is-muted";
  }
  if (projection.columnKey === "offer") return "is-offer";
  if (options.currentStageCompleted && scheduledProgressColumn(projection)) return "is-success";
  const scheduleLabel = applicationScheduleStatusLabel(application, options);
  if (scheduleLabel === t("等待结果")) return "is-waiting";
  if (scheduleLabel === t("正在进行")) return "is-active";
  if (scheduleLabel) return "is-scheduled";
  if (application.stage_state === "negotiating") return "is-offer";
  if (projection.isWaiting) return "is-waiting";
  if (application.stage_state === "awaiting_schedule") return "is-scheduled";
  return "is-active";
}

/** The detail hero predates the board/list token name for the waiting tone. */
export function applicationDetailStatusToneClass(
  application: ApplicationProgressSource,
  options: ApplicationProgressLabelOptions = {},
): string {
  const tone = applicationProgressToneClass(application, options);
  return tone === "is-waiting" ? "is-warning" : tone;
}

export function isApplicationDraggable(application: ApplicationProgressSource): boolean {
  return application.status === "active"
    && application.archived_at === null
    && application.applied_at !== null
    && application.current_stage_type === "screening"
    && application.stage_state === "awaiting_result";
}

/**
 * 求职流程的阶段先后顺序（看板列、拖拽校验、「添加下一阶段」默认项共用）。
 * 规则：只能往后走，不能退回更早的阶段；面试可以连续多轮，由轮次再比较先后。
 * 后端接受任意阶段，这里只约束前端给出的入口，避免出现「测评完成后进不了笔试」这类死路。
 */
export const APPLICATION_STAGE_ORDER = ["screening", "assessment", "written_test", "ai_interview", "interview", "offer"] as const;
export type OrderedStageType = (typeof APPLICATION_STAGE_ORDER)[number];

export function applicationStageRank(stage: string): number {
  const index = APPLICATION_STAGE_ORDER.indexOf(stage as OrderedStageType);
  return index < 0 ? 0 : index;
}

/** 当前所处阶段（看板列 → 阶段类型）；待投递视为筛选之前 */
export function currentOrderedStage(application: ApplicationProgressSource): OrderedStageType | "pending" {
  const projection = projectApplicationProgress(application);
  if (projection.isPending) return "pending";
  const stable: string = application.current_stage?.stage_type ?? legacyStableStageType(application);
  if (stable === "hr") return "interview";
  return APPLICATION_STAGE_ORDER.includes(stable as OrderedStageType) ? stable as OrderedStageType : "screening";
}

/** 当前阶段之后可以进入的阶段（面试可以再来一轮） */
export function nextStageOptions(application: ApplicationProgressSource): OrderedStageType[] {
  const current = currentOrderedStage(application);
  if (current === "pending") return [...APPLICATION_STAGE_ORDER];
  const rank = applicationStageRank(current);
  return APPLICATION_STAGE_ORDER.filter((stage) => (
    stage === "interview" ? rank <= applicationStageRank("interview") : applicationStageRank(stage) > rank
  ));
}

/** 「添加下一阶段」默认选中的下一步：筛选 → 测评 → 笔试 → 面试（一面 / 下一轮）→ Offer */
export function defaultNextStage(application: ApplicationProgressSource): OrderedStageType {
  const current = currentOrderedStage(application);
  if (current === "pending") return "screening";
  if (current === "screening") return "assessment";
  if (current === "assessment") return "written_test";
  return current === "offer" ? "offer" : "interview";
}
