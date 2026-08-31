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
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CircleCheck,
  Crown,
  Download,
  ExternalLink,
  FileText,
  Import,
  MapPin,
  Mic,
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
import { formatApplicationListDateTime } from "./ApplicationsBoard";
import {
  applicationDetailStatusToneClass,
  normalizeApplicationStageLabel,
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
      INTERVIEW_RESUME_REQUIRED: "请选择一份简历后再标记已投递。",
      INTERVIEW_RESUME_VERSION_REQUIRED: "所选简历暂无正式版本，请先保存正式版本。",
      INVALID_INTERVIEW_TIME: "面试开始时间需要落在整点或半点。",
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
    full_time: "全职",
    part_time: "兼职",
    internship: "实习",
    contract: "合同",
    temporary: "临时",
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

function applicationStageMatchesSession(
  application: ApplicationStageSource,
  session: Pick<InterviewSessionRecord, "stage_type" | "round_no" | "stage_label">,
): boolean {
  if (application.current_stage_type !== session.stage_type) return false;
  if (application.current_stage_type === "interview") {
    return application.current_round_no === session.round_no;
  }
  return application.current_stage_label === session.stage_label;
}

function buildJourneyStages(
  application: JobApplicationSummary,
  sessions: InterviewSessionSummary[],
): JourneyStage[] {
  const projection = projectApplicationProgress(application);
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
    const sessionLabel = session.stage_type === "other" && application.current_stage_type === "screening"
      ? normalizeApplicationStageLabel(application)
      : session.stage_label;
    stages.push({
      key: `session:${session.id}`,
      label: sessionLabel,
      meta: formatFullDate(session.start_at),
      state: session.status === "cancelled"
        ? "cancelled"
        : isCurrent && projection.isWaiting
          ? "done"
          : isCurrent
            ? "current"
            : session.status === "completed"
              ? "done"
              : "pending",
    });
  });

  if (!currentSessionIds.size && projection.stageLabel) {
    stages.push({
      key: `stage:${application.current_stage_type}:${application.current_round_no ?? "none"}`,
      label: projection.stageLabel,
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
      <div className="career-job-copy">
        <h3>岗位概览</h3>
        <p>{description}</p>
      </div>
      <div className="career-job-copy">
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
  const hasReview = Boolean(session.review_summary?.trim());
  const hasImprovement = Boolean(session.improvement_markdown?.trim());
  const status = sessionStatusLabel(session);
  return (
    <article className="career-interview-round-card">
      <header>
        <div>
          <h3>{session.stage_label}</h3>
          <p>{formatApplicationListDateTime(session.start_at)} · {sessionModeLabel(session.mode)}</p>
        </div>
        <span className={`career-session-status ${sessionStatusTone(session)}`}>面试 · {status}</span>
      </header>
      <dl>
        <div><dt>面试内容</dt><dd>{hasQuestions ? "已补充文字记录" : session.status === "completed" ? "尚未添加内容" : "面试结束后可上传录音"}</dd></div>
        <div><dt>面试评价</dt><dd>{hasReview ? "已填写评价" : session.status === "completed" ? "尚未填写评价" : "面试结束后填写评价"}</dd></div>
        <div><dt>面试复盘</dt><dd>{hasImprovement || hasReview ? "已补充复盘" : session.status === "completed" ? "尚未开始复盘" : "面试结束后开始复盘"}</dd></div>
      </dl>
      <button type="button" className="career-round-open" onClick={onOpen}>查看面试记录 <ChevronRight aria-hidden="true" /></button>
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
    || ![0, 30].includes(date.getMinutes())
    || date.getSeconds() !== 0
    || date.getMilliseconds() !== 0
  ) return null;
  return date;
}

type ScheduleDateTimeValue = {
  date: Date;
  time: string;
};

function parseScheduleTime(value: string): { hour: number; minute: 0 | 30 } | null {
  const match = /^(\d{2}):(00|30)$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { hour, minute: Number(match[2]) as 0 | 30 };
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
    ? "请输入 HH:mm，分钟仅支持 00 或 30。"
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
            <span id={`${id}-time-help`}>请输入 24 小时制时间，分钟仅支持 00 或 30。</span>
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

type AddNextStageTab = "assessment" | "interview";

function AddNextStageDialog({
  application,
  timezone,
  onClose,
  onChanged,
  onNotice,
}: {
  application: ApplicationStageSource;
  timezone: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const interviewRoundNo = application.current_stage_type === "interview"
    ? (application.current_round_no ?? 0) + 1
    : 1;
  const [activeTab, setActiveTab] = useState<AddNextStageTab>("assessment");
  const [assessmentLabel, setAssessmentLabel] = useState("笔试");
  const [assessmentStartAt, setAssessmentStartAt] = useState("");
  const [assessmentDuration, setAssessmentDuration] = useState(90);
  const [assessmentMode, setAssessmentMode] = useState<InterviewSessionRecord["mode"]>("video");
  const [assessmentMeetingOrLocation, setAssessmentMeetingOrLocation] = useState("");
  const [interviewLabel, setInterviewLabel] = useState("");
  const [interviewStartAt, setInterviewStartAt] = useState("");
  const [interviewDuration, setInterviewDuration] = useState(60);
  const [interviewMode, setInterviewMode] = useState<InterviewSessionRecord["mode"]>("video");
  const [interviewMeetingOrLocation, setInterviewMeetingOrLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const save = async () => {
    if (busy) return;
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
      setErrorMessage("请选择整点或半点的有效日期和时间。");
      return;
    }
    const end = new Date(start.getTime() + duration * 60_000);
    setErrorMessage(null);
    setBusy(true);
    try {
      try {
        await api.advanceJobApplication(application.id, {
          target_stage_type: isAssessment ? "screening" : "interview",
          target_round_no: targetRoundNo,
          target_stage_label: stageLabel,
          base_lock_version: application.lock_version,
        });
      } catch (error) {
        setErrorMessage(requestErrorMessage(error));
        return;
      }

      try {
        await api.createInterviewSession(application.id, {
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

  const activeStageLabel = activeTab === "assessment"
    ? ensureAssessmentStageLabel(assessmentLabel)
    : interviewLabel.trim();
  const activeStartAt = activeTab === "assessment" ? assessmentStartAt : interviewStartAt;
  const activeMeetingOrLocation = activeTab === "assessment"
    ? assessmentMeetingOrLocation
    : interviewMeetingOrLocation;
  const canSubmit = Boolean(activeStageLabel && parseScheduleStart(activeStartAt) && activeMeetingOrLocation.trim())
    && !busy;
  const modePlaceholder = (mode: InterviewSessionRecord["mode"]) => mode === "video" || mode === "phone"
    ? activeTab === "assessment" ? "粘贴测评链接" : "粘贴会议链接"
    : activeTab === "assessment" ? "填写测评地点或其他地点" : "填写会议室、地址或其他地点";
  const modeSubjectLabel = activeTab === "assessment" ? "测评" : "面试";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-stage-dialog career-next-stage-dialog">
        <DialogHeader className="career-next-stage-dialog-header">
          <DialogTitle>添加求职阶段</DialogTitle>
          <DialogDescription>收到明确通知后，填写已经确认的下一阶段与排期；保存后会进入对应的求职流程。</DialogDescription>
        </DialogHeader>
        <div className="career-next-stage-category">
          <div className="career-next-stage-tabs" role="tablist" aria-label="阶段分类">
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
          </div>
        </div>
        <div className="career-next-stage-divider" aria-hidden="true" />
        <div
          id={`career-next-stage-panel-${activeTab}`}
          className="career-next-stage-panel"
          role="tabpanel"
          aria-labelledby={`career-next-stage-tab-${activeTab}`}
        >
          <div className="career-next-stage-form">
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
                <div className="career-next-stage-field career-next-stage-field--full">
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
            ) : (
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
                <div className="career-next-stage-field career-next-stage-field--full">
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
            )}
          </div>
          {errorMessage && <p className="career-next-stage-error" role="alert">{errorMessage}</p>}
        </div>
        <DialogFooter className="career-next-stage-dialog-footer">
          <p>添加后会立即保存排期；如需调整，可从安排时间入口继续修改。</p>
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

function MarkApplicationAppliedDialog({
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
    if (!appliedAtIso || !resumeId) return;
    setBusy(true);
    try {
      await api.updateJobApplication(application.id, {
        applied_at: appliedAtIso,
        resume_id: resumeId,
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
          <DialogDescription className="career-applied-dialog-description">当前阶段：{progress.stageLabel}。选择本次使用的简历，系统会自动绑定该简历最新的正式版本。</DialogDescription>
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
                <SelectItem value={EMPTY_SELECT_VALUE}>请选择简历</SelectItem>
                {resumes.map((resume) => <SelectItem key={resume.id} value={resume.id}>{resume.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!resumes.length ? (
            <p className="career-stage-dialog-empty">暂无可用简历，请先创建简历并保存正式版本后再标记已投递。</p>
          ) : (
            <p className="career-stage-dialog-empty">系统会自动绑定所选简历最新的正式版本。</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!dateInputToIso(appliedAt) || !resumeId || busy} onClick={() => void submit()}>{busy ? "保存中…" : "确认标记"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OfferAction = "oc_received" | "written_offer_received" | "accepted" | "declined";

function offerStatusLabel(status: JobApplicationSummary["offer_status"]): string {
  return status === "none"
    ? "尚未收到 Offer"
    : status === "oc_received"
      ? "已收到 OC"
      : status === "written_offer_received"
        ? "已收到书面 Offer"
        : status === "accepted"
          ? "已接受 Offer"
          : "已婉拒 Offer";
}

function OfferApplicationDialog({
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
  const [busy, setBusy] = useState(false);
  const description = application.offer_status === "none"
    ? "记录收到 OC 或书面 Offer。"
    : application.offer_status === "oc_received"
      ? "记录收到书面 Offer。"
      : application.offer_status === "written_offer_received"
        ? "选择接受或婉拒 Offer。"
        : "当前 Offer 已有最终状态。";

  const submit = async (action: OfferAction) => {
    setBusy(true);
    try {
      if (action === "oc_received" || action === "written_offer_received") {
        await api.recordJobApplicationOffer(application.id, action, application.lock_version);
      } else {
        await api.closeJobApplication(application.id, {
          status: "closed",
          offer_status: action,
          base_lock_version: application.lock_version,
        });
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
      <DialogContent className="career-stage-dialog">
        <DialogHeader>
          <DialogTitle>推进求职流程</DialogTitle>
          <DialogDescription>当前阶段：{progress.stageLabel}。{description}</DialogDescription>
        </DialogHeader>
        <p className="career-stage-dialog-empty">当前 Offer 状态：{offerStatusLabel(application.offer_status)}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          {application.offer_status === "none" && (
            <>
              <Button disabled={busy} onClick={() => void submit("oc_received")}>收到 OC</Button>
              <Button variant="outline" disabled={busy} onClick={() => void submit("written_offer_received")}>收到书面 Offer</Button>
            </>
          )}
          {application.offer_status === "oc_received" && (
            <Button disabled={busy} onClick={() => void submit("written_offer_received")}>收到书面 Offer</Button>
          )}
          {application.offer_status === "written_offer_received" && (
            <>
              <Button disabled={busy} onClick={() => void submit("accepted")}>接受 Offer</Button>
              <Button variant="outline" disabled={busy} onClick={() => void submit("declined")}>婉拒 Offer</Button>
            </>
          )}
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
  const progress = projectApplicationProgress(application);
  const isSubmittedScreening = progress.columnKey === "screening"
    && application.current_stage_type === "screening"
    && Boolean(application.applied_at);
  const heroStatusLabel = progress.isPending || progress.isWaiting || progress.columnKey === "ended"
    ? progress.statusLabel
    : progress.stageLabel;
  const active = application.status === "active" && application.archived_at === null;
  const canSchedule = active && application.stage_state === "awaiting_schedule" && application.current_stage_type !== "offer";
  const canAdvance = active
    && application.stage_state === "awaiting_result"
    && application.current_stage_type !== "offer"
    && (application.current_stage_type !== "screening" || Boolean(application.applied_at));
  const canMarkApplied = active && progress.isPending;
  const canUpdateOffer = active && application.current_stage_type === "offer";
  const scheduleActionLabel = `安排${progress.stageLabel}时间`;
  const resultActionLabel = isSubmittedScreening || progress.isWaiting
    ? "添加下一阶段"
    : progress.isAssessment
      ? "记录笔试结果"
      : application.current_stage_type === "screening"
        ? "更新筛选结果"
        : `记录${progress.stageLabel}结果`;
  const primaryAction = canMarkApplied
    ? "mark-applied"
    : canSchedule
      ? "schedule"
      : canUpdateOffer
        ? "offer"
        : canAdvance
          ? "record-result"
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
            {primaryAction === "offer" && <Button onClick={() => setOfferDialogOpen(true)}>更新 Offer 状态</Button>}
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
                : "只展示当前求职路径中的关键节点；面试轮次在下方记录区呈现。"}
            </p>
          </section>
          <section className="career-detail-card career-interview-rounds career-interview-section-card">
            <header><h2>面试记录</h2><span>{applicationSessions.length} 条记录</span></header>
            {applicationSessions.length ? (
              <div className="career-interview-round-list">
                {applicationSessions.map((session) => <InterviewRoundCard key={session.id} session={session} onOpen={() => navigateTo(careerApplicationPath(application.id, session.id))} />)}
              </div>
            ) : (
              <div className="career-interview-empty">
                <CalendarDays aria-hidden="true" />
                <strong>暂无面试记录</strong>
                <p>{canSchedule ? "安排面试后，记录每一轮面试与复盘内容。" : "公司确认面试后，再添加面试阶段并安排时间。"}</p>
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
  onChanged,
  onNotice,
}: {
  assets: InterviewAssetRecord[];
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const play = async (asset: InterviewAssetRecord) => {
    setBusyAssetId(asset.id);
    try {
      const blob = await api.downloadInterviewAsset(asset.id);
      const url = URL.createObjectURL(blob);
      setAudioUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
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
        <span className="career-session-asset-icon"><FileText aria-hidden="true" /></span>
        <div><strong title={asset.original_file_name}>{asset.original_file_name}</strong><small>{formatDuration(asset.duration_ms) ?? formatBytes(asset.file_size)} · {asset.source_type === "recorded" ? "现场录制" : "文件上传"}</small></div>
        {asset.asset_type === "audio" && <Button size="sm" variant="outline" disabled={busyAssetId === asset.id} onClick={() => void play(asset)}>{busyAssetId === asset.id ? "加载中…" : "播放录音"}</Button>}
        <button type="button" aria-label={`下载 ${asset.original_file_name}`} disabled={busyAssetId === asset.id} onClick={() => void download(asset)}><Download aria-hidden="true" /></button>
        <button type="button" aria-label={`删除 ${asset.original_file_name}`} disabled={busyAssetId === asset.id} onClick={() => void remove(asset)}><Trash2 aria-hidden="true" /></button>
      </article>)}</div> : <div className="career-session-empty-content"><strong>尚未添加面试内容</strong><p>可上传音频文件，或粘贴面试文字记录。</p></div>}
      {audioUrl && <audio className="career-session-audio-player" controls autoPlay src={audioUrl} aria-label="面试录音播放器" />}
    </>
  );
}

function LiveSessionRecorder({ sessionId, onChanged, onNotice }: { sessionId: string; onChanged: () => void; onNotice: (notice: string) => void }) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const [recording, setRecording] = useState(false);
  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  const upload = async (file: File, duration: number) => {
    try {
      await api.uploadInterviewAsset(sessionId, file, "recorded", duration);
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    }
  };
  const toggle = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onNotice("当前浏览器不支持现场录音，请使用文件上传。 ");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = typeof MediaRecorder.isTypeSupported === "function"
        ? ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate))
        : undefined;
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File(chunksRef.current, `interview-${Date.now()}.${extension}`, { type });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setRecording(false);
        void upload(file, Date.now() - startedAtRef.current);
      };
      recorder.start(1_000);
      setRecording(true);
    } catch {
      onNotice("无法访问麦克风，请检查浏览器权限或改用文件上传。 ");
    }
  };
  return <button type="button" className={`career-session-recorder${recording ? " is-recording" : ""}`} onClick={() => void toggle()}><Mic aria-hidden="true" /><span>{recording ? "停止并上传" : "开始录音"}<small>{recording ? "正在采集麦克风音频" : "需要授予麦克风权限"}</small></span></button>;
}

function AddInterviewContentDialog({
  session,
  onClose,
  onChanged,
  onNotice,
}: {
  session: InterviewSessionRecord;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!file && !text.trim()) return;
    setBusy(true);
    try {
      if (file) await api.uploadInterviewAsset(session.id, file, "uploaded");
      if (text.trim()) await api.updateInterviewSession(session.id, { questions_markdown: text.trim(), base_lock_version: session.lock_version });
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
        <DialogHeader><DialogTitle>添加面试内容</DialogTitle><DialogDescription>可上传音频文件，或粘贴文字记录，任选一种即可。</DialogDescription></DialogHeader>
        <section className="career-content-upload-method">
          <h3>上传音频文件</h3>
          <div className="career-content-dropzone" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
            <Import aria-hidden="true" />
            <strong>{file ? file.name : "拖放音频文件到此处"}</strong>
            <span>{file ? `${formatBytes(file.size)} · 已选择` : "或从电脑中选择文件"}</span>
            <Button type="button" variant="outline" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}>选择文件</Button>
          </div>
          <input ref={inputRef} className="visually-hidden" type="file" accept="audio/*,video/*,.pdf,.docx,.txt,.md" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </section>
        <div className="career-content-or"><span>或</span></div>
        <section className="career-content-text-method">
          <h3>粘贴文字记录</h3>
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="粘贴面试过程、逐字稿或整理后的文字记录…" />
        </section>
        <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy || (!file && !text.trim())} onClick={() => void save()}>{busy ? "保存中…" : "保存内容"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
        <DialogHeader><DialogTitle>完成{session.stage_label}</DialogTitle><DialogDescription>完成后可以继续添加录音、面试评价和复盘。</DialogDescription></DialogHeader>
        <div className="career-complete-summary"><strong>{session.stage_label}</strong><span>{formatFullDateTime(session.start_at)} · {sessionModeLabel(session.mode)}</span></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy} onClick={() => void complete()}>{busy ? "处理中…" : "完成本轮面试"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InterviewSessionDetailView({
  detail,
  detailLoading,
  timezone,
  onBack,
  onChanged,
  onNotice,
}: {
  detail: InterviewSessionDetail | null;
  detailLoading: boolean;
  timezone: string;
  onBack: () => void;
  onChanged: (preferredId?: string | null) => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [questions, setQuestions] = useState("");
  const [review, setReview] = useState("");
  const [improvement, setImprovement] = useState("");
  const [showContentDialog, setShowContentDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [pendingLifecycle, setPendingLifecycle] = useState<"cancel" | "archive" | "restore" | "delete-session" | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  useEffect(() => {
    if (!detail) return;
    setQuestions(detail.session.questions_markdown ?? "");
    setReview(detail.session.review_summary ?? "");
    setImprovement(detail.session.improvement_markdown ?? "");
    setEditing(false);
  }, [detail?.session.id, detail?.session.lock_version]);
  if (!detail) return <section className="career-session-detail-loading">{detailLoading ? <PageLoading label="正在加载面试记录…" scope="panel" /> : <p>暂时无法读取这条面试记录。</p>}</section>;
  const { session, application, assets } = detail;
  const isArchived = application.archived_at !== null;
  const saveEdits = async () => {
    try {
      await api.updateInterviewSession(session.id, {
        questions_markdown: questions.trim() || null,
        review_summary: review.trim() || null,
        improvement_markdown: improvement.trim() || null,
        base_lock_version: session.lock_version,
      });
      setEditing(false);
      onChanged(session.id);
    } catch (error) {
      onNotice(requestErrorMessage(error));
    }
  };
  const runLifecycle = async () => {
    if (!pendingLifecycle) return;
    setLifecycleBusy(true);
    try {
      if (pendingLifecycle === "cancel") {
        await api.cancelInterviewSession(session.id, { base_lock_version: session.lock_version });
        setPendingLifecycle(null);
        onChanged(session.id);
      } else if (pendingLifecycle === "archive") {
        await api.archiveJobApplication(application.id, application.lock_version);
        setPendingLifecycle(null);
        onChanged(session.id);
      } else if (pendingLifecycle === "restore") {
        await api.restoreJobApplication(application.id, application.lock_version);
        setPendingLifecycle(null);
        onChanged(session.id);
      } else {
        await api.deleteInterviewSession(session.id);
        setPendingLifecycle(null);
        onChanged(null);
        onBack();
      }
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setLifecycleBusy(false);
    }
  };
  const lifecycleDialog = pendingLifecycle ? {
    kind: pendingLifecycle === "delete-session" ? "delete" as const : "warning" as const,
    title: pendingLifecycle === "cancel" ? "取消这场面试？" : pendingLifecycle === "archive" ? "归档这条求职进程？" : pendingLifecycle === "restore" ? "恢复这条求职进程？" : "永久删除这场面试记录？",
    description: pendingLifecycle === "cancel" ? "该场次会保留在记录复盘中，并从当前排期退出；求职进程回到待安排状态。" : pendingLifecycle === "archive" ? "归档后会从默认求职进程和排期中隐藏，历史面试与复盘仍会保留。" : pendingLifecycle === "restore" ? "恢复后，这条仍在进行的求职进程会重新进入默认求职进程列表。" : "删除后不可恢复。若存在关联素材，系统会拒绝删除并保留原记录。",
    confirmLabel: pendingLifecycle === "cancel" ? "确认取消" : pendingLifecycle === "archive" ? "确认归档" : pendingLifecycle === "restore" ? "确认恢复" : "永久删除",
  } : null;
  return (
    <div className="career-session-detail-page">
      <header className="career-record-hero career-session-record-hero">
        <div className="career-record-identity">
          <button type="button" className="career-record-back" onClick={onBack}><ChevronLeft aria-hidden="true" />返回求职记录</button>
          <div className="career-record-title-row">
            <h1>{session.stage_label}</h1>
            <span className="career-record-divider" aria-hidden="true" />
            <h1>面试记录</h1>
            <span className={`career-session-status career-session-hero-status ${sessionStatusTone(session)}`}>{sessionStatusLabel(session)}</span>
          </div>
          <p>{application.company_name_snapshot} · {application.job_title_snapshot} · {formatFullDateTime(session.start_at)} · {sessionModeLabel(session.mode)}</p>
        </div>
        <div className="career-record-actions">
          {!isArchived && <Button variant="outline" onClick={() => setEditing((value) => !value)}>{editing ? "取消编辑" : "编辑记录"}</Button>}
          {!isArchived && session.status === "scheduled" && <Button onClick={() => setShowCompleteDialog(true)}>完成本轮面试</Button>}
          {!isArchived && session.status === "scheduled" && <Button variant="outline" onClick={() => setPendingLifecycle("cancel")}>取消面试</Button>}
          <Button variant="outline" onClick={() => setPendingLifecycle(isArchived ? "restore" : "archive")}>{isArchived ? "恢复进程" : "归档进程"}</Button>
          <Button variant="ghost" onClick={() => setPendingLifecycle("delete-session")}>删除记录</Button>
        </div>
      </header>
      <div className="career-session-detail-body">
        <section className="career-session-record-content">
          <header className="career-session-content-header"><h2>面试概况</h2><span>最后更新：{formatUpdatedDateTime(session.updated_at)}</span></header>
          <div className="career-session-overview">
            <div><span>面试轮次</span><strong>{session.stage_label}</strong></div>
            <div><span>面试时间</span><strong>{formatFullDateTime(session.start_at)}</strong></div>
            <div><span>面试方式</span><strong>{sessionModeLabel(session.mode)}{session.location ? ` · ${session.location}` : ""}</strong></div>
          </div>
          {session.meeting_url && <a className="career-session-meeting-link" href={session.meeting_url} target="_blank" rel="noreferrer"><Video aria-hidden="true" />打开会议链接 <ExternalLink aria-hidden="true" /></a>}
          <section className="career-session-content-section">
            <header><h2>面试内容</h2><Button size="sm" onClick={() => setShowContentDialog(true)}>添加面试内容</Button></header>
            <SessionAssetList assets={assets} onChanged={() => onChanged(session.id)} onNotice={onNotice} />
            {questions.trim() && <div className="career-session-transcript"><h3>文字记录</h3><p>{questions}</p></div>}
            <LiveSessionRecorder sessionId={session.id} onChanged={() => onChanged(session.id)} onNotice={onNotice} />
          </section>
          <section className="career-session-review-section">
            <header><h2><CircleCheck aria-hidden="true" />面试评价与复盘</h2></header>
            {editing ? <div className="career-session-edit-fields"><label>题目记录<textarea value={questions} onChange={(event) => setQuestions(event.target.value)} /></label><label>复盘总结<textarea value={review} onChange={(event) => setReview(event.target.value)} /></label><label>需要改进<textarea value={improvement} onChange={(event) => setImprovement(event.target.value)} /></label><Button onClick={() => void saveEdits()}>保存记录</Button></div> : <div className="career-session-review-grid"><div><span>面试评价</span><p>{review || "尚未填写评价"}</p></div><div><span>面试复盘</span><p>{improvement || "尚未开始复盘"}</p></div></div>}
          </section>
          {!isArchived && application.status === "active" && application.stage_state === "awaiting_result" && <section className="career-session-stage-action"><div><strong>本轮面试已完成</strong><span>确认结果后再进入下一阶段，求职进度会随之更新。</span></div><Button onClick={() => setStageDialogOpen(true)}>添加下一阶段</Button><Button variant="outline" onClick={() => void closeApplicationAsRejected(application, onChanged, onNotice)}>未通过</Button></section>}
        </section>
      </div>
      {showContentDialog && <AddInterviewContentDialog session={session} onClose={() => setShowContentDialog(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}
      {showCompleteDialog && <CompleteInterviewDialog session={session} questions={questions} review={review} improvement={improvement} onClose={() => setShowCompleteDialog(false)} onCompleted={() => onChanged(session.id)} onNotice={onNotice} />}
      {stageDialogOpen && <AddNextStageDialog application={application} timezone={timezone} onClose={() => setStageDialogOpen(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}
      {lifecycleDialog && <ConfirmDialog kind={lifecycleDialog.kind} title={lifecycleDialog.title} description={lifecycleDialog.description} confirmLabel={lifecycleDialog.confirmLabel} busyLabel="正在处理…" busy={lifecycleBusy} onCancel={() => setPendingLifecycle(null)} onConfirm={() => void runLifecycle()} />}
    </div>
  );
}

function closeApplicationAsRejected(application: JobApplicationRecord, onChanged: () => void, onNotice: (notice: string) => void) {
  return api.closeJobApplication(application.id, { status: "rejected", base_lock_version: application.lock_version }).then(onChanged).catch((error) => onNotice(requestErrorMessage(error)));
}
