import { useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trophy,
  Bell,
} from "lucide-react";
import { ApiRequestError, api, type InterviewCalendarColor, type JobApplicationSummary } from "@/api/client";
import { careerApplicationPath, navigateTo } from "../../routing";

export type ProgressColumnKey = "pending" | "interview" | "hr" | "offer" | "ended";

export type ProgressSummaryMetrics = {
  active: number;
  weekly: number;
  followUp: number;
  offers: number;
};

export const PROGRESS_COLUMNS: Array<{ key: ProgressColumnKey; label: string }> = [
  { key: "pending", label: "待推进" },
  { key: "interview", label: "面试中" },
  { key: "hr", label: "HR 面" },
  { key: "offer", label: "Offer" },
  { key: "ended", label: "已结束" },
];

export function progressColumnKey(application: JobApplicationSummary): ProgressColumnKey {
  if (application.archived_at || application.status !== "active") return "ended";
  if (application.current_stage_type === "screening") return "pending";
  if (application.current_stage_type === "interview") return "interview";
  if (application.current_stage_type === "hr") return "hr";
  return "offer";
}

function isApplicationDraggable(application: JobApplicationSummary): boolean {
  return application.status === "active"
    && application.archived_at === null
    && application.current_stage_type !== "offer";
}

function canDropApplication(
  application: JobApplicationSummary,
  target: ProgressColumnKey,
): boolean {
  if (!isApplicationDraggable(application)) return false;
  const source = progressColumnKey(application);
  if (source === target || target === "pending" || target === "ended") return false;
  const stageOrder: Record<Exclude<ProgressColumnKey, "ended">, number> = {
    pending: 0,
    interview: 1,
    hr: 2,
    offer: 3,
  };
  return stageOrder[target] > stageOrder[source as Exclude<ProgressColumnKey, "ended">];
}

export function interviewRoundLabel(roundNo: number): string {
  if (roundNo === 1) return "一面";
  if (roundNo === 2) return "二面";
  return `第 ${roundNo} 轮`;
}

export function applicationStatusLabel(application: JobApplicationSummary): string {
  if (application.archived_at) return "已归档";
  if (application.status === "rejected") return "未通过";
  if (application.status === "withdrawn") return "已主动结束";
  if (application.status === "closed") return application.offer_status === "accepted" ? "已接受 Offer" : "已结束";
  return application.stage_state === "awaiting_schedule"
    ? "等待安排"
    : application.stage_state === "awaiting_result"
      ? "等待结果"
      : application.stage_state === "negotiating"
        ? "Offer 沟通中"
        : "进行中";
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

export function ApplicationsBoard({
  visibleApplications,
  displayMode,
  metrics,
  onCreate,
  onChanged,
  onNotice,
}: {
  visibleApplications: JobApplicationSummary[];
  displayMode: "board" | "list";
  metrics: ProgressSummaryMetrics;
  onCreate: () => void;
  onChanged: () => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  return (
    <>
      <ProgressSummaryBar metrics={metrics} />
      {displayMode === "board" && visibleApplications.length > 0 && (
        <ProgressBoard
          applications={visibleApplications}
          onCreate={onCreate}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

export function ProgressSummaryBar({
  metrics,
}: {
  metrics: ProgressSummaryMetrics;
}) {
  const entries = [
    {
      icon: <BriefcaseBusiness />,
      tone: "blue",
      label: "进行中的进程",
      value: metrics.active,
      hint: "当前全部进程",
    },
    {
      icon: <CalendarDays />,
      tone: "orange",
      label: "本周待面试",
      value: metrics.weekly,
      hint: "已安排场次",
    },
    {
      icon: <Bell />,
      tone: "purple",
      label: "待跟进",
      value: metrics.followUp,
      hint: "需要及时跟进",
    },
    {
      icon: <Trophy />,
      tone: "green",
      label: "已拿 Offer",
      value: metrics.offers,
      hint: "书面 Offer",
    },
  ];
  return (
    <section className="career-application-summary-bar" aria-label="求职进程数据概览">
      {entries.map((entry, index) => (
        <article key={entry.label} className={index > 0 ? "has-divider" : undefined}>
          <span className={`career-summary-icon tone-${entry.tone}`} aria-hidden="true">{entry.icon}</span>
          <div>
            <small>{entry.label}</small>
            <strong>{entry.value}</strong>
            <p>{entry.hint}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

export function ProgressBoard({
  applications,
  onCreate,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  onCreate: () => void;
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
    const transition = target === "interview"
      ? { target_stage_type: "interview" as const, target_round_no: 1, target_stage_label: "一面" }
      : target === "hr"
        ? { target_stage_type: "hr" as const, target_round_no: null, target_stage_label: "HR 面" }
        : { target_stage_type: "offer" as const, target_round_no: null, target_stage_label: "Offer" };
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
            onCreate={onCreate}
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
  onCreate,
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
  onCreate: () => void;
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
        <h3>{column.label}<span>{column.items.length}</span></h3>
        <div>
          <button type="button" aria-label={`在${column.label}中新建求职进程`} onClick={onCreate}><Plus /></button>
          <MoreHorizontal aria-hidden="true" />
        </div>
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
      <AddProgressAction onClick={onCreate} />
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
  const timeLabel = item.next_session_start_at
    ? `下次：${formatApplicationDateTime(item.next_session_start_at)}`
    : item.applied_at
      ? `投递 ${formatApplicationDate(item.applied_at)}`
      : "暂未排期";
  const content = (
    <>
      <CompanyLogo item={{ company: item.company_name_snapshot, logo: item.company_name_snapshot.slice(0, 1), color: item.calendar_color }} />
      <span className="progress-card-copy">
        <strong title={item.company_name_snapshot}>{item.company_name_snapshot}</strong>
        <small title={item.job_title_snapshot}>{item.job_title_snapshot}</small>
      </span>
    </>
  );
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
      <div className="progress-card-main-row">
        <button type="button" className="progress-card-open" aria-label={`查看 ${item.company_name_snapshot} ${item.job_title_snapshot} 求职进程`} onClick={onOpen}>{content}</button>
        <StageBadge item={item} columnKey={columnKey} />
        <span className="progress-card-actions" aria-hidden="true"><GripVertical /><MoreHorizontal /></span>
      </div>
      <div className="progress-card-meta">
        <time className="progress-card-time">{timeLabel}</time>
        <span className="progress-card-status">{applicationStatusLabel(item)}</span>
      </div>
    </article>
  );
}

export function StageBadge({ item, columnKey }: { item: JobApplicationSummary; columnKey: ProgressColumnKey }) {
  const interviewLabel = item.current_stage_label && item.current_stage_label !== "已结束"
    ? item.current_stage_label
    : interviewRoundLabel(item.current_round_no ?? 1);
  const label = columnKey === "pending"
    ? "待推进"
    : columnKey === "interview"
      ? interviewLabel
      : columnKey === "hr"
        ? "HR 面"
        : columnKey === "offer"
          ? "Offer"
          : "已结束";
  const tone = columnKey === "pending" || columnKey === "ended"
    ? "muted"
    : columnKey === "interview"
      ? (item.current_round_no ?? 1) <= 1 ? "blue" : "purple"
      : columnKey === "hr" ? "hr" : "offer";
  return <span className={`stage-badge stage-badge-${tone}`}>{label}</span>;
}

export function AddProgressAction({ onClick }: { onClick: () => void }) {
  return <button type="button" className="career-pipeline-add" onClick={onClick}><Plus />添加进程</button>;
}

function CompanyLogo({ item }: { item: { company: string; logo: string; color: InterviewCalendarColor } }) {
  return <span className={`company-logo calendar-${item.color}`} aria-hidden="true">{item.logo}</span>;
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
