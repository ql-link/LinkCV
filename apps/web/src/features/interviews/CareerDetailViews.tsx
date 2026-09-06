import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  Banknote,
  Ban,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Crown,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  Import,
  MapPin,
  MoreHorizontal,
  Trash2,
  Video,
} from "lucide-react";
import {
  ApiRequestError,
  api,
  type InterviewAssetRecord,
  type InterviewSessionDetail,
  type InterviewSessionRecord,
  type InterviewSessionSummary,
  type JobApplicationRecord,
  type JobApplicationSummary,
  type SalaryPeriod,
} from "@/api/client";
import { useResumeStore } from "@/store/resumeStore";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
>;

type JourneyStage = {
  key: string;
  label: string;
  meta: string;
  state: "done" | "current" | "pending" | "waiting" | "cancelled" | "ended" | "offer";
};

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INTERVIEW_EDIT_CONFLICT: "这条面试已在其他页面更新，请刷新后再试。",
      INTERVIEW_INVALID_TRANSITION: "当前求职进度不允许执行这个操作。",
      INTERVIEW_RESUME_VERSION_REQUIRED: "所选简历暂无正式版本，请先保存正式版本。",
      INVALID_INTERVIEW_TIME: "面试开始时间需要是有效的 24 小时制 HH:mm（分钟 00–59）。",
      INTERVIEW_ASSET_TOO_LARGE: "素材超过 500 MiB，请压缩后重试。",
      UNSUPPORTED_INTERVIEW_ASSET: "暂不支持这种素材格式。",
      INTERVIEW_APPLICATION_NOT_EMPTY: "请先清理该求职进程下的面试记录。",
      INTERVIEW_SESSION_NOT_EMPTY: "请先删除这场面试关联的素材。",
    };
    return messages[error.message] ?? `操作失败：${error.message}`;
  }
  return "操作失败，请稍后重试。";
}

function formatFullDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatFullDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatFullDate(value)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
  if (sameDay(date, now)) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return `昨天 ${time}`;
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
    full_time: "正式",
    campus: "校招",
    internship: "实习",
  };
  return typeof value === "string" ? labels[value] ?? value : null;
}

function workModeLabel(value: unknown): string | null {
  const labels: Record<string, string> = {
    onsite: "现场",
    hybrid: "混合",
    remote: "远程",
  };
  return typeof value === "string" ? labels[value] ?? value : null;
}

function sessionStatusLabel(session: Pick<InterviewSessionRecord, "status" | "start_at" | "end_at">): string {
  if (session.status === "completed") return "已完成";
  if (session.status === "cancelled") return "已取消";
  const now = Date.now();
  if (new Date(session.start_at).getTime() <= now && new Date(session.end_at).getTime() > now) return "进行中";
  return "待进行";
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
    ? "线上"
    : mode === "onsite"
      ? "现场"
      : mode === "phone"
        ? "电话"
        : "其他方式";
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
        label: "岗位已导入",
        meta: formatFullDate(application.created_at),
        state: "done",
      },
      {
        key: "pending",
        label: projection.stageLabel,
        meta: projection.supportingLabel ?? "等待确认投递",
        state: "current",
      },
    ];
  }
  const stages: JourneyStage[] = [
    {
      key: "imported",
      label: "岗位已导入",
      meta: formatFullDate(application.created_at),
      state: "done",
    },
  ];
  if (application.applied_at) {
    stages.push({
      key: "applied",
      label: "已投递",
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
  const stages = buildJourneyStages(application, sessions);
  const projection = projectApplicationProgress(application);
  const journeyLabel = projection.isPending || projection.isWaiting
    ? projection.primaryLabel
    : application.current_stage_type === "offer"
      ? offerStatusLabel(application.offer_status)
      : projection.stageLabel;
  return (
    <ol className="career-journey-progress" aria-label={`当前阶段：${journeyLabel}`}>
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

function JobSummaryCard({ application }: { application: JobApplicationSummary }) {
  const progress = projectApplicationProgress(application);
  const snapshot = application.job_snapshot ?? {};
  const skills = snapshotList(snapshot, "skills", "core_skills");
  const salary = snapshotText(snapshot, "salary_text", "salary") ?? "—";
  const city = snapshotText(snapshot, "work_city", "city", "location") ?? "—";
  const employment = employmentTypeLabel(snapshot.employment_type) ?? "—";
  const workMode = workModeLabel(snapshot.work_mode);
  const description = snapshotText(snapshot, "description", "job_description") ?? "岗位描述暂未记录。";
  const sourceHref = application.job_description_id
    ? jobDetailPath(application.job_description_id, application.id)
    : null;
  return (
    <section className="career-detail-card career-job-summary-card">
      <header className="career-detail-card-header">
        <h2>岗位与求职信息</h2>
        {sourceHref && <OverviewLink href={sourceHref}>查看完整岗位 <ChevronRight aria-hidden="true" /></OverviewLink>}
      </header>
      <div className="career-job-identity">
        <span className="career-job-company-name">{application.company_name_snapshot}</span>
        <span className="career-record-divider" aria-hidden="true" />
        <strong className="career-job-position-name">{application.job_title_snapshot}</strong>
      </div>
      <div className="career-job-facts">
        <Fact icon={<Banknote aria-hidden="true" />} label="薪资" value={salary} />
        <Fact icon={<MapPin aria-hidden="true" />} label="工作地点" value={city} />
        <Fact icon={<BriefcaseBusiness aria-hidden="true" />} label="岗位性质" value={[employment, workMode].filter(Boolean).join(" · ") || "—"} />
      </div>
      <div className="career-job-copy career-job-overview">
        <h3>岗位概览</h3>
        <p>{description}</p>
      </div>
      <div className="career-job-copy career-job-skills">
        <h3>核心技能</h3>
        {skills.length ? <div className="career-job-tags">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : <p>暂未记录</p>}
      </div>
      <div className="career-application-info-section">
        <h3>求职信息</h3>
        <dl>
          <div><dt>当前阶段</dt><dd>{progress.stageLabel}</dd></div>
          <div><dt>当前状态</dt><dd>{progress.statusLabel}{progress.supportingLabel && <small>{progress.supportingLabel}</small>}</dd></div>
          <div><dt>{application.applied_at ? "投递时间" : "导入时间"}</dt><dd>{formatFullDate(application.applied_at ?? application.created_at)}</dd></div>
          <div><dt>投递简历版本</dt><dd>{application.resume_title_snapshot ?? "未关联"}</dd></div>
          <div><dt>最近更新</dt><dd>{formatUpdatedDateTime(application.updated_at)}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div><span className="career-job-fact-label">{icon}{label}</span><strong title={value}>{value}</strong></div>;
}

function InterviewRoundCard({ session, onOpen }: { session: InterviewSessionSummary; onOpen: () => void }) {
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
          <p>{formatApplicationListDateTime(session.start_at)} · {sessionModeLabel(session.mode)}</p>
        </div>
      </header>
      <div className="career-interview-round-record">
        <FileText aria-hidden="true" />
        <span>{hasQuestions ? "已添加文字记录" : "可上传音频或填写文字记录"}</span>
      </div>
      <span className={`career-session-status ${sessionStatusTone(session)}`}>{status}</span>
      <button type="button" className="career-round-open" onClick={onOpen}>
        <span>查看{recordKind}记录</span>
        <ChevronRight aria-hidden="true" />
      </button>
    </article>
  );
}

function ensureAssessmentStageLabel(value: string): string {
  const label = value.trim();
  if (!label) return "";
  return /笔试|测评|assessment/i.test(label) ? label : `笔试 · ${label}`;
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
  if (!date) return "选择日期和时间";
  const dateValue = formatDatePickerValue(date);
  if (!time) return `${dateValue} · 选择时间`;
  return `${dateValue} ${time}`;
}

function ScheduleDateTimePicker({
  id,
  label,
  value,
  required = false,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => startOfDatePickerMonth(parseScheduleDateTimeValue(value)?.date ?? new Date()));
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [draftTime, setDraftTime] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedValue = parseScheduleDateTimeValue(value);
  const calendarDays = useMemo(() => buildDatePickerDays(displayMonth), [displayMonth]);
  const monthLabel = formatDatePickerMonth(displayMonth);
  const displayedValue = open
    ? formatScheduleDateTimeDisplay(draftDate, draftTime)
    : selectedValue
      ? formatScheduleDateTimeDisplay(selectedValue.date, selectedValue.time)
      : "选择日期和时间";
  const parsedDraftTime = parseScheduleTime(draftTime);
  const timeInputError = draftTime.length === 5 && !parsedDraftTime
    ? "请输入有效的 HH:mm 时间（小时 00–23，分钟 00–59）。"
    : null;

  const closePicker = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: Event) => {
      if (!pickerRef.current?.contains(event.target as Node)) closePicker();
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
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("click", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const openPicker = () => {
    const current = parseScheduleDateTimeValue(value);
    setDraftDate(current?.date ?? null);
    setDraftTime(current?.time ?? "");
    setDisplayMonth(startOfDatePickerMonth(current?.date ?? new Date()));
    setOpen(true);
  };

  const selectDate = (date: Date) => setDraftDate(date);
  const selectToday = () => {
    const today = new Date();
    setDisplayMonth(startOfDatePickerMonth(today));
    selectDate(today);
  };
  const confirm = () => {
    if (!draftDate || !parsedDraftTime) return;
    onChange(formatScheduleDateTimeValue(draftDate, draftTime));
    closePicker();
  };

  const handleTimeChange = (rawValue: string) => {
    if (rawValue.includes(":")) {
      const [rawHour, rawMinute = ""] = rawValue.split(":");
      const hour = rawHour.replace(/\D/g, "").slice(0, 2);
      const minute = rawMinute.replace(/\D/g, "").slice(0, 2);
      const normalizedHour = hour.length === 1 && minute.length > 0 ? hour.padStart(2, "0") : hour;
      setDraftTime(`${normalizedHour}${rawValue.endsWith(":") || minute ? `:${minute}` : ""}`);
      return;
    }
    const digits = rawValue.replace(/\D/g, "").slice(0, 4);
    setDraftTime(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits);
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
      {open && (
        <div
          id={`${id}-calendar`}
          className="career-date-picker-popover career-schedule-picker-popover"
          role="dialog"
          aria-label={`选择${label}`}
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
                aria-label="上一月"
                title="上一月"
                onClick={() => setDisplayMonth((current) => addDatePickerMonths(current, -1))}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="下一月"
                title="下一月"
                onClick={() => setDisplayMonth((current) => addDatePickerMonths(current, 1))}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="career-date-picker-calendar" role="grid" aria-label={`${monthLabel}日期`}>
            <div className="career-date-picker-weekdays" role="row">
              {DATE_PICKER_WEEKDAYS.map((weekday) => (
                <span key={weekday} role="columnheader">{weekday}</span>
              ))}
            </div>
            <div className="career-date-picker-days">
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <div key={weekIndex} className="career-date-picker-week" role="row">
                  {calendarDays.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => {
                    const dateValue = formatDatePickerValue(date);
                    const isSelected = dateValue === (draftDate ? formatDatePickerValue(draftDate) : null);
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
          <section className="career-schedule-picker-time" aria-label="填写时间">
            <label htmlFor={`${id}-time-input`}>时间</label>
            <input
              id={`${id}-time-input`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
              placeholder="HH:mm"
              value={draftTime}
              disabled={disabled}
              required={required}
              aria-invalid={timeInputError ? "true" : undefined}
              aria-describedby={timeInputError ? `${id}-time-error` : `${id}-time-help`}
              onChange={(event) => handleTimeChange(event.target.value)}
            />
            <span id={`${id}-time-help`}>请输入 24 小时制时间，分钟范围为 00–59。</span>
            {timeInputError && <p id={`${id}-time-error`} role="alert">{timeInputError}</p>}
          </section>
          <footer className="career-date-picker-footer">
            <div className="career-schedule-picker-footer-secondary">
              <button
                type="button"
                disabled={!value && !draftDate}
                onClick={() => {
                  setDraftDate(null);
                  setDraftTime("");
                  onChange("");
                  closePicker();
                }}
              >清除</button>
              <button type="button" onClick={selectToday}>今天</button>
            </div>
            <button
              type="button"
              className="career-schedule-picker-confirm"
              disabled={disabled || !draftDate || !parsedDraftTime}
              onClick={confirm}
            >确定</button>
          </footer>
        </div>
      )}
    </div>
  );
}

type OfferFormValues = {
  baseLocation: string;
  salary: string;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  benefitsDescription: string;
};

const SALARY_PERIOD_OPTIONS: Array<{ label: string; value: SalaryPeriod }> = [
  { label: "月薪", value: "month" },
  { label: "年薪", value: "year" },
  { label: "日薪", value: "day" },
  { label: "时薪", value: "hour" },
];

function optionalSalaryNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

function offerFormError(values: OfferFormValues): string | null {
  const salary = optionalSalaryNumber(values.salary);
  if (salary !== null && (!Number.isFinite(salary) || salary < 0)) {
    return "薪资必须是大于或等于 0 的数字。";
  }
  if (
    salary !== null
    && !/^[A-Z]{3}$/.test(values.salaryCurrency.trim().toUpperCase())
  ) {
    return "填写薪资时，币种需要使用 3 位英文字母代码，例如 CNY。";
  }
  return null;
}

function offerRequestPayload(values: OfferFormValues, baseLockVersion: number) {
  const salary = optionalSalaryNumber(values.salary);
  return {
    base_lock_version: baseLockVersion,
    base_location: values.baseLocation.trim() || null,
    salary,
    salary_currency: salary !== null ? values.salaryCurrency.trim().toUpperCase() : null,
    salary_period: salary !== null ? values.salaryPeriod : null,
    benefits_description: values.benefitsDescription.trim() || null,
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
  const update = <Key extends keyof OfferFormValues>(
    key: Key,
    value: OfferFormValues[Key],
  ) => onChange({ ...values, [key]: value });
  const numericSalary = optionalSalaryNumber(values.salary);
  const adjustSalary = (direction: -1 | 1) => {
    const current = numericSalary !== null && Number.isFinite(numericSalary) ? numericSalary : null;
    const next = current === null ? 0 : Math.max(0, current + (1_000 * direction));
    update("salary", String(next));
  };

  return (
    <section className="career-next-stage-offer-panel" aria-label="Offer 信息">
      <div className="career-next-stage-offer-form">
        <div className="career-next-stage-field">
          <Label htmlFor="career-offer-base-location">Base</Label>
          <input
            id="career-offer-base-location"
            value={values.baseLocation}
            maxLength={100}
            disabled={disabled}
            placeholder="例如：上海"
            onChange={(event) => update("baseLocation", event.target.value)}
          />
        </div>
        <div className="career-next-stage-field career-next-stage-offer-number-field">
          <Label htmlFor="career-offer-salary">薪资</Label>
          <input
            id="career-offer-salary"
            className="career-next-stage-offer-number-input"
            type="number"
            min="0"
            step="1000"
            value={values.salary}
            disabled={disabled}
            placeholder="例如：15000"
            onChange={(event) => update("salary", event.target.value)}
          />
          <div className="career-next-stage-offer-number-controls">
            <button
              type="button"
              aria-label="薪资增加"
              disabled={disabled}
              onClick={() => adjustSalary(1)}
            >
              <ChevronUp size={12} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="薪资减少"
              disabled={disabled || (numericSalary !== null && numericSalary <= 0)}
              onClick={() => adjustSalary(-1)}
            >
              <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
        <div className="career-next-stage-field">
          <Label htmlFor="career-offer-salary-currency">币种</Label>
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
          <Label htmlFor="career-offer-salary-period">计薪周期</Label>
          <Select
            value={values.salaryPeriod}
            disabled={disabled}
            onValueChange={(value) => update("salaryPeriod", value as SalaryPeriod)}
          >
            <SelectTrigger
              id="career-offer-salary-period"
              aria-label="计薪周期"
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
        <div className="career-next-stage-field career-next-stage-field--full career-next-stage-offer-benefits">
          <Label htmlFor="career-offer-benefits">福利待遇</Label>
          <textarea
            id="career-offer-benefits"
            value={values.benefitsDescription}
            maxLength={500}
            disabled={disabled}
            placeholder="例如：餐补、补充医疗、年假"
            onChange={(event) => update("benefitsDescription", event.target.value)}
          />
        </div>
      </div>
    </section>
  );
}

export function AddNextStageDialog({
  application,
  applicationOptions,
  timezone,
  initialTab = "assessment",
  initialInterviewLabel = "",
  initialStartAt = "",
  includeOffer = true,
  title = "添加求职阶段",
  description,
  onClose,
  onChanged,
  onNotice,
}: {
  application: ApplicationStageSource;
  applicationOptions?: JobApplicationSummary[];
  timezone: string;
  initialTab?: NextStageDialogTab;
  initialInterviewLabel?: string;
  initialStartAt?: string;
  includeOffer?: boolean;
  title?: string;
  description?: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const [selectedApplicationId, setSelectedApplicationId] = useState(application.id);
  const selectedApplication = applicationOptions?.find((item) => item.id === selectedApplicationId) ?? application;
  const interviewRoundNo = selectedApplication.current_stage_type === "interview"
    ? (selectedApplication.current_round_no ?? 0) + 1
    : 1;
  const [activeTab, setActiveTab] = useState<NextStageDialogTab>(initialTab);
  const [assessmentLabel, setAssessmentLabel] = useState("笔试");
  const [assessmentStartAt, setAssessmentStartAt] = useState(initialStartAt);
  const [assessmentDuration, setAssessmentDuration] = useState(90);
  const [assessmentMode, setAssessmentMode] = useState<InterviewSessionRecord["mode"]>("video");
  const [assessmentMeetingOrLocation, setAssessmentMeetingOrLocation] = useState("");
  const [interviewLabel, setInterviewLabel] = useState(initialInterviewLabel);
  const [interviewStartAt, setInterviewStartAt] = useState(initialStartAt);
  const [interviewDuration, setInterviewDuration] = useState(60);
  const [interviewMode, setInterviewMode] = useState<InterviewSessionRecord["mode"]>("video");
  const [interviewMeetingOrLocation, setInterviewMeetingOrLocation] = useState("");
  const [offerValues, setOfferValues] = useState<OfferFormValues>({
    baseLocation: "",
    salary: "",
    salaryCurrency: "CNY",
    salaryPeriod: "month",
    benefitsDescription: "",
  });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const save = async () => {
    if (busy) return;
    if (activeTab === "offer") {
      const validationError = offerFormError(offerValues);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }
      setErrorMessage(null);
      setBusy(true);
      try {
        let advancedApplication: JobApplicationRecord;
        try {
          const response = await api.advanceJobApplication(selectedApplication.id, {
            target_stage_type: "offer",
            target_round_no: null,
            target_stage_label: "Offer",
            base_lock_version: selectedApplication.lock_version,
          });
          advancedApplication = response.application;
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
          onNotice("已进入 Offer 阶段，但 Offer 状态保存失败，可从 Offer 信息入口重试");
          return;
        }

        onClose();
        await onChanged();
      } finally {
        setBusy(false);
      }
      return;
    }

    const isAssessment = activeTab === "assessment";
    const stageLabel = isAssessment
      ? ensureAssessmentStageLabel(assessmentLabel)
      : interviewLabel.trim();
    const targetRoundNo = isAssessment ? null : interviewRoundNo;
    const startAt = isAssessment ? assessmentStartAt : interviewStartAt;
    const duration = isAssessment ? assessmentDuration : interviewDuration;
    const mode = isAssessment ? assessmentMode : interviewMode;
    const meetingOrLocation = isAssessment
      ? assessmentMeetingOrLocation.trim()
      : interviewMeetingOrLocation.trim();
    if (!stageLabel || !startAt || !meetingOrLocation) return;
    const start = parseScheduleStart(startAt);
    if (!start) {
      setErrorMessage("请选择有效的 24 小时制日期和时间（HH:mm，分钟 00–59）。");
      return;
    }
    const end = new Date(start.getTime() + duration * 60_000);
    setErrorMessage(null);
    setBusy(true);
    try {
      try {
        await api.advanceJobApplication(selectedApplication.id, {
          target_stage_type: isAssessment ? "screening" : "interview",
          target_round_no: targetRoundNo,
          target_stage_label: stageLabel,
          base_lock_version: selectedApplication.lock_version,
        });
      } catch (error) {
        setErrorMessage(requestErrorMessage(error));
        return;
      }

      try {
        await api.createInterviewSession(selectedApplication.id, {
          client_request_id: clientRequestId,
          stage_type: isAssessment ? "other" : "interview",
          round_no: targetRoundNo,
          stage_label: stageLabel,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          timezone,
          mode,
          meeting_url: mode === "video" || mode === "phone" ? meetingOrLocation : null,
          location: mode === "onsite" || mode === "other" ? meetingOrLocation : null,
          allow_conflict: false,
        });
      } catch {
        onClose();
        try {
          await onChanged();
        } catch {
          // The refresh callback owns its own error notice; preserve the
          // partial-success message below even if it rejects unexpectedly.
        }
        onNotice("阶段已添加，但排期保存失败，可从安排时间入口重试");
        return;
      }

      onClose();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const activeStageLabel = activeTab === "offer"
    ? "Offer"
    : activeTab === "assessment"
      ? ensureAssessmentStageLabel(assessmentLabel)
      : interviewLabel.trim();
  const activeStartAt = activeTab === "assessment" ? assessmentStartAt : activeTab === "interview" ? interviewStartAt : "";
  const activeMeetingOrLocation = activeTab === "assessment"
    ? assessmentMeetingOrLocation
    : activeTab === "interview" ? interviewMeetingOrLocation : "";
  const canSubmit = activeTab === "offer"
    ? !offerFormError(offerValues) && !busy
    : Boolean(activeStageLabel && parseScheduleStart(activeStartAt) && activeMeetingOrLocation.trim()) && !busy;
  const modePlaceholder = (mode: InterviewSessionRecord["mode"]) => mode === "video" || mode === "phone"
    ? activeTab === "assessment" ? "粘贴测评链接" : "粘贴会议链接"
    : activeTab === "assessment" ? "填写测评地点或其他地点" : "填写会议室、地址或其他地点";
  const modeSubjectLabel = activeTab === "assessment" ? "测评" : "面试";
  const dialogDescription = description ?? (activeTab === "offer"
    ? "记录已收到 Offer；Base、薪资和福利都可以稍后再填。"
    : "收到明确通知后，填写已经确认的下一阶段与排期；保存后会进入对应的求职流程。");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-stage-dialog career-next-stage-dialog">
        <DialogHeader className="career-next-stage-dialog-header">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="career-next-stage-category">
          <div className={`career-next-stage-tabs${includeOffer ? "" : " has-two-tabs"}`} role="tablist" aria-label="阶段分类">
            <button
              type="button"
              role="tab"
              id="career-next-stage-tab-assessment"
              aria-selected={activeTab === "assessment"}
              aria-controls="career-next-stage-panel-assessment"
              className={activeTab === "assessment" ? "is-active" : undefined}
              onClick={() => setActiveTab("assessment")}
            >笔试 / 测评</button>
            <button
              type="button"
              role="tab"
              id="career-next-stage-tab-interview"
              aria-selected={activeTab === "interview"}
              aria-controls="career-next-stage-panel-interview"
              className={activeTab === "interview" ? "is-active" : undefined}
              onClick={() => setActiveTab("interview")}
            >面试</button>
            {includeOffer && (
              <button
                type="button"
                role="tab"
                id="career-next-stage-tab-offer"
                aria-selected={activeTab === "offer"}
                aria-controls="career-next-stage-panel-offer"
                className={activeTab === "offer" ? "is-active" : undefined}
                onClick={() => setActiveTab("offer")}
              >Offer</button>
            )}
          </div>
        </div>
        <div className="career-next-stage-divider" aria-hidden="true" />
        <div
          id={`career-next-stage-panel-${activeTab}`}
          className={`career-next-stage-panel${activeTab === "offer" ? " is-offer" : ""}`}
          role="tabpanel"
          aria-labelledby={`career-next-stage-tab-${activeTab}`}
        >
          <div className={`career-next-stage-form${activeTab === "offer" ? " is-offer" : ""}`}>
            {applicationOptions && (
              <div className="career-next-stage-field career-next-stage-process">
                <Label htmlFor="career-next-stage-application">选择流程</Label>
                <Select
                  value={selectedApplication.id}
                  onValueChange={(value) => {
                    setSelectedApplicationId(value);
                    setErrorMessage(null);
                  }}
                  disabled={busy}
                >
                  <SelectTrigger
                    id="career-next-stage-application"
                    aria-label="选择流程"
                    className="career-next-stage-select-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="career-next-stage-select-content career-next-stage-process-content">
                    {applicationOptions.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.company_name_snapshot} · {item.job_title_snapshot} · {projectApplicationProgress(item).stageLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {activeTab === "assessment" ? (
              <>
                <div className="career-next-stage-field">
                  <Label htmlFor="career-next-stage-assessment-label">展示名称</Label>
                  <input
                    id="career-next-stage-assessment-label"
                    value={assessmentLabel}
                    maxLength={100}
                    disabled={busy}
                    onChange={(event) => setAssessmentLabel(event.target.value)}
                  />
                </div>
                <div className="career-next-stage-field">
                  <Label htmlFor="career-next-stage-assessment-time">测评时间</Label>
                  <ScheduleDateTimePicker
                    id="career-next-stage-assessment-time"
                    label="测评时间"
                    required
                    value={assessmentStartAt}
                    disabled={busy}
                    onChange={setAssessmentStartAt}
                  />
                </div>
                <div className="career-next-stage-field">
                  <Label htmlFor="career-next-stage-assessment-duration">时长</Label>
                  <Select
                    value={String(assessmentDuration)}
                    onValueChange={(value) => setAssessmentDuration(Number(value))}
                    disabled={busy}
                  >
                    <SelectTrigger
                      id="career-next-stage-assessment-duration"
                      aria-label="时长"
                      aria-required="true"
                      className="career-next-stage-select-trigger"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="career-next-stage-select-content">
                      <SelectItem value="30">30 分钟</SelectItem>
                      <SelectItem value="60">60 分钟</SelectItem>
                      <SelectItem value="90">90 分钟</SelectItem>
                      <SelectItem value="120">120 分钟</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="career-next-stage-field">
                  <Label htmlFor="career-next-stage-assessment-mode">方式</Label>
                  <Select
                    value={assessmentMode}
                    onValueChange={(value) => setAssessmentMode(value as InterviewSessionRecord["mode"])}
                    disabled={busy}
                  >
                    <SelectTrigger
                      id="career-next-stage-assessment-mode"
                      aria-label="方式"
                      aria-required="true"
                      className="career-next-stage-select-trigger"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="career-next-stage-select-content">
                      <SelectItem value="video">在线{modeSubjectLabel}</SelectItem>
                      <SelectItem value="onsite">现场{modeSubjectLabel}</SelectItem>
                      <SelectItem value="phone">电话{modeSubjectLabel}</SelectItem>
                      <SelectItem value="other">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className={`career-next-stage-field${applicationOptions ? "" : " career-next-stage-field--full"}`}>
                  <Label htmlFor="career-next-stage-assessment-meeting">链接或地点</Label>
                  <input
                    id="career-next-stage-assessment-meeting"
                    required
                    value={assessmentMeetingOrLocation}
                    disabled={busy}
                    placeholder={modePlaceholder(assessmentMode)}
                    onChange={(event) => setAssessmentMeetingOrLocation(event.target.value)}
                  />
                </div>
              </>
            ) : activeTab === "interview" ? (
              <>
                <div className="career-next-stage-field">
                  <Label htmlFor="career-next-stage-interview-label">展示名称</Label>
                  <input
                    id="career-next-stage-interview-label"
                    required
                    value={interviewLabel}
                    maxLength={100}
                    disabled={busy}
                    placeholder="如：一面、业务面、HR 面"
                    onChange={(event) => setInterviewLabel(event.target.value)}
                  />
                </div>
                <div className="career-next-stage-field">
                  <Label htmlFor="career-next-stage-interview-time">面试时间</Label>
                  <ScheduleDateTimePicker
                    id="career-next-stage-interview-time"
                    label="面试时间"
                    required
                    value={interviewStartAt}
                    disabled={busy}
                    onChange={setInterviewStartAt}
                  />
                </div>
                <div className="career-next-stage-field">
                  <Label htmlFor="career-next-stage-interview-duration">时长</Label>
                  <Select
                    value={String(interviewDuration)}
                    onValueChange={(value) => setInterviewDuration(Number(value))}
                    disabled={busy}
                  >
                    <SelectTrigger
                      id="career-next-stage-interview-duration"
                      aria-label="时长"
                      aria-required="true"
                      className="career-next-stage-select-trigger"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="career-next-stage-select-content">
                      <SelectItem value="30">30 分钟</SelectItem>
                      <SelectItem value="60">60 分钟</SelectItem>
                      <SelectItem value="90">90 分钟</SelectItem>
                      <SelectItem value="120">120 分钟</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="career-next-stage-field">
                  <Label htmlFor="career-next-stage-interview-mode">方式</Label>
                  <Select
                    value={interviewMode}
                    onValueChange={(value) => setInterviewMode(value as InterviewSessionRecord["mode"])}
                    disabled={busy}
                  >
                    <SelectTrigger
                      id="career-next-stage-interview-mode"
                      aria-label="方式"
                      aria-required="true"
                      className="career-next-stage-select-trigger"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="career-next-stage-select-content">
                      <SelectItem value="video">线上{modeSubjectLabel}</SelectItem>
                      <SelectItem value="onsite">现场{modeSubjectLabel}</SelectItem>
                      <SelectItem value="phone">电话{modeSubjectLabel}</SelectItem>
                      <SelectItem value="other">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className={`career-next-stage-field${applicationOptions ? "" : " career-next-stage-field--full"}`}>
                  <Label htmlFor="career-next-stage-interview-meeting">链接或地点</Label>
                  <input
                    id="career-next-stage-interview-meeting"
                    required
                    value={interviewMeetingOrLocation}
                    disabled={busy}
                    placeholder={modePlaceholder(interviewMode)}
                    onChange={(event) => setInterviewMeetingOrLocation(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <OfferDetailsFields values={offerValues} disabled={busy} onChange={setOfferValues} />
            )}
          </div>
          {errorMessage && <p className="career-next-stage-error" role="alert">{errorMessage}</p>}
        </div>
        <DialogFooter className="career-next-stage-dialog-footer">
          <p>{activeTab === "offer"
            ? "所有信息均可留空，保存后会进入 Offer 阶段"
            : "添加后会立即保存排期；如需调整，可从安排时间入口继续修改。"}</p>
          <div className="career-next-stage-dialog-footer-actions">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button className="career-next-stage-save-button" disabled={!canSubmit} onClick={() => void save()}>{busy ? "保存中…" : "添加并保存"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_SELECT_VALUE = "__none__";

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
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatDatePickerDay(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function startOfDatePickerMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDatePickerMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
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
  const [open, setOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => startOfDatePickerMonth(parseDatePickerValue(value) ?? new Date()));
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
    const handlePointerDown = (event: Event) => {
      if (!pickerRef.current?.contains(event.target as Node)) closePicker();
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
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("click", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const openPicker = () => {
    setDisplayMonth(startOfDatePickerMonth(selectedDate ?? new Date()));
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
        aria-label="投递日期"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-calendar`}
        aria-required="true"
        onClick={() => (open ? closePicker() : openPicker())}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            closePicker();
          }
        }}
      >
        <span>{selectedValue ?? "选择日期"}</span>
        <CalendarDays aria-hidden="true" />
      </button>
      {open && (
        <div
          id={`${id}-calendar`}
          className="career-date-picker-popover"
          role="dialog"
          aria-label="选择投递日期"
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
                aria-label="上一月"
                title="上一月"
                onClick={() => setDisplayMonth((current) => addDatePickerMonths(current, -1))}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="下一月"
                title="下一月"
                onClick={() => setDisplayMonth((current) => addDatePickerMonths(current, 1))}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="career-date-picker-calendar" role="grid" aria-label={`${monthLabel}日期`}>
            <div className="career-date-picker-weekdays" role="row">
              {DATE_PICKER_WEEKDAYS.map((weekday) => (
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
            <button type="button" disabled={!value} onClick={() => { onChange(""); closePicker(); }}>清除</button>
            <button type="button" onClick={today}>今天</button>
          </footer>
        </div>
      )}
    </div>
  );
}

export function MarkApplicationAppliedDialog({
  application,
  onClose,
  onChanged,
  onNotice,
}: {
  application: JobApplicationSummary;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const progress = projectApplicationProgress(application);
  const resumes = useResumeStore((state) => state.resumes);
  const [appliedAt, setAppliedAt] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  });
  const [resumeId, setResumeId] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const appliedAtIso = dateInputToIso(appliedAt);
    if (!appliedAtIso) return;
    setBusy(true);
    try {
      await api.updateJobApplication(application.id, {
        applied_at: appliedAtIso,
        ...(resumeId ? { resume_id: resumeId } : { resume_version_id: null }),
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-stage-dialog career-applied-dialog">
        <DialogHeader>
          <DialogTitle className="career-applied-dialog-title">推进求职流程</DialogTitle>
          <DialogDescription className="career-applied-dialog-description">当前阶段：{progress.stageLabel}。简历为选填；选择后，系统会自动绑定该简历最新的正式版本。</DialogDescription>
        </DialogHeader>
        <div className="career-stage-dialog-form">
          <div className="career-stage-dialog-field">
            <Label htmlFor="career-applied-at">投递日期</Label>
            <AppliedAtDatePicker id="career-applied-at" value={appliedAt} onChange={setAppliedAt} />
          </div>
          <div className="career-stage-dialog-field">
            <Label htmlFor="career-applied-resume">使用的简历</Label>
            <Select
              value={resumeId || EMPTY_SELECT_VALUE}
              onValueChange={(value) => setResumeId(value === EMPTY_SELECT_VALUE ? "" : value)}
            >
              <SelectTrigger id="career-applied-resume" aria-label="使用的简历" className="career-stage-select-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="career-stage-select-content">
                <SelectItem value={EMPTY_SELECT_VALUE}>不使用简历</SelectItem>
                {resumes.map((resume) => <SelectItem key={resume.id} value={resume.id}>{resume.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="career-stage-dialog-empty">
            {resumes.length
              ? "不选择简历也可以继续；选择后会自动绑定最新正式版本。"
              : "暂无可用简历，仍可直接标记已投递。"}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!dateInputToIso(appliedAt) || busy} onClick={() => void submit()}>{busy ? "保存中…" : "确认标记"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [busy, setBusy] = useState(false);

  const terminate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.closeJobApplication(application.id, {
        status: "withdrawn",
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
      title="终止这条求职记录？"
      description="状态会变为“已主动结束”，笔试、面试和 Offer 历史仍保留。"
      confirmLabel="确认终止"
      busyLabel="正在终止…"
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
  const progress = projectApplicationProgress(application);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [offerValues, setOfferValues] = useState<OfferFormValues>({
    baseLocation: application.offer_base_location ?? "",
    salary: application.offer_salary?.toString() ?? "",
    salaryCurrency: application.offer_salary_currency ?? "CNY",
    salaryPeriod: application.offer_salary_period ?? "month",
    benefitsDescription: application.offer_benefits_description ?? "",
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
          <DialogTitle>Offer 信息</DialogTitle>
          <DialogDescription>
            当前阶段：{progress.stageLabel}。所有信息均为选填，可以稍后补充或清空。
          </DialogDescription>
        </DialogHeader>
        <OfferDetailsFields values={offerValues} disabled={busy} onChange={setOfferValues} />
        {errorMessage && <p className="career-next-stage-error" role="alert">{errorMessage}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button disabled={Boolean(offerFormError(offerValues)) || busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
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
  onCreateInterview,
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
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [appliedDialogOpen, setAppliedDialogOpen] = useState(false);
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);
  if (!application) {
    return (
      <section className="career-detail-not-found">
        <BriefcaseBusiness aria-hidden="true" />
        <h1>无法打开这条求职进程</h1>
        <p>记录不存在、已被删除，或当前账号没有访问权限。</p>
        <Button variant="outline" onClick={onBack}>返回求职记录</Button>
      </section>
    );
  }
  const applicationSessions = sessions
    .filter((session) => session.application_id === application.id)
    .sort((left, right) => new Date(right.start_at).getTime() - new Date(left.start_at).getTime());
  const currentSession = applicationSessions.find((session) => (
    session.status !== "cancelled" && applicationStageMatchesSession(application, session)
  ));
  const progress = projectApplicationProgress(application);
  const isSubmittedScreening = progress.columnKey === "screening"
    && application.current_stage_type === "screening"
    && Boolean(application.applied_at);
  const heroStatusLabel = progress.isPending || progress.isWaiting || progress.columnKey === "ended" || progress.columnKey === "offer"
    ? progress.statusLabel
    : progress.stageLabel;
  const active = application.status === "active" && application.archived_at === null;
  const canSchedule = active && application.stage_state === "awaiting_schedule" && application.current_stage_type !== "offer";
  const canAdvance = active
    && application.stage_state === "awaiting_result"
    && application.current_stage_type !== "offer"
    && (application.current_stage_type !== "screening" || Boolean(application.applied_at));
  const canMarkApplied = active && progress.isPending;
  const canUpdateOffer = active
    && application.current_stage_type === "offer"
    && (application.offer_status === "none" || application.offer_status === "received");
  const canTerminate = active && application.offer_status === "none";
  const scheduleActionLabel = `安排${progress.stageLabel}时间`;
  const resultActionLabel = currentSession?.status === "completed"
    || isSubmittedScreening
    || progress.isWaiting
    ? "添加下一阶段"
    : progress.isAssessment
      ? "记录笔试结果"
      : application.current_stage_type === "screening"
        ? "更新筛选结果"
        : `记录${progress.stageLabel}结果`;
  const currentRecordKind = currentSession
    ? sessionRecordKind(currentSession)
    : progress.isAssessment ? "笔试" : "面试";
  const sessionRecordActionLabel = `填写${currentRecordKind}记录`;
  const sessionRecordKinds = new Set(applicationSessions.map(sessionRecordKind));
  const sessionSectionTitle = sessionRecordKinds.size > 1
    ? "笔试与面试记录"
    : `${applicationSessions.length ? sessionRecordKind(applicationSessions[0]) : currentRecordKind}记录`;
  const primaryAction = canMarkApplied
    ? "mark-applied"
    : canSchedule
      ? "schedule"
      : canUpdateOffer
        ? "offer"
        : canAdvance
          ? "record-result"
          : currentSession && application.current_stage_type !== "offer"
            ? "session-record"
            : null;
  return (
    <div className="career-application-detail-page">
      <header className="career-record-hero career-application-record-hero">
        <div className="career-application-record-hero-inner">
          <div className="career-record-identity">
            <div className="career-record-breadcrumb">
              <button type="button" className="career-record-back" onClick={onBack}><ChevronLeft aria-hidden="true" />返回求职记录</button>
              <span aria-hidden="true">/</span>
              <span>{application.company_name_snapshot}</span>
            </div>
            <div className="career-record-title-row">
              <h1 aria-label={`${application.company_name_snapshot}，${application.job_title_snapshot}`}>
                <span className="career-record-company-name">{application.company_name_snapshot}</span>
                <span className="career-record-divider" aria-hidden="true" />
                <span className="career-record-position-name">{application.job_title_snapshot}</span>
              </h1>
              <span
                className={`career-application-status ${applicationDetailStatusToneClass(application)}`}
                aria-label={`${heroStatusLabel}${progress.supportingLabel ? `，${progress.supportingLabel}` : ""}`}
              >
                {heroStatusLabel}
                {progress.supportingLabel && <small>{progress.supportingLabel}</small>}
              </span>
            </div>
          </div>
          <div className="career-record-actions">
            {primaryAction === "mark-applied" && <Button onClick={() => setAppliedDialogOpen(true)}>标记已投递</Button>}
            {primaryAction === "schedule" && <Button onClick={() => onCreateInterview(application.id)}>{scheduleActionLabel}</Button>}
            {primaryAction === "record-result" && <Button onClick={() => setStageDialogOpen(true)}>{resultActionLabel}</Button>}
            {primaryAction === "session-record" && currentSession && <Button onClick={() => navigateTo(careerApplicationPath(application.id, currentSession.id), { state: { careerSessionDialog: true } })}>{sessionRecordActionLabel}</Button>}
            {primaryAction === "offer" && <Button onClick={() => setOfferDialogOpen(true)}>Offer 信息</Button>}
            {canTerminate && <Button variant="outline" icon={<Ban aria-hidden="true" />} onClick={() => setTerminateDialogOpen(true)}>终止求职</Button>}
          </div>
        </div>
      </header>
      <div className={`career-detail-body career-application-detail-body${applicationSessions.length ? " has-interview-records" : ""}`}>
        <div className="career-detail-main-column">
          <section className="career-detail-card career-progress-card">
            <h2>求职进度</h2>
            <JourneyProgress application={application} sessions={applicationSessions} />
            <p className="career-progress-helper">
              {isSubmittedScreening
                ? "当前处于筛选中，收到明确通知后添加实际下一阶段。"
                : "只展示当前求职路径中的关键节点；笔试和面试场次在下方记录区呈现。"}
            </p>
          </section>
          <section className="career-detail-card career-interview-rounds career-interview-section-card">
            <header><h2>{sessionSectionTitle}</h2><span>{applicationSessions.length} 条记录</span></header>
            {applicationSessions.length ? (
              <div className="career-interview-round-list">
                {applicationSessions.map((session) => <InterviewRoundCard key={session.id} session={session} onOpen={() => navigateTo(careerApplicationPath(application.id, session.id), { state: { careerSessionDialog: true } })} />)}
              </div>
            ) : (
              <div className="career-interview-empty">
                <CalendarDays aria-hidden="true" />
                <strong>暂无{currentRecordKind}记录</strong>
                <p>{canSchedule
                  ? `安排${currentRecordKind}后，记录${currentRecordKind}内容与复盘。`
                  : `公司确认${currentRecordKind}后，再添加${currentRecordKind}阶段并安排时间。`}</p>
              </div>
            )}
          </section>
        </div>
        <aside className="career-detail-side-column">
          <JobSummaryCard application={application} />
        </aside>
      </div>
      {stageDialogOpen && <AddNextStageDialog application={application} timezone={timezone} onClose={() => setStageDialogOpen(false)} onChanged={onChanged} onNotice={onNotice} />}
      {appliedDialogOpen && <MarkApplicationAppliedDialog application={application} onClose={() => setAppliedDialogOpen(false)} onChanged={onChanged} onNotice={onNotice} />}
      {offerDialogOpen && <OfferApplicationDialog application={application} onClose={() => setOfferDialogOpen(false)} onChanged={onChanged} onNotice={onNotice} />}
      {terminateDialogOpen && <TerminateApplicationConfirmDialog application={application} onClose={() => setTerminateDialogOpen(false)} onChanged={onChanged} onNotice={onNotice} />}
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

function SessionAssetList({
  assets,
  recordKind,
  hasTextRecord,
  onChanged,
  onNotice,
}: {
  assets: InterviewAssetRecord[];
  recordKind: "笔试" | "面试";
  hasTextRecord: boolean;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const play = async (asset: InterviewAssetRecord) => {
    setBusyAssetId(asset.id);
    try {
      const blob = await api.downloadInterviewAsset(asset.id);
      const url = URL.createObjectURL(blob);
      setAudioUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
      setActiveAssetId(asset.id);
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
      await api.deleteInterviewAsset(asset.id);
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusyAssetId(null);
    }
  };
  return (
    <>
      {assets.length ? <div className="career-session-assets">{assets.map((asset) => <article key={asset.id}>
        <span className="career-session-asset-icon"><FileAudio aria-hidden="true" /></span>
        <div><strong title={asset.original_file_name}>{asset.original_file_name}</strong><small>{formatDuration(asset.duration_ms) ?? formatBytes(asset.file_size)} · {asset.source_type === "recorded" ? "现场录制" : "文件上传"}</small></div>
        <div className="career-session-asset-actions">
          {asset.asset_type === "audio" && <Button size="sm" variant="outline" disabled={busyAssetId === asset.id} onClick={() => void play(asset)}>{busyAssetId === asset.id ? "加载中…" : activeAssetId === asset.id ? "重新播放" : "播放录音"}</Button>}
          <button type="button" aria-label={`下载 ${asset.original_file_name}`} disabled={busyAssetId === asset.id} onClick={() => void download(asset)}><Download aria-hidden="true" /></button>
          <button type="button" aria-label={`删除 ${asset.original_file_name}`} disabled={busyAssetId === asset.id} onClick={() => void remove(asset)}><Trash2 aria-hidden="true" /></button>
        </div>
        {audioUrl && activeAssetId === asset.id && <audio className="career-session-audio-player" controls autoPlay src={audioUrl} aria-label={`${recordKind}录音播放器`} />}
      </article>)}</div> : !hasTextRecord && <div className="career-session-empty-content"><FileText aria-hidden="true" /><strong>尚未添加{recordKind}内容</strong><p>上传音频文件，或粘贴文字记录。</p></div>}
    </>
  );
}

const AUDIO_FILE_ACCEPT = "audio/*,.aac,.aiff,.amr,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.webm,.wma";
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

function AddInterviewContentDialog({
  session,
  recordKind,
  mode = "add",
  initialText = "",
  onClose,
  onChanged,
  onNotice,
}: {
  session: InterviewSessionRecord;
  recordKind: "笔试" | "面试";
  mode?: "add" | "edit";
  initialText?: string;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);
  const [file, setFile] = useState<File | null>(null);
  const [contentMode, setContentMode] = useState<"audio" | "text">("audio");
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const isEditing = mode === "edit";
  const selectAudioFile = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!isAudioFile(candidate)) {
      if (inputRef.current) inputRef.current.value = "";
      onNotice("仅支持音频文件，请选择音频格式。");
      return;
    }
    setContentMode("audio");
    setFile(candidate);
    setText("");
  };
  const switchContentMode = (nextMode: "audio" | "text") => {
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
        <DialogHeader className="career-content-dialog-header"><DialogTitle>{isEditing ? `编辑${recordKind}文字记录` : `添加${recordKind}内容`}</DialogTitle><DialogDescription>{isEditing ? `修改已保存的${recordKind}文字记录。` : `选择一种方式保存本场${recordKind}记录。`}</DialogDescription></DialogHeader>
        {!isEditing && <div className="career-content-method-switch" role="tablist" aria-label={`${recordKind}记录添加方式`}>
          <button type="button" role="tab" aria-selected={contentMode === "audio"} className={contentMode === "audio" ? "is-active" : undefined} onClick={() => switchContentMode("audio")}><Import aria-hidden="true" />上传音频</button>
          <button type="button" role="tab" aria-selected={contentMode === "text"} className={contentMode === "text" ? "is-active" : undefined} onClick={() => switchContentMode("text")}><FileText aria-hidden="true" />粘贴文字</button>
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
              <strong>{file ? file.name : "点击选择或拖放音频文件"}</strong>
              <span>{file ? `${formatBytes(file.size)} · 已选择` : "支持 MP3、M4A、WAV 等常见音频格式"}</span>
            </div>
            <input ref={inputRef} className="visually-hidden" type="file" accept={AUDIO_FILE_ACCEPT} aria-label="音频文件" onChange={(event) => selectAudioFile(event.target.files?.[0])} />
          </section>
        }
        {(isEditing || contentMode === "text") && <section className="career-content-text-method">
          {isEditing && <h3>{recordKind}文字记录</h3>}
          <textarea aria-label={`${recordKind}文字记录`} value={text} onChange={(event) => setText(event.target.value)} placeholder={`粘贴${recordKind}过程、逐字稿或整理后的文字记录…`} />
        </section>}
        <DialogFooter className="career-content-dialog-footer"><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy || (isEditing || contentMode === "text" ? !text.trim() : !file)} onClick={() => void save()}>{busy ? "保存中…" : isEditing ? "保存修改" : "保存内容"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteInterviewTextConfirmDialog({
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
      title={`删除${recordKind}文字记录？`}
      description={`删除后将无法恢复这条${recordKind}文字记录。`}
      confirmLabel="删除记录"
      busyLabel="删除中…"
      busy={busy}
      onCancel={onClose}
      onConfirm={remove}
    />
  );
}

function CompleteInterviewDialog({
  session,
  questions,
  review,
  improvement,
  onClose,
  onCompleted,
  onNotice,
}: {
  session: InterviewSessionRecord;
  questions: string;
  review: string;
  improvement: string;
  onClose: () => void;
  onCompleted: () => void;
  onNotice: (notice: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const completeLabel = session.stage_type === "other" ? "完成笔试" : "完成本轮面试";
  const complete = async () => {
    setBusy(true);
    try {
      await api.completeInterviewSession(session.id, {
        questions_markdown: questions.trim() || null,
        review_summary: review.trim() || null,
        improvement_markdown: improvement.trim() || null,
        base_lock_version: session.lock_version,
      });
      onClose();
      onCompleted();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-complete-dialog">
        <DialogHeader><DialogTitle>完成{session.stage_label}</DialogTitle><DialogDescription>完成后可以继续补充音频或文字记录。</DialogDescription></DialogHeader>
        <div className="career-complete-summary"><strong>{session.stage_label}</strong><span>{formatFullDateTime(session.start_at)} · {sessionModeLabel(session.mode)}</span></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy} onClick={() => void complete()}>{busy ? "处理中…" : completeLabel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [questions, setQuestions] = useState("");
  const [review, setReview] = useState("");
  const [improvement, setImprovement] = useState("");
  const [showContentDialog, setShowContentDialog] = useState(false);
  const [showEditTextDialog, setShowEditTextDialog] = useState(false);
  const [showDeleteTextDialog, setShowDeleteTextDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  useEffect(() => {
    if (!detail) return;
    setQuestions(detail.session.questions_markdown ?? "");
    setReview(detail.session.review_summary ?? "");
    setImprovement(detail.session.improvement_markdown ?? "");
  }, [detail?.session.id, detail?.session.lock_version]);
  const isDialog = displayMode === "dialog";
  const emptyContent = <section className="career-session-detail-loading">{detailLoading ? <PageLoading label="正在加载记录…" scope="panel" /> : <p>暂时无法读取这条记录。</p>}</section>;
  if (!detail) {
    if (!isDialog) return emptyContent;
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onBack(); }}>
        <DialogContent className="career-session-record-dialog">
          <DialogHeader className="sr-only">
            <DialogTitle>记录详情</DialogTitle>
            <DialogDescription>查看、编辑和补充这场记录的内容。</DialogDescription>
          </DialogHeader>
          {emptyContent}
        </DialogContent>
      </Dialog>
    );
  }
  const { session, application, assets } = detail;
  const isArchived = application.archived_at !== null;
  const isAssessment = session.stage_type === "other";
  const recordTitle = isAssessment ? "笔试记录" : "面试记录";
  const recordKind = isAssessment ? "笔试" : "面试";
  const overviewTitle = `${recordKind}概况`;
  const overviewNameLabel = isAssessment ? "笔试名称" : "面试轮次";
  const addContentLabel = isAssessment ? "添加笔试内容" : "添加面试内容";
  const completeLabel = isAssessment ? "完成笔试" : "完成本轮面试";
  const recordActions = (
    <>
      <Button onClick={() => setShowContentDialog(true)}>{addContentLabel}</Button>
      {!isArchived && session.status === "scheduled" && <Button variant="outline" onClick={() => setShowCompleteDialog(true)}>{completeLabel}</Button>}
    </>
  );
  const detailBody = (
    <div className="career-session-detail-body">
      <section className="career-session-record-content">
        <header className="career-session-content-header"><h2>{overviewTitle}</h2><span>最后更新：{formatUpdatedDateTime(session.updated_at)}</span></header>
        <div className="career-session-overview">
          <div><FileText aria-hidden="true" /><span><small>{overviewNameLabel}</small><strong>{session.stage_label}</strong></span></div>
          <div><CalendarDays aria-hidden="true" /><span><small>{recordKind}时间</small><strong>{formatFullDateTime(session.start_at)}</strong></span></div>
          <div><Video aria-hidden="true" /><span><small>{recordKind}方式</small><strong>{sessionModeLabel(session.mode)}{session.location ? ` · ${session.location}` : ""}</strong></span></div>
        </div>
        {session.meeting_url && <a className="career-session-meeting-link" href={session.meeting_url} target="_blank" rel="noreferrer"><Video aria-hidden="true" />打开{isAssessment ? "笔试" : "会议"}链接 <ExternalLink aria-hidden="true" /></a>}
        <section className="career-session-content-section">
          <header><h2>{recordTitle}</h2><span>支持上传音频或粘贴文字</span></header>
          <SessionAssetList assets={assets} recordKind={recordKind} hasTextRecord={Boolean(questions.trim())} onChanged={() => onChanged(session.id)} onNotice={onNotice} />
          {questions.trim() && <article className={`career-session-transcript${textExpanded ? " is-expanded" : ""}`}>
            <header>
              <div className="career-session-transcript-title">
                <span><FileText aria-hidden="true" /></span>
                <div><h3>文字记录</h3><small>{questions.trim().length} 字</small></div>
              </div>
              <div className="career-session-transcript-actions">
                <Button variant="outline" onClick={() => setShowEditTextDialog(true)}>编辑记录</Button>
                <Button variant="outline" onClick={() => setShowDeleteTextDialog(true)}>删除记录</Button>
              </div>
            </header>
            <p id="career-session-transcript-content">{questions}</p>
            {questions.trim().length > 180 && <button type="button" className="career-session-transcript-toggle" aria-expanded={textExpanded} aria-controls="career-session-transcript-content" onClick={() => setTextExpanded((expanded) => !expanded)}>{textExpanded ? "收起内容" : "展开全文"}</button>}
          </article>}
        </section>
      </section>
    </div>
  );
  const detailDialogs = (
    <>
      {showContentDialog && <AddInterviewContentDialog session={session} recordKind={recordKind} onClose={() => setShowContentDialog(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}
      {showEditTextDialog && <AddInterviewContentDialog session={session} recordKind={recordKind} mode="edit" initialText={questions} onClose={() => setShowEditTextDialog(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}
      {showDeleteTextDialog && <DeleteInterviewTextConfirmDialog session={session} recordKind={recordKind} onClose={() => setShowDeleteTextDialog(false)} onDeleted={() => onChanged(session.id)} onNotice={onNotice} />}
      {showCompleteDialog && <CompleteInterviewDialog session={session} questions={questions} review={review} improvement={improvement} onClose={() => setShowCompleteDialog(false)} onCompleted={() => isDialog ? onChanged(null) : navigateTo(careerApplicationPath(application.id))} onNotice={onNotice} />}
    </>
  );

  if (isDialog) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onBack(); }}>
        <DialogContent className="career-session-record-dialog">
          <DialogHeader className="career-session-record-dialog-header">
            <DialogTitle>{`${application.company_name_snapshot}｜${recordTitle}`}</DialogTitle>
            <DialogDescription>{session.stage_label} · {sessionStatusLabel(session)}</DialogDescription>
          </DialogHeader>
          {detailBody}
          <DialogFooter className="career-session-record-footer">{recordActions}</DialogFooter>
          {detailDialogs}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="career-session-detail-page">
      <header className="career-record-hero career-session-record-hero">
        <div className="career-session-record-hero-inner">
          <div className="career-record-identity">
            <div className="career-record-breadcrumb">
              <button type="button" className="career-record-back" onClick={onBack}><ChevronLeft aria-hidden="true" />返回求职记录</button>
              <span aria-hidden="true">/</span>
              <span>{application.company_name_snapshot}</span>
            </div>
            <div className="career-record-title-row">
              <h1>{application.company_name_snapshot}</h1>
              <span className="career-record-divider" aria-hidden="true" />
              <h1>{recordTitle}</h1>
              <span className={`career-session-status career-session-hero-status ${sessionStatusTone(session)}`}>{sessionStatusLabel(session)}</span>
            </div>
          </div>
          <div className="career-record-actions">{recordActions}</div>
        </div>
      </header>
      {detailBody}
      {detailDialogs}
    </div>
  );
}
