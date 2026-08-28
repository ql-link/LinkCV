import type { AnchorHTMLAttributes } from "react";
import type { JobApplicationSummary } from "@/api/client";
import { careerApplicationPath, navigateTo } from "../../routing";

export type ProgressColumnKey =
  | "pending"
  | "screening"
  | "assessment"
  | "interview"
  | "waiting"
  | "ended";

export const PROGRESS_COLUMNS: Array<{ key: ProgressColumnKey; label: string }> = [
  { key: "pending", label: "待投递" },
  { key: "screening", label: "筛选中" },
  { key: "assessment", label: "测评中" },
  { key: "interview", label: "面试中" },
  { key: "waiting", label: "等待通知" },
  { key: "ended", label: "已结束" },
];

export function progressColumnKey(application: JobApplicationSummary): ProgressColumnKey {
  if (application.archived_at || application.status !== "active") return "ended";
  if (!application.applied_at) return "pending";
  if (application.stage_state === "awaiting_result") return "waiting";
  if (application.current_stage_type === "screening") {
    return /笔试|测评|assessment|test/i.test(application.current_stage_label)
      ? "assessment"
      : "screening";
  }
  return "interview";
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
}: {
  visibleApplications: JobApplicationSummary[];
  displayMode: "board" | "list";
}) {
  if (displayMode !== "board") return null;

  const columns = PROGRESS_COLUMNS.map((column) => ({
    ...column,
    items: visibleApplications.filter((item) => progressColumnKey(item) === column.key),
  }));

  return (
    <section className="interview-surface career-applications-board" aria-label="求职阶段看板">
      <div className="progress-board-scroll">
        <div className="progress-board-grid">
          {columns.map((column) => (
            <ProgressColumn key={column.key} column={column} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProgressColumn({
  column,
}: {
  column: { key: ProgressColumnKey; label: string; items: JobApplicationSummary[] };
}) {
  return (
    <section className="progress-column" data-column-key={column.key} aria-labelledby={`progress-column-${column.key}`}>
      <header className="progress-column-heading">
        <h2 id={`progress-column-${column.key}`}>
          {column.label}
          <span>{column.items.length}</span>
        </h2>
      </header>
      <div className="progress-column-cards">
        {column.items.map((item) => (
          <ProgressCard key={item.id} item={item} columnKey={column.key} />
        ))}
        {!column.items.length && <p className="pipeline-empty">暂无记录</p>}
      </div>
    </section>
  );
}

export function ProgressCard({
  item,
  columnKey,
}: {
  item: JobApplicationSummary;
  columnKey: ProgressColumnKey;
}) {
  const company = item.company_name_snapshot.trim() || "未记录公司";
  const role = item.job_title_snapshot.trim() || "未记录岗位";
  const currentStage = item.current_stage_label.trim() || "—";
  const updatedAt = item.updated_at ? formatApplicationDate(item.updated_at) : "—";
  const href = careerApplicationPath(item.id);
  return (
    <OverviewApplicationLink href={href} aria-label={`查看 ${company} ${role} 求职记录`}>
      <span className={`company-logo calendar-${item.calendar_color}`} aria-hidden="true">
        {[...company][0] ?? "?"}
      </span>
      <span className="progress-card-copy">
        <strong title={company}>{company}</strong>
        <small title={role}>{role}</small>
      </span>
      <StageBadge item={item} columnKey={columnKey} />
      <span className="progress-card-status" title={applicationStatusLabel(item)}>
        {applicationStatusLabel(item)}
      </span>
      <time className="progress-card-time" dateTime={item.updated_at || undefined}>
        {updatedAt}
      </time>
    </OverviewApplicationLink>
  );
}

export function StageBadge({
  item,
  columnKey,
}: {
  item: JobApplicationSummary;
  columnKey: ProgressColumnKey;
}) {
  const label = columnKey === "pending"
    ? "待投递"
    : columnKey === "screening"
      ? "筛选中"
      : columnKey === "assessment"
        ? "测评中"
        : columnKey === "interview"
          ? item.current_stage_label.trim() || "面试中"
          : columnKey === "waiting"
            ? "等待通知"
            : applicationStatusLabel(item);
  return <span className={`stage-badge stage-badge-${columnKey}`}>{label}</span>;
}

function OverviewApplicationLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...props}
      className="progress-card"
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
      <span className="progress-card-arrow" aria-hidden="true">→</span>
    </a>
  );
}
