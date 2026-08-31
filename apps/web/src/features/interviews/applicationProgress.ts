import type { JobApplicationRecord } from "@/api/client";

/**
 * The application API keeps a small state machine.  These labels are the
 * product-facing projection of that state machine, not a second API state.
 */
export type ApplicationProgressColumnKey =
  | "pending"
  | "screening"
  | "assessment"
  | "interview"
  | "waiting"
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
>;

export type ApplicationProgressProjection = {
  columnKey: ApplicationProgressColumnKey;
  /** Canonical stage copy used in list rows, cards, and the detail side panel. */
  stageLabel: string;
  /** Primary status copy used in the detail header and status fields. */
  statusLabel: string;
  /** Optional supporting copy for an unsubmitted or default waiting record. */
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
  { key: "assessment", label: "笔试中" },
  { key: "interview", label: "面试中" },
  { key: "waiting", label: "等待通知" },
  { key: "offer", label: "Offer" },
  { key: "ended", label: "已结束" },
];

const PENDING_LABEL = "待投递";
const PENDING_SUPPORTING_LABEL = "等待确认投递";
const DEFAULT_SCREENING_LABEL = "筛选中";
const WAITING_LABEL = "等待后续通知";
const WAITING_SUPPORTING_LABEL = "下一阶段尚未确认";

function isActive(application: ApplicationProgressSource): boolean {
  return application.status === "active" && application.archived_at === null;
}

function isAssessmentLabel(label: string): boolean {
  return /笔试|测评|assessment/i.test(label);
}

/**
 * Before the post-application placeholder got its own label, existing rows
 * were stored as `筛选中 + awaiting_result`.  Keep that row in the waiting
 * column, while labels explicitly added from the stage dialog (`筛选`、`初筛`、
 * `复筛`) remain real screening stages.
 */
function isPostApplicationWaitingPlaceholder(application: ApplicationProgressSource): boolean {
  if (!isActive(application) || application.applied_at === null) return false;
  if (application.current_stage_type !== "screening" || application.stage_state !== "awaiting_result") return false;
  const label = application.current_stage_label.trim();
  return label === WAITING_LABEL || label === DEFAULT_SCREENING_LABEL;
}

/**
 * Screening is the only API stage whose user-facing label has two product
 * names.  Keep the mapping deliberately narrow so custom interview labels
 * remain unchanged.
 */
export function normalizeApplicationStageLabel(
  application: Pick<ApplicationProgressSource, "current_stage_type" | "current_stage_label">,
): string {
  const label = application.current_stage_label.trim();
  if (application.current_stage_type !== "screening") return label || "当前阶段";
  if (label === "测评中" || label === "笔试中") return "笔试中";
  return label || DEFAULT_SCREENING_LABEL;
}

function terminalStatusLabel(application: ApplicationProgressSource): string | null {
  if (application.archived_at) return "已归档";
  if (application.status === "rejected") return "未通过";
  if (application.status === "withdrawn") return "已主动结束";
  if (application.status === "closed") {
    return application.offer_status === "accepted" ? "已接受 Offer" : "已结束";
  }
  return null;
}

export function projectApplicationProgress(
  application: ApplicationProgressSource,
): ApplicationProgressProjection {
  const active = isActive(application);
  const normalizedStageLabel = normalizeApplicationStageLabel(application);
  const isPostApplicationWaiting = isPostApplicationWaitingPlaceholder(application);
  const isPending = active
    && application.current_stage_type === "screening"
    && application.applied_at === null;
  const isWaiting = active
    && (
      isPostApplicationWaiting
      || (
        application.stage_state === "awaiting_result"
        && (application.current_stage_type === "interview" || application.current_stage_type === "hr")
      )
    );
  const isAssessment = active
    && application.current_stage_type === "screening"
    && isAssessmentLabel(application.current_stage_label.trim());
  const terminalLabel = terminalStatusLabel(application);

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

  if (active && application.current_stage_type === "offer") {
    const statusLabel = application.stage_state === "negotiating" ? "Offer 沟通中" : "进行中";
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

  if (isWaiting) {
    return {
      columnKey: "waiting",
      // The old `筛选中 + awaiting_result` row is the pre-label version of
      // `等待后续通知`; expose the canonical copy everywhere in the waiting
      // column so it cannot be mistaken for an ordinary screening stage.
      stageLabel: isPostApplicationWaiting ? WAITING_LABEL : normalizedStageLabel,
      statusLabel: WAITING_LABEL,
      supportingLabel: WAITING_SUPPORTING_LABEL,
      primaryLabel: WAITING_LABEL,
      isPending: false,
      isWaiting: true,
      isAssessment,
    };
  }

  const columnKey: ApplicationProgressColumnKey = application.current_stage_type === "screening"
    ? isAssessment ? "assessment" : "screening"
    : "interview";
  const statusLabel = application.stage_state === "awaiting_schedule"
    ? "等待安排"
    : application.stage_state === "awaiting_result"
      ? "等待结果"
    : application.stage_state === "negotiating"
      ? "Offer 沟通中"
      : "进行中";
  return {
    columnKey,
    stageLabel: normalizedStageLabel,
    statusLabel,
    supportingLabel: null,
    primaryLabel: statusLabel,
    isPending: false,
    isWaiting: false,
    isAssessment,
  };
}

export function applicationProgressLabel(application: ApplicationProgressSource): string {
  const projection = projectApplicationProgress(application);
  if (projection.columnKey === "ended") return `${projection.stageLabel} · ${projection.statusLabel}`;
  if (projection.isWaiting) {
    return projection.stageLabel === WAITING_LABEL
      ? projection.statusLabel
      : `${projection.stageLabel} · ${projection.statusLabel}`;
  }
  if (projection.supportingLabel) {
    return `${projection.stageLabel} · ${projection.supportingLabel}`;
  }
  return `${projection.stageLabel} · ${projection.statusLabel}`;
}

export function applicationStatusLabel(application: ApplicationProgressSource): string {
  return projectApplicationProgress(application).statusLabel;
}

export function applicationProgressToneClass(application: ApplicationProgressSource): string {
  const projection = projectApplicationProgress(application);
  if (projection.columnKey === "ended") {
    if (application.status === "rejected") return "is-danger";
    if (application.status === "closed" && application.offer_status === "accepted") return "is-offer";
    return "is-muted";
  }
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
    && application.stage_state === "awaiting_result"
    && !isPostApplicationWaitingPlaceholder(application);
}
