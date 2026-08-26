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
import { ApiRequestError, api, type ApplicationStageType, type InterviewCalendarColor, type JobApplicationSummary } from "@/api/client";
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

export function createCareerApplicationsMock(): JobApplicationSummary[] {
  const now = new Date();
  const dateAt = (days: number, hour = 10) => {
    const value = new Date(now);
    value.setDate(value.getDate() + days);
    value.setHours(hour, 0, 0, 0);
    return value.toISOString();
  };
  const build = (
    id: string,
    company: string,
    role: string,
    stageType: ApplicationStageType,
    stageLabel: string,
    color: InterviewCalendarColor,
    overrides: Partial<JobApplicationSummary> = {},
  ): JobApplicationSummary => ({
    id: `mock-application-${id}`,
    job_description_id: null,
    resume_version_id: null,
    company_name_snapshot: company,
    job_title_snapshot: role,
    job_snapshot: {},
    resume_title_snapshot: `简历 v2.${Number(id) % 3}`,
    calendar_color: color,
    current_stage_type: stageType,
    current_round_no: stageType === "interview" ? 1 : null,
    current_stage_label: stageLabel,
    stage_state: "awaiting_result",
    status: "active",
    offer_status: "none",
    is_favorite: false,
    applied_at: dateAt(-Number(id), 9),
    notes: null,
    archived_at: null,
    lock_version: 1,
    created_at: dateAt(-Number(id) - 2, 9),
    updated_at: dateAt(-Math.ceil(Number(id) / 4), 12),
    next_session_id: null,
    next_session_start_at: null,
    next_session_end_at: null,
    next_session_mode: null,
    ...overrides,
  });

  return [
    build("1", "百度", "算法工程师（NLP）", "screening", "筛选中", "blue"),
    build("2", "小米", "后端开发工程师", "screening", "筛选中", "orange"),
    build("3", "美团", "数据分析师", "screening", "筛选中", "yellow"),
    build("4", "小红书", "产品运营（社区）", "screening", "筛选中", "red"),
    build("5", "BOSS直聘", "商业产品经理", "screening", "筛选中", "green"),
    build("6", "腾讯", "产品经理（PCG）", "screening", "等待沟通", "blue", { stage_state: "awaiting_schedule" }),
    build("7", "字节跳动", "数据科学家", "screening", "等待沟通", "blue", { stage_state: "awaiting_schedule" }),
    build("8", "阿里云", "云计算研发工程师", "screening", "等待沟通", "orange", { stage_state: "awaiting_schedule" }),
    build("9", "腾讯", "前端开发工程师", "interview", "一面", "blue", { current_round_no: 1, stage_state: "scheduled", next_session_id: "mock-session-9", next_session_start_at: dateAt(1, 10), next_session_end_at: dateAt(1, 11), next_session_mode: "video" }),
    build("10", "字节跳动", "算法工程师", "interview", "一面", "blue", { current_round_no: 1, stage_state: "scheduled", next_session_id: "mock-session-10", next_session_start_at: dateAt(2, 14), next_session_end_at: dateAt(2, 15), next_session_mode: "video" }),
    build("11", "美团", "用户研究员", "interview", "一面", "yellow", { current_round_no: 1, stage_state: "scheduled", next_session_id: "mock-session-11", next_session_start_at: dateAt(3, 10), next_session_end_at: dateAt(3, 11), next_session_mode: "video" }),
    build("12", "小红书", "产品经理", "interview", "一面", "red", { current_round_no: 1, stage_state: "scheduled", next_session_id: "mock-session-12", next_session_start_at: dateAt(4, 15), next_session_end_at: dateAt(4, 16), next_session_mode: "onsite" }),
    build("13", "阿里云", "后端开发工程师", "interview", "二面", "orange", { current_round_no: 2, stage_state: "scheduled", next_session_id: "mock-session-13", next_session_start_at: dateAt(5, 14), next_session_end_at: dateAt(5, 15), next_session_mode: "video" }),
    build("14", "腾讯", "测试开发工程师", "interview", "二面", "blue", { current_round_no: 2, stage_state: "scheduled", next_session_id: "mock-session-14", next_session_start_at: dateAt(6, 10), next_session_end_at: dateAt(6, 11), next_session_mode: "video" }),
    build("15", "字节跳动", "运营经理（商业化）", "hr", "HR 面", "blue", { stage_state: "scheduled", next_session_id: "mock-session-15", next_session_start_at: dateAt(7, 16), next_session_end_at: dateAt(7, 17), next_session_mode: "video" }),
    build("16", "美团", "数据分析师", "offer", "Offer", "yellow", { stage_state: "negotiating", offer_status: "written_offer_received" }),
    build("17", "阿里云", "云计算研发工程师", "offer", "Offer", "orange", { stage_state: "negotiating", offer_status: "written_offer_received" }),
    build("18", "小米", "算法工程师", "interview", "已结束", "orange", { status: "withdrawn", current_round_no: 1, stage_state: "awaiting_result" }),
    build("19", "百度", "后端开发工程师", "interview", "已结束", "blue", { status: "rejected", current_round_no: 2, stage_state: "awaiting_result", resume_title_snapshot: "简历 v1.9" }),
  ];
}

export function ApplicationsBoard({
  visibleApplications,
  displayMode,
  isUsingMock,
  metrics,
  onCreate,
  onChanged,
  onNotice,
}: {
  visibleApplications: JobApplicationSummary[];
  displayMode: "board" | "list";
  isUsingMock: boolean;
  metrics: ProgressSummaryMetrics;
  onCreate: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  return (
    <>
      <ProgressSummaryBar metrics={metrics} isUsingMock={isUsingMock} />
      {displayMode === "board" && visibleApplications.length > 0 && (
        <ProgressBoard
          applications={visibleApplications}
          isUsingMock={isUsingMock}
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
  isUsingMock,
}: {
  metrics: ProgressSummaryMetrics;
  isUsingMock: boolean;
}) {
  const entries = [
    {
      icon: <BriefcaseBusiness />,
      tone: "blue",
      label: "进行中的进程",
      value: metrics.active,
      change: isUsingMock ? "+2" : undefined,
      hint: isUsingMock ? undefined : "当前全部进程",
    },
    {
      icon: <CalendarDays />,
      tone: "orange",
      label: "本周待面试",
      value: metrics.weekly,
      change: isUsingMock ? "+1" : undefined,
      hint: isUsingMock ? undefined : "已安排场次",
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
      change: isUsingMock ? "+1" : undefined,
      hint: isUsingMock ? undefined : "书面 Offer",
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
            <p>{entry.change && <>较上周 <b>{entry.change}</b></>}{entry.hint}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

export function ProgressBoard({
  applications,
  isUsingMock,
  onCreate,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  isUsingMock: boolean;
  onCreate: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ProgressColumnKey | null>(null);
  const dragRef = useRef<{ id: string; source: ProgressColumnKey } | null>(null);
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
    const source = progressColumnKey(item);
    dragRef.current = { id: item.id, source };
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
    if (!application) return;
    if (isUsingMock) {
      onNotice("展示数据仅用于演示，拖动不会写入求职进程。");
      return;
    }
    if (target === drag.source) return;
    if (target === "ended") {
      onNotice("结束结果需要进入求职进程详情选择，拖动不会替你决定未通过或主动结束。");
      return;
    }
    if (target === "pending") {
      onNotice("求职进程不支持逆向拖回待推进，请在详情中继续处理。");
      return;
    }
    if (drag.source === "ended") {
      onNotice("已结束的求职进程不能拖回活动阶段，请在详情中查看历史记录。");
      return;
    }
    const stageOrder: Record<Exclude<ProgressColumnKey, "ended">, number> = {
      pending: 0,
      interview: 1,
      hr: 2,
      offer: 3,
    };
    if (stageOrder[target] <= stageOrder[drag.source as Exclude<ProgressColumnKey, "ended">]) {
      onNotice("求职进程不支持逆向拖动，请在详情中继续处理。");
      return;
    }
    const transition = target === "interview"
      ? { target_stage_type: "interview" as const, target_round_no: 1, target_stage_label: "一面" }
      : target === "hr"
        ? { target_stage_type: "hr" as const, target_round_no: null, target_stage_label: "HR 面" }
        : { target_stage_type: "offer" as const, target_round_no: null, target_stage_label: "Offer" };
    try {
      await api.advanceJobApplication(application.id, {
        ...transition,
        base_lock_version: application.lock_version,
      });
      onChanged();
    } catch (error) {
      onNotice(applicationTransitionError(error));
    }
  };

  return (
    <section className="interview-surface career-applications-board" aria-label="求职进程看板">
      <div className="progress-board-grid">
        {columns.map((column) => (
          <ProgressColumn
            key={column.key}
            column={column}
            draggingId={draggingId}
            dropTarget={dropTarget}
            onCreate={onCreate}
            onDragStart={handleDragStart}
            onDragEnd={clearDrag}
            onDragOver={(event) => {
              event.preventDefault();
              if (draggingId) setDropTarget(column.key);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDropTarget(null);
            }}
            onDrop={(event) => void handleDrop(column.key, event)}
            isUsingMock={isUsingMock}
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
  onCreate,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isUsingMock,
}: {
  column: { key: ProgressColumnKey; label: string; items: JobApplicationSummary[] };
  draggingId: string | null;
  dropTarget: ProgressColumnKey | null;
  onCreate: () => void;
  onDragStart: (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  isUsingMock: boolean;
}) {
  return (
    <div
      className={`progress-column ${dropTarget === column.key ? "is-drop-target" : ""}`}
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
            isUsingMock={isUsingMock}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
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
  isUsingMock,
  onDragStart,
  onDragEnd,
}: {
  item: JobApplicationSummary;
  columnKey: ProgressColumnKey;
  isDragging: boolean;
  isUsingMock: boolean;
  onDragStart: (item: JobApplicationSummary, event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const timeLabel = item.next_session_start_at
    ? `下次：${formatApplicationDateTime(item.next_session_start_at)}`
    : item.applied_at
      ? `投递 ${formatApplicationDate(item.applied_at)}`
      : "暂未排期";
  const open = !isUsingMock ? () => navigateTo(careerApplicationPath(item.id)) : undefined;
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
      className={`progress-card ${isDragging ? "is-dragging" : ""}`}
      aria-label={`${item.company_name_snapshot} ${item.job_title_snapshot}`}
      draggable
      onDragStart={(event) => onDragStart(item, event)}
      onDragEnd={onDragEnd}
    >
      <div className="progress-card-main-row">
        {open ? <button type="button" className="progress-card-open" aria-label={`查看 ${item.company_name_snapshot} ${item.job_title_snapshot} 求职进程`} onClick={open}>{content}</button> : <div className="progress-card-open is-static">{content}</div>}
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
