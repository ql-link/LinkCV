import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Ban, Eye, MoreHorizontal } from "lucide-react";
import type { JobApplicationSummary } from "@/api/client";
import { careerApplicationPath, navigateTo } from "../../routing";
import {
  APPLICATION_PROGRESS_COLUMNS,
  applicationProgressToneClass as projectApplicationProgressToneClass,
  applicationProgressLabel as projectApplicationProgressLabel,
  applicationStatusLabel as projectApplicationStatusLabel,
  formatApplicationScheduleDateTime,
  projectApplicationProgress,
  type ApplicationProgressLabelOptions,
  type ApplicationProgressColumnKey,
} from "./applicationProgress";

export type ProgressColumnKey = ApplicationProgressColumnKey;
export type ApplicationSortMode = "recent_schedule" | "earliest_added";
export type NextStageDialogTab = "assessment" | "interview" | "offer";
export type NextStagePrefill = {
  initialTab: NextStageDialogTab;
  initialInterviewLabel?: string;
};

export const PROGRESS_COLUMNS = APPLICATION_PROGRESS_COLUMNS;

const INTERVIEW_FALLBACK_LABEL = "面试中";

type BoardProgressColumn = {
  id: string;
  key: ProgressColumnKey;
  label: string;
  items: JobApplicationSummary[];
  interviewRoundNo: number | null;
};

type DropPreview = {
  columnId: string;
};

type InterviewColumnGroup = {
  label: string;
  items: JobApplicationSummary[];
  firstAppearance: number;
  interviewRoundNo: number | null;
};

function validInterviewRound(roundNo: number | null): number | null {
  return typeof roundNo === "number" && Number.isInteger(roundNo) && roundNo > 0
    ? roundNo
    : null;
}

function isBoardInterviewApplication(application: JobApplicationSummary): boolean {
  return progressColumnKey(application) === "interview";
}

function interviewColumnLabel(application: JobApplicationSummary): string {
  return application.current_stage_label.trim() || INTERVIEW_FALLBACK_LABEL;
}

function compareInterviewColumns(left: InterviewColumnGroup, right: InterviewColumnGroup): number {
  const leftRound = left.interviewRoundNo;
  const rightRound = right.interviewRoundNo;
  if (leftRound === null && rightRound !== null) return 1;
  if (leftRound !== null && rightRound === null) return -1;
  if (leftRound !== null && rightRound !== null && leftRound !== rightRound) {
    return leftRound - rightRound;
  }
  if (left.firstAppearance !== right.firstAppearance) {
    return left.firstAppearance - right.firstAppearance;
  }
  return left.label.localeCompare(right.label, "zh-CN", { sensitivity: "base" });
}

function buildBoardColumns(applications: JobApplicationSummary[]): BoardProgressColumn[] {
  const interviewGroups = new Map<string, InterviewColumnGroup>();
  applications.forEach((application, index) => {
    if (!isBoardInterviewApplication(application)) return;
    const label = interviewColumnLabel(application);
    const roundNo = validInterviewRound(application.current_round_no);
    const existing = interviewGroups.get(label);
    if (existing) {
      existing.items.push(application);
      if (roundNo !== null && (existing.interviewRoundNo === null || roundNo < existing.interviewRoundNo)) {
        existing.interviewRoundNo = roundNo;
      }
      return;
    }
    interviewGroups.set(label, {
      label,
      items: [application],
      firstAppearance: index,
      interviewRoundNo: roundNo,
    });
  });

  const dynamicInterviewColumns = Array.from(interviewGroups.values())
    .sort(compareInterviewColumns)
    .map((group) => ({
      id: `interview:${group.label}`,
      key: "interview" as const,
      label: group.label,
      items: group.items,
      interviewRoundNo: group.interviewRoundNo,
    }));
  const interviewColumns = dynamicInterviewColumns.length
    ? dynamicInterviewColumns
    : [{
      id: `interview:${INTERVIEW_FALLBACK_LABEL}`,
      key: "interview" as const,
      label: INTERVIEW_FALLBACK_LABEL,
      items: [],
      interviewRoundNo: null,
    }];

  return PROGRESS_COLUMNS.flatMap<BoardProgressColumn>((column) => {
    if (column.key === "interview") return interviewColumns;
    return [{
      id: column.key,
      key: column.key,
      label: column.label,
      items: applications.filter((item) => progressColumnKey(item) === column.key),
      interviewRoundNo: null,
    }];
  });
}

function chineseNumeralToNumber(value: string): number | null {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (!value || [...value].some((character) => digits[character] === undefined)) return null;
  const numeral = [...value].map((character) => digits[character]).join("");
  const parsed = Number(numeral);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function inferInterviewRoundNo(label: string): number | null {
  const normalized = label.trim();
  const digitMatch = normalized.match(/(?:第\s*)?(\d+)\s*(?:轮|面)/);
  if (digitMatch) return validInterviewRound(Number(digitMatch[1]));
  const chineseMatch = normalized.match(/^([零〇一二两三四五六七八九]+)\s*面/);
  return chineseMatch ? chineseNumeralToNumber(chineseMatch[1]) : null;
}

function interviewColumnPrefill(column: BoardProgressColumn): NextStagePrefill {
  // An empty fallback column has no user-provided stage to inherit. Keep the
  // existing first-round convention when opening the stage dialog.
  return {
    initialTab: "interview",
    initialInterviewLabel: column.items.length ? column.label : "一面",
  };
}

export function progressColumnKey(application: JobApplicationSummary): ProgressColumnKey {
  return projectApplicationProgress(application).columnKey;
}

function validApplicationTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareApplicationId(left: string, right: string): number {
  if (left === right) return 0;
  const leftDecimal = left.match(/^\d+$/)?.[0].replace(/^0+(?=\d)/, "");
  const rightDecimal = right.match(/^\d+$/)?.[0].replace(/^0+(?=\d)/, "");
  if (leftDecimal && rightDecimal) {
    if (leftDecimal.length !== rightDecimal.length) return leftDecimal.length - rightDecimal.length;
    if (leftDecimal !== rightDecimal) return leftDecimal < rightDecimal ? -1 : 1;
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareApplicationsByCreatedAt(left: JobApplicationSummary, right: JobApplicationSummary): number {
  const leftCreatedAt = validApplicationTimestamp(left.created_at);
  const rightCreatedAt = validApplicationTimestamp(right.created_at);
  if (leftCreatedAt !== null && rightCreatedAt !== null && leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }
  if (leftCreatedAt === null && rightCreatedAt !== null) return 1;
  if (leftCreatedAt !== null && rightCreatedAt === null) return -1;
  return compareApplicationId(left.id, right.id);
}

function isScheduleColumn(columnKey: ProgressColumnKey): boolean {
  return columnKey === "assessment" || columnKey === "interview";
}

/** Whether an application participates in recent-schedule ordering. */
export function hasValidApplicationSchedule(application: JobApplicationSummary): boolean {
  return isScheduleColumn(progressColumnKey(application))
    && validApplicationTimestamp(application.next_session_start_at) !== null;
}

/** Stable application ordering shared by the board and list presentations. */
export function compareApplicationsBySortMode(
  left: JobApplicationSummary,
  right: JobApplicationSummary,
  sortMode: ApplicationSortMode,
): number {
  if (sortMode === "earliest_added") return compareApplicationsByCreatedAt(left, right);

  const leftScheduleAt = hasValidApplicationSchedule(left)
    ? validApplicationTimestamp(left.next_session_start_at)
    : null;
  const rightScheduleAt = hasValidApplicationSchedule(right)
    ? validApplicationTimestamp(right.next_session_start_at)
    : null;
  if (leftScheduleAt !== null && rightScheduleAt !== null && leftScheduleAt !== rightScheduleAt) {
    return leftScheduleAt - rightScheduleAt;
  }
  if (leftScheduleAt !== null && rightScheduleAt === null) return -1;
  if (leftScheduleAt === null && rightScheduleAt !== null) return 1;
  return compareApplicationsByCreatedAt(left, right);
}

export function sortApplications(
  applications: readonly JobApplicationSummary[],
  sortMode: ApplicationSortMode,
): JobApplicationSummary[] {
  return [...applications].sort((left, right) => compareApplicationsBySortMode(left, right, sortMode));
}

function applicationDropBlockReason(
  application: JobApplicationSummary,
  completedCurrentStageApplicationIds: ReadonlySet<string>,
): string | null {
  const source = progressColumnKey(application);
  if (application.archived_at !== null) {
    return "该求职流程已归档，不能拖入其他状态栏。";
  }
  if (application.status !== "active") {
    return "该求职流程已经结束，不能拖入其他状态栏。";
  }
  if (source === "offer") {
    return "该求职流程已经进入 Offer 阶段，不能再拖入其他状态栏。";
  }
  if (source === "pending") {
    return application.applied_at === null
      ? null
      : "该记录已经投递，不能继续从待投递栏拖动。";
  }
  if (application.applied_at === null) {
    return "请先确认投递信息，再拖动到其他状态栏。";
  }
  if (source === "screening") {
    return application.stage_state === "awaiting_result"
      ? null
      : "当前筛选流程尚未进入等待结果状态，不能推进到其他状态栏。";
  }
  if ((source === "assessment" || source === "interview")
    && !completedCurrentStageApplicationIds.has(application.id)) {
    return source === "assessment"
      ? "请先在详情页完成当前笔试或测评，再拖动到下一阶段。"
      : "请先在详情页完成当前面试，再拖动到下一阶段。";
  }
  return null;
}

function applicationBoardColumnId(application: JobApplicationSummary): string {
  const columnKey = progressColumnKey(application);
  return columnKey === "interview"
    ? `interview:${interviewColumnLabel(application)}`
    : columnKey;
}

type DropValidation =
  | { valid: true; prefill: NextStagePrefill }
  | { valid: false; message: string };

function validateApplicationDrop(
  application: JobApplicationSummary,
  target: BoardProgressColumn,
  columns: BoardProgressColumn[],
  completedCurrentStageApplicationIds: ReadonlySet<string>,
): DropValidation {
  const blockReason = applicationDropBlockReason(
    application,
    completedCurrentStageApplicationIds,
  );
  if (blockReason) {
    return { valid: false, message: blockReason };
  }
  const source = progressColumnKey(application);
  if (source === "pending") {
    return target.key === "screening"
      ? { valid: true, prefill: { initialTab: "assessment" } }
      : { valid: false, message: "待投递记录只能拖到筛选中，确认投递日期后再继续。" };
  }
  if (target.key === "assessment") {
    return source === "screening"
      ? { valid: true, prefill: { initialTab: "assessment" } }
      : { valid: false, message: "笔试阶段只能从筛选中进入。" };
  }
  if (target.key === "offer") {
    return { valid: true, prefill: { initialTab: "offer" } };
  }
  if (target.key !== "interview") {
    return { valid: false, message: "只能拖动到后续的笔试、面试或 Offer 阶段。" };
  }

  if (source === "interview") {
    const sourceColumnId = `interview:${interviewColumnLabel(application)}`;
    const sourceColumnIndex = columns.findIndex((column) => column.id === sourceColumnId);
    const targetColumnIndex = columns.findIndex((column) => column.id === target.id);
    const currentRound = validInterviewRound(application.current_round_no)
      ?? inferInterviewRoundNo(interviewColumnLabel(application));
    const targetRound = target.interviewRoundNo ?? inferInterviewRoundNo(target.label);
    const isLater = currentRound !== null && targetRound !== null
      ? targetRound > currentRound
      : currentRound !== null && targetRound === null
        ? targetColumnIndex > sourceColumnIndex
        : currentRound === null && targetRound !== null
          ? false
          : targetColumnIndex > sourceColumnIndex;
    if (target.id === sourceColumnId || !isLater) {
      return { valid: false, message: "不能拖回当前或更早的面试阶段。" };
    }
  }
  return {
    valid: true,
    prefill: interviewColumnPrefill(target),
  };
}

export function interviewRoundLabel(roundNo: number): string {
  if (roundNo === 1) return "一面";
  if (roundNo === 2) return "二面";
  return `第 ${roundNo} 轮`;
}

export function applicationStatusLabel(application: JobApplicationSummary): string {
  return projectApplicationStatusLabel(application);
}

export function applicationProgressToneClass(
  application: JobApplicationSummary,
  options: ApplicationProgressLabelOptions = {},
): string {
  return projectApplicationProgressToneClass(application, options);
}

export function formatApplicationDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function formatApplicationDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatApplicationUpdatedAt(value: string, now = new Date()): string {
  const date = new Date(value);
  const isSameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (isSameDay(date, now)) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return `昨天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function applicationCardStageLabel(
  application: JobApplicationSummary,
  columnKey: ProgressColumnKey,
  currentStageCompleted = false,
  now = new Date(),
): string {
  const projection = projectApplicationProgress(application);
  if (columnKey === "ended") return projection.statusLabel;
  return projectApplicationProgressLabel(application, { currentStageCompleted, now });
}

type ApplicationAdvanceAction = {
  enabled: boolean;
  prefill: NextStagePrefill | null;
};

/**
 * Resolve the same safe next-stage boundary used by board dragging for the
 * explicit card action.  A menu action can open the existing dialog, but it
 * must not bypass the completion requirement for a current assessment or
 * interview session.
 */
function applicationAdvanceAction(
  application: JobApplicationSummary,
  completedCurrentStageApplicationIds: ReadonlySet<string>,
): ApplicationAdvanceAction {
  const columnKey = progressColumnKey(application);
  const active = application.status === "active" && application.archived_at === null;
  if (!active || columnKey === "offer" || columnKey === "ended") {
    return { enabled: false, prefill: null };
  }
  if (columnKey === "pending") {
    return application.applied_at === null
      ? { enabled: true, prefill: null }
      : { enabled: false, prefill: null };
  }
  if (columnKey === "screening") {
    return application.current_stage_type === "screening"
      && application.applied_at !== null
      && application.stage_state === "awaiting_result"
      ? { enabled: true, prefill: { initialTab: "assessment" } }
      : { enabled: false, prefill: null };
  }
  if (columnKey === "assessment") {
    return completedCurrentStageApplicationIds.has(application.id)
      ? {
        enabled: true,
        prefill: { initialTab: "interview", initialInterviewLabel: "一面" },
      }
      : { enabled: false, prefill: null };
  }
  if (columnKey === "interview") {
    return completedCurrentStageApplicationIds.has(application.id)
      ? { enabled: true, prefill: { initialTab: "interview", initialInterviewLabel: "" } }
      : { enabled: false, prefill: null };
  }
  return { enabled: false, prefill: null };
}

export function formatApplicationListDateTime(value: string): string {
  return formatApplicationScheduleDateTime(value);
}

export function ApplicationsBoard({
  visibleApplications,
  completedCurrentStageApplicationIds,
  now,
  sortMode = "recent_schedule",
  displayMode,
  onNotice,
  onRequestMarkApplied,
  onRequestNextStage,
  onRequestTerminate,
}: {
  visibleApplications: JobApplicationSummary[];
  completedCurrentStageApplicationIds: ReadonlySet<string>;
  now?: Date;
  sortMode?: ApplicationSortMode;
  displayMode: "board" | "list";
  onNotice: (notice: string) => void;
  onRequestMarkApplied: (application: JobApplicationSummary) => void;
  onRequestNextStage: (application: JobApplicationSummary, prefill: NextStagePrefill) => void;
  onRequestTerminate: (application: JobApplicationSummary) => void;
}) {
  return (
    displayMode === "board" && visibleApplications.length > 0 ? (
      <ProgressBoard
        applications={visibleApplications}
        completedCurrentStageApplicationIds={completedCurrentStageApplicationIds}
        now={now}
        sortMode={sortMode}
        onNotice={onNotice}
        onRequestMarkApplied={onRequestMarkApplied}
        onRequestNextStage={onRequestNextStage}
        onRequestTerminate={onRequestTerminate}
      />
    ) : null
  );
}

export function ProgressBoard({
  applications,
  completedCurrentStageApplicationIds,
  now,
  sortMode = "recent_schedule",
  onNotice,
  onRequestMarkApplied,
  onRequestNextStage,
  onRequestTerminate,
}: {
  applications: JobApplicationSummary[];
  completedCurrentStageApplicationIds: ReadonlySet<string>;
  now?: Date;
  sortMode?: ApplicationSortMode;
  onNotice: (notice: string) => void;
  onRequestMarkApplied: (application: JobApplicationSummary) => void;
  onRequestNextStage: (application: JobApplicationSummary, prefill: NextStagePrefill) => void;
  onRequestTerminate: (application: JobApplicationSummary) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [invalidDropTarget, setInvalidDropTarget] = useState<string | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const advancingId: string | null = null;
  const dragRef = useRef<{ id: string } | null>(null);
  const suppressCardClickRef = useRef(false);
  const columns = useMemo(
    () => buildBoardColumns(sortApplications(applications, sortMode)),
    [applications, sortMode],
  );
  const calculationNow = now ?? new Date();

  const clearDrag = () => {
    dragRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    setInvalidDropTarget(null);
    setDropPreview(null);
  };

  const handleDragStart = (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => {
    dragRef.current = { id: item.id };
    suppressCardClickRef.current = true;
    setDraggingId(item.id);
    setDropPreview(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    }
  };

  const handleDrop = (target: BoardProgressColumn, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    const drag = dragRef.current;
    const draggedId = drag?.id || event.dataTransfer?.getData("text/plain");
    clearDrag();
    if (!draggedId || !drag) return;
    const application = applications.find((item) => item.id === draggedId);
    if (!application) return;
    if (applicationBoardColumnId(application) === target.id) return;
    const validation = validateApplicationDrop(application, target, columns, completedCurrentStageApplicationIds);
    if (!validation.valid) {
      onNotice(validation.message);
      return;
    }
    if (progressColumnKey(application) === "pending") {
      onRequestMarkApplied(application);
      return;
    }
    onRequestNextStage(application, validation.prefill);
  };

  const draggingApplication = draggingId
    ? applications.find((item) => item.id === draggingId) ?? null
    : null;

  return (
    <section className="interview-surface career-applications-board" aria-label="求职进程看板">
      <div className="progress-board-grid">
        {columns.map((column) => (
          <ProgressColumn
            key={column.id}
            column={column}
            draggingId={draggingId}
            draggingSourceColumnId={draggingApplication ? applicationBoardColumnId(draggingApplication) : null}
            dropPreview={dropPreview}
            dropTarget={dropTarget}
            advancingId={advancingId}
            completedCurrentStageApplicationIds={completedCurrentStageApplicationIds}
            now={calculationNow}
            canAcceptDrop={Boolean(draggingApplication && validateApplicationDrop(
              draggingApplication,
              column,
              columns,
              completedCurrentStageApplicationIds,
            ).valid)}
            isInvalidDropTarget={invalidDropTarget === column.id}
            onDragStart={handleDragStart}
            onDragEnd={() => {
              clearDrag();
              window.setTimeout(() => {
                suppressCardClickRef.current = false;
              }, 0);
            }}
            onDragOver={(event) => {
              if (!draggingApplication) return;
              event.preventDefault();
              if (applicationBoardColumnId(draggingApplication) === column.id) {
                event.dataTransfer.dropEffect = "move";
                setDropTarget(null);
                setInvalidDropTarget(null);
                setDropPreview({ columnId: column.id });
                return;
              }
              const validation = validateApplicationDrop(
                draggingApplication,
                column,
                columns,
                completedCurrentStageApplicationIds,
              );
              event.dataTransfer.dropEffect = validation.valid ? "move" : "none";
              setDropTarget(validation.valid ? column.id : null);
              setInvalidDropTarget(validation.valid ? null : column.id);
              if (!validation.valid) {
                setDropPreview(null);
                return;
              }
              setDropPreview({ columnId: column.id });
            }}
            onDragLeave={(event) => {
              const relatedTarget = event.relatedTarget as Node | null;
              if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) {
                setDropTarget(null);
                setInvalidDropTarget(null);
                setDropPreview(null);
              }
            }}
            onDrop={(event) => handleDrop(column, event)}
            onRequestMarkApplied={onRequestMarkApplied}
            onRequestNextStage={onRequestNextStage}
            onRequestTerminate={onRequestTerminate}
            onOpen={(item) => {
              if (!suppressCardClickRef.current) navigateTo(careerApplicationPath(item.id));
            }}
          />
        ))}
      </div>
    </section>
  );
}

export function ProgressColumn({
  column,
  draggingId,
  draggingSourceColumnId,
  dropPreview,
  dropTarget,
  advancingId,
  completedCurrentStageApplicationIds,
  now,
  canAcceptDrop,
  isInvalidDropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onRequestMarkApplied,
  onRequestNextStage,
  onRequestTerminate,
  onOpen,
}: {
  column: BoardProgressColumn;
  draggingId: string | null;
  draggingSourceColumnId: string | null;
  dropPreview: DropPreview | null;
  dropTarget: string | null;
  advancingId: string | null;
  completedCurrentStageApplicationIds: ReadonlySet<string>;
  now?: Date;
  canAcceptDrop: boolean;
  isInvalidDropTarget: boolean;
  onDragStart: (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onRequestMarkApplied: (application: JobApplicationSummary) => void;
  onRequestNextStage: (application: JobApplicationSummary, prefill: NextStagePrefill) => void;
  onRequestTerminate: (application: JobApplicationSummary) => void;
  onOpen: (item: JobApplicationSummary) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const isSourceColumn = Boolean(draggingSourceColumnId && draggingSourceColumnId === column.id);
  const isReturningToSource = Boolean(
    draggingId && isSourceColumn && dropPreview?.columnId === column.id,
  );
  const showDropPreview = Boolean(
    draggingId && dropPreview?.columnId === column.id && !isSourceColumn,
  );
  // Keep the source node mounted while it is visually collapsed. Native
  // dragend is dispatched on that node, and retaining the listener also lets
  // keyboard/test cancellations cleanly reset the board state.
  const renderedItems = column.items;
  const draggingSourceIndex = isSourceColumn && draggingId
    ? renderedItems.findIndex((item) => item.id === draggingId)
    : -1;
  const previewIndex = showDropPreview ? 0 : -1;
  const cardNodes = renderedItems.flatMap((item, index) => {
    const isDraggingCard = draggingId === item.id && !isReturningToSource;
    const isAfterDraggingCard = draggingSourceIndex >= 0
      && index > draggingSourceIndex
      && !isReturningToSource;
    const placeholder = showDropPreview && index === previewIndex
      ? [
        <motion.div
          key={`drop-placeholder-${column.id}`}
          className="progress-card-drop-placeholder"
          data-drop-placeholder="true"
          data-placeholder-index={previewIndex}
          aria-hidden="true"
          layout={shouldReduceMotion ? false : "position"}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 0.82, scale: 1 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        />,
      ]
      : [];
    return [
      ...placeholder,
      <motion.div
        key={item.id}
        className={`progress-card-layout${isAfterDraggingCard ? " is-after-dragging" : ""}`}
        layout={shouldReduceMotion ? false : "position"}
        transition={{ layout: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } }}
      >
        <ProgressCard
          item={item}
          columnKey={column.key}
          isDragging={isDraggingCard}
          isAdvancing={advancingId === item.id}
          currentStageCompleted={completedCurrentStageApplicationIds.has(item.id)}
          completedCurrentStageApplicationIds={completedCurrentStageApplicationIds}
          now={now}
          draggable={advancingId !== item.id}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onRequestMarkApplied={onRequestMarkApplied}
          onRequestNextStage={onRequestNextStage}
          onRequestTerminate={onRequestTerminate}
          onOpen={() => onOpen(item)}
        />
      </motion.div>,
    ];
  });
  if (showDropPreview && previewIndex >= renderedItems.length) {
    cardNodes.push(
      <motion.div
        key={`drop-placeholder-${column.id}`}
        className="progress-card-drop-placeholder"
        data-drop-placeholder="true"
        data-placeholder-index={previewIndex}
        aria-hidden="true"
        layout={shouldReduceMotion ? false : "position"}
        initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 0.82, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      />,
    );
  }
  return (
    <div
      className={`progress-column${canAcceptDrop ? " is-valid-drop-target" : ""}${dropTarget === column.id ? " is-drop-target" : ""}${isInvalidDropTarget ? " is-invalid-drop-target" : ""}`}
      data-column-key={column.key}
      data-column-id={column.id}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="progress-column-heading">
        <h3><span className="progress-column-label">{column.label}</span><span className="progress-column-count">{column.items.length}</span></h3>
      </header>
      <div className="progress-column-cards">
        {cardNodes}
        {!renderedItems.length && !showDropPreview && <p className="pipeline-empty">暂无进程</p>}
      </div>
    </div>
  );
}

export function ProgressCard({
  item,
  columnKey,
  isDragging,
  isAdvancing,
  currentStageCompleted,
  completedCurrentStageApplicationIds,
  now,
  draggable,
  onDragStart,
  onDragEnd,
  onRequestMarkApplied,
  onRequestNextStage,
  onRequestTerminate,
  onOpen,
}: {
  item: JobApplicationSummary;
  columnKey: ProgressColumnKey;
  isDragging: boolean;
  isAdvancing: boolean;
  currentStageCompleted: boolean;
  completedCurrentStageApplicationIds: ReadonlySet<string>;
  now?: Date;
  draggable: boolean;
  onDragStart: (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onRequestMarkApplied?: (application: JobApplicationSummary) => void;
  onRequestNextStage?: (application: JobApplicationSummary, prefill: NextStagePrefill) => void;
  onRequestTerminate?: (application: JobApplicationSummary) => void;
  onOpen: () => void;
}) {
  const stageLabel = applicationCardStageLabel(item, columnKey, currentStageCompleted, now);
  const stageToneClass = projectApplicationProgressToneClass(item, {
    currentStageCompleted,
    now,
  } satisfies ApplicationProgressLabelOptions);
  const advanceAction = applicationAdvanceAction(item, completedCurrentStageApplicationIds);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, [menuOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [],
    );
    if (!items.length) return;
    if (event.key === "Home") return items[0].focus();
    if (event.key === "End") return items[items.length - 1].focus();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : items.length - 1
      : (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  };

  const runMenuAction = (action?: () => void) => {
    setMenuOpen(false);
    action?.();
  };

  const handleCardOpen = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    onOpen();
  };

  return (
    <article
      ref={cardRef}
      className={`progress-card${draggable ? " is-draggable" : ""}${isDragging ? " is-dragging" : ""}${isAdvancing ? " is-advancing" : ""}`}
      aria-label={`${item.company_name_snapshot} ${item.job_title_snapshot}`}
      data-application-id={item.id}
      aria-hidden={isDragging ? "true" : undefined}
      aria-grabbed={draggable ? isDragging : undefined}
      aria-busy={isAdvancing || undefined}
      draggable={draggable}
      onDragStart={(event) => onDragStart(item, event)}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="progress-card-open" aria-label={`查看 ${item.company_name_snapshot} ${item.job_title_snapshot} 求职进程`} onClick={handleCardOpen}>
        <span className="progress-card-company-row">
          <strong className="progress-card-company" title={item.company_name_snapshot}>{item.company_name_snapshot}</strong>
        </span>
        <strong className="progress-card-job-title" title={item.job_title_snapshot}>{item.job_title_snapshot}</strong>
        <span className="progress-card-footer">
          <span className={`progress-card-stage ${stageToneClass}`}>{stageLabel}</span>
        </span>
      </button>
      <div
        ref={menuRef}
        className="progress-card-menu"
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          ref={menuTriggerRef}
          className="progress-card-menu-trigger"
          type="button"
          aria-label={`更多求职操作 ${item.company_name_snapshot} ${item.job_title_snapshot}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={`progress-card-menu-${item.id}`}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          <MoreHorizontal size={17} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div
            id={`progress-card-menu-${item.id}`}
            className="progress-card-menu-panel"
            role="menu"
            aria-label={`${item.company_name_snapshot} ${item.job_title_snapshot} 操作菜单`}
            onKeyDown={handleMenuKeyDown}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => runMenuAction(onOpen)}
            >
              <Eye size={15} aria-hidden="true" />查看详情
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!advanceAction.enabled || isAdvancing}
              onClick={() => runMenuAction(() => {
                if (!advanceAction.enabled || !advanceAction.prefill) {
                  if (progressColumnKey(item) === "pending") onRequestMarkApplied?.(item);
                  return;
                }
                onRequestNextStage?.(item, advanceAction.prefill);
              })}
            >
              <ArrowRight size={15} aria-hidden="true" />推进流程
            </button>
            {item.status === "active" && item.archived_at === null && item.offer_status === "none" && (
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                disabled={isAdvancing}
                onClick={() => runMenuAction(() => onRequestTerminate?.(item))}
              >
                <Ban size={15} aria-hidden="true" />终止求职
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
