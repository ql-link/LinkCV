import {
  Fragment,
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
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
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
  Link2,
  List,
  ListChecks,
  Kanban,
  NotebookTabs,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ExpandableSearch, PageLoading } from "@/components/ui";
import { SelectField } from "@/components/ui/select-field";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
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
  type JobEmploymentType,
} from "@/api/client";
import { careerApplicationPath, careerViewPath, navigateTo, type InterviewView } from "../../routing";
import { JobSmartImportDialog } from "../jobs/JobSmartImportDialog";
import { PluginInstallDialog } from "../jobs/PluginInstallDialog";
import {
  ApplicationsBoard,
  formatApplicationListDateTime,
  formatApplicationUpdatedAt,
  interviewRoundLabel,
  sortApplications,
  type ApplicationSortMode,
  type NextStagePrefill,
} from "./ApplicationsBoard";
import {
  applicationStageMatchesSession,
  applicationProgressLabel,
  applicationProgressToneClass,
  applicationStatusLabel,
  offerStatusLabel,
  projectApplicationProgress,
  type ApplicationProgressLabelOptions,
} from "./applicationProgress";
import {
  AddNextStageDialog,
  ApplicationDetailView,
  InterviewSessionDetailView,
  MarkApplicationAppliedDialog,
  TerminateApplicationConfirmDialog,
} from "./CareerDetailViews";
import "./interviews.css";

type InterviewStatus = "upcoming" | "active" | "completed" | "cancelled";
type ScheduleGranularity = "week" | "month";
type ScheduleCreatedInfo = {
  company: string;
  stage: string;
  startAt: string;
};
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
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addMonths(source: Date, months: number): Date {
  const result = new Date(source);
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setHours(0, 0, 0, 0);
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

function formatMonth(source: Date): string {
  return `${source.getFullYear()}年${source.getMonth() + 1}月`;
}

function formatScheduleWeekRange(source: Date): string {
  const end = addDays(source, 6);
  return `${source.getFullYear()}年${formatDate(source)} – ${formatDate(end)}`;
}

function localDateTimeValue(source: Date): string {
  return `${isoDate(source)}T${formatTime(source)}`;
}

function defaultInterviewStartAt(): string {
  const date = new Date(Date.now() + 86_400_000);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (date.getMinutes() === 0) date.setHours(date.getHours() + 1);
  return localDateTimeValue(date);
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
    color:
      session.stage_type === "interview"
      && session.round_no === 3
      && session.calendar_color === "gray"
        ? "purple"
        : session.calendar_color,
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
    startAt?: string;
    endAt?: string;
    applicationId?: string;
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

function currentApplicationStageCompleted(
  application: JobApplicationSummary,
  sessions: InterviewSessionSummary[],
): boolean {
  const currentSession = sessions
    .filter((session) => (
      session.application_id === application.id
      && session.status !== "cancelled"
      && applicationStageMatchesSession(application, session)
    ))
    .reduce<InterviewSessionSummary | null>((latest, session) => (
      !latest || new Date(session.start_at).getTime() > new Date(latest.start_at).getTime()
        ? session
        : latest
    ), null);
  return currentSession?.status === "completed";
}

function canAddScheduledStage(application: JobApplicationSummary): boolean {
  return application.status === "active"
    && application.archived_at === null
    && application.applied_at !== null
    && application.stage_state === "awaiting_result"
    && application.current_stage_type !== "offer";
}

export function InterviewCenterPage({
  view,
  initialApplicationId,
  initialSessionId,
  initialJobId,
  initialCreateApplication,
  initialJobImport,
  navigation,
}: {
  view: InterviewView;
  initialApplicationId?: string;
  initialSessionId?: string;
  initialJobId?: string;
  initialCreateApplication?: boolean;
  initialJobImport?: boolean;
  navigation?: ReactNode;
}) {
  const weekStart = useMemo(() => startOfWeek(), []);
  const [scheduleGranularity, setScheduleGranularity] = useState<ScheduleGranularity>("week");
  const [scheduleAnchor, setScheduleAnchor] = useState(() => startOfWeek());
  const scheduleWeekStart = useMemo(() => startOfWeek(scheduleAnchor), [scheduleAnchor]);
  const scheduleMonthStart = useMemo(() => startOfMonth(scheduleAnchor), [scheduleAnchor]);
  const scheduleGridStart = useMemo(() => startOfWeek(scheduleMonthStart), [scheduleMonthStart]);
  const scheduleRange = useMemo(() => {
    if (scheduleGranularity === "month") {
      return {
        startAt: scheduleGridStart.toISOString(),
        endAt: addDays(scheduleGridStart, 42).toISOString(),
      };
    }
    return {
      startAt: scheduleWeekStart.toISOString(),
      endAt: addDays(scheduleWeekStart, 7).toISOString(),
    };
  }, [scheduleGranularity, scheduleGridStart, scheduleWeekStart]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  const [sessions, setSessions] = useState<InterviewSessionSummary[]>([]);
  const [applications, setApplications] = useState<JobApplicationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
  const [detail, setDetail] = useState<InterviewSessionDetail | null>(null);
  const [query, setQuery] = useState("");
  const [applicationDisplayMode, setApplicationDisplayMode] = useState<"board" | "list">("board");
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [applicationSortMode, setApplicationSortMode] = useState<ApplicationSortMode>("recent_schedule");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateApplication, setShowCreateApplication] = useState(false);
  const [jobImportOpen, setJobImportOpen] = useState(false);
  const [showPluginInstall, setShowPluginInstall] = useState(false);
  const [createInterviewApplicationId, setCreateInterviewApplicationId] = useState<string | null>(null);
  const [createInterviewStartAt, setCreateInterviewStartAt] = useState<string | null>(null);
  const [scheduleToast, setScheduleToast] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    id: string;
    startAt: string;
    endAt: string;
  } | null>(null);
  const selectedIdRef = useRef<string | null>(initialSessionId ?? null);
  const loadRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const scheduleToastTimeoutRef = useRef<number | null>(null);
  const isApplicationDetailRoute = view === "applications" && Boolean(initialApplicationId);
  const isApplicationSessionDialogRoute = isApplicationDetailRoute && Boolean(initialSessionId);
  const closeApplicationSessionDialog = () => {
    const historyState = window.history.state as { careerSessionDialog?: boolean } | null;
    if (historyState?.careerSessionDialog) {
      window.history.back();
      return;
    }
    navigateTo(careerApplicationPath(initialApplicationId as string), { replace: true });
  };
  const isInterviewDetailRoute = view === "records" && Boolean(initialApplicationId && initialSessionId);
  const isStandaloneDetailRoute = isApplicationDetailRoute || isInterviewDetailRoute;

  const pushScheduleToast = useCallback((message: string) => {
    setScheduleToast(message);
    if (scheduleToastTimeoutRef.current !== null) {
      window.clearTimeout(scheduleToastTimeoutRef.current);
    }
    scheduleToastTimeoutRef.current = window.setTimeout(() => {
      setScheduleToast(null);
      scheduleToastTimeoutRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => () => {
    if (scheduleToastTimeoutRef.current !== null) {
      window.clearTimeout(scheduleToastTimeoutRef.current);
    }
  }, []);

  const openCreateInterview = (startAt?: string) => {
    setCreateInterviewStartAt(startAt ?? null);
    setShowCreate(true);
  };

  const openJobImport = () => {
    setShowCreateApplication(false);
    setJobImportOpen(true);
  };

  const closeJobImport = () => {
    setJobImportOpen(false);
  };

  useEffect(() => {
    if (initialCreateApplication) setShowCreateApplication(true);
  }, [initialCreateApplication]);

  useEffect(() => {
    if (initialJobImport) {
      setShowCreateApplication(false);
      setJobImportOpen(true);
    }
  }, [initialJobImport]);

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
      const applicationDetail = view === "applications" && Boolean(initialApplicationId);
      const interviewDetail = view === "records" && Boolean(initialApplicationId && initialSessionId);
      const includeArchivedSessions = view === "records" || view === "applications";
      const applicationScope = view === "records" || view === "applications" ? "all" : "active";
      const sessionRange = applicationDetail || interviewDetail || includeArchivedSessions
        ? {}
        : view === "schedule"
          ? scheduleRange
          : {
              startAt: weekStart.toISOString(),
              endAt: addDays(weekStart, 7).toISOString(),
            };
      const [nextSessions, nextApplications] = await Promise.all([
        listAllInterviewSessions({
          includeArchived: includeArchivedSessions,
          applicationId: applicationDetail || interviewDetail ? initialApplicationId : undefined,
          ...sessionRange,
        }),
        listAllJobApplications(applicationScope),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setSessions(nextSessions);
      setApplications(nextApplications);
      setHasLoadedData(true);
      if (applicationDetail) {
        selectedIdRef.current = initialSessionId ?? null;
        setSelectedId(initialSessionId ?? null);
        if (initialSessionId) {
          await loadDetail(initialSessionId);
        } else {
          ++detailRequestRef.current;
          setDetail(null);
          setDetailLoading(false);
        }
        return;
      }
      const requestedId = preferredId === null ? null : preferredId ?? selectedIdRef.current;
      const nextSelected =
        requestedId !== null && (nextSessions.some((item) => item.id === requestedId) || interviewDetail)
          ? requestedId
          : nextSessions[0]?.id ?? null;
      selectedIdRef.current = nextSelected;
      setSelectedId(nextSelected);
      if (nextSelected) await loadDetail(nextSelected);
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
  }, [initialApplicationId, initialSessionId, loadDetail, scheduleRange, timezone, view, weekStart]);

  useEffect(() => {
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
    () => sessions.map((session) => toInterview(session, view === "schedule" ? scheduleWeekStart : weekStart)),
    [scheduleWeekStart, sessions, view, weekStart],
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
    durationSlots?: number,
  ) => {
    const current = interviews.find((item) => item.id === id);
    if (!current) return;
    const start = addDays(scheduleWeekStart, calendarDay);
    start.setHours(0, calendarStart * 30, 0, 0);
    const end = new Date(start.getTime() + (durationSlots === undefined ? new Date(current.endAt).getTime() - new Date(current.startAt).getTime() : durationSlots * 1_800_000));
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
      setNotice(null);
      await loadData(response.session.id);
      const updatedStart = new Date(response.session.start_at);
      const updatedEnd = new Date(response.session.end_at);
      pushScheduleToast(`已自动更新：${current.company} · ${weekday(updatedStart)} ${formatTime(updatedStart)}–${formatTime(updatedEnd)}`);
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

  return (
    <>
      {!isStandaloneDetailRoute && (
        <WorkspacePageHero
          className={`career-module-header${view === "applications" ? " career-applications-header" : ""}`}
          icon={<BriefcaseBusiness />}
          tone="warning"
          title="求职中心"
          description={view === "applications" ? "导入岗位，跟踪每一轮求职进展。" : "集中管理岗位机会、求职进程、面试排期与面试记录。"}
          actions={(
            <>
              {view === "applications" ? (
                <ApplicationHeaderControls
                  query={query}
                  onQueryChange={setQuery}
                  onInstallPlugin={() => setShowPluginInstall(true)}
                  onImport={openJobImport}
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
                  <Button icon={<Plus />} onClick={() => setShowCreate(true)}>新建面试</Button>
                </>
              )}
            </>
          )}
        />
      )}
      {!isStandaloneDetailRoute && (view === "applications" || view === "schedule") ? (
        <div className="career-view-navigation-row">
          {navigation}
          {view === "applications" ? (
            <ApplicationViewControls
              displayMode={applicationDisplayMode}
              sortMode={applicationSortMode}
              groupByCategory={groupByCategory}
              onGroupingChange={setGroupByCategory}
              onDisplayModeChange={setApplicationDisplayMode}
              onSortChange={setApplicationSortMode}
            />
          ) : (
            <ScheduleViewControls
              granularity={scheduleGranularity}
              onGranularityChange={(value) => {
                setScheduleGranularity(value);
                setScheduleAnchor(value === "month" ? scheduleMonthStart : scheduleWeekStart);
              }}
              onNavigate={(direction) => {
                setScheduleAnchor((current) => scheduleGranularity === "month"
                  ? addMonths(current, direction === "next" ? 1 : -1)
                  : addDays(current, direction === "next" ? 7 : -7));
              }}
              onToday={() => setScheduleAnchor(scheduleGranularity === "month" ? startOfMonth() : startOfWeek())}
            />
          )}
        </div>
      ) : (
        !isStandaloneDetailRoute && navigation
      )}
      <main className={`dashboard-content interview-center-content${isStandaloneDetailRoute ? " career-standalone-detail-content" : ""}${!isStandaloneDetailRoute && view === "applications" && applicationDisplayMode === "board" ? " career-applications-board-content" : ""}`}>
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
                    scheduleWeekStart.getTime()) /
                    86_400_000,
                );
                void reschedule(
                  pendingConflict.id,
                  day,
                  start.getHours() * 2 + start.getMinutes() / 30,
                  true,
                  (new Date(pendingConflict.endAt).getTime() - start.getTime()) / 1_800_000,
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
      {scheduleToast && <div className="schedule-success-toast" role="status" aria-live="polite"><CircleCheck />{scheduleToast}</div>}
      {loading && !hasLoadedData ? (
        <PageLoading label="正在加载求职数据…" />
      ) : isApplicationDetailRoute ? (
        <>
          <ApplicationDetailView
            application={applications.find((item) => item.id === initialApplicationId) ?? null}
            sessions={sessions}
            timezone={timezone}
            onBack={() => navigateTo(careerViewPath("applications"))}
            onCreateInterview={(applicationId) => {
              setCreateInterviewApplicationId(applicationId);
              setShowCreate(true);
            }}
            onChanged={() => loadData(initialSessionId)}
            onNotice={setNotice}
          />
          {isApplicationSessionDialogRoute && (
            <InterviewSessionDetailView
              displayMode="dialog"
              detail={detail?.session.id === initialSessionId ? detail : null}
              detailLoading={detailLoading}
              onBack={closeApplicationSessionDialog}
              onChanged={(preferredId) => {
                if (preferredId === null) {
                  closeApplicationSessionDialog();
                  return;
                }
                void loadData(initialSessionId ?? preferredId);
              }}
              onNotice={setNotice}
            />
          )}
        </>
      ) : isInterviewDetailRoute ? (
        <InterviewSessionDetailView
          detail={detail?.session.id === initialSessionId ? detail : null}
          detailLoading={detailLoading}
          onBack={() => navigateTo(careerApplicationPath(initialApplicationId as string))}
          onChanged={(preferredId) => loadData(preferredId)}
          onNotice={setNotice}
        />
      ) : view === "applications" ? (
        <ApplicationsView
          applications={applications}
          sessions={sessions}
          query={query}
          displayMode={applicationDisplayMode}
          sortMode={applicationSortMode}
          groupByCategory={groupByCategory}
          timezone={timezone}
          onCreate={() => setShowCreateApplication(true)}
          onChanged={() => loadData(initialSessionId)}
          onNotice={setNotice}
        />
      ) : view === "schedule" ? (
        <ScheduleView
          interviews={interviews}
          detail={detail}
          detailLoading={detailLoading}
          query={query}
          granularity={scheduleGranularity}
          weekStart={scheduleWeekStart}
          monthStart={scheduleMonthStart}
          monthGridStart={scheduleGridStart}
          draftStartAt={showCreate ? createInterviewStartAt : null}
          onCreate={openCreateInterview}
          onSelect={(id) => void selectInterview(id)}
          onMove={(id, day, slot, span) => void reschedule(id, day, slot, false, span)}
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
      {showCreate && (isApplicationDetailRoute || Boolean(createInterviewApplicationId) ? (
        <CreateInterviewDialog
          applications={applications.filter(
            (item) =>
              item.status === "active" &&
              item.archived_at === null &&
              item.stage_state === "awaiting_schedule" &&
              item.current_stage_type !== "offer",
          )}
          initialApplicationId={createInterviewApplicationId}
          detailMode
          timezone={timezone}
          onClose={() => {
            setShowCreate(false);
            setCreateInterviewApplicationId(null);
            setCreateInterviewStartAt(null);
          }}
          initialStartAt={createInterviewStartAt}
          onCreated={(id, info) => {
            setShowCreate(false);
            setCreateInterviewApplicationId(null);
            setCreateInterviewStartAt(null);
            if (info) {
              const start = new Date(info.startAt);
              pushScheduleToast(`已创建：${info.company} · ${info.stage} · ${weekday(start)} ${formatTime(start)}`);
            }
            void loadData(id);
          }}
          onNotice={setNotice}
        />
      ) : (
        <ScheduleStageDialog
          applications={applications.filter(canAddScheduledStage)}
          timezone={timezone}
          initialStartAt={createInterviewStartAt ?? ""}
          onClose={() => {
            setShowCreate(false);
            setCreateInterviewStartAt(null);
          }}
          onChanged={() => loadData()}
          onNotice={setNotice}
        />
      ))}
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
      {view === "applications" && jobImportOpen && (
        <JobSmartImportDialog
          unified
          onClose={closeJobImport}
        />
      )}
      {view === "applications" && showPluginInstall && (
        <PluginInstallDialog onClose={() => setShowPluginInstall(false)} />
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
  onQueryChange,
  onInstallPlugin,
  onImport,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onInstallPlugin: () => void;
  onImport: () => void;
}) {
  return (
    <div className="career-applications-controls">
      <ExpandableSearch
        label="搜索求职进程"
        name="career-application-search"
        value={query}
        onValueChange={onQueryChange}
        placeholder="搜索公司、岗位…"
      />
      <Button variant="ghost" icon={<Download size={15} />} onClick={onInstallPlugin}>安装采集插件</Button>
      <Button icon={<Plus />} onClick={onImport}>导入岗位</Button>
    </div>
  );
}

function ApplicationViewControls({
  displayMode,
  sortMode,
  groupByCategory,
  onDisplayModeChange,
  onSortChange,
  onGroupingChange,
}: {
  displayMode: "board" | "list";
  sortMode: ApplicationSortMode;
  groupByCategory: boolean;
  onDisplayModeChange: (value: "board" | "list") => void;
  onSortChange: (value: ApplicationSortMode) => void;
  onGroupingChange: (value: boolean) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Select options render in a portal outside the settings panel.
      if (!target.closest("[data-slot=select-content]") && !ref.current?.contains(target)) {
        ref.current?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <div className="career-applications-view-controls" role="group" aria-label="求职记录显示设置">
    <details className="career-view-settings" ref={ref} onKeyDown={(event) => {
      if (event.key === "Escape") {
        ref.current?.removeAttribute("open");
        ref.current?.querySelector("summary")?.focus();
      }
    }}>
      <summary aria-label="视图设置" title="视图设置"><SlidersHorizontal size={16} aria-hidden="true" /></summary>
      <div className="career-view-settings-panel">
        <div className="career-view-mode-options" data-view={displayMode} role="group" aria-label="显示方式">
          <button type="button" aria-pressed={displayMode === "board"} onClick={() => onDisplayModeChange("board")}>
            <Kanban size={16} aria-hidden="true" />阶段看板
          </button>
          <button type="button" aria-pressed={displayMode === "list"} onClick={() => onDisplayModeChange("list")}>
            <List size={16} aria-hidden="true" />列表
          </button>
        </div>
        <div className="career-view-settings-fields">
          <div className="career-view-settings-row"><span>分组</span>
            <SelectField label="分类分组" value={groupByCategory ? "category" : "none"}
              options={[{ value: "none", label: "不分组" }, { value: "category", label: "求职分类" }]}
              onChange={(event) => onGroupingChange(event.target.value === "category")} />
          </div>
          <div className="career-view-settings-row"><span>排序</span>
            <SelectField label="排序方式" value={sortMode}
              options={[{ value: "recent_schedule", label: "最近排期" }, { value: "earliest_added", label: "最先添加" }]}
              onChange={(event) => onSortChange(event.target.value as ApplicationSortMode)} />
          </div>
        </div>
      </div>
    </details>
  </div>;
}

function ScheduleHeaderControls({ query, onCreate, onQueryChange }: { query: string; onCreate: () => void; onQueryChange: (value: string) => void }) {
  return (
    <div className="schedule-page-actions">
      <ExpandableSearch label="搜索面试排期" name="schedule-search" value={query} onValueChange={onQueryChange} placeholder="搜索公司、职位或轮次…" />
      <Button icon={<Plus />} onClick={onCreate}>安排面试</Button>
    </div>
  );
}

function ScheduleStageDialog({
  applications,
  timezone,
  initialStartAt,
  onClose,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  timezone: string;
  initialStartAt: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const firstApplication = applications[0];
  if (!firstApplication) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="career-stage-dialog career-next-stage-dialog career-schedule-empty-dialog">
          <DialogHeader>
            <DialogTitle>新建面试</DialogTitle>
            <DialogDescription>只能为已经完成上一阶段的求职流程添加笔试、测评或面试排期。</DialogDescription>
          </DialogHeader>
          <div className="career-dialog-empty">
            <BriefcaseBusiness aria-hidden="true" />
            <strong>暂无可以推进的求职流程</strong>
            <span>待投递、上一阶段尚未完成或已经进入 Offer 的流程不会出现在这里。</span>
          </div>
          <DialogFooter><Button onClick={onClose}>我知道了</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <AddNextStageDialog
      application={firstApplication}
      applicationOptions={applications}
      timezone={timezone}
      initialStartAt={initialStartAt}
      includeOffer={false}
      title="新建面试"
      description="选择已经完成上一阶段的求职流程，再填写下一阶段及排期信息。"
      onClose={onClose}
      onChanged={onChanged}
      onNotice={onNotice}
    />
  );
}

function ScheduleViewControls({
  granularity,
  onGranularityChange,
  onNavigate,
  onToday,
}: {
  granularity: ScheduleGranularity;
  onGranularityChange: (value: ScheduleGranularity) => void;
  onNavigate: (direction: "previous" | "next") => void;
  onToday: () => void;
}) {
  return (
    <div className="schedule-view-controls">
      <div className="schedule-period-navigation" role="group" aria-label="排期日期选择">
        <button type="button" onClick={() => onNavigate("previous")} aria-label="上一周期" title="上一周期"><ChevronLeft /></button>
        <button type="button" className="schedule-today-button" onClick={onToday}>今天</button>
        <button type="button" onClick={() => onNavigate("next")} aria-label="下一周期" title="下一周期"><ChevronRight /></button>
      </div>
      <div className="schedule-granularity-switch" data-view={granularity} role="group" aria-label="排期视图">
        <button type="button" aria-pressed={granularity === "week"} onClick={() => onGranularityChange("week")}>周</button>
        <button type="button" aria-pressed={granularity === "month"} onClick={() => onGranularityChange("month")}>月</button>
      </div>
    </div>
  );
}

function ApplicationsView({
  applications,
  groupByCategory,
  sessions,
  query,
  displayMode,
  sortMode,
  timezone,
  onCreate,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  groupByCategory: boolean;
  sessions: InterviewSessionSummary[];
  query: string;
  displayMode: "board" | "list";
  sortMode: ApplicationSortMode;
  timezone: string;
  onCreate: () => void;
  onChanged: () => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const [categoryApplication, setCategoryApplication] = useState<JobApplicationSummary | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [draggedNextStage, setDraggedNextStage] = useState<{
    application: JobApplicationSummary;
    prefill: NextStagePrefill;
    targetColumnId: string | null;
  } | null>(null);
  const [draggedPendingApplication, setDraggedPendingApplication] = useState<{
    application: JobApplicationSummary;
    targetColumnId: string | null;
  } | null>(null);
  const [pendingTermination, setPendingTermination] = useState<JobApplicationSummary | null>(null);
  const [dragRejectionNotice, setDragRejectionNotice] = useState<{ id: number; message: string } | null>(null);
  const dragRejectionNoticeIdRef = useRef(0);
  const dragRejectionNoticeTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  }, []);
  useEffect(() => () => {
    if (dragRejectionNoticeTimerRef.current !== null) {
      window.clearTimeout(dragRejectionNoticeTimerRef.current);
    }
  }, []);
  const showDragRejectionNotice = useCallback((message: string) => {
    if (dragRejectionNoticeTimerRef.current !== null) {
      window.clearTimeout(dragRejectionNoticeTimerRef.current);
    }
    dragRejectionNoticeIdRef.current += 1;
    setDragRejectionNotice({ id: dragRejectionNoticeIdRef.current, message });
    dragRejectionNoticeTimerRef.current = window.setTimeout(() => {
      setDragRejectionNotice(null);
      dragRejectionNoticeTimerRef.current = null;
    }, 3600);
  }, []);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleApplications = sortApplications(
    applications.filter((item) => !normalizedQuery
      || `${item.company_name_snapshot}${item.job_title_snapshot}${applicationProgressLabel(item, { now })}${applicationStatusLabel(item)}`
        .toLowerCase()
        .includes(normalizedQuery)),
    sortMode,
  );
  const categories = [["internship", "实习"], ["campus", "校招"], ["full_time", "正式"], ["", "未分类"]] as const;
  const categoryKey = (item: JobApplicationSummary) => categories.some(([key]) => key === item.job_snapshot?.employment_type) ? String(item.job_snapshot?.employment_type ?? "") : "";
  const listGroups = groupByCategory
    ? categories.map(([key, label]) => ({ key, label, items: visibleApplications.filter((item) => categoryKey(item) === key) })).filter((group) => group.items.length)
    : [{ key: "all", label: "", items: visibleApplications }];
  const completedCurrentStageApplicationIds = new Set(
    visibleApplications
      .filter((application) => currentApplicationStageCompleted(application, sessions))
      .map((application) => application.id),
  );
  return (
    <div className="career-applications-layout">
      <AnimatePresence>
        {dragRejectionNotice && (
          <motion.div
            key={dragRejectionNotice.id}
            className="application-drag-rejection-notice"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <CircleAlert aria-hidden="true" />
            <span>{dragRejectionNotice.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {categoryApplication && <ApplicationCategoryDialog application={categoryApplication} onClose={() => setCategoryApplication(null)} onChanged={onChanged} />}
      <ApplicationsBoard
        groupByCategory={groupByCategory}
        onRequestCategory={setCategoryApplication}
        visibleApplications={visibleApplications}
        completedCurrentStageApplicationIds={completedCurrentStageApplicationIds}
        now={now}
        sortMode={sortMode}
        displayMode={displayMode}
        formDropPreview={draggedNextStage?.targetColumnId
          ? {
            applicationId: draggedNextStage.application.id,
            targetColumnId: draggedNextStage.targetColumnId,
          }
          : draggedPendingApplication?.targetColumnId
            ? {
              applicationId: draggedPendingApplication.application.id,
              targetColumnId: draggedPendingApplication.targetColumnId,
            }
            : null}
        onNotice={showDragRejectionNotice}
        onRequestMarkApplied={(application, targetColumnId) => {
          setDraggedPendingApplication({ application, targetColumnId: targetColumnId ?? null });
        }}
        onRequestNextStage={(application, prefill, targetColumnId) => {
          setDraggedNextStage({ application, prefill, targetColumnId: targetColumnId ?? null });
        }}
        onRequestTerminate={setPendingTermination}
      />
      {draggedPendingApplication && (
        <MarkApplicationAppliedDialog
          application={draggedPendingApplication.application}
          onClose={() => setDraggedPendingApplication(null)}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}
      {draggedNextStage && (
        <AddNextStageDialog
          application={draggedNextStage.application}
          timezone={timezone}
          initialTab={draggedNextStage.prefill.initialTab}
          initialInterviewLabel={draggedNextStage.prefill.initialInterviewLabel}
          onClose={() => setDraggedNextStage(null)}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}
      {pendingTermination && (
        <TerminateApplicationConfirmDialog
          application={pendingTermination}
          onClose={() => setPendingTermination(null)}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}
      {displayMode === "list" && visibleApplications.length ? (
        <section className="interview-surface career-application-table-surface">
          <table className="career-application-table" aria-label="求职记录列表">
            <thead>
              <tr>
                <th scope="col">公司 / 岗位</th>
                {!groupByCategory && <th scope="col">求职分类</th>}
                <th scope="col">当前进度</th>
                <th scope="col">最近安排</th>
                <th scope="col">投递日期</th>
                <th scope="col">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {listGroups.map((group) => <Fragment key={group.key}>
                {groupByCategory && <tr className="career-application-group-row"><th scope="rowgroup" colSpan={groupByCategory ? 5 : 6}>{group.label} · {group.items.length}</th></tr>}
                {group.items.map((item) => {
                const nextInterview = item.status === "active" && !item.archived_at ? sessions
                  .filter((session) => session.application_id === item.id && session.status === "scheduled" && new Date(session.end_at).getTime() > now.getTime())
                  .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0] : undefined;
                const currentStageCompleted = completedCurrentStageApplicationIds.has(item.id);
                const progressLabel = applicationProgressLabel(item, { now, currentStageCompleted });
                const detailHref = careerApplicationPath(item.id);
                return (
                  <tr
                    key={item.id}
                    className="career-application-table-row"
                    tabIndex={0}
                    aria-label={`查看 ${item.company_name_snapshot} · ${item.job_title_snapshot} 的求职记录详情`}
                    onClick={(event) => {
                      const target = event.target;
                      if (target instanceof Element && target.closest("a, button, input, select, textarea")) return;
                      navigateTo(detailHref);
                    }}
                    onKeyDown={(event) => {
                      const target = event.target;
                      if (target instanceof Element && target.closest("a, button, input, select, textarea")) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      navigateTo(detailHref);
                    }}
                  >
                    <td><div className="career-application-identity"><span className="career-application-cell-text" title={item.company_name_snapshot}>{item.company_name_snapshot}</span><span className="career-application-cell-text career-application-job-title" title={item.job_title_snapshot}>{item.job_title_snapshot}</span></div></td>
                    {!groupByCategory && <td><span className="career-application-category-tag">{categories.find(([key]) => key === categoryKey(item))?.[1]}</span></td>}
                    <td>
                      <span className={`career-application-progress ${applicationProgressToneClass(item, { now, currentStageCompleted })}`} aria-label={progressLabel}>
                        {progressLabel}
                      </span>
                    </td>
                    <td><span className="career-application-cell-text">{nextInterview ? `${formatApplicationListDateTime(nextInterview.start_at)} · ${nextInterview.stage_label}` : "暂无安排"}</span></td>
                    <td>{item.applied_at ? <time dateTime={item.applied_at}>{formatApplicationUpdatedAt(item.applied_at)}</time> : "未投递"}</td>
                    <td><time className="career-application-updated-at" dateTime={item.updated_at}>{formatApplicationUpdatedAt(item.updated_at)}</time></td>
                  </tr>
                );
              })}</Fragment>)}
            </tbody>
          </table>
        </section>
      ) : !visibleApplications.length ? (
        <section className="interview-surface career-applications-board">
          <div className="career-applications-empty">
            <BriefcaseBusiness />
            <h2>{normalizedQuery ? "没有匹配的求职进程" : "还没有求职进程"}</h2>
            <p>{normalizedQuery ? "换个公司、职位或阶段关键词试试。" : "先从岗位库选择目标岗位，再开始记录投递进度。"}</p>
            {!normalizedQuery && <Button onClick={onCreate}>创建第一条求职进程</Button>}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ScheduleView({
  interviews,
  detail,
  detailLoading,
  query,
  granularity,
  weekStart,
  monthStart,
  monthGridStart,
  draftStartAt,
  onCreate,
  onSelect,
  onMove,
}: {
  interviews: Interview[];
  detail: InterviewSessionDetail | null;
  detailLoading: boolean;
  query: string;
  granularity: ScheduleGranularity;
  weekStart: Date;
  monthStart: Date;
  monthGridStart: Date;
  draftStartAt: string | null;
  onCreate: (startAt?: string) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, calendarDay: number, calendarStart: number, calendarSpan?: number) => void;
}) {
  const [openInterviewId, setOpenInterviewId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const sourceInterviews = interviews;
  const visibleInterviews = sourceInterviews.filter((item) => !normalizedQuery || `${item.company}${item.role}${item.stage}`.toLowerCase().includes(normalizedQuery));
  const dialogInterview = openInterviewId
    ? sourceInterviews.find((item) => item.id === openInterviewId) ?? null
    : null;
  const handleSelect = (id: string) => {
    const interview = sourceInterviews.find((item) => item.id === id);
    if (interview && (interview.status === "completed" || interview.status === "cancelled" || new Date(interview.endAt).getTime() <= Date.now())) {
      navigateTo(careerApplicationPath(interview.applicationId, id));
      return;
    }
    setOpenInterviewId(id);
    onSelect(id);
  };
  const handleMove = (id: string, calendarDay: number, calendarStart: number, calendarSpan?: number) => {
    onMove(id, calendarDay, calendarStart, calendarSpan);
  };
  return (
    <div className="interview-schedule-layout">
      <section className="interview-surface schedule-calendar-panel">
        <p id="schedule-drag-instructions" className="visually-hidden">
          按住卡片可在当天移动排期，拖动上边缘调整开始时间，下边缘调整结束时间，以 30 分钟为步长调整。
        </p>
        {granularity === "week" ? (
          <WeekCalendar
            weekStart={weekStart}
            interviews={visibleInterviews}
            selectedId={openInterviewId}
            draftStartAt={draftStartAt}
            onSelect={handleSelect}
            onMove={handleMove}
            onCreate={onCreate}
          />
        ) : (
          <MonthCalendar
            monthStart={monthStart}
            gridStart={monthGridStart}
            interviews={visibleInterviews}
            selectedId={openInterviewId}
            draftStartAt={draftStartAt}
            onSelect={handleSelect}
            onCreate={onCreate}
          />
        )}
      </section>
      {dialogInterview && (
        <InterviewScheduleDialog
          interview={dialogInterview}
          detail={detail}
          detailLoading={detailLoading}
          onClose={() => setOpenInterviewId(null)}
        />
      )}
    </div>
  );
}

function InterviewScheduleDialog({ interview, detail, detailLoading, onClose }: { interview: Interview; detail: InterviewSessionDetail | null; detailLoading: boolean; onClose: () => void }) {
  const matchingDetail = detail?.session.id === interview.id ? detail : null;
  const meetingUrl = matchingDetail?.session.meeting_url ?? null;
  const applicationHref = matchingDetail
    ? careerApplicationPath(matchingDetail.application.id, interview.id)
    : careerViewPath("applications");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="interview-schedule-dialog">
        <DialogHeader><DialogTitle>面试详情</DialogTitle><DialogDescription className="sr-only">查看本场面试的时间、方式和关联投递。</DialogDescription></DialogHeader>
        <section className="schedule-dialog-card">
          <header><h3>{interview.company}</h3><div><span className={`schedule-stage-badge calendar-${interview.color}`}>{interview.stage}</span><StatusBadge status={interview.status} /></div></header>
          {detailLoading && <p className="schedule-dialog-loading" role="status">正在加载完整面试详情…</p>}
          <dl className="schedule-dialog-details">
            <DetailRow icon={<BriefcaseBusiness />} label="职位" value={interview.role} />
            <DetailRow icon={<Clock3 />} label="日期与时间" value={`${interview.date}（${interview.weekday}） ${interview.time} – ${interview.endTime}`} />
            <DetailRow icon={<UserRound />} label="面试官" value={interview.interviewer} />
            <DetailRow icon={<Video />} label="面试形式" value={matchingDetail ? `${modeLabel(matchingDetail.session.mode)}${matchingDetail.session.location ? ` · ${matchingDetail.session.location}` : ""}` : interview.mode} />
            {meetingUrl && <div><dt><Link2 />会议链接</dt><dd><a href={meetingUrl} target="_blank" rel="noreferrer">{meetingUrl}</a></dd></div>}
          </dl>
          <OverviewLink className="schedule-dialog-application" href={applicationHref}><BriefcaseBusiness /><span>相关投递</span><strong>{interview.company} / {interview.role}</strong><ChevronRight /></OverviewLink>
        </section>
        <DialogFooter className="schedule-dialog-footer">
          <Button variant="outline" onClick={onClose}>关闭</Button>
          {meetingUrl ? (
            <a className="schedule-dialog-join" href={meetingUrl} target="_blank" rel="noreferrer">进入会议</a>
          ) : (
            <OverviewLink className="schedule-dialog-join" href={applicationHref}>查看求职进程</OverviewLink>
          )}
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
          <p>安排面试后，可以在这里上传音频或填写文字记录。</p>
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
            <span><strong>{application.company_name_snapshot}</strong><small>{application.job_title_snapshot} · {projectApplicationProgress(application).stageLabel}</small></span>
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
  const recordKind = detail.session.stage_type === "other" ? "笔试" : "面试";
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
      label: "进入 Offer 阶段",
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
  const recordOfferReceived = async () => {
    try {
      await api.recordJobApplicationOffer(
        detail.application.id,
        { base_lock_version: detail.application.lock_version },
      );
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
            ? `取消这场${recordKind}安排？`
            : pendingLifecycle === "archive"
              ? "归档这条求职进程？"
              : pendingLifecycle === "restore"
                ? "恢复这条求职进程？"
                : "永久删除这场面试记录？",
        description:
          pendingLifecycle === "cancel"
            ? "该场次会保留在面试记录中，并从当前排期退出；求职进程回到待安排状态。"
            : pendingLifecycle === "archive"
              ? "归档后会从默认求职进程和排期中隐藏，历史面试记录仍会保留。"
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
            {editing ? "取消" : "填写文字记录"}
          </Button>
          {detail.session.status === "scheduled" && (
            <>
              {!isArchived && (
                <Button size="sm" variant="outline" icon={<Ban />} onClick={() => setPendingLifecycle("cancel")}>取消{recordKind}安排</Button>
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
              <span>当前：{offerStatusLabel(detail.application.offer_status)}</span>
            </div>
            {detail.application.offer_status === "none" && (
              <Button size="sm" onClick={() => void recordOfferReceived()}>确认收到 Offer</Button>
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
        title="文字记录"
        value={questions}
        editing={editing}
        placeholder="粘贴面试过程、逐字稿或整理后的文字记录…"
        onChange={setQuestions}
      />
      {editing && <div className="record-save-row"><Button onClick={() => void save(false)}>保存文字记录</Button></div>}
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
  const upload = async (file: File) => {
    try {
      await api.uploadInterviewAsset(detail.session.id, file, "uploaded");
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
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
          aria-label="面试音频文件"
          accept="audio/*,.aac,.aiff,.amr,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.webm,.wma"
          onChange={(event) => {
            const file = event.target.files?.[0];
            const extension = file?.name.slice(file.name.lastIndexOf(".")).toLowerCase();
            const audioExtensions = new Set([".aac", ".aiff", ".amr", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".webm", ".wma"]);
            if (file && (file.type.toLowerCase().startsWith("audio/") || audioExtensions.has(extension ?? ""))) void upload(file);
            else if (file) onNotice("仅支持音频文件，请选择音频格式。");
            event.target.value = "";
          }}
        />
        <Button variant="outline" icon={<Import />} onClick={() => fileInput.current?.click()}>上传音频</Button>
      </section>
      <InterviewContextSidebar className="record-context-card" interview={selected} />
    </aside>
  );
}

function WeekCalendar({
  weekStart,
  interviews,
  selectedId,
  draftStartAt,
  onSelect,
  onMove,
  onCreate,
}: {
  weekStart: Date;
  interviews: Interview[];
  selectedId: string | null;
  draftStartAt: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, calendarDay: number, calendarStart: number, calendarSpan?: number) => void;
  onCreate: (startAt?: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: string; pointerId: number; day: number; y: number; scrollTop: number; mode: "move" | "start" | "end"; start: number; span: number; moved: boolean } | null>(null);
  const [pointerPreview, setPointerPreview] = useState<{ id: string; start: number; span: number; offset: number; heightDelta: number } | null>(null);
  const suppressClick = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const pointerTimes = (clientY: number, snap = true) => {
    const current = gesture.current!;
    const rawDelta = (clientY - current.y + (scrollRef.current?.scrollTop ?? 0) - current.scrollTop) / 30;
    const delta = snap ? Math.round(rawDelta) : rawDelta;
    const end = current.start + current.span;
    if (current.mode === "start") {
      const start = Math.max(0, Math.min(end - 1, current.start + delta));
      return { start, span: end - start };
    }
    if (current.mode === "end") return { start: current.start, span: Math.max(1, Math.min(SCHEDULE_SLOT_COUNT - current.start, current.span + delta)) };
    return { start: Math.max(0, Math.min(SCHEDULE_SLOT_COUNT - current.span, current.start + delta)), span: current.span };
  };

  useEffect(() => {
    const cancel = () => {
      if (!gesture.current) return;
      suppressClick.current = true;
      gesture.current = null;
      setPointerPreview(null);
    };
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (Math.abs(event.clientY - current.y) > 4) current.moved = true;
      if (!current.moved) return;
      event.preventDefault();
      suppressClick.current = true;
      const visual = pointerTimes(event.clientY, false);
      setPointerPreview({ id: current.id, ...pointerTimes(event.clientY), offset: Math.round((visual.start - current.start) * 30000) / 1000, heightDelta: Math.round((visual.span - current.span) * 30000) / 1000 });
    };
    const finish = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const times = pointerTimes(event.clientY);
      gesture.current = null;
      setPointerPreview(null);
      if (current.moved && (times.start !== current.start || times.span !== current.span)) onMoveRef.current(current.id, current.day, times.start, times.span);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const draftStart = draftStartAt ? new Date(draftStartAt) : null;
  const validDraftStart = draftStart && Number.isFinite(draftStart.getTime()) ? draftStart : null;
  const draftDayStart = validDraftStart ? new Date(validDraftStart) : null;
  draftDayStart?.setHours(0, 0, 0, 0);
  const draftCalendarDay = draftDayStart
    ? Math.round((draftDayStart.getTime() - weekStart.getTime()) / 86_400_000)
    : -1;
  const draftCalendarStart = validDraftStart
    ? validDraftStart.getHours() * 2 + Math.floor(validDraftStart.getMinutes() / 30)
    : -1;
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 9 * 60;
  }, []);
  const moveWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    item: Interview,
  ) => {
    if (item.status !== "upcoming" && item.status !== "active") return;
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
  const createAtPointer = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const gridLeft = rect.left + 58;
    const gridWidth = Math.max(1, rect.width - 58);
    const day = Math.min(6, Math.max(0, Math.floor((event.clientX - gridLeft) / (gridWidth / 7))));
    const slot = Math.min(SCHEDULE_SLOT_COUNT - 1, Math.max(0, Math.floor((event.clientY - rect.top) / (rect.height / SCHEDULE_SLOT_COUNT))));
    const start = addDays(weekStart, day);
    start.setHours(Math.floor(slot / 2), slot % 2 ? 30 : 0, 0, 0);
    onCreate(`${isoDate(start)}T${formatTime(start)}`);
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
          className="week-calendar-body"
          role="grid"
          aria-label="面试周排期，可拖动并按 30 分钟调整"
          onDoubleClick={createAtPointer}

        >
          <div className="week-hour-labels">
            {SCHEDULE_HOURS.map((hour) => <span key={hour}>{hour}</span>)}
          </div>
          {todayIndex >= 0 && <div className="week-today-column" style={{ gridColumn: todayIndex + 2 }} aria-hidden="true" />}
          <div className="week-grid-lines" />
          {validDraftStart && draftCalendarDay >= 0 && draftCalendarDay < 7 && (
            <div
              className="week-event week-event-draft calendar-gray"
              aria-hidden="true"
              style={{
                gridColumn: draftCalendarDay + 2,
                gridRow: `${draftCalendarStart + 1} / span 2`,
              }}
            >
              <strong className="week-event-company">待创建面试</strong>
              <span className="week-event-time"><i aria-hidden="true" />{formatScheduleTime(draftCalendarStart)} – {formatScheduleTime(draftCalendarStart + 2)}</span>
              <em className="week-event-stage">未保存</em>
            </div>
          )}
          {interviews.filter((item) => item.calendarDay >= 0 && item.calendarDay < 7).map((item) => (
            <button
              type="button"
              key={item.id}
              draggable={false}
              data-reschedulable={item.status === "upcoming" || item.status === "active"}
              title={item.status === "completed" ? "已完成的安排不能调整时间，点击查看详情" : item.status === "cancelled" ? "已取消的安排不能调整时间，点击查看详情" : "拖动调整时间；上下边缘调整开始或结束时间"}
              aria-describedby="schedule-drag-instructions"
              className={`week-event calendar-${item.color}${selectedId === item.id ? " is-selected" : ""}`}
              style={{
                gridColumn: item.calendarDay + 2,
                gridRow: `${item.calendarStart + 1} / span ${item.calendarSpan}`,
                transform: pointerPreview?.id === item.id ? `translateY(${pointerPreview.offset}px)` : undefined,
                height: pointerPreview?.id === item.id ? `calc(100% - 8px + ${pointerPreview.heightDelta}px)` : undefined,
                zIndex: pointerPreview?.id === item.id ? 4 : undefined,
                willChange: pointerPreview?.id === item.id ? "transform, height" : undefined,
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || (item.status !== "upcoming" && item.status !== "active")) return;
                event.preventDefault();
                suppressClick.current = false;
                const edge = event.target instanceof Element
                  ? event.target.closest(".week-event-resize-edge")
                  : null;
                const mode = edge?.classList.contains("is-start") ? "start" : edge?.classList.contains("is-end") ? "end" : "move";
                gesture.current = { id: item.id, pointerId: event.pointerId, day: item.calendarDay, y: event.clientY, scrollTop: scrollRef.current?.scrollTop ?? 0, mode, start: new Date(item.startAt).getHours() * 2 + new Date(item.startAt).getMinutes() / 30, span: (new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 1_800_000, moved: false };

              }}
              onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(item.id); }}
              onKeyDown={(event) => moveWithKeyboard(event, item)}

            >
              {(item.status === "upcoming" || item.status === "active") && <><span className="week-event-resize-edge is-start" aria-hidden="true" /><span className="week-event-resize-edge is-end" aria-hidden="true" /></>}
              <span className="week-event-content">
              <strong className="week-event-company">{item.company}</strong>
              <span className="week-event-time"><i aria-hidden="true" />{pointerPreview?.id === item.id ? `${formatScheduleTime(pointerPreview.start)} – ${formatScheduleTime(pointerPreview.start + pointerPreview.span)}` : `${item.time} – ${item.endTime}`}</span>
              <em className="week-event-stage">{item.stage}</em>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthCalendar({ monthStart, gridStart, interviews, selectedId, draftStartAt, onSelect, onCreate }: {
  monthStart: Date;
  gridStart: Date;
  interviews: Interview[];
  selectedId: string | null;
  draftStartAt: string | null;
  onSelect: (id: string) => void;
  onCreate: (startAt?: string) => void;
}) {
  const monthFallbackColors: InterviewCalendarColor[] = ["red", "orange", "green", "blue", "purple"];
  const eventColor = (item: Interview): InterviewCalendarColor => {
    if (item.color !== "gray") return item.color;
    const hash = Array.from(item.id).reduce((total, character) => total + character.charCodeAt(0), 0);
    return monthFallbackColors[hash % monthFallbackColors.length];
  };
  const today = isoDate(new Date());
  const draftStart = draftStartAt ? new Date(draftStartAt) : null;
  const validDraftStart = draftStart && Number.isFinite(draftStart.getTime()) ? draftStart : null;
  const draftDateKey = validDraftStart ? isoDate(validDraftStart) : null;
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  return (
    <div className="month-calendar" role="grid" aria-label={`${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月面试排期`}>
      <div className="month-calendar-weekdays"><span>周一</span><span>周二</span><span>周三</span><span>周四</span><span>周五</span><span>周六</span><span>周日</span></div>
      <div className="month-calendar-grid">
        {days.map((day) => {
          const dateKey = isoDate(day);
          const dayInterviews = interviews.filter((item) => isoDate(new Date(item.startAt)) === dateKey);
          const hasDraft = dateKey === draftDateKey;
          const visibleInterviewLimit = hasDraft ? 1 : 2;
          return (
            <div
              key={dateKey}
              role="gridcell"
              className={`${day.getMonth() !== monthStart.getMonth() ? "is-outside " : ""}${dateKey === today ? "is-today" : ""}`}
              onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) return;
                const start = new Date(day);
                start.setHours(9, 0, 0, 0);
                onCreate(`${isoDate(start)}T09:00`);
              }}
            >
              <span className="month-calendar-date">{day.getDate()}</span>
              <div className="month-calendar-events">
                {hasDraft && validDraftStart && (
                  <div className="month-event-draft calendar-gray" aria-hidden="true">
                    <time>{formatTime(validDraftStart)}</time><strong>待创建面试</strong><em className="visually-hidden">未保存</em>
                  </div>
                )}
                {dayInterviews.slice(0, visibleInterviewLimit).map((item) => (
                  <button key={item.id} type="button" className={`calendar-${eventColor(item)}${selectedId === item.id ? " is-selected" : ""}`} onClick={() => onSelect(item.id)}>
                    <time>{item.time}</time><strong>{item.company}</strong><em className="visually-hidden">{item.stage}</em>
                  </button>
                ))}
                {dayInterviews.length > visibleInterviewLimit && <small>还有 {dayInterviews.length - visibleInterviewLimit} 场</small>}
              </div>
            </div>
          );
        })}
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
  const [notes, setNotes] = useState("");
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!jobId) return;
    setSubmitting(true);
    try {
      const result = await api.createJobApplication({
        job_description_id: jobId,
        resume_version_id: null,
        current_stage_type: "screening",
        current_round_no: null,
        current_stage_label: "待投递",
        stage_state: "awaiting_schedule",
        applied_at: null,
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
            <p>从岗位库选择目标岗位，后续面试和记录都会关联到这条进程。</p>
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
                  初始阶段
                  <input value="待投递" disabled />
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
              <Button type="button" variant="outline" onClick={() => {
                onClose();
                navigateTo("/career/applications?import=1");
              }}>导入岗位</Button>
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
  detailMode,
  timezone,
  initialStartAt,
  onClose,
  onCreated,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  initialApplicationId?: string | null;
  detailMode: boolean;
  timezone: string;
  initialStartAt?: string | null;
  onClose: () => void;
  onCreated: (sessionId: string, info?: ScheduleCreatedInfo) => void;
  onNotice: (notice: string) => void;
}) {
  const detailApplication = detailMode
    ? applications.find((item) => item.id === initialApplicationId) ?? null
    : null;
  const detailStageLabel = detailApplication?.current_stage_label ?? "一面";
  const detailProgress = detailApplication ? projectApplicationProgress(detailApplication) : null;
  const detailStageCategory = detailApplication?.current_stage_type === "screening"
    ? detailProgress?.isAssessment ? "assessment" : "screening"
    : "interview";
  const detailTimeLabel = detailStageCategory === "assessment"
    ? "测评时间"
    : detailStageCategory === "interview"
      ? "面试时间"
      : "记录时间";
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
  const [stage, setStage] = useState(detailStageLabel);
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
  const [meetingOrLocation, setMeetingOrLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [createdApplication, setCreatedApplication] = useState<JobApplicationSummary | null>(null);
  const [pendingCreateConflict, setPendingCreateConflict] = useState<{
    application: JobApplicationSummary;
    payload: InterviewSessionCreatePayload;
  } | null>(null);
  const requestIdRef = useRef(crypto.randomUUID());
  useEffect(() => {
    if (detailMode) return;
    void api.listJobDescriptions({ limit: 100 }).then((response) => setJobs(response.items)).catch(() => undefined);
  }, [detailMode]);
  useEffect(() => {
    if (detailMode && detailApplication) setStage(detailApplication.current_stage_label);
  }, [detailApplication?.current_stage_label, detailMode]);
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
      onCreated(response.session.id, {
        company: targetApplication.company_name_snapshot,
        stage: projectApplicationProgress(targetApplication).stageLabel,
        startAt: response.session.start_at,
      });
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
      if (detailMode && !targetApplication) {
        onNotice("当前求职进程已不可用，请刷新后重试。");
        return;
      }
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
        ...(detailMode
          ? {
              meeting_url: mode === "video" || mode === "phone"
                ? meetingOrLocation.trim() || null
                : null,
              location: mode === "onsite" || mode === "other"
                ? meetingOrLocation.trim() || null
                : null,
            }
          : {}),
      };
      await createSession(targetApplication, payload, false);
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };
  const creationLocked = createdJobId !== null || createdApplication !== null;
  const meetingOrLocationPlaceholder = mode === "video" || mode === "phone"
    ? "粘贴会议链接（可选）"
    : "填写会议室、地址或其他地点（可选）";
  return (
    <div className="interview-dialog-backdrop" role="presentation">
      <section className={`interview-dialog${detailMode ? " interview-dialog--detail-schedule" : ""}`} role="dialog" aria-modal="true" aria-labelledby="create-interview-title">
        <header><div><h2 id="create-interview-title">{detailMode ? "添加求职阶段" : "新建面试"}</h2><p>{detailMode ? "选择阶段分类并补充本阶段信息，保存后会进入对应的求职流程。" : "岗位信息、求职进程和本场排期在这里一次完成。"}</p></div><button type="button" aria-label="关闭" onClick={onClose}><X /></button></header>
        <form onSubmit={(event) => void submit(event)}>
          {detailMode ? (
            <>
              <div className="interview-detail-stage-section">
                <strong>阶段分类</strong>
                <div className="interview-detail-stage-categories" aria-label="阶段分类">
                  {[
                    ["screening", "筛选"],
                    ["assessment", "笔试 / 测评"],
                    ["interview", "面试"],
                  ].map(([key, label]) => (
                    <span key={key} className={key === detailStageCategory ? "is-active" : ""} aria-current={key === detailStageCategory ? "step" : undefined}>{label}</span>
                  ))}
                </div>
              </div>
              <div className="interview-detail-divider" aria-hidden="true" />
              <div className="interview-dialog-grid interview-detail-form-grid">
                <label>展示名称<input required value={stage} readOnly aria-readonly="true" /></label>
                {detailStageCategory === "interview" && <label>面试轮次<input type="number" value={detailApplication?.current_round_no ?? ""} readOnly aria-readonly="true" /></label>}
                <label>当前状态<input value="已安排" readOnly aria-readonly="true" /></label>
                <label>{detailTimeLabel}<input required type="datetime-local" step={60} value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
                {detailStageCategory !== "screening" && <>
                  <label>时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={90}>1.5 小时</option><option value={120}>2 小时</option></select></label>
                  <label>方式<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="video">视频面试</option><option value="onsite">现场面试</option><option value="phone">电话面试</option><option value="other">其他</option></select></label>
                  <label className="is-wide">链接或地点<input value={meetingOrLocation} onChange={(event) => setMeetingOrLocation(event.target.value)} placeholder={meetingOrLocationPlaceholder} /></label>
                </>}
              </div>
            </>
          ) : (
            <>
              {applications.length > 0 && <label>求职进程<select disabled={creationLocked || submitting} value={applicationId} onChange={(event) => setApplicationId(event.target.value)}><option value="new">新建求职进程</option>{applications.map((item) => <option key={item.id} value={item.id}>{item.company_name_snapshot} · {item.job_title_snapshot} · {projectApplicationProgress(item).stageLabel}</option>)}</select></label>}
              {applicationId === "new" && <>
                <label>已有岗位档案<select disabled={creationLocked || submitting} value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">在求职中心直接填写岗位</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.company_name} · {job.job_title}</option>)}</select></label>
                {!jobId && <div className="interview-dialog-grid"><label>公司<input disabled={creationLocked} required value={company} onChange={(event) => setCompany(event.target.value)} /></label><label>岗位<input disabled={creationLocked} required value={role} onChange={(event) => setRole(event.target.value)} /></label><label className="is-wide">岗位信息<textarea disabled={creationLocked} value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="可粘贴 JD，后续会作为本次求职的岗位快照" /></label></div>}
                <div className="interview-dialog-grid"><label>阶段<input disabled={creationLocked} required value={stage} onChange={(event) => setStage(event.target.value)} /></label><label>轮次<input disabled={creationLocked} type="number" min={1} value={roundNo} onChange={(event) => setRoundNo(Number(event.target.value))} /></label></div>
              </>}
            </>
          )}
          {creationLocked && <p className="interview-create-progress" role="status">岗位或求职进程已创建；再次提交只会重试当前面试排期，不会重复创建前置数据。</p>}
          {!detailMode && <div className="interview-dialog-grid"><label>开始时间<input required type="datetime-local" step={60} value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label><label>时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={90}>1.5 小时</option><option value={120}>2 小时</option></select></label><label>面试方式<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="video">视频面试</option><option value="onsite">现场面试</option><option value="phone">电话面试</option><option value="other">其他</option></select></label></div>}
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
          {detailMode ? (
            <footer className="interview-detail-footer">
              <p>保存后可继续补充安排或更新结果。</p>
              <div className="interview-detail-footer-actions">
                <Button type="button" variant="outline" onClick={onClose}>取消</Button>
                <Button type="submit" disabled={submitting || pendingCreateConflict !== null}>{submitting ? "正在保存…" : "添加并保存"}</Button>
              </div>
            </footer>
          ) : (
            <footer><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={submitting || pendingCreateConflict !== null}>{submitting ? "正在创建…" : "创建面试"}</Button></footer>
          )}
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
  const totalMinutes = Math.round(slot * 30);
  const hour = Math.floor(totalMinutes / 60);
  if (hour >= 24) return "24:00";
  return `${String(hour).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function CalendarColorPicker({ company, value, onChange }: { company: string; value: InterviewCalendarColor; onChange: (color: InterviewCalendarColor) => void }) {
  const currentLabel = CALENDAR_COLORS.find((color) => color.id === value)?.label ?? "灰色";
  return <div className="calendar-color-picker" role="group" aria-label={`${company}日历颜色，当前${currentLabel}`}><span>{currentLabel}</span>{CALENDAR_COLORS.map((color) => <button key={color.id} type="button" className={`calendar-color-swatch calendar-${color.id}`} aria-label={`将${company}的日历颜色设为${color.label}`} aria-pressed={color.id === value} title={color.label} onClick={() => onChange(color.id)} />)}</div>;
}

function InterviewContextSidebar({ className, interview }: { className: string; interview: Interview }) {
  return <aside className={`${className} interview-context-sidebar`} aria-label={`${interview.company}面试上下文`}><section className="interview-surface context-primary-card"><header className="context-company-header"><span className={`context-company-mark calendar-${interview.color}`}>{interview.logo}</span><strong>{interview.company}</strong><StatusBadge status={interview.status} /></header><h2>{interview.stage}（面试）</h2><p className="context-role">{interview.role}</p><dl className="context-detail-list"><DetailRow icon={<Clock3 />} label="时间" value={`${interview.date}（${interview.weekday}） ${interview.time} – ${interview.endTime}`} /><DetailRow icon={<Link2 />} label="面试方式" value={interview.mode} /><DetailRow icon={<UserRound />} label="面试官" value={interview.interviewer} /><DetailRow icon={<CircleCheck />} label="状态" value={interview.status === "completed" ? "已完成面试" : interview.status === "cancelled" ? "已取消" : "待面试"} /><DetailRow icon={<Bell />} label="备注" value={interview.note} /></dl></section><button type="button" className="interview-surface context-job-archive-card" onClick={() => navigateTo(careerApplicationPath(interview.applicationId))}><span>查看对应求职记录</span><div><FolderOpen /><p><strong>{interview.company} · {interview.role}</strong><small>岗位信息与本次求职进程</small></p><ChevronRight /></div></button></aside>;
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div><dt>{icon}{label}</dt><dd>{value}</dd></div>;
}

function StatusBadge({ status }: { status: InterviewStatus }) {
  const label = status === "completed" ? "已完成面试" : status === "active" ? "进行中" : status === "cancelled" ? "已取消" : "待面试";
  return <span className={`interview-status-badge status-${status}`}>{label}</span>;
}

function StageProgress({ application }: { application: InterviewSessionDetail["application"] }) {
  const projection = projectApplicationProgress(application);
  const journeyLabel = projection.isPending || projection.isWaiting
    ? projection.primaryLabel
    : application.current_stage_type === "offer"
      ? offerStatusLabel(application.offer_status)
      : projection.stageLabel;
  if (projection.isPending) {
    const pendingOrWaiting = [{ key: "pending", label: projection.stageLabel }];
    return <div className="stage-progress" style={{ "--stage-count": pendingOrWaiting.length } as CSSProperties} aria-label={`当前阶段：${journeyLabel}`}><div className="stage-progress-line" />{pendingOrWaiting.map((stage) => <div key={stage.key} className="is-current"><span /><strong>{stage.label}</strong></div>)}</div>;
  }
  const highestRound = Math.max(
    2,
    application.current_stage_type === "interview"
      ? application.current_round_no ?? 1
      : 2,
  );
  const stages = [
    { key: "screening", label: application.current_stage_type === "screening" ? projection.stageLabel : "筛选中" },
    ...Array.from({ length: highestRound }, (_, index) => ({
      key: `interview:${index + 1}`,
      label: interviewRoundLabel(index + 1),
    })),
    { key: "hr", label: "HR 面" },
    {
      key: "offer",
      label: application.current_stage_type === "offer"
        ? offerStatusLabel(application.offer_status)
        : "Offer",
    },
  ];
  const currentKey =
    application.current_stage_type === "interview"
      ? `interview:${application.current_round_no ?? 1}`
      : application.current_stage_type;
  const currentIndex = Math.max(0, stages.findIndex((stage) => stage.key === currentKey));
  return <div className="stage-progress" style={{ "--stage-count": stages.length } as CSSProperties} aria-label={`当前阶段：${journeyLabel}`}><div className="stage-progress-line" />{stages.map((stage, index) => <div key={stage.key} className={index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : ""}><span>{index < currentIndex ? <Check /> : null}</span><strong>{stage.label}</strong></div>)}</div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function interviewViewPath(view: InterviewView): string {
  return careerViewPath(view);
}

function ApplicationCategoryDialog({ application, onClose, onChanged }: {
  application: JobApplicationSummary;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [category, setCategory] = useState(String(application.job_snapshot.employment_type ?? "unclassified"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateJobApplication(application.id, {
        employment_type: category === "unclassified" ? null : category as JobEmploymentType,
        base_lock_version: application.lock_version,
      });
      await onChanged();
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && error.message === "INTERVIEW_EDIT_CONFLICT") {
        setError("求职记录已在其他页面更新，请关闭后重新修改分类。");
        await onChanged();
      } else {
        setError(errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>修改求职分类</DialogTitle><DialogDescription>{application.company_name_snapshot} · {application.job_title_snapshot}</DialogDescription></DialogHeader>
      <SelectField label="求职分类" value={category} disabled={saving} options={[{value: "internship", label: "实习"}, {value: "campus", label: "校招"}, {value: "full_time", label: "正式"}, {value: "unclassified", label: "未分类"}]} onChange={(event) => setCategory(event.target.value)} />
      {error && <p role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>取消</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
