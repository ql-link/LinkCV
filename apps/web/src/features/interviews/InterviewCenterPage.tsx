import { t, useLocale, getLocale, weekdayName } from "@/i18n";
import { MotionPresence, MotionSurface, useContentMotion } from "@/components/ui/motion";
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
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
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
  ChevronDown,
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
import { Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, PageLoading } from "@/components/ui";
import { SelectField } from "@/components/ui/select-field";
import { LoadingText } from "@/components/ui/page-loading";
import { Icon, type V3IconName } from "@/v3/Icon";
import { Reveal, Sk, SkeletonBoard, SkeletonCalendar, SkeletonCards, SkeletonHead } from "@/v3/skeletons";
import { readPageCache, useRevalidateOnFocus, writePageCache } from "@/v3/pageCache";
import {
  BeTag,
  ConfirmDialog as V3ConfirmDialog,
  DateTimeField,
  Dialog as V3Dialog,
  DialogFooter as DialogFooterV3,
  Menu,
  MonthCalendar,
  WeekCalendar,
  PageEyebrow,
  Popover,
  SearchBox,
  Select,
  Toggle,
  formatDateTimeLabel,
} from "@/v3/primitives";
import { Badge, Bar, Centered, DeleteSessionArt, Paper } from "@/v3/art";
import { MOCK_SESSION_CONFIRMED } from "@/v3/mocks";
import { PrepChecklistCard } from "./PrepChecklistCard";
import { CareerNotice, CareerPageHead, ScheduleArt, type ScheduleArtKind } from "./careerV3";
import { describeScheduleConflict, findScheduleConflicts } from "./scheduleConflicts";
import { NewProcessDialog } from "./NewProcessDialog";
import { ReviewListV3 } from "./ReviewListV3";
import {
  EventCalendar,
  type EventCalendarApi,
  type EventCalendarRenderEventProps,
} from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import {
  EventCalendarNav,
  EventCalendarNavNext,
  EventCalendarNavPrev,
  EventCalendarNavToday,
  EventCalendarTitle,
  EventCalendarViewSwitcher,
} from "@/components/reui/event-calendar/event-calendar-nav";
import { EventCalendarMonthView } from "@/components/reui/event-calendar/event-calendar-month-view";
import { EventCalendarWeekView } from "@/components/reui/event-calendar/event-calendar-time-grid";
import type { EventCalendarI18nOverrides } from "@/components/reui/event-calendar/event-calendar-i18n";
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarProposedUpdate,
} from "@/components/reui/event-calendar/event-calendar-types";
import { enUS, zhCN } from "date-fns/locale";
import {
  ApiRequestError,
  api,
  type ApplicationStageType,
  type InterviewAssetRecord,
  type InterviewCalendarColor,
  type InterviewOverview,
  type InterviewSessionDetail,
  type InterviewSessionSummary,
  type JobApplicationRecord,
  type JobApplicationSummary,
  type JobDescriptionSummary,
  type JobEmploymentType,
} from "@/api/client";
import { careerApplicationPath, careerViewPath, navigateTo, type InterviewView } from "../../routing";
import { JobSmartImportDialog } from "../jobs/JobSmartImportDialog";
import { PluginInstallDialog } from "../jobs/PluginInstallDialog";
import {
  ApplicationsBoard,
  applicationBoardColumnOptions,
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
  ScheduleDateTimePicker,
  TerminateApplicationConfirmDialog,
} from "./CareerDetailViews";
import "./interviews.css";



type InterviewStatus = "upcoming" | "active" | "completed" | "cancelled";
type ScheduleGranularity = CalendarView;
type ScheduleCreatedInfo = {
  company: string;
  stage: string;
  startAt: string;
};

const HIDDEN_APPLICATION_BOARD_COLUMNS_STORAGE_KEY = "linkresume:career-applications:hidden-columns:v1";

function readStoredHiddenApplicationBoardColumnIds(): Set<string> {
  try {
    const value = window.sessionStorage.getItem(HIDDEN_APPLICATION_BOARD_COLUMNS_STORAGE_KEY);
    if (!value) return new Set();
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? new Set(parsed)
      : new Set();
  } catch {
    return new Set();
  }
}

function storeHiddenApplicationBoardColumnIds(columnIds: ReadonlySet<string>) {
  try {
    window.sessionStorage.setItem(
      HIDDEN_APPLICATION_BOARD_COLUMNS_STORAGE_KEY,
      JSON.stringify(Array.from(columnIds).sort()),
    );
  } catch {
    // A blocked storage backend must not prevent in-memory column visibility changes.
  }
}

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
  canReschedule: boolean;
  mode: string;
  modeCode: "video" | "onsite" | "phone" | "other";
  meetingLabel: string;
  interviewer: string;
  note: string;
  prepTotal: number;
  prepDone: number;
  calendarDay: number;
  calendarStart: number;
  calendarSpan: number;
  color: InterviewCalendarColor;
  startAt: string;
  endAt: string;
  scheduleKind: "fixed_slot" | "open_window";
  answerPlanStartAt: string | null;
  answerPlanEndAt: string | null;
  calendarRole?: "open_window" | "answer_plan";
  questions: string;
  review: string;
  improvement: string;
};
const INTERVIEW_CALENDAR_COLORS: Record<InterviewCalendarColor, string> = {
  red: "#d64545",
  orange: "#d9822b",
  yellow: "#c4a236",
  green: "#3d8b67",
  blue: "#3f6fd8",
  purple: "#8b6bc8",
  gray: "#96968f",
};

const INTERVIEW_CALENDAR_I18N: EventCalendarI18nOverrides = {
  labels: {
    get today() { return t("今天"); },
    get previous() { return t("上一周期"); },
    get next() { return t("下一周期"); },
    get addEvent() { return t("添加面试"); },
    get allDay() { return t("全天"); },
    more: (count) => t("另有 {value0} 项", { value0: count }),
    get noEvents() { return t("暂无面试安排"); },
    get loading() { return t("正在加载面试排期"); },
    get event() { return t("项安排"); },
    events: (count) => t("{value0} 项安排", { value0: count }),
    get selectView() { return t("选择视图"); },
    week: (weekNumber) => t("第 {value0} 周", { value0: weekNumber }),
    get resources() { return t("资源"); },
    get goToDate() { return t("跳转日期"); },
    get dropNotAllowed() { return t("不能调整到这里"); },
    get continues() { return t("跨日继续"); },
    timeFrom: (time) => t("开始于 {value0}", { value0: time }),
    timeUntil: (time) => t("结束于 {value0}", { value0: time }),
    toggleDayEvents: (count) => t("{value0} 项安排", { value0: count }),
    eventDetails: (title) => title,
    moreCompact: (count) => `+${count}`,
    timeRange: (from, to) => `${from}–${to}`,
  },
  viewNames: {
    get month() { return t("月"); },
    get week() { return t("周"); },
    get day() { return t("日"); },
    days: (count) => t("{value0} 天", { value0: count }),
    get agenda() { return t("议程"); },
    get resource() { return t("时间网格"); },
  },
  formats: {
    get monthTitle() { return getLocale() === "en-US" ? "MMMM yyyy" : "yyyy年M月"; },
    timeGridDayHeader: "M/d EEE",
    timeGutter: "HH:mm",
    timeGutterMinute: "HH:mm",
    eventTime: "HH:mm",
    monthDayHeader: "EEE",
    monthDayHeaderNarrow: "EEEEE",
    monthCellDay: "d",
    get moreDayHeader() { return getLocale() === "en-US" ? "MMM d · EEE" : "M月d日 · EEE"; },
  },
};
type InterviewSessionCreatePayload = Parameters<
  typeof api.createInterviewSession
>[1];

const CALENDAR_COLORS: Array<{
  id: InterviewCalendarColor;
  label: string;
}> = [
  { id: "red", get label() { return t("红色"); } },
  { id: "orange", get label() { return t("橙色"); } },
  { id: "yellow", get label() { return t("黄色"); } },
  { id: "green", get label() { return t("绿色"); } },
  { id: "blue", get label() { return t("蓝色"); } },
  { id: "purple", get label() { return t("紫色"); } },
  { id: "gray", get label() { return t("灰色"); } },
];
const DRAFT_CALENDAR_COLORS = CALENDAR_COLORS.filter((color) => color.id !== "gray");

function randomDraftCalendarColor(): InterviewCalendarColor {
  return DRAFT_CALENDAR_COLORS[Math.floor(Math.random() * DRAFT_CALENDAR_COLORS.length)]?.id ?? "blue";
}
function startOfWeek(source = new Date()): Date {
  const result = new Date(source);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

// 月 / 周互切时以哪一天为准：当前这一段包含今天就用今天；否则周取周四（这一周大部分日子所在的月），月取 1 号。
// 直接用周一或 1 号换算会来回漂移：9 月 28 日这一周 → 9 月 → 9 月 1 日所在的 8 月 31 日那一周 → 8 月。
function scheduleFocusDay(from: "week" | "month", anchor: Date): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (from === "week") {
    const start = startOfWeek(anchor);
    return today >= start && today < addDays(start, 7) ? today : addDays(start, 3);
  }
  const start = startOfMonth(anchor);
  return today.getFullYear() === start.getFullYear() && today.getMonth() === start.getMonth() ? today : start;
}

/** 这个月在周一开头的月历里占几行（4–6），与日历组件 fixedWeeks={false} 时的行数一致 */
function monthWeekRows(monthStart: Date): number {
  const offset = (monthStart.getDay() + 6) % 7;
  const days = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  return Math.ceil((offset + days) / 7);
}

function startOfMonth(source = new Date()): Date {
  const result = new Date(source);
  result.setDate(1);
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
  return t("{value0}月{value1}日", { value0: source.getMonth() + 1, value1: source.getDate() });
}

function formatApplicationSessionRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "—";
  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
  return sameDay
    ? `${formatApplicationListDateTime(startAt)}–${formatTime(end)}`
    : `${formatApplicationListDateTime(startAt)}–${formatApplicationListDateTime(endAt)}`;
}

function formatMonth(source: Date): string {
  return t("{value0}年{value1}月", { value0: source.getFullYear(), value1: source.getMonth() + 1 });
}

function formatScheduleWeekRange(source: Date): string {
  const end = addDays(source, 6);
  return t("{value0}年{value1} – {value2}", { value0: source.getFullYear(), value1: formatDate(source), value2: formatDate(end) });
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
  return weekdayName(source);
}

function modeLabel(mode: InterviewSessionSummary["mode"]): string {
  return mode === "video"
    ? t("视频面试")
    : mode === "onsite"
      ? t("现场面试")
      : mode === "phone"
        ? t("电话面试")
        : t("其他方式");
}

function meetingLabel(session: InterviewSessionSummary): string {
  if (session.mode === "onsite") return [session.location, t("现场")].filter(Boolean).join(" · ");
  const platform = session.meeting_url?.includes("feishu.cn") || session.meeting_url?.includes("larksuite.com") ? t("飞书会议")
    : session.meeting_url?.includes("meeting.tencent.com") ? t("腾讯会议")
    : session.meeting_url?.includes("nowcoder.com") ? t("牛客网") : null;
  const mode = session.mode === "video" ? t("视频") : session.mode === "phone" ? t("电话") : t("其他方式");
  return [mode, platform].filter(Boolean).join(" · ");
}

function displayStatus(session: InterviewSessionSummary): InterviewStatus {
  if (session.status === "completed") return "completed";
  if (session.status === "cancelled") return "cancelled";
  const now = Date.now();
  if (new Date(session.start_at).getTime() <= now && new Date(session.end_at).getTime() > now)
    return "active";
  return "upcoming";
}

function toInterview(
  session: InterviewSessionSummary,
  weekStart: Date,
  application?: JobApplicationSummary,
): Interview {
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
    canReschedule:
      session.status === "scheduled"
      && application?.archived_at == null,
    mode: modeLabel(session.mode),
    modeCode: session.mode,
    meetingLabel: meetingLabel(session),
    interviewer:
      [session.interviewer_name, session.interviewer_title]
        .filter(Boolean)
        .join("（") + (session.interviewer_name && session.interviewer_title ? "）" : "") ||
      t("暂未填写"),
    note: session.preparation_note ?? t("暂未填写面试准备备注。"),
    prepTotal: session.prep_total ?? 0,
    prepDone: session.prep_done ?? 0,
    calendarDay,
    calendarStart: start.getHours() * 2 + start.getMinutes() / 30,
    calendarSpan: Math.max(
      1,
      (end.getTime() - start.getTime()) / 1_800_000,
    ),
    color:
      session.stage_type === "interview"
      && session.round_no === 3
      && session.calendar_color === "gray"
        ? "purple"
        : session.calendar_color,
    startAt: session.start_at,
    endAt: session.end_at,
    scheduleKind: session.schedule_kind ?? "fixed_slot",
    answerPlanStartAt: session.answer_plan_start_at ?? null,
    answerPlanEndAt: session.answer_plan_end_at ?? null,
    questions: session.questions_markdown ?? "",
    review: session.review_summary ?? "",
    improvement: session.improvement_markdown ?? "",
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return t("登录状态已失效，请重新登录后再试。");
    const messages: Record<string, string> = {
      INTERVIEW_EDIT_CONFLICT: t("这条面试已在其他页面更新，请刷新后再试。"),
      INTERVIEW_INVALID_TRANSITION: t("当前求职进度不允许执行这个操作。"),
      INTERVIEW_SCHEDULE_KIND_NOT_SUPPORTED: t("当前阶段不支持开放作答窗口。"),
      INTERVIEW_ANSWER_PLAN_NOT_SUPPORTED: t("这条安排不支持设置作答计划。"),
      INTERVIEW_ANSWER_PLAN_INVALID_TIME: t("作答计划时间无效，请重新选择。"),
      INTERVIEW_ANSWER_PLAN_OUTSIDE_WINDOW: t("作答计划必须完整落在官方开放时间内。"),
      INVALID_INTERVIEW_TIME: t("面试开始时间需要是有效的 24 小时制 HH:mm（分钟 00–59）。"),
      INTERVIEW_ASSET_TOO_LARGE: t("素材超过 500 MiB，请压缩后重试。"),
      UNSUPPORTED_INTERVIEW_ASSET: t("暂不支持这种素材格式。"),
      INTERVIEW_APPLICATION_DELETE_FAILED: t("删除失败，请稍后重试。"),
      INTERVIEW_APPLICATION_NOT_EMPTY: t("请先清理该求职进程下的面试记录。"),
      INTERVIEW_SESSION_NOT_EMPTY: t("请先删除这场面试关联的素材。"),
    };
    return messages[error.message] ?? t("操作失败：{value0}", { value0: error.message });
  }
  return t("操作失败，请稍后重试。");
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

type ApplicationFunnel = { applied: number; reachedInterview: number };
const FUNNEL_CACHE_KEY = "career-funnel";

function summarizeApplicationFunnel(items: JobApplicationSummary[]): ApplicationFunnel {
  const applied = items.filter((item) => item.phase !== "pending");
  return {
    applied: applied.length,
    reachedInterview: applied.filter((item) => item.current_stage_type !== "screening").length,
  };
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

function currentApplicationStageSession(
  application: JobApplicationSummary,
  sessions: InterviewSessionSummary[],
): InterviewSessionSummary | null {
  return sessions
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
  moduleTitle,
}: {
  view: InterviewView;
  initialApplicationId?: string;
  initialSessionId?: string;
  initialJobId?: string;
  initialCreateApplication?: boolean;
  initialJobImport?: boolean;
  navigation?: ReactNode;
  moduleTitle?: string;
}) {
  useLocale();
  const weekStart = useMemo(() => startOfWeek(), []);
  const [scheduleGranularity, setScheduleGranularity] = useState<ScheduleGranularity>("week");
  const [scheduleAnchor, setScheduleAnchor] = useState(() => startOfWeek());
  const scheduleWeekStart = useMemo(() => startOfWeek(scheduleAnchor), [scheduleAnchor]);
  const scheduleMonthStart = useMemo(() => startOfMonth(scheduleAnchor), [scheduleAnchor]);
  const scheduleGridStart = useMemo(() => startOfWeek(scheduleMonthStart), [scheduleMonthStart]);
  // 月 / 周都按「所在月份的 6 周月历」取数：同一段时间在月、周之间切换时请求范围不变，
  // 不会重新请求、数据晚到一拍（日程块和「接下来」后出现），切换时页面不会跳动。
  const scheduleRangeStart = useMemo(() => {
    if (scheduleGranularity === "month") return scheduleGridStart;
    if (scheduleGranularity === "week") return startOfWeek(startOfMonth(scheduleFocusDay("week", scheduleAnchor)));
    return scheduleAnchor;
  }, [scheduleAnchor, scheduleGranularity, scheduleGridStart]);
  const scheduleRangeDays = scheduleGranularity === "month" || scheduleGranularity === "week"
    ? 42
    : scheduleGranularity === "days"
      ? 5
      : scheduleGranularity === "agenda"
        ? 30
        : 1;
  const scheduleRangeStartAt = scheduleRangeStart.toISOString();
  const scheduleRangeEndAt = addDays(scheduleRangeStart, scheduleRangeDays).toISOString();
  // 只按起止时间字符串缓存：范围没变就是同一个对象，loadData 不会重建、不会触发重新请求
  const scheduleRange = useMemo(
    () => ({ startAt: scheduleRangeStartAt, endAt: scheduleRangeEndAt }),
    [scheduleRangeStartAt, scheduleRangeEndAt],
  );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  // 回到岗位看板 / 面试日程时，先用上一次的数据直接显示（不画骨架），同时在后台静默刷新
  const careerCacheKey = `career:${view}:${initialApplicationId ?? ""}:${initialSessionId ?? ""}`;
  const dedupedMountRef = useRef(false);
  const [cachedCareer] = useState(() => readPageCache<{ sessions: InterviewSessionSummary[]; applications: JobApplicationSummary[] }>(careerCacheKey));
  const [sessions, setSessions] = useState<InterviewSessionSummary[]>(() => cachedCareer?.value.sessions ?? []);
  const [applications, setApplications] = useState<JobApplicationSummary[]>(() => cachedCareer?.value.applications ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
  const [detail, setDetail] = useState<InterviewSessionDetail | null>(null);
  const [query, setQuery] = useState("");
  const [applicationDisplayMode, setApplicationDisplayMode] = useState<"board" | "list">("board");
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [hiddenApplicationBoardColumnIds, setHiddenApplicationBoardColumnIds] = useState<Set<string>>(
    readStoredHiddenApplicationBoardColumnIds,
  );
  const [applicationSortMode, setApplicationSortMode] = useState<ApplicationSortMode>("recent_schedule");
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoadedData, setHasLoadedData] = useState(() => Boolean(cachedCareer));
  const [resolvedApplicationDetailId, setResolvedApplicationDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateApplication, setShowCreateApplication] = useState(false);
  const [jobImportOpen, setJobImportOpen] = useState(false);
  const [showPluginInstall, setShowPluginInstall] = useState(false);
  const [createInterviewApplicationId, setCreateInterviewApplicationId] = useState<string | null>(null);
  const [createInterviewStartAt, setCreateInterviewStartAt] = useState<string | null>(null);
  const [createInterviewEndAt, setCreateInterviewEndAt] = useState<string | null>(null);
  const [createInterviewColor, setCreateInterviewColor] = useState<InterviewCalendarColor>("blue");
  const [scheduleToast, setScheduleToast] = useState<string | null>(null);
  const [createProcessOpen, setCreateProcessOpen] = useState(false);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const dismissScheduleToast = useCallback(() => setScheduleToast(null), []);
  // 时间冲突：每组冲突在本次打开页面时只提示一次
  const [seenConflictKeys, setSeenConflictKeys] = useState<string[]>([]);
  const scheduleConflict = useMemo(
    () => (view === "schedule" ? findScheduleConflicts(sessions).find((item) => !seenConflictKeys.includes(item.key)) ?? null : null),
    [seenConflictKeys, sessions, view],
  );
  const dismissScheduleConflict = useCallback(() => {
    if (scheduleConflict) setSeenConflictKeys((keys) => [...keys, scheduleConflict.key]);
  }, [scheduleConflict]);
  const selectedIdRef = useRef<string | null>(initialSessionId ?? null);
  const loadRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const noticeIdRef = useRef(0);
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
  const isInterviewDetailRoute = view === "records" && Boolean(initialSessionId);
  const isStandaloneDetailRoute = isApplicationDetailRoute || isInterviewDetailRoute;

  const showNotice = useCallback((message: string) => {
    noticeIdRef.current += 1;
    setNotice({ id: noticeIdRef.current, message });
  }, []);

  const pushScheduleToast = useCallback((message: string) => {
    setScheduleToast(message);
  }, []);

  const openCreateInterview = (startAt?: string, endAt?: string) => {
    setCreateInterviewStartAt(startAt ?? null);
    setCreateInterviewEndAt(endAt ?? null);
    setCreateInterviewColor(randomDraftCalendarColor());
    setShowCreate(true);
  };
  const inheritDraftApplicationColor = useCallback((application: JobApplicationSummary) => {
    setCreateInterviewColor(application.calendar_color);
  }, []);

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
      if (requestId === detailRequestRef.current) showNotice(errorMessage(error));
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, [showNotice]);

  const loadData = useCallback(async (preferredId?: string | null) => {
    const requestId = ++loadRequestRef.current;
    const invalidatedDetailRequest = ++detailRequestRef.current;
    setLoading(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const applicationDetail = view === "applications" && Boolean(initialApplicationId);
      const interviewDetail = view === "records" && Boolean(initialSessionId);
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
      writePageCache(`career:${view}:${initialApplicationId ?? ""}:${initialSessionId ?? ""}`, { sessions: nextSessions, applications: nextApplications });
      window.dispatchEvent(new CustomEvent("career-applications-changed", { detail: nextApplications.filter((item) => item.status === "active" && !item.archived_at).length }));
      setHasLoadedData(true);
      if (applicationDetail) {
        setResolvedApplicationDetailId(initialApplicationId as string);
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
        showNotice(errorMessage(error));
        if (detailRequestRef.current === invalidatedDetailRequest)
          setDetailLoading(false);
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [initialApplicationId, initialSessionId, loadDetail, scheduleRange, showNotice, timezone, view, weekStart]);

  useEffect(() => {
    selectedIdRef.current = initialSessionId ?? null;
    setSelectedId(initialSessionId ?? null);
    setDetail(null);
    // 去重：刚读过（10 秒内）的看板 / 日程数据直接用，不再请求；带具体记录 id 的详情页照常读取
    if (!dedupedMountRef.current && cachedCareer?.fresh && !initialSessionId && !initialApplicationId) {
      dedupedMountRef.current = true;
      setLoading(false);
      return undefined;
    }
    dedupedMountRef.current = true;
    void loadData(initialSessionId);
    return () => {
      ++loadRequestRef.current;
      ++detailRequestRef.current;
    };
  }, [initialSessionId, loadData]);
  // 窗口回到前台：看板 / 日程在后台静默刷新（已有数据时不画骨架）
  useRevalidateOnFocus(() => { if (!isStandaloneDetailRoute && !loading) void loadData(selectedIdRef.current); });

  const interviews = useMemo(() => {
    const applicationById = new Map(applications.map((item) => [item.id, item]));
    return sessions.map((session) => toInterview(
      session,
      view === "schedule" ? scheduleWeekStart : weekStart,
      applicationById.get(session.application_id),
    ));
  }, [applications, scheduleWeekStart, sessions, view, weekStart]);
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
  const selectedApplication = isApplicationDetailRoute
    ? applications.find((item) => item.id === initialApplicationId) ?? null
    : null;
  const applicationDetailPending = isApplicationDetailRoute
    && selectedApplication === null
    && resolvedApplicationDetailId !== initialApplicationId;

  const selectInterview = async (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    await loadDetail(id);
  };

  const reschedule = async (
    id: string,
    calendarDay: number,
    calendarStart: number,
    durationSlots?: number,
  ) => {
    const current = interviews.find((item) => item.id === id);
    if (!current || !current.canReschedule) return;
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
        base_lock_version: current.lockVersion,
      });
      setNotice(null);
      await loadData(response.session.id);
      const updatedStart = new Date(response.session.start_at);
      const updatedEnd = new Date(response.session.end_at);
      pushScheduleToast(t("已自动更新：{value0} · {value1} {value2}–{value3}", { value0: current.company, value1: weekday(updatedStart), value2: formatTime(updatedStart), value3: formatTime(updatedEnd) }));
    } catch (error) {
      showNotice(errorMessage(error));
      await loadData(id);
    }
  };

  const updateAnswerPlan = async (id: string, start: Date | null, durationMinutes: number | null) => {
    const current = interviews.find((item) => item.id === id);
    if (!current || !current.canReschedule || current.scheduleKind !== "open_window") return;
    const optimisticStart = start?.toISOString() ?? null;
    const end = start && durationMinutes
      ? new Date(start.getTime() + durationMinutes * 60_000)
      : null;
    const optimisticEnd = end?.toISOString() ?? null;
    setSessions((items) => items.map((item) => item.id === id
      ? { ...item, answer_plan_start_at: optimisticStart, answer_plan_end_at: optimisticEnd }
      : item));
    try {
      const response = optimisticStart && durationMinutes
        ? await api.updateInterviewAnswerPlan(id, {
            answer_plan_start_at: optimisticStart,
            duration_minutes: durationMinutes,
            base_lock_version: current.lockVersion,
          })
        : await api.updateInterviewAnswerPlan(id, {
            answer_plan_start_at: null,
            answer_plan_end_at: null,
            base_lock_version: current.lockVersion,
          });
      setNotice(null);
      await loadData(response.session.id);
      pushScheduleToast(start && end
        ? t("已更新作答计划：{value0} · {value1} {value2}–{value3}", { value0: current.company, value1: weekday(start), value2: formatTime(start), value3: formatTime(end) })
        : t("已清除作答计划：{value0}", { value0: current.company }));
    } catch (error) {
      showNotice(errorMessage(error));
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
      showNotice(errorMessage(error));
    }
  };

  const openCreateProcess = () => {
    setCreateInterviewApplicationId(null);
    setCreateInterviewStartAt(null);
    setCreateInterviewEndAt(null);
    setCreateProcessOpen(true);
  };
  const closeCreateProcess = () => {
    setCreateProcessOpen(false);
    setCreateInterviewStartAt(null);
    setCreateInterviewEndAt(null);
  };

  const showSkeleton = (loading && !hasLoadedData) || applicationDetailPending;
  return (
    <div className={`career-workspace-frame v3-career${isStandaloneDetailRoute ? " is-standalone-detail" : ""}`}>
      {/* 看板 / 列表共用同一套撑满高度的布局：切换时页头、统计、工具栏都不动，只有下方区域切换 */}
      <main className={`dashboard-content interview-center-content career-v3-page${isStandaloneDetailRoute ? " career-standalone-detail-content" : ""}${!isStandaloneDetailRoute && view === "applications" ? " career-applications-board-content" : ""}${!isStandaloneDetailRoute && view === "schedule" ? " career-schedule-content" : ""}`}>
      {notice && (
        <CareerNotice
          key={notice.id}
          className="interview-error-notice"
          message={notice.message}
          onDismiss={dismissNotice}
        />
      )}
      {scheduleToast && (
        <CareerNotice kind="success" message={scheduleToast} onDismiss={dismissScheduleToast} />
      )}
      {!scheduleToast && !notice && scheduleConflict && (
        <CareerNotice
          key={scheduleConflict.key}
          className="schedule-conflict-notice"
          title={t("时间存在冲突")}
          message={describeScheduleConflict(scheduleConflict, timezone)}
          onDismiss={dismissScheduleConflict}
          action={(
            <button
              type="button"
              className="career-notice-action"
              onClick={() => {
                const target = scheduleConflict.second.id;
                dismissScheduleConflict();
                void selectInterview(target);
              }}
            >{t("查看")}</button>
          )}
        />
      )}
      {!isStandaloneDetailRoute && view === "applications" && (
        <ApplicationsHeader
          applications={applications}
          sessions={sessions}
          loading={showSkeleton}
          weekStart={weekStart}
          timezone={timezone}
          onCreateProcess={openCreateProcess}
          onImport={openJobImport}
        />
      )}
      {!isStandaloneDetailRoute && view === "applications" && (showSkeleton || applications.length > 0) && (
        <ApplicationViewControls
          applications={applications}
          displayMode={applicationDisplayMode}
          hiddenColumnIds={hiddenApplicationBoardColumnIds}
          sortMode={applicationSortMode}
          groupByCategory={groupByCategory}
          query={query}
          onQueryChange={setQuery}
          onGroupingChange={setGroupByCategory}
          onDisplayModeChange={setApplicationDisplayMode}
          onSortChange={setApplicationSortMode}
          onColumnVisibilityChange={(columnId, visible) => {
            setHiddenApplicationBoardColumnIds((current) => {
              const next = new Set(current);
              if (visible) next.delete(columnId);
              else next.add(columnId);
              storeHiddenApplicationBoardColumnIds(next);
              return next;
            });
          }}
        />
      )}
      <Reveal
        loading={showSkeleton}
        className="career-body-slot"
        placeholder={view === "schedule" ? <ScheduleLoading /> : view === "applications" && !isApplicationDetailRoute ? <BoardSkeleton /> : (
          <div className="cd3-page"><SkeletonHead actions={2} /><SkeletonCards cards={[120, 220, 160]} label={t("正在加载求职数据…")} /></div>
        )}
      >{isApplicationDetailRoute ? (
        <>
          <ApplicationDetailView
            application={selectedApplication}
            sessions={sessions}
            timezone={timezone}
            onBack={() => navigateTo(careerViewPath("applications"))}
            onCreateInterview={(applicationId) => {
              setCreateInterviewApplicationId(applicationId);
              setShowCreate(true);
            }}
            onChanged={() => loadData(initialSessionId)}
            onNotice={showNotice}
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
              onNotice={showNotice}
            />
          )}
        </>
      ) : isInterviewDetailRoute ? (
        <InterviewSessionDetailView
          detail={detail?.session.id === initialSessionId ? detail : null}
          detailLoading={detailLoading}
          onBack={() => navigateTo(careerViewPath("records"))}
          onChanged={(preferredId) => loadData(preferredId)}
          onNotice={showNotice}
        />
      ) : view === "applications" ? (
        <ApplicationsView
          applications={applications}
          sessions={sessions}
          query={query}
          displayMode={applicationDisplayMode}
          hiddenColumnIds={hiddenApplicationBoardColumnIds}
          sortMode={applicationSortMode}
          groupByCategory={groupByCategory}
          timezone={timezone}
          onCreate={() => setShowCreateApplication(true)}
          onInstallPlugin={() => setShowPluginInstall(true)}
          onImport={openJobImport}
          onChanged={() => loadData(initialSessionId)}
          onNotice={showNotice}
        />
      ) : view === "schedule" ? (
        <ScheduleView
          interviews={interviews}
          detail={detail}
          detailLoading={detailLoading}
          query={query}
          granularity={scheduleGranularity}
          anchor={scheduleAnchor}
          weekStart={scheduleWeekStart}
          monthStart={scheduleMonthStart}
          timezone={timezone}
          draftStartAt={showCreate || createProcessOpen ? createInterviewStartAt : null}
          draftEndAt={showCreate || createProcessOpen ? createInterviewEndAt : null}
          draftColor={createInterviewColor}
          onCreate={openCreateInterview}
          onDateChange={setScheduleAnchor}
          onGranularityChange={(value) => {
            setScheduleGranularity(value);
            setScheduleAnchor((current) => value === "month"
              ? startOfMonth(scheduleFocusDay("week", current))
              : value === "week"
                ? startOfWeek(scheduleFocusDay("month", current))
                : current);
          }}
          onSelect={(id) => void selectInterview(id)}
          onMove={(id, day, slot, span) => void reschedule(id, day, slot, span)}
          onAnswerPlanMove={(id, start, end) => void updateAnswerPlan(id, start, Math.round((end.getTime() - start.getTime()) / 60_000))}
          onAnswerPlanChange={(id, start, durationMinutes) => void updateAnswerPlan(id, start, durationMinutes)}
        />
      ) : (
        <ReviewListV3 interviews={queryMatchedInterviews.filter((item) => item.status === "completed" && sessions.find((session) => session.id === item.id)?.stage_type !== "other")} />
      )}</Reveal>
      <MotionPresence>{showCreate && (isApplicationDetailRoute || Boolean(createInterviewApplicationId) ? (
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
            setCreateInterviewEndAt(null);
          }}
          initialStartAt={createInterviewStartAt}
          initialEndAt={createInterviewEndAt}
          onCreated={(id, info) => {
            setShowCreate(false);
            setCreateInterviewApplicationId(null);
            setCreateInterviewStartAt(null);
            setCreateInterviewEndAt(null);
            if (info) {
              const start = new Date(info.startAt);
              pushScheduleToast(t("已创建：{value0} · {value1} · {value2} {value3}", { value0: info.company, value1: info.stage, value2: weekday(start), value3: formatTime(start) }));
            }
            void loadData(id);
          }}
          onNotice={showNotice}
        />
      ) : (
        <ScheduleStageDialog
          applications={applications.filter(canAddScheduledStage)}
          excludedApplications={applications.filter((item) => item.status === "active" && item.archived_at === null && !canAddScheduledStage(item))}
          timezone={timezone}
          initialStartAt={createInterviewStartAt ?? ""}
          initialEndAt={createInterviewEndAt ?? ""}
          onApplicationChange={inheritDraftApplicationColor}
          onCreateProcess={() => {
            // 带着双击选中的时间打开「新建求职流程」
            setShowCreate(false);
            setCreateProcessOpen(true);
          }}
          onClose={() => {
            setShowCreate(false);
            setCreateInterviewStartAt(null);
            setCreateInterviewEndAt(null);
          }}
          onChanged={() => loadData()}
          onNotice={showNotice}
        />
      ))}</MotionPresence>
      <MotionPresence>{createProcessOpen && (
        <NewProcessDialog
          applications={applications}
          timezone={timezone}
          initialStartAt={createInterviewStartAt}
          initialEndAt={createInterviewEndAt}
          onClose={closeCreateProcess}
          onCreated={(id, info) => {
            closeCreateProcess();
            if (info) {
              const start = new Date(info.startAt);
              pushScheduleToast(t("已创建：{value0} · {value1} · {value2} {value3}", { value0: info.company, value1: info.stage, value2: weekday(start), value3: formatTime(start) }));
            }
            void loadData(id);
          }}
        />
      )}</MotionPresence>
      <MotionPresence>{showCreateApplication && (
        <CreateApplicationDialog
          applications={applications}
          initialJobId={initialJobId}
          onClose={() => setShowCreateApplication(false)}
          onCreated={(applicationId) => {
            setShowCreateApplication(false);
            void loadData();
            navigateTo(careerApplicationPath(applicationId));
          }}
          onNotice={showNotice}
        />
      )}</MotionPresence>
      <MotionPresence>{view === "applications" && jobImportOpen && (
        <JobSmartImportDialog
          unified
          onClose={closeJobImport}
          onInstallPlugin={() => {
            closeJobImport();
            setShowPluginInstall(true);
          }}
        />
      )}</MotionPresence>
      <MotionPresence>{view === "applications" && showPluginInstall && (
        <PluginInstallDialog onClose={() => setShowPluginInstall(false)} />
      )}</MotionPresence>
      </main>
    </div>
  );
}

function OverviewLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  useLocale();
  return <a className={className} href={href} onClick={(event) => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    navigateTo(href);
  }}>{children}</a>;
}

function formatMonthDay(source: Date): string {
  return `${String(source.getMonth() + 1).padStart(2, "0")}-${String(source.getDate()).padStart(2, "0")}`;
}

// 04.1 页头 + 统计 4 格：本周面试、Offer 取 getInterviewOverview 的 metrics；投递总数、面试转化率由全量（含归档）申请列表在前端统计
function ApplicationsHeader({
  applications,
  sessions,
  loading,
  weekStart,
  timezone,
  onCreateProcess,
  onImport,
}: {
  applications: JobApplicationSummary[];
  sessions: InterviewSessionSummary[];
  loading: boolean;
  weekStart: Date;
  timezone: string;
  onCreateProcess: () => void;
  onImport: () => void;
}) {
  useLocale();
  // 本周统计也走短时缓存：回到看板时先显示上一次的数字，后台刷新到了再原地更新
  const metricsCacheKey = `career-metrics:${isoDate(weekStart)}:${timezone}`;
  const [metrics, setMetrics] = useState<InterviewOverview["metrics"] | null>(() => readPageCache<InterviewOverview["metrics"]>(metricsCacheKey)?.value ?? null);
  const [metricsPending, setMetricsPending] = useState(() => !readPageCache(metricsCacheKey));
  useEffect(() => {
    let cancelled = false;
    const cached = readPageCache<InterviewOverview["metrics"]>(metricsCacheKey);
    if (cached) setMetrics(cached.value);
    setMetricsPending(!cached);
    if (cached?.fresh) return undefined;
    if (typeof api.getInterviewOverview !== "function") { setMetricsPending(false); return undefined; }
    const request = api.getInterviewOverview(isoDate(weekStart), timezone);
    if (!request || typeof (request as Promise<unknown>).then !== "function") { setMetricsPending(false); return undefined; }
    void request.then((overview) => {
      if (!cancelled && overview?.metrics) { setMetrics(overview.metrics); writePageCache(metricsCacheKey, overview.metrics); }
    }).catch(() => undefined).finally(() => { if (!cancelled) setMetricsPending(false); });
    return () => { cancelled = true; };
  }, [metricsCacheKey, timezone, weekStart]);
  // 投递总数与面试转化率按全部申请（含归档）统计：已投递的申请为分母，当前阶段进入面试、HR 或 Offer 的为分子。
  const [funnel, setFunnel] = useState<ApplicationFunnel | null>(() => readPageCache<ApplicationFunnel>(FUNNEL_CACHE_KEY)?.value ?? null);
  const [funnelPending, setFunnelPending] = useState(() => !readPageCache(FUNNEL_CACHE_KEY));
  useEffect(() => {
    let cancelled = false;
    const cached = readPageCache<ApplicationFunnel>(FUNNEL_CACHE_KEY);
    if (cached) setFunnel(cached.value);
    setFunnelPending(!cached);
    if (cached?.fresh) return undefined;
    void listAllJobApplications("all").then((items) => {
      if (cancelled) return;
      const next = summarizeApplicationFunnel(items);
      setFunnel(next);
      writePageCache(FUNNEL_CACHE_KEY, next);
    }).catch(() => undefined).finally(() => { if (!cancelled) setFunnelPending(false); });
    return () => { cancelled = true; };
  }, [applications]);
  const weekEnd = addDays(weekStart, 7);
  const activeCount = applications.filter((item) => item.status === "active" && item.archived_at === null && item.lifecycle_status !== "terminated").length;
  // Only use local totals after the overview request settles, never as interim values.
  const weeklyInterviews = metrics?.weekly_interviews ?? sessions.filter((item) => item.status !== "cancelled" && new Date(item.start_at) >= weekStart && new Date(item.start_at) < weekEnd).length;
  const offers = metrics?.offers_received ?? applications.filter((item) => item.current_stage_type === "offer" && item.offer_status !== "declined").length;
  const pendingOffers = applications.filter((item) => item.current_stage_type === "offer" && item.offer_status === "received" && item.status === "active").length;
  const empty = !loading && applications.length === 0;
  const statsPending = loading || metricsPending || funnelPending;
  return (
    <>
      <CareerPageHead
        className="career-board-head"
        eyebrow={["JOBS", t("本周 {value0} 至 {value1}", { value0: formatMonthDay(weekStart), value1: formatMonthDay(addDays(weekStart, 6)) })]}
        title={t("岗位看板")}
        subtitle={<Reveal inline loading={statsPending} placeholder={<LoadingText width={260} />}>{t("{value0} 个进行中 · {value1} 场面试{value2}", { value0: activeCount, value1: weeklyInterviews, value2: pendingOffers ? t(" · {value0} 个 Offer 待回复", { value0: pendingOffers }) : "" })}</Reveal>}
        actions={(
          <>
            <button type="button" className="v3-btn v3-btn-ghost" onClick={onCreateProcess}><Icon name="cal" size={13} />{t("已有面试安排")}</button>
            <button type="button" className="v3-btn v3-btn-dark" onClick={onImport}>{t("导入岗位")}</button>
          </>
        )}
      />
      <dl className="career-board-stats" aria-label={t("岗位看板统计")}>
        {[
          { label: t("投递总数"), value: empty ? "0" : funnel ? String(funnel.applied) : "—" },
          { label: t("本周面试"), value: String(weeklyInterviews) },
          { label: t("面试转化率"), value: empty || !funnel || funnel.applied === 0 ? "—" : `${Math.round((funnel.reachedInterview / funnel.applied) * 100)}%` },
          { label: "Offer", value: String(offers), extra: pendingOffers ? t("待回复") : undefined },
        ].map((item) => (
          <div key={item.label} className="career-board-stat">
            <Reveal loading={statsPending} placeholder={<div><Sk w={40} h={22} r={5} /><Sk w={64} h={11} style={{ marginTop: 8 }} /></div>}>
              <dd><strong className="v3-num">{item.value}</strong>{item.extra && <small>{item.extra}</small>}</dd>
              <dt>{item.label}</dt>
            </Reveal>
          </div>
        ))}
      </dl>
    </>
  );
}

// 04.1 看板 / 列表切换 + 排序、筛选（筛选里是「展示阶段」和「分组」，沿用原来的视图设置能力）
function ApplicationViewControls({
  applications,
  displayMode,
  hiddenColumnIds,
  sortMode,
  groupByCategory,
  query,
  onQueryChange,
  onDisplayModeChange,
  onSortChange,
  onGroupingChange,
  onColumnVisibilityChange,
}: {
  applications: JobApplicationSummary[];
  displayMode: "board" | "list";
  hiddenColumnIds: ReadonlySet<string>;
  sortMode: ApplicationSortMode;
  groupByCategory: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onDisplayModeChange: (value: "board" | "list") => void;
  onSortChange: (value: ApplicationSortMode) => void;
  onGroupingChange: (value: boolean) => void;
  onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
}) {
  useLocale();
  const sortRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [stageVisibilityOpen, setStageVisibilityOpen] = useState(false);
  const closeSort = useCallback(() => setSortOpen(false), []);
  const closeFilter = useCallback(() => {
    setFilterOpen(false);
    setStageVisibilityOpen(false);
  }, []);
  const boardColumnOptions = useMemo(
    () => applicationBoardColumnOptions(applications),
    [applications],
  );
  return (
    <div className="career-board-toolbar" role="group" aria-label={t("求职记录显示设置")}>
      <div className="v3-seg" role="group" aria-label={t("显示方式")}>
        <button type="button" aria-pressed={displayMode === "board"} onClick={() => onDisplayModeChange("board")}>{t("看板")}</button>
        <button type="button" aria-pressed={displayMode === "list"} onClick={() => onDisplayModeChange("list")}>{t("列表")}</button>
      </div>
      <div className="career-board-toolbar-right">
        <SearchBox value={query} onChange={onQueryChange} placeholder={t("搜索公司、岗位…")} label={t("搜索求职进程")} width={180} />
        <button ref={sortRef} type="button" className="career-toolbar-link" aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen((open) => !open)}>
          <Icon name="list" size={13} />{t("排序")}</button>
        <Menu
          anchorRef={sortRef}
          open={sortOpen}
          onClose={closeSort}
          placement="bottom-end"
          label={t("排序")}
          width={148}
          items={[
            { label: t("最近排期"), checked: sortMode === "recent_schedule", onSelect: () => onSortChange("recent_schedule") },
            { label: t("最先添加"), checked: sortMode === "earliest_added", onSelect: () => onSortChange("earliest_added") },
          ]}
        />
        <button ref={filterRef} type="button" className="career-toolbar-link" aria-label={t("视图设置")} aria-haspopup="dialog" aria-expanded={filterOpen} onClick={() => (filterOpen ? closeFilter() : setFilterOpen(true))}>
          <Icon name="filter" size={13} />{t("筛选")}</button>
        <Popover anchorRef={filterRef} open={filterOpen} onClose={closeFilter} placement="bottom-end" label={t("视图设置")} className="career-filter-panel">
          <div className="career-filter-field">
            <span>{t("分组")}</span>
            <Select
              size="sm"
              label={t("分类分组")}
              value={groupByCategory ? "category" : "none"}
              options={[{ value: "none", label: t("不分组") }, { value: "category", label: t("求职分类") }]}
              onChange={(value) => onGroupingChange(value === "category")}
            />
          </div>
          <div className="career-filter-field">
            <span>{t("排序")}</span>
            <Select
              size="sm"
              label={t("排序方式")}
              value={sortMode}
              options={[{ value: "recent_schedule", label: t("最近排期") }, { value: "earliest_added", label: t("最先添加") }]}
              onChange={(value) => onSortChange(value as ApplicationSortMode)}
            />
          </div>
          {displayMode === "board" && (
            <>
              <div className="v3-menu-sep" />
              <button type="button" className="career-filter-toggle" aria-expanded={stageVisibilityOpen} aria-controls="career-view-stage-options" onClick={() => setStageVisibilityOpen((open) => !open)}>
                <span>{t("展示阶段")}</span>
                <Icon name={stageVisibilityOpen ? "chevu" : "chevd"} size={12} />
              </button>
              {stageVisibilityOpen && (
                <div id="career-view-stage-options" className="career-filter-stages" role="group" aria-label={t("展示阶段")}>
                  {boardColumnOptions.map((column) => (
                    <label key={column.id} className="career-filter-row">
                      <span>{column.label}</span>
                      <input
                        type="checkbox"
                        className="career-filter-check"
                        checked={!hiddenColumnIds.has(column.id)}
                        onChange={(event) => onColumnVisibilityChange(column.id, event.target.checked)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}

// 10.3 岗位看板加载中：页头与统计保留，骨架列宽跟随真实看板。
function BoardSkeleton() {
  useLocale();
  return <SkeletonBoard label={t("正在加载求职数据…")} />;
}

// 面试日程加载中：页头下方画日历格子骨架（替代原来居中的转圈）
function ScheduleLoading() {
  useLocale();
  return <><SkeletonHead actions={2} /><SkeletonCalendar label={t("正在加载求职数据…")} /></>;
}

function stageBlockReason(application: JobApplicationSummary): { reason: string; action: string } {
  const progress = projectApplicationProgress(application);
  if (progress.isPending) return { reason: t("{value0} · 先在看板里标记投递", { value0: progress.stageLabel }), action: t("去投递") };
  if (application.current_stage_type === "offer") return { reason: t("已进入 Offer · 不再安排面试"), action: t("查看") };
  if (application.stage_state === "scheduled") return { reason: t("{value0}已安排 · 先完成这一轮", { value0: progress.stageLabel }), action: t("查看") };
  return { reason: `${progress.stageLabel} · ${progress.statusLabel}`, action: t("查看") };
}

// 05.2a 新建面试：没有可推进的流程时，说明原因并列出被排除的流程；唯一主按钮打开「新建求职流程」并带上时间
function ScheduleStageDialog({
  applications,
  excludedApplications,
  timezone,
  initialStartAt,
  initialEndAt,
  onApplicationChange,
  onCreateProcess,
  onClose,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  excludedApplications: JobApplicationSummary[];
  timezone: string;
  initialStartAt: string;
  initialEndAt: string;
  onApplicationChange: (application: JobApplicationSummary) => void;
  onCreateProcess: () => void;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const firstApplication = applications[0];
  if (!firstApplication) {
    const start = initialStartAt ? new Date(initialStartAt) : null;
    const end = initialEndAt ? new Date(initialEndAt) : null;
    const rangeLabel = start && Number.isFinite(start.getTime())
      ? `${weekday(start)} ${formatMonthDay(start)} · ${formatTime(start)}${end && Number.isFinite(end.getTime()) ? ` – ${formatTime(end)}` : ""}`
      : t("选择时间后再安排");
    return (
      <V3Dialog width={560} label={t("新建面试")} onClose={onClose} className="career-empty-stage-dialog">
        <div className="v3-dialog-body">
          <h2 className="v3-dialog-title">{t("新建面试")}</h2>
          <p className="v3-dialog-sub v3-num">{rangeLabel}</p>
          <div className="v3-stage has-dots career-dialog-stage"><NoStageArt /></div>
          <h3 className="career-empty-stage-title">{t("暂无可以推进的求职流程")}</h3>
          <p className="career-empty-stage-body">{t("只有已经投递、上一阶段已经结束的流程能在这里直接加一场。收到新岗位的面试通知？新建一个求职流程，这个时间会一起带过去。")}</p>
          {excludedApplications.length > 0 && (
            <>
              <p className="career-section-label">{t("这些流程现在还不能加")}</p>
              <div className="v3-gcard">
                {excludedApplications.slice(0, 4).map((item) => {
                  const block = stageBlockReason(item);
                  return (
                    <div key={item.id} className="v3-grow career-excluded-row">
                      <span className="career-dot" data-tone={columnToneForApplication(item)} aria-hidden="true" />
                      <div className="v3-grow-copy">
                        <strong>{item.company_name_snapshot} · {item.job_title_snapshot}</strong>
                        <small>{block.reason}</small>
                      </div>
                      <button type="button" className="v3-link" onClick={() => { onClose(); navigateTo(careerApplicationPath(item.id)); }}>{block.action}<Icon name="chev" size={12} /></button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <DialogFooterV3 left={<button type="button" className="v3-link career-muted-link" onClick={onClose}>{t("我知道了")}</button>}>
          <button type="button" className="v3-btn v3-btn-dark" onClick={onCreateProcess}>{t("新建求职流程")}</button>
        </DialogFooterV3>
      </V3Dialog>
    );
  }
  return (
    <AddNextStageDialog
      application={firstApplication}
      applicationOptions={applications}
      timezone={timezone}
      initialStartAt={initialStartAt}
      initialEndAt={initialEndAt}
      includeOffer={false}
      title={t("新建面试")}
      description={t("选择已经完成上一阶段的求职流程，再填写下一阶段及排期信息。")}
      onApplicationChange={onApplicationChange}
      onClose={onClose}
      onChanged={onChanged}
      onNotice={onNotice}
    />
  );
}

// 删除岗位确认：岗位卡 + 红色垃圾桶角标（沿用 01.1j 删除确认的插图写法）
function DeleteRecordArt() {
  useLocale();
  return <DeleteSessionArt />;
}

// 04.1 状态变体②：四列空看板 + 飞入的岗位卡 + 插件角标
function EmptyBoardArt() {
  useLocale();
  return (
    <Centered width={544} height={216}>
      {[[t("待投递"), "var(--v3-fnt)"], [t("笔试"), "var(--v3-or)"], [t("面试中"), "var(--v3-bl)"], ["Offer", "var(--v3-gn)"]].map(([label, color], index) => (
        <span key={label} style={{ position: "absolute", left: 85 + index * 96, top: 24, width: 86, height: 168, border: "1px solid var(--v3-line)", borderRadius: 8, background: "#fbfbfa" }}>
          <span style={{ position: "absolute", left: 9, top: 12, width: 6, height: 6, borderRadius: 3, background: color }} />
          <span style={{ position: "absolute", left: 20, top: 8, color: "var(--v3-sub)", fontSize: 9.5, fontWeight: 500 }}>{label}</span>
          <span style={{ position: "absolute", left: 6, top: 32, width: 74, height: 44, border: "1px dashed var(--v3-fl)", borderRadius: 6 }} />
        </span>
      ))}
      <svg aria-hidden="true" style={{ position: "absolute", left: 175, top: 92 }} width={272} height={56} viewBox="0 0 272 56" fill="none">
        <path d="M0 0C80 10 200 30 272 56" stroke="var(--v3-fnt2)" strokeWidth="1.4" strokeDasharray="3 3" />
      </svg>
      <Paper x={95} y={54} w={120} h={54} r={8}>
        <span style={{ position: "absolute", left: 10, top: 9, color: "var(--v3-txt)", fontSize: 10, fontWeight: 500 }}>{t("美团 · Java 开发")}</span>
        <span style={{ position: "absolute", left: 10, top: 31, height: 14, borderRadius: 3, background: "var(--v3-field)", padding: "0 5px", color: "var(--v3-sub)", fontSize: 8, fontWeight: 500, lineHeight: "14px" }}>{t("校招")}</span>
        <span style={{ position: "absolute", left: 46, top: 36, width: 4, height: 4, borderRadius: 2, background: "var(--v3-rd)" }} />
        <span style={{ position: "absolute", left: 54, top: 32, color: "var(--v3-rd)", fontFamily: "var(--v3-num)", fontSize: 8 }}>{t("09-30 截止")}</span>
      </Paper>
      <span style={{ position: "absolute", left: 369, top: 146, display: "grid", width: 40, height: 40, placeItems: "center", borderRadius: 12, background: "var(--v3-dark)", color: "#fff" }}><Icon name="puzzle" size={18} /></span>
    </Centered>
  );
}

function columnToneForApplication(application: JobApplicationSummary): string {
  const key = projectApplicationProgress(application).columnKey;
  if (key === "assessment" || key === "written_test") return "orange";
  if (key === "interview") return "blue";
  if (key === "offer") return "green";
  return "muted";
}

// 05.2a 插图：一张虚线的空白日程卡 + 问号 + 三列看板里没有能往后推的卡片
function NoStageArt() {
  useLocale();
  return (
    <Centered width={496} height={120}>
      <span style={{ position: "absolute", left: 98, top: 26, width: 112, height: 64, border: "1px dashed var(--v3-fl)", borderRadius: 8, background: "#fff" }}>
        <Bar x={10} y={12} w={40} h={5} color="var(--v3-sk2)" r={2} />
        <Bar x={10} y={24} w={64} h={4} r={2} />
        <span style={{ position: "absolute", left: 10, top: 40, width: 70, height: 14, borderRadius: 3, background: "#f3f3f0", color: "var(--v3-fnt)", fontFamily: "var(--v3-num)", fontSize: 7.5, fontWeight: 500, lineHeight: "14px", paddingLeft: 5 }}>14:00 – 15:00</span>
      </span>
      <span style={{ position: "absolute", left: 198, top: 46, display: "grid", width: 24, height: 24, placeItems: "center", border: "1px solid var(--v3-cl)", borderRadius: 12, background: "#fff", color: "var(--v3-sub)", fontFamily: "var(--v3-num)", fontSize: 12, fontWeight: 600, boxShadow: "0 2px 6px rgb(0 0 0 / 6%)" }}>?</span>
      {[[t("待投递"), true], [t("等待结果"), true], ["Offer", false]].map(([label, filled], index) => (
        <span key={String(label)} style={{ position: "absolute", left: 242 + index * 58, top: 18, width: 52, height: 84, border: "1px solid var(--v3-line)", borderRadius: 6, background: "#fbfbfa" }}>
          <span style={{ position: "absolute", top: 6, left: 0, right: 0, color: "var(--v3-fnt)", fontSize: 8, fontWeight: 500, textAlign: "center" }}>{label}</span>
          {filled ? (
            <>
              <span style={{ position: "absolute", left: 4, top: 24, width: 44, height: 24, border: "1px solid var(--v3-cl)", borderRadius: 4, background: "#fff", opacity: 0.6 }} />
              <span style={{ position: "absolute", left: 4, top: 54, width: 44, height: 24, border: "1px solid var(--v3-cl)", borderRadius: 4, background: "#fff", opacity: 0.35 }} />
            </>
          ) : <span style={{ position: "absolute", left: 4, top: 24, width: 44, height: 24, border: "1px dashed var(--v3-fl)", borderRadius: 4 }} />}
        </span>
      ))}
    </Centered>
  );
}

function ApplicationsView({
  applications,
  hiddenColumnIds,
  groupByCategory,
  sessions,
  query,
  displayMode,
  sortMode,
  timezone,
  onCreate,
  onInstallPlugin,
  onImport,
  onChanged,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  hiddenColumnIds: ReadonlySet<string>;
  groupByCategory: boolean;
  sessions: InterviewSessionSummary[];
  query: string;
  displayMode: "board" | "list";
  sortMode: ApplicationSortMode;
  timezone: string;
  onCreate: () => void;
  onInstallPlugin: () => void;
  onImport: () => void;
  onChanged: () => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
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
  const [pendingDelete, setPendingDelete] = useState<JobApplicationSummary | null>(null);
  const [deletingApplicationId, setDeletingApplicationId] = useState<string | null>(null);
  const [dragRejectionNotice, setDragRejectionNotice] = useState<{ id: number; message: string } | null>(null);
  const dragRejectionNoticeIdRef = useRef(0);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  }, []);
  const dismissDragRejection = useCallback(() => setDragRejectionNotice(null), []);
  const showDragRejectionNotice = useCallback((message: string) => {
    dragRejectionNoticeIdRef.current += 1;
    setDragRejectionNotice({ id: dragRejectionNoticeIdRef.current, message });
  }, []);
  const currentStageSessionByApplicationId = new Map(
    applications.map((application) => [
      application.id,
      currentApplicationStageSession(application, sessions),
    ]),
  );
  const completedScheduleStartAtByApplicationId = new Map<string, string>();
  for (const [applicationId, session] of currentStageSessionByApplicationId) {
    if (session?.status === "completed") {
      completedScheduleStartAtByApplicationId.set(applicationId, session.start_at);
    }
  }
  const normalizedQuery = query.trim().toLowerCase();
  const visibleApplications = sortApplications(
    applications.filter((item) => !normalizedQuery
      || `${item.company_name_snapshot}${item.job_title_snapshot}${applicationProgressLabel(item, { now })}${applicationStatusLabel(item)}`
        .toLowerCase()
        .includes(normalizedQuery)),
    sortMode,
    completedScheduleStartAtByApplicationId,
  );
  const categories = [["internship", t("实习")], ["campus", t("校招")], ["full_time", t("正式")], ["", t("未分类")]] as const;
  const categoryKey = (item: JobApplicationSummary) => categories.some(([key]) => key === item.job_snapshot?.employment_type) ? String(item.job_snapshot?.employment_type ?? "") : "";
  const listGroups = groupByCategory
    ? categories.map(([key, label]) => ({ key, label, items: visibleApplications.filter((item) => categoryKey(item) === key) })).filter((group) => group.items.length)
    : [{ key: "all", label: "", items: visibleApplications }];
  const completedCurrentStageApplicationIds = new Set(
    completedScheduleStartAtByApplicationId.keys(),
  );
  const deleteEndedApplication = async () => {
    if (!pendingDelete) return;
    setDeletingApplicationId(pendingDelete.id);
    try {
      await api.deleteJobApplication(pendingDelete.id);
      setPendingDelete(null);
      await onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setDeletingApplicationId(null);
    }
  };
  // 看板 ⇄ 列表：只有这块区域横向滑入（看板在左、列表在右，方向与分段控件一致），页面其他部分不动
  const layoutMotionRef = useContentMotion<HTMLDivElement>(displayMode, { initial: false, from: displayMode === "list" ? "32px 0" : "-32px 0" });
  return (
    <div ref={layoutMotionRef} className={`career-applications-layout is-${displayMode}`}>
      {dragRejectionNotice && (
        <CareerNotice
          key={dragRejectionNotice.id}
          className="application-drag-rejection-notice"
          title={t("无法更新求职阶段")}
          message={dragRejectionNotice.message}
          onDismiss={dismissDragRejection}
        />
      )}
      <MotionPresence>{categoryApplication && <ApplicationCategoryDialog application={categoryApplication} onClose={() => setCategoryApplication(null)} onChanged={onChanged} />}</MotionPresence>
      <ApplicationsBoard
        groupByCategory={groupByCategory}
        hiddenColumnIds={hiddenColumnIds}
        onRequestCategory={setCategoryApplication}
        visibleApplications={visibleApplications}
        completedCurrentStageApplicationIds={completedCurrentStageApplicationIds}
        completedScheduleStartAtByApplicationId={completedScheduleStartAtByApplicationId}
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
        onRequestDelete={setPendingDelete}
      />
      <MotionPresence>{draggedPendingApplication && (
        <MarkApplicationAppliedDialog
          application={draggedPendingApplication.application}
          initialTargetColumnId={draggedPendingApplication.targetColumnId}
          timezone={timezone}
          onClose={() => setDraggedPendingApplication(null)}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}</MotionPresence>
      <MotionPresence>{draggedNextStage && (
        <AddNextStageDialog
          application={draggedNextStage.application}
          timezone={timezone}
          initialTab={draggedNextStage.prefill.initialTab}
          initialStage={draggedNextStage.prefill.initialStage}
          initialInterviewLabel={draggedNextStage.prefill.initialInterviewLabel}
          lockStageSelection={draggedNextStage.targetColumnId != null}
          onClose={() => setDraggedNextStage(null)}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}</MotionPresence>
      <MotionPresence>{pendingTermination && (
        <TerminateApplicationConfirmDialog
          application={pendingTermination}
          onClose={() => setPendingTermination(null)}
          onChanged={onChanged}
          onNotice={onNotice}
        />
      )}</MotionPresence>
      <MotionPresence>{pendingDelete && (
        <V3ConfirmDialog
          title={t("永久删除「{value0} · {value1}」？", { value0: pendingDelete.company_name_snapshot, value1: pendingDelete.job_title_snapshot })}
          description={t("删除后，该岗位及其求职进程、阶段、排期和复盘都将无法恢复；关联素材的原文件仍保留在资料库。")}
          art={<DeleteRecordArt />}
          confirmLabel={t("永久删除")}
          busyLabel={t("正在删除…")}
          busy={deletingApplicationId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={deleteEndedApplication}
        />
      )}</MotionPresence>
      {displayMode === "list" && visibleApplications.length ? (
        <div className={groupByCategory ? "career-application-list-groups is-grouped" : "career-application-list-groups"}>
        {listGroups.map((group) => <section key={group.key} className="career-application-list-group">
          {groupByCategory && <h2 className="career-application-list-group-title">{group.label}{" "}<span>{group.items.length}</span></h2>}
          <div className="interview-surface career-application-table-surface">
          <table className="career-application-table" aria-label={groupByCategory ? t("{value0}求职记录列表", { value0: group.label }) : t("求职记录列表")}>
            <thead>
              <tr>
                <th scope="col">{t("公司 / 岗位")}</th>
                {!groupByCategory && <th scope="col">{t("求职分类")}</th>}
                <th scope="col">{t("当前进度")}</th>
                <th scope="col">{t("最近安排")}</th>
                <th scope="col">{t("投递日期")}</th>
                <th scope="col">{t("更新时间")}</th>
              </tr>
            </thead>
            <tbody>
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
                    aria-label={t("查看 {value0} · {value1} 的求职记录详情", { value0: item.company_name_snapshot, value1: item.job_title_snapshot })}
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
                    <td><div className="career-application-progress-cell">
                      <span className={`career-application-progress ${applicationProgressToneClass(item, { now, currentStageCompleted })}`} aria-label={progressLabel}>
                        {progressLabel}
                      </span>
                    </div></td>
                    <td><span className="career-application-cell-text">{nextInterview ? `${formatApplicationSessionRange(nextInterview.start_at, nextInterview.end_at)} · ${nextInterview.stage_label}` : t("暂无安排")}</span></td>
                    <td>{item.applied_at ? <time dateTime={item.applied_at}>{formatApplicationUpdatedAt(item.applied_at)}</time> : t("未投递")}</td>
                    <td><time className="career-application-updated-at" dateTime={item.updated_at}>{formatApplicationUpdatedAt(item.updated_at)}</time></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>)}
        </div>
      ) : !visibleApplications.length ? (
        normalizedQuery ? (
          <section className="v3-empty career-board-empty is-search" aria-label={t("没有匹配的求职进程")}>
            <h3>{t("没有匹配的求职进程")}</h3>
            <p>{t("换个公司、职位或阶段关键词试试。")}</p>
          </section>
        ) : (
          <section className="v3-empty career-board-empty" aria-labelledby="career-board-empty-title">
            <div className="v3-stage has-dots"><EmptyBoardArt /></div>
            <h3 id="career-board-empty-title" role="heading" aria-level={2}>{t("还没有求职进程")}</h3>
            <p>{t("装上浏览器插件，在招聘网站上一键把岗位存进来；也可以粘贴岗位文字导入。")}</p>
            <div className="v3-empty-actions">
              <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={onInstallPlugin}><Icon name="puzzle" size={13} />{t("安装浏览器插件")}</button>
              <button type="button" className="v3-link" onClick={onImport}>{t("粘贴岗位文字导入")}</button>
              <button type="button" className="v3-link" onClick={onCreate}>{t("创建第一条求职进程")}</button>
            </div>
          </section>
        )
      ) : null}
    </div>
  );
}

function InterviewScheduleWeekView({ showAnswerPeriods }: { showAnswerPeriods: boolean }) {
  useLocale();
  return (
    <div className="interview-event-calendar-week" role="grid" aria-label={t("面试周排期，可拖动并按 15 分钟调整")}>
      <EventCalendarWeekView showAllDay={showAnswerPeriods} />
    </div>
  );
}

function InterviewScheduleMonthView() {
  useLocale();
  return (
    <div className="interview-event-calendar-month" role="grid" aria-label={t("月面试排期")}>
      <EventCalendarMonthView />
    </div>
  );
}

function formatChineseDateRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return t("{value0}年{value1}月{value2}日 – {value3}日", { value0: start.getFullYear(), value1: start.getMonth() + 1, value2: start.getDate(), value3: end.getDate() });
  }
  if (sameYear) {
    return t("{value0}年{value1}月{value2}日 – {value3}月{value4}日", { value0: start.getFullYear(), value1: start.getMonth() + 1, value2: start.getDate(), value3: end.getMonth() + 1, value4: end.getDate() });
  }
  return t("{value0}年{value1}月{value2}日 – {value3}年{value4}月{value5}日", { value0: start.getFullYear(), value1: start.getMonth() + 1, value2: start.getDate(), value3: end.getFullYear(), value4: end.getMonth() + 1, value5: end.getDate() });
}

function scheduleToolbarTitle(view: ScheduleGranularity, anchor: Date, weekStart: Date, monthStart: Date): string {
  if (view === "month") return formatMonth(monthStart);
  if (view === "week") return formatChineseDateRange(weekStart, addDays(weekStart, 6));
  if (view === "days") return formatChineseDateRange(anchor, addDays(anchor, 4));
  if (view === "agenda") return formatChineseDateRange(anchor, addDays(anchor, 29));
  return t("{value0}年{value1}", { value0: anchor.getFullYear(), value1: formatDate(anchor) });
}

function renderInterviewCalendarEvent({
  occurrence,
  view,
  isSelected,
}: EventCalendarRenderEventProps<Interview | null>) {
  const interview = occurrence.event.data;
  const visibleStart = formatTime(occurrence.start);
  const visibleEnd = formatTime(occurrence.end);
  if (occurrence.event.id === "interview-open-window-more") {
    return <span className="interview-calendar-window-more">{occurrence.event.title}</span>;
  }
  if (!interview) {
    return (
      <span className="interview-calendar-event-content is-draft">
        <strong className="interview-calendar-event-title">{t("新面试")}</strong>
        <span className="interview-calendar-event-time v3-num"><Icon name="clock" size={10} />{visibleStart}–{visibleEnd}</span>
      </span>
    );
  }
  if (interview.calendarRole === "open_window") {
    // 周视图顶部「全天」行：左侧色条 + 「公司 阶段」（设计稿 05.2 All-day）
    return (
      <span className="interview-calendar-event-content interview-calendar-open-window-content">
        <strong className="interview-calendar-event-title">{interview.company} {interview.stage}{t("开放")}</strong>
        <span className="interview-calendar-window-range">{interview.date} {interview.time} – {formatDate(new Date(interview.endAt))} {interview.endTime}</span>
        <em className="interview-calendar-window-status">{interview.status === "completed" ? t("已完成") : interview.status === "cancelled" ? t("已取消") : t("待完成")}</em>
      </span>
    );
  }
  if (view === "month") {
    // 月视图：灰底胶囊 + 彩色圆点 + 「公司 阶段」；今天的安排用蓝底并带时间（设计稿 05.1）
    return (
      <span className={`interview-calendar-event-content is-month${isSelected ? " is-selected" : ""}`}>
        <strong className="interview-calendar-event-title">{interview.company}</strong>
        <span className="interview-calendar-event-stage-inline">{interview.stage}</span>
        <span className="interview-calendar-event-time v3-num"><Icon name="clock" size={10} />{visibleStart}–{visibleEnd}</span>
      </span>
    );
  }
  return (
    <span className="interview-calendar-event-content interview-calendar-event-stack">
      <span className="interview-calendar-event-time v3-num"><Icon name="clock" size={10} />{visibleStart}–{visibleEnd}</span>
      <strong className="interview-calendar-event-title">{interview.company} · {interview.stage}</strong>
      <span className="interview-calendar-event-meta">{interview.meetingLabel}</span>
    </span>
  );
}

// 05.1 / 05.2 页头文案：月视图「2026 年 9 月」，周视图「9 月 21 日 – 27 日」
function scheduleHeadTitle(view: ScheduleGranularity, anchor: Date, weekStart: Date, monthStart: Date): string {
  if (view === "month") return t("{value0} 年 {value1} 月", { value0: monthStart.getFullYear(), value1: monthStart.getMonth() + 1 });
  const start = view === "week" ? weekStart : anchor;
  const end = view === "week" ? addDays(weekStart, 6) : view === "days" ? addDays(anchor, 4) : view === "agenda" ? addDays(anchor, 29) : anchor;
  if (start.getTime() === end.getTime()) return t("{value0} 月 {value1} 日", { value0: start.getMonth() + 1, value1: start.getDate() });
  return start.getMonth() === end.getMonth()
    ? t("{value0} 月 {value1} 日 – {value2} 日", { value0: start.getMonth() + 1, value1: start.getDate(), value2: end.getDate() })
    : t("{value0} 月 {value1} 日 – {value2} 月 {value3} 日", { value0: start.getMonth() + 1, value1: start.getDate(), value2: end.getMonth() + 1, value3: end.getDate() });
}

function ScheduleView({
  interviews,
  detail,
  detailLoading,
  query,
  granularity,
  anchor,
  weekStart,
  monthStart,
  timezone,
  draftStartAt,
  draftEndAt,
  draftColor,
  onCreate,
  onDateChange,
  onGranularityChange,
  onSelect,
  onMove,
  onAnswerPlanMove,
  onAnswerPlanChange,
}: {
  interviews: Interview[];
  detail: InterviewSessionDetail | null;
  detailLoading: boolean;
  query: string;
  granularity: ScheduleGranularity;
  anchor: Date;
  weekStart: Date;
  monthStart: Date;
  timezone: string;
  draftStartAt: string | null;
  draftEndAt: string | null;
  draftColor: InterviewCalendarColor;
  onCreate: (startAt?: string, endAt?: string) => void;
  onDateChange: (date: Date) => void;
  onGranularityChange: (value: ScheduleGranularity) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, calendarDay: number, calendarStart: number, calendarSpan?: number) => void;
  onAnswerPlanMove: (id: string, startAt: Date, endAt: Date) => void;
  onAnswerPlanChange: (id: string, startAt: Date | null, durationMinutes: number | null) => void;
}) {
  useLocale();
  const [openInterviewId, setOpenInterviewId] = useState<string | null>(null);
  // 上一段 / 下一段：日历沿时间方向横向滑入（像系统日历那样）；月 / 周切换按分段控件的左右位置滑入（月在左、周在右）
  const previousAnchorRef = useRef(anchor.getTime());
  const previousGranularityRef = useRef(granularity);
  const calendarMotionFrom = previousGranularityRef.current !== granularity
    ? (granularity === "week" ? "24px 0" : "-24px 0")
    : anchor.getTime() > previousAnchorRef.current ? "24px 0" : anchor.getTime() < previousAnchorRef.current ? "-24px 0" : "0 0";
  useEffect(() => {
    previousAnchorRef.current = anchor.getTime();
    previousGranularityRef.current = granularity;
  }, [anchor, granularity]);
  const calendarMotionRef = useContentMotion<HTMLElement>(`${granularity}:${anchor.getTime()}`, { from: calendarMotionFrom, initial: false, selector: '[data-slot="event-calendar-content"]' });
  const [showAllOpenWindows, setShowAllOpenWindows] = useState(false);
  const [localQuery, setLocalQuery] = useState(query);
  const calendarApiRef = useRef<EventCalendarApi<Interview | null> | null>(null);
  const calendarRootRef = useRef<HTMLDivElement | null>(null);
  const hasCalendarSelectionRef = useRef(false);
  // 跳转到任意日期：标题做成按钮，打开月历；月视图里点日期数字切到那一周
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const closeDatePicker = useCallback(() => setDatePickerOpen(false), []);
  const jumpTo = (day: Date) => {
    setDatePickerOpen(false);
    onDateChange(granularity === "month" ? startOfMonth(day) : startOfWeek(day));
  };
  const openWeekOf = (day: Date) => {
    onGranularityChange("week");
    onDateChange(startOfWeek(day));
  };
  const normalizedQuery = (localQuery || query).trim().toLowerCase();
  const sourceInterviews = interviews;
  const visibleInterviews = useMemo(
    () => sourceInterviews.filter((item) => !normalizedQuery || `${item.company}${item.role}${item.stage}`.toLowerCase().includes(normalizedQuery)),
    [normalizedQuery, sourceInterviews],
  );
  const hasAnswerPeriodsInCurrentWeek = useMemo(() => {
    const weekEnd = addDays(weekStart, 7);
    return visibleInterviews.some((interview) => (
      interview.scheduleKind === "open_window"
      && new Date(interview.startAt) < weekEnd
      && new Date(interview.endAt) > weekStart
    ));
  }, [visibleInterviews, weekStart]);
  const dialogInterview = openInterviewId
    ? sourceInterviews.find((item) => item.id === openInterviewId) ?? null
    : null;
  const handleSelect = (id: string) => {
    onSelect(id);
  };
  const handleOpen = (id: string) => {
    setOpenInterviewId(id);
    onSelect(id);
  };
  const handleMove = (id: string, calendarDay: number, calendarStart: number, calendarSpan?: number) => {
    onMove(id, calendarDay, calendarStart, calendarSpan);
  };
  useEffect(() => {
    const clearSelectionOutsideEvent = (event: MouseEvent) => {
      if (!hasCalendarSelectionRef.current) return;
      const target = event.target;
      const eventCard = target instanceof Element
        ? target.closest('[data-slot="event-calendar-event"]')
        : null;
      if (eventCard && calendarRootRef.current?.contains(eventCard)) return;
      calendarApiRef.current?.clearSelection();
    };
    document.addEventListener("click", clearSelectionOutsideEvent, true);
    return () => document.removeEventListener("click", clearSelectionOutsideEvent, true);
  }, []);
  const calendarEvents = useMemo<CalendarEvent<Interview | null>[]>(() => {
    const monthFallbackColors: InterviewCalendarColor[] = ["red", "orange", "green", "blue", "purple"];
    const weekEnd = addDays(weekStart, 7);
    const openWindows = visibleInterviews
      .filter((interview) => (
        interview.scheduleKind === "open_window"
        && (granularity !== "week" || (
          new Date(interview.startAt) < weekEnd
          && new Date(interview.endAt) > weekStart
        ))
      ))
      .sort((left, right) => new Date(left.endAt).getTime() - new Date(right.endAt).getTime());
    const visibleOpenWindows = granularity === "week" && !showAllOpenWindows
      ? openWindows.slice(0, 3)
      : openWindows;
    const hiddenOpenWindowCount = openWindows.length - visibleOpenWindows.length;
    const fixedInterviews = visibleInterviews.filter((interview) => interview.scheduleKind === "fixed_slot");
    const fixedEvents = fixedInterviews.map((interview) => {
      const hash = Array.from(interview.id).reduce((total, character) => total + character.charCodeAt(0), 0);
      const color = granularity === "month" && interview.color === "gray"
        ? monthFallbackColors[hash % monthFallbackColors.length]
        : interview.color;
      return {
        id: interview.id,
        title: `${interview.company} ${interview.role} ${interview.stage}`,
        start: new Date(interview.startAt),
        end: new Date(interview.endAt),
        color: INTERVIEW_CALENDAR_COLORS[color],
        readOnly: !interview.canReschedule,
        draggable: interview.canReschedule,
        resizable: interview.canReschedule,
        data: interview,
      };
    });
    const windowEvents = visibleOpenWindows.map((interview) => {
      const actualStart = new Date(interview.startAt);
      const actualEnd = new Date(interview.endAt);
      const start = new Date(actualStart);
      start.setHours(0, 0, 0, 0);
      const end = new Date(actualEnd);
      if (end.getHours() !== 0 || end.getMinutes() !== 0 || end.getSeconds() !== 0 || end.getMilliseconds() !== 0) {
        end.setDate(end.getDate() + 1);
      }
      end.setHours(0, 0, 0, 0);
      return {
        id: `open-window:${interview.id}`,
        title: `${interview.company} ${interview.role} ${interview.stage}`,
        start,
        end,
        allDay: true,
        color: INTERVIEW_CALENDAR_COLORS[interview.color],
        readOnly: true,
        draggable: false,
        resizable: false,
        data: { ...interview, calendarRole: "open_window" as const },
      };
    });
    const answerPlanEvents = visibleInterviews.flatMap((interview) => (
      interview.scheduleKind === "open_window" && interview.answerPlanStartAt && interview.answerPlanEndAt
        ? [{
            id: `answer-plan:${interview.id}`,
            title: `${interview.company} ${interview.role} ${interview.stage}`,
            start: new Date(interview.answerPlanStartAt),
            end: new Date(interview.answerPlanEndAt),
            color: INTERVIEW_CALENDAR_COLORS[interview.color],
            readOnly: !interview.canReschedule,
            draggable: interview.canReschedule,
            resizable: interview.canReschedule,
            data: { ...interview, calendarRole: "answer_plan" as const },
          }]
        : []
    ));
    const disclosureEvents: CalendarEvent<Interview | null>[] = granularity === "week" && (hiddenOpenWindowCount > 0 || showAllOpenWindows && openWindows.length > 3)
      ? [{
          id: "interview-open-window-more",
          title: hiddenOpenWindowCount > 0 ? t("还有 {value0} 项待完成 · 展开查看", { value0: hiddenOpenWindowCount }) : t("收起更多项目"),
          start: new Date(weekStart),
          end: addDays(weekStart, 7),
          allDay: true,
          color: "#eef1f5",
          priority: -100,
          readOnly: true,
          draggable: false,
          resizable: false,
          data: null,
        }]
      : [];
    const events = [...windowEvents, ...disclosureEvents, ...fixedEvents, ...answerPlanEvents];
    if (!draftStartAt) return events;
    const start = new Date(draftStartAt);
    if (!Number.isFinite(start.getTime())) return events;
    const requestedEnd = draftEndAt ? new Date(draftEndAt) : null;
    const end = requestedEnd && Number.isFinite(requestedEnd.getTime()) && requestedEnd > start
      ? requestedEnd
      : new Date(start.getTime() + 30 * 60 * 1000);
    return [
      ...events,
      {
        id: "interview-calendar-draft",
        title: t("新面试"),
        start,
        end,
        color: INTERVIEW_CALENDAR_COLORS[draftColor],
        readOnly: true,
        draggable: false,
        resizable: false,
        data: null,
      },
    ];
  }, [draftColor, draftEndAt, draftStartAt, granularity, showAllOpenWindows, visibleInterviews, weekStart, getLocale()]);
  const updateCalendarEvent = (update: EventCalendarProposedUpdate<Interview | null>) => {
    const interview = update.event.data;
    if (!interview?.canReschedule || update.allDay) return false;
    if (interview.calendarRole === "answer_plan") {
      onAnswerPlanMove(interview.id, update.start, update.end);
      return true;
    }
    if (interview.scheduleKind === "open_window") return false;
    const startDay = new Date(update.start);
    startDay.setHours(0, 0, 0, 0);
    const calendarDay = Math.round((startDay.getTime() - weekStart.getTime()) / 86_400_000);
    const calendarStart = update.start.getHours() * 2 + update.start.getMinutes() / 30;
    const calendarSpan = (update.end.getTime() - update.start.getTime()) / 1_800_000;
    handleMove(interview.id, calendarDay, calendarStart, calendarSpan);
    return true;
  };
  const createAt = (start: Date, end: Date) => onCreate(localDateTimeValue(start), localDateTimeValue(end));
  const calendarComponents = useMemo(
    () => ({
      week: () => <InterviewScheduleWeekView showAnswerPeriods={hasAnswerPeriodsInCurrentWeek} />,
      month: InterviewScheduleMonthView,
    }),
    [hasAnswerPeriodsInCurrentWeek],
  );
  const calendarInteractions = useMemo(() => ({ drag: true, resize: true, selectSlot: true }), []);
  const calendarViewSettings = useMemo(() => ({
    weekends: true,
    weekNumbers: false,
    nowIndicator: true,
    offDays: false,
  }), []);
  const calendarViews = useMemo<CalendarView[]>(
    () => ["month", "week"],
    [],
  );
  // 周视图打开时从 8:00 开始显示；这一周有更早的安排时，从最早那场所在的整点开始。
  // 只改初始滚动位置、不裁掉 0–8 点：往上滚仍能看到并拖动更早的时段，拖拽换算也保持以 0 点为基准
  const weekDayStartHour = useMemo(() => {
    const weekEnd = addDays(weekStart, 7);
    const earliest = visibleInterviews
      .filter((item) => item.scheduleKind === "fixed_slot" && new Date(item.startAt) >= weekStart && new Date(item.startAt) < weekEnd)
      .reduce((hour, item) => Math.min(hour, new Date(item.startAt).getHours()), 8);
    return Math.max(0, earliest);
  }, [visibleInterviews, weekStart]);
  const toolbarTitle = scheduleToolbarTitle(granularity, anchor, weekStart, monthStart);
  // 页头副标题：本月 / 本周日程数 + 今天的面试数
  const rangeStart = granularity === "month" ? monthStart : weekStart;
  const rangeEnd = granularity === "month" ? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1) : addDays(weekStart, 7);
  const now = new Date();
  const inRange = visibleInterviews.filter((item) => item.status !== "cancelled" && new Date(item.startAt) < rangeEnd && new Date(item.endAt) > rangeStart);
  const todayCount = visibleInterviews.filter((item) => item.status !== "cancelled" && item.scheduleKind === "fixed_slot" && new Date(item.startAt).toDateString() === now.toDateString()).length;
  const subtitle = t("{value0} {value1} 个日程{value2}", { value0: granularity === "month" ? t("本月") : t("本周"), value1: inRange.length, value2: todayCount ? t(" · 今天 {value0} 场面试", { value0: todayCount }) : "" });
  // 「接下来」：未来（或正在进行）的 3 条安排
  const upcoming = visibleInterviews
    .filter((item) => item.status === "upcoming" || item.status === "active")
    .sort((left, right) => new Date(left.scheduleKind === "open_window" ? left.endAt : left.startAt).getTime() - new Date(right.scheduleKind === "open_window" ? right.endAt : right.startAt).getTime())
    .slice(0, 3);
  return (
    <div className="interview-schedule-layout career-schedule-v3">
      <p id="schedule-drag-instructions" className="visually-hidden">{t("双击空白时间新建排期；按住空白时间拖动可选择范围。按住卡片可在当天移动排期，拖动上边缘调整开始时间，下边缘调整结束时间，以 15 分钟为步长调整。")}</p>
      <section
        ref={calendarMotionRef}
        className="schedule-calendar-panel"
        // 月历行数随月份变化（2026 年 8 月 1 日是周六、31 日是周一，要排 6 行）；CSS 按这个变量均分行高
        style={{ ["--career-month-rows" as string]: String(monthWeekRows(monthStart)) }}
        onClick={(event) => {
          if (granularity !== "month") return;
          const target = event.target instanceof Element ? event.target.closest('[data-slot="event-calendar-month-day-number"]') : null;
          if (!target) return;
          const numbers = Array.from(event.currentTarget.querySelectorAll('[data-slot="event-calendar-month-day-number"]'));
          const index = numbers.indexOf(target);
          if (index < 0) return;
          event.stopPropagation();
          openWeekOf(addDays(startOfWeek(monthStart), index));
        }}
      >
        <EventCalendar<Interview | null>
          ref={calendarRootRef}
          apiRef={calendarApiRef}
          className="career-reui-calendar"
          events={calendarEvents}
          view={granularity}
          date={granularity === "week" ? weekStart : granularity === "month" ? monthStart : anchor}
          onDateChange={onDateChange}
          onViewChange={(nextView) => {
            onGranularityChange(nextView);
          }}
          views={calendarViews}
          locale={getLocale() === "en-US" ? enUS : zhCN}
          i18n={INTERVIEW_CALENDAR_I18N}
          timeZone={timezone}
          weekStartsOn={1}
          dayStartHour={0}
          dayEndHour={24}
          slotDuration={30}
          snapDuration={15}
          interval={60}
          // 组件会在目标刻度上方多留 12px；补回这 12px，让起始刻度线正好贴着表头，不再露出一截空白
          scrollToHour={weekDayStartHour + 12 / 56}
          fixedWeeks={false}
          showOutsideDays
          interactions={calendarInteractions}
          viewSettings={calendarViewSettings}
          components={calendarComponents}
          renderEvent={renderInterviewCalendarEvent}
          renderDayHeader={({ day, view: headerView, isToday }) => headerView === "month"
            ? <span className="interview-calendar-day-header">{weekdayName(day)}</span>
            : (
              <span className={`interview-calendar-day-header is-week${isToday ? " is-today" : ""}`}>
                <small>{weekdayName(day)}</small>
                <strong className="v3-num">{day.getDate()}</strong>
              </span>
            )}
          canDropEvent={(update) => !update.allDay && update.event.data?.canReschedule === true}
          onEventUpdate={updateCalendarEvent}
          onEventClick={(occurrence) => {
            if (occurrence.event.id === "interview-open-window-more") {
              setShowAllOpenWindows((current) => !current);
              return;
            }
            if (occurrence.event.data) handleSelect(occurrence.event.data.id);
          }}
          onEventDoubleClick={(occurrence) => {
            if (occurrence.event.data) handleOpen(occurrence.event.data.id);
          }}
          onSelectionChange={(selection) => {
            hasCalendarSelectionRef.current = selection.eventKeys.length > 0 || selection.slot !== null;
          }}
          onSlotDoubleClick={(slot) => createAt(
            slot.date,
            slot.allDay || !slot.end ? new Date(slot.date.getTime() + 30 * 60 * 1000) : slot.end,
          )}
          onSelectSlot={(slot) => createAt(
            slot.start,
            slot.allDay ? new Date(slot.start.getTime() + 30 * 60 * 1000) : slot.end,
          )}
          classNames={{
            event: "interview-calendar-event",
            timedChip: "interview-calendar-timed-event",
            monthBar: "interview-calendar-month-event",
            moreIndicator: "interview-calendar-more-indicator",
            morePopover: "interview-calendar-more-popover",
            morePopoverHeader: "interview-calendar-more-popover-header",
            resizeHandle: "interview-calendar-resize-handle",
            resizeGrip: "interview-calendar-resize-grip",
            viewSwitcherContent: "interview-calendar-view-menu",
            viewSwitcherLabel: "interview-calendar-view-menu-label",
            viewShortcut: "interview-calendar-view-shortcut",
          }}
        >
          {/* 05.1 / 05.2 页头：左侧 SCHEDULE 小字 + 衬线月份 / 周范围 + 副标题；右侧 月/周 切换、上一段 / 今天 / 下一段 */}
          <header className="career-v3-head career-schedule-head">
            <div className="career-v3-head-copy">
              <PageEyebrow segments={["SCHEDULE", t("{value0} 年", { value0: (granularity === "month" ? monthStart : weekStart).getFullYear() }), granularity === "month" ? t("月视图") : t("周视图")]} />
              <h1 className="v3-page-title">
                <button
                  ref={titleButtonRef}
                  type="button"
                  className="career-schedule-title-btn"
                  aria-haspopup="dialog"
                  aria-expanded={datePickerOpen}
                  aria-label={t("{value0}，选择其他日期", { value0: scheduleHeadTitle(granularity, anchor, weekStart, monthStart) })}
                  onClick={() => setDatePickerOpen((open) => !open)}
                >
                  {scheduleHeadTitle(granularity, anchor, weekStart, monthStart)}
                  <Icon name="chevd" size={14} />
                </button>
              </h1>
              <Popover anchorRef={titleButtonRef} open={datePickerOpen} onClose={closeDatePicker} className="v3-picker" label={granularity === "month" ? t("选择月份") : t("选择周")} placement="bottom-start">
                {/* 选择器跟随当前时间维度：月视图选月份，周视图整行选一周 */}
                {granularity === "month"
                  ? <MonthCalendar value={monthStart} onPick={jumpTo} />
                  : <WeekCalendar value={weekStart} onPick={jumpTo} />}
              </Popover>
              <p className="v3-page-sub">{subtitle}</p>
            </div>
            <EventCalendarNav className="interview-calendar-nav">
              <div className="v3-seg interview-calendar-seg" role="group" aria-label={t("日程视图")}>
                <button type="button" aria-pressed={granularity === "month"} onClick={() => onGranularityChange("month")}>{t("月")}</button>
                <button type="button" aria-pressed={granularity === "week"} onClick={() => onGranularityChange("week")}>{t("周")}</button>
              </div>
              <div className="interview-calendar-nav-arrows">
                <EventCalendarNavPrev tooltip={null} />
                <EventCalendarNavToday tooltip={null}>{t("今天")}</EventCalendarNavToday>
                <EventCalendarNavNext tooltip={null} />
              </div>
              <EventCalendarTitle className="interview-calendar-title visually-hidden" format={() => toolbarTitle} />
            </EventCalendarNav>
          </header>
          <EventCalendarContent />
        </EventCalendar>
      </section>
      {/* 「接下来」始终占位：没有安排时显示一句提示，日历高度不因此变化 */}
      <section className="career-upcoming" aria-label={t("接下来")}>
        <p className="career-section-label">{t("接下来")}</p>
        {upcoming.length === 0 ? (
          <div className="career-upcoming-empty">
            <p>{t("接下来没有安排的面试或笔试")}</p>
            <small>{t("收到面试通知后，可以点右上角「新建面试」，或在日历空白处双击添加")}</small>
          </div>
        ) : (
          <ul>
            {upcoming.map((item) => {
              const start = new Date(item.scheduleKind === "open_window" ? item.endAt : item.startAt);
              const isToday = start.toDateString() === now.toDateString();
              const timeLabel = `${isToday ? t("今天") : formatMonthDay(start)} ${formatTime(start)}`;
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => handleOpen(item.id)} aria-label={`${item.stage}｜${item.company}，${timeLabel}`}>
                    <span className="career-dot" data-tone={item.scheduleKind === "open_window" ? "red" : "blue"} aria-hidden="true" />
                    <span className="career-upcoming-time v3-num">{timeLabel}</span>
                    <strong>{item.company} · {item.role} {item.stage}</strong>
                    <span className="career-upcoming-meta">{item.meetingLabel}</span>
                    <span className="career-upcoming-state">
                      {item.scheduleKind === "open_window" ? (item.status === "active" ? t("待完成") : t("未开始")) : isToday ? (item.prepTotal > 0 ? <>{t("准备清单")} {item.prepDone}/{item.prepTotal}</> : t("未生成准备清单")) : MOCK_SESSION_CONFIRMED ? <>{t("已确认")}<BeTag /></> : t("待确认")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <MotionPresence>{dialogInterview && (
        <InterviewScheduleDialog
          interview={dialogInterview}
          detail={detail}
          detailLoading={detailLoading}
          onClose={() => setOpenInterviewId(null)}
          onAnswerPlanChange={onAnswerPlanChange}
        />
      )}</MotionPresence>
    </div>
  );
}

// 05.2b–05.2i 日程详情弹窗：衬线标题「公司 · 阶段」+ 状态胶囊、插图舞台、收纳卡片、截止前完成多一张「我的作答计划」
function InterviewScheduleDialog({ interview, detail, detailLoading, onClose, onAnswerPlanChange }: { interview: Interview; detail: InterviewSessionDetail | null; detailLoading: boolean; onClose: () => void; onAnswerPlanChange: (id: string, startAt: Date | null, durationMinutes: number | null) => void }) {
  useLocale();
  const matchingDetail = detail?.session.id === interview.id ? detail : null;
  const meetingUrl = matchingDetail?.session.meeting_url ?? null;
  const location = matchingDetail?.session.location ?? null;
  const cancellationReason = matchingDetail?.session.cancellation_reason ?? null;
  const [planStart, setPlanStart] = useState<Date | null>(() => interview.answerPlanStartAt ? new Date(interview.answerPlanStartAt) : null);
  const [planDurationMinutes, setPlanDurationMinutes] = useState(() => interview.answerPlanStartAt && interview.answerPlanEndAt
    ? Math.max(1, Math.round((new Date(interview.answerPlanEndAt).getTime() - new Date(interview.answerPlanStartAt).getTime()) / 60_000))
    : 120);
  const [planError, setPlanError] = useState<string | null>(null);
  const isWindow = interview.scheduleKind === "open_window";
  const savePlan = () => {
    if (!interview.canReschedule) return;
    if (!planStart) {
      setPlanError(null);
      onAnswerPlanChange(interview.id, null, null);
      return;
    }
    const end = new Date(planStart.getTime() + planDurationMinutes * 60_000);
    const windowStart = new Date(interview.startAt);
    const windowEnd = new Date(interview.endAt);
    if (!Number.isFinite(planStart.getTime()) || !Number.isInteger(planDurationMinutes) || planDurationMinutes <= 0) {
      setPlanError(t("请选择完整且有效的作答时间段。"));
      return;
    }
    if (planStart < windowStart || end > windowEnd) {
      setPlanError(t("作答计划必须完整落在官方开放时间内。"));
      return;
    }
    setPlanError(null);
    onAnswerPlanChange(interview.id, planStart, planDurationMinutes);
  };
  const start = new Date(interview.startAt);
  const end = new Date(interview.endAt);
  const stageText = `${interview.stage}`;
  const isExam = /笔试/.test(stageText);
  const isTest = /测评/.test(stageText);
  const isAi = /AI/i.test(stageText);
  const status = interview.status === "completed"
    ? { label: t("已完成"), tone: "green" }
    : interview.status === "cancelled"
      ? { label: t("已取消"), tone: "gray" }
      : isWindow
        ? { label: t("待完成"), tone: "orange" }
        : interview.status === "active"
          ? { label: t("进行中"), tone: "blue" }
          : { label: isExam || isAi ? t("待参加") : t("待面试"), tone: "blue" };
  const artKind: ScheduleArtKind = interview.status === "cancelled"
    ? "cancel"
    : interview.status === "completed"
      ? "done"
      : isWindow
        ? isTest ? "test" : "window"
        : isAi ? "ai" : isExam ? "exam" : interview.modeCode === "onsite" ? "onsite" : "video";
  const artDate = {
    month: t("{value0} 月", { value0: start.getMonth() + 1 }),
    day: String(start.getDate()).padStart(2, "0"),
    sub: isWindow ? t("{value0} 截止", { value0: formatTime(end) }) : `${interview.weekday} ${interview.time}`,
  };
  const nowTime = Date.now();
  const totalWindow = end.getTime() - start.getTime();
  const windowInfo = isWindow ? {
    open: t("{value0} 开放", { value0: formatMonthDay(start) }),
    close: t("{value0} 截止", { value0: formatMonthDay(end) }),
    remain: end.getTime() > nowTime ? t("还剩 {value0} 天", { value0: Math.max(1, Math.ceil((end.getTime() - nowTime) / 86_400_000)) }) : t("已截止"),
    todayRatio: Math.min(1, Math.max(0, (nowTime - start.getTime()) / Math.max(1, totalWindow))),
    planRatio: planStart ? Math.min(1, Math.max(0, (planStart.getTime() - start.getTime()) / Math.max(1, totalWindow))) : null,
  } : undefined;
  const untilStart = start.getTime() - nowTime;
  const relative = interview.status === "upcoming" && !isWindow && untilStart > 0
    ? untilStart < 86_400_000
      ? t(" · 还有 {value0} 小时 {value1} 分", { value0: Math.floor(untilStart / 3_600_000), value1: Math.floor((untilStart % 3_600_000) / 60_000) })
      : t(" · {value0} 天后", { value0: Math.ceil(untilStart / 86_400_000) })
    : isWindow && (interview.status === "upcoming" || interview.status === "active") ? t(" · 截止前任选时间完成") : "";
  const kindWord = isExam ? t("笔试") : isTest ? t("测评") : t("面试");
  const rows: Array<{ icon: V3IconName; label: string; value: ReactNode; strong?: boolean; muted?: boolean }> = [
    isWindow
      ? { icon: "cal", label: t("官方时段"), value: `${formatMonthDay(start)} ${interview.time} – ${formatMonthDay(end)} ${interview.endTime}`, strong: true }
      : { icon: "clock", label: interview.status === "cancelled" ? t("原定时间") : t("时间"), value: `${interview.date}（${interview.weekday}） ${interview.time} – ${interview.endTime}`, strong: interview.status !== "cancelled" },
    { icon: "user", label: isExam || isTest ? t("联系人") : t("面试官"), value: interview.interviewer, muted: interview.interviewer === "暂未填写" },
    { icon: "play", label: t("形式"), value: matchingDetail ? modeLabel(matchingDetail.session.mode) : interview.mode },
  ];
  if (location) rows.push({ icon: "pin", label: t("地点"), value: location });
  if (meetingUrl) rows.push({ icon: "link", label: t("{value0}链接", { value0: kindWord === t("面试") ? t("会议") : kindWord }), value: <a className="career-link v3-num" href={meetingUrl} target="_blank" rel="noreferrer">{meetingUrl}<Icon name="link" size={12} /></a> });
  if (interview.status === "cancelled" && cancellationReason) rows.push({ icon: "text", label: t("取消原因"), value: cancellationReason });
  const primary = interview.status === "upcoming" || interview.status === "active"
    ? isWindow && interview.canReschedule
      ? { label: t("保存作答计划"), onClick: savePlan }
      : meetingUrl
        ? { label: isExam ? t("进入笔试") : isAi ? t("进入 AI 面试") : t("进入会议"), href: meetingUrl }
        : null
    : null;
  const openRecord = () => {
    onClose();
    navigateTo(careerApplicationPath(interview.applicationId));
  };
  return (
    <V3Dialog width={520} label={t("面试详情")} onClose={onClose} className="career-schedule-detail">
      <div className="v3-dialog-body">
        <div className="career-schedule-detail-title">
          <h2 className="v3-dialog-title">{interview.company} · {interview.stage}</h2>
          <span className={`v3-pill career-pill is-${status.tone}`}>{status.label}</span>
        </div>
        <p className="v3-dialog-sub"><span>{interview.role}</span>{relative}</p>
        {detailLoading && <p className="career-dialog-loading" role="status">{t("正在加载完整面试详情…")}</p>}
        <div className="v3-stage has-dots career-dialog-stage is-schedule"><ScheduleArt kind={artKind} date={artDate} windowInfo={windowInfo} /></div>
        <dl className="v3-gcard career-detail-rows">
          {rows.map((row) => (
            <div key={row.label} className="v3-grow career-detail-row">
              <dt><Icon name={row.icon} size={14} />{row.label}</dt>
              <dd className={`${row.strong ? "is-strong" : ""}${row.muted ? " is-muted" : ""}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
        {isWindow && (
          <section className="v3-gcard career-answer-plan" aria-label={t("我的作答计划")}>
            <div className="v3-grow career-answer-plan-row">
              <div className="v3-grow-copy">
                <strong>{t("我的作答计划")}</strong>
                <small>{t("仅作为个人时间安排，不会改变官方截止时间。")}</small>
              </div>
              <div className="v3-grow-right career-answer-plan-fields">
                <div className="career-answer-plan-field is-start">
                  {interview.canReschedule ? (
                    <DateTimeField
                      value={planStart}
                      label={t("计划作答时间")}
                      placeholder={t("选择开始时间")}
                      size="sm"
                      filled
                      icon={null}
                      min={new Date(interview.startAt)}
                      onChange={(value) => { setPlanStart(value); setPlanError(null); }}
                    />
                  ) : (
                    // 已完成 / 已归档：只读展示，不能再改计划（DateTimeField 没有 disabled，这里用同款样式的禁用按钮）
                    <button type="button" className="v3-select is-sm is-filled" aria-label={t("计划作答时间")} disabled>
                      <span className={`v3-select-value v3-num${planStart ? "" : " is-placeholder"}`}>{planStart ? formatDateTimeLabel(planStart) : t("未安排")}</span>
                    </button>
                  )}
                </div>
                <div className="career-answer-plan-field is-duration">
                  <Select
                    size="sm"
                    filled
                    label={t("作答时长")}
                    value={String(planDurationMinutes)}
                    options={[30, 45, 60, 90, 120, 180].map((minutes) => ({ value: String(minutes), label: t("{value0} 分钟", { value0: minutes }) }))}
                    onChange={(value) => { setPlanDurationMinutes(Number(value)); setPlanError(null); }}
                    disabled={!interview.canReschedule}
                  />
                </div>
              </div>
            </div>
            {planError && <p className="career-field-error" role="alert">{planError}</p>}
          </section>
        )}
        {!isWindow && interview.status === "completed" && <p className="career-dialog-note"><span className="career-dot" data-tone="green" aria-hidden="true" />{t("复盘写在求职记录里，这一场不能再拖动改期。")}</p>}
        {!isWindow && interview.modeCode === "onsite" && interview.status === "upcoming" && <p className="career-dialog-note"><span className="career-dot" data-tone="muted" aria-hidden="true" />{t("现场面试没有会议链接，地点和时间都在求职记录里改。")}</p>}
      </div>
      <DialogFooterV3 left={primary || (isWindow && interview.canReschedule) ? <button type="button" className="v3-link" onClick={openRecord}>{t("查看求职记录")}<Icon name="arrow" size={12} /></button> : undefined}>
        {isWindow && interview.canReschedule && (interview.answerPlanStartAt || interview.answerPlanEndAt) && (
          <button type="button" className="v3-btn v3-btn-ghost" onClick={() => { setPlanStart(null); onAnswerPlanChange(interview.id, null, null); }}>{t("清除计划")}</button>
        )}
        <button type="button" className="v3-btn v3-btn-ghost" onClick={onClose}>{t("关闭")}</button>
        {primary
          ? primary.href
            ? <a className="v3-btn v3-btn-dark schedule-dialog-join" href={primary.href} target="_blank" rel="noreferrer">{primary.label}</a>
            : <button type="button" className="v3-btn v3-btn-dark" onClick={primary.onClick}>{primary.label}</button>
          : <button type="button" className="v3-btn v3-btn-dark" onClick={openRecord}>{t("查看求职记录")}</button>}
      </DialogFooterV3>
    </V3Dialog>
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
  useLocale();
  const applicationIdsWithSessionRecords = new Set(applicationIdsWithSessions);
  const applicationsWithoutSessions = applications.filter(
    (item) => !applicationIdsWithSessionRecords.has(item.id),
  );
  if (!selected)
    return (
      <div className="records-empty-layout">
        <div className="records-empty-state">
          <NotebookTabs aria-hidden="true" />
          <h2>{t("还没有面试记录")}</h2>
          <p>{t("安排面试后，可以在这里上传音频或填写文字记录。")}</p>
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
            <h2>{t("面试列表")}</h2>
            <div>
              <Search />
              <ListChecks />
            </div>
          </div>
          <div className="records-table-head">
            <span>{t("公司")}</span>
            <span>{t("职位")}</span>
            <span>{t("阶段")}</span>
            <span>{t("面试时间")}</span>
            <span>{t("状态")}</span>
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
                  {formatApplicationSessionRange(item.startAt, item.endAt)}
                </span>
                <StatusBadge status={item.status} />
              </button>
            ))}
          </div>
        </section>
        <section className="interview-surface records-calendar-card">
          <MiniCalendar selected={new Date(selected.startAt)} />
          <div className="records-calendar-legend">
            <span><i className="orange" />{t("待面试")}</span>
            <span><i className="blue" />{t("进行中")}</span>
            <span><i className="green" />{t("已完成")}</span>
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
            ? <PageLoading label={t("正在加载所选面试…")} scope="panel" />
            : t("暂时无法读取所选面试详情。")}
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
            ? <PageLoading label={t("正在加载面试素材…")} scope="panel" />
            : t("面试素材暂不可用。")}
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
  useLocale();
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
      await api.addJobApplicationStage(application.id, {
        client_request_id: crypto.randomUUID(),
        stage_type: "interview",
        interview_round_no: 1,
        stage_label: "一面",
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
      await api.terminateJobApplication(pendingReject.id, {
        client_request_id: crypto.randomUUID(),
        reason: "company_rejected",
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
      <header><h2>{t("未关联面试的求职进程")}</h2><span>{applications.length}</span></header>
      <p>{t("可先归档不再跟进的进程；已归档且没有面试记录时可永久删除。")}</p>
      <div>
        {applications.map((application) => (
          <article key={application.id}>
            <span><strong>{application.company_name_snapshot}</strong><small>{application.job_title_snapshot} · {projectApplicationProgress(application).stageLabel}</small></span>
            <button
              type="button"
              disabled={busyId !== null}
              aria-label={`${application.archived_at ? t("恢复") : t("归档")} ${application.company_name_snapshot}`}
              onClick={() => void changeArchived(application)}
            >
              {application.archived_at ? <RotateCcw /> : <Archive />}
            </button>
            {application.archived_at && (
              <button
                type="button"
                disabled={busyId !== null}
                aria-label={t("删除 {value0} 求职进程", { value0: application.company_name_snapshot })}
                onClick={() => setPendingDelete(application)}
              ><Trash2 /></button>
            )}
            {application.archived_at === null &&
              application.status === "active" &&
              application.current_stage_type === "screening" &&
              application.stage_state === "awaiting_result" && (
                <div className="application-screening-actions">
                  <span>{t("筛选结果")}</span>
                  <button type="button" disabled={busyId !== null} onClick={() => void advanceScreening(application)}>{t("通过并进入一面")}</button>
                  <button type="button" disabled={busyId !== null} onClick={() => setPendingReject(application)}>{t("未通过")}</button>
                </div>
              )}
          </article>
        ))}
      </div>
      <MotionPresence>{pendingDelete && (
        <ConfirmDialog
          kind="delete"
          title={t("永久删除「{value0}」求职进程？", { value0: pendingDelete.company_name_snapshot })}
          description={t("该进程没有面试记录，删除后岗位快照和进度信息也无法恢复。")}
          confirmLabel={t("永久删除")}
          busyLabel={t("正在删除…")}
          busy={busyId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={remove}
        />
      )}</MotionPresence>
      <MotionPresence>{pendingReject && (
        <ConfirmDialog
          kind="warning"
          title={t("确认「{value0}」筛选未通过？", { value0: pendingReject.company_name_snapshot })}
          description={t("该求职进程会退出活动流程，但历史岗位快照仍会保留，之后可以继续归档。")}
          confirmLabel={t("确认未通过")}
          busyLabel={t("正在处理…")}
          busy={busyId === pendingReject.id}
          onCancel={() => setPendingReject(null)}
          onConfirm={rejectScreening}
        />
      )}</MotionPresence>
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
  useLocale();
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
  const recordKind = detail.session.stage_type === "other" ? t("笔试") : t("面试");
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
        label: t("进入一面"),
        stageType: "interview",
        roundNo: 1,
        stageLabel: t("一面"),
      });
    }
    if (application.current_stage_type === "interview") {
      const roundNo = (application.current_round_no ?? 0) + 1;
      options.push({
        value: `interview:${roundNo}`,
        label: t("进入第 {value0} 轮面试", { value0: roundNo }),
        stageType: "interview",
        roundNo,
        stageLabel: t("{value0} 面", { value0: roundNo }),
      });
    }
    if (application.current_stage_type !== "hr") {
      options.push({
        value: "hr",
        label: t("进入 HR 面"),
        stageType: "interview",
        roundNo: null,
        stageLabel: t("HR 面"),
      });
    }
    options.push({
      value: "offer",
      label: t("进入 Offer 阶段"),
      stageType: "offer",
      roundNo: null,
      stageLabel: "Offer",
    });
    return options;
  }, [detail.application, getLocale()]);
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
      await api.addJobApplicationStage(detail.application.id, {
        client_request_id: crypto.randomUUID(),
        stage_type: target.stageType,
        interview_round_no: target.roundNo,
        stage_label: target.stageLabel,
        base_lock_version: detail.application.lock_version,
      });
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  const closeAsRejected = async () => {
    try {
      await api.terminateJobApplication(detail.application.id, {
        client_request_id: crypto.randomUUID(),
        reason: "company_rejected",
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
            ? t("取消这场{value0}安排？", { value0: recordKind })
            : pendingLifecycle === "archive"
              ? t("归档这条求职进程？")
              : pendingLifecycle === "restore"
                ? t("恢复这条求职进程？")
                : t("永久删除这场面试记录？"),
        description:
          pendingLifecycle === "cancel"
            ? t("该场次会保留在面试记录中，并从当前排期退出；求职进程回到待安排状态。")
            : pendingLifecycle === "archive"
              ? t("归档后会从默认求职进程和排期中隐藏，历史面试记录仍会保留。")
              : pendingLifecycle === "restore"
                ? t("恢复后，这条仍在进行的求职进程会重新进入默认求职进程列表。")
                : t("删除后不可恢复。若存在关联素材，系统会拒绝删除并保留原记录。"),
        confirmLabel:
          pendingLifecycle === "cancel"
            ? t("确认取消")
            : pendingLifecycle === "archive"
              ? t("确认归档")
              : pendingLifecycle === "restore"
                ? t("确认恢复")
                : t("永久删除"),
      }
    : null;
  return (
    <section className="interview-surface record-detail-panel">
      <header className="record-detail-header">
        <CompanyLogo item={selected} />
        <div>
          <h2>{selected.company} · {selected.role}</h2>
          <p>
            <CalendarDays />{t("面试时间：")}{selected.date} {selected.time}　
            <Video />{t("面试形式：")}{selected.mode}　
            <UserRound />{t("面试官：")}{selected.interviewer}
          </p>
        </div>
        <div className="record-detail-actions">
          <Button
            size="sm"
            variant="outline"
            icon={<Pencil />}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? t("取消") : t("填写文字记录")}
          </Button>
          {detail.session.status === "scheduled" && (
            <>
              {!isArchived && (
                <Button size="sm" variant="outline" icon={<Ban />} onClick={() => setPendingLifecycle("cancel")}>{t("取消")}{recordKind}{t("安排")}</Button>
              )}
              {!isArchived && <Button size="sm" onClick={() => void save(true)}>{t("完成面试")}</Button>}
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            icon={isArchived ? <RotateCcw /> : <Archive />}
            onClick={() => setPendingLifecycle(isArchived ? "restore" : "archive")}
          >
            {isArchived ? t("恢复进程") : t("归档进程")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 />}
            onClick={() => setPendingLifecycle("delete-session")}
          >{t("删除记录")}</Button>
        </div>
      </header>
      <StageProgress application={detail.application} />
      {!isArchived && detail.application.status === "active" &&
        detail.application.stage_state === "awaiting_result" && (
          <section className="record-stage-actions" aria-label={t("面试结果处理")}>
            <div>
              <strong>{t("本轮面试已完成")}</strong>
              <span>{t("确认结果后再进入下一阶段，流程卡片会随之移动。")}</span>
            </div>
            <Select label={t("选择下一阶段")} value={nextStage} onChange={setNextStage} options={stageOptions} placeholder={t("选择下一阶段")} />
            <Button size="sm" disabled={!nextStage} onClick={() => void advance()}>{t("确认通过")}</Button>
            <Button size="sm" variant="outline" onClick={() => void closeAsRejected()}>{t("未通过")}</Button>
          </section>
        )}
      {!isArchived && detail.application.status === "active" &&
        detail.application.current_stage_type === "offer" && (
          <section className="record-stage-actions" aria-label={t("Offer 结果处理")}>
            <div>
              <strong>{t("Offer 进度")}</strong>
              <span>{t("当前：")}{offerStatusLabel(detail.application.offer_status)}</span>
            </div>
            {detail.application.offer_status === "none" && (
              <Button size="sm" onClick={() => void recordOfferReceived()}>{t("确认收到 Offer")}</Button>
            )}
          </section>
        )}
      <section className="record-section">
        <h3><FileText />{t("面试信息")}</h3>
        <dl>
          <div><dt>{t("职位")}</dt><dd>{selected.role}</dd></div>
          <div><dt>{t("当前状态")}</dt><dd><StatusBadge status={selected.status} /></dd></div>
          <div><dt>{t("面试官")}</dt><dd>{selected.interviewer}</dd></div>
          <div><dt>{t("面试地点")}</dt><dd>{detail.session.location ?? selected.mode}{detail.session.meeting_url && <ExternalLink />}</dd></div>
          <div className="record-color-setting">
            <dt>{t("日历颜色")}</dt>
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
        title={t("文字记录")}
        value={questions}
        editing={editing}
        placeholder={t("粘贴面试过程、逐字稿或整理后的文字记录…")}
        onChange={setQuestions}
      />
      {editing && <div className="record-save-row"><Button onClick={() => void save(false)}>{t("保存文字记录")}</Button></div>}
      <MotionPresence>{lifecycleDialog && (
        <ConfirmDialog
          kind={lifecycleDialog.kind}
          title={lifecycleDialog.title}
          description={lifecycleDialog.description}
          confirmLabel={lifecycleDialog.confirmLabel}
          busyLabel={t("正在处理…")}
          busy={lifecycleBusy}
          onCancel={() => setPendingLifecycle(null)}
          onConfirm={runLifecycle}
        />
      )}</MotionPresence>
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
  useLocale();
  return (
    <section className="record-section compact-record-section">
      <header><h3><CircleCheck />{title}</h3></header>
      {editing ? (
        <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <p>{value || t("暂未填写")}</p>
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
  useLocale();
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
      await api.unlinkSessionAsset(detail.session.id, asset.id);
      onChanged();
    } catch (error) {
      onNotice(errorMessage(error));
    }
  };
  return (
    <aside className="record-assets-column" aria-label={t("{value0}面试素材", { value0: selected.company })}>
      <section className="interview-surface asset-card">
        <header><h3>{t("面试素材")}</h3><span>{detail.assets.length}{t(" 个文件")}</span></header>
        <div>
          {detail.assets.length ? detail.assets.map((asset) => (
            <article className="asset-file-row" key={asset.id}>
              <span><FileText /></span>
              <div><strong>{asset.original_file_name}</strong><small>{formatBytes(asset.file_size)} · {asset.source_type === "recorded" ? t("现场录制") : t("文件上传")}</small></div>
              <button type="button" aria-label={t("下载 {value0}", { value0: asset.original_file_name })} onClick={() => void download(asset)}><Download /></button>
              <button type="button" aria-label={t("移除 {value0}", { value0: asset.original_file_name })} onClick={() => void remove(asset)}><Trash2 /></button>
            </article>
          )) : <p className="asset-empty">{t("还没有素材")}</p>}
        </div>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          aria-label={t("面试素材文件")}
          accept=".webm,.m4a,.mp3,.wav,.ogg,.mp4,.mov,.pdf,.docx,.md,.txt"
          onChange={(event) => {
            const file = event.target.files?.[0];
            const extension = file?.name.slice(file.name.lastIndexOf(".")).toLowerCase();
            const supportedExtensions = new Set([".webm", ".m4a", ".mp3", ".wav", ".ogg", ".mp4", ".mov", ".pdf", ".docx", ".md", ".txt"]);
            if (file && supportedExtensions.has(extension ?? "")) void upload(file);
            else if (file) onNotice(t("仅支持音视频与文档格式文件。"));
            event.target.value = "";
          }}
        />
        <Button variant="outline" icon={<Import />} onClick={() => fileInput.current?.click()}>{t("上传文件")}</Button>
      </section>
      <PrepChecklistCard detail={detail} onChanged={onChanged} onNotice={onNotice} fallbackError={errorMessage} />
      <InterviewContextSidebar className="record-context-card" interview={selected} />
    </aside>
  );
}

function CreateApplicationDialog({
  applications,
  initialJobId,
  onClose,
  onCreated,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  initialJobId?: string;
  onClose: () => void;
  onCreated: (applicationId: string) => void;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const [jobs, setJobs] = useState<JobDescriptionSummary[]>([]);
  const [jobId, setJobId] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const applicationJobIds = new Set(
    applications.flatMap((application) =>
      application.job_description_id ? [application.job_description_id] : [],
    ),
  );
  const availableJobs = jobs.filter((job) => !applicationJobIds.has(job.id));

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
    if (availableJobs.some((job) => job.id === jobId)) return;
    const nextJobId =
      initialJobId && availableJobs.some((job) => job.id === initialJobId)
        ? initialJobId
        : availableJobs[0]?.id ?? "";
    if (nextJobId !== jobId) setJobId(nextJobId);
  }, [availableJobs, initialJobId, jobId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!jobId) return;
    setSubmitting(true);
    try {
      const result = await api.createJobApplication({
        job_description_id: jobId,
        current_stage_type: "screening",
        current_round_no: null,
        current_stage_label: t("待投递"),
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
    <MotionSurface as="div" variant="overlay" className="interview-dialog-backdrop" role="presentation">
      <MotionSurface as="section" variant="dialog" className="interview-dialog career-application-dialog" role="dialog" aria-modal="true" aria-labelledby="create-application-title">
        <header>
          <div>
            <h2 id="create-application-title">{t("新建求职进程")}</h2>
            <p>{t("从岗位库选择目标岗位，后续面试和记录都会关联到这条进程。")}</p>
          </div>
          <button type="button" aria-label={t("关闭")} onClick={onClose}><X /></button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          {loadingJobs ? (
            <PageLoading label={t("正在加载岗位库…")} scope="panel" />
          ) : availableJobs.length ? (
            <>
              <label>{t("目标岗位")}<Select label={t("目标岗位")} value={jobId} onChange={setJobId} options={availableJobs.map((job) => ({ value: job.id, label: `${job.company_name} · ${job.job_title}` }))} />
              </label>
              <div className="interview-dialog-grid">
                <label>{t("初始阶段")}<input value={t("待投递")} disabled />
                </label>
                <label className="is-wide">{t("备注")}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("记录内推人、投递渠道或下一步提醒（可选）")} />
                </label>
              </div>
            </>
          ) : (
            <div className="career-dialog-empty">
              <BriefcaseBusiness />
              <strong>{t("岗位库中还没有可用岗位")}</strong>
              <span>{t("已有求职记录的岗位不能再次投递；请导入新岗位。")}</span>
              <Button type="button" variant="outline" onClick={() => {
                onClose();
                navigateTo("/career/applications?import=1");
              }}>{t("导入岗位")}</Button>
            </div>
          )}
          <footer>
            <Button type="button" variant="outline" onClick={onClose}>{t("取消")}</Button>
            <Button
              type="submit"
              disabled={loadingJobs || !availableJobs.some((job) => job.id === jobId) || submitting}
            >{submitting ? t("正在创建…") : t("创建求职进程")}</Button>
          </footer>
        </form>
      </MotionSurface>
    </MotionSurface>
  );
}

function CreateInterviewDialog({
  applications,
  initialApplicationId,
  detailMode,
  timezone,
  initialStartAt,
  initialEndAt,
  onClose,
  onCreated,
  onNotice,
}: {
  applications: JobApplicationSummary[];
  initialApplicationId?: string | null;
  detailMode: boolean;
  timezone: string;
  initialStartAt?: string | null;
  initialEndAt?: string | null;
  onClose: () => void;
  onCreated: (sessionId: string, info?: ScheduleCreatedInfo) => void;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const detailApplication = detailMode
    ? applications.find((item) => item.id === initialApplicationId) ?? null
    : null;
  const detailStageLabel = detailApplication?.current_stage_label ?? t("一面");
  const detailProgress = detailApplication ? projectApplicationProgress(detailApplication) : null;
  const detailStageCategory = detailApplication?.current_stage_type === "screening"
    ? detailProgress?.isAssessment ? "assessment" : "screening"
    : "interview";
  const detailTimeLabel = detailStageCategory === "assessment"
    ? t("测评时间")
    : detailStageCategory === "interview"
      ? t("面试时间")
      : t("记录时间");
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
  const [duration, setDuration] = useState(() => {
    if (!initialStartAt || !initialEndAt) return 60;
    const start = new Date(initialStartAt);
    const end = new Date(initialEndAt);
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  });
  const [mode, setMode] = useState<"video" | "onsite" | "phone" | "other">("video");
  const [meetingOrLocation, setMeetingOrLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [createdApplication, setCreatedApplication] = useState<JobApplicationSummary | null>(null);
  const requestIdRef = useRef(crypto.randomUUID());
  useEffect(() => {
    if (detailMode) return;
    void api.listJobDescriptions({ limit: 100 }).then((response) => setJobs(response.items)).catch(() => undefined);
  }, [detailMode]);
  useEffect(() => {
    if (detailMode && detailApplication) setStage(detailApplication.current_stage_label);
  }, [detailApplication?.current_stage_label, detailMode]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      let targetApplication =
        createdApplication ?? applications.find((item) => item.id === applicationId);
      if (detailMode && !targetApplication) {
        onNotice(t("当前求职进程已不可用，请刷新后重试。"));
        return;
      }
      if (!targetApplication) {
        let targetJobId = createdJobId ?? jobId;
        let pendingApplicationId: string | null = null;
        if (!targetJobId) {
          const createdJob = await api.createJobDescription({
            company_name: company,
            job_title: role,
            description: jobDescription || `${company} ${role}`,
            source_type: "manual",
          });
          targetJobId = createdJob.job_description.id;
          pendingApplicationId = createdJob.application?.id ?? null;
          setCreatedJobId(targetJobId);
        }
        const pendingApplication = pendingApplicationId
          ? await api.getJobApplication(pendingApplicationId)
          : await api.createJobApplication({ job_description_id: targetJobId });
        const stagedApplication = await api.addJobApplicationStage(
          pendingApplication.application.id,
          {
            client_request_id: requestIdRef.current,
            stage_type: "interview",
            stage_label: stage,
            interview_round_no: roundNo,
            base_lock_version: pendingApplication.application.lock_version,
          },
        );
        targetApplication = { ...stagedApplication.application, next_session_id: null, next_session_start_at: null, next_session_end_at: null, next_session_mode: null };
        setCreatedApplication(targetApplication);
      }
      const start = new Date(startAt);
      const payload: InterviewSessionCreatePayload = {
        client_request_id: requestIdRef.current,
        application_stage_id: targetApplication.current_stage?.id,
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
        duration_minutes: duration,
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
      const response = await api.createInterviewSession(targetApplication.id, payload);
      onCreated(response.session.id, {
        company: targetApplication.company_name_snapshot,
        stage: projectApplicationProgress(targetApplication).stageLabel,
        startAt: response.session.start_at,
      });
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };
  const creationLocked = createdJobId !== null || createdApplication !== null;
  const meetingOrLocationPlaceholder = mode === "video" || mode === "phone"
    ? t("粘贴会议链接（可选）")
    : t("填写会议室、地址或其他地点（可选）");
  return (
    <MotionSurface as="div" variant="overlay" className="interview-dialog-backdrop" role="presentation">
      <MotionSurface as="section" variant="dialog" className={`interview-dialog${detailMode ? " interview-dialog--detail-schedule" : ""}`} role="dialog" aria-modal="true" aria-labelledby="create-interview-title">
        <header><div><h2 id="create-interview-title">{detailMode ? t("添加求职阶段") : t("新建面试")}</h2><p>{detailMode ? t("选择阶段分类并补充本阶段信息，保存后会进入对应的求职流程。") : t("岗位信息、求职进程和本场排期在这里一次完成。")}</p></div><button type="button" aria-label={t("关闭")} onClick={onClose}><X /></button></header>
        <form onSubmit={(event) => void submit(event)}>
          {detailMode ? (
            <>
              <div className="interview-detail-stage-section">
                <strong>{t("阶段分类")}</strong>
                <div className="interview-detail-stage-categories" aria-label={t("阶段分类")}>
                  {[
                    ["screening", t("筛选")],
                    ["assessment", t("笔试 / 测评")],
                    ["interview", t("面试")],
                  ].map(([key, label]) => (
                    <span key={key} className={key === detailStageCategory ? "is-active" : ""} aria-current={key === detailStageCategory ? "step" : undefined}>{label}</span>
                  ))}
                </div>
              </div>
              <div className="interview-detail-divider" aria-hidden="true" />
              <div className="interview-dialog-grid interview-detail-form-grid">
                <label>{t("展示名称")}<input required value={stage} readOnly aria-readonly="true" /></label>
                {detailStageCategory === "interview" && <label>{t("面试轮次")}<input type="number" value={detailApplication?.current_round_no ?? ""} readOnly aria-readonly="true" /></label>}
                <label>{t("当前状态")}<input value={t("已安排")} readOnly aria-readonly="true" /></label>
                <div className="interview-dialog-schedule-field is-wide">
                  <label htmlFor="interview-detail-schedule">{detailTimeLabel}</label>
                  <ScheduleDateTimePicker
                    id="interview-detail-schedule"
                    label={detailTimeLabel}
                    value={startAt}
                    durationMinutes={detailStageCategory === "screening" ? undefined : duration}
                    required
                    disabled={submitting}
                    onChange={setStartAt}
                    onDurationMinutesChange={detailStageCategory === "screening" ? undefined : setDuration}
                  />
                </div>
                {detailStageCategory !== "screening" && <>
                  <label>{t("方式")}<Select label={t("面试方式")} value={mode} onChange={setMode} options={[{ value: "video", label: t("视频面试") }, { value: "onsite", label: t("现场面试") }, { value: "phone", label: t("电话面试") }, { value: "other", label: t("其他") }]} /></label>
                  <label className="is-wide">{t("链接或地点")}<input value={meetingOrLocation} onChange={(event) => setMeetingOrLocation(event.target.value)} placeholder={meetingOrLocationPlaceholder} /></label>
                </>}
              </div>
            </>
          ) : (
            <>
              {applications.length > 0 && <label>{t("求职进程")}<Select label={t("求职进程")} disabled={creationLocked || submitting} value={applicationId} onChange={setApplicationId} options={[{ value: "new", label: t("新建求职进程") }, ...applications.map((item) => ({ value: item.id, label: `${item.company_name_snapshot} · ${item.job_title_snapshot} · ${projectApplicationProgress(item).stageLabel}` }))]} /></label>}
              {applicationId === "new" && <>
                <label>{t("已有岗位档案")}<Select label={t("已有岗位档案")} disabled={creationLocked || submitting} value={jobId} onChange={setJobId} options={[{ value: "", label: t("在求职中心直接填写岗位") }, ...jobs.map((job) => ({ value: job.id, label: `${job.company_name} · ${job.job_title}` }))]} /></label>
                {!jobId && <div className="interview-dialog-grid"><label>{t("公司")}<input disabled={creationLocked} required value={company} onChange={(event) => setCompany(event.target.value)} /></label><label>{t("岗位")}<input disabled={creationLocked} required value={role} onChange={(event) => setRole(event.target.value)} /></label><label className="is-wide">{t("岗位信息")}<textarea disabled={creationLocked} value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder={t("可粘贴 JD，后续会作为本次求职的岗位快照")} /></label></div>}
                <div className="interview-dialog-grid"><label>{t("阶段")}<input disabled={creationLocked} required value={stage} onChange={(event) => setStage(event.target.value)} /></label><label>{t("轮次")}<input disabled={creationLocked} type="number" min={1} value={roundNo} onChange={(event) => setRoundNo(Number(event.target.value))} /></label></div>
              </>}
            </>
          )}
          {creationLocked && <p className="interview-create-progress" role="status">{t("岗位或求职进程已创建；再次提交只会重试当前面试排期，不会重复创建前置数据。")}</p>}
          {!detailMode && <div className="interview-dialog-grid">
            <div className="interview-dialog-schedule-field is-wide">
              <label htmlFor="interview-create-schedule">{t("面试时间")}</label>
              <ScheduleDateTimePicker
                id="interview-create-schedule"
                label={t("面试时间")}
                value={startAt}
                durationMinutes={duration}
                required
                disabled={submitting}
                onChange={setStartAt}
                onDurationMinutesChange={setDuration}
              />
            </div>
            <label>{t("面试方式")}<Select label={t("面试方式")} value={mode} onChange={setMode} options={[{ value: "video", label: t("视频面试") }, { value: "onsite", label: t("现场面试") }, { value: "phone", label: t("电话面试") }, { value: "other", label: t("其他") }]} /></label>
          </div>}
          {detailMode ? (
            <footer className="interview-detail-footer">
              <p>{t("保存后可继续补充安排或更新结果。")}</p>
              <div className="interview-detail-footer-actions">
                <Button type="button" variant="outline" onClick={onClose}>{t("取消")}</Button>
                <Button type="submit" disabled={submitting}>{submitting ? t("正在保存…") : t("添加并保存")}</Button>
              </div>
            </footer>
          ) : (
            <footer><Button type="button" variant="outline" onClick={onClose}>{t("取消")}</Button><Button type="submit" disabled={submitting}>{submitting ? t("正在创建…") : t("创建面试")}</Button></footer>
          )}
        </form>
      </MotionSurface>
    </MotionSurface>
  );
}

function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  useLocale();
  return <header className="interview-section-heading"><h2>{title}</h2>{action && <button type="button" onClick={onAction}>{action}<ChevronRight /></button>}</header>;
}

function CompanyLogo({ item }: { item: { company: string; logo: string; color: InterviewCalendarColor } }) {
  useLocale();
  return <span className={`company-logo calendar-${item.color}`} aria-hidden="true">{item.logo}</span>;
}

function MiniCalendar({ selected }: { selected: Date }) {
  useLocale();
  const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  return <div className="mini-calendar"><header><strong>{selected.getFullYear()}{t("年")}{selected.getMonth() + 1}{t("月")}</strong><span><ChevronLeft /><ChevronRight /></span></header><div className="mini-calendar-week"><span>{t("一")}</span><span>{t("二")}</span><span>{t("三")}</span><span>{t("四")}</span><span>{t("五")}</span><span>{t("六")}</span><span>{t("日")}</span></div><div className="mini-calendar-days">{days.map((day) => <button type="button" key={isoDate(day)} className={`${day.getMonth() !== selected.getMonth() ? "is-muted " : ""}${isoDate(day) === isoDate(selected) ? "is-selected" : ""}`}>{day.getDate()}</button>)}</div></div>;
}

function formatScheduleTime(slot: number): string {
  const totalMinutes = Math.round(slot * 30);
  const hour = Math.floor(totalMinutes / 60);
  if (hour >= 24) return "24:00";
  return `${String(hour).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function CalendarColorPicker({ company, value, onChange }: { company: string; value: InterviewCalendarColor; onChange: (color: InterviewCalendarColor) => void }) {
  useLocale();
  const currentLabel = CALENDAR_COLORS.find((color) => color.id === value)?.label ?? t("灰色");
  return <div className="calendar-color-picker" role="group" aria-label={t("{value0}日历颜色，当前{value1}", { value0: company, value1: currentLabel })}><span>{currentLabel}</span>{CALENDAR_COLORS.map((color) => <button key={color.id} type="button" className={`calendar-color-swatch calendar-${color.id}`} aria-label={t("将{value0}的日历颜色设为{value1}", { value0: company, value1: color.label })} aria-pressed={color.id === value} title={color.label} onClick={() => onChange(color.id)} />)}</div>;
}

function InterviewContextSidebar({ className, interview }: { className: string; interview: Interview }) {
  useLocale();
  return <aside className={`${className} interview-context-sidebar`} aria-label={t("{value0}面试上下文", { value0: interview.company })}><section className="interview-surface context-primary-card"><header className="context-company-header"><span className={`context-company-mark calendar-${interview.color}`}>{interview.logo}</span><strong>{interview.company}</strong><StatusBadge status={interview.status} /></header><h2>{interview.stage}{t("（面试）")}</h2><p className="context-role">{interview.role}</p><dl className="context-detail-list"><DetailRow icon={<Clock3 />} label={t("时间")} value={`${interview.date}（${interview.weekday}） ${interview.time} – ${interview.endTime}`} /><DetailRow icon={<Link2 />} label={t("面试方式")} value={interview.mode} /><DetailRow icon={<UserRound />} label={t("面试官")} value={interview.interviewer} /><DetailRow icon={<CircleCheck />} label={t("状态")} value={interview.status === "completed" ? t("已完成面试") : interview.status === "cancelled" ? t("已取消") : t("待面试")} /><DetailRow icon={<Bell />} label={t("备注")} value={interview.note} /></dl></section><button type="button" className="interview-surface context-job-archive-card" onClick={() => navigateTo(careerApplicationPath(interview.applicationId))}><span>{t("查看对应求职记录")}</span><div><FolderOpen /><p><strong>{interview.company} · {interview.role}</strong><small>{t("岗位信息与本次求职进程")}</small></p><ChevronRight /></div></button></aside>;
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  useLocale();
  return <div><dt>{icon}{label}</dt><dd>{value}</dd></div>;
}

function StatusBadge({ status }: { status: InterviewStatus }) {
  useLocale();
  const label = status === "completed" ? t("已完成面试") : status === "active" ? t("进行中") : status === "cancelled" ? t("已取消") : t("待面试");
  return <span className={`interview-status-badge status-${status}`}>{label}</span>;
}

function StageProgress({ application }: { application: InterviewSessionDetail["application"] }) {
  useLocale();
  const projection = projectApplicationProgress(application);
  const journeyLabel = projection.isPending || projection.isWaiting
    ? projection.primaryLabel
    : application.current_stage_type === "offer"
      ? offerStatusLabel(application.offer_status)
      : projection.stageLabel;
  if (projection.isPending) {
    const pendingOrWaiting = [{ key: "pending", label: projection.stageLabel }];
    return <div className="stage-progress" style={{ "--stage-count": pendingOrWaiting.length } as CSSProperties} aria-label={t("当前阶段：{value0}", { value0: journeyLabel })}><div className="stage-progress-line" />{pendingOrWaiting.map((stage) => <div key={stage.key} className="is-current"><span /><strong>{stage.label}</strong></div>)}</div>;
  }
  const highestRound = Math.max(
    2,
    application.current_stage_type === "interview"
      ? application.current_round_no ?? 1
      : 2,
  );
  const stages = [
    { key: "screening", label: application.current_stage_type === "screening" ? projection.stageLabel : t("筛选中") },
    ...Array.from({ length: highestRound }, (_, index) => ({
      key: `interview:${index + 1}`,
      label: interviewRoundLabel(index + 1),
    })),
    { key: "hr", label: t("HR 面") },
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
  return <div className="stage-progress" style={{ "--stage-count": stages.length } as CSSProperties} aria-label={t("当前阶段：{value0}", { value0: journeyLabel })}><div className="stage-progress-line" />{stages.map((stage, index) => <div key={stage.key} className={index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : ""}><span>{index < currentIndex ? <Check /> : null}</span><strong>{stage.label}</strong></div>)}</div>;
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
  useLocale();
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
        setError(t("求职记录已在其他页面更新，请关闭后重新修改分类。"));
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
      <DialogHeader><DialogTitle>{t("修改求职分类")}</DialogTitle><DialogDescription>{application.company_name_snapshot} · {application.job_title_snapshot}</DialogDescription></DialogHeader>
      <SelectField label={t("求职分类")} value={category} disabled={saving} options={[{value: "internship", label: t("实习")}, {value: "campus", label: t("校招")}, {value: "full_time", label: t("正式")}, {value: "unclassified", label: t("未分类")}]} onChange={(event) => setCategory(event.target.value)} />
      {error && <p role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>{t("取消")}</Button><Button disabled={saving} onClick={() => void save()}>{saving ? t("保存中…") : t("保存")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
