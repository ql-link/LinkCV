import type { InterviewSessionRecord, JobApplicationRecord } from "@/api/client";

/**
 * The application API keeps a small state machine.  These labels are the
 * product-facing projection of that state machine, not a second API state.
 */
export type ApplicationProgressColumnKey =
  | "pending"
  | "screening"
  | "assessment"
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
    ? "Offer 状态待确认"
    : status === "declined"
      ? "已主动结束"
      : "已收到 Offer";
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
  { key: "pending", label: "待投递" },
  { key: "screening", label: "筛选中" },
  { key: "assessment", label: "笔试 / 测评" },
  { key: "interview", label: "面试中" },
  { key: "offer", label: "Offer" },
  { key: "ended", label: "已结束" },
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
  if (application.current_stage_type !== "screening") return label || "当前阶段";
  if (label === "测评中") return "测评";
  if (label === "笔试中") return "笔试";
  if (label.includes("笔试") || label.includes("测评") || /assessment/i.test(label)) {
    return label || "当前阶段";
  }
  return label === PENDING_LABEL ? PENDING_LABEL : DEFAULT_SCREENING_LABEL;
}

function terminalStatusLabel(application: ApplicationProgressSource): string | null {
  if (application.archived_at) return "已归档";
  if (application.lifecycle_status === "terminated") {
    if (application.termination_reason === "company_rejected") return "未通过";
    if (application.termination_reason === "user_withdrew" || application.termination_reason === "offer_declined") return "已主动结束";
    return "已终止";
  }
  if (application.status === "rejected") return "未通过";
  if (application.status === "withdrawn") return "已主动结束";
  if (application.status === "closed") {
    return application.offer_status === "declined" ? "已主动结束" : "已结束";
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
      statusLabel: "已收到 Offer",
      supportingLabel: null,
      primaryLabel: "已收到 Offer",
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
      stageLabel: PENDING_LABEL,
      statusLabel: PENDING_LABEL,
      supportingLabel: PENDING_SUPPORTING_LABEL,
      primaryLabel: PENDING_LABEL,
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
    : isAssessment
      ? "assessment"
      : "interview";
  const statusLabel = application.stage_state === "awaiting_schedule"
    ? "等待安排"
    : application.stage_state === "awaiting_result"
      ? "等待结果"
      : "进行中";
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
  return projection.columnKey === "assessment" || projection.columnKey === "interview";
}

function validTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Exact schedule copy retained for non-countdown contexts. */
export function formatApplicationScheduleDateTime(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

  if (currentStageCompleted) return "等待结果";

  const startAt = application.next_session_start_at;
  const start = validTimestamp(startAt);
  const end = validTimestamp(application.next_session_end_at);
  if (start === null || end === null || end <= start || !startAt) return null;

  const currentTime = (now ?? new Date()).getTime();
  if (!Number.isFinite(currentTime)) return null;
  if (currentTime >= end) return "等待结果";
  if (currentTime >= start) return "正在进行";

  const untilStart = start - currentTime;
  if (untilStart <= HOUR_IN_MILLISECONDS * 24) {
    return `${Math.max(1, Math.ceil(untilStart / HOUR_IN_MILLISECONDS))} 小时后`;
  }
  return `${Math.ceil(untilStart / DAY_IN_MILLISECONDS)} 天后`;
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
  if (scheduleLabel === "等待结果") return "is-waiting";
  if (scheduleLabel === "正在进行") return "is-active";
  if (scheduleLabel) return "is-scheduled";
  if (application.stage_state === "negotiating") return "is-offer";
  if (projection.isWaiting) return "is-waiting";
  if (application.stage_state === "awaiting_schedule") return "is-scheduled";
  return "is-active";
}

/** The detail hero predates the board/list token name for the waiting tone. */
export function applicationDetailStatusToneClass(application: ApplicationProgressSource): string {
  const tone = applicationProgressToneClass(application);
  return tone === "is-waiting" ? "is-warning" : tone;
}

export function isApplicationDraggable(application: ApplicationProgressSource): boolean {
  return application.status === "active"
    && application.archived_at === null
    && application.applied_at !== null
    && application.current_stage_type === "screening"
    && application.stage_state === "awaiting_result";
}
