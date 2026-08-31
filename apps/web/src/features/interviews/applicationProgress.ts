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
  { key: "assessment", label: "笔试中" },
  { key: "interview", label: "面试中" },
  { key: "offer", label: "Offer" },
  { key: "ended", label: "已结束" },
];

const PENDING_LABEL = "待投递";
const PENDING_SUPPORTING_LABEL = "等待确认投递";
const DEFAULT_SCREENING_LABEL = "筛选中";

function isActive(application: ApplicationProgressSource): boolean {
  return application.status === "active" && application.archived_at === null;
}

function isAssessmentLabel(label: string): boolean {
  return /笔试|测评|assessment/i.test(label);
}

/**
 * Screening has one canonical product-facing label.  Assessment labels remain
 * descriptive (apart from the historical `测评中`/`笔试中` aggregate labels),
 * while all ordinary screening labels—including legacy waiting and screening
 * rounds—project to the single screening column.
 */
export function normalizeApplicationStageLabel(
  application: Pick<ApplicationProgressSource, "current_stage_type" | "current_stage_label">,
): string {
  const label = application.current_stage_label.trim();
  if (application.current_stage_type !== "screening") return label || "当前阶段";
  if (label === "测评中" || label === "笔试中") return "笔试中";
  if (isAssessmentLabel(label)) return label || "当前阶段";
  return DEFAULT_SCREENING_LABEL;
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
  const isPending = active
    && application.current_stage_type === "screening"
    && application.applied_at === null;
  const isWaiting = active
    && application.stage_state === "awaiting_result"
    && (application.current_stage_type === "interview" || application.current_stage_type === "hr");
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
    isWaiting,
    isAssessment,
  };
}

export function applicationProgressLabel(application: ApplicationProgressSource): string {
  const projection = projectApplicationProgress(application);
  if (projection.columnKey === "ended") return `${projection.stageLabel} · ${projection.statusLabel}`;
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
    && application.stage_state === "awaiting_result";
}
