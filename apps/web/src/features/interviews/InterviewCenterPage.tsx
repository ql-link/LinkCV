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
  Filter,
  FolderOpen,
  Import,
  LayoutGrid,
  Link2,
  ListChecks,
  Mic,
  MoreHorizontal,
  NotebookTabs,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Square,
  ArrowUpDown,
  Trash2,
  Trophy,
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
import "./interviews.css";

type InterviewStatus = "upcoming" | "active" | "completed" | "cancelled";
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
const APPLICATION_DRAG_DATA_TYPE = "text/job-application-id";
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
  const weekStart = useMemo(() => startOfWeek(), []);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  const [sessions, setSessions] = useState<InterviewSessionSummary[]>([]);
  const [applications, setApplications] = useState<JobApplicationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
  const [detail, setDetail] = useState<InterviewSessionDetail | null>(null);
  const [query, setQuery] = useState("");
  const [applicationDisplayMode, setApplicationDisplayMode] = useState<"board" | "list">("board");
  const [applicationScope, setApplicationScope] = useState<"all" | "active" | "ended" | "archived">("all");
  const [showApplicationFilters, setShowApplicationFilters] = useState(false);
  const [sortApplicationsNewestFirst, setSortApplicationsNewestFirst] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateApplication, setShowCreateApplication] = useState(false);
  const [createInterviewApplicationId, setCreateInterviewApplicationId] = useState<string | null>(null);
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
      const includeArchivedSessions = view === "records";
      const applicationScope = view === "records" || view === "applications" ? "all" : "active";
      const sessionRange = includeArchivedSessions
        ? {}
        : {
            startAt: weekStart.toISOString(),
            endAt: addDays(weekStart, 7).toISOString(),
          };
      const [nextSessions, nextApplications] = await Promise.all([
        listAllInterviewSessions({ includeArchived: includeArchivedSessions, ...sessionRange }),
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
  }, [loadDetail, timezone, view, weekStart]);

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

  return (
    <>
      <WorkspacePageHero
        className="career-module-header"
        icon={<BriefcaseBusiness />}
        tone="warning"
        title="求职中心"
        description="集中管理岗位机会、求职进程、面试排期与复盘记录。"
        actions={(
          <>
            {view === "applications" ? (
              <ApplicationHeaderControls
                displayMode={applicationDisplayMode}
                query={query}
                scope={applicationScope}
                showFilters={showApplicationFilters}
                sortNewestFirst={sortApplicationsNewestFirst}
                onCreate={() => setShowCreateApplication(true)}
                onDisplayModeChange={setApplicationDisplayMode}
                onQueryChange={setQuery}
                onScopeChange={setApplicationScope}
                onShowFiltersChange={setShowApplicationFilters}
                onSortChange={setSortApplicationsNewestFirst}
              />
            ) : view === "schedule" ? (
              <ScheduleHeaderControls
                query={query}
                weekStart={weekStart}
                onCreate={() => setShowCreate(true)}
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
      {navigation}
      <main className="dashboard-content interview-center-content">
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
          query={query}
          displayMode={applicationDisplayMode}
          scope={applicationScope}
          sortNewestFirst={sortApplicationsNewestFirst}
          onCreate={() => setShowCreateApplication(true)}
          onChanged={() => loadData()}
          onNotice={setNotice}
          onCreateInterview={(applicationId) => {
            setCreateInterviewApplicationId(applicationId);
            setShowCreate(true);
          }}
        />
      ) : view === "schedule" ? (
        <ScheduleView
          interviews={interviews}
          detail={detail}
          detailLoading={detailLoading}
          query={query}
          weekStart={weekStart}
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
          timezone={timezone}
          onClose={() => {
            setShowCreate(false);
            setCreateInterviewApplicationId(null);
          }}
          onCreated={(id) => {
            setShowCreate(false);
            setCreateInterviewApplicationId(null);
            void loadData(id);
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
  displayMode,
  query,
  scope,
  showFilters,
  sortNewestFirst,
  onCreate,
  onDisplayModeChange,
  onQueryChange,
  onScopeChange,
  onShowFiltersChange,
  onSortChange,
}: {
  displayMode: "board" | "list";
  query: string;
  scope: "all" | "active" | "ended" | "archived";
  showFilters: boolean;
  sortNewestFirst: boolean;
  onCreate: () => void;
  onDisplayModeChange: (value: "board" | "list") => void;
  onQueryChange: (value: string) => void;
  onScopeChange: (value: "all" | "active" | "ended" | "archived") => void;
  onShowFiltersChange: (value: boolean) => void;
  onSortChange: (value: boolean) => void;
}) {
  return (
    <div className="career-applications-controls">
      <label className="career-process-search">
        <span className="sr-only">搜索求职进程</span>
        <input type="search" name="career-application-search" autoComplete="off" spellCheck={false} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索公司、职位或关键词…" />
        <Search aria-hidden="true" />
      </label>
      <div className="career-filter-control">
        <button type="button" className="career-control-button" aria-expanded={showFilters} onClick={() => onShowFiltersChange(!showFilters)}><Filter />筛选</button>
        {showFilters && <div className="career-filter-popover" role="group" aria-label="求职进程状态范围">
          {(["all", "active", "ended", "archived"] as const).map((value) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => { onScopeChange(value); onShowFiltersChange(false); }}>{{ all: "全部进程", active: "进行中", ended: "已结束", archived: "已归档" }[value]}</button>)}
        </div>}
      </div>
      <button type="button" className="career-control-button" aria-label={sortNewestFirst ? "当前按最近更新排序，点击切换为最早更新" : "当前按最早更新排序，点击切换为最近更新"} onClick={() => onSortChange(!sortNewestFirst)}><ArrowUpDown />排序</button>
      <div className="career-view-switch" role="group" aria-label="求职进程展示方式">
        <button type="button" aria-pressed={displayMode === "board"} onClick={() => onDisplayModeChange("board")}><LayoutGrid />看板</button>
        <button type="button" aria-pressed={displayMode === "list"} onClick={() => onDisplayModeChange("list")}><ListChecks />列表</button>
      </div>
      <Button icon={<Plus />} onClick={onCreate}>新建求职进程</Button>
    </div>
  );
}

function ScheduleHeaderControls({ query, weekStart, onCreate, onQueryChange }: { query: string; weekStart: Date; onCreate: () => void; onQueryChange: (value: string) => void }) {
  const weekEnd = addDays(weekStart, 6);
  return (
    <div className="schedule-page-actions">
      <ExpandableSearch label="搜索面试排期" name="schedule-search" value={query} onValueChange={onQueryChange} placeholder="搜索公司、职位或轮次…" />
      <div className="schedule-week-range"><CalendarDays /><span>{weekStart.getFullYear()}年{formatDate(weekStart)} – {formatDate(weekEnd)}</span></div>
      <Button icon={<Plus />} onClick={onCreate}>安排面试</Button>
    </div>
  );
}

function ApplicationsView({
  applications,
  selectedApplicationId,
  query,
  displayMode,
  scope,
  sortNewestFirst,
  onCreate,
  onCreateInterview,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  selectedApplicationId?: string;
  query: string;
  displayMode: "board" | "list";
  scope: "all" | "active" | "ended" | "archived";
  sortNewestFirst: boolean;
  onCreate: () => void;
  onCreateInterview: (applicationId: string) => void;
  onChanged: () => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const [draggingApplicationId, setDraggingApplicationId] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [advancingApplicationId, setAdvancingApplicationId] = useState<string | null>(null);
  const suppressCardClickRef = useRef(false);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleApplications = applications.filter((item) => {
    const matchesScope = scope === "all"
      || (scope === "active" && item.status === "active" && !item.archived_at)
      || (scope === "ended" && item.status !== "active" && !item.archived_at)
      || (scope === "archived" && Boolean(item.archived_at));
    const matchesQuery = !normalizedQuery
      || `${item.company_name_snapshot}${item.job_title_snapshot}${item.current_stage_label}`
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesScope && matchesQuery;
  }).sort((left, right) => {
    const difference = new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    return sortNewestFirst ? difference : -difference;
  });
  const interviewRounds = visibleApplications
    .filter((item) => item.current_stage_type === "interview")
    .map((item) => item.current_round_no ?? 1);
  const highestInterviewRound = interviewRounds.length ? Math.max(...interviewRounds) : 0;
  const extraInterviewRounds = Array.from(new Set([
    ...interviewRounds.filter((roundNo) => roundNo > 2),
    ...(highestInterviewRound >= 2 ? [highestInterviewRound + 1] : []),
  ])).sort((left, right) => left - right);
  const columnDefinitions = [
    { key: "screening", label: "筛选中" },
    { key: "communication", label: "等待沟通" },
    { key: "interview:1", label: "一面" },
    { key: "interview:2", label: "二面" },
    ...extraInterviewRounds.map((roundNo) => ({ key: `interview:${roundNo}`, label: interviewRoundLabel(roundNo) })),
    { key: "hr", label: "HR 面" },
    { key: "offer", label: "Offer" },
    { key: "ended", label: "已结束" },
    ...(visibleApplications.some((item) => item.archived_at) ? [{ key: "archived", label: "已归档" }] : []),
  ];
  const columns = columnDefinitions.map(({ key, label }) => ({
    key,
    label,
    items: visibleApplications.filter((item) => pipelineColumnKey(item) === key),
  }));
  const selectedApplication = selectedApplicationId
    ? applications.find((item) => item.id === selectedApplicationId) ?? null
    : null;
  const applicationWeekStart = startOfWeek().getTime();
  const applicationWeekEnd = addDays(new Date(applicationWeekStart), 7).getTime();
  const dashboardMetrics = {
    active: applications.filter((item) => item.status === "active" && !item.archived_at).length,
    weekly: applications.filter((item) => {
      if (!item.next_session_start_at) return false;
      const startAt = new Date(item.next_session_start_at).getTime();
      return startAt >= applicationWeekStart && startAt < applicationWeekEnd;
    }).length,
    followUp: applications.filter((item) => item.status === "active" && item.stage_state === "awaiting_result").length,
    offers: applications.filter((item) => item.offer_status === "written_offer_received" || item.offer_status === "accepted").length,
  };

  const draggingApplication = draggingApplicationId
    ? applications.find((item) => item.id === draggingApplicationId) ?? null
    : null;

  const clearDragState = () => {
    setDraggingApplicationId(null);
    setDropTargetKey(null);
  };

  const beginDragging = (event: ReactDragEvent<HTMLElement>, application: JobApplicationSummary) => {
    if (!isApplicationDraggable(application) || advancingApplicationId !== null) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(APPLICATION_DRAG_DATA_TYPE, application.id);
    event.dataTransfer.setData("application-id", application.id);
    event.dataTransfer.setData("text/plain", application.id);
    suppressCardClickRef.current = true;
    setDraggingApplicationId(application.id);
    setDropTargetKey(null);
  };

  const endDragging = () => {
    clearDragState();
    window.setTimeout(() => {
      suppressCardClickRef.current = false;
    }, 0);
  };

  const advanceTo = async (
    application: JobApplicationSummary,
    target: ApplicationDropTarget,
  ) => {
    setAdvancingApplicationId(application.id);
    try {
      await api.advanceJobApplication(application.id, {
        target_stage_type: target.stageType,
        target_round_no: target.roundNo,
        target_stage_label: target.stageLabel,
        base_lock_version: application.lock_version,
      });
      await onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
      await onChanged();
    } finally {
      setAdvancingApplicationId(null);
    }
  };

  const handleColumnDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    columnKey: string,
  ) => {
    if (!draggingApplication || !canDropApplicationOnColumn(draggingApplication, columnKey)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetKey(columnKey);
  };

  const handleColumnDragLeave = (
    event: ReactDragEvent<HTMLDivElement>,
    columnKey: string,
  ) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    if (dropTargetKey === columnKey) setDropTargetKey(null);
  };

  const handleColumnDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    columnKey: string,
  ) => {
    const applicationId = event.dataTransfer.getData(APPLICATION_DRAG_DATA_TYPE)
      || event.dataTransfer.getData("application-id")
      || event.dataTransfer.getData("text/plain")
      || draggingApplicationId;
    const application = applicationId
      ? applications.find((item) => item.id === applicationId) ?? null
      : null;
    const target = application ? applicationDropTarget(columnKey) : null;
    if (!application || !target || !canDropApplicationOnColumn(application, columnKey)) {
      clearDragState();
      return;
    }
    event.preventDefault();
    suppressCardClickRef.current = true;
    clearDragState();
    void advanceTo(application, target);
  };

  return (
    <div className="career-applications-layout">
      <section className="career-application-metrics" aria-label="求职进程数据概览">
        <CareerApplicationMetric icon={<BriefcaseBusiness />} tone="blue" label="进行中的进程" value={dashboardMetrics.active} hint="当前全部进程" />
        <CareerApplicationMetric icon={<Clock3 />} tone="orange" label="本周待面试" value={dashboardMetrics.weekly} hint="已安排场次" />
        <CareerApplicationMetric icon={<Bell />} tone="purple" label="待跟进" value={dashboardMetrics.followUp} hint="需要及时跟进" />
        <CareerApplicationMetric icon={<Trophy />} tone="green" label="已拿 Offer" value={dashboardMetrics.offers} hint="书面 Offer" />
      </section>

      <section className="interview-surface career-applications-board">
        {visibleApplications.length > 0 && displayMode === "board" ? (
          <div
            className="interview-pipeline-grid"
            style={{ "--pipeline-column-count": columns.length } as CSSProperties}
          >
            {columns.map((column) => (
              <div
                className={`interview-pipeline-column${draggingApplication && canDropApplicationOnColumn(draggingApplication, column.key) ? " is-drop-target" : ""}${dropTargetKey === column.key ? " is-drop-target-active" : ""}`}
                key={column.key}
                onDragOver={(event) => handleColumnDragOver(event, column.key)}
                onDragLeave={(event) => handleColumnDragLeave(event, column.key)}
                onDrop={(event) => handleColumnDrop(event, column.key)}
              >
                <header className="career-pipeline-column-heading"><h3>{column.label}<span>{column.items.length}</span></h3><div><button type="button" aria-label={`在${column.label}中新建求职进程`} onClick={onCreate}><Plus /></button><MoreHorizontal aria-hidden="true" /></div></header>
                {column.items.map((item) => (
                  <PipelineCard
                    key={item.id}
                    item={item}
                    draggable={isApplicationDraggable(item) && advancingApplicationId !== item.id}
                    isDragging={draggingApplicationId === item.id}
                    isAdvancing={advancingApplicationId === item.id}
                    onOpen={() => {
                      if (!suppressCardClickRef.current) navigateTo(careerApplicationPath(item.id));
                    }}
                    onDragStart={(event) => beginDragging(event, item)}
                    onDragEnd={endDragging}
                  />
                ))}
                {!column.items.length && <p className="pipeline-empty">暂无进程</p>}
                <button type="button" className="career-pipeline-add" onClick={onCreate}><Plus />添加进程</button>
              </div>
            ))}
          </div>
        ) : visibleApplications.length ? (
          <div className="career-application-list" role="table" aria-label="求职进程列表">
            <div role="row"><span role="columnheader">公司与岗位</span><span role="columnheader">当前阶段</span><span role="columnheader">状态</span><span role="columnheader">下一场面试</span><span role="columnheader">操作</span></div>
            {visibleApplications.map((item) => (
              <div role="row" key={item.id}>
                <span role="cell"><strong>{item.company_name_snapshot}</strong><small>{item.job_title_snapshot}</small></span>
                <span role="cell">{item.current_stage_label}</span>
                <span role="cell">{applicationStatusLabel(item)}</span>
                <span role="cell">{item.next_session_start_at ? formatApplicationDateTime(item.next_session_start_at) : "暂未安排"}</span>
                <span role="cell"><Button size="sm" variant="outline" onClick={() => navigateTo(careerApplicationPath(item.id))}>查看进程</Button></span>
              </div>
            ))}
          </div>
        ) : (
          <div className="career-applications-empty">
            <BriefcaseBusiness />
            <h2>{normalizedQuery ? "没有匹配的求职进程" : scope === "archived" ? "还没有已归档进程" : scope === "ended" ? "还没有已结束进程" : "还没有求职进程"}</h2>
            <p>{normalizedQuery ? "换个公司、职位或阶段关键词试试。" : scope === "archived" ? "归档后的进程会集中显示在这里。" : scope === "ended" ? "已结束或未通过的进程会显示在这里。" : "先从岗位库选择目标岗位，再开始记录投递进度。"}</p>
            {!normalizedQuery && scope !== "archived" && scope !== "ended" && <Button onClick={onCreate}>创建第一条求职进程</Button>}
          </div>
        )}
      </section>
      {selectedApplicationId && (
        selectedApplication ? (
          <section className="interview-surface career-application-detail" aria-labelledby="career-application-detail-title">
            <header>
              <div>
                <button type="button" onClick={() => navigateTo(careerViewPath("applications"))}><ChevronLeft />返回求职进程</button>
                <h2 id="career-application-detail-title">{selectedApplication.company_name_snapshot} · {selectedApplication.job_title_snapshot}</h2>
                <p>创建于 {formatApplicationDate(selectedApplication.created_at)} · 当前阶段 {selectedApplication.current_stage_label}</p>
              </div>
              <div>
                <Button variant="outline" onClick={() => navigateTo(jobDetailPathFromApplication(selectedApplication))}>查看岗位</Button>
                {selectedApplication.status === "active" && selectedApplication.stage_state === "awaiting_schedule" && (
                  <Button onClick={() => onCreateInterview(selectedApplication.id)}>安排面试</Button>
                )}
              </div>
            </header>
            <StageProgress application={selectedApplication} />
            <dl>
              <div><dt>当前状态</dt><dd>{applicationStatusLabel(selectedApplication)}</dd></div>
              <div><dt>投递时间</dt><dd>{selectedApplication.applied_at ? formatApplicationDate(selectedApplication.applied_at) : "暂未记录"}</dd></div>
              <div><dt>关联简历</dt><dd>{selectedApplication.resume_title_snapshot ?? "暂未选择简历版本"}</dd></div>
              <div><dt>下一场面试</dt><dd>{selectedApplication.next_session_start_at ? formatApplicationDateTime(selectedApplication.next_session_start_at) : "暂未安排"}</dd></div>
            </dl>
            {selectedApplication.notes && <p className="career-application-notes">{selectedApplication.notes}</p>}
          </section>
        ) : (
          <section className="interview-surface career-application-detail career-applications-empty">
            <h2>无法打开这条求职进程</h2>
            <p>记录不存在、已被删除，或当前账号没有访问权限。</p>
            <Button variant="outline" onClick={() => navigateTo(careerViewPath("applications"))}>返回求职进程</Button>
          </section>
        )
      )}
    </div>
  );
}

function CareerApplicationMetric({ icon, tone, label, value, change, hint }: { icon: ReactNode; tone: string; label: string; value: number; change?: string; hint?: string }) {
  return <article className="career-application-metric"><span className={`tone-${tone}`} aria-hidden="true">{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{change && <>较上周 <b>{change}</b></>}{hint}</p></div></article>;
}

function interviewRoundLabel(roundNo: number): string {
  if (roundNo === 1) return "一面";
  if (roundNo === 2) return "二面";
  return `第 ${roundNo} 轮`;
}

type ApplicationDropTarget = {
  stageType: ApplicationStageType;
  roundNo: number | null;
  stageLabel: string;
};

function applicationDropTarget(columnKey: string): ApplicationDropTarget | null {
  if (columnKey.startsWith("interview:")) {
    const roundNo = Number(columnKey.slice("interview:".length));
    if (!Number.isInteger(roundNo) || roundNo < 1) return null;
    return {
      stageType: "interview",
      roundNo,
      stageLabel: interviewRoundLabel(roundNo),
    };
  }
  if (columnKey === "hr") return { stageType: "hr", roundNo: null, stageLabel: "HR 面" };
  if (columnKey === "offer") return { stageType: "offer", roundNo: null, stageLabel: "Offer" };
  return null;
}

function isApplicationDraggable(application: JobApplicationSummary): boolean {
  return application.status === "active"
    && application.archived_at === null
    && application.current_stage_type !== "offer";
}

function canDropApplicationOnColumn(
  application: JobApplicationSummary,
  columnKey: string,
): boolean {
  if (!isApplicationDraggable(application)) return false;
  const sourceColumn = pipelineColumnKey(application);
  if (columnKey === sourceColumn) return false;
  const target = applicationDropTarget(columnKey);
  if (!target) return false;
  if (application.current_stage_type === "screening") {
    return target.stageType === "hr"
      || target.stageType === "offer"
      || (target.stageType === "interview" && target.roundNo === 1);
  }
  if (application.current_stage_type === "interview") {
    return target.stageType === "hr"
      || target.stageType === "offer"
      || (target.stageType === "interview"
        && target.roundNo !== null
        && target.roundNo > (application.current_round_no ?? 0));
  }
  return application.current_stage_type === "hr" && target.stageType === "offer";
}

function pipelineColumnKey(application: JobApplicationSummary): string {
  if (application.archived_at) return "archived";
  if (application.status !== "active") return "ended";
  if (application.current_stage_type === "screening" && application.current_stage_label.includes("沟通"))
    return "communication";
  if (application.current_stage_type !== "interview")
    return application.current_stage_type;
  return `interview:${application.current_round_no ?? 1}`;
}

function PipelineCard({
  item,
  onOpen,
  draggable = false,
  isDragging = false,
  isAdvancing = false,
  onDragStart,
  onDragEnd,
}: {
  item: JobApplicationSummary;
  onOpen?: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  isAdvancing?: boolean;
  onDragStart?: (event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
}) {
  const timeLabel = item.next_session_start_at
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(item.next_session_start_at))
    : item.applied_at
      ? `投递 ${formatApplicationDate(item.applied_at)}`
      : "暂未排期";
  return (
    <article
      className={`pipeline-card${draggable ? " is-draggable" : ""}${isDragging ? " is-dragging" : ""}${isAdvancing ? " is-advancing" : ""}`}
      aria-label={`${item.company_name_snapshot} ${item.job_title_snapshot}`}
      aria-grabbed={draggable ? isDragging : undefined}
      aria-busy={isAdvancing || undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {onOpen ? <button type="button" className="pipeline-card-open" aria-label={`查看 ${item.company_name_snapshot} ${item.job_title_snapshot} 求职进程`} onClick={onOpen}><PipelineCardContent item={item} timeLabel={timeLabel} /></button> : <PipelineCardContent item={item} timeLabel={timeLabel} />}
    </article>
  );
}

function PipelineCardContent({ item, timeLabel }: { item: JobApplicationSummary; timeLabel: string }) {
  return (
    <header className="pipeline-card-header">
      <CompanyLogo item={{ company: item.company_name_snapshot, logo: item.company_name_snapshot.slice(0, 1), color: item.calendar_color }} />
      <span>
        <span className="pipeline-card-title-row">
          <strong>{item.company_name_snapshot}</strong>
          <time className="pipeline-card-time">{timeLabel}</time>
        </span>
        <small className="pipeline-card-role">{item.job_title_snapshot}</small>
      </span>
    </header>
  );
}

function jobDetailPathFromApplication(application: JobApplicationSummary): string {
  return application.job_description_id ? `/career/jobs/${encodeURIComponent(application.job_description_id)}` : "/career/jobs";
}

function applicationStatusLabel(application: JobApplicationSummary): string {
  if (application.archived_at) return "已归档";
  if (application.status === "rejected") return "未通过";
  if (application.status === "withdrawn") return "已主动结束";
  if (application.status === "closed") return application.offer_status === "accepted" ? "已接受 Offer" : "已结束";
  return application.stage_state === "awaiting_schedule" ? "等待安排" : application.stage_state === "awaiting_result" ? "等待结果" : application.stage_state === "negotiating" ? "Offer 沟通中" : "进行中";
}

function formatApplicationDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatApplicationDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
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

function ScheduleView({
  interviews,
  detail,
  detailLoading,
  query,
  weekStart,
  onSelect,
  onMove,
}: {
  interviews: Interview[];
  detail: InterviewSessionDetail | null;
  detailLoading: boolean;
  query: string;
  weekStart: Date;
  onSelect: (id: string) => void;
  onMove: (id: string, calendarDay: number, calendarStart: number) => void;
}) {
  const [mockInterviews, setMockInterviews] = useState(() => createScheduleMockInterviews(weekStart));
  const [openInterviewId, setOpenInterviewId] = useState<string | null>(null);
  const isUsingMock = interviews.length === 0;
  const normalizedQuery = query.trim().toLowerCase();
  const sourceInterviews = isUsingMock ? mockInterviews : interviews;
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
        <p id="schedule-drag-instructions" className="visually-hidden">
          拖动面试可以调整排期，时间按 30 分钟对齐。日历背景只显示整点线。
        </p>
        <WeekCalendar
          weekStart={weekStart}
          interviews={visibleInterviews}
          selectedId={openInterviewId}
          onSelect={handleSelect}
          onMove={handleMove}
        />
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
  const assets = matchingDetail?.assets ?? (isMock ? [
    { id: "mock-asset-1", original_file_name: "项目经验整理.pdf", file_size: 2_400_000 },
    { id: "mock-asset-2", original_file_name: "系统设计复习要点.docx", file_size: 1_100_000 },
  ] : []);
  const preparationItems = isMock
    ? ["复习项目：高并发系统设计与优化", "阅读：阿里技术面试题（P6+）", "准备提问：团队技术栈与挑战"]
    : [matchingDetail?.session.preparation_note ?? "确认岗位要求与面试重点", "确认会议设备、网络和面试时间"];
  const applicationHref = matchingDetail
    ? careerApplicationPath(matchingDetail.application.id, interview.id)
    : careerViewPath("applications");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="interview-schedule-dialog">
        <DialogHeader><DialogTitle>面试详情</DialogTitle><DialogDescription className="sr-only">查看本场面试的时间、方式、关联投递和准备资料。</DialogDescription></DialogHeader>
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
          <div className="schedule-dialog-materials"><h4><FileText />准备资料</h4><div>{assets.slice(0, 2).map((asset) => <span key={asset.id}><FileText /><b>{asset.original_file_name}</b><small>{formatBytes(asset.file_size)}</small></span>)}</div></div>
          <div className="schedule-dialog-tasks"><h4><ListChecks />待准备事项</h4><ul>{preparationItems.map((item, index) => <li key={item}>{index < 2 ? <Check /> : <Square />}<span>{item}</span></li>)}</ul></div>
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
  selectedId,
  onSelect,
  onMove,
}: {
  weekStart: Date;
  interviews: Interview[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, calendarDay: number, calendarStart: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    calendarDay: number;
    calendarStart: number;
  } | null>(null);
  const dragGrabOffset = useRef(0);
  const draggingInterview = interviews.find((item) => item.id === draggingId);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 9 * 60;
  }, []);
  const resolveDropTarget = (
    event: ReactDragEvent<HTMLDivElement>,
    span: number,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const gridLeft = rect.left + 58;
    const gridWidth = Math.max(1, rect.width - 58);
    const calendarDay = Math.min(
      6,
      Math.max(0, Math.floor((event.clientX - gridLeft) / (gridWidth / 7))),
    );
    const rawSlot =
      Math.floor((event.clientY - rect.top) / (rect.height / SCHEDULE_SLOT_COUNT)) -
      dragGrabOffset.current;
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
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/interview-id") || draggingId;
            const item = interviews.find((interview) => interview.id === id);
            if (id && item) {
              const target = resolveDropTarget(event, item.calendarSpan);
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
              <span>
                {formatScheduleTime(dropTarget.calendarStart)} – {formatScheduleTime(dropTarget.calendarStart + draggingInterview.calendarSpan)}
              </span>
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
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => moveWithKeyboard(event, item)}
              onDragStart={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const offset = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
                dragGrabOffset.current = Math.min(item.calendarSpan - 1, Math.max(0, Math.floor(offset * item.calendarSpan)));
                event.dataTransfer.setData("text/interview-id", String(item.id));
                setDraggingId(item.id);
                onSelect(item.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
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
  timezone,
  onClose,
  onCreated,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  initialApplicationId?: string | null;
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
