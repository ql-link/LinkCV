import { useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { ApiRequestError, api, type JobApplicationSummary } from "@/api/client";
import { careerApplicationPath, navigateTo } from "../../routing";
import {
  APPLICATION_PROGRESS_COLUMNS,
  applicationProgressToneClass as projectApplicationProgressToneClass,
  applicationStatusLabel as projectApplicationStatusLabel,
  isApplicationDraggable,
  projectApplicationProgress,
  type ApplicationProgressColumnKey,
} from "./applicationProgress";

export type ProgressColumnKey = ApplicationProgressColumnKey;

export const PROGRESS_COLUMNS = APPLICATION_PROGRESS_COLUMNS;

export function progressColumnKey(application: JobApplicationSummary): ProgressColumnKey {
  return projectApplicationProgress(application).columnKey;
}

function canDropApplication(
  application: JobApplicationSummary,
  target: ProgressColumnKey,
): boolean {
  return isApplicationDraggable(application)
    && progressColumnKey(application) !== target
    && target === "interview";
}

export function interviewRoundLabel(roundNo: number): string {
  if (roundNo === 1) return "一面";
  if (roundNo === 2) return "二面";
  return `第 ${roundNo} 轮`;
}

export function applicationStatusLabel(application: JobApplicationSummary): string {
  return projectApplicationStatusLabel(application);
}

export function applicationProgressToneClass(application: JobApplicationSummary): string {
  return projectApplicationProgressToneClass(application);
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

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "全职",
  part_time: "兼职",
  internship: "实习",
  contract: "合同",
  temporary: "临时",
};

export function applicationEmploymentTypeLabel(application: JobApplicationSummary): string | null {
  const employmentType = application.job_snapshot.employment_type;
  if (typeof employmentType !== "string") return null;
  const label = EMPLOYMENT_TYPE_LABELS[employmentType];
  return typeof label === "string" ? label : null;
}

export function applicationCardStageLabel(
  application: JobApplicationSummary,
  columnKey: ProgressColumnKey,
): string {
  const projection = projectApplicationProgress(application);
  if (columnKey === "ended") return projection.statusLabel;
  if (columnKey === "waiting") return `${projection.stageLabel} · ${projection.statusLabel}`;
  if (projection.supportingLabel) {
    return `${projection.stageLabel} · ${projection.supportingLabel}`;
  }
  const detail = application.next_session_start_at
    ? formatApplicationListDateTime(application.next_session_start_at)
    : projection.statusLabel;
  return `${projection.stageLabel} · ${detail}`;
}

export function formatApplicationListDateTime(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function ApplicationsBoard({
  visibleApplications,
  displayMode,
  onChanged,
  onNotice,
}: {
  visibleApplications: JobApplicationSummary[];
  displayMode: "board" | "list";
  onChanged: () => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  return (
    displayMode === "board" && visibleApplications.length > 0 ? (
      <ProgressBoard
        applications={visibleApplications}
        onChanged={onChanged}
        onNotice={onNotice}
      />
    ) : null
  );
}

export function ProgressBoard({
  applications,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  onChanged: () => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ProgressColumnKey | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; source: ProgressColumnKey } | null>(null);
  const suppressCardClickRef = useRef(false);
  const columns = useMemo(
    () => PROGRESS_COLUMNS.map((column) => ({
      ...column,
      items: applications.filter((item) => progressColumnKey(item) === column.key),
    })),
    [applications],
  );

  const clearDrag = () => {
    dragRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleDragStart = (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => {
    if (!isApplicationDraggable(item) || advancingId !== null) {
      event.preventDefault();
      return;
    }
    const source = progressColumnKey(item);
    dragRef.current = { id: item.id, source };
    suppressCardClickRef.current = true;
    setDraggingId(item.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    }
  };

  const handleDrop = async (target: ProgressColumnKey, event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    const draggedId = event.dataTransfer?.getData("text/plain") || dragRef.current?.id;
    const drag = dragRef.current;
    clearDrag();
    if (!draggedId || !drag) return;
    const application = applications.find((item) => item.id === draggedId);
    if (!application || !canDropApplication(application, target)) return;
    const transition = {
      target_stage_type: "interview" as const,
      target_round_no: 1,
      target_stage_label: "一面",
    };
    setAdvancingId(application.id);
    try {
      await api.advanceJobApplication(application.id, {
        ...transition,
        base_lock_version: application.lock_version,
      });
      await onChanged();
    } catch (error) {
      onNotice(applicationTransitionError(error));
      await onChanged();
    } finally {
      setAdvancingId(null);
    }
  };

  const draggingApplication = draggingId
    ? applications.find((item) => item.id === draggingId) ?? null
    : null;

  return (
    <section className="interview-surface career-applications-board" aria-label="求职进程看板">
      <div className="progress-board-grid">
        {columns.map((column) => (
          <ProgressColumn
            key={column.key}
            column={column}
            draggingId={draggingId}
            dropTarget={dropTarget}
            advancingId={advancingId}
            canAcceptDrop={Boolean(draggingApplication && canDropApplication(draggingApplication, column.key))}
            onDragStart={handleDragStart}
            onDragEnd={() => {
              clearDrag();
              window.setTimeout(() => {
                suppressCardClickRef.current = false;
              }, 0);
            }}
            onDragOver={(event) => {
              if (!draggingApplication || !canDropApplication(draggingApplication, column.key)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget(column.key);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDropTarget(null);
            }}
            onDrop={(event) => void handleDrop(column.key, event)}
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
  dropTarget,
  advancingId,
  canAcceptDrop,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
}: {
  column: { key: ProgressColumnKey; label: string; items: JobApplicationSummary[] };
  draggingId: string | null;
  dropTarget: ProgressColumnKey | null;
  advancingId: string | null;
  canAcceptDrop: boolean;
  onDragStart: (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onOpen: (item: JobApplicationSummary) => void;
}) {
  return (
    <div
      className={`progress-column${canAcceptDrop ? " is-valid-drop-target" : ""}${dropTarget === column.key ? " is-drop-target" : ""}`}
      data-column-key={column.key}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="progress-column-heading">
        <h3><span className="progress-column-label">{column.label}</span><span className="progress-column-count">{column.items.length}</span></h3>
      </header>
      <div className="progress-column-cards">
        {column.items.map((item) => (
          <ProgressCard
            key={item.id}
            item={item}
            columnKey={column.key}
            isDragging={draggingId === item.id}
            isAdvancing={advancingId === item.id}
            draggable={isApplicationDraggable(item) && advancingId !== item.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onOpen={() => onOpen(item)}
          />
        ))}
        {!column.items.length && <p className="pipeline-empty">暂无进程</p>}
      </div>
    </div>
  );
}

export function ProgressCard({
  item,
  columnKey,
  isDragging,
  isAdvancing,
  draggable,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  item: JobApplicationSummary;
  columnKey: ProgressColumnKey;
  isDragging: boolean;
  isAdvancing: boolean;
  draggable: boolean;
  onDragStart: (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const employmentTypeLabel = applicationEmploymentTypeLabel(item);
  const stageLabel = applicationCardStageLabel(item, columnKey);
  const stageToneClass = applicationProgressToneClass(item);
  return (
    <article
      className={`progress-card${draggable ? " is-draggable" : ""}${isDragging ? " is-dragging" : ""}${isAdvancing ? " is-advancing" : ""}`}
      aria-label={`${item.company_name_snapshot} ${item.job_title_snapshot}`}
      aria-grabbed={draggable ? isDragging : undefined}
      aria-busy={isAdvancing || undefined}
      draggable={draggable}
      onDragStart={(event) => onDragStart(item, event)}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="progress-card-open" aria-label={`查看 ${item.company_name_snapshot} ${item.job_title_snapshot} 求职进程`} onClick={onOpen}>
        <span className="progress-card-company-row">
          <strong className="progress-card-company" title={item.company_name_snapshot}>{item.company_name_snapshot}</strong>
          {employmentTypeLabel && <span className="progress-card-employment-type">{employmentTypeLabel}</span>}
        </span>
        <strong className="progress-card-job-title" title={item.job_title_snapshot}>{item.job_title_snapshot}</strong>
        <span className="progress-card-footer">
          <span className={`progress-card-stage ${stageToneClass}`}>{stageLabel}</span>
          <time className="progress-card-updated-at" dateTime={item.updated_at}>{formatApplicationUpdatedAt(item.updated_at)}</time>
        </span>
      </button>
    </article>
  );
}

function applicationTransitionError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INTERVIEW_INVALID_TRANSITION: "当前求职进度不允许执行这个操作。",
      INTERVIEW_EDIT_CONFLICT: "这条求职进程已在其他页面更新，请刷新后再试。",
    };
    return messages[error.message] ?? `操作失败：${error.message}`;
  }
  return "操作失败，请稍后重试。";
}
