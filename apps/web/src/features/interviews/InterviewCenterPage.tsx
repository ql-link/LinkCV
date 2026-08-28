import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  Ban,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Import,
  LayoutGrid,
  Link2,
  ListChecks,
  Mic,
  NotebookTabs,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Square,
  Trash2,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ExpandableSearch, PageLoading } from "@/components/ui";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { useResumeStore } from "@/store/resumeStore";
import {
  ApiRequestError,
  api,
  type InterviewAssetRecord,
  type InterviewCalendarColor,
  type InterviewSessionDetail,
  type InterviewSessionSummary,
  type ApplicationStageType,
  type JobApplicationSummary,
  type JobDescriptionSummary,
} from "@/api/client";
import { careerApplicationPath, careerViewPath, navigateTo, type InterviewView } from "../../routing";
import {
  ApplicationsBoard,
  applicationStatusLabel,
  formatApplicationDate,
  formatApplicationDateTime,
  interviewRoundLabel,
} from "./ApplicationsBoard";
import "./interviews.css";

type InterviewStatus = "upcoming" | "active" | "completed" | "cancelled";
type ScheduleCalendarView = "week" | "month";
type Interview = {
  id: string;
  applicationId: string;
  lockVersion: number;
  company: string;
  logo: string;
  role: string;
  stage: string;
  date: string;
  weekday: string;
  time: string;
  endTime: string;
  status: InterviewStatus;
  mode: string;
  modeCode: "video" | "onsite" | "phone" | "other";
  interviewer: string;
  note: string;
  calendarDay: number;
  calendarStart: number;
  calendarSpan: number;
  color: InterviewCalendarColor;
  startAt: string;
  endAt: string;
  questions: string;
  review: string;
  improvement: string;
};
type InterviewSessionCreatePayload = Parameters<
  typeof api.createInterviewSession
>[1];

const CALENDAR_COLORS: Array<{
  id: InterviewCalendarColor;
  label: string;
}> = [
  { id: "red", label: "红色" },
  { id: "orange", label: "橙色" },
  { id: "yellow", label: "黄色" },
  { id: "green", label: "绿色" },
  { id: "blue", label: "蓝色" },
  { id: "purple", label: "紫色" },
  { id: "gray", label: "灰色" },
];
const SCHEDULE_SLOT_COUNT = 48;
const SCHEDULE_HOURS = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, "0")}:00`,
);

function startOfWeek(source = new Date()): Date {
  const result = new Date(source);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function startOfMonth(source = new Date()): Date {
  const result = new Date(source);
  result.setHours(0, 0, 0, 0);
  result.setDate(1);
  return result;
}

function startOfCalendarMonth(source = new Date()): Date {
  return startOfWeek(startOfMonth(source));
}

function addMonths(source: Date, months: number): Date {
  const result = new Date(source);
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  return result;
}

function addDays(source: Date, days: number): Date {
  const result = new Date(source);
  result.setDate(result.getDate() + days);
  return result;
}

function isoDate(source: Date): string {
  return `${source.getFullYear()}-${String(source.getMonth() + 1).padStart(2, "0")}-${String(source.getDate()).padStart(2, "0")}`;
}

function formatTime(source: Date): string {
  return `${String(source.getHours()).padStart(2, "0")}:${String(source.getMinutes()).padStart(2, "0")}`;
}

function formatDate(source: Date): string {
  return `${source.getMonth() + 1}月${source.getDate()}日`;
}

function formatDateTimeLocal(source: Date): string {
  return `${isoDate(source)}T${formatTime(source)}`;
}

function weekday(source: Date): string {
  return `周${"日一二三四五六"[source.getDay()]}`;
}

function modeLabel(mode: InterviewSessionSummary["mode"]): string {
  return mode === "video"
    ? "视频面试"
    : mode === "onsite"
      ? "现场面试"
      : mode === "phone"
        ? "电话面试"
        : "其他方式";
}

function displayStatus(session: InterviewSessionSummary): InterviewStatus {
  if (session.status === "completed") return "completed";
  if (session.status === "cancelled") return "cancelled";
  const now = Date.now();
  if (new Date(session.start_at).getTime() <= now && new Date(session.end_at).getTime() > now)
    return "active";
  return "upcoming";
}

function toInterview(session: InterviewSessionSummary, weekStart: Date): Interview {
  const start = new Date(session.start_at);
  const end = new Date(session.end_at);
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const calendarDay = Math.round(
    (dayStart.getTime() - weekStart.getTime()) / 86_400_000,
  );
  return {
    id: session.id,
    applicationId: session.application_id,
    lockVersion: session.lock_version,
    company: session.company_name,
    logo: session.company_name.slice(0, 1).toUpperCase(),
    role: session.job_title,
    stage: session.stage_label,
    date: formatDate(start),
    weekday: weekday(start),
    time: formatTime(start),
    endTime: formatTime(end),
    status: displayStatus(session),
    mode: modeLabel(session.mode),
    modeCode: session.mode,
    interviewer:
      [session.interviewer_name, session.interviewer_title]
        .filter(Boolean)
        .join("（") + (session.interviewer_name && session.interviewer_title ? "）" : "") ||
      "暂未填写",
    note: session.preparation_note ?? "暂未填写面试准备备注。",
    calendarDay,
    calendarStart: start.getHours() * 2 + Math.floor(start.getMinutes() / 30),
    calendarSpan: Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 1_800_000),
    ),
    color: session.calendar_color,
    startAt: session.start_at,
    endAt: session.end_at,
    questions: session.questions_markdown ?? "",
    review: session.review_summary ?? "",
    improvement: session.improvement_markdown ?? "",
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INTERVIEW_EDIT_CONFLICT: "这条面试已在其他页面更新，请刷新后再试。",
      INTERVIEW_INVALID_TRANSITION: "当前求职进度不允许执行这个操作。",
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

async function listAllJobApplications(
  scope: "active" | "archived" | "all",
): Promise<JobApplicationSummary[]> {
  const items: JobApplicationSummary[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await api.listJobApplications({ scope, cursor, limit: 200 });
    items.push(...page.items);
    if (!page.next_cursor) break;
    if (seenCursors.has(page.next_cursor))
      throw new Error("Interview application pagination did not advance");
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

async function listAllInterviewSessions(
  options: {
    includeArchived: boolean;
    applicationId?: string;
    startAt?: string;
    endAt?: string;
  },
): Promise<InterviewSessionSummary[]> {
  const items: InterviewSessionSummary[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await api.listInterviewSessions({
      include_archived: options.includeArchived,
      ...(options.applicationId ? { application_id: options.applicationId } : {}),
      ...(options.startAt ? { start_at: options.startAt } : {}),
      ...(options.endAt ? { end_at: options.endAt } : {}),
      cursor,
      limit: 500,
    });
    items.push(...page.items);
    if (!page.next_cursor) break;
    if (seenCursors.has(page.next_cursor))
      throw new Error("Interview session pagination did not advance");
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

const EMPTY_APPLICATION_VALUE = "暂未记录";

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "全职",
  part_time: "兼职",
  internship: "实习",
  contract: "合同",
  temporary: "临时",
};

const SALARY_PERIOD_LABELS: Record<string, string> = {
  hour: "小时",
  day: "天",
  month: "月",
  year: "年",
};

type ApplicationProgressState =
  | "done"
  | "current"
  | "pending"
  | "waiting"
  | "cancelled"
  | "ended";

type ApplicationProgressNode = {
  key: string;
  label: string;
  state: ApplicationProgressState;
  caption: string;
};

type ApplicationJobSnapshotView = {
  salary: string | null;
  workCity: string | null;
  employmentType: string | null;
  description: string | null;
  skills: string[];
  educationRequirement: string | null;
  experienceRequirement: string | null;
  workSchedule: string | null;
};

function snapshotRecord(application: JobApplicationSummary): Record<string, unknown> {
  const value = application.job_snapshot;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function snapshotScalar(
  snapshot: Record<string, unknown>,
  key: string,
): string | null {
  const value = snapshot[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function snapshotStringArray(
  snapshot: Record<string, unknown>,
  key: string,
): string[] {
  const value = snapshot[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  if (strings.length !== value.length) return [];
  return strings.map((item) => item.trim()).filter(Boolean);
}

function applicationJobSnapshot(
  application: JobApplicationSummary,
): ApplicationJobSnapshotView {
  const snapshot = snapshotRecord(application);
  const salaryText = snapshotScalar(snapshot, "salary_text");
  const salaryMin = snapshotScalar(snapshot, "salary_min");
  const salaryMax = snapshotScalar(snapshot, "salary_max");
  const salaryCurrency = snapshotScalar(snapshot, "salary_currency");
  const salaryPeriod = snapshotScalar(snapshot, "salary_period");
  const salaryMonths = snapshotScalar(snapshot, "salary_months_per_year");
  const salaryRange = salaryMin && salaryMax
    ? `${salaryMin}–${salaryMax}`
    : salaryMin ?? salaryMax;
  const salaryFallback = salaryRange
    ? [
        `${salaryRange}${salaryCurrency ? ` ${salaryCurrency}` : ""}`,
        salaryPeriod && SALARY_PERIOD_LABELS[salaryPeriod]
          ? `/${SALARY_PERIOD_LABELS[salaryPeriod]}`
          : "",
        salaryMonths ? `${salaryMonths}薪` : "",
      ].filter(Boolean).join(" ")
    : null;
  const employmentType = snapshotScalar(snapshot, "employment_type");
  return {
    salary: salaryText ?? salaryFallback,
    workCity: snapshotScalar(snapshot, "work_city"),
    employmentType: employmentType ? EMPLOYMENT_TYPE_LABELS[employmentType] ?? null : null,
    description: snapshotScalar(snapshot, "description"),
    skills: snapshotStringArray(snapshot, "skills"),
    educationRequirement: snapshotScalar(snapshot, "education_requirement"),
    experienceRequirement: snapshotScalar(snapshot, "experience_requirement"),
    workSchedule: snapshotScalar(snapshot, "work_schedule"),
  };
}

function applicationStageMatchesSession(
  application: JobApplicationSummary,
  session: InterviewSessionSummary,
): boolean {
  return session.stage_label === application.current_stage_label
    || (
      session.stage_type === application.current_stage_type
      && session.round_no === application.current_round_no
    );
}

function applicationCurrentProgressState(
  application: JobApplicationSummary,
): ApplicationProgressState {
  if (application.archived_at || application.status !== "active") return "ended";
  if (application.stage_state === "awaiting_result") return "waiting";
  if (application.stage_state === "negotiating") return "current";
  return "pending";
}

function sessionProgressState(session: InterviewSessionSummary): ApplicationProgressState {
  if (session.status === "completed") return "done";
  if (session.status === "cancelled") return "cancelled";
  return displayStatus(session) === "active" ? "current" : "pending";
}

function progressStateCaption(state: ApplicationProgressState): string {
  return {
    done: "已完成",
    current: "当前进行中",
    pending: "待安排",
    waiting: "待确认结果",
    cancelled: "已取消",
    ended: "已结束",
  }[state];
}

function buildApplicationProgress(
  application: JobApplicationSummary,
  sessions: InterviewSessionSummary[],
): ApplicationProgressNode[] {
  const sortedSessions = [...sessions].sort((left, right) => {
    const startDifference = new Date(left.start_at).getTime() - new Date(right.start_at).getTime();
    return startDifference || left.id.localeCompare(right.id);
  });
  const nodes: ApplicationProgressNode[] = [{
    key: "applied",
    label: "已投递",
    state: application.applied_at ? "done" : "pending",
    caption: application.applied_at
      ? formatApplicationDate(application.applied_at)
      : "投递时间暂未记录",
  }];
  let hasCurrentStageNode = false;
  sortedSessions.forEach((session) => {
    const isCurrentStage = applicationStageMatchesSession(application, session);
    if (
      isCurrentStage
      && (session.status !== "cancelled" || application.status !== "active" || application.archived_at)
    ) {
      hasCurrentStageNode = true;
    }
    const state = isCurrentStage
      ? session.status === "cancelled"
        ? "cancelled"
        : application.stage_state === "awaiting_result"
          ? "waiting"
          : application.stage_state === "negotiating"
            ? "current"
            : sessionProgressState(session)
      : sessionProgressState(session);
    nodes.push({
      key: `session:${session.id}`,
      label: session.stage_label.trim() || (session.round_no ? interviewRoundLabel(session.round_no) : "面试"),
      state,
      caption: isCurrentStage
        ? progressStateCaption(state)
        : `${formatApplicationDateTime(session.start_at)} · ${progressStateCaption(state)}`,
    });
  });
  if (!hasCurrentStageNode) {
    const state = applicationCurrentProgressState(application);
    nodes.push({
      key: `current:${application.current_stage_type}:${application.current_round_no ?? "none"}`,
      label: application.current_stage_label,
      state,
      caption: applicationStatusLabel(application),
    });
  }
  return nodes;
}

function applicationDate(value: string | null): string {
  return value ? formatApplicationDate(value) : EMPTY_APPLICATION_VALUE;
}

function applicationValue(value: string | null): string {
  return value?.trim() || EMPTY_APPLICATION_VALUE;
}

function formatApplicationSessionRange(session: InterviewSessionSummary): string {
  return `${formatApplicationDateTime(session.start_at)} – ${formatTime(new Date(session.end_at))}`;
}

export function InterviewCenterPage({
  view,
  initialApplicationId,
  initialSessionId,
  initialJobId,
  initialCreateApplication,
  navigation,
}: {
  view: InterviewView;
  initialApplicationId?: string;
  initialSessionId?: string;
  initialJobId?: string;
  initialCreateApplication?: boolean;
  navigation?: ReactNode;
}) {
  const [calendarView, setCalendarView] = useState<ScheduleCalendarView>("week");
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date());
  const weekStart = useMemo(() => startOfWeek(calendarAnchor), [calendarAnchor]);
  const monthGridStart = useMemo(
    () => startOfCalendarMonth(calendarAnchor),
    [calendarAnchor],
  );
  const scheduleRangeStart = useMemo(
    () => (calendarView === "week" ? weekStart : monthGridStart),
    [calendarView, monthGridStart, weekStart],
  );
  const scheduleRangeEnd = useMemo(
    () => addDays(scheduleRangeStart, calendarView === "week" ? 7 : 42),
    [calendarView, scheduleRangeStart],
  );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  const isApplicationDetail = view === "applications" && Boolean(initialApplicationId);
  const [sessions, setSessions] = useState<InterviewSessionSummary[]>([]);
  const [applications, setApplications] = useState<JobApplicationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
  const [detail, setDetail] = useState<InterviewSessionDetail | null>(null);
  const [query, setQuery] = useState("");
  const [applicationDisplayMode, setApplicationDisplayMode] = useState<"board" | "list">("list");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateApplication, setShowCreateApplication] = useState(false);
  const [createInterviewApplicationId, setCreateInterviewApplicationId] = useState<string | null>(null);
  const [createInterviewStartAt, setCreateInterviewStartAt] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    id: string;
    startAt: string;
    endAt: string;
  } | null>(null);
  const selectedIdRef = useRef<string | null>(initialSessionId ?? null);
  const loadRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  useEffect(() => {
    if (initialCreateApplication) setShowCreateApplication(true);
  }, [initialCreateApplication]);

  const loadDetail = useCallback(async (id: string) => {
    const requestId = ++detailRequestRef.current;
    setDetail(null);
    setDetailLoading(true);
    try {
      const nextDetail = await api.getInterviewSession(id);
      if (requestId !== detailRequestRef.current || nextDetail.session.id !== id) return;
      setDetail(nextDetail);
    } catch (error) {
      if (requestId === detailRequestRef.current) setNotice(errorMessage(error));
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, []);

  const loadData = useCallback(async (preferredId?: string | null) => {
    const requestId = ++loadRequestRef.current;
    const invalidatedDetailRequest = ++detailRequestRef.current;
    setLoading(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const includeArchivedSessions = view === "records" || isApplicationDetail;
      const applicationScope = view === "records" || view === "applications" ? "all" : "active";
      const sessionRange = includeArchivedSessions
        ? {}
        : {
            startAt: scheduleRangeStart.toISOString(),
            endAt: scheduleRangeEnd.toISOString(),
          };
      const [nextSessions, nextApplications] = await Promise.all([
        listAllInterviewSessions({
          includeArchived: includeArchivedSessions,
          ...(isApplicationDetail && initialApplicationId
            ? { applicationId: initialApplicationId }
            : {}),
          ...sessionRange,
        }),
        listAllJobApplications(applicationScope),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setSessions(nextSessions);
      setApplications(nextApplications);
      const requestedId = preferredId === null ? null : preferredId ?? selectedIdRef.current;
      const nextSelected =
        requestedId !== null && nextSessions.some((item) => item.id === requestedId)
          ? requestedId
          : nextSessions[0]?.id ?? null;
      selectedIdRef.current = nextSelected;
      setSelectedId(nextSelected);
      if (isApplicationDetail) {
        ++detailRequestRef.current;
        setDetail(null);
        setDetailLoading(false);
      } else if (nextSelected) await loadDetail(nextSelected);
      else {
        ++detailRequestRef.current;
        setDetail(null);
        setDetailLoading(false);
      }
    } catch (error) {
      if (requestId === loadRequestRef.current) {
        setNotice(errorMessage(error));
        if (detailRequestRef.current === invalidatedDetailRequest)
          setDetailLoading(false);
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [
    initialApplicationId,
    isApplicationDetail,
    loadDetail,
    scheduleRangeEnd,
    scheduleRangeStart,
    timezone,
    view,
  ]);

  useEffect(() => {
    setSessions([]);
    setApplications([]);
    selectedIdRef.current = initialSessionId ?? null;
    setSelectedId(initialSessionId ?? null);
    setDetail(null);
    void loadData(initialSessionId);
    return () => {
      ++loadRequestRef.current;
      ++detailRequestRef.current;
    };
  }, [initialSessionId, loadData]);

  const interviews = useMemo(
    () => sessions.map((session) => toInterview(session, weekStart)),
    [sessions, weekStart],
  );
  const queryMatchedInterviews = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return interviews.filter(
      (item) =>
        !normalized ||
        `${item.company}${item.role}${item.stage}`.toLowerCase().includes(normalized),
    );
  }, [interviews, query]);
  const selected =
    interviews.find((item) => item.id === selectedId) ?? interviews[0] ?? null;

  const selectInterview = async (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    await loadDetail(id);
  };

  const reschedule = async (
    id: string,
    calendarDay: number,
    calendarStart: number,
    allowConflict = false,
  ) => {
    const current = interviews.find((item) => item.id === id);
    if (!current) return;
    const start = addDays(weekStart, calendarDay);
    start.setHours(Math.floor(calendarStart / 2), calendarStart % 2 ? 30 : 0, 0, 0);
    const end = new Date(start.getTime() + current.calendarSpan * 1_800_000);
    const optimisticStart = start.toISOString();
    const optimisticEnd = end.toISOString();
    setSessions((items) =>
      items.map((item) =>
        item.id === id
          ? { ...item, start_at: optimisticStart, end_at: optimisticEnd }
          : item,
      ),
    );
    try {
      const response = await api.rescheduleInterviewSession(id, {
        start_at: optimisticStart,
        end_at: optimisticEnd,
        timezone,
        allow_conflict: allowConflict,
        base_lock_version: current.lockVersion,
      });
      setPendingConflict(null);
      await loadData(response.session.id);
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.message === "INTERVIEW_TIME_CONFLICT" &&
        !allowConflict
      ) {
        setPendingConflict({ id, startAt: optimisticStart, endAt: optimisticEnd });
        setNotice("这个时间段与其他面试重叠。你可以取消调整，或确认仍然保存。 ");
        return;
      }
      setPendingConflict(null);
      setNotice(errorMessage(error));
      await loadData(id);
    }
  };

  const updateColor = async (color: InterviewCalendarColor) => {
    if (!detail || detail.session.id !== selectedIdRef.current) return;
    try {
      await api.updateJobApplication(detail.application.id, {
        calendar_color: color,
        base_lock_version: detail.application.lock_version,
      });
      await loadData(detail.session.id);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const openCreateInterview = (initialStartAt?: string) => {
    setCreateInterviewApplicationId(null);
    setCreateInterviewStartAt(initialStartAt ?? null);
    setShowCreate(true);
  };

  const moveCalendarPeriod = (direction: number) => {
    setCalendarAnchor((current) => calendarView === "week"
      ? addDays(current, direction * 7)
      : addMonths(current, direction));
  };

  return (
    <>
      {!isApplicationDetail && (
        <WorkspacePageHero
          className="career-module-header"
          icon={<BriefcaseBusiness />}
          tone="warning"
          title="求职中心"
          description="导入岗位，记录每一轮面试，并完成复盘。"
          actions={(
            <>
              {view === "applications" ? (
                <ApplicationHeaderControls
                  query={query}
                  displayMode={applicationDisplayMode}
                  onImport={() => navigateTo("/career/jobs/new")}
                  onDisplayModeChange={setApplicationDisplayMode}
                  onQueryChange={setQuery}
                />
              ) : view === "schedule" ? (
                <ScheduleHeaderControls
                  query={query}
                  onCreate={() => openCreateInterview()}
                  onQueryChange={setQuery}
                />
              ) : (
                <>
                  <ExpandableSearch
                    label="搜索面试"
                    name="interview-search"
                    value={query}
                    onValueChange={setQuery}
                    placeholder="搜索公司、职位或阶段…"
                  />
                  <Button icon={<Plus />} onClick={() => openCreateInterview()}>新建面试</Button>
                </>
              )}
            </>
          )}
        />
      )}
      {!isApplicationDetail && <CareerSubnavigationRow navigation={navigation} />}
      {isApplicationDetail && initialApplicationId && (() => {
        const application = applications.find((item) => item.id === initialApplicationId);
        return application ? (
          <ApplicationRecordHero
            application={application}
            sessions={sessions}
            onCreateInterview={(applicationId) => {
              setCreateInterviewApplicationId(applicationId);
              setCreateInterviewStartAt(null);
              setShowCreate(true);
            }}
          />
        ) : null;
      })()}
      <main className={`dashboard-content interview-center-content${isApplicationDetail ? " is-application-detail-route" : ""}`}>
      {notice && (
        <div className="interview-error-notice" role="alert" aria-live="assertive">
          <CircleAlert aria-hidden="true" />
          {notice}
          {pendingConflict && (
            <button
              type="button"
              onClick={() => {
                const start = new Date(pendingConflict.startAt);
                const day = Math.round(
                  (new Date(
                    start.getFullYear(),
                    start.getMonth(),
                    start.getDate(),
                  ).getTime() -
                    weekStart.getTime()) /
                    86_400_000,
                );
                void reschedule(
                  pendingConflict.id,
                  day,
                  start.getHours() * 2 + (start.getMinutes() === 30 ? 1 : 0),
                  true,
                );
              }}
            >
              仍然保存
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setPendingConflict(null);
              void loadData(selectedId ?? undefined);
            }}
          >
            关闭
          </button>
        </div>
      )}
      {loading && sessions.length === 0 ? (
        <PageLoading label="正在加载求职数据…" />
      ) : view === "applications" ? (
        <ApplicationsView
          applications={applications}
          selectedApplicationId={initialApplicationId}
          applicationSessions={isApplicationDetail ? sessions : undefined}
          query={query}
          displayMode={applicationDisplayMode}
          onImport={() => navigateTo("/career/jobs/new")}
          onCreateInterview={(applicationId) => {
            setCreateInterviewApplicationId(applicationId);
            setCreateInterviewStartAt(null);
            setShowCreate(true);
          }}
        />
      ) : view === "schedule" ? (
          <ScheduleView
            interviews={interviews}
            detail={detail}
            detailLoading={detailLoading}
            query={query}
            calendarView={calendarView}
            anchor={calendarAnchor}
            weekStart={weekStart}
            monthGridStart={monthGridStart}
            createInterviewStartAt={createInterviewStartAt}
            onViewChange={setCalendarView}
            onPeriodChange={moveCalendarPeriod}
            onCreateAt={(startAt) => openCreateInterview(startAt)}
            onSelect={(id) => void selectInterview(id)}
            onMove={(id, day, slot) => void reschedule(id, day, slot)}
          />
      ) : (
        <RecordsView
          applications={applications}
          applicationIdsWithSessions={sessions.map((item) => item.application_id)}
          interviews={queryMatchedInterviews}
          selected={selected}
          detail={detail}
          detailLoading={detailLoading}
          onSelect={(id) => void selectInterview(id)}
          onColorChange={(color) => void updateColor(color)}
          onChanged={(preferredId) => void loadData(preferredId)}
          onNotice={setNotice}
        />
      )}
      {showCreate && (
        <CreateInterviewDialog
          applications={applications.filter(
            (item) =>
              item.status === "active" &&
              item.archived_at === null &&
              item.stage_state === "awaiting_schedule" &&
              item.current_stage_type !== "offer",
          )}
          initialApplicationId={createInterviewApplicationId}
          initialStartAt={createInterviewStartAt}
          timezone={timezone}
          onClose={() => {
            setShowCreate(false);
            setCreateInterviewApplicationId(null);
            setCreateInterviewStartAt(null);
          }}
          onCreated={(id) => {
            setShowCreate(false);
            setCreateInterviewApplicationId(null);
            void loadData(id).finally(() => setCreateInterviewStartAt(null));
          }}
          onNotice={setNotice}
        />
      )}
      {showCreateApplication && (
        <CreateApplicationDialog
          initialJobId={initialJobId}
          onClose={() => setShowCreateApplication(false)}
          onCreated={(applicationId) => {
            setShowCreateApplication(false);
            void loadData();
            navigateTo(careerApplicationPath(applicationId));
          }}
          onNotice={setNotice}
        />
      )}
      </main>
    </>
  );
}

function OverviewLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return <a className={className} href={href} onClick={(event) => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    navigateTo(href);
  }}>{children}</a>;
}

function ApplicationHeaderControls({
  query,
  displayMode,
  onImport,
  onDisplayModeChange,
  onQueryChange,
}: {
  query: string;
  displayMode: "board" | "list";
  onImport: () => void;
  onDisplayModeChange: (value: "board" | "list") => void;
  onQueryChange: (value: string) => void;
}) {
  return (
    <div className="career-applications-controls">
      <ExpandableSearch
        label="搜索公司、岗位"
        name="career-application-search"
        value={query}
        onValueChange={onQueryChange}
        placeholder="搜索公司、岗位…"
      />
      <div className="career-view-switch" role="group" aria-label="求职记录展示方式">
        <button type="button" aria-pressed={displayMode === "list"} onClick={() => onDisplayModeChange("list")}>
          <ListChecks />列表
        </button>
        <button type="button" aria-pressed={displayMode === "board"} onClick={() => onDisplayModeChange("board")}>
          <LayoutGrid />阶段看板
        </button>
      </div>
      <Button icon={<Import />} onClick={onImport}>导入岗位</Button>
    </div>
  );
}

function CareerSubnavigationRow({
  navigation,
}: {
  navigation?: ReactNode;
}) {
  if (!navigation) return null;
  return (
    <div className="career-subnav-row">
      {navigation}
    </div>
  );
}

function ScheduleHeaderControls({ query, onCreate, onQueryChange }: { query: string; onCreate: () => void; onQueryChange: (value: string) => void }) {
  return (
    <div className="schedule-page-actions">
      <ExpandableSearch label="搜索面试排期" name="schedule-search" value={query} onValueChange={onQueryChange} placeholder="搜索公司、职位或轮次…" />
      <Button icon={<Plus />} onClick={onCreate}>安排面试</Button>
    </div>
  );
}

function applicationNextStageLabel(application: JobApplicationSummary): string {
  if (!application.applied_at || application.stage_state === "awaiting_schedule") return "待安排";
  if (application.stage_state === "awaiting_result") return "待通知";
  if (application.stage_state === "negotiating") return "Offer 沟通";
  return "—";
}

function applicationRecentInterviewLabel(application: JobApplicationSummary): string {
  return application.next_session_start_at
    ? formatApplicationDateTime(application.next_session_start_at)
    : "待安排";
}

function ApplicationsView({
  applications,
  selectedApplicationId,
  applicationSessions,
  query,
  displayMode,
  onImport,
  onCreateInterview,
}: {
  applications: JobApplicationSummary[];
  selectedApplicationId?: string;
  applicationSessions?: InterviewSessionSummary[];
  query: string;
  displayMode: "board" | "list";
  onImport: () => void;
  onCreateInterview: (applicationId: string) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleApplications = applications.filter((item) =>
    !normalizedQuery
      || `${item.company_name_snapshot}${item.job_title_snapshot}${item.current_stage_label}`
        .toLowerCase()
        .includes(normalizedQuery),
  ).sort((left, right) => {
    const difference = new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    return difference;
  });
  const selectedApplication = selectedApplicationId
    ? applications.find((item) => item.id === selectedApplicationId) ?? null
    : null;
  if (selectedApplicationId) {
    return selectedApplication ? (
      <ApplicationDetailView
        application={selectedApplication}
        sessions={applicationSessions ?? []}
        onCreateInterview={onCreateInterview}
      />
    ) : (
      <section className="career-application-detail-not-found">
        <BriefcaseBusiness aria-hidden="true" />
        <h1>无法打开这条求职进程</h1>
        <p>记录不存在、已被删除，或当前账号没有访问权限。</p>
        <Button variant="outline" onClick={() => navigateTo(careerViewPath("applications"))}>返回求职记录</Button>
      </section>
    );
  }
  return (
    <div className="career-applications-layout">
      <ApplicationsBoard
        visibleApplications={visibleApplications}
        displayMode={displayMode}
      />
      {displayMode === "list" && visibleApplications.length ? (
        <section className="interview-surface career-applications-list-surface">
          {normalizedQuery && <p className="career-application-filter-count">当前显示 {visibleApplications.length} 条匹配记录</p>}
          <div className="career-application-list" role="table" aria-label="求职记录列表">
            <div role="row">
              <span role="columnheader">公司</span>
              <span role="columnheader">岗位</span>
              <span role="columnheader">当前进度</span>
              <span role="columnheader">下一阶段</span>
              <span role="columnheader">最近面试</span>
              <span role="columnheader">更新时间</span>
              <span role="columnheader">操作</span>
            </div>
            {visibleApplications.map((item) => (
              <div role="row" key={item.id}>
                <span role="cell">{item.company_name_snapshot.trim() || "—"}</span>
                <span role="cell">{item.job_title_snapshot.trim() || "—"}</span>
                <span role="cell"><strong>{item.current_stage_label.trim() || "—"}</strong><small>{applicationStatusLabel(item)}</small></span>
                <span role="cell">{applicationNextStageLabel(item)}</span>
                <span role="cell">{applicationRecentInterviewLabel(item)}</span>
                <span role="cell">{item.updated_at ? formatApplicationDate(item.updated_at) : "—"}</span>
                <span role="cell"><Button size="sm" variant="outline" onClick={() => navigateTo(careerApplicationPath(item.id))}>查看记录</Button></span>
              </div>
            ))}
          </div>
        </section>
      ) : displayMode === "list" && !visibleApplications.length ? (
        <section className="career-applications-empty-surface">
          <div className="career-applications-empty">
            <BriefcaseBusiness />
            <h2>{normalizedQuery ? "没有匹配的求职记录" : "还没有求职记录"}</h2>
            <p>{normalizedQuery ? "换个公司、岗位或阶段关键词试试。" : "导入岗位后，就可以在这里记录投递进度和面试复盘。"}</p>
            {!normalizedQuery && <Button onClick={onImport}>导入第一个岗位</Button>}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ApplicationRecordHero({
  application,
  sessions,
  onCreateInterview,
}: {
  application: JobApplicationSummary;
  sessions: InterviewSessionSummary[];
  onCreateInterview: (applicationId: string) => void;
}) {
  const hasScheduledInterview = Boolean(
    application.next_session_id
      || sessions.some((session) => session.status === "scheduled"),
  );
  const canScheduleInterview = application.status === "active"
    && application.stage_state === "awaiting_schedule";
  return (
    <header className="career-record-hero">
      <div className="career-record-hero-inner">
        <div className="career-record-hero-copy">
          <OverviewLink className="career-record-back" href={careerViewPath("applications")}>
            <ChevronLeft aria-hidden="true" />返回求职记录
          </OverviewLink>
          <div className="career-record-title-row">
            <h1>
              <span>{application.company_name_snapshot}</span>
              <span className="career-record-title-divider" aria-hidden="true">｜</span>
              <span>{application.job_title_snapshot}</span>
            </h1>
            <span className={`career-record-status is-${application.archived_at ? "archived" : application.status}`}>
              {applicationStatusLabel(application)}
            </span>
          </div>
          <dl className="career-record-meta">
            <div><dt>投递时间</dt><dd>{applicationDate(application.applied_at)}</dd></div>
            <div><dt>关联简历</dt><dd>{applicationValue(application.resume_title_snapshot)}</dd></div>
            <div><dt>更新时间</dt><dd>{applicationDate(application.updated_at)}</dd></div>
          </dl>
        </div>
        <div className="career-record-actions" aria-label="求职记录操作">
          <Button variant="outline" onClick={() => navigateTo(jobDetailPathFromApplication(application))}>查看岗位详情</Button>
          {hasScheduledInterview ? (
            <Button onClick={() => navigateTo(careerViewPath("schedule"))}>修改面试安排</Button>
          ) : canScheduleInterview ? (
            <Button onClick={() => onCreateInterview(application.id)}>安排面试</Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function ApplicationDetailView({
  application,
  sessions,
  onCreateInterview,
}: {
  application: JobApplicationSummary;
  sessions: InterviewSessionSummary[];
  onCreateInterview: (applicationId: string) => void;
}) {
  const sortedSessions = useMemo(() => [...sessions].sort((left, right) => {
    const startDifference = new Date(left.start_at).getTime() - new Date(right.start_at).getTime();
    return startDifference || left.id.localeCompare(right.id);
  }), [sessions]);
  const progress = useMemo(
    () => buildApplicationProgress(application, sortedSessions),
    [application, sortedSessions],
  );
  const job = useMemo(() => applicationJobSnapshot(application), [application]);
  const canScheduleInterview = application.status === "active"
    && application.stage_state === "awaiting_schedule";
  return (
    <div className="career-application-detail-layout">
      <div className="career-application-detail-main">
        <ApplicationProgressCard application={application} nodes={progress} />
        <section className="interview-surface application-interviews-card" aria-labelledby="application-interviews-title">
          <header className="application-detail-section-heading">
            <h2 id="application-interviews-title">面试记录</h2>
            <span>名称按公司实际流程填写</span>
          </header>
          {sortedSessions.length ? (
            <div className="application-interview-list" role="list" aria-label="面试记录列表">
              {sortedSessions.map((session) => (
                <ApplicationInterviewCard
                  key={session.id}
                  application={application}
                  session={session}
                />
              ))}
            </div>
          ) : (
            <div className="application-interviews-empty">
              <NotebookTabs aria-hidden="true" />
              <h3>暂无面试记录</h3>
              <p>
                {canScheduleInterview
                  ? "当前阶段还没有安排面试，完成安排后会显示在这里。"
                  : "当这条求职记录产生面试后，面试时间、方式和复盘摘要会显示在这里。"}
              </p>
            </div>
          )}
        </section>
      </div>
      <aside className="career-application-detail-aside">
        <ApplicationJobCard application={application} job={job} />
        <ApplicationInfoCard application={application} />
      </aside>
    </div>
  );
}

function ApplicationProgressCard({
  application,
  nodes,
}: {
  application: JobApplicationSummary;
  nodes: ApplicationProgressNode[];
}) {
  return (
    <section className="interview-surface application-progress-card" aria-labelledby="application-progress-title">
      <header className="application-detail-section-heading">
        <h2 id="application-progress-title">求职进度</h2>
        <span>{application.current_stage_label}</span>
      </header>
      <div className="application-progress-rail" role="group" aria-label={`当前求职进度：${application.current_stage_label}`}>
        <ol>
          {nodes.map((node) => (
            <li
              key={node.key}
              className={`is-${node.state}`}
              aria-current={node.state === "current" || node.state === "waiting" ? "step" : undefined}
            >
              <span className="application-progress-marker" aria-hidden="true">
                {node.state === "done" ? <Check /> : node.state === "cancelled" ? <X /> : null}
              </span>
              <strong>{node.label}</strong>
              <small>{node.caption}</small>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ApplicationInterviewCard({
  application,
  session,
}: {
  application: JobApplicationSummary;
  session: InterviewSessionSummary;
}) {
  const status = displayStatus(session);
  const summaries = [
    { label: "题目记录", value: session.questions_markdown },
    { label: "复盘总结", value: session.review_summary },
    { label: "需要改进", value: session.improvement_markdown },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value?.trim()));
  return (
    <article className={`application-interview-item is-${status}`} role="listitem">
      <OverviewLink
        className="application-interview-card"
        href={careerApplicationPath(application.id, session.id)}
      >
        <div className="application-interview-card-head">
          <div>
            <p className="application-interview-stage">{session.stage_label}</p>
            <h3>{formatApplicationSessionRange(session)}</h3>
          </div>
          <StatusBadge status={status} />
        </div>
        <dl className="application-interview-meta">
          <div><dt>面试方式</dt><dd>{modeLabel(session.mode)}</dd></div>
          <div><dt>面试官</dt><dd>{applicationValue([session.interviewer_name, session.interviewer_title].filter(Boolean).join("（") + (session.interviewer_name && session.interviewer_title ? "）" : ""))}</dd></div>
        </dl>
        <div className="application-interview-summary">
          {summaries.length ? summaries.map(({ label, value }) => (
            <p key={label}><strong>{label}</strong><span>{value}</span></p>
          )) : <p className="is-empty">{status === "completed" ? "已完成，暂未填写复盘摘要。" : "面试完成后可在记录中补充复盘摘要。"}</p>}
        </div>
        <span className="application-interview-link">进入记录查看录音与素材 <ChevronRight aria-hidden="true" /></span>
      </OverviewLink>
    </article>
  );
}

function ApplicationJobCard({
  application,
  job,
}: {
  application: JobApplicationSummary;
  job: ApplicationJobSnapshotView;
}) {
  const requirements = [job.educationRequirement, job.experienceRequirement, job.workSchedule]
    .filter((item): item is string => Boolean(item?.trim()));
  return (
    <section className="interview-surface application-job-card" aria-labelledby="application-job-title">
      <header className="application-detail-section-heading">
        <h2 id="application-job-title">岗位详情</h2>
        <OverviewLink href={jobDetailPathFromApplication(application)}>查看完整岗位 →</OverviewLink>
      </header>
      <div className="application-job-identity">
        <span>{application.company_name_snapshot}</span>
        <strong>{application.job_title_snapshot}</strong>
      </div>
      <dl className="application-job-highlights">
        <div><dt>薪资范围</dt><dd>{applicationValue(job.salary)}</dd></div>
        <div><dt>工作城市</dt><dd>{applicationValue(job.workCity)}</dd></div>
        <div><dt>用工类型</dt><dd>{applicationValue(job.employmentType)}</dd></div>
      </dl>
      <div className="application-job-description">
        <h3>岗位描述</h3>
        <p>{applicationValue(job.description)}</p>
      </div>
      <div className="application-job-skills">
        <h3>核心技能</h3>
        {job.skills.length ? (
          <ul>{job.skills.map((skill) => <li key={skill}>{skill}</li>)}</ul>
        ) : <p>{EMPTY_APPLICATION_VALUE}</p>}
      </div>
      <div className="application-job-requirements">
        <h3>岗位要求</h3>
        <p>{requirements.length ? requirements.join(" · ") : EMPTY_APPLICATION_VALUE}</p>
      </div>
    </section>
  );
}

function ApplicationInfoCard({ application }: { application: JobApplicationSummary }) {
  return (
    <section className="interview-surface application-info-card" aria-labelledby="application-info-title">
      <header className="application-detail-section-heading">
        <h2 id="application-info-title">求职信息</h2>
      </header>
      <dl className="application-info-fields">
        <div><dt>当前阶段</dt><dd>{applicationValue(application.current_stage_label)}</dd></div>
        <div><dt>投递时间</dt><dd>{applicationDate(application.applied_at)}</dd></div>
        <div><dt>关联简历</dt><dd>{applicationValue(application.resume_title_snapshot)}</dd></div>
        <div className="is-wide"><dt>备注</dt><dd>{applicationValue(application.notes)}</dd></div>
      </dl>
    </section>
  );
}

function jobDetailPathFromApplication(application: JobApplicationSummary): string {
  return application.job_description_id ? `/career/jobs/${encodeURIComponent(application.job_description_id)}` : "/career/jobs";
}

function createScheduleMockInterviews(weekStart: Date): Interview[] {
  const build = (id: string, company: string, role: string, stage: string, day: number, hour: number, minute: number, color: InterviewCalendarColor, interviewer: string, mode: string): Interview => {
    const start = addDays(weekStart, day);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      id: `mock-schedule-${id}`,
      applicationId: `mock-application-${id}`,
      lockVersion: 1,
      company,
      logo: company.slice(0, 1),
      role,
      stage,
      date: formatDate(start),
      weekday: weekday(start),
      time: formatTime(start),
      endTime: formatTime(end),
      status: "upcoming",
      mode,
      modeCode: "video",
      interviewer,
      note: "请提前 10 分钟进入会议并检查设备。",
      calendarDay: day,
      calendarStart: hour * 2 + (minute === 30 ? 1 : 0),
      calendarSpan: 2,
      color,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      questions: "",
      review: "",
      improvement: "",
    };
  };
  return [
    build("byte", "字节跳动", "产品经理", "一面", 0, 10, 0, "purple", "王倩（产品负责人）", "视频面试（飞书会议）"),
    build("meituan", "美团", "高级产品经理", "二面", 1, 14, 0, "blue", "陈老师（业务负责人）", "视频面试（腾讯会议）"),
    build("alibaba", "阿里巴巴", "后端开发工程师", "二面", 2, 9, 30, "orange", "李明（技术专家）", "视频面试（钉钉会议）"),
    build("tencent", "腾讯", "产品经理", "HR 面", 2, 15, 30, "green", "刘女士（HRBP）", "视频面试（腾讯会议）"),
    build("jd", "京东", "平台产品经理", "终面", 4, 16, 0, "red", "周总（业务总监）", "现场面试 · 北京"),
  ];
}

function moveScheduleMockInterview(item: Interview, weekStart: Date, calendarDay: number, calendarStart: number): Interview {
  const start = addDays(weekStart, calendarDay);
  start.setHours(Math.floor(calendarStart / 2), calendarStart % 2 ? 30 : 0, 0, 0);
  const end = new Date(start.getTime() + item.calendarSpan * 30 * 60 * 1000);
  return { ...item, calendarDay, calendarStart, date: formatDate(start), weekday: weekday(start), time: formatTime(start), endTime: formatTime(end), startAt: start.toISOString(), endAt: end.toISOString() };
}

function createScheduleDraftInterview(startAt: string, weekStart: Date): Interview | null {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const calendarDay = Math.round((dayStart.getTime() - weekStart.getTime()) / 86_400_000);
  const calendarStart = start.getHours() * 2 + (start.getMinutes() >= 30 ? 1 : 0);
  if (calendarDay < 0 || calendarDay > 6 || calendarStart < 0 || calendarStart >= SCHEDULE_SLOT_COUNT) return null;
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id: "draft-interview",
    applicationId: "",
    lockVersion: 0,
    company: "新面试排期",
    logo: "",
    role: "待填写",
    stage: "待创建",
    date: formatDate(start),
    weekday: weekday(start),
    time: formatTime(start),
    endTime: formatTime(end),
    status: "upcoming",
    mode: "",
    modeCode: "other",
    interviewer: "",
    note: "",
    calendarDay,
    calendarStart,
    calendarSpan: 2,
    color: "gray",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    questions: "",
    review: "",
    improvement: "",
  };
}

function schedulePeriodLabel(calendarView: ScheduleCalendarView, anchor: Date, weekStart: Date): string {
  if (calendarView === "month") return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`;
  const weekEnd = addDays(weekStart, 6);
  return `${weekStart.getFullYear()}年${formatDate(weekStart)} – ${formatDate(weekEnd)}`;
}

function ScheduleToolbar({
  calendarView,
  anchor,
  weekStart,
  onViewChange,
  onPeriodChange,
}: {
  calendarView: ScheduleCalendarView;
  anchor: Date;
  weekStart: Date;
  onViewChange: (view: ScheduleCalendarView) => void;
  onPeriodChange: (direction: number) => void;
}) {
  const periodLabel = schedulePeriodLabel(calendarView, anchor, weekStart);
  const periodName = calendarView === "week" ? "周" : "月";
  return (
    <div className="schedule-toolbar" aria-label="排期日历工具栏">
      <h2 className="schedule-toolbar-title">
        {calendarView === "week" ? "本周排期" : "本月排期"}
      </h2>
      <div className="schedule-toolbar-period" aria-live="polite">
        <button type="button" aria-label={`上一${periodName}`} title={`上一${periodName}`} onClick={() => onPeriodChange(-1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <strong>{periodLabel}</strong>
        <button type="button" aria-label={`下一${periodName}`} title={`下一${periodName}`} onClick={() => onPeriodChange(1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="schedule-toolbar-actions">
        <div className="schedule-view-segment" role="group" aria-label="日历视图">
          <button type="button" aria-pressed={calendarView === "week"} onClick={() => onViewChange("week")}>周视图</button>
          <button type="button" aria-pressed={calendarView === "month"} onClick={() => onViewChange("month")}>月视图</button>
        </div>
      </div>
    </div>
  );
}

function MonthCalendar({
  anchor,
  monthGridStart,
  interviews,
  selectedId,
  onSelect,
}: {
  anchor: Date;
  monthGridStart: Date;
  interviews: Interview[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const todayIso = isoDate(new Date());
  const days = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));
  const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return (
    <div className="month-calendar" role="grid" aria-label="面试月排期">
      <div className="month-calendar-head" role="row">
        {weekdayLabels.map((label) => <span role="columnheader" key={label}>{label}</span>)}
      </div>
      <div className="month-calendar-grid">
        {days.map((day) => {
          const dayIso = isoDate(day);
          const dayInterviews = interviews
            .filter((item) => isoDate(new Date(item.startAt)) === dayIso)
            .sort((left, right) => left.startAt.localeCompare(right.startAt));
          const dayLabel = `${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`;
          return (
            <div
              key={dayIso}
              className={`month-day${day.getMonth() !== anchor.getMonth() || day.getFullYear() !== anchor.getFullYear() ? " is-outside" : ""}${dayIso === todayIso ? " is-today" : ""}`}
              role="gridcell"
              tabIndex={0}
              aria-label={`${dayLabel}${dayInterviews.length ? `，${dayInterviews.length}场面试` : ""}`}
            >
              <span className="month-day-number">{day.getDate()}</span>
              <div className="month-day-events">
                {dayInterviews.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`month-event calendar-${item.color}${selectedId === item.id ? " is-selected" : ""}`}
                    aria-label={`${item.time} ${item.company} ${item.stage}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(item.id);
                    }}
                  >
                    <span>{item.time}</span>
                    <strong>{item.company}</strong>
                    <em>{item.stage}</em>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleView({
  interviews,
  detail,
  detailLoading,
  query,
  calendarView,
  anchor,
  weekStart,
  monthGridStart,
  createInterviewStartAt,
  onViewChange,
  onPeriodChange,
  onCreateAt,
  onSelect,
  onMove,
}: {
  interviews: Interview[];
  detail: InterviewSessionDetail | null;
  detailLoading: boolean;
  query: string;
  calendarView: ScheduleCalendarView;
  anchor: Date;
  weekStart: Date;
  monthGridStart: Date;
  createInterviewStartAt: string | null;
  onViewChange: (view: ScheduleCalendarView) => void;
  onPeriodChange: (direction: number) => void;
  onCreateAt: (startAt: string) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, calendarDay: number, calendarStart: number) => void;
}) {
  const [mockInterviews, setMockInterviews] = useState(() => createScheduleMockInterviews(weekStart));
  const [openInterviewId, setOpenInterviewId] = useState<string | null>(null);
  useEffect(() => {
    setMockInterviews(createScheduleMockInterviews(weekStart));
    setOpenInterviewId(null);
  }, [weekStart]);
  const isUsingMock = interviews.length === 0;
  const normalizedQuery = query.trim().toLowerCase();
  const sourceInterviews = isUsingMock ? mockInterviews : interviews;
  const draftInterview = createInterviewStartAt
    ? createScheduleDraftInterview(createInterviewStartAt, weekStart)
    : null;
  const hasPersistedDraft = draftInterview
    ? sourceInterviews.some((item) => new Date(item.startAt).getTime() === new Date(draftInterview.startAt).getTime())
    : false;
  const visibleDraftInterview = draftInterview && !hasPersistedDraft ? draftInterview : null;
  const visibleInterviews = sourceInterviews.filter((item) => !normalizedQuery || `${item.company}${item.role}${item.stage}`.toLowerCase().includes(normalizedQuery));
  const dialogInterview = openInterviewId
    ? sourceInterviews.find((item) => item.id === openInterviewId) ?? null
    : null;
  const handleSelect = (id: string) => {
    setOpenInterviewId(id);
    if (!isUsingMock) onSelect(id);
  };
  const handleMove = (id: string, calendarDay: number, calendarStart: number) => {
    if (!isUsingMock) {
      onMove(id, calendarDay, calendarStart);
      return;
    }
    setMockInterviews((items) => items.map((item) => item.id === id
      ? moveScheduleMockInterview(item, weekStart, calendarDay, calendarStart)
      : item));
  };
  return (
    <div className="interview-schedule-layout">
      <section className="interview-surface schedule-calendar-panel">
        <ScheduleToolbar
          calendarView={calendarView}
          anchor={anchor}
          weekStart={weekStart}
          onViewChange={onViewChange}
          onPeriodChange={onPeriodChange}
        />
        <p id="schedule-drag-instructions" className="visually-hidden">
          拖动面试可以调整排期，时间按 30 分钟对齐。日历背景只显示整点线。
        </p>
        {calendarView === "week" ? (
          <WeekCalendar
            weekStart={weekStart}
            interviews={visibleInterviews}
            draftInterview={visibleDraftInterview}
            selectedId={openInterviewId}
            onSelect={handleSelect}
            onMove={handleMove}
            onCreateAt={(calendarDay, calendarStart) => {
              const date = addDays(weekStart, calendarDay);
              date.setHours(Math.floor(calendarStart / 2), calendarStart % 2 ? 30 : 0, 0, 0);
              onCreateAt(formatDateTimeLocal(date));
            }}
          />
        ) : (
          <MonthCalendar
            anchor={anchor}
            monthGridStart={monthGridStart}
            interviews={visibleInterviews}
            selectedId={openInterviewId}
            onSelect={handleSelect}
          />
        )}
      </section>
      {dialogInterview && (
        <InterviewScheduleDialog
          interview={dialogInterview}
          detail={isUsingMock ? null : detail}
          detailLoading={!isUsingMock && detailLoading}
          isMock={isUsingMock}
          onClose={() => setOpenInterviewId(null)}
        />
      )}
    </div>
  );
}

function InterviewScheduleDialog({ interview, detail, detailLoading, isMock, onClose }: { interview: Interview; detail: InterviewSessionDetail | null; detailLoading: boolean; isMock: boolean; onClose: () => void }) {
  const matchingDetail = detail?.session.id === interview.id ? detail : null;
  const meetingUrl = matchingDetail?.session.meeting_url ?? (isMock ? "https://meeting.dingtalk.com/j/123456789" : null);
  const meetingLocation = matchingDetail?.session.location ?? null;
  const preparationNote = matchingDetail?.session.preparation_note ?? interview.note;
  const applicationHref = isMock
    ? careerViewPath("applications")
    : careerApplicationPath(interview.applicationId, interview.id);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="interview-schedule-dialog">
        <DialogHeader className="sr-only"><DialogTitle>面试详情</DialogTitle><DialogDescription>查看本场面试的时间、方式和准备备注。</DialogDescription></DialogHeader>
        <section className="schedule-dialog-card">
          <header>
            <div>
              <h3>{interview.stage}</h3>
              <p><span>{interview.company}</span><span aria-hidden="true"> · </span><span>{interview.role}</span></p>
            </div>
            <StatusBadge status={interview.status} />
          </header>
          {detailLoading && <p className="schedule-dialog-loading" role="status">正在加载完整面试详情…</p>}
          <dl className="schedule-dialog-details">
            <DetailRow icon={<Clock3 />} label="面试时间" value={`${interview.date}（${interview.weekday}） ${interview.time} – ${interview.endTime}`} />
            <DetailRow icon={<Video />} label="面试方式" value={matchingDetail ? `${modeLabel(matchingDetail.session.mode)}${matchingDetail.session.location ? ` · ${matchingDetail.session.location}` : ""}` : interview.mode} />
            {meetingUrl ? (
              <div><dt><Link2 />会议入口</dt><dd><a href={meetingUrl} target="_blank" rel="noreferrer">{meetingUrl}</a></dd></div>
            ) : (
              <DetailRow icon={<BriefcaseBusiness />} label="面试地点" value={meetingLocation ?? "暂未填写"} />
            )}
            <DetailRow icon={<NotebookTabs />} label="面试轮次" value={interview.stage} />
            <DetailRow icon={<Bell />} label="准备备注" value={preparationNote} />
          </dl>
        </section>
        <DialogFooter className="schedule-dialog-footer">
          <OverviewLink className="schedule-dialog-record-link" href={applicationHref}><BriefcaseBusiness />查看求职记录<ChevronRight /></OverviewLink>
          <Button onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordsView({
  applications,
  applicationIdsWithSessions,
  interviews,
  selected,
  detail,
  detailLoading,
  onSelect,
  onColorChange,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  applicationIdsWithSessions: string[];
  interviews: Interview[];
  selected: Interview | null;
  detail: InterviewSessionDetail | null;
  detailLoading: boolean;
  onSelect: (id: string) => void;
  onColorChange: (color: InterviewCalendarColor) => void;
  onChanged: (preferredId?: string | null) => void;
  onNotice: (notice: string) => void;
}) {
  const applicationIdsWithSessionRecords = new Set(applicationIdsWithSessions);
  const applicationsWithoutSessions = applications.filter(
    (item) => !applicationIdsWithSessionRecords.has(item.id),
  );
  if (!selected)
    return (
      <div className="records-empty-layout">
        <div className="records-empty-state">
          <NotebookTabs aria-hidden="true" />
          <h2>还没有面试记录</h2>
          <p>安排并完成面试后，可以在这里整理题目、复盘和相关素材。</p>
        </div>
        <ApplicationHistoryList
          applications={applicationsWithoutSessions}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      </div>
    );
  const matchingDetail = detail?.session.id === selected.id ? detail : null;
  return (
    <div className="interview-records-layout">
      <aside className="records-index-column">
        <section className="interview-surface records-list-card">
          <div className="records-list-heading">
            <h2>面试列表</h2>
            <div>
              <Search />
              <ListChecks />
            </div>
          </div>
          <div className="records-table-head">
            <span>公司</span>
            <span>职位</span>
            <span>阶段</span>
            <span>面试时间</span>
            <span>状态</span>
          </div>
          <div className="records-list">
            {interviews.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === selected.id ? "is-active" : ""}
                onClick={() => onSelect(item.id)}
              >
                <CompanyLogo item={item} />
                <span>{item.company}</span>
                <span>{item.role}</span>
                <span>{item.stage}</span>
                <span>
                  {item.date} {item.time}
                </span>
                <StatusBadge status={item.status} />
              </button>
            ))}
          </div>
        </section>
        <section className="interview-surface records-calendar-card">
          <MiniCalendar selected={new Date(selected.startAt)} />
          <div className="records-calendar-legend">
            <span><i className="orange" />待面试</span>
            <span><i className="blue" />进行中</span>
            <span><i className="green" />已完成</span>
          </div>
        </section>
        <ApplicationHistoryList
          applications={applicationsWithoutSessions}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      </aside>
      {matchingDetail ? (
        <RecordDetail
          selected={selected}
          detail={matchingDetail}
          onColorChange={onColorChange}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      ) : (
        <section className="interview-surface record-detail-panel record-detail-loading">
          {detailLoading
            ? <PageLoading label="正在加载所选面试…" scope="panel" />
            : "暂时无法读取所选面试详情。"}
        </section>
      )}
      {matchingDetail ? (
        <AssetSidebar
          key={matchingDetail.session.id}
          selected={selected}
          detail={matchingDetail}
          onChanged={() => onChanged(selected.id)}
          onNotice={onNotice}
        />
      ) : (
        <aside className="interview-surface record-assets-column record-detail-loading">
          {detailLoading
            ? <PageLoading label="正在加载面试素材…" scope="panel" />
            : "面试素材暂不可用。"}
        </aside>
      )}
    </div>
  );
}

function ApplicationHistoryList({
  applications,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  onChanged: (preferredId?: string | null) => void;
  onNotice: (notice: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JobApplicationSummary | null>(null);
  const [pendingReject, setPendingReject] = useState<JobApplicationSummary | null>(null);
  if (!applications.length) return null;
  const changeArchived = async (application: JobApplicationSummary) => {
    setBusyId(application.id);
    try {
      if (application.archived_at)
        await api.restoreJobApplication(application.id, application.lock_version);
      else await api.archiveJobApplication(application.id, application.lock_version);
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };
  const remove = async () => {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      await api.deleteJobApplication(pendingDelete.id);
      setPendingDelete(null);
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };
  const advanceScreening = async (application: JobApplicationSummary) => {
    setBusyId(application.id);
    try {
      await api.advanceJobApplication(application.id, {
        target_stage_type: "interview",
        target_round_no: 1,
        target_stage_label: "一面",
        base_lock_version: application.lock_version,
      });
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };
  const rejectScreening = async () => {
    if (!pendingReject) return;
    setBusyId(pendingReject.id);
    try {
      await api.closeJobApplication(pendingReject.id, {
        status: "rejected",
        base_lock_version: pendingReject.lock_version,
      });
      setPendingReject(null);
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section className="interview-surface application-history-card">
      <header><h2>未关联面试的求职进程</h2><span>{applications.length}</span></header>
      <p>可先归档不再跟进的进程；已归档且没有面试记录时可永久删除。</p>
      <div>
        {applications.map((application) => (
          <article key={application.id}>
            <span><strong>{application.company_name_snapshot}</strong><small>{application.job_title_snapshot} · {application.current_stage_label}</small></span>
            <button
              type="button"
              disabled={busyId !== null}
              aria-label={`${application.archived_at ? "恢复" : "归档"} ${application.company_name_snapshot}`}
              onClick={() => void changeArchived(application)}
            >
              {application.archived_at ? <RotateCcw /> : <Archive />}
            </button>
            {application.archived_at && (
              <button
                type="button"
                disabled={busyId !== null}
                aria-label={`删除 ${application.company_name_snapshot} 求职进程`}
                onClick={() => setPendingDelete(application)}
              ><Trash2 /></button>
            )}
            {application.archived_at === null &&
              application.status === "active" &&
              application.current_stage_type === "screening" &&
              application.stage_state === "awaiting_result" && (
                <div className="application-screening-actions">
                  <span>筛选结果</span>
                  <button type="button" disabled={busyId !== null} onClick={() => void advanceScreening(application)}>通过并进入一面</button>
                  <button type="button" disabled={busyId !== null} onClick={() => setPendingReject(application)}>未通过</button>
                </div>
              )}
          </article>
        ))}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          kind="delete"
          title={`永久删除「${pendingDelete.company_name_snapshot}」求职进程？`}
          description="该进程没有面试记录，删除后岗位快照和进度信息也无法恢复。"
          confirmLabel="永久删除"
          busyLabel="正在删除…"
          busy={busyId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={remove}
        />
      )}
      {pendingReject && (
        <ConfirmDialog
          kind="warning"
          title={`确认「${pendingReject.company_name_snapshot}」筛选未通过？`}
          description="该求职进程会退出活动流程，但历史岗位快照仍会保留，之后可以继续归档。"
          confirmLabel="确认未通过"
          busyLabel="正在处理…"
          busy={busyId === pendingReject.id}
          onCancel={() => setPendingReject(null)}
          onConfirm={rejectScreening}
        />
      )}
    </section>
  );
}

function RecordDetail({
  selected,
  detail,
  onColorChange,
  onChanged,
  onNotice,
}: {
  selected: Interview;
  detail: InterviewSessionDetail;
  onColorChange: (color: InterviewCalendarColor) => void;
  onChanged: (preferredId?: string | null) => void;
  onNotice: (notice: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [questions, setQuestions] = useState(detail.session.questions_markdown ?? "");
  const [review, setReview] = useState(detail.session.review_summary ?? "");
  const [improvement, setImprovement] = useState(
    detail.session.improvement_markdown ?? "",
  );
  const [nextStage, setNextStage] = useState("");
  const [pendingLifecycle, setPendingLifecycle] = useState<
    "cancel" | "archive" | "restore" | "delete-session" | null
  >(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const isArchived = detail.application.archived_at !== null;
  const stageOptions = useMemo(() => {
    const application = detail.application;
    const options: Array<{
      value: string;
      label: string;
      stageType: ApplicationStageType;
      roundNo: number | null;
      stageLabel: string;
    }> = [];
    if (application.current_stage_type === "screening") {
      options.push({
        value: "interview:1",
        label: "进入一面",
        stageType: "interview",
        roundNo: 1,
        stageLabel: "一面",
      });
    }
    if (application.current_stage_type === "interview") {
      const roundNo = (application.current_round_no ?? 0) + 1;
      options.push({
        value: `interview:${roundNo}`,
        label: `进入第 ${roundNo} 轮面试`,
        stageType: "interview",
        roundNo,
        stageLabel: `${roundNo} 面`,
      });
    }
    if (application.current_stage_type !== "hr") {
      options.push({
        value: "hr",
        label: "进入 HR 面",
        stageType: "hr",
        roundNo: null,
        stageLabel: "HR 面",
      });
    }
    options.push({
      value: "offer",
      label: "进入 Offer 沟通",
      stageType: "offer",
      roundNo: null,
      stageLabel: "Offer",
    });
    return options;
  }, [detail.application]);
  useEffect(() => {
    setQuestions(detail.session.questions_markdown ?? "");
    setReview(detail.session.review_summary ?? "");
    setImprovement(detail.session.improvement_markdown ?? "");
    setNextStage("");
    setEditing(false);
  }, [detail.session.id, detail.session.lock_version]);
  const save = async (complete: boolean) => {
    try {
      if (complete && detail.session.status === "scheduled") {
        await api.completeInterviewSession(detail.session.id, {
          questions_markdown: questions || null,
          review_summary: review || null,
          improvement_markdown: improvement || null,
          base_lock_version: detail.session.lock_version,
        });
      } else {
        await api.updateInterviewSession(detail.session.id, {
          questions_markdown: questions || null,
          review_summary: review || null,
          improvement_markdown: improvement || null,
          base_lock_version: detail.session.lock_version,
        });
      }
      setEditing(false);
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  const advance = async () => {
    const target = stageOptions.find((item) => item.value === nextStage);
    if (!target) return;
    try {
      await api.advanceJobApplication(detail.application.id, {
        target_stage_type: target.stageType,
        target_round_no: target.roundNo,
        target_stage_label: target.stageLabel,
        base_lock_version: detail.application.lock_version,
      });
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  const closeAsRejected = async () => {
    try {
      await api.closeJobApplication(detail.application.id, {
        status: "rejected",
        base_lock_version: detail.application.lock_version,
      });
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  const updateOffer = async (
    action: "oc_received" | "written_offer_received" | "accepted" | "declined",
  ) => {
    try {
      if (action === "accepted" || action === "declined") {
        await api.closeJobApplication(detail.application.id, {
          status: "closed",
          offer_status: action,
          base_lock_version: detail.application.lock_version,
        });
      } else {
        await api.recordJobApplicationOffer(
          detail.application.id,
          action,
          detail.application.lock_version,
        );
      }
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  const runLifecycle = async () => {
    if (!pendingLifecycle) return;
    setLifecycleBusy(true);
    try {
      if (pendingLifecycle === "cancel") {
        await api.cancelInterviewSession(detail.session.id, {
          base_lock_version: detail.session.lock_version,
        });
        setPendingLifecycle(null);
        onChanged(detail.session.id);
      } else if (pendingLifecycle === "archive") {
        await api.archiveJobApplication(
          detail.application.id,
          detail.application.lock_version,
        );
        setPendingLifecycle(null);
        onChanged(detail.session.id);
      } else if (pendingLifecycle === "restore") {
        await api.restoreJobApplication(
          detail.application.id,
          detail.application.lock_version,
        );
        setPendingLifecycle(null);
        onChanged(detail.session.id);
      } else {
        await api.deleteInterviewSession(detail.session.id);
        setPendingLifecycle(null);
        onChanged(null);
      }
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setLifecycleBusy(false);
    }
  };
  const lifecycleDialog = pendingLifecycle
    ? {
        kind: pendingLifecycle === "delete-session" ? "delete" as const : "warning" as const,
        title:
          pendingLifecycle === "cancel"
            ? "取消这场面试？"
            : pendingLifecycle === "archive"
              ? "归档这条求职进程？"
              : pendingLifecycle === "restore"
                ? "恢复这条求职进程？"
                : "永久删除这场面试记录？",
        description:
          pendingLifecycle === "cancel"
            ? "该场次会保留在记录复盘中，并从当前排期退出；求职进程回到待安排状态。"
            : pendingLifecycle === "archive"
              ? "归档后会从默认求职进程和排期中隐藏，历史面试与复盘仍会保留。"
              : pendingLifecycle === "restore"
                ? "恢复后，这条仍在进行的求职进程会重新进入默认求职进程列表。"
                : "删除后不可恢复。若存在关联素材，系统会拒绝删除并保留原记录。",
        confirmLabel:
          pendingLifecycle === "cancel"
            ? "确认取消"
            : pendingLifecycle === "archive"
              ? "确认归档"
              : pendingLifecycle === "restore"
                ? "确认恢复"
                : "永久删除",
      }
    : null;
  return (
    <section className="interview-surface record-detail-panel">
      <header className="record-detail-header">
        <CompanyLogo item={selected} />
        <div>
          <h2>{selected.company} · {selected.role}</h2>
          <p>
            <CalendarDays />面试时间：{selected.date} {selected.time}　
            <Video />面试形式：{selected.mode}　
            <UserRound />面试官：{selected.interviewer}
          </p>
        </div>
        <div className="record-detail-actions">
          <Button
            size="sm"
            variant="outline"
            icon={<Pencil />}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "取消" : "编辑"}
          </Button>
          {detail.session.status === "scheduled" && (
            <>
              {!isArchived && (
                <Button size="sm" variant="outline" icon={<Ban />} onClick={() => setPendingLifecycle("cancel")}>取消面试</Button>
              )}
              {!isArchived && <Button size="sm" onClick={() => void save(true)}>完成面试</Button>}
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            icon={isArchived ? <RotateCcw /> : <Archive />}
            onClick={() => setPendingLifecycle(isArchived ? "restore" : "archive")}
          >
            {isArchived ? "恢复进程" : "归档进程"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 />}
            onClick={() => setPendingLifecycle("delete-session")}
          >删除记录</Button>
        </div>
      </header>
      <StageProgress application={detail.application} />
      {!isArchived && detail.application.status === "active" &&
        detail.application.stage_state === "awaiting_result" && (
          <section className="record-stage-actions" aria-label="面试结果处理">
            <div>
              <strong>本轮面试已完成</strong>
              <span>确认结果后再进入下一阶段，流程卡片会随之移动。</span>
            </div>
            <select
              aria-label="选择下一阶段"
              value={nextStage}
              onChange={(event) => setNextStage(event.target.value)}
            >
              <option value="">选择下一阶段</option>
              {stageOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <Button size="sm" disabled={!nextStage} onClick={() => void advance()}>
              确认通过
            </Button>
            <Button size="sm" variant="outline" onClick={() => void closeAsRejected()}>
              未通过
            </Button>
          </section>
        )}
      {!isArchived && detail.application.status === "active" &&
        detail.application.current_stage_type === "offer" && (
          <section className="record-stage-actions" aria-label="Offer 结果处理">
            <div>
              <strong>Offer 进度</strong>
              <span>当前：{detail.application.offer_status}</span>
            </div>
            {detail.application.offer_status === "none" && (
              <Button size="sm" onClick={() => void updateOffer("oc_received")}>收到 OC</Button>
            )}
            {detail.application.offer_status !== "written_offer_received" && (
              <Button size="sm" variant="outline" onClick={() => void updateOffer("written_offer_received")}>
                收到书面 Offer
              </Button>
            )}
            {detail.application.offer_status === "written_offer_received" && (
              <>
                <Button size="sm" onClick={() => void updateOffer("accepted")}>接受 Offer</Button>
                <Button size="sm" variant="outline" onClick={() => void updateOffer("declined")}>婉拒 Offer</Button>
              </>
            )}
          </section>
        )}
      <section className="record-section">
        <h3><FileText />面试信息</h3>
        <dl>
          <div><dt>职位</dt><dd>{selected.role}</dd></div>
          <div><dt>当前状态</dt><dd><StatusBadge status={selected.status} /></dd></div>
          <div><dt>面试官</dt><dd>{selected.interviewer}</dd></div>
          <div><dt>面试地点</dt><dd>{detail.session.location ?? selected.mode}{detail.session.meeting_url && <ExternalLink />}</dd></div>
          <div className="record-color-setting">
            <dt>日历颜色</dt>
            <dd>
              <CalendarColorPicker
                company={selected.company}
                value={detail.application.calendar_color}
                onChange={onColorChange}
              />
            </dd>
          </div>
        </dl>
      </section>
      <EditableRecordSection
        title="题目记录"
        value={questions}
        editing={editing}
        placeholder="按原始顺序记录面试中遇到的问题，不需要先结构化分类。"
        onChange={setQuestions}
      />
      <EditableRecordSection
        title="复盘总结"
        value={review}
        editing={editing}
        placeholder="记录整体发挥、关键判断和待确认信息。"
        onChange={setReview}
      />
      <EditableRecordSection
        title="需要改进"
        value={improvement}
        editing={editing}
        placeholder="记录下一次要针对性改进的内容。"
        onChange={setImprovement}
      />
      {editing && <div className="record-save-row"><Button onClick={() => void save(false)}>保存复盘</Button></div>}
      {lifecycleDialog && (
        <ConfirmDialog
          kind={lifecycleDialog.kind}
          title={lifecycleDialog.title}
          description={lifecycleDialog.description}
          confirmLabel={lifecycleDialog.confirmLabel}
          busyLabel="正在处理…"
          busy={lifecycleBusy}
          onCancel={() => setPendingLifecycle(null)}
          onConfirm={runLifecycle}
        />
      )}
    </section>
  );
}

function EditableRecordSection({
  title,
  value,
  editing,
  placeholder,
  onChange,
}: {
  title: string;
  value: string;
  editing: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="record-section compact-record-section">
      <header><h3><CircleCheck />{title}</h3></header>
      {editing ? (
        <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <p>{value || "暂未填写"}</p>
      )}
    </section>
  );
}

function AssetSidebar({
  selected,
  detail,
  onChanged,
  onNotice,
}: {
  selected: Interview;
  detail: InterviewSessionDetail;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const [recording, setRecording] = useState(false);
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  const upload = async (file: File, source: "recorded" | "uploaded", duration?: number) => {
    try {
      await api.uploadInterviewAsset(detail.session.id, file, source, duration);
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  const toggleRecording = async () => {
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
      const preferredType =
        typeof MediaRecorder.isTypeSupported === "function"
          ? [
              "audio/webm;codecs=opus",
              "audio/webm",
              "audio/ogg;codecs=opus",
              "audio/ogg",
              "audio/mp4",
            ].find((candidate) => MediaRecorder.isTypeSupported(candidate))
          : undefined;
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Date.now() - startedAtRef.current;
        const type = recorder.mimeType || "audio/webm";
        const extension = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File(chunksRef.current, `interview-${Date.now()}.${extension}`, { type });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setRecording(false);
        void upload(file, "recorded", duration);
      };
      recorder.start(1_000);
      setRecording(true);
    } catch {
      onNotice("无法访问麦克风，请检查浏览器权限或改用文件上传。 ");
    }
  };
  const download = async (asset: InterviewAssetRecord) => {
    try {
      const blob = await api.downloadInterviewAsset(asset.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = asset.original_file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  const remove = async (asset: InterviewAssetRecord) => {
    try {
      await api.deleteInterviewAsset(asset.id);
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  return (
    <aside className="record-assets-column" aria-label={`${selected.company}面试素材`}>
      <section className="interview-surface asset-card">
        <header><h3>面试素材</h3><span>{detail.assets.length} 个文件</span></header>
        <div>
          {detail.assets.length ? detail.assets.map((asset) => (
            <article className="asset-file-row" key={asset.id}>
              <span><FileText /></span>
              <div><strong>{asset.original_file_name}</strong><small>{formatBytes(asset.file_size)} · {asset.source_type === "recorded" ? "现场录制" : "文件上传"}</small></div>
              <button type="button" aria-label={`下载 ${asset.original_file_name}`} onClick={() => void download(asset)}><Download /></button>
              <button type="button" aria-label={`删除 ${asset.original_file_name}`} onClick={() => void remove(asset)}><Trash2 /></button>
            </article>
          )) : <p className="asset-empty">还没有素材</p>}
        </div>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="audio/*,video/*,.pdf,.docx,.txt,.md"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file, "uploaded");
            event.target.value = "";
          }}
        />
        <Button variant="outline" icon={<Import />} onClick={() => fileInput.current?.click()}>上传文件</Button>
      </section>
      <section className="interview-surface live-record-card">
        <h3>现场录制</h3>
        <p>浏览器录音会直接关联到当前这场面试。</p>
        <button type="button" className={recording ? "is-recording" : ""} onClick={() => void toggleRecording()}>
          <Mic /><span>{recording ? "停止并上传" : "开始录音"}<small>{recording ? "正在采集麦克风音频" : "需要授予麦克风权限"}</small></span>
        </button>
      </section>
      <InterviewContextSidebar className="record-context-card" interview={selected} />
    </aside>
  );
}

function WeekCalendar({
  weekStart,
  interviews,
  draftInterview,
  selectedId,
  onSelect,
  onMove,
  onCreateAt,
}: {
  weekStart: Date;
  interviews: Interview[];
  draftInterview: Interview | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, calendarDay: number, calendarStart: number) => void;
  onCreateAt: (calendarDay: number, calendarStart: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    calendarDay: number;
    calendarStart: number;
  } | null>(null);
  const dragGrabOffset = useRef(0);
  const suppressClickRef = useRef(false);
  const dropHandledRef = useRef(false);
  const draggingInterview = interviews.find((item) => item.id === draggingId);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 9 * 60;
  }, []);
  const resolveDropTarget = (
    event: Pick<ReactDragEvent<HTMLDivElement>, "currentTarget" | "clientX" | "clientY">,
    span: number,
    grabOffset = dragGrabOffset.current,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const gridLeft = rect.left + 58;
    const gridWidth = Math.max(1, (rect.width || 1050) - 58);
    const gridHeight = rect.height || 1440;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : gridLeft;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : rect.top;
    const calendarDay = Math.min(
      6,
      Math.max(0, Math.floor((clientX - gridLeft) / (gridWidth / 7))),
    );
    const rawSlot =
      Math.floor((clientY - rect.top) / (gridHeight / SCHEDULE_SLOT_COUNT)) - grabOffset;
    return {
      calendarDay,
      calendarStart: Math.min(
        SCHEDULE_SLOT_COUNT - span,
        Math.max(0, rawSlot),
      ),
    };
  };
  const moveWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    item: Interview,
  ) => {
    const movement =
      event.key === "ArrowUp"
        ? { day: 0, slot: -1 }
        : event.key === "ArrowDown"
          ? { day: 0, slot: 1 }
          : event.key === "ArrowLeft"
            ? { day: -1, slot: 0 }
            : event.key === "ArrowRight"
              ? { day: 1, slot: 0 }
              : null;
    if (!movement) return;
    event.preventDefault();
    onMove(
      item.id,
      Math.min(6, Math.max(0, item.calendarDay + movement.day)),
      Math.min(
        SCHEDULE_SLOT_COUNT - item.calendarSpan,
        Math.max(0, item.calendarStart + movement.slot),
      ),
    );
  };
  const todayIso = isoDate(new Date());
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return { label: `${date.getMonth() + 1}/${date.getDate()} ${weekday(date)}`, isToday: isoDate(date) === todayIso };
  });
  const todayIndex = weekDays.findIndex((day) => day.isToday);
  return (
    <div className="week-calendar">
      <div className="week-calendar-head">
        <span>GMT+8</span>
        {weekDays.map((day) => <span className={day.isToday ? "is-today" : ""} key={day.label}>{day.label}</span>)}
      </div>
      <div ref={scrollRef} className="week-calendar-scroll">
        <div
          className={`week-calendar-body${draggingId ? " is-dragging" : ""}`}
          role="grid"
          aria-label="面试周排期，可拖动并按 30 分钟调整"
          onDragOver={(event) => {
            if (!draggingInterview) return;
            event.preventDefault();
            setDropTarget(resolveDropTarget(event, draggingInterview.calendarSpan));
          }}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest(".week-event")) return;
            const target = resolveDropTarget(event, 1, 0);
            onCreateAt(target.calendarDay, target.calendarStart);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/interview-id") || draggingId;
            const item = interviews.find((interview) => interview.id === id);
            if (id && item) {
              const target = resolveDropTarget(event, item.calendarSpan);
              suppressClickRef.current = true;
              dropHandledRef.current = true;
              onMove(id, target.calendarDay, target.calendarStart);
            }
            setDraggingId(null);
            setDropTarget(null);
          }}
        >
          <div className="week-hour-labels">
            {SCHEDULE_HOURS.map((hour) => <span key={hour}>{hour}</span>)}
          </div>
          {todayIndex >= 0 && <div className="week-today-column" style={{ gridColumn: todayIndex + 2 }} aria-hidden="true" />}
          <div className="week-grid-lines" />
          {dropTarget && draggingInterview && (
            <div
              className={`week-drop-preview calendar-${draggingInterview.color}`}
              style={{
                gridColumn: dropTarget.calendarDay + 2,
                gridRow: `${dropTarget.calendarStart + 1} / span ${draggingInterview.calendarSpan}`,
              }}
            >
              <span className="week-drop-tooltip">
                {`周${"一二三四五六日"[dropTarget.calendarDay]} ${formatScheduleTime(dropTarget.calendarStart)}`}
              </span>
              <span className="week-drop-range">
                {formatScheduleTime(dropTarget.calendarStart)} – {formatScheduleTime(dropTarget.calendarStart + draggingInterview.calendarSpan)}
              </span>
            </div>
          )}
          {draftInterview && draftInterview.calendarDay >= 0 && draftInterview.calendarDay < 7 && (
            <div
              className={`week-event is-draft calendar-${draftInterview.color}`}
              role="status"
              aria-label={`待创建的新面试排期：${draftInterview.date} ${draftInterview.time} – ${draftInterview.endTime}`}
              style={{
                gridColumn: draftInterview.calendarDay + 2,
                gridRow: `${draftInterview.calendarStart + 1} / span ${draftInterview.calendarSpan}`,
              }}
            >
              <span className="week-event-time"><i aria-hidden="true" />{draftInterview.time} – {draftInterview.endTime}</span>
              <span className="week-event-company"><strong>新面试排期</strong><em>待填写</em></span>
            </div>
          )}
          {interviews.filter((item) => item.calendarDay >= 0 && item.calendarDay < 7).map((item) => (
            <button
              type="button"
              key={item.id}
              draggable={item.status === "upcoming" || item.status === "active"}
              aria-describedby="schedule-drag-instructions"
              className={`week-event calendar-${item.color}${selectedId === item.id ? " is-selected" : ""}${draggingId === item.id ? " is-dragging" : ""}`}
              style={{
                gridColumn: item.calendarDay + 2,
                gridRow: `${item.calendarStart + 1} / span ${item.calendarSpan}`,
              }}
              onClick={(event) => {
                if (suppressClickRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  suppressClickRef.current = false;
                  return;
                }
                onSelect(item.id);
              }}
              onKeyDown={(event) => moveWithKeyboard(event, item)}
              onDragStart={(event) => {
                dropHandledRef.current = false;
                suppressClickRef.current = true;
                const rect = event.currentTarget.getBoundingClientRect();
                const offset = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
                dragGrabOffset.current = Math.min(item.calendarSpan - 1, Math.max(0, Math.floor(offset * item.calendarSpan)));
                event.dataTransfer.setData("text/interview-id", String(item.id));
                setDraggingId(item.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
                window.setTimeout(() => {
                  suppressClickRef.current = false;
                  dropHandledRef.current = false;
                }, 250);
              }}
            >
              <span className="week-event-time"><i aria-hidden="true" />{item.time} – {item.endTime}</span>
              <span className="week-event-company"><strong>{item.company}</strong><em>{item.stage}</em></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateApplicationDialog({
  initialJobId,
  onClose,
  onCreated,
  onNotice,
}: {
  initialJobId?: string;
  onClose: () => void;
  onCreated: (applicationId: string) => void;
  onNotice: (notice: string) => void;
}) {
  const [jobs, setJobs] = useState<JobDescriptionSummary[]>([]);
  const [jobId, setJobId] = useState("");
  const [appliedAt, setAppliedAt] = useState(() => isoDate(new Date()));
  const [notes, setNotes] = useState("");
  const resumes = useResumeStore((state) => state.resumes);
  const [resumeId, setResumeId] = useState("");
  const [versions, setVersions] = useState<Array<{ id: string; name: string; version_no: number }>>([]);
  const [resumeVersionId, setResumeVersionId] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.listJobDescriptions({ limit: 100 })
      .then((response) => {
        if (cancelled) return;
        setJobs(response.items);
        setJobId(
          initialJobId && response.items.some((item) => item.id === initialJobId)
            ? initialJobId
            : response.items[0]?.id ?? "",
        );
      })
      .catch((error) => {
        if (!cancelled) onNotice(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingJobs(false);
      });
    return () => { cancelled = true; };
  }, [initialJobId, onNotice]);

  useEffect(() => {
    let cancelled = false;
    if (!resumeId) {
      setVersions([]);
      setResumeVersionId("");
      return;
    }
    void api.listVersions(resumeId)
      .then(({ versions: nextVersions }) => {
        if (cancelled) return;
        setVersions(nextVersions);
        setResumeVersionId(nextVersions[0]?.id ?? "");
      })
      .catch((error) => {
        if (!cancelled) onNotice(errorMessage(error));
      });
    return () => { cancelled = true; };
  }, [onNotice, resumeId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!jobId) return;
    setSubmitting(true);
    try {
      const result = await api.createJobApplication({
        job_description_id: jobId,
        resume_version_id: resumeVersionId || null,
        current_stage_type: "screening",
        current_round_no: null,
        current_stage_label: "筛选中",
        stage_state: "awaiting_result",
        applied_at: appliedAt ? new Date(`${appliedAt}T12:00:00`).toISOString() : null,
        notes: notes.trim() || null,
      });
      onCreated(result.application.id);
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="interview-dialog-backdrop" role="presentation">
      <section className="interview-dialog career-application-dialog" role="dialog" aria-modal="true" aria-labelledby="create-application-title">
        <header>
          <div>
            <h2 id="create-application-title">新建求职进程</h2>
            <p>从岗位库选择目标岗位，后续面试和复盘都会关联到这条进程。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}><X /></button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          {loadingJobs ? (
            <PageLoading label="正在加载岗位库…" scope="panel" />
          ) : jobs.length ? (
            <>
              <label>
                目标岗位
                <select required value={jobId} onChange={(event) => setJobId(event.target.value)}>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.company_name} · {job.job_title}</option>
                  ))}
                </select>
              </label>
              <div className="interview-dialog-grid">
                <label>
                  投递日期
                  <input type="date" value={appliedAt} onChange={(event) => setAppliedAt(event.target.value)} />
                </label>
                <label>
                  初始阶段
                  <input value="筛选中" disabled />
                </label>
                <label>
                  使用的简历
                  <select value={resumeId} onChange={(event) => setResumeId(event.target.value)}>
                    <option value="">暂不关联简历版本</option>
                    {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title}</option>)}
                  </select>
                </label>
                <label>
                  简历版本
                  <select disabled={!resumeId || versions.length === 0} value={resumeVersionId} onChange={(event) => setResumeVersionId(event.target.value)}>
                    <option value="">{resumeId ? "选择版本" : "请先选择简历"}</option>
                    {versions.map((version) => <option key={version.id} value={version.id}>v{version.version_no} · {version.name}</option>)}
                  </select>
                </label>
                <label className="is-wide">
                  备注
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录内推人、投递渠道或下一步提醒（可选）" />
                </label>
              </div>
            </>
          ) : (
            <div className="career-dialog-empty">
              <BriefcaseBusiness />
              <strong>岗位库中还没有可用岗位</strong>
              <span>请先创建岗位，再返回这里开始求职进程。</span>
              <Button type="button" variant="outline" onClick={() => navigateTo("/career/jobs/new")}>前往新建岗位</Button>
            </div>
          )}
          <footer>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={loadingJobs || !jobId || submitting}>{submitting ? "正在创建…" : "创建求职进程"}</Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CreateInterviewDialog({
  applications,
  initialApplicationId,
  initialStartAt,
  timezone,
  onClose,
  onCreated,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  initialApplicationId?: string | null;
  initialStartAt?: string | null;
  timezone: string;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
  onNotice: (notice: string) => void;
}) {
  const [jobs, setJobs] = useState<JobDescriptionSummary[]>([]);
  const [applicationId, setApplicationId] = useState<string | "new">(
    initialApplicationId && applications.some((item) => item.id === initialApplicationId)
      ? initialApplicationId
      : applications[0]?.id ?? "new",
  );
  const [jobId, setJobId] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [stage, setStage] = useState("一面");
  const [roundNo, setRoundNo] = useState(1);
  const [startAt, setStartAt] = useState(() => {
    if (initialStartAt) return initialStartAt;
    const date = new Date(Date.now() + 86_400_000);
    date.setMinutes(date.getMinutes() < 30 ? 30 : 0, 0, 0);
    if (date.getMinutes() === 0) date.setHours(date.getHours() + 1);
    return `${isoDate(date)}T${formatTime(date)}`;
  });
  const [duration, setDuration] = useState(60);
  const [mode, setMode] = useState<"video" | "onsite" | "phone" | "other">("video");
  const [submitting, setSubmitting] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [createdApplication, setCreatedApplication] = useState<JobApplicationSummary | null>(null);
  const [pendingCreateConflict, setPendingCreateConflict] = useState<{
    application: JobApplicationSummary;
    payload: InterviewSessionCreatePayload;
  } | null>(null);
  const requestIdRef = useRef(crypto.randomUUID());
  useEffect(() => {
    void api.listJobDescriptions({ limit: 100 }).then((response) => setJobs(response.items)).catch(() => undefined);
  }, []);
  const createSession = async (
    targetApplication: JobApplicationSummary,
    payload: InterviewSessionCreatePayload,
    allowConflict: boolean,
  ) => {
    try {
      const response = await api.createInterviewSession(targetApplication.id, {
        ...payload,
        allow_conflict: allowConflict,
      });
      setPendingCreateConflict(null);
      onCreated(response.session.id);
      return true;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.message === "INTERVIEW_TIME_CONFLICT" &&
        !allowConflict
      ) {
        setPendingCreateConflict({ application: targetApplication, payload });
        return false;
      }
      throw error;
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      let targetApplication =
        createdApplication ?? applications.find((item) => item.id === applicationId);
      if (!targetApplication) {
        let targetJobId = createdJobId ?? jobId;
        if (!targetJobId) {
          const createdJob = await api.createJobDescription({
            company_name: company,
            job_title: role,
            description: jobDescription || `${company} ${role}`,
            source_type: "manual",
          });
          targetJobId = createdJob.job_description.id;
          setCreatedJobId(targetJobId);
        }
        const createdApplication = await api.createJobApplication({
          job_description_id: targetJobId,
          current_stage_type: "interview",
          current_round_no: roundNo,
          current_stage_label: stage,
          stage_state: "awaiting_schedule",
        });
        targetApplication = { ...createdApplication.application, next_session_id: null, next_session_start_at: null, next_session_end_at: null, next_session_mode: null };
        setCreatedApplication(targetApplication);
      }
      const start = new Date(startAt);
      const end = new Date(start.getTime() + duration * 60_000);
      const payload: InterviewSessionCreatePayload = {
        client_request_id: requestIdRef.current,
        stage_type:
          targetApplication.current_stage_type === "screening"
            ? "other"
            : targetApplication.current_stage_type,
        round_no:
          targetApplication.current_stage_type === "interview"
            ? targetApplication.current_round_no
            : null,
        stage_label: targetApplication.current_stage_label,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        timezone,
        mode,
      };
      await createSession(targetApplication, payload, false);
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };
  const creationLocked = createdJobId !== null || createdApplication !== null;
  return (
    <div className="interview-dialog-backdrop" role="presentation">
      <section className="interview-dialog" role="dialog" aria-modal="true" aria-labelledby="create-interview-title">
        <header><div><h2 id="create-interview-title">新建面试</h2><p>岗位信息、求职进程和本场排期在这里一次完成。</p></div><button type="button" aria-label="关闭" onClick={onClose}><X /></button></header>
        <form onSubmit={(event) => void submit(event)}>
          {applications.length > 0 && <label>求职进程<select disabled={creationLocked || submitting} value={applicationId} onChange={(event) => setApplicationId(event.target.value)}><option value="new">新建求职进程</option>{applications.map((item) => <option key={item.id} value={item.id}>{item.company_name_snapshot} · {item.job_title_snapshot} · {item.current_stage_label}</option>)}</select></label>}
          {applicationId === "new" && <>
            <label>已有岗位档案<select disabled={creationLocked || submitting} value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">在求职中心直接填写岗位</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.company_name} · {job.job_title}</option>)}</select></label>
            {!jobId && <div className="interview-dialog-grid"><label>公司<input disabled={creationLocked} required value={company} onChange={(event) => setCompany(event.target.value)} /></label><label>岗位<input disabled={creationLocked} required value={role} onChange={(event) => setRole(event.target.value)} /></label><label className="is-wide">岗位信息<textarea disabled={creationLocked} value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="可粘贴 JD，后续会作为本次求职的岗位快照" /></label></div>}
            <div className="interview-dialog-grid"><label>阶段<input disabled={creationLocked} required value={stage} onChange={(event) => setStage(event.target.value)} /></label><label>轮次<input disabled={creationLocked} type="number" min={1} value={roundNo} onChange={(event) => setRoundNo(Number(event.target.value))} /></label></div>
          </>}
          {creationLocked && <p className="interview-create-progress" role="status">岗位或求职进程已创建；再次提交只会重试当前面试排期，不会重复创建前置数据。</p>}
          <div className="interview-dialog-grid"><label>开始时间<input required type="datetime-local" step={1800} value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label><label>时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={90}>1.5 小时</option><option value={120}>2 小时</option></select></label><label>面试方式<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="video">视频面试</option><option value="onsite">现场面试</option><option value="phone">电话面试</option><option value="other">其他</option></select></label></div>
          {pendingCreateConflict && (
            <div className="interview-create-conflict" role="alert">
              <div><strong>这个时间段与其他面试重叠</strong><span>前置的岗位和求职进程已经保留。你可以返回修改时间，或明确允许重叠保存本场排期。</span></div>
              <button type="button" disabled={submitting} onClick={() => setPendingCreateConflict(null)}>返回修改</button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setSubmitting(true);
                  void createSession(
                    pendingCreateConflict.application,
                    pendingCreateConflict.payload,
                    true,
                  ).catch((error) => onNotice(errorMessage(error))).finally(() => setSubmitting(false));
                }}
              >{submitting ? "正在保存…" : "仍然保存"}</button>
            </div>
          )}
          <footer><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={submitting || pendingCreateConflict !== null}>{submitting ? "正在创建…" : "创建面试"}</Button></footer>
        </form>
      </section>
    </div>
  );
}

function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <header className="interview-section-heading"><h2>{title}</h2>{action && <button type="button" onClick={onAction}>{action}<ChevronRight /></button>}</header>;
}

function CompanyLogo({ item }: { item: { company: string; logo: string; color: InterviewCalendarColor } }) {
  return <span className={`company-logo calendar-${item.color}`} aria-hidden="true">{item.logo}</span>;
}

function MiniCalendar({ selected }: { selected: Date }) {
  const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  return <div className="mini-calendar"><header><strong>{selected.getFullYear()}年{selected.getMonth() + 1}月</strong><span><ChevronLeft /><ChevronRight /></span></header><div className="mini-calendar-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div className="mini-calendar-days">{days.map((day) => <button type="button" key={isoDate(day)} className={`${day.getMonth() !== selected.getMonth() ? "is-muted " : ""}${isoDate(day) === isoDate(selected) ? "is-selected" : ""}`}>{day.getDate()}</button>)}</div></div>;
}

function formatScheduleTime(slot: number): string {
  const totalMinutes = slot * 30;
  const hour = Math.floor(totalMinutes / 60);
  if (hour >= 24) return "24:00";
  return `${String(hour).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function CalendarColorPicker({ company, value, onChange }: { company: string; value: InterviewCalendarColor; onChange: (color: InterviewCalendarColor) => void }) {
  const currentLabel = CALENDAR_COLORS.find((color) => color.id === value)?.label ?? "灰色";
  return <div className="calendar-color-picker" role="group" aria-label={`${company}日历颜色，当前${currentLabel}`}><span>{currentLabel}</span>{CALENDAR_COLORS.map((color) => <button key={color.id} type="button" className={`calendar-color-swatch calendar-${color.id}`} aria-label={`将${company}的日历颜色设为${color.label}`} aria-pressed={color.id === value} title={color.label} onClick={() => onChange(color.id)} />)}</div>;
}

function InterviewContextSidebar({ className, interview }: { className: string; interview: Interview }) {
  return <aside className={`${className} interview-context-sidebar`} aria-label={`${interview.company}面试上下文`}><section className="interview-surface context-primary-card"><header className="context-company-header"><span className={`context-company-mark calendar-${interview.color}`}>{interview.logo}</span><strong>{interview.company}</strong><StatusBadge status={interview.status} /></header><h2>{interview.stage}（面试）</h2><p className="context-role">{interview.role}</p><dl className="context-detail-list"><DetailRow icon={<Clock3 />} label="时间" value={`${interview.date}（${interview.weekday}） ${interview.time} – ${interview.endTime}`} /><DetailRow icon={<Link2 />} label="面试方式" value={interview.mode} /><DetailRow icon={<UserRound />} label="面试官" value={interview.interviewer} /><DetailRow icon={<CircleCheck />} label="状态" value={interview.status === "completed" ? "已完成面试" : interview.status === "cancelled" ? "已取消" : "待面试"} /><DetailRow icon={<Bell />} label="备注" value={interview.note} /></dl></section><button type="button" className="interview-surface context-job-archive-card" onClick={() => navigateTo("/career/jobs")}><span>查看对应岗位档案</span><div><FolderOpen /><p><strong>{interview.company} · {interview.role}</strong><small>岗位档案与本次快照</small></p><ChevronRight /></div></button></aside>;
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div><dt>{icon}{label}</dt><dd>{value}</dd></div>;
}

function StatusBadge({ status }: { status: InterviewStatus }) {
  const label = status === "completed" ? "已完成面试" : status === "active" ? "进行中" : status === "cancelled" ? "已取消" : "待面试";
  return <span className={`interview-status-badge status-${status}`}>{label}</span>;
}

function StageProgress({ application }: { application: InterviewSessionDetail["application"] }) {
  const highestRound = Math.max(
    2,
    application.current_stage_type === "interview"
      ? application.current_round_no ?? 1
      : 2,
  );
  const stages = [
    { key: "screening", label: "筛选中" },
    ...Array.from({ length: highestRound }, (_, index) => ({
      key: `interview:${index + 1}`,
      label: interviewRoundLabel(index + 1),
    })),
    { key: "hr", label: "HR 面" },
    { key: "offer", label: "Offer" },
  ];
  const currentKey =
    application.current_stage_type === "interview"
      ? `interview:${application.current_round_no ?? 1}`
      : application.current_stage_type;
  const currentIndex = Math.max(0, stages.findIndex((stage) => stage.key === currentKey));
  return <div className="stage-progress" style={{ "--stage-count": stages.length } as CSSProperties} aria-label={`当前阶段：${application.current_stage_label}`}><div className="stage-progress-line" />{stages.map((stage, index) => <div key={stage.key} className={index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : ""}><span>{index < currentIndex ? <Check /> : null}</span><strong>{stage.label}</strong></div>)}</div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function interviewViewPath(view: InterviewView): string {
  return careerViewPath(view);
}
