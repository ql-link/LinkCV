import { t, useLocale, weekdayName, weekdays } from "@/i18n";
import { MotionPresence, MotionSurface } from "@/components/ui/motion";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ReviewV3Content } from "./CareerDetailV3";
import { ApplicationProgressPage } from "./ApplicationProgressPage";
import { buildApplicationDetail, effectiveSessionStatus, type DetailAction } from "./applicationDetailModel";
import { PrepChecklistCard } from "./PrepChecklistCard";
import { Dialog as V3Dialog, Select as V3Select } from "@/v3/primitives";
import { Badge, Centered, DashArrow, MiniResume, TagCard } from "@/v3/art";
import { Icon as V3Icon, type V3IconName } from "@/v3/Icon";
import {
  Archive,
  Banknote,
  Ban,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ClipboardCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Crown,
  Download,
  ExternalLink,
  FileAudio,
  FilePlus2,
  FilePenLine,
  FileText,
  FolderOpen,
  Import,
  Info,
  ListFilter,
  MapPin,
  Mail,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Send,
  Sparkles,
  Trash2,
  Users,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  ApiRequestError,
  api,
  type DatasetRecord,
  type InterviewAssetRecord,
  type InterviewSessionDetail,
  type InterviewSessionRecord,
  type InterviewSessionSummary,
  type ApplicationStageType,
  type JobApplicationRecord,
  type JobApplicationSummary,
  type SalaryPeriod,
} from "@/api/client";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FeedbackNotice,
  Label,
  PageLoading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui";
import { SelectValue } from "@/components/ui/select";
import { careerApplicationPath, jobDetailPath, navigateTo } from "../../routing";
import { formatApplicationListDateTime, type NextStageDialogTab } from "./ApplicationsBoard";
export type { NextStageDialogTab } from "./ApplicationsBoard";
import {
  applicationStageMatchesSession,
  applicationDetailStatusToneClass,
  defaultNextStage,
  normalizeApplicationStageLabel,
  offerStatusLabel,
  projectApplicationProgress,
} from "./applicationProgress";

type ApplicationStageSource = Pick<
  JobApplicationRecord,
  | "id"
  | "current_stage_type"
  | "current_round_no"
  | "current_stage_label"
  | "stage_state"
  | "status"
  | "offer_status"
  | "archived_at"
  | "applied_at"
  | "lock_version"
  | "phase"
  | "lifecycle_status"
  | "current_stage"
>;

type JourneyStage = {
  key: string;
  label: string;
  meta: string;
  state: "done" | "current" | "pending" | "waiting" | "cancelled" | "ended" | "offer";
};

export function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INTERVIEW_EDIT_CONFLICT: t("这条面试已在其他页面更新，请刷新后再试。"),
      INTERVIEW_INVALID_TRANSITION: t("当前求职进度不允许执行这个操作。"),
      INTERVIEW_RESUME_VERSION_REQUIRED: t("所选简历暂无正式版本，请先保存正式版本。"),
      INVALID_INTERVIEW_TIME: t("面试开始时间需要是有效的 24 小时制 HH:mm（分钟 00–59）。"),
      INTERVIEW_ASSET_TOO_LARGE: t("素材超过 500 MiB，请压缩后重试。"),
      UNSUPPORTED_INTERVIEW_ASSET: t("暂不支持这种素材格式。"),
      INTERVIEW_APPLICATION_NOT_EMPTY: t("请先清理该求职进程下的面试记录。"),
      INTERVIEW_APPLICATION_DELETE_FAILED: t("岗位关联数据清理失败，请稍后重试。"),
      INTERVIEW_SESSION_NOT_EMPTY: t("请先删除这场面试关联的素材。"),
      INTERVIEW_ANSWER_PLAN_NOT_SUPPORTED: t("这条安排不支持设置作答计划。"),
      INTERVIEW_ANSWER_PLAN_INVALID_TIME: t("作答计划时间无效，请重新选择。"),
      INTERVIEW_ANSWER_PLAN_OUTSIDE_WINDOW: t("作答计划必须完整落在官方作答时段内。"),
    };
    return messages[error.message] ?? t("操作失败：{value0}", { value0: error.message });
  }
  return t("操作失败，请稍后重试。");
}

function formatFullDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return t("{value0}年{value1}月{value2}日", { value0: date.getFullYear(), value1: date.getMonth() + 1, value2: date.getDate() });
}

function formatFullDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatFullDate(value)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sameLocalDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatLocalTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function formatFullDateTimeRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
  return sameLocalDate(start, end)
    ? `${formatFullDateTime(startAt)}–${formatLocalTime(end)}`
    : `${formatFullDateTime(startAt)}–${formatFullDateTime(endAt)}`;
}

function formatApplicationDateTimeRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
  return sameLocalDate(start, end)
    ? `${formatApplicationListDateTime(startAt)}–${formatLocalTime(end)}`
    : `${formatApplicationListDateTime(startAt)}–${formatApplicationListDateTime(endAt)}`;
}

function formatUpdatedDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay(date, now)) return t("今天 {value0}", { value0: time });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return t("昨天 {value0}", { value0: time });
  return formatFullDateTime(value);
}

function snapshotText(snapshot: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function snapshotList(snapshot: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = snapshot[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
    if (typeof value === "string" && value.trim()) {
      return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function employmentTypeLabel(value: unknown): string | null {
  const labels: Record<string, string> = {
    full_time: t("正式"),
    campus: t("校招"),
    internship: t("实习"),
  };
  return typeof value === "string" ? labels[value] ?? value : null;
}

function workModeLabel(value: unknown): string | null {
  const labels: Record<string, string> = {
    onsite: t("现场"),
    hybrid: t("混合"),
    remote: t("远程"),
  };
  return typeof value === "string" ? labels[value] ?? value : null;
}

function sessionStatusLabel(session: Pick<InterviewSessionRecord, "status" | "start_at" | "end_at">): string {
  if (session.status === "completed") return t("已完成");
  if (session.status === "cancelled") return t("已取消");
  const now = Date.now();
  if (new Date(session.start_at).getTime() <= now && new Date(session.end_at).getTime() > now) return t("进行中");
  return t("待进行");
}

function sessionStatusTone(session: Pick<InterviewSessionRecord, "status" | "start_at" | "end_at">): string {
  if (session.status === "completed") return "is-completed";
  if (session.status === "cancelled") return "is-cancelled";
  const now = Date.now();
  return new Date(session.start_at).getTime() <= now && new Date(session.end_at).getTime() > now
    ? "is-active"
    : "is-scheduled";
}

function sessionModeLabel(mode: InterviewSessionRecord["mode"]): string {
  return mode === "video"
    ? t("线上")
    : mode === "onsite"
      ? t("现场")
      : mode === "phone"
        ? t("电话")
        : t("其他方式");
}

function sessionRecordKind(
  session: Pick<InterviewSessionRecord, "stage_type">,
): "笔试" | "面试" {
  return session.stage_type === "other" ? "笔试" : "面试";
}

function buildJourneyStages(
  application: JobApplicationSummary,
  sessions: InterviewSessionSummary[],
): JourneyStage[] {
  const projection = projectApplicationProgress(application);
  const currentStageLabel = application.current_stage_type === "offer"
    ? offerStatusLabel(application.offer_status)
    : projection.stageLabel;
  if (projection.isPending) {
    return [
      {
        key: "imported",
        label: t("岗位已导入"),
        meta: formatFullDate(application.created_at),
        state: "done",
      },
      {
        key: "pending",
        label: projection.stageLabel,
        meta: projection.supportingLabel ?? t("等待确认投递"),
        state: "current",
      },
    ];
  }
  const stages: JourneyStage[] = [
    {
      key: "imported",
      label: t("岗位已导入"),
      meta: formatFullDate(application.created_at),
      state: "done",
    },
  ];
  if (application.applied_at) {
    stages.push({
      key: "applied",
      label: t("已投递"),
      meta: formatFullDate(application.applied_at),
      state: "done",
    });
  }
  const sortedSessions = [...sessions]
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
  const currentSessionIds = new Set<string>();
  sortedSessions.forEach((session) => {
    const isCurrent = applicationStageMatchesSession(application, session);
    if (isCurrent) currentSessionIds.add(session.id);
    const sessionLabel = isCurrent && application.current_stage_type === "offer"
      ? offerStatusLabel(application.offer_status)
      : isCurrent && session.stage_type === "other" && application.current_stage_type === "screening"
        ? normalizeApplicationStageLabel(application)
        : session.stage_label;
    stages.push({
      key: `session:${session.id}`,
      label: sessionLabel,
      meta: formatFullDate(session.start_at),
      state: session.status === "cancelled"
        ? "cancelled"
        : session.status === "completed"
          ? "done"
          : isCurrent && projection.isWaiting
              ? "done"
              : isCurrent
                ? "current"
                : "pending",
    });
  });

  if (!currentSessionIds.size && projection.stageLabel) {
    stages.push({
      key: `stage:${application.current_stage_type}:${application.current_round_no ?? "none"}`,
      label: currentStageLabel,
      meta: formatFullDate(application.updated_at),
      state: projection.isWaiting ? "done" : "current",
    });
  }

  const receivedOffer = application.current_stage_type === "offer"
    && application.offer_status !== "none"
    && application.offer_status !== "declined";
  if (receivedOffer) {
    const current = stages.find((stage) => stage.state === "current" || stage.state === "waiting");
    if (current) current.state = "offer";
  }
  if (application.status !== "active" && application.offer_status !== "accepted") {
    const current = stages.find((stage) => stage.state === "current" || stage.state === "waiting");
    const offer = stages.find((stage) => stage.state === "offer");
    if (current) current.state = "ended";
    if (offer) offer.state = "ended";
  }
  return stages;
}

function JourneyProgress({ application, sessions }: { application: JobApplicationSummary; sessions: InterviewSessionSummary[] }) {
  useLocale();
  const stages = buildJourneyStages(application, sessions);
  const projection = projectApplicationProgress(application);
  const journeyLabel = projection.isPending || projection.isWaiting
    ? projection.primaryLabel
    : application.current_stage_type === "offer"
      ? offerStatusLabel(application.offer_status)
      : projection.stageLabel;
  return (
    <ol className="career-journey-progress" aria-label={t("当前阶段：{value0}", { value0: journeyLabel })}>
      {stages.map((stage, index) => (
        <li key={stage.key} className={`is-${stage.state}`}>
          {index > 0 && <span className="career-journey-connector" aria-hidden="true" />}
          <span className="career-journey-node" aria-hidden="true">
            {stage.state === "done"
              ? <Check />
              : stage.state === "ended"
                ? "!"
                : stage.state === "offer"
                  ? <Crown className="career-journey-crown" />
                  : ""}
          </span>
          <strong>{stage.label}</strong>
          <small>{stage.meta}</small>
        </li>
      ))}
    </ol>
  );
}

function OverviewLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  useLocale();
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
    </a>
  );
}

function JobSummaryCard({
  application,
  currentStageCompleted = false,
}: {
  application: JobApplicationSummary;
  currentStageCompleted?: boolean;
}) {
  useLocale();
  const progress = projectApplicationProgress(application);
  const statusLabel = currentStageCompleted ? t("已完成") : progress.statusLabel;
  const snapshot = application.job_snapshot ?? {};
  const skills = snapshotList(snapshot, "skills", "core_skills");
  const salary = snapshotText(snapshot, "salary_text", "salary") ?? "—";
  const city = snapshotText(snapshot, "work_city", "city", "location") ?? "—";
  const employment = employmentTypeLabel(snapshot.employment_type) ?? "—";
  const workMode = workModeLabel(snapshot.work_mode);
  const description = snapshotText(snapshot, "description", "job_description") ?? t("岗位描述暂未记录。");
  const sourceHref = application.job_description_id
    ? jobDetailPath(application.job_description_id, application.id)
    : null;
  return (
    <section className="career-detail-card career-job-summary-card">
      <header className="career-detail-card-header">
        <h2>{t("岗位与求职信息")}</h2>
        {sourceHref && <OverviewLink href={sourceHref}>{t("查看完整岗位 ")}<ChevronRight aria-hidden="true" /></OverviewLink>}
      </header>
      <div className="career-job-identity">
        <span className="career-job-company-name">{application.company_name_snapshot}</span>
        <span className="career-record-divider" aria-hidden="true" />
        <strong className="career-job-position-name">{application.job_title_snapshot}</strong>
      </div>
      <div className="career-job-facts">
        <Fact icon={<Banknote aria-hidden="true" />} label={t("薪资")} value={salary} />
        <Fact icon={<MapPin aria-hidden="true" />} label={t("工作地点")} value={city} />
        <Fact icon={<BriefcaseBusiness aria-hidden="true" />} label={t("岗位性质")} value={[employment, workMode].filter(Boolean).join(" · ") || "—"} />
      </div>
      <div className="career-job-copy career-job-overview">
        <h3>{t("岗位概览")}</h3>
        <p>{description}</p>
      </div>
      <div className="career-job-copy career-job-skills">
        <h3>{t("核心技能")}</h3>
        {skills.length ? <div className="career-job-tags">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : <p>{t("暂未记录")}</p>}
      </div>
      <div className="career-application-info-section">
        <h3>{t("求职信息")}</h3>
        <dl>
          <div><dt>{t("当前阶段")}</dt><dd>{progress.stageLabel}</dd></div>
          <div><dt>{t("当前状态")}</dt><dd>{statusLabel}{!currentStageCompleted && progress.supportingLabel && <small>{progress.supportingLabel}</small>}</dd></div>
          <div><dt>{application.applied_at ? t("投递时间") : t("导入时间")}</dt><dd>{formatFullDate(application.applied_at ?? application.created_at)}</dd></div>
          <div><dt>{t("投递简历版本")}</dt><dd>{application.resume_title_snapshot ?? t("未关联")}</dd></div>
          <div><dt>{t("最近更新")}</dt><dd>{formatUpdatedDateTime(application.updated_at)}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  useLocale();
  return <div><span className="career-job-fact-label">{icon}{label}</span><strong title={value}>{value}</strong></div>;
}

function InterviewRoundCard({ session, onOpen }: { session: InterviewSessionSummary; onOpen: () => void }) {
  useLocale();
  const hasQuestions = Boolean(session.questions_markdown?.trim());
  const status = sessionStatusLabel(session);
  const recordKind = sessionRecordKind(session);
  const RecordIcon = recordKind === "笔试" ? FileText : Video;
  return (
    <article className="career-interview-round-card">
      <span className="career-interview-round-icon" data-record-kind={recordKind} aria-hidden="true">
        <RecordIcon />
      </span>
      <header className="career-interview-round-heading">
        <div>
          <h3>{session.stage_label}</h3>
          <p>{formatApplicationDateTimeRange(session.start_at, session.end_at)} · {sessionModeLabel(session.mode)}</p>
        </div>
      </header>
      <div className="career-interview-round-record">
        <FileText aria-hidden="true" />
        <span>{hasQuestions ? t("已添加文字记录") : t("可上传音频或填写文字记录")}</span>
      </div>
      <span className={`career-session-status ${sessionStatusTone(session)}`}>{status}</span>
      <button type="button" className="career-round-open" onClick={onOpen}>
        <span>{t("查看")}{t(recordKind)}{t("记录")}</span>
        <ChevronRight aria-hidden="true" />
      </button>
    </article>
  );
}

function parseScheduleStart(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime())
    || date.getSeconds() !== 0
    || date.getMilliseconds() !== 0
  ) return null;
  return date;
}

type ScheduleDateTimeValue = {
  date: Date;
  time: string;
};

function parseScheduleTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour)
    || hour < 0
    || hour > 23
    || !Number.isInteger(minute)
    || minute < 0
    || minute > 59
  ) return null;
  return { hour, minute };
}

function parseScheduleDateTimeValue(value: string): ScheduleDateTimeValue | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match || !parseScheduleTime(match[2])) return null;
  const date = parseDatePickerValue(match[1]);
  return date ? { date, time: match[2] } : null;
}

function formatScheduleDateTimeValue(date: Date, time: string): string {
  return `${formatDatePickerValue(date)}T${time}`;
}

function formatScheduleDateTimeDisplay(
  date: Date | null,
  time: string,
): string {
  if (!date) return t("选择日期和时间");
  const dateValue = formatDatePickerValue(date);
  if (!time) return t("{value0} · 选择时间", { value0: dateValue });
  return `${dateValue} ${time}`;
}

function scheduleEndDate(date: Date | null, time: string, durationMinutes: number): Date | null {
  if (!date || !parseScheduleTime(time) || !Number.isInteger(durationMinutes) || durationMinutes <= 0) return null;
  const start = new Date(`${formatDatePickerValue(date)}T${time}`);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + durationMinutes * 60_000);
}

function formatScheduleDurationDisplay(date: Date | null, time: string, durationMinutes: number): string {
  const end = scheduleEndDate(date, time, durationMinutes);
  if (!date || !time || !end) return formatScheduleDateTimeDisplay(date, time);
  const startDisplay = formatScheduleDateTimeDisplay(date, time);
  return sameLocalDate(date, end)
    ? `${startDisplay}–${formatLocalTime(end)}`
    : `${startDisplay}–${formatScheduleDateTimeDisplay(end, formatLocalTime(end))}`;
}

function formatDurationMinutes(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  if (!hours) return t("{value0} 分钟", { value0: minutes });
  if (!minutes) return t("{value0} 小时", { value0: hours });
  return t("{value0} 小时 {value1} 分钟", { value0: hours, value1: minutes });
}

const SCHEDULE_PICKER_MAX_WIDTH = 600;
const SCHEDULE_PICKER_MAX_HEIGHT = 560;
const SCHEDULE_PICKER_VIEWPORT_GUTTER = 32;
const SCHEDULE_PICKER_GAP = 8;
const SCHEDULE_PICKER_DEFAULT_TIME = "09:00";
const SCHEDULE_PICKER_DURATIONS = [30, 45, 60, 90, 120];
const SCHEDULE_PICKER_COMMON_TIMES = ["10:00", "14:00", "15:30", "19:00"];
const SCHEDULE_PICKER_DEADLINE_TIME = "23:59";

function schedulePickerPosition(
  trigger: DOMRect,
  host: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
  renderedHeight = SCHEDULE_PICKER_MAX_HEIGHT,
): { left: number; top: number; width: number } {
  // 浮层挂在弹窗里，弹窗 overflow:hidden：左右都要收在弹窗内（各留 16px），否则右半边会被切掉
  const hostInset = 16;
  const pickerWidth = Math.min(
    SCHEDULE_PICKER_MAX_WIDTH,
    Math.max(0, viewportWidth - SCHEDULE_PICKER_VIEWPORT_GUTTER * 2),
    host.width > 0 ? Math.max(0, host.width - hostInset * 2) : Number.POSITIVE_INFINITY,
  );
  const maximumLeft = Math.max(
    SCHEDULE_PICKER_VIEWPORT_GUTTER,
    Math.min(
      viewportWidth - pickerWidth - SCHEDULE_PICKER_VIEWPORT_GUTTER,
      host.width > 0 ? host.right - pickerWidth - hostInset : Number.POSITIVE_INFINITY,
    ),
  );
  const boundedLeft = Math.min(
    Math.max(trigger.left, SCHEDULE_PICKER_VIEWPORT_GUTTER),
    maximumLeft,
  );
  const pickerHeight = Math.min(
    renderedHeight || SCHEDULE_PICKER_MAX_HEIGHT,
    Math.max(0, viewportHeight - SCHEDULE_PICKER_VIEWPORT_GUTTER * 2),
  );
  const belowTop = trigger.bottom + SCHEDULE_PICKER_GAP;
  const aboveTop = trigger.top - SCHEDULE_PICKER_GAP - pickerHeight;
  const boundedTop = belowTop + pickerHeight <= viewportHeight - SCHEDULE_PICKER_VIEWPORT_GUTTER
    ? belowTop
    : Math.max(SCHEDULE_PICKER_VIEWPORT_GUTTER, aboveTop);
  return {
    left: boundedLeft - host.left,
    top: boundedTop - host.top,
    width: pickerWidth,
  };
}

function SchedulePickerPortal({
  host,
  children,
}: {
  host: HTMLElement | null;
  children: ReactNode;
}) {
  useLocale();
  return host ? createPortal(children, host) : children;
}

/** 周一开头的月历格子，只排到本月最后一周。 */
function buildSchedulePickerDays(month: Date): Date[] {
  const firstDay = startOfDatePickerMonth(month);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((offset + daysInMonth) / 7);
  return Array.from({ length: rows * 7 }, (_, index) => new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - offset + index));
}

/** 允许直接键入 2359、930、9:30，统一成 HH:mm；无法识别时原样返回。 */
function normalizeScheduleTimeInput(value: string): string {
  const digits = /^(\d{3,4})$/.exec(value);
  if (digits) {
    const raw = digits[1].padStart(4, "0");
    return `${raw.slice(0, 2)}:${raw.slice(2)}`;
  }
  const short = /^(\d):(\d{2})$/.exec(value);
  return short ? `0${short[1]}:${short[2]}` : value;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

function formatSchedulePickerSummary(date: Date, time: string): string {
  const day = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${weekdayName(date)}`;
  return time ? `${day} ${time}` : t("{value0} · 选择时间", { value0: day });
}

function formatRemaining(target: Date, now: Date): string {
  const minutes = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return t("已过当前时间");
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return t("距现在 {value0} 天 {value1} 小时", { value0: days, value1: hours });
  if (hours) return t("距现在 {value0} 小时 {value1} 分钟", { value0: hours, value1: minutes % 60 });
  return t("距现在 {value0} 分钟", { value0: minutes });
}

export function ScheduleDateTimePicker({
  id,
  label,
  placeholder = "选择日期和时间",
  value,
  defaultDate,
  durationMinutes,
  minimumStartAt,
  maximumEndAt,
  required = false,
  disabled = false,
  onChange,
  onDurationMinutesChange,
}: {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  defaultDate?: string;
  durationMinutes?: number;
  minimumStartAt?: string;
  maximumEndAt?: string;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onDurationMinutesChange?: (value: number) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const fallbackDate = parseDatePickerValue(defaultDate ?? "");
  const [displayMonth, setDisplayMonth] = useState(() => startOfDatePickerMonth(parseScheduleDateTimeValue(value)?.date ?? fallbackDate ?? new Date()));
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [draftTimeInput, setDraftTimeInput] = useState("");
  const [draftDurationMinutes, setDraftDurationMinutes] = useState(durationMinutes ?? 60);
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  const [popoverHost, setPopoverHost] = useState<HTMLElement | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timeListRef = useRef<HTMLDivElement>(null);
  const selectedValue = parseScheduleDateTimeValue(value);
  const durationMode = durationMinutes !== undefined && onDurationMinutesChange !== undefined;
  const deadlineMode = !durationMode && label.includes(t("截止"));
  const calendarDays = useMemo(() => buildSchedulePickerDays(displayMonth), [displayMonth]);
  const monthLabel = formatDatePickerMonth(displayMonth);
  const selectedDuration = durationMinutes ?? 60;
  const draftTime = normalizeScheduleTimeInput(draftTimeInput);
  const displayedValue = open
    ? durationMode
      ? formatScheduleDurationDisplay(draftDate, draftTime, draftDurationMinutes)
      : formatScheduleDateTimeDisplay(draftDate, draftTime)
    : selectedValue
      ? durationMode
        ? formatScheduleDurationDisplay(selectedValue.date, selectedValue.time, selectedDuration)
        : formatScheduleDateTimeDisplay(selectedValue.date, selectedValue.time)
      : fallbackDate
        ? formatScheduleDateTimeDisplay(fallbackDate, "")
        : placeholder;
  const parsedDraftTime = parseScheduleTime(draftTime);
  const draftStart = draftDate && parsedDraftTime ? new Date(`${formatDatePickerValue(draftDate)}T${draftTime}`) : null;
  const draftEnd = durationMode ? scheduleEndDate(draftDate, draftTime, draftDurationMinutes) : null;
  const minimumStart = minimumStartAt ? new Date(minimumStartAt) : null;
  const maximumEnd = maximumEndAt ? new Date(maximumEndAt) : null;
  const hasWindow = Boolean(
    durationMode
    && minimumStart && maximumEnd
    && !Number.isNaN(minimumStart.getTime())
    && !Number.isNaN(maximumEnd.getTime()),
  );
  const pickerTitle = durationMode
    ? label.includes(t("作答"))
      ? t("选择作答时间段")
      : label === t("开始时间")
        ? t("选择时间段")
        : t("选择{value0}时间段", { value0: label.replace(/时间$/, "") })
    : t("选择{value0}", { value0: label });
  const pickerSubtitle = hasWindow
    ? t("只提醒自己，必须落在可安排时段内")
    : durationMode
      ? t("开始时间与时长分开设置，结束时间自动计算")
      : deadlineMode
        ? t("截止前完成即可，常用当天 23:59")
        : null;
  const availableWindowLabel = hasWindow && minimumStart && maximumEnd
    ? t("可安排：{value0}月{value1}日 {value2} – {value3}月{value4}日 {value5}", { value0: minimumStart.getMonth() + 1, value1: minimumStart.getDate(), value2: formatLocalTime(minimumStart), value3: maximumEnd.getMonth() + 1, value4: maximumEnd.getDate(), value5: formatLocalTime(maximumEnd) })
    : null;
  const withinBounds = (start: Date | null, end: Date | null) => Boolean(
    start && end
    && (!minimumStart || start >= minimumStart)
    && (!maximumEnd || end <= maximumEnd),
  );
  const rangeWithinBounds = !durationMode || withinBounds(draftStart, draftEnd);
  const durationValid = !durationMode || (Number.isInteger(draftDurationMinutes) && draftDurationMinutes > 0);
  const canConfirm = !disabled && Boolean(draftDate && parsedDraftTime) && rangeWithinBounds && durationValid;
  const timeOptions = useMemo(() => {
    const options = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);
    if (deadlineMode) options.push(SCHEDULE_PICKER_DEADLINE_TIME);
    if (parsedDraftTime && !options.includes(draftTime)) options.push(draftTime);
    return options.sort();
  }, [deadlineMode, draftTime, parsedDraftTime]);
  const today = new Date();
  const quickChoices: Array<{ label: string; days: number; time: string }> = hasWindow
    ? [
      { label: t("今晚 20:00"), days: 0, time: "20:00" },
      { label: t("明早 09:00"), days: 1, time: "09:00" },
      { label: t("明晚 20:00"), days: 1, time: "20:00" },
    ]
    : deadlineMode
      ? [
        { label: t("今天 23:59"), days: 0, time: SCHEDULE_PICKER_DEADLINE_TIME },
        { label: t("明天 23:59"), days: 1, time: SCHEDULE_PICKER_DEADLINE_TIME },
        { label: t("3 天后 23:59"), days: 3, time: SCHEDULE_PICKER_DEADLINE_TIME },
        { label: t("7 天后 23:59"), days: 7, time: SCHEDULE_PICKER_DEADLINE_TIME },
      ]
      : [];
  const quickChoiceAvailable = (choice: { days: number; time: string }) => {
    if (!hasWindow) return true;
    const start = new Date(`${formatDatePickerValue(addDays(today, choice.days))}T${choice.time}`);
    return withinBounds(start, new Date(start.getTime() + draftDurationMinutes * 60_000));
  };
  const summarySub = (() => {
    if (durationMode && draftEnd && !rangeWithinBounds) return { text: t("所选时间段超出可安排范围"), tone: "error" as const };
    if (durationMode && draftStart && draftEnd) {
      return { text: hasWindow ? t("在可安排时段内 · 时长 {value0}", { value0: formatDurationMinutes(draftDurationMinutes) }) : t("时长 {value0}", { value0: formatDurationMinutes(draftDurationMinutes) }), tone: "muted" as const };
    }
    if (deadlineMode && draftStart) return { text: formatRemaining(draftStart, today), tone: "muted" as const };
    return null;
  })();
  const summaryText = draftDate
    ? durationMode && draftEnd
      ? `${formatSchedulePickerSummary(draftDate, draftTime)} – ${sameLocalDate(draftDate, draftEnd) ? formatLocalTime(draftEnd) : formatSchedulePickerSummary(draftEnd, formatLocalTime(draftEnd))}`
      : formatSchedulePickerSummary(draftDate, parsedDraftTime ? draftTime : "")
    : t("未选择日期");

  const closePicker = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const positionPopover = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const nextHost = window.innerWidth > 640
        ? pickerRef.current?.closest<HTMLElement>(".cd3-stage-dialog, .new-process-dialog, .career-next-stage-dialog, .interview-dialog, .career-session-record-dialog") ?? null
        : null;
      if (nextHost !== popoverHost) {
        setPopoverHost(nextHost);
        return;
      }
      if (!nextHost) {
        setPopoverPosition(null);
        return;
      }
      setPopoverPosition(schedulePickerPosition(
        trigger.getBoundingClientRect(),
        nextHost.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
        popoverRef.current?.getBoundingClientRect().height,
      ));
    };
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    const handlePointerDown = (event: Event) => {
      const target = event.target as Node;
      if (
        !pickerRef.current?.contains(target)
        && !popoverRef.current?.contains(target)
      ) closePicker();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, popoverHost]);

  // 打开时把时间列表滚到已选时间（没有则 09:00），放在列表中间
  useEffect(() => {
    if (!open) return;
    const list = timeListRef.current;
    if (!list) return;
    const target = list.querySelector<HTMLElement>('[aria-selected="true"]')
      ?? list.querySelector<HTMLElement>(`[data-time-option="${SCHEDULE_PICKER_DEFAULT_TIME}"]`);
    if (target) list.scrollTop = Math.max(0, target.offsetTop - (list.clientHeight - target.offsetHeight) / 2);
    // 只在打开时定位一次，之后由用户自己滚动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, popoverHost]);

  const openPicker = () => {
    const current = parseScheduleDateTimeValue(value);
    const initialDate = current?.date ?? fallbackDate ?? new Date();
    setDraftDate(initialDate);
    setDraftTimeInput(current?.time ?? "");
    setDraftDurationMinutes(durationMinutes ?? 60);
    setCustomDurationOpen(!SCHEDULE_PICKER_DURATIONS.includes(durationMinutes ?? 60));
    setDisplayMonth(startOfDatePickerMonth(initialDate));
    const nextHost = window.innerWidth > 640
      ? pickerRef.current?.closest<HTMLElement>(".cd3-stage-dialog, .new-process-dialog, .career-next-stage-dialog, .interview-dialog, .career-session-record-dialog") ?? null
      : null;
    setPopoverHost(nextHost);
    if (nextHost && triggerRef.current) {
      setPopoverPosition(schedulePickerPosition(
        triggerRef.current.getBoundingClientRect(),
        nextHost.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      ));
    } else {
      setPopoverPosition(null);
    }
    setOpen(true);
  };

  const selectDate = (date: Date) => {
    setDraftDate(date);
    if (date.getMonth() !== displayMonth.getMonth() || date.getFullYear() !== displayMonth.getFullYear()) {
      setDisplayMonth(startOfDatePickerMonth(date));
    }
  };
  const selectQuickChoice = (choice: { days: number; time: string }) => {
    selectDate(addDays(new Date(), choice.days));
    setDraftTimeInput(choice.time);
  };
  const confirm = () => {
    if (!canConfirm || !draftDate) return;
    onChange(formatScheduleDateTimeValue(draftDate, draftTime));
    if (durationMode) onDurationMinutesChange(draftDurationMinutes);
    closePicker();
  };

  return (
    <div ref={pickerRef} className="career-date-picker career-schedule-picker">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="career-date-picker-trigger career-schedule-picker-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-calendar`}
        aria-required={required ? "true" : undefined}
        disabled={disabled}
        onClick={() => (open ? closePicker() : openPicker())}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            closePicker();
          }
        }}
      >
        <span>{displayedValue}</span>
        <CalendarDays aria-hidden="true" />
      </button>
      <MotionPresence>{open && (
        <SchedulePickerPortal host={popoverHost}>
          <MotionSurface as="div" variant="popover"
            ref={popoverRef}
            id={`${id}-calendar`}
            className="v3 career-date-picker-popover career-schedule-picker-popover"
            role="dialog"
            aria-label={t("选择{value0}", { value0: label })}
            style={popoverPosition ? { left: popoverPosition.left, right: "auto", top: popoverPosition.top, width: popoverPosition.width } : undefined}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closePicker();
              } else if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
                event.preventDefault();
                confirm();
              }
            }}
          >
          <header className="tp2-head">
            <div>
              <strong>{pickerTitle}</strong>
              {pickerSubtitle && <span>{pickerSubtitle}</span>}
            </div>
            <button type="button" className="tp2-close" aria-label={t("关闭时间选择")} onClick={closePicker}><X aria-hidden="true" /></button>
          </header>
          <div className="tp2-body">
            <div className="tp2-date">
              <header className="career-date-picker-header tp2-month">
                <strong aria-live="polite">{monthLabel}</strong>
                <div>
                  <button
                    type="button"
                    aria-label={t("上一月")}
                    title={t("上一月")}
                    onClick={() => setDisplayMonth((current) => addDatePickerMonths(current, -1))}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("下一月")}
                    title={t("下一月")}
                    onClick={() => setDisplayMonth((current) => addDatePickerMonths(current, 1))}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              </header>
              <div className="tp2-calendar" role="grid" aria-label={t("{value0}日期", { value0: monthLabel })}>
                <div className="tp2-weekdays" role="row">
                  {[...weekdays().slice(1), weekdays()[0]].map((weekday) => (
                    <span key={weekday} role="columnheader">{weekday}</span>
                  ))}
                </div>
                {Array.from({ length: calendarDays.length / 7 }, (_, weekIndex) => (
                  <div key={weekIndex} className="tp2-week" role="row">
                    {calendarDays.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => {
                      const dateValue = formatDatePickerValue(date);
                      const isSelected = Boolean(draftDate && sameLocalDate(date, draftDate));
                      const isCurrentMonth = date.getMonth() === displayMonth.getMonth()
                        && date.getFullYear() === displayMonth.getFullYear();
                      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                      const nextDayStart = addDays(date, 1);
                      const isUnavailable = durationMode && (
                        Boolean(minimumStart && nextDayStart <= minimumStart)
                        || Boolean(maximumEnd && dayStart >= maximumEnd)
                      );
                      const inWindow = hasWindow && !isUnavailable;
                      const windowStart = inWindow && minimumStart && sameLocalDate(date, minimumStart);
                      const windowEnd = inWindow && maximumEnd && sameLocalDate(date, new Date(maximumEnd.getTime() - 1));
                      const classes = [
                        !isCurrentMonth && "is-adjacent-month",
                        inWindow && "is-in-window",
                        windowStart && "is-window-start",
                        windowEnd && "is-window-end",
                      ].filter(Boolean).join(" ");
                      return (
                        <div
                          key={dateValue}
                          role="gridcell"
                          aria-label={formatDatePickerDay(date)}
                          aria-selected={isSelected}
                          className={classes || undefined}
                        >
                          <button
                            type="button"
                            aria-label={formatDatePickerDay(date)}
                            aria-current={sameLocalDate(date, today) ? "date" : undefined}
                            className={isSelected ? "is-selected" : undefined}
                            disabled={isUnavailable}
                            onClick={() => selectDate(date)}
                          >
                            {date.getDate()}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="tp2-legend" aria-hidden="true">
                <span><i className="is-today" />{t("今天")}</span>
                <span><i className="is-selected" />{t("已选")}</span>
                {hasWindow && <span><i className="is-window" />{t("可安排时段")}</span>}
              </div>
              {availableWindowLabel && (
                <div className="tp2-window">
                  <Info aria-hidden="true" />
                  <div>
                    <strong>{availableWindowLabel}</strong>
                    <span>{t("计划需完整落在此时段内，时段外日期不可选")}</span>
                  </div>
                </div>
              )}
            </div>
            <section className="tp2-time" aria-label={t("选择时间")}>
              {quickChoices.length > 0 && (
                <div className="tp2-section">
                  <span className="tp2-label">{hasWindow ? t("建议时段") : t("快捷截止")}</span>
                  <div className={`tp2-chips${quickChoices.length === 4 ? " is-grid" : ""}`} role="group" aria-label={hasWindow ? t("建议时段") : t("快捷截止")}>
                    {quickChoices.map((choice) => {
                      const active = Boolean(draftDate && sameLocalDate(draftDate, addDays(today, choice.days)) && draftTime === choice.time);
                      return (
                        <button
                          key={choice.label}
                          type="button"
                          className={active ? "is-selected" : undefined}
                          aria-pressed={active}
                          disabled={disabled || !quickChoiceAvailable(choice)}
                          onClick={() => selectQuickChoice(choice)}
                        >{choice.label}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              {!hasWindow && !deadlineMode && (
                <div className="tp2-section">
                  <span className="tp2-label">{t("常用时间")}</span>
                  <div className="tp2-chips is-row" role="group" aria-label={t("常用时间")}>
                    {SCHEDULE_PICKER_COMMON_TIMES.map((time) => (
                      <button
                        key={time}
                        type="button"
                        className={draftTime === time ? "is-selected" : undefined}
                        aria-pressed={draftTime === time}
                        disabled={disabled}
                        onClick={() => setDraftTimeInput(time)}
                      >{time}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="tp2-section">
                <span className="tp2-label">
                  {durationMode ? t("开始时间") : t("时间")}
                  <small>{deadlineMode ? t("常用 23:59") : t("30 分钟步长，可直接输入")}</small>
                </span>
                <label className={`tp2-input${draftTimeInput && !parsedDraftTime ? " is-invalid" : ""}`}>
                  <Clock3 aria-hidden="true" />
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={durationMode ? t("开始时间") : t("时间")}
                    aria-controls={`${id}-time-options`}
                    aria-invalid={draftTimeInput && !parsedDraftTime ? "true" : undefined}
                    placeholder={t("如 {value0}", { value0: deadlineMode ? "2359" : "1400" })}
                    value={draftTimeInput}
                    disabled={disabled}
                    onChange={(event) => setDraftTimeInput(event.target.value.replace(/[^\d:]/g, "").slice(0, 5))}
                    onBlur={() => { if (parsedDraftTime) setDraftTimeInput(draftTime); }}
                  />
                </label>
                <div ref={timeListRef} id={`${id}-time-options`} className="tp2-time-list" role="listbox" aria-label={t("时间选项")}>
                  {timeOptions.map((option) => {
                    const selected = draftTime === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        data-time-option={option}
                        aria-selected={selected}
                        className={selected ? "is-selected" : undefined}
                        disabled={disabled}
                        onClick={() => setDraftTimeInput(option)}
                      >
                        <span>{option}</span>
                        {selected && <Check aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              {durationMode && (
                <div className="tp2-section">
                  <span className="tp2-label">
                    {t("时长")}
                    {draftEnd && <small>{t("结束 {value0}", { value0: formatLocalTime(draftEnd) })}</small>}
                    <button
                      type="button"
                      className="tp2-link"
                      aria-pressed={customDurationOpen}
                      onClick={() => {
                        if (customDurationOpen) {
                          setCustomDurationOpen(false);
                          if (!SCHEDULE_PICKER_DURATIONS.includes(draftDurationMinutes)) setDraftDurationMinutes(60);
                        } else {
                          setCustomDurationOpen(true);
                        }
                      }}
                    >{customDurationOpen ? t("用预设") : t("自定义")}</button>
                  </span>
                  {customDurationOpen ? (
                    <label className="tp2-input tp2-custom-duration">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        autoFocus
                        aria-label={t("自定义时长（分钟）")}
                        value={draftDurationMinutes > 0 ? draftDurationMinutes : ""}
                        placeholder={t("分钟")}
                        onChange={(event) => setDraftDurationMinutes(Number(event.target.value))}
                      />
                      <span>{t("分钟")}</span>
                    </label>
                  ) : (
                    <div className="tp2-segmented" role="group" aria-label={t("预计时长")}>
                      {SCHEDULE_PICKER_DURATIONS.map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          className={draftDurationMinutes === minutes ? "is-selected" : undefined}
                          aria-pressed={draftDurationMinutes === minutes}
                          onClick={() => setDraftDurationMinutes(minutes)}
                        >{t("{value0} 分", { value0: minutes })}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
          <footer className="tp2-foot">
            <div className="tp2-summary">
              <strong>{summaryText}</strong>
              {summarySub && (
                <span className={summarySub.tone === "error" ? "is-error" : undefined} role={summarySub.tone === "error" ? "alert" : undefined}>{summarySub.text}</span>
              )}
            </div>
            <button
              type="button"
              className="tp2-link"
              disabled={!value && !draftDate}
              onClick={() => {
                setDraftDate(null);
                setDraftTimeInput("");
                onChange("");
                closePicker();
              }}
            >{t("清除")}</button>
            <button type="button" className="v3-btn v3-btn-ghost" onClick={closePicker}>{t("取消")}</button>
            <button
              type="button"
              className="v3-btn v3-btn-dark career-schedule-picker-confirm"
              disabled={!canConfirm}
              onClick={confirm}
            >{t("确定")}</button>
          </footer>
          </MotionSurface>
        </SchedulePickerPortal>
      )}</MotionPresence>
    </div>
  );
}

type OfferFormValues = {
  receivedOn: string;
  replyDueOn: string;
  startOn: string;
  baseLocation: string;
  salary: string;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  benefitsDescription: string;
  probation: string;
  /** Offer files picked from the library; `undefined` leaves saved files untouched. */
  materialIds?: string[];
};

const SALARY_PERIOD_OPTIONS: Array<{ label: string; value: SalaryPeriod }> = [
  { get label() { return t("月薪"); }, value: "month" },
  { get label() { return t("年薪"); }, value: "year" },
  { get label() { return t("日薪"); }, value: "day" },
  { get label() { return t("时薪"); }, value: "hour" },
];

function optionalSalaryNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

function offerFormError(values: OfferFormValues): string | null {
  const salary = optionalSalaryNumber(values.salary);
  if (salary !== null && (!Number.isFinite(salary) || salary < 0)) {
    return t("薪资必须是大于或等于 0 的数字。");
  }
  if (
    salary !== null
    && !/^[A-Z]{3}$/.test(values.salaryCurrency.trim().toUpperCase())
  ) {
    return t("填写薪资时，币种需要使用 3 位英文字母代码，例如 CNY。");
  }
  return null;
}

function offerRequestPayload(values: OfferFormValues, baseLockVersion: number) {
  const salary = optionalSalaryNumber(values.salary);
  return {
    base_lock_version: baseLockVersion,
    received_on: values.receivedOn || null,
    reply_due_on: values.replyDueOn || null,
    start_on: values.startOn || null,
    base_location: values.baseLocation.trim() || null,
    salary,
    salary_currency: salary !== null ? values.salaryCurrency.trim().toUpperCase() : null,
    salary_period: salary !== null ? values.salaryPeriod : null,
    benefits_description: values.benefitsDescription.trim() || null,
    probation: values.probation.trim() || null,
    ...(values.materialIds ? { material_dataset_ids: values.materialIds } : {}),
  };
}

function OfferDetailsFields({
  values,
  disabled,
  onChange,
}: {
  values: OfferFormValues;
  disabled: boolean;
  onChange: (values: OfferFormValues) => void;
}) {
  useLocale();
  const update = <Key extends keyof OfferFormValues>(
    key: Key,
    value: OfferFormValues[Key],
  ) => onChange({ ...values, [key]: value });
  const numericSalary = optionalSalaryNumber(values.salary);
  const [documents, setDocuments] = useState<DatasetRecord[] | null>(null);
  useEffect(() => {
    let live = true;
    void api.listDatasets()
      .then((response) => { if (live) setDocuments(response.datasets.filter((item) => (item.asset_kind ?? "document") === "document" && item.upload_status === "succeeded")); })
      .catch(() => { if (live) setDocuments([]); });
    return () => { live = false; };
  }, []);
  const adjustSalary = (direction: -1 | 1) => {
    const current = numericSalary !== null && Number.isFinite(numericSalary) ? numericSalary : null;
    const next = current === null ? 0 : Math.max(0, current + (1_000 * direction));
    update("salary", String(next));
  };

  return (
    <section className="career-next-stage-offer-panel" aria-label={t("Offer 信息")}>
      <div className="career-next-stage-offer-form">
        {([
          ["receivedOn", "收到日期"],
          ["replyDueOn", "回复截止"],
          ["startOn", "预计入职"],
        ] as const).map(([key, label]) => <div className="career-next-stage-field" key={key}>
          <Label htmlFor={`career-offer-${key}`}>{t(label)}</Label>
          <input id={`career-offer-${key}`} type="date" min="1000-01-01" max="9999-12-31" value={values[key]} disabled={disabled} onInput={(event) => update(key, event.currentTarget.value)} onChange={(event) => update(key, event.target.value)} />
        </div>)}
        <div className="career-next-stage-field">
          <Label htmlFor="career-offer-base-location">{t("工作地点")}</Label>
          <input
            id="career-offer-base-location"
            value={values.baseLocation}
            maxLength={100}
            disabled={disabled}
            placeholder={t("例如：上海")}
            onChange={(event) => update("baseLocation", event.target.value)}
          />
        </div>
        <div className="career-next-stage-field career-next-stage-offer-number-field">
          <Label htmlFor="career-offer-salary">{t("薪资")}</Label>
          <input
            id="career-offer-salary"
            className="career-next-stage-offer-number-input"
            type="number"
            min="0"
            step="1000"
            value={values.salary}
            disabled={disabled}
            placeholder={t("例如：15000")}
            onChange={(event) => update("salary", event.target.value)}
          />
          <div className="career-next-stage-offer-number-controls">
            <button
              type="button"
              aria-label={t("薪资增加")}
              disabled={disabled}
              onClick={() => adjustSalary(1)}
            >
              <ChevronUp size={12} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t("薪资减少")}
              disabled={disabled || (numericSalary !== null && numericSalary <= 0)}
              onClick={() => adjustSalary(-1)}
            >
              <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
        <div className="career-next-stage-field">
          <Label htmlFor="career-offer-salary-currency">{t("币种")}</Label>
          <input
            id="career-offer-salary-currency"
            value={values.salaryCurrency}
            maxLength={3}
            disabled={disabled}
            placeholder="CNY"
            onChange={(event) => update("salaryCurrency", event.target.value.toUpperCase())}
          />
        </div>
        <div className="career-next-stage-field">
          <Label htmlFor="career-offer-salary-period">{t("计薪周期")}</Label>
          <Select
            value={values.salaryPeriod}
            disabled={disabled}
            onValueChange={(value) => update("salaryPeriod", value as SalaryPeriod)}
          >
            <SelectTrigger
              id="career-offer-salary-period"
              aria-label={t("计薪周期")}
              className="career-next-stage-select-trigger"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="career-next-stage-select-content">
              {SALARY_PERIOD_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="career-next-stage-field">
          <Label htmlFor="career-offer-probation">{t("试用期")}</Label>
          <input
            id="career-offer-probation"
            value={values.probation}
            maxLength={100}
            disabled={disabled}
            placeholder={t("例如：3 个月")}
            onChange={(event) => update("probation", event.target.value)}
          />
        </div>
        <div className="career-next-stage-field">
          <Label htmlFor="career-offer-material">{t("Offer 材料")}</Label>
          <V3Select
            label={t("Offer 材料")}
            value={values.materialIds?.[0] ?? ""}
            disabled={disabled || documents === null}
            placeholder={documents === null ? t("正在加载资料库…") : documents.length ? t("从资料库选择文件") : t("资料库还没有文件")}
            options={[{ value: "", label: t("不关联文件") }, ...(documents ?? []).map((item) => ({ value: item.id, label: item.file_name }))]}
            onChange={(value) => update("materialIds", value ? [value] : [])}
          />
        </div>
        <div className="career-next-stage-field career-next-stage-field--full career-next-stage-offer-benefits">
          <Label htmlFor="career-offer-benefits">{t("福利待遇")}</Label>
          <textarea
            id="career-offer-benefits"
            value={values.benefitsDescription}
            maxLength={500}
            disabled={disabled}
            placeholder={t("例如：餐补、补充医疗、年假")}
            onChange={(event) => update("benefitsDescription", event.target.value)}
          />
        </div>
      </div>
    </section>
  );
}

type NextStageChoice = ApplicationStageType;

const NEXT_STAGE_CHOICES: Array<{
  key: NextStageChoice;
  label: string;
  icon: typeof ClipboardCheck;
}> = [
  { key: "screening", get label() { return t("筛选中"); }, icon: ListFilter },
  { key: "assessment", get label() { return t("测评"); }, icon: ClipboardCheck },
  { key: "written_test", get label() { return t("笔试"); }, icon: FilePenLine },
  { key: "ai_interview", get label() { return t("AI 面试"); }, icon: Sparkles },
  { key: "interview", get label() { return t("面试"); }, icon: Users },
  { key: "hr", get label() { return t("HR 面"); }, icon: BriefcaseBusiness },
  { key: "oc", label: "OC", icon: Mail },
  { key: "offer", label: "Offer", icon: Mail },
];

const NEXT_STAGE_FORM_COPY: Record<NextStageChoice, { title: string; badge: string; description: string }> = {
  screening: {
    get title() { return t("确认投递信息"); },
    badge: "进入筛选",
    get description() { return t("记录本次投递日期，保存后进入筛选流程。"); },
  },
  assessment: {
    get title() { return t("填写测评信息"); },
    badge: "异步任务",
    get description() { return t("填写收到测评邮件后的任务信息。"); },
  },
  written_test: {
    get title() { return t("填写笔试信息"); },
    badge: "笔试安排",
    get description() { return t("记录笔试要求的固定开始和结束时间。"); },
  },
  ai_interview: {
    get title() { return t("填写 AI 面试信息"); },
    badge: "异步面试",
    get description() { return t("记录 AI 面试链接、开始时间和结束时间。"); },
  },
  interview: {
    get title() { return t("填写面试信息"); },
    badge: "面试安排",
    get description() { return t("记录本轮面试的轮次、时间和参与方式。"); },
  },
  hr: {
    get title() { return t("填写 HR 面信息"); },
    badge: "HR 面",
    get description() { return t("记录与 HR 沟通的时间、方式和联系人。"); },
  },
  oc: {
    get title() { return t("记录口头意向"); },
    badge: "OC",
    get description() { return t("记录口头意向的沟通时间、薪酬和到岗时间。"); },
  },
  offer: {
    get title() { return t("填写 Offer 信息"); },
    badge: "录用结果",
    get description() { return t("记录 Offer 结果及相关信息。"); },
  },
};

const NEXT_STAGE_BADGE_ICONS: Record<NextStageChoice, typeof ClipboardCheck> = {
  screening: Send,
  assessment: ClipboardCheck,
  written_test: FilePenLine,
  ai_interview: Sparkles,
  interview: CalendarDays,
  hr: CalendarDays,
  oc: Mail,
  offer: BriefcaseBusiness,
};

const COMPLETION_WINDOW_OPTIONS = [
  { get label() { return t("24 小时"); }, value: "1440" },
  { get label() { return t("3 天"); }, value: "4320" },
  { get label() { return t("7 天"); }, value: "10080" },
  { get label() { return t("自定义"); }, value: "custom" },
] as const;

function initialNextStageChoice(initialTab: NextStageDialogTab): NextStageChoice {
  if (initialTab === "interview") return "interview";
  if (initialTab === "offer") return "offer";
  return "assessment";
}

function stageDeadlineDisplay(startAt: string, minutes: number): string | null {
  const start = parseScheduleStart(startAt);
  if (!start || !Number.isFinite(minutes) || minutes <= 0) return null;
  return formatFullDateTime(new Date(start.getTime() + minutes * 60_000).toISOString());
}

export function AddNextStageDialog({
  application,
  applicationOptions,
  timezone,
  initialTab = "assessment",
  initialInterviewLabel = "",
  initialStartAt = "",
  initialEndAt = "",
  initialStage,
  initialAppliedAt = "",
  includeOffer = true,
  lockStageSelection = false,
  scheduleOnly = false,
  title = "添加下一阶段",
  description,
  onClose,
  onChanged,
  onNotice,
  onApplicationChange,
}: {
  application: ApplicationStageSource;
  applicationOptions?: JobApplicationSummary[];
  timezone: string;
  initialTab?: NextStageDialogTab;
  initialInterviewLabel?: string;
  initialStartAt?: string;
  initialEndAt?: string;
  initialStage?: ApplicationStageType;
  initialAppliedAt?: string;
  includeOffer?: boolean;
  lockStageSelection?: boolean;
  scheduleOnly?: boolean;
  title?: string;
  description?: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
  onApplicationChange?: (application: JobApplicationSummary) => void;
}) {
  useLocale();
  const [selectedApplicationId, setSelectedApplicationId] = useState(application.id);
  const selectedApplicationOption = applicationOptions?.find((item) => item.id === selectedApplicationId);
  const selectedApplication = selectedApplicationOption ?? application;
  const suggestedInterviewRoundNo = selectedApplication.current_stage_type === "interview"
    ? (selectedApplication.current_round_no ?? 0) + (scheduleOnly ? 0 : 1)
    : 1;
  const startsPending = projectApplicationProgress(selectedApplication).isPending;
  // 默认选中流程里的下一步（测评 → 笔试 → 面试 …），调用方明确指定时以调用方为准
  const [activeStage, setActiveStage] = useState<NextStageChoice>(() => initialStage ?? (startsPending ? "screening" : initialTab === "assessment" ? defaultNextStage(selectedApplication) : initialNextStageChoice(initialTab)));
  const [appliedAt, setAppliedAt] = useState(initialAppliedAt);
  const [assessmentStartAt, setAssessmentStartAt] = useState(initialStartAt);
  const [assessmentLink, setAssessmentLink] = useState("");
  const [completionWindow, setCompletionWindow] = useState<string>("4320");
  const [customCompletionDays, setCustomCompletionDays] = useState("3");
  const [aiInterviewStartAt, setAiInterviewStartAt] = useState(initialStartAt);
  const [aiInterviewDuration, setAiInterviewDuration] = useState(60);
  const [aiInterviewLink, setAiInterviewLink] = useState("");
  const [writtenStartAt, setWrittenStartAt] = useState(initialStartAt);
  const [writtenEndAt, setWrittenEndAt] = useState(initialEndAt);
  const [writtenDuration, setWrittenDuration] = useState(() => {
    const start = parseScheduleStart(initialStartAt);
    const end = parseScheduleStart(initialEndAt);
    const minutes = start && end ? Math.round((end.getTime() - start.getTime()) / 60_000) : 60;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  });
  const [writtenScheduleKind, setWrittenScheduleKind] = useState<"fixed_slot" | "open_window">("fixed_slot");
  const [writtenMode, setWrittenMode] = useState<InterviewSessionRecord["mode"]>("video");
  const [writtenMeetingOrLocation, setWrittenMeetingOrLocation] = useState("");
  const [interviewLabel, setInterviewLabel] = useState(initialInterviewLabel);
  const [interviewRoundNo, setInterviewRoundNo] = useState(
    String(suggestedInterviewRoundNo),
  );
  const [interviewStartAt, setInterviewStartAt] = useState(initialStartAt);
  const [interviewDuration, setInterviewDuration] = useState(() => {
    const start = parseScheduleStart(initialStartAt);
    const end = parseScheduleStart(initialEndAt);
    const minutes = start && end ? Math.round((end.getTime() - start.getTime()) / 60_000) : 60;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  });
  const [interviewMode, setInterviewMode] = useState<InterviewSessionRecord["mode"]>("video");
  const [interviewMeetingOrLocation, setInterviewMeetingOrLocation] = useState("");
  const [offerValues, setOfferValues] = useState<OfferFormValues>({
    receivedOn: "",
    replyDueOn: "",
    startOn: "",
    baseLocation: "",
    salary: "",
    salaryCurrency: "CNY",
    salaryPeriod: "month",
    benefitsDescription: "",
    probation: "",
  });
  const [assessmentEndAt, setAssessmentEndAt] = useState(initialEndAt);
  const [answerPlanStart, setAnswerPlanStart] = useState("");
  const [answerPlanDuration, setAnswerPlanDuration] = useState(60);
  const [noteOpen, setNoteOpen] = useState(false);
  const [preparationNote, setPreparationNote] = useState("");
  const [interviewerName, setInterviewerName] = useState("");
  const [appliedChannel, setAppliedChannel] = useState(() => (application as Partial<JobApplicationSummary>).applied_channel ?? "");
  const [resumeId, setResumeId] = useState("");
  const [resumes, setResumes] = useState<Array<{ id: string; title: string }> | null>(null);
  const [ocAt, setOcAt] = useState("");
  const [ocContact, setOcContact] = useState("");
  const [ocSalary, setOcSalary] = useState("");
  const [ocStart, setOcStart] = useState("");
  const [ocNote, setOcNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clientRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    setInterviewRoundNo(String(suggestedInterviewRoundNo));
  }, [selectedApplication.id, suggestedInterviewRoundNo]);

  useEffect(() => {
    if (selectedApplicationOption) onApplicationChange?.(selectedApplicationOption);
  }, [onApplicationChange, selectedApplicationOption]);

  // Recording an application can link the resume it was sent with.
  useEffect(() => {
    if (!startsPending || scheduleOnly) return;
    let live = true;
    void api.listResumes()
      .then((response) => { if (live) setResumes(response.resumes.map((item) => ({ id: item.id, title: item.title }))); })
      .catch(() => { if (live) setResumes([]); });
    return () => { live = false; };
  }, [startsPending, scheduleOnly]);

  const activeAsyncStartAt = activeStage === "ai_interview" ? aiInterviewStartAt : assessmentStartAt;
  const activeAsyncLink = activeStage === "ai_interview" ? aiInterviewLink : assessmentLink;
  const completionMinutes = completionWindow === "custom"
    ? Number(customCompletionDays) * 24 * 60
    : Number(completionWindow);
  const deadlineDisplay = stageDeadlineDisplay(assessmentStartAt, completionMinutes);

  const saveStage = async (): Promise<ApplicationStageSource | null> => {
    if (scheduleOnly) return selectedApplication;
    const fixedLabel = NEXT_STAGE_CHOICES.find((choice) => choice.key === activeStage)?.label ?? "";
    const stageLabel = activeStage === "interview" ? interviewLabel.trim() : fixedLabel;
    const appliedAtIso = startsPending ? dateInputToIso(appliedAt) : null;
    const targetRoundNo = activeStage === "interview" && interviewRoundNo
      ? Number(interviewRoundNo)
      : null;
    if (!stageLabel) {
      setErrorMessage(t("请填写面试名称。"));
      return null;
    }
    const response = await api.addJobApplicationStage(selectedApplication.id, {
      client_request_id: clientRequestId,
      stage_type: activeStage,
      ...(activeStage === "interview" ? {
        stage_label: stageLabel,
        interview_round_no: targetRoundNo,
      } : {}),
      ...(appliedAtIso
        ? { applied_at: appliedAtIso }
        : {}),
      ...(startsPending && appliedChannel.trim() ? { applied_channel: appliedChannel.trim() } : {}),
      ...(startsPending && resumeId ? { resume_id: resumeId } : {}),
      ...(activeStage === "oc" ? {
        oc_communicated_at: parseScheduleStart(ocAt)?.toISOString() ?? null,
        oc_contact: ocContact.trim() || null,
        oc_salary_text: ocSalary.trim() || null,
        oc_start_text: ocStart.trim() || null,
        oc_note: ocNote.trim() || null,
      } : {}),
      base_lock_version: selectedApplication.lock_version,
    });
    return response.application;
  };

  const save = async () => {
    if (busy) return;
    if (activeStage === "offer") {
      const validationError = offerFormError(offerValues);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
      setErrorMessage(null);
      setBusy(true);
      try {
        let advancedApplication: ApplicationStageSource;
        try {
          const savedApplication = await saveStage();
          if (!savedApplication) return;
          advancedApplication = savedApplication;
        } catch (error) {
          setErrorMessage(requestErrorMessage(error));
          return;
        }

        try {
          await api.recordJobApplicationOffer(
            selectedApplication.id,
            offerRequestPayload(offerValues, advancedApplication.lock_version),
          );
        } catch {
          onClose();
          try {
            await onChanged();
          } catch {
            // The refresh callback owns its own error notice; preserve the
            // partial-success message below if it rejects unexpectedly.
          }
          onNotice(t("已进入 Offer 阶段，但 Offer 状态保存失败，可从 Offer 信息入口重试"));
          return;
        }

        onClose();
        await onChanged();
      } finally {
        setBusy(false);
      }
      return;
    }

    if (activeStage === "oc") {
      if (!parseScheduleStart(ocAt)) {
        setErrorMessage(t("请填写沟通时间。"));
        return;
      }
      setErrorMessage(null);
      setBusy(true);
      try {
        const result = await saveStage();
        if (!result) return;
        onClose();
        await onChanged();
      } catch (error) {
        setErrorMessage(requestErrorMessage(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    const fixedLabel = NEXT_STAGE_CHOICES.find((choice) => choice.key === activeStage)?.label ?? "";
    const isWrittenTest = activeStage === "written_test";
    // HR 面 is booked like an interview: a fixed time, a way to meet and a contact.
    const isInterview = activeStage === "interview" || activeStage === "hr";
    const isOpenWindow = activeStage === "assessment" || (isWrittenTest && writtenScheduleKind === "open_window");
    const startAt = (isWrittenTest ? writtenStartAt : isInterview ? interviewStartAt : activeAsyncStartAt) || (isOpenWindow ? schedulePickerValue(new Date().toISOString()) : "");
    const start = parseScheduleStart(startAt);
    const hasScheduleDetails = isWrittenTest
      ? Boolean(writtenStartAt || writtenEndAt || writtenMeetingOrLocation.trim() || preparationNote.trim())
      : isInterview
        ? Boolean(interviewStartAt || interviewMeetingOrLocation.trim() || preparationNote.trim())
        : Boolean(activeAsyncStartAt || assessmentEndAt || activeAsyncLink.trim() || preparationNote.trim());
    if (scheduleOnly && !hasScheduleDetails) {
      setErrorMessage(t("请选择开始时间或截止时间。"));
      return;
    }
    let end: Date | null = null;
    let durationMinutes: number | null = null;
    if (hasScheduleDetails) {
      if (!start) {
        setErrorMessage(isWrittenTest ? t("请填写有效的笔试开始时间。") : t("请填写有效的{value0}开始时间。", { value0: fixedLabel }));
        return;
      }
      if ((isWrittenTest && writtenScheduleKind === "open_window") || activeStage === "assessment") {
        if (activeStage === "assessment" && (!Number.isFinite(completionMinutes) || completionMinutes <= 0)) {
          setErrorMessage(t("完成期限必须大于 0 天。"));
          return;
        }
        end = parseScheduleStart(activeStage === "assessment" ? assessmentEndAt : writtenEndAt);
        if (!end || end <= start) {
          setErrorMessage(t("截止时间必须晚于开放时间。"));
          return;
        }
      } else {
        durationMinutes = isWrittenTest
          ? writtenDuration
          : activeStage === "ai_interview"
            ? aiInterviewDuration
            : interviewDuration;
        if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
          setErrorMessage(t("持续时长必须大于 0 分钟。"));
          return;
        }
      }
    }
    const planStart = isOpenWindow && answerPlanStart ? parseScheduleStart(answerPlanStart) : null;
    if (answerPlanStart && isOpenWindow && (!planStart || !start || !end || planStart < start || planStart.getTime() + answerPlanDuration * 60_000 > end.getTime())) {
      setErrorMessage(t("作答计划必须完整落在官方作答时段内。"));
      return;
    }
    setErrorMessage(null);
    setBusy(true);
    try {
      let savedApplication: ApplicationStageSource;
      try {
        const result = await saveStage();
        if (!result) return;
        savedApplication = result;
      } catch (error) {
        setErrorMessage(requestErrorMessage(error));
        return;
      }

      if (!hasScheduleDetails) {
        onClose();
        await onChanged();
        return;
      }

      try {
        if (!start || (!end && !durationMinutes)) throw new Error("schedule time is required");
        const targetRoundNo = activeStage === "interview" && interviewRoundNo
          ? Number(interviewRoundNo)
          : null;
        const mode = isWrittenTest ? writtenMode : isInterview ? interviewMode : "video";
        const meetingOrLocation = isWrittenTest
          ? writtenMeetingOrLocation.trim()
          : isInterview ? interviewMeetingOrLocation.trim() : activeAsyncLink.trim();
        const scheduleTiming = end
          ? { end_at: end.toISOString() }
          : { duration_minutes: durationMinutes! };
        const created = await api.createInterviewSession(selectedApplication.id, {
          client_request_id: clientRequestId,
          application_stage_id: savedApplication.current_stage?.id,
          stage_type: activeStage === "hr" ? "hr" : isInterview ? "interview" : "other",
          round_no: activeStage === "interview" ? targetRoundNo ?? suggestedInterviewRoundNo : null,
          stage_label: activeStage === "interview" ? interviewLabel.trim() : savedApplication.current_stage?.stage_label ?? fixedLabel,
          start_at: start.toISOString(),
          ...scheduleTiming,
          schedule_kind: activeStage === "assessment" || (isWrittenTest && writtenScheduleKind === "open_window")
            ? "open_window"
            : "fixed_slot",
          timezone,
          mode,
          meeting_url: mode === "video" || mode === "phone" ? meetingOrLocation || null : null,
          location: mode === "onsite" || mode === "other" ? meetingOrLocation || null : null,
          preparation_note: preparationNote.trim() || null,
          ...(isInterview && interviewerName.trim() ? { interviewer_name: interviewerName.trim() } : {}),
        });
        if (planStart) {
          try {
            await api.updateInterviewAnswerPlan(created.session.id, { answer_plan_start_at: planStart.toISOString(), duration_minutes: answerPlanDuration, base_lock_version: created.session.lock_version });
          } catch {
            onClose();
            await onChanged();
            onNotice(t("阶段与排期已保存，但作答计划保存失败，可在安排详情中重试。"));
            return;
          }
        }
      } catch (error) {
        if (scheduleOnly) {
          setErrorMessage(requestErrorMessage(error));
          return;
        }
        onClose();
        try {
          await onChanged();
        } catch {
          // The refresh callback owns its own error notice; preserve the
          // partial-success message below even if it rejects unexpectedly.
        }
        onNotice(t("阶段已添加，但排期保存失败，可从安排时间入口重试"));
        return;
      }

      onClose();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = activeStage === "offer"
    ? !offerFormError(offerValues) && !busy
    : activeStage === "oc"
      ? Boolean(ocAt) && !busy
    : activeStage === "screening"
      ? !busy
      : activeStage === "interview"
      ? Boolean(interviewLabel.trim()) && !busy
      : activeStage === "assessment"
        ? Boolean(assessmentEndAt) && !busy
        : !busy;
  const dialogDescription = description ?? (startsPending
    ? t("选择当前实际进度，可直接补录已经发生的阶段。")
    : t("选择下一阶段，也可以直接补录已发生的阶段。"));
  const formCopy = NEXT_STAGE_FORM_COPY[activeStage];
  const StageBadgeIcon = NEXT_STAGE_BADGE_ICONS[activeStage];
  // 各阶段都可选（可以补录已经发生过的阶段），默认项由 defaultNextStage 决定
  const availableStages = NEXT_STAGE_CHOICES.filter((choice) => (
    (startsPending || choice.key !== "screening")
    && (includeOffer || choice.key !== "offer")
  ));

  const stageName = NEXT_STAGE_CHOICES.find(item => item.key === activeStage)?.label ?? "";
  const isWindow = activeStage === "assessment" || (activeStage === "written_test" && writtenScheduleKind === "open_window");
  const usesInterviewForm = activeStage === "interview" || activeStage === "hr";
  const scheduledStart = activeStage === "assessment" ? assessmentStartAt : activeStage === "written_test" ? writtenStartAt : activeStage === "ai_interview" ? aiInterviewStartAt : interviewStartAt;
  const scheduledEnd = activeStage === "assessment" ? assessmentEndAt : writtenEndAt;
  const scheduleDuration = activeStage === "written_test" ? writtenDuration : activeStage === "ai_interview" ? aiInterviewDuration : interviewDuration;
  const setStart = activeStage === "assessment" ? setAssessmentStartAt : activeStage === "written_test" ? setWrittenStartAt : activeStage === "ai_interview" ? setAiInterviewStartAt : setInterviewStartAt;
  const setEnd = activeStage === "assessment" ? setAssessmentEndAt : setWrittenEndAt;
  const setDuration = activeStage === "written_test" ? setWrittenDuration : activeStage === "ai_interview" ? setAiInterviewDuration : setInterviewDuration;
  const iconNames: Record<NextStageChoice, V3IconName> = { screening: "filter", assessment: "list", written_test: "edit", ai_interview: "spark", interview: "user", hr: "brief", oc: "phone", offer: "mail" };
  const titleApplication = selectedApplication as Partial<JobApplicationSummary>;
  const chooseDeadline = (days: number) => {
    setEnd(schedulePickerValue(new Date(Date.now() + days * 86400000).toISOString()));
    setCompletionWindow(String(days * 1440));
  };
  const submitLabel = scheduleOnly
    ? t("保存安排")
    : startsPending
      ? t("确认投递")
      : activeStage === "oc"
        ? t("记录 OC")
        : activeStage === "offer"
          ? t("记录 Offer")
          : t("添加{value0}", { value0: stageName });
  const shortDay = (value: string | null | undefined) => {
    const date = value ? parseScheduleStart(value) ?? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : null;
  };
  const currentName = activeStage === "interview" ? interviewLabel || stageName : stageName;
  const thisDay = shortDay(activeStage === "oc" ? ocAt : activeStage === "offer" ? offerValues.receivedOn : isWindow ? scheduledEnd : scheduledStart);
  const recordedStages = [...(titleApplication.stages ?? [])]
    .sort((left, right) => left.sequence_no - right.sequence_no)
    .filter((stage) => !scheduleOnly || stage.id !== titleApplication.current_stage?.id)
    .slice(-3);
  const trackRows = startsPending
    ? [
      { key: "applied", label: [t("提交投递"), shortDay(appliedAt) ?? t("今天")].join(" · "), status: t("本次"), current: true },
      { key: "next", label: t("{value0} · 投递后", { value0: stageName }), status: t("待开始"), current: false },
    ]
    : [
      ...recordedStages.map((stage) => ({
        key: stage.id,
        label: [stage.stage_type === "screening" ? t("简历筛选") : stage.stage_type === "oc" ? t("OC · 口头意向") : stage.stage_label, shortDay(stage.completed_at ?? stage.entered_at)].filter(Boolean).join(" · "),
        status: stage.stage_result === "rejected" ? t("未通过") : stage.stage_type === "oc" ? t("已沟通") : stage.stage_status === "completed" || !scheduleOnly ? t("已通过") : t("进行中"),
        current: false,
      })),
      { key: "this", label: [currentName, thisDay].filter(Boolean).join(" · "), status: t("本次"), current: true },
    ];
  const summaryTitle = startsPending
    ? t("这次投递怎么记")
    : activeStage === "oc"
      ? t("这次意向怎么记")
      : activeStage === "offer"
        ? t("这份 Offer 怎么记")
        : t("这一场怎么安排");
  const timeText = scheduledStart
    ? t("{value0} · {value1} 分钟", { value0: formatApplicationListDateTime(scheduledStart), value1: scheduleDuration })
    : t("选择开始时间和时长");
  const summaryRows: Array<{ icon: V3IconName; title: string; text: string; muted?: boolean }> = [
    { icon: "flag", title: t("阶段"), text: t("{value0}「{value1}」", { value0: scheduleOnly ? t("当前") : t("进入"), value1: currentName }) },
    ...(startsPending
      ? [
        { icon: "link" as const, title: t("投递渠道"), text: appliedChannel.trim() ? t("{value0} · 可选", { value0: appliedChannel.trim() }) : t("还没填 · 可选"), muted: !appliedChannel.trim() },
        { icon: "doc" as const, title: t("关联简历"), text: resumes?.find((item) => item.id === resumeId)?.title ? t("{value0} · 可选", { value0: resumes.find((item) => item.id === resumeId)!.title }) : t("还没选 · 可选"), muted: !resumeId },
      ]
      : activeStage === "oc"
        ? [
          { icon: "clock" as const, title: t("沟通时间"), text: ocAt ? formatApplicationListDateTime(ocAt) : t("选择沟通时间"), muted: !ocAt },
          { icon: "text" as const, title: t("口头薪酬"), text: ocSalary.trim() || t("可以之后补充"), muted: !ocSalary.trim() },
        ]
        : activeStage === "offer"
          ? [
            { icon: "cal" as const, title: t("回复截止"), text: shortDay(offerValues.replyDueOn) ?? t("还没填"), muted: !offerValues.replyDueOn },
            { icon: "text" as const, title: t("薪酬与地点"), text: [offerValues.salary.trim(), offerValues.baseLocation.trim()].filter(Boolean).join(" · ") || t("可以之后补充"), muted: !offerValues.salary.trim() && !offerValues.baseLocation.trim() },
          ]
          : activeStage === "screening"
            ? []
            : isWindow
              ? [
                { icon: "cal" as const, title: t("开放与截止"), text: t("{value0} 至 {value1}", { value0: scheduledStart ? formatApplicationListDateTime(scheduledStart) : t("现在"), value1: scheduledEnd ? formatApplicationListDateTime(scheduledEnd) : t("待选择截止时间") }) },
                { icon: "ccheck" as const, title: t("我的计划"), text: answerPlanStart ? formatApplicationListDateTime(answerPlanStart) : t("还没定，之后随时可以补"), muted: !answerPlanStart },
              ]
              : [
                { icon: "clock" as const, title: activeStage === "hr" ? t("沟通时间") : t("官方时间"), text: timeText, muted: !scheduledStart },
                { icon: "ccheck" as const, title: activeStage === "hr" ? t("沟通准备") : t("我的准备"), text: preparationNote.trim() || t("面试准备与复盘"), muted: !preparationNote.trim() },
              ]),
  ];
  const summaryNote = startsPending || activeStage === "screening"
    ? null
    : activeStage === "oc"
      ? t("OC 只是口头意向\n收到书面 Offer 后再记录正式 Offer")
      : activeStage === "offer"
        ? t("接受或婉拒后流程结束\n阶段记录和复盘都会保留")
        : isWindow
          ? t("截止时间过后自动进入「等待结果」\n无需手动标记完成")
          : activeStage === "hr"
            ? t("沟通结束后自动进入「等待结果」\n无需手动标记完成")
            : t("{value0}结束后自动进入「等待结果」\n无需手动标记完成", { value0: activeStage === "interview" ? t("面试") : stageName });
  // 待投递 → 筛选中（从看板拖进「筛选中」）：只需要一个投递日期，用上下布局的小弹窗——上面插画、下面内容
  if (startsPending && lockStageSelection && activeStage === "screening") {
    return <V3Dialog width={480} label={title} onClose={() => { if (!busy) onClose(); }} className="cd3-stage-dialog cd3-apply-dialog">
      <div className="cd3-apply-art v3-stage has-dots" aria-hidden="true">
        <Centered width={300} height={128}>
          <MiniResume x={28} y={18} w={70} h={92} rotate={-4} />
          <DashArrow x={110} y={57} w={72} />
          <TagCard x={194} y={36} text={titleApplication.company_name_snapshot || t("目标公司")} dot="var(--v3-bl)" />
          <TagCard x={194} y={66} text={t("筛选中")} dot="var(--v3-or)" />
          <Badge x={80} y={88} icon="send" size={26} />
        </Centered>
      </div>
      <div className="cd3-apply-body">
        <h2>{title}</h2>
        <p>{[titleApplication.company_name_snapshot, titleApplication.job_title_snapshot].filter(Boolean).join(" · ") || t("记录投递信息")}</p>
        <label className="cd3-stage-field">{t("投递日期（选填）")}<AppliedAtDatePicker id="career-next-stage-applied-at" value={appliedAt} onChange={setAppliedAt}/></label>
        <label className="cd3-stage-field cd3-link-field">{t("投递渠道")}<small>{t("选填")}</small><div className="cd3-input-icon"><V3Icon name="link" size={14}/><input aria-label={t("投递渠道（选填）")} placeholder={t("例如：同事内推、官网、招聘平台")} value={appliedChannel} maxLength={100} onChange={e=>setAppliedChannel(e.target.value)}/></div></label>
        <small className="cd3-apply-hint">{t("保存后岗位从「待投递」进入「筛选中」，等待公司筛选结果。")}</small>
        {errorMessage && <p className="cd3-stage-error" role="alert">{errorMessage}</p>}
      </div>
      <footer className="cd3-apply-footer"><button className="v3-btn" onClick={onClose} disabled={busy}>{t("取消")}</button><button className="v3-btn v3-btn-dark" disabled={!canSubmit} onClick={()=>void save()}>{busy ? t("保存中…") : t("保存求职进度")}</button></footer>
    </V3Dialog>;
  }
  return <V3Dialog width={880} label={title} onClose={() => { if (!busy) onClose(); }} className={`cd3-stage-dialog is-v4${usesInterviewForm ? " is-interview" : ""}${lockStageSelection ? " is-stage-locked" : ""}`}>
    <header className="cd3-stage-head"><h2>{title}</h2><p>{description ?? [titleApplication.company_name_snapshot, titleApplication.job_title_snapshot, t("现在：{value0}", { value0: projectApplicationProgress(selectedApplication).stageLabel })].filter(Boolean).join(" · ")}</p></header>
    <div className="cd3-stage-workspace">
      <aside className="cd3-stage-summary">
        <small>{summaryTitle}</small>
        <ol className="cd3-summary-track">{trackRows.map(row => <li key={row.key} className={row.current ? "is-current" : ""}><i aria-hidden="true"/><span>{row.label}</span>{row.current ? <b>{row.status}</b> : <em className={row.status === t("已通过") || row.status === t("已沟通") ? "" : "is-todo"}>{row.status}</em>}</li>)}</ol>
        {summaryRows.length > 0 && <div className="cd3-summary-steps"><small>{t("点「{value0}」后保存", { value0: submitLabel })}</small>{summaryRows.map(row => <div key={row.title} className={row.muted ? "is-muted" : ""}><span><V3Icon name={row.icon} size={14}/></span><p><strong>{row.title}</strong><small>{row.text}</small></p></div>)}</div>}
        {summaryNote && <p className="cd3-summary-note"><V3Icon name="clock" size={14}/><span>{summaryNote}</span></p>}
      </aside>
      <div className="cd3-stage-form">
        {applicationOptions && <label className="cd3-stage-field">{t("选择流程")}<V3Select label={t("选择流程")} value={selectedApplication.id} options={applicationOptions.map(item=>({value:item.id,label:`${item.company_name_snapshot} · ${item.job_title_snapshot}`}))} onChange={setSelectedApplicationId}/></label>}
        {!lockStageSelection && <><h3>{startsPending ? t("当前进度") : t("阶段")}</h3><div className="cd3-stage-choices" role="radiogroup" aria-label={t("选择下一阶段")}>{NEXT_STAGE_CHOICES.filter(choice => includeOffer || (choice.key !== "offer" && choice.key !== "oc")).map(choice=>{ const available = availableStages.some(item => item.key === choice.key); return <button type="button" key={choice.key} role="radio" aria-checked={activeStage === choice.key} disabled={busy || !available} className={activeStage === choice.key ? "is-active" : ""} onClick={()=>{setActiveStage(choice.key);setErrorMessage(null);}}><V3Icon name={iconNames[choice.key]} size={16}/><span>{choice.label}</span>{activeStage === choice.key && <i><V3Icon name="check" size={10}/></i>}</button>; })}</div></>}
        {startsPending && <div className="cd3-pending-fields">
          <label className="cd3-stage-field">{t("投递日期")}<small>{t("选填")}</small><AppliedAtDatePicker id="career-next-stage-applied-at" value={appliedAt} onChange={setAppliedAt}/></label>
          <label className="cd3-stage-field">{t("投递渠道")}<small>{t("选填")}</small><div className="cd3-input-icon"><V3Icon name="link" size={14}/><input aria-label={t("投递渠道（选填）")} placeholder={t("例如：同事内推、官网、招聘平台")} value={appliedChannel} maxLength={100} onChange={e=>setAppliedChannel(e.target.value)}/></div></label>
          <label className="cd3-stage-field">{t("关联简历")}<small>{t("选填")}</small><V3Select label={t("关联简历")} value={resumeId} disabled={busy || resumes === null} placeholder={resumes === null ? t("正在加载…") : resumes.length ? t("选择投递用的简历") : t("还没有简历")} options={[{ value: "", label: t("不关联简历") }, ...(resumes ?? []).map(item => ({ value: item.id, label: item.title }))]} onChange={setResumeId}/></label>
        </div>}
        {activeStage === "offer" ? <OfferDetailsFields values={offerValues} disabled={busy} onChange={setOfferValues}/> : activeStage === "screening" ? (!startsPending && <p className="cd3-stage-hint">{t("保存后进入筛选中，等待公司筛选结果。")}</p>) : activeStage === "oc" ? <div className="cd3-oc-fields">
          <label className="cd3-stage-field">{t("沟通时间 ")}<em>*</em><ScheduleDateTimePicker id="career-oc-at" label={t("沟通时间")} value={ocAt} required disabled={busy} onChange={setOcAt}/></label>
          <label className="cd3-stage-field">{t("沟通方式")}<input aria-label={t("沟通方式")} placeholder={t("例如：电话 · HR")} value={ocContact} maxLength={100} disabled={busy} onChange={e=>setOcContact(e.target.value)}/></label>
          <label className="cd3-stage-field">{t("口头薪酬")}<input aria-label={t("口头薪酬")} placeholder={t("例如：35K × 16 薪")} value={ocSalary} maxLength={100} disabled={busy} onChange={e=>setOcSalary(e.target.value)}/></label>
          <label className="cd3-stage-field">{t("预计到岗")}<input aria-label={t("预计到岗")} placeholder={t("例如：11 月上旬")} value={ocStart} maxLength={100} disabled={busy} onChange={e=>setOcStart(e.target.value)}/></label>
          <label className="cd3-stage-field cd3-field-wide">{t("补充说明")}<small>{t("可选 · 只提醒自己")}</small><input aria-label={t("补充说明")} placeholder={t("口头意向不等于正式 Offer，等书面确认后再更新结果")} value={ocNote} maxLength={500} disabled={busy} onChange={e=>setOcNote(e.target.value)}/></label>
        </div> : <>
          {activeStage === "interview" && <div className="cd3-interview-round"><label className="cd3-stage-field">{t("面试轮次")}<V3Select label={t("面试轮次")} disabled={scheduleOnly} value={["一面","二面","三面"].includes(interviewLabel) ? interviewLabel : interviewLabel ? "custom" : ""} placeholder={t("选择轮次")} options={[{value:"一面",label:t("一面")},{value:"二面",label:t("二面")},{value:"三面",label:t("三面")},{value:"custom",label:t("自定义")}]} onChange={value=>{setInterviewLabel(value === "custom" ? t("自定义面试") : value);if(value !== "custom")setInterviewRoundNo(String(["一面","二面","三面"].indexOf(value)+1));}}/></label>{interviewLabel && !["一面","二面","三面"].includes(interviewLabel) && <label className="cd3-stage-field">{t("面试名称")}<input aria-label={t("面试名称")} value={interviewLabel} maxLength={100} onChange={e=>setInterviewLabel(e.target.value)}/></label>}</div>}
          {/* 面试与 HR 面只有「按时参加」一种安排，不再显示单选项和说明 */}
          {!usesInterviewForm && <><h3 className="cd3-time-heading">{t("时间安排")}</h3><div className="cd3-time-choices" role="radiogroup" aria-label={t("时间安排")}>{[{value:"fixed_slot",title:t("按时参加"),sub:t("准点开始，有时长"),icon:"clock"},{value:"open_window",title:t("截止前完成"),sub:t("期间自己选时间"),icon:"flag"}].map(item=><button type="button" key={item.value} role="radio" aria-checked={isWindow === (item.value === "open_window")} disabled={busy || (activeStage === "assessment" && item.value === "fixed_slot") || (activeStage === "ai_interview" && item.value === "open_window")} className={isWindow === (item.value === "open_window") ? "is-active" : ""} onClick={()=>setWrittenScheduleKind(item.value as "fixed_slot" | "open_window")}><span><V3Icon name={item.icon as V3IconName} size={14}/></span><div><strong>{item.title}</strong><small>{activeStage === "ai_interview" && item.value === "open_window" ? t("AI 面试仅支持按时参加") : item.sub}</small></div>{isWindow === (item.value === "open_window") && <i><V3Icon name="check" size={10}/></i>}</button>)}</div></>}
          <div className="cd3-time-fields">{isWindow ? <><label className="cd3-stage-field">{t("截止时间 ")}<em>*</em><ScheduleDateTimePicker id="career-next-stage-end" label={t("截止时间")} value={scheduledEnd} required disabled={busy} onChange={setEnd}/></label><label className="cd3-stage-field">{t("开放时间 ")}<small>{t("不填从现在开始")}</small><ScheduleDateTimePicker id="career-next-stage-start" label={t("开放时间")} value={scheduledStart} placeholder={t("收到通知就开放")} disabled={busy} onChange={setStart}/></label></> : <><label className="cd3-stage-field">{activeStage === "hr" ? t("沟通时间 ") : t("开始时间 ")}<em>*</em><ScheduleDateTimePicker id="career-next-stage-start" label={activeStage === "written_test" ? t("笔试时间") : activeStage === "interview" ? t("面试时间") : activeStage === "hr" ? t("沟通时间") : t("开始时间")} value={scheduledStart} disabled={busy} onChange={setStart}/></label><label className="cd3-stage-field">{t("时长")}<V3Select label={t("时长")} value={String(scheduleDuration)} options={Array.from(new Set([30,60,90,120,180,scheduleDuration])).sort((a,b)=>a-b).map(value=>({value:String(value),label:t("{value0} 分钟", { value0: value })}))} onChange={value=>setDuration(Number(value))}/></label></>}</div>
          {isWindow && <>{activeStage === "assessment" && <div className="cd3-quick-deadlines">{[1,3,7].map(days=><button type="button" key={days} onClick={()=>chooseDeadline(days)} className={completionWindow === String(days*1440) && scheduledEnd ? "is-active" : ""}>{days===1?t("24 小时"):t("{value0} 天后", { value0: days })}</button>)}</div>}<label className="cd3-stage-field cd3-plan-field">{t("我的作答计划 ")}<small>{t("可选 · 只提醒自己，不改官方时间")}</small><ScheduleDateTimePicker id="career-next-stage-plan" label={t("我的作答计划")} value={answerPlanStart} placeholder={t("选一段打算作答的时间")} durationMinutes={answerPlanDuration} minimumStartAt={scheduledStart || schedulePickerValue(new Date().toISOString())} maximumEndAt={scheduledEnd || undefined} onChange={setAnswerPlanStart} onDurationMinutesChange={setAnswerPlanDuration}/></label></>}
          {usesInterviewForm ? <>
            <div className="cd3-mode-fields">
              <div className="cd3-stage-field cd3-mode-field">{activeStage === "hr" ? t("沟通方式") : t("面试方式")}<div className="cd3-mode-segmented" role="radiogroup" aria-label={activeStage === "hr" ? t("沟通方式") : t("面试方式")}>{[{value:"video",label:t("视频")},{value:"onsite",label:t("现场")},{value:"phone",label:t("电话")}].map(item=><button type="button" role="radio" aria-checked={interviewMode===item.value} className={interviewMode===item.value?"is-active":""} key={item.value} disabled={busy} onClick={()=>setInterviewMode(item.value as InterviewSessionRecord["mode"])}>{item.label}</button>)}</div></div>
              <label className="cd3-stage-field">{activeStage === "hr" ? t("联系人") : t("面试官")}<input aria-label={activeStage === "hr" ? t("联系人") : t("面试官")} placeholder={activeStage === "hr" ? t("例如：陈老师 · 招聘 HR") : t("例如：李老师 · 技术负责人")} value={interviewerName} maxLength={100} disabled={busy} onChange={e=>setInterviewerName(e.target.value)}/></label>
            </div>
            <label className="cd3-stage-field cd3-link-field">{interviewMode === "onsite" ? t("面试地点") : t("会议链接")}<small>{t("可选")}</small><div className="cd3-input-icon"><V3Icon name="link" size={14}/><input aria-label={t("面试链接或地点（选填）")} placeholder={interviewMode === "onsite" ? t("填写地点") : t("粘贴会议链接")} value={interviewMeetingOrLocation} maxLength={2048} onChange={e=>setInterviewMeetingOrLocation(e.target.value)}/></div></label>
            <label className="cd3-stage-field cd3-link-field">{activeStage === "hr" ? t("沟通准备") : t("准备提醒")}<small>{t("可选 · 只提醒自己")}</small><div className="cd3-input-icon"><V3Icon name="clock" size={14}/><input aria-label={t("备注（选填）")} placeholder={activeStage === "hr" ? t("例如：确认薪酬期望、到岗时间与工作地点") : t("例如：整理两个项目案例")} value={preparationNote} maxLength={100000} onChange={e=>setPreparationNote(e.target.value)}/></div></label>
          </> : <>
            {activeStage === "written_test" && !isWindow ? <><div className="cd3-stage-field cd3-mode-field">{t("方式")}<div className="cd3-mode-segmented" role="radiogroup" aria-label={t("笔试方式")}>{[{value:"video",label:t("在线")},{value:"onsite",label:t("线下")}].map(item=><button type="button" role="radio" aria-checked={writtenMode===item.value} className={writtenMode===item.value?"is-active":""} key={item.value} onClick={()=>setWrittenMode(item.value as "video"|"onsite")}>{item.label}</button>)}</div></div><label className="cd3-stage-field cd3-link-field">{writtenMode === "onsite" ? t("笔试地点") : t("笔试链接")}<small>{t("可选")}</small><div className="cd3-input-icon"><V3Icon name="link" size={14}/><input aria-label={t("笔试链接或地点（选填）")} placeholder={t("粘贴链接或填写地点")} value={writtenMeetingOrLocation} maxLength={2048} onChange={e=>setWrittenMeetingOrLocation(e.target.value)}/></div></label></> : <label className="cd3-stage-field cd3-link-field">{activeStage === "assessment" ? t("测评链接") : activeStage === "written_test" ? t("笔试链接") : t("面试链接")}<small>{t("可选")}</small><div className="cd3-input-icon"><V3Icon name="link" size={14}/><input aria-label={activeStage === "assessment" ? t("测评链接（选填）") : t("面试链接（选填）")} placeholder={t("粘贴链接")} maxLength={2048} value={activeStage === "written_test" ? writtenMeetingOrLocation : activeAsyncLink} onChange={e=>(activeStage === "written_test" ? setWrittenMeetingOrLocation : activeStage === "assessment" ? setAssessmentLink : setAiInterviewLink)(e.target.value)}/></div></label>}
            <button type="button" className="cd3-note-toggle" onClick={()=>setNoteOpen(!noteOpen)}><V3Icon name={noteOpen ? "chevu" : "plus"} size={12}/>{t("添加准备备注 ")}<small>{t("要带的材料、注意事项")}</small></button>{noteOpen && <textarea className="cd3-note-input" aria-label={t("备注（选填）")} value={preparationNote} maxLength={100000} onChange={e=>setPreparationNote(e.target.value)}/>}
          </>}
        </>}
        {errorMessage && <p className="cd3-stage-error" role="alert">{errorMessage}</p>}
      </div>
    </div><footer className="cd3-stage-footer"><small>{activeStage === "offer" || activeStage === "screening" || activeStage === "oc" ? "" : isWindow ? t("快速选择从现在开始算") : t("保存后可在面试日程中调整")}</small><button className="v3-btn" onClick={onClose} disabled={busy}>{t("取消")}</button><button className="v3-btn v3-btn-dark" disabled={!canSubmit} onClick={()=>void save()}>{busy ? t("保存中…") : submitLabel}</button></footer>
  </V3Dialog>;
}

function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const DATE_PICKER_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function parseDatePickerValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null;
}

function formatDatePickerValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDatePickerMonth(date: Date): string {
  return t("{value0}年{value1}月", { value0: date.getFullYear(), value1: date.getMonth() + 1 });
}

function formatDatePickerDay(date: Date): string {
  return t("{value0}年{value1}月{value2}日", { value0: date.getFullYear(), value1: date.getMonth() + 1, value2: date.getDate() });
}

function startOfDatePickerMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDatePickerMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

const APPLIED_DATE_PICKER_MAX_WIDTH = 320;
const APPLIED_DATE_PICKER_MAX_HEIGHT = 360;
const APPLIED_DATE_PICKER_VIEWPORT_GUTTER = 32;
const APPLIED_DATE_PICKER_GAP = 8;

function appliedDatePickerPosition(
  trigger: DOMRect,
  host: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
  renderedHeight = APPLIED_DATE_PICKER_MAX_HEIGHT,
): { left: number; top: number } {
  const pickerWidth = Math.min(
    APPLIED_DATE_PICKER_MAX_WIDTH,
    Math.max(0, viewportWidth - APPLIED_DATE_PICKER_VIEWPORT_GUTTER * 2),
  );
  const maximumLeft = Math.max(
    APPLIED_DATE_PICKER_VIEWPORT_GUTTER,
    viewportWidth - pickerWidth - APPLIED_DATE_PICKER_VIEWPORT_GUTTER,
  );
  const boundedLeft = Math.min(
    Math.max(trigger.left, APPLIED_DATE_PICKER_VIEWPORT_GUTTER),
    maximumLeft,
  );
  const pickerHeight = Math.min(
    renderedHeight || APPLIED_DATE_PICKER_MAX_HEIGHT,
    Math.max(0, viewportHeight - APPLIED_DATE_PICKER_VIEWPORT_GUTTER * 2),
  );
  const belowTop = trigger.bottom + APPLIED_DATE_PICKER_GAP;
  const aboveTop = trigger.top - APPLIED_DATE_PICKER_GAP - pickerHeight;
  const boundedTop = belowTop + pickerHeight <= viewportHeight - APPLIED_DATE_PICKER_VIEWPORT_GUTTER
    ? belowTop
    : Math.max(APPLIED_DATE_PICKER_VIEWPORT_GUTTER, aboveTop);
  return {
    left: boundedLeft - host.left,
    top: boundedTop - host.top,
  };
}

function buildDatePickerDays(month: Date): Date[] {
  const firstDay = startOfDatePickerMonth(month);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

function AppliedAtDatePicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => startOfDatePickerMonth(parseDatePickerValue(value) ?? new Date()));
  const [popoverHost, setPopoverHost] = useState<HTMLElement | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectedDate = parseDatePickerValue(value);
  const selectedValue = selectedDate ? formatDatePickerValue(selectedDate) : null;
  const calendarDays = useMemo(() => buildDatePickerDays(displayMonth), [displayMonth]);
  const monthLabel = formatDatePickerMonth(displayMonth);

  const closePicker = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const positionPopover = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const nextHost = window.innerWidth > 640
        ? pickerRef.current?.closest<HTMLElement>(".cd3-stage-dialog, .career-next-stage-dialog") ?? null
        : null;
      if (nextHost !== popoverHost) {
        setPopoverHost(nextHost);
        return;
      }
      if (!nextHost) {
        setPopoverPosition(null);
        return;
      }
      setPopoverPosition(appliedDatePickerPosition(
        trigger.getBoundingClientRect(),
        nextHost.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
        popoverRef.current?.getBoundingClientRect().height,
      ));
    };
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    const handlePointerDown = (event: Event) => {
      const target = event.target as Node;
      if (
        !pickerRef.current?.contains(target)
        && !popoverRef.current?.contains(target)
      ) closePicker();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("click", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("click", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, popoverHost]);

  const openPicker = () => {
    setDisplayMonth(startOfDatePickerMonth(selectedDate ?? new Date()));
    const nextHost = window.innerWidth > 640
      ? pickerRef.current?.closest<HTMLElement>(".cd3-stage-dialog, .career-next-stage-dialog") ?? null
      : null;
    setPopoverHost(nextHost);
    if (nextHost && triggerRef.current) {
      setPopoverPosition(appliedDatePickerPosition(
        triggerRef.current.getBoundingClientRect(),
        nextHost.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      ));
    } else {
      setPopoverPosition(null);
    }
    setOpen(true);
  };

  const selectDate = (date: Date) => {
    onChange(formatDatePickerValue(date));
    closePicker();
  };

  const today = () => {
    selectDate(new Date());
  };

  return (
    <div ref={pickerRef} className="career-date-picker">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="career-date-picker-trigger"
        aria-label={t("投递时间")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-calendar`}
        onClick={() => (open ? closePicker() : openPicker())}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            closePicker();
          }
        }}
      >
        <span>{selectedValue ?? t("选择日期")}</span>
        <CalendarDays aria-hidden="true" />
      </button>
      <MotionPresence>{open && (
        <SchedulePickerPortal host={popoverHost}>
          <MotionSurface as="div" variant="popover"
            ref={popoverRef}
            id={`${id}-calendar`}
            className="career-date-picker-popover career-applied-date-picker-popover"
            role="dialog"
            aria-label={t("选择投递时间")}
            style={popoverPosition ? { left: popoverPosition.left, right: "auto", top: popoverPosition.top } : undefined}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closePicker();
              }
            }}
          >
            <header className="career-date-picker-header">
              <strong aria-live="polite">{monthLabel}</strong>
              <div>
                <button
                  type="button"
                  aria-label={t("上一月")}
                  title={t("上一月")}
                  onClick={() => setDisplayMonth((current) => addDatePickerMonths(current, -1))}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={t("下一月")}
                  title={t("下一月")}
                  onClick={() => setDisplayMonth((current) => addDatePickerMonths(current, 1))}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="career-date-picker-calendar" role="grid" aria-label={t("{value0}日期", { value0: monthLabel })}>
              <div className="career-date-picker-weekdays" role="row">
                {weekdays().map((weekday) => (
                  <span key={weekday} role="columnheader">{weekday}</span>
                ))}
              </div>
              <div className="career-date-picker-days">
                {Array.from({ length: 6 }, (_, weekIndex) => (
                  <div key={weekIndex} className="career-date-picker-week" role="row">
                    {calendarDays.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => {
                      const dateValue = formatDatePickerValue(date);
                      const isSelected = dateValue === selectedValue;
                      const isCurrentMonth = date.getMonth() === displayMonth.getMonth()
                        && date.getFullYear() === displayMonth.getFullYear();
                      return (
                        <div
                          key={dateValue}
                          role="gridcell"
                          aria-label={formatDatePickerDay(date)}
                          aria-selected={isSelected}
                          className={!isCurrentMonth ? "is-adjacent-month" : undefined}
                        >
                          <button
                            type="button"
                            aria-label={formatDatePickerDay(date)}
                            className={isSelected ? "is-selected" : undefined}
                            onClick={() => selectDate(date)}
                          >
                            {date.getDate()}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <footer className="career-date-picker-footer">
              <button type="button" disabled={!value} onClick={() => { onChange(""); closePicker(); }}>{t("清除")}</button>
              <button type="button" onClick={today}>{t("今天")}</button>
            </footer>
          </MotionSurface>
        </SchedulePickerPortal>
      )}</MotionPresence>
    </div>
  );
}

export function MarkApplicationAppliedDialog({
  application,
  initialTargetColumnId,
  timezone,
  onClose,
  onChanged,
  onNotice,
}: {
  application: JobApplicationSummary;
  initialTargetColumnId?: string | null;
  timezone: string;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const initialInterviewLabel = initialTargetColumnId?.startsWith("interview:")
    ? initialTargetColumnId.slice("interview:".length)
    : "";
  const initialStageType: ApplicationStageType = initialTargetColumnId === "screening"
    || initialTargetColumnId === "assessment"
    || initialTargetColumnId === "written_test"
    || initialTargetColumnId === "ai_interview"
    || initialTargetColumnId === "offer"
    ? initialTargetColumnId
    : initialTargetColumnId?.startsWith("interview:")
      ? "interview"
      : "screening";
  const initialAppliedAt = (() => {
    const importedAt = new Date(application.created_at);
    return formatDatePickerValue(Number.isNaN(importedAt.getTime()) ? new Date() : importedAt);
  })();

  return (
    <AddNextStageDialog
      application={application}
      timezone={timezone}
      initialStage={initialStageType}
      initialInterviewLabel={initialInterviewLabel}
      initialAppliedAt={initialAppliedAt}
      lockStageSelection={initialTargetColumnId != null}
      title={t("投递岗位")}
      description={t("选择当前实际进度，可直接补录已经发生的阶段。")}
      onClose={onClose}
      onChanged={onChanged}
      onNotice={onNotice}
    />
  );
}

export function TerminateApplicationConfirmDialog({
  application,
  onClose,
  onChanged,
  onNotice,
}: {
  application: JobApplicationSummary;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const [busy, setBusy] = useState(false);

  const terminate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.terminateJobApplication(application.id, {
        client_request_id: crypto.randomUUID(),
        reason: "user_withdrew",
        base_lock_version: application.lock_version,
      });
      onClose();
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      kind="warning"
      title={t("终止这条求职记录？")}
      description={t("状态会变为“已主动结束”，笔试、面试和 Offer 历史仍保留。")}
      confirmLabel={t("确认终止")}
      busyLabel={t("正在终止…")}
      busy={busy}
      onCancel={onClose}
      onConfirm={terminate}
    />
  );
}

function OfferApplicationDialog({
  application,
  onClose,
  onChanged,
  onNotice,
}: {
  application: JobApplicationSummary;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const progress = projectApplicationProgress(application);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [offerValues, setOfferValues] = useState<OfferFormValues>({
    receivedOn: application.offer_received_on ?? "",
    replyDueOn: application.offer_reply_due_on ?? "",
    startOn: application.offer_start_on ?? "",
    baseLocation: application.offer_base_location ?? "",
    salary: application.offer_salary?.toString() ?? "",
    salaryCurrency: application.offer_salary_currency ?? "CNY",
    salaryPeriod: application.offer_salary_period ?? "month",
    benefitsDescription: application.offer_benefits_description ?? "",
    probation: application.offer_probation ?? "",
    materialIds: application.offer_materials?.map((item) => item.dataset_id),
  });

  const submit = async () => {
    if (busy) return;
    const validationError = offerFormError(offerValues);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage(null);
    setBusy(true);
    try {
      await api.recordJobApplicationOffer(
        application.id,
        offerRequestPayload(offerValues, application.lock_version),
      );
      onClose();
      await onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-stage-dialog career-offer-dialog">
        <DialogHeader>
          <DialogTitle>{t("Offer 信息")}</DialogTitle>
          <DialogDescription>{t("当前阶段：")}{progress.stageLabel}{t("。所有信息均为选填，可以稍后补充或清空。")}</DialogDescription>
        </DialogHeader>
        <OfferDetailsFields values={offerValues} disabled={busy} onChange={setOfferValues} />
        {errorMessage && <p className="career-next-stage-error" role="alert">{errorMessage}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t("取消")}</Button>
          <Button disabled={Boolean(offerFormError(offerValues)) || busy} onClick={() => void submit()}>
            {busy ? t("保存中…") : t("保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApplicationDetailView({
  application,
  sessions,
  timezone,
  onBack,
  onChanged,
  onNotice,
}: {
  application: JobApplicationSummary | null;
  sessions: InterviewSessionSummary[];
  timezone: string;
  onBack: () => void;
  onCreateInterview: (applicationId: string) => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [formalOfferOpen, setFormalOfferOpen] = useState(false);
  const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelSessionOpen, setCancelSessionOpen] = useState(false);
  const [offerDecision, setOfferDecision] = useState<"accepted" | "declined" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!application) {
    return (
      <section className="career-detail-not-found">
        <BriefcaseBusiness aria-hidden="true" />
        <h1>{t("无法打开这条求职进程")}</h1>
        <p>{t("记录不存在、已被删除，或当前账号没有访问权限。")}</p>
        <Button variant="outline" onClick={onBack}>{t("返回求职记录")}</Button>
      </section>
    );
  }
  const now = new Date();
  const model = buildApplicationDetail(application, sessions, now);
  const applicationSessions = sessions
    .filter((session) => session.application_id === application.id)
    .sort((left, right) => new Date(right.start_at).getTime() - new Date(left.start_at).getTime());
  const currentSession = applicationSessions.find((session) => (
    session.status !== "cancelled" && applicationStageMatchesSession(application, session)
  ));
  const latestRecorded = applicationSessions.find((session) => effectiveSessionStatus(session, now) === "completed");
  const progress = projectApplicationProgress(application);
  const active = application.lifecycle_status !== "terminated" && application.status === "active" && application.archived_at === null;
  const currentStableType = application.current_stage?.stage_type;
  const canSchedule = active && application.stage_state === "awaiting_schedule"
    && (currentStableType
      ? ["assessment", "written_test", "ai_interview", "interview"].includes(currentStableType)
      : progress.columnKey === "assessment"
        || progress.columnKey === "written_test"
        || progress.columnKey === "interview");
  const canTerminate = active && application.offer_status === "none";
  const canDelete = progress.columnKey === "ended";
  const scheduleActionLabel = t("安排{value0}时间", { value0: application.current_stage_label ?? progress.stageLabel });
  const reviewPath = latestRecorded
    ? `/career/reviews?session=${encodeURIComponent(latestRecorded.id)}&application=${encodeURIComponent(application.id)}`
    : "/career/reviews";
  const openSession = (sessionId: string) => navigateTo(careerApplicationPath(application.id, sessionId), { state: { careerSessionDialog: true } });
  const openJob = () => application.job_description_id
    ? navigateTo(jobDetailPath(application.job_description_id, application.id))
    : onNotice(t("原岗位资料已不可用。"));
  const run = async (operation: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      after?.();
      await onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const handleAction = (action: DetailAction) => {
    switch (action) {
      case "record-applied":
      case "advance":
      case "schedule":
        setStageDialogOpen(true);
        return;
      case "record-review":
      case "answer-plan":
        if (currentSession) openSession(currentSession.id);
        return;
      case "reschedule":
        if (currentSession) setRescheduleOpen(true);
        return;
      case "cancel-session":
        if (currentSession) setCancelSessionOpen(true);
        return;
      case "record-offer":
        // A verbal offer (OC) becomes formal through a new Offer stage.
        if (currentStableType === "oc") setFormalOfferOpen(true);
        else setOfferDialogOpen(true);
        return;
      case "edit-offer":
        setOfferDialogOpen(true);
        return;
      case "accept-offer":
        setOfferDecision("accepted");
        return;
      case "decline-offer":
        setOfferDecision("declined");
        return;
      case "view-review":
        navigateTo(reviewPath);
    }
  };
  return (
    <div className="career-application-detail-page">
      <ApplicationProgressPage
        application={application}
        model={model}
        latestRecordedSessionId={latestRecorded?.id ?? null}
        busy={busy}
        onBack={onBack}
        onOpenJob={openJob}
        onToggleFavorite={() => void run(() => api.updateJobApplication(application.id, { is_favorite: !application.is_favorite, base_lock_version: application.lock_version }))}
        onAction={handleAction}
        onOpenSession={openSession}
        onOfferCardAction={() => handleAction(model.verbalOffer ? "record-offer" : "edit-offer")}
        menu={{
          onEditDelivery: progress.isPending || !active ? undefined : openJob,
          onManageResources: () => navigateTo("/datasets"),
          onArchive: application.archived_at === null && !active
            ? () => void run(() => api.archiveJobApplication(application.id, application.lock_version), onBack)
            : undefined,
          onTerminate: canTerminate ? () => setTerminateDialogOpen(true) : undefined,
          onDelete: canDelete ? () => setDeleteDialogOpen(true) : undefined,
        }}
      />
      <MotionPresence>{stageDialogOpen && (progress.isPending
        ? <MarkApplicationAppliedDialog application={application} timezone={timezone} onClose={() => setStageDialogOpen(false)} onChanged={onChanged} onNotice={onNotice} />
        : <AddNextStageDialog
          application={application}
          timezone={timezone}
          scheduleOnly={canSchedule}
          lockStageSelection={canSchedule}
          initialStage={canSchedule ? currentStableType ?? (progress.columnKey === "assessment" ? "assessment" : progress.columnKey === "written_test" ? "written_test" : "interview") : undefined}
          initialInterviewLabel={canSchedule ? application.current_stage_label ?? progress.stageLabel : undefined}
          title={canSchedule ? scheduleActionLabel : undefined}
          onClose={() => setStageDialogOpen(false)}
          onChanged={onChanged}
          onNotice={onNotice}
        />)}</MotionPresence>
      <MotionPresence>{offerDialogOpen && <OfferApplicationDialog application={application} onClose={() => setOfferDialogOpen(false)} onChanged={onChanged} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{formalOfferOpen && (
        <AddNextStageDialog
          application={application}
          timezone={timezone}
          initialStage="offer"
          lockStageSelection
          title={t("记录正式 Offer")}
          onClose={() => setFormalOfferOpen(false)}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}</MotionPresence>
      <MotionPresence>{terminateDialogOpen && <TerminateApplicationConfirmDialog application={application} onClose={() => setTerminateDialogOpen(false)} onChanged={onChanged} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{rescheduleOpen && currentSession && <EditInterviewScheduleDialog session={currentSession} recordKind={sessionRecordKind(currentSession) === "笔试" ? "笔试" : "面试"} onClose={() => setRescheduleOpen(false)} onChanged={onChanged} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{cancelSessionOpen && currentSession && (
        <ConfirmDialog
          kind="warning"
          title={t("取消「{value0}」这场安排？", { value0: currentSession.stage_label })}
          description={t("取消后阶段回到“等待安排”，可以重新安排时间；已上传的资料会保留。")}
          confirmLabel={t("取消本场")}
          busyLabel={t("正在取消…")}
          busy={busy}
          onCancel={() => setCancelSessionOpen(false)}
          onConfirm={() => void run(
            () => api.cancelInterviewSession(currentSession.id, { base_lock_version: currentSession.lock_version }),
            () => setCancelSessionOpen(false),
          )}
        />
      )}</MotionPresence>
      <MotionPresence>{offerDecision && (
        <ConfirmDialog
          kind={offerDecision === "accepted" ? "warning" : "delete"}
          title={offerDecision === "accepted"
            ? t("接受「{value0}」的 Offer？", { value0: application.company_name_snapshot })
            : t("婉拒「{value0}」的 Offer？", { value0: application.company_name_snapshot })}
          description={offerDecision === "accepted"
            ? t("接受后这次求职会标记为已结束，阶段记录和复盘仍然保留。")
            : t("婉拒后这次求职会结束，阶段记录和复盘仍然保留。")}
          confirmLabel={offerDecision === "accepted" ? t("接受 Offer") : t("婉拒")}
          busyLabel={t("正在保存…")}
          busy={busy}
          onCancel={() => setOfferDecision(null)}
          onConfirm={() => void run(
            () => api.closeJobApplication(application.id, { status: "closed", offer_status: offerDecision, base_lock_version: application.lock_version }),
            () => setOfferDecision(null),
          )}
        />
      )}</MotionPresence>
      <MotionPresence>{deleteDialogOpen && (
        <ConfirmDialog
          kind="delete"
          title={t("永久删除「{value0} · {value1}」？", { value0: application.company_name_snapshot, value1: application.job_title_snapshot })}
          description={application.job_description_id
            ? t("删除后，该岗位及其求职进程、阶段、排期和复盘都将无法恢复；关联素材的原文件仍保留在资料库。")
            : t("该岗位资料已不存在；删除后，这次求职进程及其阶段、排期和复盘都将无法恢复，关联素材的原文件仍保留在资料库。")}
          confirmLabel={t("永久删除")}
          busyLabel={t("正在删除…")}
          busy={busy}
          onCancel={() => setDeleteDialogOpen(false)}
          onConfirm={() => void run(() => api.deleteJobApplication(application.id), onBack)}
        />
      )}</MotionPresence>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function DatasetPicker({
  sessionId,
  onAttached,
  onNotice,
}: {
  sessionId: string;
  onAttached: () => void;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const [datasets, setDatasets] = useState<DatasetRecord[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api.listDatasets().then((response) => {
      if (cancelled) return;
      setDatasets(
        response.datasets.filter(
          (item) =>
            !item.interview_session_id && item.upload_status === "succeeded",
        ),
      );
    }).catch((error) => {
      if (!cancelled) onNotice(requestErrorMessage(error));
    });
    return () => { cancelled = true; };
  }, [onNotice]);
  const attach = async (dataset: DatasetRecord) => {
    setBusyId(dataset.id);
    try {
      await api.attachInterviewAsset(sessionId, dataset.id);
      onAttached();
    } catch (error) {
      onNotice(requestErrorMessage(error));
      setBusyId(null);
    }
  };
  return (
    <section className="career-content-library-method" aria-label={t("可选择的资料库文件")}>
      <div className="career-session-assets">
        {datasets === null && <p>{t("正在加载资料库…")}</p>}
        {datasets !== null && datasets.length === 0 && (
          <p>{t("资料库中没有可关联的文件。可以先在资料库页面上传。")}</p>
        )}
        {datasets?.map((dataset) => (
          <article key={dataset.id}>
            <span className="career-session-asset-icon"><FileText aria-hidden="true" /></span>
            <div>
              <strong title={dataset.file_name}>{dataset.file_name}</strong>
              <small>{formatBytes(dataset.file_size)}</small>
            </div>
            <div className="career-session-asset-actions">
              <Button
                size="sm"
                variant="outline"
                disabled={busyId !== null}
                onClick={() => void attach(dataset)}
              >
                {busyId === dataset.id ? t("关联中…") : t("关联")}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SessionAssetList({
  assets,
  recordKind,
  hasTextRecord,
  onEmptyAction,
  sessionId,
  onChanged,
  onNotice,
}: {
  assets: InterviewAssetRecord[];
  recordKind: "笔试" | "面试";
  hasTextRecord: boolean;
  onEmptyAction?: () => void;
  sessionId: string;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioVolumeRef = useRef<HTMLDivElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [assetToRemove, setAssetToRemove] = useState<InterviewAssetRecord | null>(null);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(0);
  const [audioCurrentSeconds, setAudioCurrentSeconds] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState(1);
  const [audioVolumeOpen, setAudioVolumeOpen] = useState(false);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => {
    if (!audioVolumeOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!audioVolumeRef.current?.contains(event.target as Node)) setAudioVolumeOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [audioVolumeOpen]);
  const play = async (asset: InterviewAssetRecord) => {
    setBusyAssetId(asset.id);
    try {
      const blob = await api.downloadInterviewAsset(asset.id);
      const url = URL.createObjectURL(blob);
      setAudioUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
      setActiveAssetId(asset.id);
      setAudioDurationSeconds((asset.duration_ms ?? 0) / 1000);
      setAudioCurrentSeconds(0);
      setAudioPlaying(false);
      setAudioVolumeOpen(false);
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusyAssetId(null);
    }
  };
  const download = async (asset: InterviewAssetRecord) => {
    setBusyAssetId(asset.id);
    try {
      const blob = await api.downloadInterviewAsset(asset.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = asset.original_file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusyAssetId(null);
    }
  };
  const remove = async (asset: InterviewAssetRecord) => {
    setBusyAssetId(asset.id);
    try {
      await api.unlinkSessionAsset(sessionId, asset.id);
      setAssetToRemove(null);
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusyAssetId(null);
    }
  };
  const toggleAudioPlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.duration && audio.currentTime >= audio.duration) audio.currentTime = 0;
      void audio.play().catch(() => onNotice(t("暂时无法播放这段录音。")));
      return;
    }
    audio.pause();
  };
  const seekAudio = (nextTime: number) => {
    const audio = audioRef.current;
    if (!audio || audioDurationSeconds <= 0) return;
    audio.currentTime = Math.min(Math.max(nextTime, 0), audioDurationSeconds);
    setAudioCurrentSeconds(audio.currentTime);
  };
  const changeAudioVolume = (nextVolume: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const normalizedVolume = Math.min(1, Math.max(0, nextVolume));
    if (normalizedVolume === 0) {
      audio.muted = true;
      setAudioMuted(true);
      return;
    }
    audio.volume = normalizedVolume;
    audio.muted = false;
    setAudioVolume(normalizedVolume);
    setAudioMuted(false);
  };
  const audioProgress = audioDurationSeconds > 0
    ? Math.min(100, Math.max(0, (audioCurrentSeconds / audioDurationSeconds) * 100))
    : 0;
  return (
    <>
      {assets.length ? <div className="career-session-assets">{assets.map((asset) => <article key={asset.id}>
        <span className="career-session-asset-icon"><FileAudio aria-hidden="true" /></span>
        <div><strong title={asset.original_file_name}>{asset.original_file_name}</strong><small>{formatDuration(asset.duration_ms) ?? formatBytes(asset.file_size)} · {asset.source_type === "recorded" ? t("现场录制") : t("文件上传")}</small></div>
        <div className="career-session-asset-actions">
          {asset.asset_type === "audio" && <button type="button" aria-label={`${activeAssetId === asset.id ? t("重新播放") : t("播放录音")} ${asset.original_file_name}`} title={activeAssetId === asset.id ? t("重新播放") : t("播放录音")} disabled={busyAssetId === asset.id} onClick={() => void play(asset)}><Play aria-hidden="true" /></button>}
          <button type="button" aria-label={t("下载 {value0}", { value0: asset.original_file_name })} disabled={busyAssetId === asset.id} onClick={() => void download(asset)}><Download aria-hidden="true" /></button>
          <button type="button" aria-label={t("移除 {value0}", { value0: asset.original_file_name })} disabled={busyAssetId === asset.id} onClick={() => setAssetToRemove(asset)}><Trash2 aria-hidden="true" /></button>
        </div>
        {audioUrl && activeAssetId === asset.id && <div className="career-session-audio-player" role="group" aria-label={t("{value0}录音播放器", { value0: t(recordKind) })}>
          <audio
            ref={audioRef}
            autoPlay
            src={audioUrl}
            onLoadedMetadata={(event) => setAudioDurationSeconds(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : (asset.duration_ms ?? 0) / 1000)}
            onDurationChange={(event) => { if (Number.isFinite(event.currentTarget.duration)) setAudioDurationSeconds(event.currentTarget.duration); }}
            onTimeUpdate={(event) => setAudioCurrentSeconds(event.currentTarget.currentTime)}
            onPlay={() => setAudioPlaying(true)}
            onPause={() => setAudioPlaying(false)}
            onEnded={() => setAudioPlaying(false)}
          />
          <button type="button" aria-label={audioPlaying ? t("暂停录音") : t("播放录音")} onClick={toggleAudioPlayback}>{audioPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          <span>{formatPlaybackTime(audioCurrentSeconds)} / {formatPlaybackTime(audioDurationSeconds)}</span>
          <input
            type="range"
            aria-label={t("录音播放进度")}
            min="0"
            max={audioDurationSeconds || 0}
            step="0.1"
            value={Math.min(audioCurrentSeconds, audioDurationSeconds || 0)}
            disabled={audioDurationSeconds <= 0}
            style={{ "--audio-progress": `${audioProgress}%` } as CSSProperties}
            onChange={(event) => seekAudio(Number(event.target.value))}
          />
          <div ref={audioVolumeRef} className="career-session-audio-volume">
            {audioVolumeOpen && <div className="career-session-audio-volume-popover" id="career-session-audio-volume-control">
              <input
                type="range"
                aria-label={t("录音音量")}
                aria-orientation="vertical"
                aria-valuetext={`${Math.round((audioMuted ? 0 : audioVolume) * 100)}%`}
                min="0"
                max="1"
                step="0.05"
                value={audioMuted ? 0 : audioVolume}
                onChange={(event) => changeAudioVolume(Number(event.target.value))}
              />
            </div>}
            <button type="button" aria-label={t("调整音量")} title={t("调整音量")} aria-expanded={audioVolumeOpen} aria-controls="career-session-audio-volume-control" onClick={() => setAudioVolumeOpen((open) => !open)}>{audioMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</button>
          </div>
        </div>}
      </article>)}</div> : !hasTextRecord && <div className="career-session-empty-content"><FileText aria-hidden="true" /><strong>{t("尚未添加")}{t(recordKind)}{t("内容")}</strong><p>{t("上传音频文件，从资料库选择，或粘贴文字记录。")}</p>{onEmptyAction && <Button variant="outline" icon={<FilePlus2 />} onClick={onEmptyAction}>{t("添加")}{t(recordKind)}{t("内容")}</Button>}</div>}
      <MotionPresence>{assetToRemove && <ConfirmDialog
        kind="delete"
        title={t("从{value0}记录中移除文件？", { value0: t(recordKind) })}
        description={t("确定移除「{value0}」吗？资料库中的原文件不会被删除。", { value0: assetToRemove.original_file_name })}
        confirmLabel={t("移除文件")}
        busyLabel={t("移除中…")}
        busy={busyAssetId === assetToRemove.id}
        onCancel={() => setAssetToRemove(null)}
        onConfirm={() => void remove(assetToRemove)}
      />}</MotionPresence>
    </>
  );
}

const AUDIO_FILE_ACCEPT = ".webm,.m4a,.mp3,.wav,.ogg,.mp4,.mov,.pdf,.docx,.md,.txt";
const AUDIO_FILE_EXTENSIONS = new Set(
  AUDIO_FILE_ACCEPT
    .split(",")
    .filter((value) => value.startsWith(".")),
);

function isAudioFile(file: File): boolean {
  if (file.type.toLowerCase().startsWith("audio/")) return true;
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return AUDIO_FILE_EXTENSIONS.has(extension);
}

export function AddInterviewContentDialog({
  session,
  recordKind,
  mode = "add",
  initialText = "",
  initialMode = "audio",
  onClose,
  onChanged,
  onNotice,
}: {
  session: InterviewSessionRecord;
  recordKind: "笔试" | "面试";
  mode?: "add" | "edit";
  initialText?: string;
  initialMode?: "audio" | "library" | "text";
  onClose: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);
  const [file, setFile] = useState<File | null>(null);
  const [contentMode, setContentMode] = useState<"audio" | "library" | "text">(initialMode);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const isEditing = mode === "edit";
  const selectAudioFile = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!isAudioFile(candidate)) {
      if (inputRef.current) inputRef.current.value = "";
      onNotice(t("仅支持音视频与文档格式文件。"));
      return;
    }
    setContentMode("audio");
    setFile(candidate);
    setText("");
  };
  const switchContentMode = (nextMode: "audio" | "library" | "text") => {
    setContentMode(nextMode);
    if (nextMode === "audio") {
      setText("");
      return;
    }
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };
  const save = async () => {
    if ((!isEditing && contentMode === "audio" && !file) || ((isEditing || contentMode === "text") && !text.trim())) return;
    setBusy(true);
    try {
      if (isEditing) {
        await api.updateInterviewSession(session.id, { questions_markdown: text.trim(), base_lock_version: session.lock_version });
      } else if (contentMode === "audio" && file) {
        await api.uploadInterviewAsset(session.id, file, "uploaded");
      } else if (text.trim()) {
        await api.updateInterviewSession(session.id, { questions_markdown: text.trim(), base_lock_version: session.lock_version });
      }
      onClose();
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-content-dialog">
        <DialogHeader className="career-content-dialog-header"><DialogTitle>{isEditing ? t("编辑{value0}文字记录", { value0: t(recordKind) }) : t("添加{value0}内容", { value0: t(recordKind) })}</DialogTitle><DialogDescription>{isEditing ? t("修改已保存的{value0}文字记录。", { value0: t(recordKind) }) : t("选择一种方式保存本场{value0}记录。", { value0: t(recordKind) })}</DialogDescription></DialogHeader>
        {!isEditing && <div className="career-content-method-switch" role="tablist" aria-label={t("{value0}记录添加方式", { value0: t(recordKind) })}>
          <button type="button" role="tab" aria-selected={contentMode === "audio"} className={contentMode === "audio" ? "is-active" : undefined} onClick={() => switchContentMode("audio")}><Import aria-hidden="true" />{t("上传文件")}</button>
          <button type="button" role="tab" aria-selected={contentMode === "library"} className={contentMode === "library" ? "is-active" : undefined} onClick={() => switchContentMode("library")}><FolderOpen aria-hidden="true" />{t("从资料库选择")}</button>
          <button type="button" role="tab" aria-selected={contentMode === "text"} className={contentMode === "text" ? "is-active" : undefined} onClick={() => switchContentMode("text")}><FileText aria-hidden="true" />{t("粘贴文字")}</button>
        </div>}
        {!isEditing && contentMode === "audio" &&
          <section className="career-content-upload-method">
            <div
              className={`career-content-dropzone${dragActive ? " is-dragging" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => { event.preventDefault(); setDragActive(false); selectAudioFile(event.dataTransfer.files?.[0]); }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
            >
              <Import aria-hidden="true" />
              <strong>{file ? file.name : t("点击选择或拖放文件")}</strong>
              <span>{file ? t("{value0} · 已选择", { value0: formatBytes(file.size) }) : t("支持音视频与 PDF、DOCX、Markdown、TXT")}</span>
            </div>
            <input ref={inputRef} className="visually-hidden" type="file" accept={AUDIO_FILE_ACCEPT} aria-label={t("面试素材文件")} onChange={(event) => selectAudioFile(event.target.files?.[0])} />
          </section>
        }
        {!isEditing && contentMode === "library" && <DatasetPicker sessionId={session.id} onAttached={() => { onClose(); onChanged(); }} onNotice={onNotice} />}
        {(isEditing || contentMode === "text") && <section className="career-content-text-method">
          {isEditing && <h3>{t(recordKind)}{t("文字记录")}</h3>}
          <textarea aria-label={t("{value0}文字记录", { value0: t(recordKind) })} value={text} onChange={(event) => setText(event.target.value)} placeholder={t("粘贴{value0}过程、逐字稿或整理后的文字记录…", { value0: t(recordKind) })} />
        </section>}
        <DialogFooter className="career-content-dialog-footer">
          <Button variant="outline" onClick={onClose}>{t("取消")}</Button>
          {(isEditing || contentMode !== "library") && <Button disabled={busy || (isEditing || contentMode === "text" ? !text.trim() : !file)} onClick={() => void save()}>{busy ? t("保存中…") : isEditing ? t("保存修改") : t("保存内容")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteInterviewTextConfirmDialog({
  session,
  recordKind,
  onClose,
  onDeleted,
  onNotice,
}: {
  session: InterviewSessionRecord;
  recordKind: "笔试" | "面试";
  onClose: () => void;
  onDeleted: () => void;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api.updateInterviewSession(session.id, {
        questions_markdown: null,
        base_lock_version: session.lock_version,
      });
      onClose();
      onDeleted();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      kind="delete"
      overlayClassName="bg-[var(--scrim)]"
      title={t("删除{value0}文字记录？", { value0: t(recordKind) })}
      description={t("删除后将无法恢复这条{value0}文字记录。", { value0: t(recordKind) })}
      confirmLabel={t("删除记录")}
      busyLabel={t("删除中…")}
      busy={busy}
      onCancel={onClose}
      onConfirm={remove}
    />
  );
}

function schedulePickerValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatScheduleDateTimeValue(
    date,
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  );
}

export function EditInterviewScheduleDialog({
  session,
  recordKind,
  onClose,
  onChanged,
  onNotice,
}: {
  session: InterviewSessionRecord;
  recordKind: "笔试" | "面试";
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const initialDurationMinutes = Math.max(
    1,
    Math.round((new Date(session.end_at).getTime() - new Date(session.start_at).getTime()) / 60_000),
  );
  const initialMeetingOrLocation = session.mode === "onsite" || session.mode === "other"
    ? session.location ?? ""
    : session.meeting_url ?? "";
  const [startAt, setStartAt] = useState(() => schedulePickerValue(session.start_at));
  const [durationMinutes, setDurationMinutes] = useState(String(initialDurationMinutes));
  const [mode, setMode] = useState<InterviewSessionRecord["mode"]>(session.mode);
  const [meetingOrLocation, setMeetingOrLocation] = useState(initialMeetingOrLocation);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);

  const parsedStart = parseScheduleStart(startAt);
  const parsedDuration = Number(durationMinutes);
  const parsedEnd = parsedStart && Number.isFinite(parsedDuration) && parsedDuration > 0
    ? new Date(parsedStart.getTime() + parsedDuration * 60_000)
    : null;
  const scheduleChanged = Boolean(parsedStart && parsedEnd) && (
    parsedStart!.getTime() !== new Date(session.start_at).getTime()
    || parsedEnd!.getTime() !== new Date(session.end_at).getTime()
  );
  const normalizedMeetingOrLocation = meetingOrLocation.trim();
  const detailsChanged = mode !== session.mode
    || (mode === "onsite" || mode === "other"
      ? normalizedMeetingOrLocation !== (session.location ?? "") || session.meeting_url !== null
      : normalizedMeetingOrLocation !== (session.meeting_url ?? "") || session.location !== null);
  const canSubmit = Boolean(parsedStart && parsedEnd)
    && Number.isInteger(parsedDuration)
    && parsedDuration > 0
    && parsedDuration <= 525_600
    && (scheduleChanged || detailsChanged)
    && !busy;

  const updateField = (update: () => void) => {
    update();
    setErrorMessage(null);
    setHasConflict(false);
  };

  const save = async (allowConflict = false) => {
    if (!parsedStart || !parsedEnd || !canSubmit) return;
    setBusy(true);
    setErrorMessage(null);
    let currentLockVersion = session.lock_version;
    let scheduleWasSaved = false;
    try {
      if (scheduleChanged) {
        try {
          const response = await api.rescheduleInterviewSession(session.id, {
            start_at: parsedStart.toISOString(),
            duration_minutes: parsedDuration,
            timezone: session.timezone,
            allow_conflict: allowConflict,
            base_lock_version: currentLockVersion,
          });
          currentLockVersion = response.session.lock_version;
          scheduleWasSaved = true;
          setHasConflict(false);
        } catch (error) {
          if (error instanceof ApiRequestError && error.message === "INTERVIEW_TIME_CONFLICT" && !allowConflict) {
            setHasConflict(true);
            return;
          }
          throw error;
        }
      }

      if (detailsChanged) {
        try {
          await api.updateInterviewSession(session.id, {
            mode,
            meeting_url: mode === "video" || mode === "phone" ? normalizedMeetingOrLocation || null : null,
            location: mode === "onsite" || mode === "other" ? normalizedMeetingOrLocation || null : null,
            base_lock_version: currentLockVersion,
          });
        } catch (error) {
          if (scheduleWasSaved) {
            onClose();
            await onChanged();
            onNotice(t("已更新{value0}时间，但方式或链接保存失败，请重新修改。", { value0: t(recordKind) }));
            return;
          }
          throw error;
        }
      }

      onClose();
      await onChanged();
    } catch (error) {
      setErrorMessage(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const meetingOrLocationLabel = mode === "onsite" || mode === "other" ? t("地点") : t("链接");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-stage-dialog career-next-stage-dialog career-edit-schedule-dialog">
        <DialogHeader className="career-next-stage-dialog-header">
          <DialogTitle>{t("修改")}{t(recordKind)}{t("安排")}</DialogTitle>
          <DialogDescription>{t("调整时间、方式以及")}{t(recordKind)}{t("链接或地点。")}</DialogDescription>
        </DialogHeader>
        <div className="career-next-stage-panel">
          <div className="career-next-stage-form">
            <div className="career-next-stage-field career-next-stage-field--full">
              <Label htmlFor="career-edit-session-start">{t(recordKind)}{t("时间")}</Label>
              <ScheduleDateTimePicker
                id="career-edit-session-start"
                label={t("{value0}时间", { value0: t(recordKind) })}
                value={startAt}
                durationMinutes={parsedDuration}
                required
                disabled={busy}
                onChange={(value) => updateField(() => setStartAt(value))}
                onDurationMinutesChange={(value) => updateField(() => setDurationMinutes(String(value)))}
              />
            </div>
            <div className="career-next-stage-field">
              <Label htmlFor="career-edit-session-mode">{t(recordKind)}{t("方式")}</Label>
              <Select
                value={mode}
                onValueChange={(value) => updateField(() => setMode(value as InterviewSessionRecord["mode"]))}
                disabled={busy}
              >
                <SelectTrigger id="career-edit-session-mode" aria-label={t("{value0}方式", { value0: t(recordKind) })} className="career-next-stage-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="career-next-stage-select-content">
                  <SelectItem value="video">{t("线上")}</SelectItem>
                  <SelectItem value="onsite">{t("线下")}</SelectItem>
                  <SelectItem value="phone">{t("电话")}</SelectItem>
                  <SelectItem value="other">{t("其他")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="career-next-stage-field">
              <Label htmlFor="career-edit-session-location">{meetingOrLocationLabel}{t("（选填）")}</Label>
              <input
                id="career-edit-session-location"
                value={meetingOrLocation}
                maxLength={mode === "onsite" || mode === "other" ? 500 : 2048}
                disabled={busy}
                placeholder={mode === "onsite" || mode === "other" ? t("填写地点") : t("粘贴链接")}
                onChange={(event) => updateField(() => setMeetingOrLocation(event.target.value))}
              />
            </div>
          </div>
          {hasConflict && (
            <FeedbackNotice className="career-edit-schedule-notice" kind="warning" title={t("时间存在冲突")}>{t("这个时间段与其他安排重叠。你可以返回修改，或仍然保存。")}</FeedbackNotice>
          )}
          {errorMessage && <FeedbackNotice className="career-edit-schedule-notice" kind="error">{errorMessage}</FeedbackNotice>}
        </div>
        <DialogFooter className="career-next-stage-dialog-footer">
          <div />
          <div className="career-next-stage-dialog-footer-actions">
            <Button variant="outline" disabled={busy} onClick={onClose}>{t("取消")}</Button>
            <Button disabled={!canSubmit} onClick={() => void save(hasConflict)}>
              {busy ? t("正在保存…") : hasConflict ? t("仍然保存") : t("保存修改")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InterviewAnswerPlanSection({
  session,
  canEdit,
  inRecordDialog = false,
  onChanged,
}: {
  session: InterviewSessionRecord;
  canEdit: boolean;
  inRecordDialog?: boolean;
  onChanged: () => void | Promise<void>;
}) {
  useLocale();
  const [planStartAt, setPlanStartAt] = useState(() => session.answer_plan_start_at ? schedulePickerValue(session.answer_plan_start_at) : "");
  const [durationMinutes, setDurationMinutes] = useState(() => session.answer_plan_start_at && session.answer_plan_end_at
    ? Math.max(1, Math.round((new Date(session.answer_plan_end_at).getTime() - new Date(session.answer_plan_start_at).getTime()) / 60_000))
    : 120);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setPlanStartAt(session.answer_plan_start_at ? schedulePickerValue(session.answer_plan_start_at) : "");
    setDurationMinutes(session.answer_plan_start_at && session.answer_plan_end_at
      ? Math.max(1, Math.round((new Date(session.answer_plan_end_at).getTime() - new Date(session.answer_plan_start_at).getTime()) / 60_000))
      : 120);
    setErrorMessage(null);
  }, [session.id, session.lock_version, session.answer_plan_start_at, session.answer_plan_end_at]);

  const updatePlan = async (start: Date | null, duration: number | null) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      if (start && duration) {
        await api.updateInterviewAnswerPlan(session.id, {
          answer_plan_start_at: start.toISOString(),
          duration_minutes: duration,
          base_lock_version: session.lock_version,
        });
      } else {
        await api.updateInterviewAnswerPlan(session.id, {
          answer_plan_start_at: null,
          answer_plan_end_at: null,
          base_lock_version: session.lock_version,
        });
      }
      await onChanged();
    } catch (error) {
      setErrorMessage(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const start = parseScheduleStart(planStartAt);
    const end = start && Number.isInteger(durationMinutes) && durationMinutes > 0
      ? new Date(start.getTime() + durationMinutes * 60_000)
      : null;
    const windowStart = new Date(session.start_at);
    const windowEnd = new Date(session.end_at);
    if (!start || !end || end <= start) {
      setErrorMessage(t("请选择完整且有效的作答时间段。"));
      return;
    }
    if (start < windowStart || end > windowEnd) {
      setErrorMessage(t("作答计划必须完整落在官方作答时段内。"));
      return;
    }
    void updatePlan(start, durationMinutes);
  };

  const hasPlan = Boolean(session.answer_plan_start_at && session.answer_plan_end_at);
  return (
    <section className="career-session-answer-plan" aria-labelledby={`career-session-answer-plan-${session.id}`}>
      <header>
        <div>
          <h3 id={`career-session-answer-plan-${session.id}`}>{t("我的作答计划")}</h3>
          <p>{t("仅用于个人安排，不改变官方截止时间。")}</p>
        </div>
        {!canEdit && <strong>{hasPlan ? formatFullDateTimeRange(session.answer_plan_start_at!, session.answer_plan_end_at!) : t("尚未设置")}</strong>}
      </header>
      {canEdit && (
        <>
          <div className="career-session-answer-plan-fields is-single">
            <div>
              <Label htmlFor={`career-session-answer-plan-start-${session.id}`}>{t("计划作答时间")}</Label>
              <ScheduleDateTimePicker
                id={`career-session-answer-plan-start-${session.id}`}
                label={t("计划作答时间")}
                placeholder={inRecordDialog ? t("选择计划作答时间") : undefined}
                value={planStartAt}
                durationMinutes={durationMinutes}
                minimumStartAt={session.start_at}
                maximumEndAt={session.end_at}
                disabled={busy}
                onChange={(value) => { setPlanStartAt(value); setErrorMessage(null); }}
                onDurationMinutesChange={(value) => { setDurationMinutes(value); setErrorMessage(null); }}
              />
            </div>
          </div>
          {errorMessage && <FeedbackNotice kind="error">{errorMessage}</FeedbackNotice>}
          <div className="career-session-answer-plan-actions">
            {hasPlan && <Button variant="ghost" disabled={busy} onClick={() => void updatePlan(null, null)}>{t("清除计划")}</Button>}
            <Button variant={inRecordDialog ? "outline" : "default"} disabled={busy} onClick={save}>{busy ? t("正在保存…") : t("保存作答计划")}</Button>
          </div>
        </>
      )}
    </section>
  );
}

type InterviewSessionDetailViewProps = {
  detail: InterviewSessionDetail | null;
  detailLoading: boolean;
  onBack: () => void;
  onChanged: (preferredId?: string | null) => void | Promise<void>;
  onNotice: (notice: string) => void;
  displayMode?: "page" | "dialog";
};

export function InterviewSessionDetailView({
  detail,
  detailLoading,
  onBack,
  onChanged,
  onNotice,
  displayMode = "page",
}: InterviewSessionDetailViewProps) {
  useLocale();
  const [questions, setQuestions] = useState("");
  const [review, setReview] = useState("");
  const [improvement, setImprovement] = useState("");
  const [showContentDialog, setShowContentDialog] = useState(false);
  const [showEditTextDialog, setShowEditTextDialog] = useState(false);
  const [showDeleteTextDialog, setShowDeleteTextDialog] = useState(false);
  const [showEditScheduleDialog, setShowEditScheduleDialog] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  useEffect(() => {
    if (!detail) return;
    setQuestions(detail.session.questions_markdown ?? "");
    setReview(detail.session.review_summary ?? "");
    setImprovement(detail.session.improvement_markdown ?? "");
  }, [detail?.session.id, detail?.session.lock_version]);
  const isDialog = displayMode === "dialog";
  const emptyContent = <section className="career-session-detail-loading">{detailLoading ? <PageLoading label={t("正在加载记录…")} scope="panel" /> : <p>{t("暂时无法读取这条记录。")}</p>}</section>;
  if (!detail) {
    if (!isDialog) return emptyContent;
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onBack(); }}>
        <DialogContent className={`career-session-record-dialog${detailLoading ? " is-loading" : " is-empty"}`}>
          <DialogHeader className="sr-only">
            <DialogTitle>{t("记录详情")}</DialogTitle>
            <DialogDescription>{t("查看、编辑和补充这场记录的内容。")}</DialogDescription>
          </DialogHeader>
          {emptyContent}
        </DialogContent>
      </Dialog>
    );
  }
  const { session, application, assets } = detail;
  const isArchived = application.archived_at !== null;
  const isAssessment = session.stage_type === "other";
  const recordTitle = isAssessment ? t("笔试记录") : t("面试记录");
  const recordKind = isAssessment ? "笔试" : "面试";
  const overviewTitle = t("{value0}概况", { value0: t(recordKind) });
  const overviewNameLabel = isAssessment ? t("笔试名称") : t("面试轮次");
  const addContentLabel = isAssessment ? t("添加笔试内容") : t("添加面试内容");
  const canEditAnswerPlan = !isArchived && session.status === "scheduled";
  const editScheduleAction = !isArchived && application.status === "active" && session.status === "scheduled"
    ? <Button variant="outline" icon={<Pencil />} onClick={() => setShowEditScheduleDialog(true)}>{t("修改")}{t(recordKind)}{t("安排")}</Button>
    : null;
  const recordActions = (
    <>
      <Button variant="ghost" onClick={() => setShowContentDialog(true)}>{addContentLabel}</Button>
    </>
  );
  const detailBody = (
    <div className="career-session-detail-body">
      <section className="career-session-record-content">
        {!isDialog && <header className="career-session-content-header"><h2>{overviewTitle}</h2><span>{t("最后更新：")}{formatUpdatedDateTime(session.updated_at)}</span></header>}
        <section className="career-session-overview" aria-label={overviewTitle}>
          <div><FileText aria-hidden="true" /><span><small>{overviewNameLabel}</small><strong>{session.stage_label}</strong></span></div>
          <div><CalendarDays aria-hidden="true" /><span><small>{session.schedule_kind === "open_window" ? t("官方作答时段") : t("{value0}时间", { value0: t(recordKind) })}</small><strong className="career-session-time-range" title={formatFullDateTimeRange(session.start_at, session.end_at)}>{formatFullDateTimeRange(session.start_at, session.end_at)}</strong></span></div>
          <div><Video aria-hidden="true" /><span><small>{t(recordKind)}{t("方式")}</small><strong>{sessionModeLabel(session.mode)}{session.location ? ` · ${session.location}` : ""}</strong></span></div>
        </section>
        {isAssessment && session.schedule_kind === "open_window" && <InterviewAnswerPlanSection session={session} canEdit={canEditAnswerPlan} inRecordDialog={isDialog} onChanged={() => onChanged(session.id)} />}
        {session.meeting_url && <a className="career-session-meeting-link" href={session.meeting_url} target="_blank" rel="noreferrer"><Video aria-hidden="true" />{t("打开")}{isAssessment ? t("笔试") : t("会议")}{t("链接 ")}<ExternalLink aria-hidden="true" /></a>}
        {!isAssessment && (session.status === "scheduled" || session.prep_items.length > 0 || session.preparation_note) && (
          <section className="career-session-preparation" aria-label={t("面试准备")}>
            <PrepChecklistCard detail={detail} readOnly={isArchived || session.status !== "scheduled"} onChanged={() => void onChanged(session.id)} onNotice={onNotice} fallbackError={requestErrorMessage} />
            {session.preparation_note && <section className="career-session-preparation-note"><h3>{t("准备备注")}</h3><p>{session.preparation_note}</p></section>}
          </section>
        )}
        <section className="career-session-content-section">
          <header><h2>{recordTitle}</h2></header>
          <SessionAssetList assets={assets} recordKind={recordKind} hasTextRecord={Boolean(questions.trim())} onEmptyAction={isDialog && isAssessment && assets.length === 0 && !questions.trim() ? () => setShowContentDialog(true) : undefined} sessionId={session.id} onChanged={() => onChanged(session.id)} onNotice={onNotice} />
          {questions.trim() && <article className={`career-session-transcript${textExpanded ? " is-expanded" : ""}`}>
            <header>
              <div className="career-session-transcript-title">
                <span><FileText aria-hidden="true" /></span>
                <div><h3>{t("文字记录")}</h3><small>{questions.trim().length}{t(" 字")}</small></div>
              </div>
              <div className="career-session-transcript-actions">
                <Button variant="outline" onClick={() => setShowEditTextDialog(true)}>{t("编辑记录")}</Button>
                <Button variant="outline" onClick={() => setShowDeleteTextDialog(true)}>{t("删除记录")}</Button>
              </div>
            </header>
            <p id="career-session-transcript-content">{questions}</p>
            {questions.trim().length > 180 && <button type="button" className="career-session-transcript-toggle" aria-expanded={textExpanded} aria-controls="career-session-transcript-content" onClick={() => setTextExpanded((expanded) => !expanded)}>{textExpanded ? t("收起内容") : t("展开全文")}</button>}
          </article>}
        </section>
      </section>
    </div>
  );
  const detailDialogs = (
    <>
      <MotionPresence>{showContentDialog && <AddInterviewContentDialog session={session} recordKind={recordKind} onClose={() => setShowContentDialog(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{showEditTextDialog && <AddInterviewContentDialog session={session} recordKind={recordKind} mode="edit" initialText={questions} onClose={() => setShowEditTextDialog(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{showDeleteTextDialog && <DeleteInterviewTextConfirmDialog session={session} recordKind={recordKind} onClose={() => setShowDeleteTextDialog(false)} onDeleted={() => onChanged(session.id)} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{showEditScheduleDialog && <EditInterviewScheduleDialog session={session} recordKind={recordKind} onClose={() => setShowEditScheduleDialog(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}</MotionPresence>
    </>
  );

  if (isDialog) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onBack(); }}>
        <DialogContent className={`career-session-record-dialog${isAssessment ? " is-assessment" : ""}`}>
          <DialogHeader className="career-session-record-dialog-header">
            <div className="career-session-record-title-row">
              <DialogTitle>{`${application.company_name_snapshot}｜${recordTitle}`}</DialogTitle>
              <span className={`career-session-status ${sessionStatusTone(session)}`}>{session.stage_label} · {sessionStatusLabel(session)}</span>
            </div>
            <DialogDescription>{t("最近更新：")}{formatUpdatedDateTime(session.updated_at)}</DialogDescription>
          </DialogHeader>
          {detailBody}
          <DialogFooter className="career-session-record-footer">
            <div className="career-session-record-footer-start" role="group" aria-label={t("记录编辑操作")}>
              {editScheduleAction}
              {(!isAssessment || assets.length > 0 || questions.trim()) && <Button variant="ghost" icon={<FilePlus2 />} onClick={() => setShowContentDialog(true)}>{addContentLabel}</Button>}
            </div>
          </DialogFooter>
          {detailDialogs}
        </DialogContent>
      </Dialog>
    );
  }

  if (!isAssessment && session.status === "completed") {
    return (<><ReviewV3Content detail={detail} onChanged={() => onChanged(session.id)} onBack={onBack} onUpload={() => setShowContentDialog(true)} onText={() => setShowEditTextDialog(true)} onNotice={onNotice} recordContent={<>{detailBody}<div className="cd3-record-management">{editScheduleAction}{recordActions}</div></>} />{detailDialogs}</>);
  }
  return (
    <div className="career-session-detail-page">
      <header className="career-record-hero career-session-record-hero">
        <div className="career-session-record-hero-inner">
          <div className="career-record-identity">
            <div className="career-record-breadcrumb">
              <button type="button" className="career-record-back" onClick={onBack}><ChevronLeft aria-hidden="true" />{t("返回求职记录")}</button>
              <span aria-hidden="true">/</span><span>{application.company_name_snapshot}</span>
            </div>
            <div className="career-record-title-row"><h1>{application.company_name_snapshot}</h1><span className="career-record-divider" aria-hidden="true" /><h1>{recordTitle}</h1><span className={`career-session-status career-session-hero-status ${sessionStatusTone(session)}`}>{sessionStatusLabel(session)}</span></div>
          </div>
          <div className="career-record-actions">{editScheduleAction}{recordActions}</div>
        </div>
      </header>
      {detailBody}{detailDialogs}
    </div>
  );
}
