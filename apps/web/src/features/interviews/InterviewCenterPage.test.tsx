import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type JobApplicationSummary, type ResumeSummary } from "@/api/client";
import { useResumeStore } from "@/store/resumeStore";
import { sortApplications } from "./ApplicationsBoard";
import { InterviewCenterPage } from "./InterviewCenterPage";
import {
  applicationProgressLabel,
  applicationProgressToneClass,
  applicationScheduleStatusLabel,
  offerStatusLabel,
  projectApplicationProgress,
} from "./applicationProgress";

const mocks = vi.hoisted(() => {
  const stageCommand = vi.fn();
  const terminateCommand = vi.fn();
  return ({
  listInterviewSessions: vi.fn(),
  listJobApplications: vi.fn(),
  getInterviewSession: vi.fn(),
  updateJobApplication: vi.fn(),
  rescheduleInterviewSession: vi.fn(),
  listJobDescriptions: vi.fn(),
  listVersions: vi.fn(),
  parseJobDescriptionDraft: vi.fn(),
  createJobDescription: vi.fn(),
  createJobApplication: vi.fn(),
  createInterviewSession: vi.fn(),
  updateInterviewSession: vi.fn(),
  completeInterviewSession: vi.fn(),
  cancelInterviewSession: vi.fn(),
  deleteInterviewSession: vi.fn(),
  archiveJobApplication: vi.fn(),
  restoreJobApplication: vi.fn(),
  deleteJobApplication: vi.fn(),
  advanceJobApplication: stageCommand,
  addJobApplicationStage: stageCommand,
  terminateJobApplication: terminateCommand,
  closeJobApplication: terminateCommand,
  recordJobApplicationOffer: vi.fn(),
  uploadInterviewAsset: vi.fn(),
  downloadInterviewAsset: vi.fn(),
  deleteInterviewAsset: vi.fn(),
  getPluginRelease: vi.fn(),
  });
});

vi.mock("@/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/client")>();
  return { ...original, api: mocks };
});

const application = {
  id: "21",
  job_description_id: "8",
  resume_version_id: null,
  company_name_snapshot: "腾讯",
  job_title_snapshot: "后端开发工程师",
  job_snapshot: { schema_version: 1 },
  resume_title_snapshot: null,
  calendar_color: "blue" as const,
  current_stage_type: "interview" as const,
  current_round_no: 2,
  current_stage_label: "二面",
  stage_state: "scheduled" as const,
  status: "active" as const,
  offer_status: "none" as const,
  offer_base_location: null,
  offer_salary: null,
  offer_salary_currency: null,
  offer_salary_period: null,
  offer_benefits_description: null,
  is_favorite: false,
  applied_at: null,
  notes: null,
  archived_at: null,
  lock_version: 3,
  created_at: "2026-08-17T01:00:00Z",
  updated_at: "2026-08-18T01:00:00Z",
};

const resumeFixtures: ResumeSummary[] = [
  {
    id: "resume-1",
    title: "后端工程师简历",
    source_type: "template",
    lock_version: 3,
    created_at: "2026-08-01T01:00:00Z",
    updated_at: "2026-08-20T01:00:00Z",
  },
  {
    id: "resume-2",
    title: "后端工程师简历（无正式版本）",
    source_type: "import",
    lock_version: 1,
    created_at: "2026-08-02T01:00:00Z",
    updated_at: "2026-08-21T01:00:00Z",
  },
];

const fixtureWeekStart = new Date();
fixtureWeekStart.setHours(0, 0, 0, 0);
fixtureWeekStart.setDate(
  fixtureWeekStart.getDate() - (fixtureWeekStart.getDay() || 7) + 1,
);
const fixtureWeekEnd = new Date(fixtureWeekStart);
fixtureWeekEnd.setDate(fixtureWeekEnd.getDate() + 7);
const fixtureSessionStart = new Date(fixtureWeekStart);
fixtureSessionStart.setDate(fixtureSessionStart.getDate() + 3);
fixtureSessionStart.setHours(10, 0, 0, 0);
const fixtureSessionEnd = new Date(fixtureSessionStart.getTime() + 60 * 60 * 1000);
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";

const session = {
  id: "31",
  application_id: "21",
  client_request_id: "11111111-1111-4111-8111-111111111111",
  stage_type: "interview" as const,
  round_no: 2,
  stage_label: "二面",
  status: "scheduled" as const,
  round_result: "pending" as const,
  start_at: fixtureSessionStart.toISOString(),
  end_at: fixtureSessionEnd.toISOString(),
  timezone: "Asia/Shanghai",
  mode: "video" as const,
  meeting_url: "https://meeting.example/31",
  location: null,
  interviewer_name: "王老师",
  interviewer_title: "后端技术专家",
  reminder_minutes: 15,
  preparation_note: "准备缓存一致性与系统设计。",
  questions_markdown: "如何保证接口幂等？",
  review_summary: "等待面试后填写。",
  improvement_markdown: "补充分布式事务边界。",
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  lock_version: 2,
  created_at: "2026-08-18T01:00:00Z",
  updated_at: "2026-08-18T01:00:00Z",
  company_name: "腾讯",
  job_title: "后端开发工程师",
  calendar_color: "blue" as const,
  application_stage_state: "scheduled" as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function openScheduleDateTimePicker(
  dialog: HTMLElement,
  label: string,
  dateValue: string,
): HTMLElement {
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
  const picker = within(dialog).getByRole("dialog", { name: `选择${label}` });
  const dateLabel = `${dateValue.slice(0, 4)}年${Number(dateValue.slice(5, 7))}月${Number(dateValue.slice(8, 10))}日`;
  if (!within(picker).queryByRole("button", { name: dateLabel })) {
    const targetMonth = Number(dateValue.slice(0, 7).replace("-", ""));
    for (let index = 0; index < 24 && !within(picker).queryByRole("button", { name: dateLabel }); index += 1) {
      const monthHeading = within(picker).getByText(/\d{4}年\d{1,2}月/).textContent ?? "";
      const match = /(\d{4})年(\d{1,2})月/.exec(monthHeading);
      const displayedMonth = match ? Number(match[1]) * 100 + Number(match[2]) : targetMonth;
      fireEvent.click(within(picker).getByRole("button", {
        name: displayedMonth > targetMonth ? "上一月" : "下一月",
      }));
    }
  }
  fireEvent.click(within(picker).getByRole("button", { name: dateLabel }));
  return picker;
}

function chooseScheduleDateTime(
  dialog: HTMLElement,
  label: string,
  dateValue: string,
  hour: string,
  minute: string,
) {
  const picker = openScheduleDateTimePicker(dialog, label, dateValue);
  const hourPicker = within(picker).getByRole("listbox", { name: "小时" });
  const minutePicker = within(picker).getByRole("listbox", { name: "分钟" });
  fireEvent.click(within(hourPicker).getByRole("option", { name: `${hour} 时` }));
  fireEvent.click(within(minutePicker).getByRole("option", { name: `${minute} 分` }));
  fireEvent.click(within(picker).getByRole("button", { name: "确定" }));
}

function chooseSelectOption(dialog: HTMLElement, label: string, option: string) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

function openViewSettings() {
  const summary = screen.getByLabelText("视图设置");
  const details = summary.closest("details")!;
  if (!details.open) fireEvent.click(summary);
  return details;
}
function switchToApplicationBoard() {
  fireEvent.click(within(openViewSettings()).getByRole("button", { name: "阶段看板" }));
}
function switchToApplicationList() {
  fireEvent.click(within(openViewSettings()).getByRole("button", { name: "列表" }));
}

beforeEach(() => {
  mocks.addJobApplicationStage.mockResolvedValue({ application });
  mocks.terminateJobApplication.mockResolvedValue({ application });
  mocks.listInterviewSessions.mockResolvedValue({ items: [session], next_cursor: null });
  mocks.listJobApplications.mockResolvedValue({
    items: [
      {
        ...application,
        next_session_id: "31",
        next_session_start_at: session.start_at,
        next_session_end_at: session.end_at,
        next_session_mode: "video",
      },
    ],
    next_cursor: null,
  });
  mocks.getInterviewSession.mockResolvedValue({
    session,
    application,
    assets: [
      {
        id: "41",
        interview_session_id: "31",
        source_type: "uploaded",
        asset_type: "audio",
        original_file_name: "interview.m4a",
        content_type: "audio/mp4",
        file_size: 2048,
        duration_ms: 60_000,
        sha256: "a".repeat(64),
        created_at: "2026-08-20T12:00:00Z",
      },
    ],
  });
  mocks.listJobDescriptions.mockResolvedValue({ items: [], next_cursor: null });
  mocks.listVersions.mockResolvedValue({ versions: [] });
  useResumeStore.setState({ resumes: resumeFixtures });
  mocks.cancelInterviewSession.mockResolvedValue({ session, application, assets: [] });
  mocks.deleteInterviewSession.mockResolvedValue({ deleted: true, application });
  mocks.archiveJobApplication.mockResolvedValue({
    application: { ...application, archived_at: "2026-08-20T12:00:00Z" },
  });
  mocks.restoreJobApplication.mockResolvedValue({ application });
  mocks.deleteJobApplication.mockResolvedValue({ deleted: true });
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

describe("InterviewCenterPage API projections", () => {
  it("sorts scheduled progress by the next session and keeps stable creation ordering", () => {
    const makeSummary = (
      id: string,
      overrides: Partial<JobApplicationSummary> = {},
    ): JobApplicationSummary => ({
      ...application,
      id,
      created_at: "2026-08-20T01:00:00Z",
      next_session_id: null,
      next_session_start_at: null,
      next_session_end_at: null,
      next_session_mode: null,
      ...overrides,
    });
    const scheduledLate = makeSummary("scheduled-late", {
      created_at: "2026-08-12T01:00:00Z",
      next_session_start_at: "2026-09-04T01:00:00Z",
      next_session_end_at: "2026-09-04T02:00:00Z",
    });
    const scheduledEarly = makeSummary("scheduled-early", {
      created_at: "2026-08-14T01:00:00Z",
      next_session_start_at: "2026-09-02T01:00:00Z",
      next_session_end_at: "2026-09-02T02:00:00Z",
    });
    const scheduledSameTimeOlder = makeSummary("scheduled-same-older", {
      created_at: "2026-08-10T01:00:00Z",
      next_session_start_at: "2026-09-02T01:00:00Z",
      next_session_end_at: "2026-09-02T02:00:00Z",
    });
    const noSchedule = makeSummary("no-schedule", { created_at: "2026-08-01T01:00:00Z" });
    const invalidSchedule = makeSummary("invalid-schedule", {
      created_at: "2026-08-02T01:00:00Z",
      next_session_start_at: "not-a-date",
      next_session_end_at: "2026-09-02T02:00:00Z",
    });
    const pending = makeSummary("pending", {
      created_at: "2026-08-03T01:00:00Z",
      current_stage_type: "screening",
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result",
      applied_at: "2026-08-03T02:00:00Z",
      next_session_start_at: "2026-09-01T01:00:00Z",
      next_session_end_at: "2026-09-01T02:00:00Z",
    });

    expect(sortApplications(
      [scheduledLate, noSchedule, pending, scheduledEarly, invalidSchedule, scheduledSameTimeOlder],
      "recent_schedule",
    ).map((item) => item.id)).toEqual([
      "scheduled-same-older",
      "scheduled-early",
      "scheduled-late",
      "no-schedule",
      "invalid-schedule",
      "pending",
    ]);
    expect(sortApplications(
      [scheduledLate, noSchedule, pending, scheduledEarly, invalidSchedule, scheduledSameTimeOlder],
      "earliest_added",
    ).map((item) => item.id)).toEqual([
      "no-schedule",
      "invalid-schedule",
      "pending",
      "scheduled-same-older",
      "scheduled-late",
      "scheduled-early",
    ]);
  });

  it("projects assessment and interview schedule labels from one injectable clock", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const makeScheduled = (startAt: string, endAt = "2026-09-10T01:00:00Z") => ({
      ...application,
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      next_session_start_at: startAt,
      next_session_end_at: endAt,
    });

    expect(applicationScheduleStatusLabel(makeScheduled("2026-09-04T01:00:00Z"), { now })).toBe("4 天后");
    expect(applicationScheduleStatusLabel(makeScheduled("2026-09-03T00:00:00Z"), { now })).toBe("2 天后");
    expect(applicationScheduleStatusLabel(makeScheduled("2026-09-02T00:00:00Z"), { now })).toBe("24 小时后");
    expect(applicationScheduleStatusLabel(makeScheduled("2026-08-31T23:30:00Z"), { now })).toBe("正在进行");
    expect(applicationScheduleStatusLabel(makeScheduled("2026-08-31T23:00:00Z", "2026-08-31T23:30:00Z"), { now })).toBe("等待结果");
    expect(applicationScheduleStatusLabel({
      ...makeScheduled("2026-09-10T00:00:00Z"),
      next_session_start_at: null,
      next_session_end_at: null,
    }, { now, currentStageCompleted: true })).toBe("等待结果");
    expect(applicationProgressLabel({
      ...makeScheduled("2026-09-10T00:00:00Z"),
      next_session_start_at: null,
      next_session_end_at: null,
    }, { now })).toBe("二面 · 进行中");
    expect(applicationProgressToneClass({
      ...makeScheduled("2026-09-10T00:00:00Z"),
      next_session_start_at: null,
      next_session_end_at: null,
    }, { now, currentStageCompleted: true })).toBe("is-success");
    expect(applicationProgressToneClass(makeScheduled("2026-08-31T23:00:00Z", "2026-08-31T23:30:00Z"), { now })).toBe("is-waiting");
  });

  it("keeps the board status concise while retaining stage context in the list", async () => {
    const now = new Date();
    const scheduledApplication = {
      ...application,
      next_session_start_at: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
      next_session_end_at: new Date(now.getTime() + 49 * 60 * 60 * 1000).toISOString(),
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [scheduledApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);

    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    expect(within(card).getByText("2 天后")).toBeInTheDocument();
    expect(within(card).queryByText("二面 · 2 天后")).not.toBeInTheDocument();
    switchToApplicationList();
    expect(await screen.findByLabelText("二面 · 2 天后")).toBeInTheDocument();
  });

  it("refreshes schedule status at the minute boundary and cleans up its clock", async () => {
    vi.useFakeTimers();
    const initialNow = new Date("2026-09-01T00:00:00Z");
    vi.setSystemTime(initialNow);
    const scheduledApplication = {
      ...application,
      next_session_start_at: "2026-09-01T00:30:00Z",
      next_session_end_at: "2026-09-01T01:30:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [scheduledApplication], next_cursor: null });

    const { unmount } = render(<InterviewCenterPage view="applications" />);
    await act(async () => {});
    switchToApplicationList();
    expect(screen.getByLabelText("二面 · 1 小时后")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(31 * 60 * 1000);
    });
    expect(screen.getByLabelText("二面 · 正在进行")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(screen.getByLabelText("二面 · 等待结果")).toBeInTheDocument();

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders the career module header before its subnavigation", () => {
    render(
      <InterviewCenterPage
        view="applications"
        navigation={<nav aria-label="测试求职子导航">岗位库 求职进程</nav>}
      />,
    );

    const heading = screen.getByRole("heading", { name: "求职中心" });
    const navigation = screen.getByRole("navigation", { name: "测试求职子导航" });
    expect(heading.closest("header")).toHaveClass("page-hero", "is-module", "career-module-header");
    expect(document.querySelector(".interview-module-header")).not.toBeInTheDocument();
    expect(heading.closest("header")?.compareDocumentPosition(navigation)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("uses the shared loading component while career data is pending", () => {
    mocks.listInterviewSessions.mockReturnValue(new Promise(() => {}));

    render(<InterviewCenterPage view="applications" />);

    expect(screen.getByRole("status", { name: "正在加载求职数据…" })).toHaveClass(
      "page-loading",
      "is-workspace",
    );
  });

  it("keeps a newly navigated application detail in loading state until its data resolves", async () => {
    const { rerender } = render(<InterviewCenterPage view="applications" />);
    await screen.findByRole("region", { name: "求职进程看板" });

    const newApplication = {
      ...application,
      id: "88",
      company_name_snapshot: "示例科技",
      job_title_snapshot: "平台工程师",
    };
    const applicationRequest = deferred<{
      items: typeof newApplication[];
      next_cursor: null;
    }>();
    mocks.listInterviewSessions.mockResolvedValueOnce({ items: [], next_cursor: null });
    mocks.listJobApplications.mockReturnValueOnce(applicationRequest.promise);

    rerender(<InterviewCenterPage view="applications" initialApplicationId="88" />);

    expect(screen.getByRole("status", { name: "正在加载求职数据…" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "无法打开这条求职进程" })).not.toBeInTheDocument();

    await act(async () => {
      applicationRequest.resolve({ items: [newApplication], next_cursor: null });
    });

    expect(await screen.findByRole("heading", { name: "示例科技，平台工程师" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "无法打开这条求职进程" })).not.toBeInTheDocument();
  });

  it("切换到面试排期时保留旧数据并避免回退到整页加载态", async () => {
    const { rerender } = render(<InterviewCenterPage view="applications" />);
    await screen.findByRole("region", { name: "求职进程看板" });

    const refresh = deferred<never>();
    mocks.listInterviewSessions.mockReturnValueOnce(refresh.promise);
    mocks.listJobApplications.mockReturnValueOnce(refresh.promise);
    rerender(<InterviewCenterPage view="schedule" />);

    expect(screen.queryByRole("status", { name: "正在加载求职数据…" })).not.toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /腾讯.*二面/ })).toBeInTheDocument();
  });

  it("renders the records empty state directly on the workspace background", async () => {
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [], next_cursor: null });

    const { container } = render(<InterviewCenterPage view="records" />);

    expect(await screen.findByRole("heading", { name: "还没有面试记录" })).toBeInTheDocument();
    expect(container.querySelector(".records-empty-state")).toBeInTheDocument();
    expect(container.querySelector(".interview-empty-state")).not.toBeInTheDocument();
    expect(container.querySelector(".records-empty-state.interview-surface")).not.toBeInTheDocument();
  });

  it("renders the full-day draggable schedule from API data", async () => {
    vi.spyOn(Date, "now").mockReturnValue(fixtureSessionStart.getTime() - 60_000);
    render(
      <InterviewCenterPage
        view="schedule"
        navigation={<nav className="career-subnav" aria-label="求职中心导航"><a href="/career/schedule">面试排期</a></nav>}
      />,
    );

    const calendar = await screen.findByRole("grid", {
      name: "面试周排期，可拖动并按 30 分钟调整",
    });
    const moduleHeader = document.querySelector(".career-module-header") as HTMLElement;
    expect(screen.queryByRole("heading", { name: "面试排期" })).not.toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "搜索面试排期" })).toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "安排面试" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "求职中心导航" });
    const dateControls = screen.getByRole("group", { name: "排期日期选择" });
    const viewControls = screen.getByRole("group", { name: "排期视图" });
    expect(navigation.parentElement).toHaveClass("career-view-navigation-row");
    expect(dateControls.parentElement).toBe(viewControls.parentElement);
    expect(dateControls.parentElement?.parentElement).toBe(navigation.parentElement);
    expect(dateControls.querySelector("strong")).not.toBeInTheDocument();
    expect(document.querySelector(".schedule-calendar-toolbar")).not.toBeInTheDocument();
    expect(within(calendar).getByText("00:00")).toBeInTheDocument();
    expect(within(calendar).getByText("23:00")).toBeInTheDocument();
    const event = within(calendar).getByRole("button", { name: /腾讯.*二面/ });
    expect(event).toHaveClass("calendar-blue");
    expect(Array.from(event.children).map((element) => element.className)).toEqual([
      "week-event-resize-edge is-start",
      "week-event-resize-edge is-end",
      "week-event-content",
    ]);
    fireEvent.click(event);
    const dialog = await screen.findByRole("dialog", { name: "面试详情" });
    expect(within(dialog).getByText("后端开发工程师")).toBeInTheDocument();
    expect(within(dialog).getByText("王老师（后端技术专家）")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "https://meeting.example/31" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "准备资料" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("interview.m4a")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "准备备注" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("准备缓存一致性与系统设计。")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("确认岗位要求与面试重点")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("确认会议设备、网络和面试时间")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0]);
    expect(screen.queryByRole("dialog", { name: "面试详情" })).not.toBeInTheDocument();

    expect(event).toHaveAttribute("draggable", "false");
  });

  it("omits empty preparation sections from the schedule detail dialog", async () => {
    vi.spyOn(Date, "now").mockReturnValue(fixtureSessionStart.getTime() - 60_000);
    mocks.getInterviewSession.mockResolvedValue({
      session: { ...session, preparation_note: null },
      application,
      assets: [],
    });
    render(<InterviewCenterPage view="schedule" />);

    const calendar = await screen.findByRole("grid", {
      name: "面试周排期，可拖动并按 30 分钟调整",
    });
    fireEvent.click(within(calendar).getByRole("button", { name: /腾讯.*二面/ }));

    const dialog = await screen.findByRole("dialog", { name: "面试详情" });
    await waitFor(() => expect(mocks.getInterviewSession).toHaveBeenCalledWith("31"));
    expect(within(dialog).queryByRole("heading", { name: "准备资料" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "准备备注" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("确认岗位要求与面试重点")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("确认会议设备、网络和面试时间")).not.toBeInTheDocument();
  });

  it("switches to the monthly schedule and opens creation from a blank day", async () => {
    render(<InterviewCenterPage view="schedule" />);

    await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
    fireEvent.click(screen.getByRole("button", { name: "月" }));

    const month = await screen.findByRole("grid", { name: /月面试排期$/ });
    expect(month).toBeInTheDocument();
    const blankDay = within(month).getAllByRole("gridcell")[10];
    fireEvent.doubleClick(blankDay);
    const dialog = await screen.findByRole("dialog", { name: "新建面试" });
    const draft = month.querySelector(".month-event-draft");
    expect(draft).toHaveClass("month-event-draft", "calendar-gray");
    expect(draft).toHaveTextContent("09:00待创建面试未保存");
    expect(within(dialog).getByText("暂无可以推进的求职流程")).toBeInTheDocument();
    expect(within(dialog).queryByRole("tab")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "我知道了" }));
    expect(month.querySelector(".month-event-draft")).not.toBeInTheDocument();
  });

  it("places a gray draft card immediately when the weekly calendar is double-clicked", async () => {
    render(<InterviewCenterPage view="schedule" />);

    const calendar = await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
    vi.spyOn(calendar, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 758,
      bottom: 1440,
      left: 0,
      width: 758,
      height: 1440,
      toJSON: () => ({}),
    });
    fireEvent.doubleClick(calendar, { clientX: 108, clientY: 600 });

    expect(await screen.findByRole("dialog", { name: "新建面试" })).toBeInTheDocument();
    const draft = calendar.querySelector(".week-event-draft");
    expect(draft).toHaveClass("week-event-draft", "calendar-gray");
    expect(draft).toHaveTextContent("待创建面试10:00 – 11:00未保存");
    expect(draft).toHaveStyle({ gridColumn: "2", gridRow: "21 / span 2" });
  });

  it("uses purple instead of gray for a third-round interview", async () => {
    mocks.listInterviewSessions.mockResolvedValue({
      items: [{
        ...session,
        id: "third-round",
        round_no: 3,
        stage_label: "三面",
        calendar_color: "gray" as const,
      }],
      next_cursor: null,
    });
    render(<InterviewCenterPage view="schedule" />);

    const thirdRound = await screen.findByRole("button", { name: /腾讯.*三面/ });
    expect(thirdRound).toHaveClass("calendar-purple");
    expect(thirdRound).not.toHaveClass("calendar-gray");
  });

  it("gives gray records a stable non-gray color in the monthly view", async () => {
    mocks.listInterviewSessions.mockResolvedValue({
      items: [{ ...session, calendar_color: "gray" as const }],
      next_cursor: null,
    });
    render(<InterviewCenterPage view="schedule" />);

    await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
    fireEvent.click(screen.getByRole("button", { name: "月" }));
    const month = await screen.findByRole("grid", { name: /月面试排期$/ });
    const record = within(month).getByRole("button", { name: /腾讯.*二面/ });
    expect(record).toHaveClass("calendar-red");
    expect(record).not.toHaveClass("calendar-gray");
  });

  it("keeps an empty schedule honest when the database has no sessions", async () => {
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });

    render(<InterviewCenterPage view="schedule" />);

    const calendar = await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
    expect(within(calendar).queryByRole("button", { name: /阿里巴巴.*二面/ })).not.toBeInTheDocument();
  });

  it("does not replace real schedule data with mock events when a search has no matches", async () => {
    render(<InterviewCenterPage view="schedule" />);

    fireEvent.click(await screen.findByRole("button", { name: "搜索面试排期" }));
    const search = screen.getByRole("searchbox", { name: "搜索面试排期" });
    fireEvent.change(search, { target: { value: "不存在的公司" } });

    const calendar = screen.getByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
    expect(within(calendar).queryByRole("button", { name: /腾讯.*二面/ })).not.toBeInTheDocument();
    expect(within(calendar).queryByRole("button", { name: /阿里巴巴.*二面/ })).not.toBeInTheDocument();
  });

  it("renders the default application board with hero search and import entry", async () => {
    mocks.listJobDescriptions.mockResolvedValue({
      items: [{
        id: "8",
        job_title: "后端开发工程师",
        company_name: "腾讯",
        work_city: "深圳",
        salary_text: "25-40K",
        skills: ["Java"],
        source_type: "manual",
        source_site: null,
        source_url: null,
        archived_at: null,
        lock_version: 1,
        updated_at: "2026-08-20T12:00:00Z",
      }],
      next_cursor: null,
    });
    mocks.createJobApplication.mockResolvedValue({ application });

    window.history.replaceState(null, "", "/career/applications");
    render(
      <InterviewCenterPage
        view="applications"
        navigation={(
          <nav className="career-subnav" aria-label="求职中心导航">
            <a href="/career/applications">求职记录</a>
            <a href="/career/schedule">面试排期</a>
          </nav>
        )}
      />,
    );

    expect(await screen.findByRole("region", { name: "求职进程看板" })).toBeInTheDocument();
    const moduleHeader = document.querySelector(".career-module-header") as HTMLElement;
    expect(screen.queryByRole("heading", { name: "求职进程" })).not.toBeInTheDocument();
    expect(within(moduleHeader).getByText("导入岗位，跟踪每一轮求职进展。")).toBeInTheDocument();
    const searchButton = within(moduleHeader).getByRole("button", { name: "搜索求职进程" });
    expect(searchButton).toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "安装采集插件" })).toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "导入岗位" })).toBeInTheDocument();
    expect(within(moduleHeader).queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();
    expect(within(moduleHeader).queryByRole("button", { name: "新建求职进程" })).not.toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "求职中心导航" });
    const viewControls = screen.getByRole("group", { name: "求职记录显示设置" });
    expect(navigation.parentElement).toHaveClass("career-view-navigation-row");
    expect(viewControls.parentElement).toBe(navigation.parentElement);
    expect(screen.queryByText("全部记录")).not.toBeInTheDocument();
    openViewSettings();
    const viewToggle = screen.getByRole("group", { name: "显示方式" });
    expect(viewToggle).toHaveTextContent("阶段看板");
    expect(viewToggle).not.toHaveAttribute("aria-pressed");
    expect(screen.getByRole("combobox", { name: "排序方式" })).toHaveTextContent("最近排期");
    expect(screen.queryByRole("table", { name: "求职记录列表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看记录" })).not.toBeInTheDocument();
    fireEvent.click(searchButton);
    const searchbox = within(moduleHeader).getByRole("searchbox", { name: "搜索求职进程" });
    expect(searchbox).toHaveAttribute("name", "career-application-search");
    fireEvent.change(searchbox, { target: { value: "腾讯" } });
    expect(screen.queryByText("全部记录")).not.toBeInTheDocument();
    fireEvent.change(searchbox, { target: { value: "" } });
    switchToApplicationList();
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.queryByRole("columnheader", { name: "操作" })).not.toBeInTheDocument();
    const recordRow = within(screen.getByRole("table", { name: "求职记录列表" })).getAllByRole("row")[1];
    expect(recordRow).toHaveAttribute("tabindex", "0");
    expect(recordRow).toHaveAttribute("aria-label", "查看 腾讯 · 后端开发工程师 的求职记录详情");
    fireEvent.click(within(moduleHeader).getByRole("button", { name: "导入岗位" }));
    expect(window.location.pathname).toBe("/career/applications");
    expect(screen.getByRole("dialog", { name: "导入岗位" })).toBeInTheDocument();
    expect(document.querySelector('table[aria-label="求职记录列表"]')).toBeInTheDocument();
  });

  it("从求职记录页头打开并关闭岗位采集插件说明", async () => {
    mocks.getPluginRelease.mockResolvedValue({ status: "unpublished", release: null });
    window.history.replaceState(null, "", "/career/applications");
    render(<InterviewCenterPage view="applications" />);

    switchToApplicationList();
    await screen.findByRole("table", { name: "求职记录列表" });
    fireEvent.click(screen.getByRole("button", { name: "安装采集插件" }));

    expect(await screen.findByRole("dialog", { name: "安装 LinkResume 岗位采集插件" })).toBeInTheDocument();
    expect(screen.getByText("暂未提供插件安装包。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭插件安装说明" }));
    expect(screen.queryByRole("dialog", { name: "安装 LinkResume 岗位采集插件" })).not.toBeInTheDocument();
  });

  it("在求职记录页内切换手工导入并关闭，不改变 URL 或列表背景", async () => {
    window.history.replaceState(null, "", "/career/applications");
    render(<InterviewCenterPage view="applications" />);

    switchToApplicationList();
    const table = await screen.findByRole("table", { name: "求职记录列表" });
    fireEvent.click(screen.getByRole("button", { name: "导入岗位" }));
    expect(window.location.pathname).toBe("/career/applications");
    expect(screen.getByRole("dialog", { name: "导入岗位" })).toBeInTheDocument();
    expect(screen.getByLabelText("岗位文字")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "粘贴岗位文字" })).toHaveAttribute("aria-selected", "true");
    expect(table).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "手工填写" }));
    expect(screen.getByRole("dialog", { name: "导入岗位" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "手工填写" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.pathname).toBe("/career/applications");
    expect(table).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.location.pathname).toBe("/career/applications");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(table).toBeInTheDocument();
  });

  it("在求职记录页内完成文本智能导入并回填岗位草稿", async () => {
    window.history.replaceState(null, "", "/career/applications");
    mocks.parseJobDescriptionDraft.mockResolvedValue({
      draft: {
        job_title: "平台工程师",
        company_name: "示例科技",
        description: "负责内部平台建设",
        skills: ["Kubernetes", "Go"],
      },
      warnings: ["请补充工作城市。"],
      inputType: "text",
      callId: "llmcall_inline_fixture",
    });

    render(<InterviewCenterPage view="applications" />);
    switchToApplicationList();
    const table = await screen.findByRole("table", { name: "求职记录列表" });
    fireEvent.click(screen.getByRole("button", { name: "导入岗位" }));
    expect(screen.getByRole("dialog", { name: "导入岗位" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("岗位文字"), {
      target: { value: "示例科技招聘平台工程师，负责内部平台建设" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));

    expect(await screen.findByDisplayValue("平台工程师")).toBeInTheDocument();
    expect(screen.getByDisplayValue("示例科技")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kubernetes, Go")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("请补充工作城市。");
    expect(screen.getByRole("dialog", { name: "导入岗位" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "手工填写" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.pathname).toBe("/career/applications");
    expect(table).toBeInTheDocument();
    expect(mocks.createJobDescription).not.toHaveBeenCalled();
  });

  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])("opens an application detail from a focused row with %s", async (_label, key) => {
    render(<InterviewCenterPage view="applications" />);

    switchToApplicationList();
    const table = await screen.findByRole("table", { name: "求职记录列表" });
    const recordRow = within(table).getAllByRole("row")[1];
    fireEvent.keyDown(recordRow, { key });

    expect(window.location.pathname).toBe("/career/applications/21");
  });

  it("opens an application detail from an ordinary table cell", async () => {
    render(<InterviewCenterPage view="applications" />);

    switchToApplicationList();
    const table = await screen.findByRole("table", { name: "求职记录列表" });
    const recordRow = within(table).getAllByRole("row")[1];
    fireEvent.click(within(recordRow).getByText("腾讯"));

    expect(window.location.pathname).toBe("/career/applications/21");
  });

  it("uses semantic text colors for application progress states", async () => {
    const makeProgressApplication = (id: string, overrides: Partial<JobApplicationSummary>) => ({
      ...application,
      id,
      company_name_snapshot: `状态公司 ${id}`,
      updated_at: `2026-08-${String(10 + Number(id)).padStart(2, "0")}T01:00:00Z`,
      ...overrides,
    });
    mocks.listJobApplications.mockResolvedValue({
      items: [
        makeProgressApplication("1", { current_stage_label: "一面", stage_state: "scheduled" }),
        makeProgressApplication("2", { current_stage_label: "二面", stage_state: "awaiting_schedule" }),
        makeProgressApplication("3", { current_stage_label: "终面", stage_state: "awaiting_result" }),
        makeProgressApplication("4", {
          current_stage_type: "offer",
          current_round_no: null,
          current_stage_label: "Offer 沟通",
          stage_state: "negotiating",
          offer_status: "received",
        }),
        makeProgressApplication("5", { current_stage_label: "Offer", status: "closed", offer_status: "accepted" }),
        makeProgressApplication("6", { current_stage_label: "筛选中", status: "rejected" }),
        makeProgressApplication("7", {
          current_stage_type: "screening",
          current_round_no: null,
          current_stage_label: "assessment · 在线作业",
          stage_state: "awaiting_schedule",
          applied_at: "2026-08-22T04:00:00Z",
        }),
        makeProgressApplication("8", {
          current_stage_type: "screening",
          current_round_no: null,
          current_stage_label: "在线笔试",
          stage_state: "awaiting_schedule",
          applied_at: "2026-08-22T04:00:00Z",
        }),
        makeProgressApplication("9", {
          company_name_snapshot: "已完成笔试公司",
          job_title_snapshot: "已完成笔试岗位",
          current_stage_type: "screening",
          current_round_no: null,
          current_stage_label: "笔试",
          stage_state: "awaiting_result",
          applied_at: "2026-08-22T04:00:00Z",
        }),
      ],
      next_cursor: null,
    });
    mocks.listInterviewSessions.mockResolvedValue({
      items: [{
        ...session,
        id: "39",
        application_id: "9",
        stage_type: "other",
        round_no: null,
        stage_label: "笔试",
        status: "completed",
      }],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="applications" />);

    switchToApplicationList();
    expect(await screen.findByLabelText("一面 · 进行中")).toHaveClass("is-active");
    expect(screen.getByLabelText("二面 · 等待安排")).toHaveClass("is-scheduled");
    expect(screen.getByLabelText("终面 · 等待结果")).toHaveClass("is-waiting");
    expect(screen.getAllByLabelText("已收到 Offer")).toHaveLength(2);
    for (const label of screen.getAllByLabelText("已收到 Offer")) {
      expect(label).toHaveClass("is-offer");
    }
    expect(screen.getByLabelText("筛选中 · 未通过")).toHaveClass("is-danger");
    expect(screen.getByLabelText("assessment · 在线作业 · 等待安排")).toHaveClass("is-scheduled");
    expect(screen.getByLabelText("在线笔试 · 等待安排")).toHaveClass("is-scheduled");
    expect(screen.getByLabelText("笔试 · 等待结果")).toHaveClass("is-success");

    switchToApplicationBoard();
    const completedAssessmentCard = screen.getByRole("article", { name: "已完成笔试公司 已完成笔试岗位" });
    expect(within(completedAssessmentCard).getByText("等待结果")).toHaveClass("is-success");
    expect(completedAssessmentCard.querySelector(".progress-card-updated-at")).not.toBeInTheDocument();
  });

  it("projects an accepted Offer into the Offer stage with a stable success label", () => {
    const acceptedOffer = {
      ...application,
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      status: "closed" as const,
      offer_status: "accepted" as const,
    };

    expect(projectApplicationProgress(acceptedOffer)).toMatchObject({
      columnKey: "offer",
      stageLabel: "Offer",
      statusLabel: "已收到 Offer",
      primaryLabel: "已收到 Offer",
      isPending: false,
      isWaiting: false,
      isAssessment: false,
    });
    expect(applicationProgressToneClass(acceptedOffer)).toBe("is-offer");
  });

  it.each([
    ["none", "Offer 状态待确认"],
    ["received", "已收到 Offer"],
    ["accepted", "已收到 Offer"],
    ["declined", "已主动结束"],
  ] as const)("projects Offer status %s as %s", (status, label) => {
    expect(offerStatusLabel(status)).toBe(label);
  });

  it("renders the real empty state without summary metrics or example data", async () => {
    mocks.listJobApplications.mockResolvedValue({ items: [], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);

    expect(await screen.findByRole("heading", { name: "还没有求职进程" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "求职进程" })).not.toBeInTheDocument();
    for (const label of ["进行中的进程", "本周待面试", "待跟进", "已拿 Offer"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("展示数据")).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /算法工程师|产品经理|开发工程师|数据分析师/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建第一条求职进程" })).toBeInTheDocument();
  });

  it("sorts the application list by schedule or creation and toggles board view", async () => {
    const olderSession = {
      ...session,
      id: "32",
      start_at: new Date(fixtureSessionStart.getTime() - 60 * 60 * 1000).toISOString(),
      end_at: new Date(fixtureSessionEnd.getTime() - 60 * 60 * 1000).toISOString(),
      status: "completed" as const,
      review_summary: "较早复盘",
    };
    const latestSession = {
      ...session,
      id: "33",
      start_at: new Date(fixtureSessionStart.getTime() + 60 * 60 * 1000).toISOString(),
      end_at: new Date(fixtureSessionEnd.getTime() + 60 * 60 * 1000).toISOString(),
      status: "completed" as const,
      stage_label: "终面",
      review_summary: "完成复盘",
    };
    const olderApplication = {
      ...application,
      id: "22",
      company_name_snapshot: "旧公司",
      job_title_snapshot: "旧岗位",
      created_at: "2026-08-16T01:00:00Z",
      updated_at: "2026-08-17T01:00:00Z",
      next_session_id: null,
      next_session_start_at: null,
      next_session_end_at: null,
      next_session_mode: null,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [olderSession, latestSession], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({
      items: [
        { ...application, next_session_id: latestSession.id, next_session_start_at: latestSession.start_at, next_session_end_at: latestSession.end_at, next_session_mode: "video" },
        olderApplication,
      ],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="applications" />);

    expect(await screen.findByRole("region", { name: "求职进程看板" })).toBeInTheDocument();
    expect(within(openViewSettings()).getByRole("group", { name: "显示方式" })).toHaveTextContent("阶段看板");
    switchToApplicationList();
    const table = await screen.findByRole("table", { name: "求职记录列表" });
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    const firstRow = within(table).getAllByRole("row")[1];
    expect(firstRow).toHaveTextContent("腾讯");
    expect(firstRow).toHaveTextContent("后端开发工程师");
    expect(firstRow).toHaveTextContent("二面");
    expect(firstRow).not.toHaveTextContent("终面 · 已完成");
    expect(firstRow).toHaveTextContent("未投递");

    chooseSelectOption(openViewSettings(), "排序方式", "最先添加");
    expect(screen.getByRole("combobox", { name: "排序方式" })).toHaveTextContent("最先添加");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("旧公司");

    switchToApplicationBoard();
    expect(screen.queryByRole("table", { name: "求职记录列表" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "求职进程看板" })).toBeInTheDocument();
    expect(within(openViewSettings()).getByRole("group", { name: "显示方式" })).toHaveTextContent("阶段看板");
    expect(screen.queryByText("横向滑动查看更多阶段")).not.toBeInTheDocument();
    for (const label of ["进行中的进程", "本周待面试", "待跟进", "已拿 Offer"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }

    switchToApplicationList();
    expect(screen.getByRole("group", { name: "显示方式" })).toHaveTextContent("列表");
    expect(await screen.findByRole("table", { name: "求职记录列表" })).toBeInTheDocument();
    expect(screen.queryByText("进行中的进程")).not.toBeInTheDocument();
  });

  it("renders an application detail route as a standalone record page", async () => {
    const detailApplication = {
      ...application,
      applied_at: "2026-08-19T01:00:00Z",
      job_snapshot: {
        schema_version: 1,
        salary_text: "25-40K",
        work_city: "深圳",
        employment_type: "full_time",
        work_mode: "hybrid",
        description: "负责服务端系统设计与实现。",
        skills: ["Java", "系统设计"],
      },
    };
    mocks.listJobApplications.mockResolvedValue({ items: [detailApplication], next_cursor: null });

    render(
      <InterviewCenterPage
        view="applications"
        initialApplicationId="21"
        navigation={<nav aria-label="不应出现在详情页的求职导航">求职记录</nav>}
      />,
    );

    expect(await screen.findByRole("heading", { name: "求职进度" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "腾讯，后端开发工程师" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "岗位与求职信息" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "求职信息" })).toBeInTheDocument();
    const recordAction = screen.getByRole("button", { name: "填写面试记录" });
    expect(screen.getByRole("button", { name: "终止求职" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看面试记录" })).toBeInTheDocument();
    expect(document.querySelector('.career-interview-round-icon[data-record-kind="面试"]')).toBeInTheDocument();
    expect(document.querySelector('.career-interview-round-icon[data-record-kind="笔试"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "求职记录列表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "求职进程看板" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "求职中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "不应出现在详情页的求职导航" })).not.toBeInTheDocument();
    expect(mocks.getInterviewSession).not.toHaveBeenCalled();
    expect(mocks.listInterviewSessions).toHaveBeenCalledWith({
      include_archived: true,
      application_id: "21",
      cursor: undefined,
      limit: 500,
    });
    fireEvent.click(recordAction);
    expect(window.location.pathname).toBe("/career/applications/21");
    expect(window.location.search).toBe("?session=31");
    expect(window.history.state).toEqual({ careerSessionDialog: true });
  });

  it("opens an application session deep link as a record dialog over the application detail", async () => {
    window.history.replaceState(null, "", "/career/applications/21?session=31");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    const upcomingStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const upcomingSession = {
      ...session,
      start_at: upcomingStart.toISOString(),
      end_at: new Date(upcomingStart.getTime() + 60 * 60 * 1000).toISOString(),
    };
    mocks.getInterviewSession.mockResolvedValue({
      session: upcomingSession,
      application,
      assets: [],
    });

    const { rerender } = render(
      <InterviewCenterPage
        view="applications"
        initialApplicationId="21"
        initialSessionId="31"
        navigation={<nav aria-label="不应出现在详情页的求职导航">求职记录</nav>}
      />,
    );

    expect(await screen.findByRole("heading", { name: "求职进度", hidden: true })).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog", { name: "腾讯｜面试记录" });
    expect(within(dialog).getByText("二面 · 待进行")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "面试概况" })).toBeInTheDocument();
    expect(within(dialog).getByText("如何保证接口幂等？")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "添加面试内容" }).closest(".career-session-record-footer")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "完成本轮面试" }).closest(".career-session-record-footer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "腾讯，后端开发工程师", hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "求职中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "不应出现在详情页的求职导航" })).not.toBeInTheDocument();
    expect(mocks.getInterviewSession).toHaveBeenCalledWith("31");

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    await waitFor(() => expect(window.location.pathname).toBe("/career/applications/21"));
    expect(window.location.search).toBe("");
    expect(replaceStateSpy).toHaveBeenLastCalledWith(null, "", "/career/applications/21");
    replaceStateSpy.mockRestore();
    rerender(<InterviewCenterPage view="applications" initialApplicationId="21" />);
    expect(screen.queryByRole("dialog", { name: "腾讯｜面试记录" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "求职进度", hidden: true })).toBeInTheDocument();
  });

  it("pops an in-app record dialog entry so the next browser back returns to the list", async () => {
    window.history.replaceState(null, "", "/career/applications/21");
    window.history.pushState({ careerSessionDialog: true }, "", "/career/applications/21?session=31");
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    render(
      <InterviewCenterPage
        view="applications"
        initialApplicationId="21"
        initialSessionId="31"
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "腾讯｜面试记录" });
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    expect(backSpy).toHaveBeenCalledOnce();
    backSpy.mockRestore();
  });

  it("shows active applications a termination action and refreshes after confirmation", async () => {
    const activeApplication = {
      ...application,
      id: "78",
      lock_version: 4,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [activeApplication], next_cursor: null });
    mocks.closeJobApplication.mockResolvedValue({
      application: { ...activeApplication, status: "withdrawn" },
    });

    render(<InterviewCenterPage view="applications" initialApplicationId="78" />);

    fireEvent.click(await screen.findByRole("button", { name: "终止求职" }));
    const confirmation = await screen.findByRole("dialog", { name: "终止这条求职记录？" });
    expect(confirmation).toHaveTextContent("状态会变为“已主动结束”，笔试、面试和 Offer 历史仍保留。");
    fireEvent.click(within(confirmation).getByRole("button", { name: "确认终止" }));

    await waitFor(() => expect(mocks.terminateJobApplication).toHaveBeenCalledWith("78", {
      client_request_id: expect.any(String),
      reason: "user_withdrew",
      base_lock_version: 4,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "终止这条求职记录？" })).not.toBeInTheDocument());
    expect(mocks.listJobApplications.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps the termination confirmation open and shows the request error when termination fails", async () => {
    const activeApplication = {
      ...application,
      id: "79",
      lock_version: 4,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [activeApplication], next_cursor: null });
    mocks.terminateJobApplication.mockRejectedValue(new ApiRequestError(409, "INTERVIEW_EDIT_CONFLICT"));

    render(<InterviewCenterPage view="applications" initialApplicationId="79" />);

    fireEvent.click(await screen.findByRole("button", { name: "终止求职" }));
    const confirmation = await screen.findByRole("dialog", { name: "终止这条求职记录？" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "确认终止" }));

    await waitFor(() => expect(document.querySelector(".interview-error-notice")).toHaveTextContent(
      "这条面试已在其他页面更新，请刷新后再试",
    ));
    expect(mocks.terminateJobApplication).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "终止这条求职记录？" })).toBeInTheDocument();
  });

  it.each(["withdrawn", "rejected", "closed"] as const)(
    "does not show termination for a %s application",
    async (status) => {
      const inactiveApplication = {
        ...application,
        id: `inactive-${status}`,
        status,
      };
      mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
      mocks.listJobApplications.mockResolvedValue({ items: [inactiveApplication], next_cursor: null });

      render(<InterviewCenterPage view="applications" initialApplicationId={inactiveApplication.id} />);

      await screen.findByRole("heading", { name: "求职进度" });
      expect(screen.queryByRole("button", { name: "终止求职" })).not.toBeInTheDocument();
    },
  );

  it("does not show termination for an accepted Offer", async () => {
    const acceptedOfferApplication = {
      ...application,
      id: "inactive-accepted-offer",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      status: "closed" as const,
      offer_status: "accepted" as const,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [acceptedOfferApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId={acceptedOfferApplication.id} />);

    await screen.findByRole("heading", { name: "求职进度" });
    expect(screen.queryByRole("button", { name: "终止求职" })).not.toBeInTheDocument();
  });

  it("uses assessment wording throughout an assessment record card", async () => {
    const upcomingStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const assessmentSession = {
      ...session,
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
      start_at: upcomingStart.toISOString(),
      end_at: new Date(upcomingStart.getTime() + 60 * 60 * 1000).toISOString(),
    };
    const assessmentApplication = {
      ...application,
      applied_at: "2026-08-19T01:00:00Z",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [assessmentSession], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [assessmentApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    expect(await screen.findByRole("heading", { name: "笔试记录" })).toBeInTheDocument();
    const recordCard = document.querySelector(".career-interview-round-card") as HTMLElement;
    expect(within(recordCard).getByText("待进行")).toBeInTheDocument();
    expect(recordCard.querySelector('.career-interview-round-icon[data-record-kind="笔试"]')).toBeInTheDocument();
    expect(recordCard.querySelector('.career-interview-round-icon[data-record-kind="面试"]')).not.toBeInTheDocument();
    expect(screen.getByText("已添加文字记录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看笔试记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "填写笔试记录" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看面试记录" })).not.toBeInTheDocument();
    expect(screen.queryByText(/面试 · /)).not.toBeInTheDocument();
  });

  it("shows the next-stage action after the current assessment is completed", async () => {
    const assessmentSession = {
      ...session,
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
      status: "completed" as const,
      completed_at: "2026-09-08T03:00:00Z",
    };
    const assessmentApplication = {
      ...application,
      applied_at: "2026-08-19T01:00:00Z",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
      stage_state: "awaiting_result" as const,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [assessmentSession], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [assessmentApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    expect(await screen.findByRole("button", { name: "添加下一阶段" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记录笔试结果" })).not.toBeInTheDocument();
    const journey = screen.getByRole("list", { name: "当前阶段：笔试" });
    const assessmentStage = within(journey).getByText("笔试").closest("li");
    expect(assessmentStage).toHaveClass("is-done");
    expect(assessmentStage).not.toHaveClass("is-current");
  });

  it("orders journey stages by the schedule time entered by the user", async () => {
    const assessmentSession = {
      ...session,
      id: "39",
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
      status: "completed" as const,
      start_at: "2026-09-08T06:00:00Z",
      end_at: "2026-09-08T07:30:00Z",
      created_at: "2026-09-01T02:00:00Z",
    };
    const firstInterviewSession = {
      ...session,
      id: "40",
      stage_type: "interview" as const,
      round_no: 1,
      stage_label: "一面",
      status: "scheduled" as const,
      start_at: "2026-09-01T06:00:00Z",
      end_at: "2026-09-01T07:00:00Z",
      created_at: "2026-09-01T03:00:00Z",
    };
    const interviewApplication = {
      ...application,
      applied_at: "2026-09-01T01:00:00Z",
      current_stage_type: "interview" as const,
      current_round_no: 1,
      current_stage_label: "一面",
      stage_state: "scheduled" as const,
    };
    mocks.listInterviewSessions.mockResolvedValue({
      items: [firstInterviewSession, assessmentSession],
      next_cursor: null,
    });
    mocks.listJobApplications.mockResolvedValue({ items: [interviewApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    const journey = await screen.findByRole("list", { name: "当前阶段：一面" });
    expect(Array.from(journey.querySelectorAll("li strong"), (node) => node.textContent)).toEqual([
      "岗位已导入",
      "已投递",
      "一面",
      "笔试",
    ]);
  });

  it.each(["等待后续通知", "筛选中", "初筛", "复筛"])(
    "renders legacy %s as the canonical submitted screening detail",
    async (stageLabel) => {
      const waitingApplication = {
        ...application,
        id: stageLabel === "等待后续通知" ? "65" : "66",
        current_stage_type: "screening" as const,
        current_round_no: null,
        current_stage_label: stageLabel,
        stage_state: "awaiting_result" as const,
        applied_at: "2026-08-22T04:00:00Z",
        lock_version: 8,
      };
      mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
      mocks.listJobApplications.mockResolvedValue({ items: [waitingApplication], next_cursor: null });

      render(<InterviewCenterPage view="applications" initialApplicationId={waitingApplication.id} />);

      const journey = await screen.findByRole("list", { name: "当前阶段：筛选中" });
      expect(within(journey).getByText("已投递")).toBeInTheDocument();
      expect(within(journey).getByText("筛选中")).toBeInTheDocument();
      expect(screen.getByText("当前处于筛选中，收到明确通知后添加实际下一阶段。")).toBeInTheDocument();
      expect(screen.getByLabelText("筛选中")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "添加下一阶段" })).toBeInTheDocument();
    },
  );

  it("merges the current assessment stage with its scheduled session in the journey", async () => {
    const assessmentApplication = {
      ...application,
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
      stage_state: "scheduled" as const,
      applied_at: "2026-09-01T01:00:00Z",
      updated_at: "2026-09-01T02:00:00Z",
    };
    const assessmentSession = {
      ...session,
      id: "34",
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
      start_at: "2026-09-08T01:17:00Z",
      end_at: "2026-09-08T02:47:00Z",
    };
    mocks.listJobApplications.mockResolvedValue({ items: [assessmentApplication], next_cursor: null });
    mocks.listInterviewSessions.mockResolvedValue({ items: [assessmentSession], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    const journey = await screen.findByRole("list", { name: "当前阶段：笔试" });
    expect(within(journey).getAllByRole("listitem")).toHaveLength(3);
    expect(within(journey).getAllByText("笔试")).toHaveLength(1);
    expect(within(journey).getByText("2026年9月8日")).toBeInTheDocument();
  });

  it("adds and schedules an interview stage from the stage dialog", async () => {
    const awaitingResultApplication = {
      ...application,
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_result" as const,
      lock_version: 7,
    };
    mocks.listJobApplications.mockResolvedValue({ items: [awaitingResultApplication], next_cursor: null });
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.advanceJobApplication.mockResolvedValue({ application: awaitingResultApplication });
    mocks.createInterviewSession.mockResolvedValue({ session, application: awaitingResultApplication, assets: [] });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(dialog).getByRole("button", { name: "终止求职" })).toHaveClass("ui-button-transparent");
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveClass("ui-button-transparent");
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toHaveClass("ui-button-transparent");
    expect(within(dialog).getAllByRole("radio", { name: /测评|笔试|AI 面试|面试|Offer/ })).toHaveLength(5);
    expect(within(dialog).getByRole("radio", { name: "笔试" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).queryByRole("radio", { name: "筛选" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("筛选轮次")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("当前状态")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "开始时间" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("笔试链接或地点（选填）")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeEnabled();
    expect(dialog.querySelector("select")).not.toBeInTheDocument();
    expect(dialog.querySelector('input[type="datetime-local"], input[type="date"], input[type="time"]')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: "面试" }));
    expect(within(dialog).getByLabelText("面试轮次")).toHaveValue("");
    expect(within(dialog).getByLabelText("面试轮次")).toHaveAttribute("placeholder", "如：一面、业务面、HR 面");
    expect(within(dialog).getByLabelText("面试轮次（选填）")).toHaveValue(3);
    expect(within(dialog).queryByLabelText("当前状态")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "面试时间" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("面试链接或地点（选填）")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "时长" })).toHaveTextContent("60 分钟");
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("面试轮次"), { target: { value: "三面" } });
    fireEvent.change(within(dialog).getByLabelText("面试链接或地点（选填）"), { target: { value: "深圳科技园 3 号楼" } });
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeEnabled();
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
    chooseScheduleDateTime(dialog, "面试时间", "2026-09-10", "09", "30");
    chooseSelectOption(dialog, "时长", "90 分钟");
    chooseSelectOption(dialog, "方式", "现场面试");
    expect(within(dialog).getByRole("button", { name: "面试时间" })).toHaveTextContent("2026-09-10 09:30");
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("21", {
      client_request_id: expect.any(String),
      stage_type: "interview",
      interview_round_no: 3,
      stage_label: "三面",
      base_lock_version: 7,
    }));
    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledWith("21", expect.objectContaining({
      client_request_id: expect.any(String),
      stage_type: "interview",
      round_no: 3,
      stage_label: "三面",
      start_at: new Date("2026-09-10T09:30").toISOString(),
      end_at: new Date("2026-09-10T11:00").toISOString(),
      timezone: localTimezone,
      mode: "onsite",
      meeting_url: null,
      location: "深圳科技园 3 号楼",
    })));
    expect(mocks.advanceJobApplication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createInterviewSession.mock.invocationCallOrder[0],
    );
  });

  it("adds and schedules an assessment stage with a start time and completion window", async () => {
    const awaitingResultApplication = {
      ...application,
      id: "68",
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
      lock_version: 10,
    };
    mocks.listJobApplications.mockResolvedValue({ items: [awaitingResultApplication], next_cursor: null });
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.advanceJobApplication.mockResolvedValue({ application: awaitingResultApplication });
    mocks.createInterviewSession.mockResolvedValue({ session, application: awaitingResultApplication, assets: [] });

    render(<InterviewCenterPage view="applications" initialApplicationId="68" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "测评" }));
    expect(within(dialog).queryByLabelText("当前状态")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("测评链接（选填）")).toBeInTheDocument();
    expect(within(dialog).getByRole("radiogroup", { name: "完成期限" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "3 天" })).toHaveAttribute("aria-checked", "true");
    const today = new Date();
    const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(within(dialog).getByRole("button", { name: "测评开始时间" })).toHaveTextContent(`${todayValue} · 选择时间`);
    fireEvent.change(within(dialog).getByLabelText("测评链接（选填）"), { target: { value: "https://assessment.example/68" } });
    const schedulePicker = openScheduleDateTimePicker(dialog, "测评开始时间", "2026-09-12");
    expect(schedulePicker).toBeInTheDocument();
    expect(within(schedulePicker).queryByRole("textbox", { name: "时间" })).not.toBeInTheDocument();
    const hourPicker = within(schedulePicker).getByRole("listbox", { name: "小时" });
    const minutePicker = within(schedulePicker).getByRole("listbox", { name: "分钟" });
    expect(hourPicker).toHaveAttribute("aria-required", "true");
    expect(minutePicker).toHaveAttribute("aria-required", "true");
    expect(within(schedulePicker).getByRole("button", { name: "确定" })).toBeDisabled();
    fireEvent.click(within(hourPicker).getByRole("option", { name: "09 时" }));
    fireEvent.click(within(minutePicker).getByRole("option", { name: "17 分" }));
    expect(within(schedulePicker).getByRole("button", { name: "确定" })).toBeEnabled();
    fireEvent.click(within(schedulePicker).getByRole("button", { name: "确定" }));
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("68", {
      client_request_id: expect.any(String),
      stage_type: "assessment",
      base_lock_version: 10,
    }));
    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledWith("68", expect.objectContaining({
      client_request_id: expect.any(String),
      stage_type: "other",
      round_no: null,
      stage_label: "测评",
      start_at: new Date("2026-09-12T09:17").toISOString(),
      end_at: new Date("2026-09-15T09:17").toISOString(),
      timezone: localTimezone,
      mode: "video",
      meeting_url: "https://assessment.example/68",
      location: null,
    })));
    expect(mocks.advanceJobApplication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createInterviewSession.mock.invocationCallOrder[0],
    );
  });

  it("switches directly between assessment and written-test forms", async () => {
    const screeningApplication = {
      ...application,
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listJobApplications.mockResolvedValue({ items: [screeningApplication], next_cursor: null });
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "测评" }));
    expect(within(dialog).getByLabelText("测评链接（选填）")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "测评开始时间" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radiogroup", { name: "完成期限" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("radio", { name: "笔试" }));
    expect(within(dialog).getByRole("button", { name: "开始时间" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "结束时间" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("笔试链接或地点（选填）")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("测评链接（选填）")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("radiogroup", { name: "完成期限" })).not.toBeInTheDocument();
  });

  it("can add a stage without creating a schedule", async () => {
    const waitingApplication = {
      ...application,
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
      lock_version: 11,
    };
    mocks.listJobApplications.mockResolvedValue({
      items: [waitingApplication],
      next_cursor: null,
    });
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.addJobApplicationStage.mockResolvedValue({
      application: {
        ...waitingApplication,
        current_stage_label: "笔试",
        lock_version: 12,
      },
    });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(dialog).getByRole("radio", { name: "笔试" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("button", { name: "开始时间" })).toHaveTextContent("选择日期和时间");
    expect(within(dialog).getByRole("button", { name: "结束时间" })).toHaveTextContent("选择日期和时间");
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("21", {
      client_request_id: expect.any(String),
      stage_type: "written_test",
      base_lock_version: 11,
    }));
    expect(mocks.createInterviewSession).not.toHaveBeenCalled();
  });

  it("refreshes after the stage advances when saving its schedule fails", async () => {
    const awaitingResultApplication = {
      ...application,
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_result" as const,
      lock_version: 7,
    };
    mocks.listJobApplications.mockResolvedValue({ items: [awaitingResultApplication], next_cursor: null });
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.advanceJobApplication.mockResolvedValue({ application: awaitingResultApplication });
    mocks.createInterviewSession.mockRejectedValue(new Error("保存排期失败"));

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const stageDialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    fireEvent.click(within(stageDialog).getByRole("radio", { name: "测评" }));
    fireEvent.change(within(stageDialog).getByLabelText("测评链接（选填）"), { target: { value: "https://assessment.example/fail" } });
    chooseScheduleDateTime(stageDialog, "测评开始时间", "2026-09-10", "09", "30");
    fireEvent.click(within(stageDialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("阶段已添加，但排期保存失败，可从安排时间入口重试"));
    expect(mocks.advanceJobApplication).toHaveBeenCalledTimes(1);
    expect(mocks.createInterviewSession).toHaveBeenCalledTimes(1);
    expect(mocks.listJobApplications.mock.calls.length).toBeGreaterThan(1);
    expect(screen.queryByRole("dialog", { name: "添加下一阶段" })).not.toBeInTheDocument();
  });

  it("does not create a schedule when advancing the stage fails", async () => {
    const awaitingResultApplication = {
      ...application,
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_result" as const,
      lock_version: 7,
    };
    mocks.listJobApplications.mockResolvedValue({ items: [awaitingResultApplication], next_cursor: null });
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.advanceJobApplication.mockRejectedValue(new ApiRequestError(409, "INTERVIEW_EDIT_CONFLICT"));

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const stageDialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    fireEvent.click(within(stageDialog).getByRole("radio", { name: "测评" }));
    fireEvent.change(within(stageDialog).getByLabelText("测评链接（选填）"), { target: { value: "https://assessment.example/conflict" } });
    chooseScheduleDateTime(stageDialog, "测评开始时间", "2026-09-10", "09", "30");
    fireEvent.click(within(stageDialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(within(stageDialog).getByRole("alert")).toHaveTextContent("这条面试已在其他页面更新，请刷新后再试"));
    expect(mocks.advanceJobApplication).toHaveBeenCalledTimes(1);
    expect(mocks.createInterviewSession).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "添加下一阶段" })).toBeInTheDocument();
  });

  it("adds an Offer stage with optional details and the advanced lock version", async () => {
    const waitingApplication = {
      ...application,
      id: "69",
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_result" as const,
      lock_version: 7,
    };
    const advancedApplication = {
      ...waitingApplication,
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      offer_status: "none" as const,
      lock_version: 8,
    };
    const savedApplication = {
      ...advancedApplication,
      offer_status: "received" as const,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [waitingApplication], next_cursor: null });
    mocks.advanceJobApplication.mockResolvedValue({ application: advancedApplication });
    mocks.recordJobApplicationOffer.mockResolvedValue({ application: savedApplication });

    render(<InterviewCenterPage view="applications" initialApplicationId={waitingApplication.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(dialog).getAllByRole("radio", { name: /测评|笔试|AI 面试|面试|Offer/ })).toHaveLength(5);
    fireEvent.click(within(dialog).getByRole("radio", { name: "Offer" }));
    expect(within(dialog).getByRole("radio", { name: "Offer" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).queryByText("Offer 信息")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("全部选填")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("薪资结构")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Base")).toHaveValue("");
    expect(within(dialog).getByRole("spinbutton", { name: "薪资" })).toHaveValue(null);
    expect(within(dialog).getByRole("spinbutton", { name: "薪资" })).toHaveAttribute("step", "1000");
    expect(within(dialog).getByRole("button", { name: "薪资增加" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "薪资减少" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("币种")).toHaveValue("CNY");
    expect(within(dialog).getByRole("combobox", { name: "计薪周期" })).toHaveTextContent("月薪");
    expect(within(dialog).getByLabelText("福利待遇")).toHaveValue("");
    expect(within(dialog).queryByLabelText("测评开始时间")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("面试时间")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("面试链接或地点（选填）")).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("排期");
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(mocks.addJobApplicationStage).toHaveBeenCalledWith(waitingApplication.id, {
      client_request_id: expect.any(String),
      stage_type: "offer",
      base_lock_version: 7,
    }));
    await waitFor(() => expect(mocks.recordJobApplicationOffer).toHaveBeenCalledWith(
      waitingApplication.id,
      {
        base_lock_version: 8,
        base_location: null,
        salary: null,
        salary_currency: null,
        salary_period: null,
        benefits_description: null,
      },
    ));
    expect(mocks.advanceJobApplication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordJobApplicationOffer.mock.invocationCallOrder[0],
    );
    expect(mocks.createInterviewSession).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加下一阶段" })).not.toBeInTheDocument());
  });

  it("keeps the Offer dialog open and does not record its status when advancing fails", async () => {
    const waitingApplication = {
      ...application,
      id: "71",
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_result" as const,
      lock_version: 7,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [waitingApplication], next_cursor: null });
    mocks.advanceJobApplication.mockRejectedValue(new ApiRequestError(409, "INTERVIEW_EDIT_CONFLICT"));

    render(<InterviewCenterPage view="applications" initialApplicationId="71" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Offer" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "这条面试已在其他页面更新，请刷新后再试",
    ));
    expect(mocks.advanceJobApplication).toHaveBeenCalledTimes(1);
    expect(mocks.recordJobApplicationOffer).not.toHaveBeenCalled();
    expect(mocks.createInterviewSession).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "添加下一阶段" })).toBeInTheDocument();
  });

  it("closes and refreshes after entering Offer when status recording fails", async () => {
    const waitingApplication = {
      ...application,
      id: "72",
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_result" as const,
      lock_version: 7,
    };
    const advancedApplication = {
      ...waitingApplication,
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      lock_version: 9,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [waitingApplication], next_cursor: null });
    mocks.advanceJobApplication.mockResolvedValue({ application: advancedApplication });
    mocks.recordJobApplicationOffer.mockRejectedValue(new Error("状态保存失败"));

    render(<InterviewCenterPage view="applications" initialApplicationId="72" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Offer" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "已进入 Offer 阶段，但 Offer 状态保存失败，可从 Offer 信息入口重试",
    ));
    expect(mocks.advanceJobApplication).toHaveBeenCalledTimes(1);
    expect(mocks.recordJobApplicationOffer).toHaveBeenCalledWith("72", {
      base_lock_version: 9,
      base_location: null,
      salary: null,
      salary_currency: null,
      salary_period: null,
      benefits_description: null,
    });
    expect(mocks.createInterviewSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "添加下一阶段" })).not.toBeInTheDocument();
    expect(mocks.listJobApplications.mock.calls.length).toBeGreaterThan(1);
  });

  it("renders a standalone interview detail and saves pasted interview content", async () => {
    const completedSession = {
      ...session,
      status: "completed" as const,
      completed_at: "2026-08-27T03:00:00Z",
      review_summary: "沟通清晰，系统设计完整。",
      improvement_markdown: "继续补充容量评估。",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [completedSession], next_cursor: null });
    mocks.getInterviewSession.mockResolvedValue({
      session: completedSession,
      application,
      assets: [],
    });
    mocks.updateInterviewSession.mockResolvedValue({
      session: { ...completedSession, questions_markdown: "新的面试文字记录" },
      application,
      assets: [],
    });

    render(
      <InterviewCenterPage
        view="records"
        initialApplicationId="21"
        initialSessionId="31"
        navigation={<nav aria-label="不应出现在面试详情页的求职导航">面试记录</nav>}
      />,
    );

    expect(await screen.findByRole("heading", { name: "腾讯", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "面试记录", level: 1 })).toBeInTheDocument();
    const addContentAction = screen.getByRole("button", { name: "添加面试内容" });
    const recordHero = addContentAction.closest("header") as HTMLElement;
    expect(recordHero).toHaveClass("career-session-record-hero");
    expect(screen.queryByRole("button", { name: "取消面试" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "归档进程" })).not.toBeInTheDocument();
    expect(within(recordHero).queryByRole("button", { name: "删除记录" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "面试概况" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "面试记录", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("支持上传音频或粘贴文字")).toBeInTheDocument();
    expect(await screen.findByText("如何保证接口幂等？")).toBeInTheDocument();
    expect(screen.queryByText("尚未添加面试内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除记录" })).toBeInTheDocument();
    expect(within(recordHero).queryByRole("button", { name: "编辑记录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "面试评价与复盘" })).not.toBeInTheDocument();
    expect(screen.queryByText("沟通清晰，系统设计完整。")).not.toBeInTheDocument();
    expect(screen.queryByText("继续补充容量评估。")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "求职记录列表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "求职中心" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "不应出现在面试详情页的求职导航" })).not.toBeInTheDocument();
    expect(mocks.getInterviewSession).toHaveBeenCalledWith("31");
    expect(mocks.listInterviewSessions).toHaveBeenCalledWith({
      include_archived: true,
      application_id: "21",
      cursor: undefined,
      limit: 500,
    });

    fireEvent.click(screen.getByRole("button", { name: "添加面试内容" }));
    const dialog = await screen.findByRole("dialog", { name: "添加面试内容" });
    const fileInput = within(dialog).getByLabelText("音频文件");
    expect(fileInput).toHaveAttribute("accept", expect.stringContaining("audio/*"));
    expect(fileInput).not.toHaveAttribute("accept", expect.stringContaining(".pdf"));
    fireEvent.click(within(dialog).getByRole("tab", { name: "粘贴文字" }));
    fireEvent.change(within(dialog).getByPlaceholderText("粘贴面试过程、逐字稿或整理后的文字记录…"), {
      target: { value: "新的面试文字记录" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存内容" }));

    await waitFor(() => expect(mocks.updateInterviewSession).toHaveBeenCalledWith("31", {
      questions_markdown: "新的面试文字记录",
      base_lock_version: 2,
    }));
  });

  it("uses the company name and assessment record title for assessment details", async () => {
    const assessmentSession = {
      ...session,
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
      questions_markdown: null,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [assessmentSession], next_cursor: null });
    mocks.getInterviewSession.mockResolvedValue({ session: assessmentSession, application, assets: [] });

    render(<InterviewCenterPage view="records" initialApplicationId="21" initialSessionId="31" />);

    expect(await screen.findByRole("heading", { name: "腾讯", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "笔试记录", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "面试记录", level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加笔试内容" }).closest("header")).toHaveClass("career-session-record-hero");
    expect(screen.getByRole("button", { name: "完成笔试" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "笔试概况" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "笔试记录", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("笔试名称")).toBeInTheDocument();
    expect(screen.getByText("尚未添加笔试内容")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开笔试链接" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打开会议链接" })).not.toBeInTheDocument();
  });

  it("does not show the next-stage action inside a completed assessment detail", async () => {
    const assessmentSession = {
      ...session,
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
      status: "completed" as const,
      completed_at: "2026-08-27T03:00:00Z",
    };
    const awaitingResultApplication = {
      ...application,
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
      stage_state: "awaiting_result" as const,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [assessmentSession], next_cursor: null });
    mocks.getInterviewSession.mockResolvedValue({
      session: assessmentSession,
      application: awaitingResultApplication,
      assets: [],
    });

    render(<InterviewCenterPage view="records" initialApplicationId="21" initialSessionId="31" />);

    expect(await screen.findByRole("heading", { name: "笔试概况" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加下一阶段" })).not.toBeInTheDocument();
    expect(document.querySelector(".career-session-stage-action")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成笔试" })).not.toBeInTheDocument();
  });

  it("prefills and saves existing interview text from the edit action", async () => {
    const savedText = "已保存的面试文字记录";
    const editedText = "更新后的面试文字记录";
    const detailSession = { ...session, questions_markdown: savedText };
    mocks.getInterviewSession.mockResolvedValue({ session: detailSession, application, assets: [] });
    mocks.updateInterviewSession.mockResolvedValue({
      session: { ...detailSession, questions_markdown: editedText, lock_version: detailSession.lock_version + 1 },
      application,
      assets: [],
    });

    render(<InterviewCenterPage view="records" initialApplicationId="21" initialSessionId="31" />);

    expect(await screen.findByText(savedText)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑记录" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑面试文字记录" });
    const textInput = within(dialog).getByRole("textbox");
    expect(textInput).toHaveValue(savedText);
    fireEvent.change(textInput, { target: { value: editedText } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(mocks.updateInterviewSession).toHaveBeenCalledWith("31", {
      questions_markdown: editedText,
      base_lock_version: 2,
    }));
  });

  it("confirms before deleting an interview text record and sends null", async () => {
    mocks.getInterviewSession.mockResolvedValue({ session, application, assets: [] });
    mocks.updateInterviewSession.mockResolvedValue({
      session: { ...session, questions_markdown: null, lock_version: session.lock_version + 1 },
      application,
      assets: [],
    });

    render(<InterviewCenterPage view="records" initialApplicationId="21" initialSessionId="31" />);

    expect(await screen.findByText("如何保证接口幂等？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "删除面试文字记录？" });
    expect(mocks.updateInterviewSession).not.toHaveBeenCalled();

    fireEvent.click(within(confirmation).getByRole("button", { name: "删除记录" }));

    await waitFor(() => expect(mocks.updateInterviewSession).toHaveBeenCalledWith("31", {
      questions_markdown: null,
      base_lock_version: 2,
    }));
  });

  it("does not delete an interview text record when confirmation is cancelled", async () => {
    mocks.getInterviewSession.mockResolvedValue({ session, application, assets: [] });

    render(<InterviewCenterPage view="records" initialApplicationId="21" initialSessionId="31" />);

    expect(await screen.findByText("如何保证接口幂等？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "删除面试文字记录？" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("alertdialog", { name: "删除面试文字记录？" })).not.toBeInTheDocument();
    expect(mocks.updateInterviewSession).not.toHaveBeenCalled();
  });

  it("accepts an audio drop and uploads only the audio content", async () => {
    mocks.getInterviewSession.mockResolvedValue({ session, application, assets: [] });
    mocks.uploadInterviewAsset.mockResolvedValue({ asset: { id: "42" } });

    render(<InterviewCenterPage view="records" initialApplicationId="21" initialSessionId="31" />);

    expect(await screen.findByRole("heading", { name: "面试概况" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加面试内容" }));
    const dialog = await screen.findByRole("dialog", { name: "添加面试内容" });
    const dropzone = dialog.querySelector(".career-content-dropzone") as HTMLElement;
    const audioFile = new File(["audio"], "interview.mp3", { type: "audio/mpeg" });

    fireEvent.dragOver(dropzone, { dataTransfer: {} });
    expect(dropzone).toHaveClass("is-dragging");
    fireEvent.drop(dropzone, { dataTransfer: { files: [audioFile] } });

    expect(dropzone).toHaveTextContent("interview.mp3");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存内容" }));

    await waitFor(() => expect(mocks.uploadInterviewAsset).toHaveBeenCalledWith("31", audioFile, "uploaded"));
    expect(mocks.updateInterviewSession).not.toHaveBeenCalled();
  });

  it("rejects non-audio files and clears the audio source when switching to text", async () => {
    mocks.getInterviewSession.mockResolvedValue({ session, application, assets: [] });
    mocks.updateInterviewSession.mockResolvedValue({ session, application, assets: [] });

    render(<InterviewCenterPage view="records" initialApplicationId="21" initialSessionId="31" />);

    expect(await screen.findByRole("heading", { name: "面试概况" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加面试内容" }));
    const dialog = await screen.findByRole("dialog", { name: "添加面试内容" });
    const fileInput = within(dialog).getByLabelText("音频文件");
    const dropzone = dialog.querySelector(".career-content-dropzone") as HTMLElement;
    const invalidFile = new File(["notes"], "notes.pdf", { type: "application/pdf" });
    const audioFile = new File(["audio"], "interview.m4a", { type: "audio/mp4" });

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });
    await waitFor(() => expect(document.querySelector(".interview-error-notice")).toHaveTextContent("仅支持音频文件"));
    expect(dropzone).toHaveTextContent("点击选择或拖放音频文件");

    fireEvent.change(fileInput, { target: { files: [audioFile] } });
    expect(dropzone).toHaveTextContent("interview.m4a");
    fireEvent.click(within(dialog).getByRole("tab", { name: "粘贴文字" }));
    const textInput = within(dialog).getByPlaceholderText("粘贴面试过程、逐字稿或整理后的文字记录…");
    fireEvent.change(textInput, { target: { value: "新的面试文字记录" } });

    expect(within(dialog).queryByLabelText("音频文件")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存内容" }));

    await waitFor(() => expect(mocks.updateInterviewSession).toHaveBeenCalledWith("31", {
      questions_markdown: "新的面试文字记录",
      base_lock_version: 2,
    }));
    expect(mocks.uploadInterviewAsset).not.toHaveBeenCalled();
  });

  it("completes a scheduled interview through the existing completion API", async () => {
    mocks.getInterviewSession.mockResolvedValue({ session, application, assets: [] });
    mocks.completeInterviewSession.mockResolvedValue({
      session: { ...session, status: "completed", completed_at: "2026-08-27T03:00:00Z" },
      application,
      assets: [],
    });

    render(<InterviewCenterPage view="records" initialApplicationId="21" initialSessionId="31" />);

    expect(await screen.findByRole("heading", { name: "面试概况" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成本轮面试" }));
    const dialog = await screen.findByRole("dialog", { name: "完成二面" });
    expect(dialog).toHaveTextContent("完成后可以继续补充音频或文字记录。");
    fireEvent.click(within(dialog).getByRole("button", { name: "完成本轮面试" }));

    await waitFor(() => expect(mocks.completeInterviewSession).toHaveBeenCalledWith("31", {
      questions_markdown: "如何保证接口幂等？",
      review_summary: "等待面试后填写。",
      improvement_markdown: "补充分布式事务边界。",
      base_lock_version: 2,
    }));
    await waitFor(() => expect(window.location.pathname).toBe("/career/applications/21"));
    expect(window.location.search).toBe("");
  });

  it("keeps the existing create dialog reachable from the application empty state", async () => {
    mocks.listJobApplications.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobDescriptions.mockResolvedValue({ items: [], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);

    fireEvent.click(await screen.findByRole("button", { name: "创建第一条求职进程" }));
    expect(await screen.findByRole("dialog", { name: "新建求职进程" })).toBeInTheDocument();
  });

  it("renders six real aggregate columns and projects legacy screening labels", async () => {
    const today = new Date();
    today.setHours(10, 20, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const makeApplication = (overrides: Partial<JobApplicationSummary>) => ({
      ...application,
      next_session_id: null,
      next_session_start_at: null,
      next_session_end_at: null,
      next_session_mode: null,
      ...overrides,
    });
    const pending = makeApplication({
      id: "41",
      company_name_snapshot: "待投公司",
      job_title_snapshot: "待投岗位",
      current_stage_type: "screening",
      current_round_no: null,
      current_stage_label: "待投递",
      stage_state: "awaiting_schedule",
      applied_at: null,
    });
    const screening = makeApplication({
      id: "46",
      company_name_snapshot: "筛选公司",
      job_title_snapshot: "筛选岗位",
      job_snapshot: { schema_version: 1, employment_type: "internship" },
      current_stage_type: "screening",
      current_round_no: null,
      current_stage_label: "筛选",
      stage_state: "scheduled",
      applied_at: "2026-08-22T04:00:00Z",
      updated_at: today.toISOString(),
    });
    const assessment = makeApplication({
      id: "47",
      company_name_snapshot: "笔试公司",
      job_title_snapshot: "笔试岗位",
      current_stage_type: "screening",
      current_round_no: null,
      current_stage_label: "测评中",
      stage_state: "scheduled",
      applied_at: "2026-08-22T05:00:00Z",
    });
    const interview = makeApplication({
      id: "42",
      job_snapshot: { schema_version: 1, employment_type: "full_time" },
      next_session_id: "31",
      next_session_start_at: session.start_at,
      next_session_end_at: session.end_at,
      next_session_mode: "video",
      updated_at: yesterday.toISOString(),
    });
    const waiting = makeApplication({
      id: "48",
      company_name_snapshot: "完成公司",
      job_title_snapshot: "完成岗位",
      current_stage_type: "interview",
      current_round_no: null,
      current_stage_label: "二面",
      stage_state: "awaiting_result",
      applied_at: "2026-08-22T06:00:00Z",
    });
    const firstInterview = makeApplication({
      id: "52",
      company_name_snapshot: "一面公司",
      job_title_snapshot: "一面岗位",
      current_stage_type: "interview",
      current_round_no: 1,
      current_stage_label: "一面",
      stage_state: "awaiting_schedule",
    });
    const hrInterview = makeApplication({
      id: "53",
      company_name_snapshot: "HR 公司",
      job_title_snapshot: "HR 岗位",
      current_stage_type: "hr",
      current_round_no: null,
      current_stage_label: "HR 面",
      stage_state: "scheduled",
    });
    const unnamedInterview = makeApplication({
      id: "54",
      company_name_snapshot: "旧数据公司",
      job_title_snapshot: "旧数据岗位",
      current_stage_type: "interview",
      current_round_no: null,
      current_stage_label: "   ",
      stage_state: "awaiting_result",
    });
    const defaultWaiting = makeApplication({
      id: "49",
      company_name_snapshot: "待通知公司",
      job_title_snapshot: "待通知岗位",
      current_stage_type: "screening",
      current_round_no: null,
      current_stage_label: "等待后续通知",
      stage_state: "awaiting_result",
      applied_at: "2026-08-22T07:00:00Z",
    });
    const offer = makeApplication({
      id: "50",
      company_name_snapshot: "Offer 公司",
      job_title_snapshot: "Offer 岗位",
      current_stage_type: "offer",
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating",
      offer_status: "received",
      applied_at: "2026-08-22T08:00:00Z",
    });
    const ended = makeApplication({
      id: "45",
      company_name_snapshot: "结束公司",
      job_title_snapshot: "结束岗位",
      job_snapshot: { schema_version: 1, employment_type: "unsupported" },
      current_stage_type: "screening",
      current_round_no: null,
      current_stage_label: "筛选中",
      status: "rejected",
      stage_state: "awaiting_result",
    });
    const withdrawn = makeApplication({
      id: "55",
      company_name_snapshot: "主动结束公司",
      job_title_snapshot: "主动结束岗位",
      current_stage_type: "offer",
      current_round_no: null,
      current_stage_label: "Offer",
      status: "withdrawn",
      stage_state: "awaiting_result",
    });
    const declinedOffer = makeApplication({
      id: "56",
      company_name_snapshot: "婉拒公司",
      job_title_snapshot: "婉拒岗位",
      current_stage_type: "offer",
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating",
      status: "closed",
      offer_status: "declined",
    });
    const acceptedOffer = makeApplication({
      id: "51",
      company_name_snapshot: "已接受公司",
      job_title_snapshot: "已接受岗位",
      current_stage_type: "offer",
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating",
      status: "closed",
      offer_status: "accepted",
      applied_at: "2026-08-22T09:00:00Z",
    });
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({
      items: [pending, screening, assessment, interview, waiting, firstInterview, hrInterview, unnamedInterview, defaultWaiting, offer, ended, withdrawn, declinedOffer, acceptedOffer],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="applications" />);

    await screen.findByRole("region", { name: "求职进程看板" });
    const columns = Array.from(document.querySelectorAll<HTMLElement>("[data-column-key]"));
    expect(columns.map((column) => column.dataset.columnKey)).toEqual([
      "pending",
      "screening",
      "assessment",
      "interview",
      "interview",
      "interview",
      "interview",
      "offer",
      "ended",
    ]);
    expect(columns.map((column) => within(column).getByRole("heading").textContent)).toEqual([
      "待投递1",
      "筛选中2",
      "笔试 / 测评1",
      "一面1",
      "二面2",
      "HR 面1",
      "面试中1",
      "Offer2",
      "已结束3",
    ]);
    expect(screen.queryByText("等待通知")).not.toBeInTheDocument();
    expect(screen.queryByText("横向滑动查看更多阶段")).not.toBeInTheDocument();

    const pendingCard = screen.getByRole("article", { name: "待投公司 待投岗位" });
    expect(within(pendingCard).getByText("等待确认投递")).toBeInTheDocument();
    expect(within(pendingCard).queryByText(/待投递 ·/)).not.toBeInTheDocument();

    const screeningCard = screen.getByRole("article", { name: "筛选公司 筛选岗位" });
    expect(screeningCard).toHaveAttribute("draggable", "true");
    expect(within(screeningCard).queryByText("实习")).not.toBeInTheDocument();
    expect(within(screeningCard).getByText("进行中")).toBeInTheDocument();
    expect(screeningCard.querySelector(".progress-card-updated-at")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "笔试公司 笔试岗位" })).toHaveAttribute("draggable", "true");
    expect(within(screen.getByRole("article", { name: "笔试公司 笔试岗位" })).getByText("进行中")).toBeInTheDocument();

    const interviewCard = screen.getByRole("article", { name: "腾讯 后端开发工程师" });
    expect(within(interviewCard).queryByText("全职")).not.toBeInTheDocument();
    expect(within(interviewCard).getByText(/^(\d+ 天后|\d+ 小时后|正在进行|等待结果)$/)).toBeInTheDocument();
    expect(interviewCard.querySelector(".progress-card-updated-at")).not.toBeInTheDocument();
    expect(interviewCard).toHaveAttribute("draggable", "true");

    const waitingCard = screen.getByRole("article", { name: "完成公司 完成岗位" });
    expect(within(waitingCard).getByText("等待结果")).toBeInTheDocument();
    expect(waitingCard).toHaveAttribute("draggable", "true");
    const submittedScreeningCard = screen.getByRole("article", { name: "待通知公司 待通知岗位" });
    expect(within(submittedScreeningCard).getByText("等待结果")).toBeInTheDocument();
    expect(submittedScreeningCard).toHaveAttribute("draggable", "true");

    const offerCard = screen.getByRole("article", { name: "Offer 公司 Offer 岗位" });
    expect(within(offerCard).getByText("已收到 Offer")).toBeInTheDocument();
    expect(offerCard).toHaveAttribute("draggable", "true");
    const interviewColumn = columns.find((column) => column.dataset.columnId === "interview:二面");
    const offerColumn = columns.find((column) => column.dataset.columnKey === "offer");
    expect(within(interviewColumn!).queryByRole("article", { name: "Offer 公司 Offer 岗位" })).not.toBeInTheDocument();
    expect(within(offerColumn!).getByRole("article", { name: "Offer 公司 Offer 岗位" })).toBe(offerCard);

    const endedCard = screen.getByRole("article", { name: "结束公司 结束岗位" });
    expect(within(endedCard).getByText("未通过")).toBeInTheDocument();
    expect(within(endedCard).queryByText("筛选中 · 未通过")).not.toBeInTheDocument();
    expect(within(endedCard).queryByText("校招")).not.toBeInTheDocument();
    expect(endedCard).toHaveAttribute("draggable", "true");
    const acceptedOfferCard = screen.getByRole("article", { name: "已接受公司 已接受岗位" });
    expect(within(acceptedOfferCard).getByText("已收到 Offer")).toBeInTheDocument();
    expect(acceptedOfferCard).toHaveAttribute("draggable", "true");
    expect(within(offerColumn!).getByRole("article", { name: "已接受公司 已接受岗位" })).toBe(acceptedOfferCard);
    const endedColumn = columns.find((column) => column.dataset.columnKey === "ended");
    expect(within(endedColumn!).queryByRole("article", { name: "已接受公司 已接受岗位" })).not.toBeInTheDocument();
    expect(within(endedColumn!).getByRole("article", { name: "主动结束公司 主动结束岗位" })).toHaveTextContent("已主动结束");
    expect(within(endedColumn!).getByRole("article", { name: "婉拒公司 婉拒岗位" })).toHaveTextContent("已主动结束");

    fireEvent.click(within(screeningCard).getByRole("button", { name: "查看 筛选公司 筛选岗位 求职进程" }));
    expect(window.location.pathname).toBe("/career/applications/46");
  });

  it("opens the card action menu with focus navigation and keeps actions separate from the card", async () => {
    const pendingApplication = {
      ...application,
      id: "menu-pending",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "待投递",
      stage_state: "awaiting_schedule" as const,
      applied_at: null,
      job_snapshot: { schema_version: 1, employment_type: "full_time" },
    };
    const otherApplication = {
      ...pendingApplication,
      id: "menu-other",
      company_name_snapshot: "另一家公司",
      job_title_snapshot: "另一岗位",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [pendingApplication, otherApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);
    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const trigger = within(card).getByRole("button", { name: "更多求职操作 腾讯 后端开发工程师" });

    fireEvent.click(trigger);
    const menu = within(card).getByRole("menu", { name: "腾讯 后端开发工程师 操作菜单" });
    const menuItems = within(menu).getAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual(["查看详情", "修改分类", "推进流程", "终止求职"]);
    expect(document.activeElement).toBe(menuItems[0]);

    fireEvent.keyDown(menuItems[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(menuItems[1]);
    fireEvent.keyDown(menuItems[1], { key: "End" });
    expect(document.activeElement).toBe(menuItems[3]);
    fireEvent.keyDown(menuItems[2], { key: "Home" });
    expect(document.activeElement).toBe(menuItems[0]);
    fireEvent.keyDown(menuItems[0], { key: "Escape" });
    expect(within(card).queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(within(card).queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const pathBeforeCardClick = window.location.pathname;
    const cardOpenButton = within(card).getByRole("button", { name: "查看 腾讯 后端开发工程师 求职进程" });
    fireEvent.pointerDown(cardOpenButton);
    fireEvent.click(cardOpenButton);
    expect(within(card).queryByRole("menu")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe(pathBeforeCardClick);

    fireEvent.click(trigger);
    const otherCard = screen.getByRole("article", { name: "另一家公司 另一岗位" });
    const otherCardOpenButton = within(otherCard).getByRole("button", { name: "查看 另一家公司 另一岗位 求职进程" });
    fireEvent.pointerDown(otherCardOpenButton);
    fireEvent.click(otherCardOpenButton);
    expect(within(card).queryByRole("menu")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe(pathBeforeCardClick);

    fireEvent.click(trigger);
    fireEvent.click(within(card).getByRole("menuitem", { name: "查看详情" }));
    expect(window.location.pathname).toBe("/career/applications/menu-pending");
  });

  it("routes card progression through the existing stage dialog for every active stage", async () => {
    const screeningApplication = {
      ...application,
      id: "menu-screening",
      company_name_snapshot: "筛选菜单公司",
      job_title_snapshot: "筛选菜单岗位",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    const assessmentApplication = {
      ...application,
      id: "menu-assessment",
      company_name_snapshot: "笔试菜单公司",
      job_title_snapshot: "笔试菜单岗位",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    const incompleteInterviewApplication = {
      ...application,
      id: "menu-incomplete",
      company_name_snapshot: "未完成菜单公司",
      job_title_snapshot: "未完成菜单岗位",
      stage_state: "scheduled" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    const assessmentSession = {
      ...session,
      id: "menu-assessment-session",
      application_id: assessmentApplication.id,
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
      status: "completed" as const,
      completed_at: "2026-08-22T06:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [assessmentSession], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({
      items: [screeningApplication, assessmentApplication, incompleteInterviewApplication],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="applications" />);
    switchToApplicationBoard();

    const screeningCard = await screen.findByRole("article", { name: "筛选菜单公司 筛选菜单岗位" });
    fireEvent.click(within(screeningCard).getByRole("button", { name: "更多求职操作 筛选菜单公司 筛选菜单岗位" }));
    fireEvent.click(within(screeningCard).getByRole("menuitem", { name: "推进流程" }));
    let dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(dialog).getByRole("radio", { name: "笔试" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    const assessmentCard = screen.getByRole("article", { name: "笔试菜单公司 笔试菜单岗位" });
    fireEvent.click(within(assessmentCard).getByRole("button", { name: "更多求职操作 笔试菜单公司 笔试菜单岗位" }));
    fireEvent.click(within(assessmentCard).getByRole("menuitem", { name: "推进流程" }));
    dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(dialog).getByRole("radio", { name: "面试" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText("面试轮次")).toHaveValue("一面");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    const incompleteCard = screen.getByRole("article", { name: "未完成菜单公司 未完成菜单岗位" });
    fireEvent.click(within(incompleteCard).getByRole("button", { name: "更多求职操作 未完成菜单公司 未完成菜单岗位" }));
    expect(within(incompleteCard).getByRole("menuitem", { name: "推进流程" })).toBeEnabled();
  });

  it("creates an unsubmitted screening process from the existing job library dialog", async () => {
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobDescriptions.mockResolvedValue({
      items: [{
        id: "8",
        job_title: "后端开发工程师",
        company_name: "腾讯",
        work_city: "深圳",
        salary_text: "25-40K",
        skills: ["Java"],
        source_type: "manual",
        source_site: null,
        source_url: null,
        archived_at: null,
        lock_version: 1,
        updated_at: "2026-08-20T12:00:00Z",
      }],
      next_cursor: null,
    });
    mocks.createJobApplication.mockResolvedValue({ application });

    render(<InterviewCenterPage view="applications" />);

    fireEvent.click(await screen.findByRole("button", { name: "创建第一条求职进程" }));
    await screen.findByRole("dialog", { name: "新建求职进程" });
    fireEvent.click(screen.getByRole("button", { name: "创建求职进程" }));
    await waitFor(() => expect(mocks.createJobApplication).toHaveBeenCalledWith(expect.objectContaining({
      job_description_id: "8",
      current_stage_type: "screening",
      current_round_no: null,
      current_stage_label: "待投递",
      stage_state: "awaiting_schedule",
      applied_at: null,
      resume_version_id: null,
    })));
  });

  it("opens the shared stage track with screening selected and the import date by default", async () => {
    const screeningApplication = {
      ...application,
      id: "58",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选",
      stage_state: "awaiting_result" as const,
      applied_at: null,
      lock_version: 9,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [screeningApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="58" />);

    const markAppliedButton = await screen.findByRole("button", { name: "投递岗位" });
    expect(markAppliedButton).toHaveClass("ui-button-transparent");
    expect(screen.getAllByText("待投递").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "更新筛选结果" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "当前阶段：待投递" })).not.toHaveTextContent("筛选中");
    fireEvent.click(markAppliedButton);
    const dialog = await screen.findByRole("dialog", { name: "投递岗位" });
    const screeningChoice = within(dialog).getByRole("radio", { name: "筛选中" });
    expect(screeningChoice).toHaveAttribute("aria-checked", "true");
    expect(screeningChoice.querySelector(".lucide-list-filter")).toBeInTheDocument();
    expect(screeningChoice.querySelector(".lucide-check")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(6);
    expect(within(dialog).getByRole("button", { name: "投递时间" })).toHaveTextContent("2026-08-17");
    expect(within(dialog).queryByRole("combobox", { name: "使用的简历" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("不选择简历也可以继续；选择后会自动绑定最新正式版本。")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("保存阶段后可继续添加日程安排；没有具体时间时无需填写。")).not.toBeInTheDocument();
    expect(within(dialog).getByText("保存后岗位将从待投递进入筛选中。")).toBeInTheDocument();
    const cancelButton = within(dialog).getByRole("button", { name: "取消" });
    const saveProgressButton = within(dialog).getByRole("button", { name: "保存求职进度" });
    expect(cancelButton).toHaveClass("ui-button-transparent");
    expect(saveProgressButton).toHaveClass("ui-button-transparent");
    expect(saveProgressButton).toBeEnabled();

    fireEvent.click(saveProgressButton);

    await waitFor(() => expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("58", {
      client_request_id: expect.any(String),
      stage_type: "screening",
      applied_at: new Date("2026-08-17T12:00:00").toISOString(),
      base_lock_version: 9,
    }));
  });

  it("allows clearing the default applied time and lets the backend use the operation time", async () => {
    const screeningApplication = {
      ...application,
      id: "61",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选",
      stage_state: "awaiting_result" as const,
      applied_at: null,
      lock_version: 12,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [screeningApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="61" />);

    fireEvent.click(await screen.findByRole("button", { name: "投递岗位" }));
    const dialog = await screen.findByRole("dialog", { name: "投递岗位" });
    const dateTrigger = within(dialog).getByRole("button", { name: "投递时间" });
    fireEvent.click(dateTrigger);
    const datePicker = within(dialog).getByRole("dialog", { name: "选择投递时间" });
    fireEvent.click(within(datePicker).getByRole("button", { name: "清除" }));
    expect(dateTrigger).toHaveTextContent("选择日期");
    fireEvent.click(within(dialog).getByRole("radio", { name: "笔试" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存求职进度" }));

    await waitFor(() => expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("61", {
      client_request_id: expect.any(String),
      stage_type: "written_test",
      base_lock_version: 12,
    }));
  });

  it("records a pending application directly into a named interview stage", async () => {
    const pendingApplication = {
      ...application,
      id: "59",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "待投递",
      stage_state: "awaiting_schedule" as const,
      applied_at: null,
      lock_version: 10,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [pendingApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="59" />);

    fireEvent.click(await screen.findByRole("button", { name: "投递岗位" }));
    const dialog = await screen.findByRole("dialog", { name: "投递岗位" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "面试" }));
    fireEvent.change(within(dialog).getByLabelText("面试轮次"), { target: { value: "一面" } });
    expect(within(dialog).getByLabelText("面试轮次（选填）")).toHaveValue(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "保存求职进度" }));

    await waitFor(() => expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("59", {
      client_request_id: expect.any(String),
      stage_type: "interview",
      stage_label: "一面",
      interview_round_no: 1,
      applied_at: new Date("2026-08-17T12:00:00").toISOString(),
      base_lock_version: 10,
    }));
  });

  it("uses the current stage in the single header scheduling action", async () => {
    const awaitingScheduleApplication = {
      ...application,
      id: "64",
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_schedule" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [awaitingScheduleApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="64" />);

    const headerAction = await screen.findByRole("button", { name: "安排二面时间" });
    expect(screen.getAllByRole("button", { name: "安排二面时间" })).toHaveLength(1);
    expect(within(document.querySelector(".career-interview-empty") as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记录二面结果" })).not.toBeInTheDocument();
    expect(headerAction).toBeInTheDocument();
  });

  it("opens the compact detail scheduling dialog and keeps session details mapped to the application", async () => {
    const awaitingScheduleApplication = {
      ...application,
      id: "64",
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "awaiting_schedule" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [awaitingScheduleApplication], next_cursor: null });
    mocks.createInterviewSession.mockResolvedValue({
      session: { ...session, id: "64-session", application_id: "64", stage_label: "二面" },
      application: { ...awaitingScheduleApplication, stage_state: "scheduled" },
      assets: [],
    });

    render(<InterviewCenterPage view="applications" initialApplicationId="64" />);

    fireEvent.click(await screen.findByRole("button", { name: "安排二面时间" }));
    const dialog = await screen.findByRole("dialog", { name: "添加求职阶段" });
    expect(within(dialog).getByText("选择阶段分类并补充本阶段信息，保存后会进入对应的求职流程。")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("求职进程")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("已有岗位档案")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("公司")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("岗位")).not.toBeInTheDocument();
    expect(dialog.querySelector('[aria-label="阶段分类"]')?.querySelectorAll("span")).toHaveLength(3);
    expect(within(dialog).getByText("面试", { selector: ".is-active" })).toHaveAttribute("aria-current", "step");
    expect(within(dialog).getByLabelText("展示名称")).toHaveValue("二面");
    expect(within(dialog).getByLabelText("面试轮次")).toHaveValue(2);
    expect(within(dialog).getByLabelText("当前状态")).toHaveValue("已安排");

    fireEvent.change(within(dialog).getByLabelText("链接或地点"), { target: { value: "https://meeting.example/detail" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledWith("64", expect.objectContaining({
      stage_type: "interview",
      round_no: 2,
      stage_label: "二面",
      mode: "video",
      meeting_url: "https://meeting.example/detail",
      location: null,
    })));
  });

  it("edits optional Offer details from the application header", async () => {
    const offerApplication = {
      ...application,
      id: "65",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      offer_status: "none" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [offerApplication], next_cursor: null });
    mocks.recordJobApplicationOffer.mockResolvedValue({ application: offerApplication });

    render(<InterviewCenterPage view="applications" initialApplicationId="65" />);

    expect(await screen.findByRole("button", { name: "终止求职" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Offer 信息" }));
    const dialog = await screen.findByRole("dialog", { name: "Offer 信息" });
    expect(dialog).toHaveTextContent("当前阶段：Offer");
    fireEvent.change(within(dialog).getByLabelText("Base"), { target: { value: "深圳" } });
    const salary = within(dialog).getByRole("spinbutton", { name: "薪资" });
    fireEvent.change(salary, { target: { value: "20000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "薪资增加" }));
    expect(salary).toHaveValue(21000);
    fireEvent.click(within(dialog).getByRole("button", { name: "薪资减少" }));
    expect(salary).toHaveValue(20000);
    fireEvent.change(within(dialog).getByLabelText("福利待遇"), { target: { value: "餐补、补充医疗" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.recordJobApplicationOffer).toHaveBeenCalledWith("65", {
      base_lock_version: 3,
      base_location: "深圳",
      salary: 20000,
      salary_currency: "CNY",
      salary_period: "month",
      benefits_description: "餐补、补充医疗",
    }));
    expect(mocks.recordJobApplicationOffer).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Offer 信息" })).not.toBeInTheDocument());
    expect(document.querySelector(".career-offer-actions")).not.toBeInTheDocument();
  });

  it("allows a received Offer to keep all details empty", async () => {
    const offerApplication = {
      ...application,
      id: "73",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      offer_status: "received" as const,
      lock_version: 5,
      applied_at: "2026-08-22T04:00:00Z",
    };
    const savedOfferApplication = {
      ...offerApplication,
      lock_version: 6,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [offerApplication], next_cursor: null });
    mocks.recordJobApplicationOffer.mockResolvedValue({ application: savedOfferApplication });

    render(<InterviewCenterPage view="applications" initialApplicationId="73" />);

    await screen.findByRole("heading", { name: "求职进度" });
    expect(screen.queryByRole("button", { name: "终止求职" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Offer 信息" }));
    const dialog = await screen.findByRole("dialog", { name: "Offer 信息" });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(mocks.recordJobApplicationOffer).toHaveBeenCalledWith(
      offerApplication.id,
      {
        base_lock_version: 5,
        base_location: null,
        salary: null,
        salary_currency: null,
        salary_period: null,
        benefits_description: null,
      },
    ));
    expect(mocks.recordJobApplicationOffer).toHaveBeenCalledTimes(1);
    expect(mocks.closeJobApplication).not.toHaveBeenCalled();
  });

  it("keeps the Offer details dialog open when saving fails", async () => {
    const offerApplication = {
      ...application,
      id: "76",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      offer_status: "received" as const,
      lock_version: 5,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [offerApplication], next_cursor: null });
    mocks.recordJobApplicationOffer.mockRejectedValue(new ApiRequestError(409, "INTERVIEW_EDIT_CONFLICT"));

    render(<InterviewCenterPage view="applications" initialApplicationId="76" />);

    fireEvent.click(await screen.findByRole("button", { name: "Offer 信息" }));
    const dialog = await screen.findByRole("dialog", { name: "Offer 信息" });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(document.querySelector(".interview-error-notice")).toHaveTextContent(
      "这条面试已在其他页面更新，请刷新后再试",
    ));
    expect(mocks.recordJobApplicationOffer).toHaveBeenCalledTimes(1);
    expect(mocks.closeJobApplication).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Offer 信息" })).toBeInTheDocument();
  });

  it("keeps Offer details editable but hides termination after receiving an Offer", async () => {
    const offerApplication = {
      ...application,
      id: "66",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      offer_status: "received" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [offerApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="66" />);

    await screen.findByRole("heading", { name: "求职进度" });
    expect(screen.getByRole("button", { name: "Offer 信息" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终止求职" })).not.toBeInTheDocument();
  });

  it("does not expose accepted or declined actions in the session detail Offer controls", async () => {
    const offerApplication = {
      ...application,
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      offer_status: "received" as const,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [session], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [offerApplication], next_cursor: null });
    mocks.getInterviewSession.mockResolvedValue({ session, application: offerApplication, assets: [] });

    render(<InterviewCenterPage view="records" />);

    const offerActions = await screen.findByRole("region", { name: "Offer 结果处理" });
    expect(within(offerActions).queryByRole("button", { name: "接受 Offer" })).not.toBeInTheDocument();
    expect(within(offerActions).queryByRole("button", { name: "婉拒 Offer" })).not.toBeInTheDocument();
    expect(within(offerActions).queryByRole("button", { name: "确认收到 Offer" })).not.toBeInTheDocument();
    expect(offerActions).toHaveTextContent("当前：已收到 Offer");
  });

  it("renders a received Offer with a crown above its dedicated journey node", async () => {
    const offerApplication = {
      ...application,
      id: "61",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer 沟通",
      stage_state: "negotiating" as const,
      offer_status: "received" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({
      items: [{
        ...session,
        application_id: "61",
        stage_type: "offer",
        round_no: null,
        stage_label: "Offer 沟通",
        status: "scheduled",
      }],
      next_cursor: null,
    });
    mocks.listJobApplications.mockResolvedValue({ items: [offerApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="61" />);

    const journey = await screen.findByRole("list", { name: "当前阶段：已收到 Offer" });
    expect(within(journey).getByText("已收到 Offer")).toBeInTheDocument();
    expect(within(journey).queryByText("Offer 沟通")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "填写面试记录" })).not.toBeInTheDocument();
    expect(document.querySelector(".career-journey-progress li.is-offer > .career-journey-crown")).not.toBeInTheDocument();
    expect(document.querySelector(".career-journey-progress li.is-offer .career-journey-node .lucide-crown")).toBeInTheDocument();
  });

  it("uses the terminal journey state only after the application ends", async () => {
    const endedApplication = {
      ...application,
      id: "62",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      status: "rejected" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [endedApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="62" />);

    await screen.findByRole("list", { name: "当前阶段：筛选中" });
    expect(document.querySelector(".career-journey-progress li.is-ended .career-journey-node")).toHaveTextContent("!");
  });

  it("keeps a submitted application in canonical screening until the next stage is confirmed", async () => {
    const waitingApplication = {
      ...application,
      id: "63",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选",
      stage_state: "awaiting_result" as const,
      status: "active" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [waitingApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="63" />);

    await screen.findByRole("list", { name: "当前阶段：筛选中" });
    expect(document.querySelector(".career-application-status")).toHaveClass("is-active");
    expect(document.querySelector(".career-application-status")).toHaveTextContent("筛选中");
    expect(document.querySelector(".career-journey-progress li.is-current strong")).toHaveTextContent("筛选中");
    fireEvent.click(screen.getByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(dialog).getAllByRole("radio", { name: /测评|笔试|AI 面试|面试|Offer/ })).toHaveLength(5);
    expect(within(dialog).getByRole("radio", { name: "笔试" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).queryByRole("radio", { name: "筛选" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("筛选轮次")).not.toBeInTheDocument();
  });

  it("opens the next-stage dialog and prefills a selected free-form interview column", async () => {
    const screeningApplication = {
      ...application,
      id: "57",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
      lock_version: 4,
      next_session_id: null,
      next_session_start_at: null,
      next_session_end_at: null,
      next_session_mode: null,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    const hrApplication = {
      ...application,
      id: "58",
      company_name_snapshot: "HR 公司",
      current_round_no: 3,
      current_stage_label: "HR 面",
    };
    mocks.listJobApplications.mockResolvedValue({ items: [screeningApplication, hrApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);

    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const interviewColumn = document.querySelector('[data-column-id="interview:HR 面"]');
    expect(interviewColumn).toBeInTheDocument();
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("57"),
    } as unknown as DataTransfer;
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(interviewColumn as HTMLElement, { dataTransfer });
    expect(interviewColumn).toHaveClass("is-drop-target");
    fireEvent.drop(interviewColumn as HTMLElement, { dataTransfer });

    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(dialog).getByRole("radio", { name: "面试" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText("面试轮次")).toHaveValue("HR 面");
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
  });

  it("opens the existing applied dialog when a pending card is dropped into screening", async () => {
    const pendingApplication = {
      ...application,
      id: "90",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "待投递",
      stage_state: "awaiting_schedule" as const,
      applied_at: null,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [pendingApplication], next_cursor: null });
    render(<InterviewCenterPage view="applications" />);

    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const target = document.querySelector('[data-column-key="screening"]') as HTMLElement;
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: vi.fn().mockReturnValue("90") } as unknown as DataTransfer;
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    const dialog = await screen.findByRole("dialog", { name: "投递岗位" });
    expect(card).toHaveClass("is-dragging");
    expect(target.querySelector("[data-drop-placeholder]"))
      .toHaveAttribute("data-placeholder-index", "0");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(card).not.toHaveClass("is-dragging"));
    expect(target.querySelector("[data-drop-placeholder]")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "添加下一阶段" })).not.toBeInTheDocument();
  });

  it("allows a scheduled assessment to move directly to a later stage", async () => {
    const assessmentApplication = {
      ...application,
      id: "91",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
      stage_state: "scheduled" as const,
      applied_at: "2026-08-22T04:00:00Z",
      lock_version: 6,
    };
    const assessmentSession = {
      ...session,
      id: "92",
      application_id: "91",
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
      status: "scheduled" as const,
      questions_markdown: null,
      review_summary: null,
      improvement_markdown: null,
      lock_version: 3,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [assessmentSession], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [assessmentApplication], next_cursor: null });
    render(<InterviewCenterPage view="applications" />);

    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    expect(card).toHaveAttribute("draggable", "true");
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 120,
      top: 120,
      right: 300,
      bottom: 238,
      left: 100,
      width: 200,
      height: 118,
      toJSON: () => ({}),
    });
    const target = document.querySelector('[data-column-key="interview"]') as HTMLElement;
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: vi.fn().mockReturnValue("91") } as unknown as DataTransfer;
    fireEvent.dragStart(card, { dataTransfer, clientX: 150, clientY: 150 });
    fireEvent.dragOver(target, { dataTransfer, clientX: 500, clientY: 300 });
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(target, { dataTransfer, clientX: 500, clientY: 300 });

    const stageDialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(stageDialog).getByRole("radio", { name: "面试" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.querySelector(".interview-error-notice")).not.toBeInTheDocument();
    expect(dataTransfer.dropEffect).toBe("move");
    expect(card).toHaveClass("is-dragging");
    expect(mocks.completeInterviewSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Offer 阶段",
      {
        current_stage_type: "offer" as const,
        current_round_no: null,
        current_stage_label: "Offer",
        stage_state: "negotiating" as const,
        offer_status: "received" as const,
      },
      "该求职流程已经进入 Offer 阶段，不能再拖入其他状态栏。",
    ],
    [
      "已结束流程",
      {
        current_stage_type: "screening" as const,
        current_round_no: null,
        current_stage_label: "筛选中",
        stage_state: "awaiting_result" as const,
        status: "rejected" as const,
      },
      "该求职流程已经结束，不能拖入其他状态栏。",
    ],
    [
      "已归档流程",
      {
        current_stage_type: "screening" as const,
        current_round_no: null,
        current_stage_label: "筛选中",
        stage_state: "awaiting_result" as const,
        archived_at: "2026-08-23T04:00:00Z",
      },
      "该求职流程已归档，不能拖入其他状态栏。",
    ],
  ])("lets %s be picked up and explains why another column rejects it", async (_, overrides, reason) => {
    const blockedApplication = {
      ...application,
      id: "blocked-drag",
      company_name_snapshot: "受限公司",
      job_title_snapshot: "受限岗位",
      applied_at: "2026-08-22T04:00:00Z",
      ...overrides,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [blockedApplication], next_cursor: null });
    render(<InterviewCenterPage view="applications" />);

    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "受限公司 受限岗位" });
    expect(card).toHaveAttribute("draggable", "true");
    const target = document.querySelector('[data-column-key="screening"]') as HTMLElement;
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("blocked-drag"),
    } as unknown as DataTransfer;

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(target).toHaveClass("is-invalid-drop-target");
    fireEvent.drop(target, { dataTransfer });

    expect(await screen.findByRole("alert")).toHaveTextContent(reason);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
  });

  it.each([
    ["assessment", "笔试"],
    ["offer", "Offer"],
  ] as const)("opens the %s form when a screening card is dropped there", async (columnKey, tabName) => {
    const screeningApplication = {
      ...application,
      id: "57",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [screeningApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);
    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const targetColumn = document.querySelector(`[data-column-key="${columnKey}"]`);
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("57"),
    } as unknown as DataTransfer;

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(targetColumn as HTMLElement, { dataTransfer });
    expect(targetColumn).toHaveClass("is-drop-target");
    fireEvent.drop(targetColumn as HTMLElement, { dataTransfer });

    const dialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(dialog).getByRole("radio", { name: tabName })).toHaveAttribute("aria-checked", "true");
    expect(card).toHaveClass("is-dragging");
    expect(targetColumn?.querySelector("[data-drop-placeholder]"))
      .toHaveAttribute("data-placeholder-index", "0");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(card).not.toHaveClass("is-dragging"));
    expect(targetColumn?.querySelector("[data-drop-placeholder]")).not.toBeInTheDocument();
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
  });

  it("does not call the advance API when an interview card stays in its aggregate column", async () => {
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [application], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);

    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const interviewColumn = document.querySelector('[data-column-key="interview"]');
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("21"),
    } as unknown as DataTransfer;
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(interviewColumn as HTMLElement, { dataTransfer });

    await waitFor(() => expect(mocks.advanceJobApplication).not.toHaveBeenCalled());
  });

  it("collapses the source card and keeps the drop placeholder at the target column head", async () => {
    const sourceApplication = {
      ...application,
      id: "drag-source",
      company_name_snapshot: "拖拽公司",
      job_title_snapshot: "源岗位",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    const firstTargetApplication = {
      ...application,
      id: "drop-first",
      company_name_snapshot: "目标公司",
      job_title_snapshot: "第一目标",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    const secondTargetApplication = {
      ...firstTargetApplication,
      id: "drop-second",
      job_title_snapshot: "第二目标",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({
      items: [sourceApplication, firstTargetApplication, secondTargetApplication],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="applications" />);
    switchToApplicationBoard();

    const sourceCard = await screen.findByRole("article", { name: "拖拽公司 源岗位" });
    const sourceColumn = document.querySelector('[data-column-key="screening"]') as HTMLElement;
    const targetColumn = document.querySelector('[data-column-key="assessment"]') as HTMLElement;
    const firstTargetCard = within(targetColumn).getByRole("article", { name: "目标公司 第一目标" });
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("drag-source"),
    } as unknown as DataTransfer;
    const dragOverAt = (clientY: number) => {
      const event = new Event("dragover", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      Object.defineProperty(event, "clientY", { value: clientY });
      fireEvent(targetColumn, event);
    };
    const dragLeaveTo = (node: HTMLElement, relatedTarget: EventTarget | null) => {
      const event = new Event("dragleave", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
      fireEvent(node, event);
    };

    fireEvent.dragStart(sourceCard, { dataTransfer });
    expect(sourceCard).toHaveClass("is-dragging");
    expect(screen.queryByRole("article", { name: "拖拽公司 源岗位" })).not.toBeInTheDocument();
    expect(sourceColumn.querySelector('[data-application-id="drag-source"]')).toBe(sourceCard);

    dragOverAt(120);
    expect(targetColumn.querySelector("[data-drop-placeholder]"))
      .toHaveAttribute("data-placeholder-index", "0");
    dragOverAt(250);
    expect(targetColumn.querySelector("[data-drop-placeholder]"))
      .toHaveAttribute("data-placeholder-index", "0");

    dragLeaveTo(firstTargetCard, document.body);
    expect(targetColumn.querySelector("[data-drop-placeholder]")).not.toBeInTheDocument();
    fireEvent.dragOver(sourceColumn, { dataTransfer });
    expect(sourceColumn.querySelector("[data-drop-placeholder]"))
      .toHaveClass("is-source-return");
    expect(sourceCard).toHaveClass("is-dragging");
    expect(screen.queryByRole("article", { name: "拖拽公司 源岗位" })).not.toBeInTheDocument();

    fireEvent.dragEnd(sourceCard, { dataTransfer });
    expect(sourceCard).not.toHaveClass("is-dragging");
    expect(screen.getByRole("article", { name: "拖拽公司 源岗位" })).toBeInTheDocument();
    expect(document.querySelector("[data-drop-placeholder]")).not.toBeInTheDocument();
  });

  it("silently cancels a screening drag after returning the card to its source column", async () => {
    const screeningApplication = {
      ...application,
      id: "57",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [screeningApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);
    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const pendingColumn = document.querySelector('[data-column-key="pending"]') as HTMLElement;
    const screeningColumn = document.querySelector('[data-column-key="screening"]') as HTMLElement;
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("57"),
    } as unknown as DataTransfer;

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(pendingColumn, { dataTransfer });
    expect(pendingColumn).toHaveClass("is-invalid-drop-target");
    fireEvent.dragOver(screeningColumn, { dataTransfer });
    expect(screeningColumn).not.toHaveClass("is-invalid-drop-target");
    fireEvent.drop(screeningColumn, { dataTransfer });
    fireEvent.dragEnd(card, { dataTransfer });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
  });

  it("allows an unfinished interview to move to a later user-defined round", async () => {
    const unfinishedSecondRound = {
      ...application,
      id: "57",
      current_stage_type: "interview" as const,
      current_round_no: 2,
      current_stage_label: "二面",
      stage_state: "scheduled" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    const thirdRoundApplication = {
      ...application,
      id: "58",
      company_name_snapshot: "三面公司",
      current_stage_type: "interview" as const,
      current_round_no: 3,
      current_stage_label: "三面",
    };
    mocks.listInterviewSessions.mockResolvedValue({
      items: [{ ...session, id: "93", application_id: "57", round_no: 2, stage_label: "二面", status: "scheduled" }],
      next_cursor: null,
    });
    mocks.listJobApplications.mockResolvedValue({ items: [unfinishedSecondRound, thirdRoundApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);
    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const target = document.querySelector('[data-column-id="interview:三面"]') as HTMLElement;
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("57"),
    } as unknown as DataTransfer;

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(target).toHaveClass("is-valid-drop-target");
    expect(dataTransfer.dropEffect).toBe("move");
    fireEvent.drop(target, { dataTransfer });

    const stageDialog = await screen.findByRole("dialog", { name: "添加下一阶段" });
    expect(within(stageDialog).getByLabelText("面试轮次")).toHaveValue("三面");
    expect(card).toHaveClass("is-dragging");
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
  });

  it("rejects dragging an interview back to an earlier custom interview column", async () => {
    const currentInterview = {
      ...application,
      id: "57",
      current_stage_type: "interview" as const,
      current_round_no: 3,
      current_stage_label: "HR 面",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
      lock_version: 4,
    };
    const earlierInterview = {
      ...application,
      id: "58",
      company_name_snapshot: "一面公司",
      current_stage_type: "interview" as const,
      current_round_no: 1,
      current_stage_label: "一面",
    };
    mocks.listInterviewSessions.mockResolvedValue({
      items: [{
        ...session,
        id: "93",
        application_id: "57",
        round_no: 3,
        stage_label: "HR 面",
        status: "completed",
        completed_at: "2026-08-22T06:00:00Z",
        application_stage_state: "awaiting_result",
      }],
      next_cursor: null,
    });
    mocks.listJobApplications.mockResolvedValue({ items: [currentInterview, earlierInterview], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);

    switchToApplicationBoard();
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const interviewColumn = document.querySelector('[data-column-id="interview:一面"]');
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("21"),
    } as unknown as DataTransfer;
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(interviewColumn as HTMLElement, { dataTransfer });
    expect(interviewColumn).toHaveClass("is-invalid-drop-target");
    fireEvent.drop(interviewColumn as HTMLElement, { dataTransfer });
    fireEvent.dragEnd(card, { dataTransfer });

    expect(await screen.findByRole("alert")).toHaveTextContent("不能拖回当前或更早的面试阶段");
    expect(screen.queryByRole("dialog", { name: "添加下一阶段" })).not.toBeInTheDocument();
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
  });

  it("moves a scheduled interview by half an hour without adding half-hour grid lines", async () => {
    const movedStart = new Date(new Date(session.start_at).getTime() + 30 * 60 * 1000);
    const movedEnd = new Date(new Date(session.end_at).getTime() + 30 * 60 * 1000);
    mocks.rescheduleInterviewSession.mockResolvedValue({
      session: { ...session, start_at: movedStart.toISOString(), end_at: movedEnd.toISOString() },
      application,
      assets: [],
    });
    render(<InterviewCenterPage view="schedule" />);

    const event = await screen.findByRole("button", { name: /腾讯.*二面/ });
    fireEvent.keyDown(event, { key: "ArrowDown" });
    await waitFor(() =>
      expect(mocks.rescheduleInterviewSession).toHaveBeenCalledWith(
        "31",
        expect.objectContaining({
          start_at: movedStart.toISOString(),
          end_at: movedEnd.toISOString(),
          allow_conflict: false,
          base_lock_version: 2,
        }),
      ),
    );
    expect(
      Array.from(document.querySelectorAll(".week-hour-labels span")).some((label) =>
        label.textContent?.endsWith(":30"),
      ),
    ).toBe(false);
  });

  it("renders only simple text and audio records for the selected session", async () => {
    render(<InterviewCenterPage view="records" />);

    expect(await screen.findByRole("heading", { name: "腾讯 · 后端开发工程师" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "文字记录" })).toBeInTheDocument();
    expect(screen.getByText("如何保证接口幂等？")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "复盘总结" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "需要改进" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /开始录音/ })).not.toBeInTheDocument();
    expect(screen.getByText("interview.m4a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传音频" })).toBeInTheDocument();
    expect(screen.getByLabelText("面试音频文件")).toHaveAttribute("accept", expect.stringContaining("audio/*"));
    expect(screen.getByLabelText("面试音频文件")).not.toHaveAttribute("accept", expect.stringContaining("video/*"));
    await waitFor(() => expect(mocks.getInterviewSession).toHaveBeenCalledWith("31"));
    expect(mocks.listInterviewSessions).toHaveBeenCalledWith({
      include_archived: true,
      cursor: undefined,
      limit: 500,
    });
    expect(mocks.listJobApplications).toHaveBeenCalledWith({
      scope: "all",
      cursor: undefined,
      limit: 200,
    });
  });

  it("keeps the selected record and detail aligned when requests resolve out of order", async () => {
    const otherApplication = {
      ...application,
      id: "22",
      company_name_snapshot: "阿里云",
      lock_version: 1,
    };
    const otherSession = {
      ...session,
      id: "32",
      application_id: "22",
      company_name: "阿里云",
      client_request_id: "22222222-2222-4222-8222-222222222222",
    };
    mocks.listInterviewSessions.mockResolvedValue({
      items: [session, otherSession],
      next_cursor: null,
    });
    mocks.listJobApplications.mockResolvedValue({
      items: [
        { ...application, next_session_id: "31", next_session_start_at: session.start_at, next_session_end_at: session.end_at, next_session_mode: "video" },
        { ...otherApplication, next_session_id: "32", next_session_start_at: otherSession.start_at, next_session_end_at: otherSession.end_at, next_session_mode: "video" },
      ],
      next_cursor: null,
    });
    const slowDetail = deferred<{
      session: typeof otherSession;
      application: typeof otherApplication;
      assets: [];
    }>();
    let initialRequest = true;
    mocks.getInterviewSession.mockImplementation((id: string) => {
      if (id === "31" && initialRequest) {
        initialRequest = false;
        return Promise.resolve({ session, application, assets: [] });
      }
      if (id === "32") return slowDetail.promise;
      return Promise.resolve({ session, application, assets: [] });
    });

    render(<InterviewCenterPage view="records" />);
    await screen.findByRole("heading", { name: "腾讯 · 后端开发工程师" });
    fireEvent.click(screen.getByText("阿里云").closest("button")!);
    expect(screen.queryByRole("button", { name: "完成面试" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("腾讯").closest("button")!);
    await screen.findByRole("heading", { name: "腾讯 · 后端开发工程师" });
    slowDetail.resolve({ session: otherSession, application: otherApplication, assets: [] });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "腾讯 · 后端开发工程师" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "阿里云 · 后端开发工程师" })).not.toBeInTheDocument();
    });
  });

  it("follows every cursor so historical records are not silently truncated", async () => {
    const laterStart = new Date(fixtureSessionStart.getTime() + 2 * 60 * 60 * 1000);
    const laterSession = {
      ...session,
      id: "32",
      company_name: "分页公司",
      client_request_id: "33333333-3333-4333-8333-333333333333",
      start_at: laterStart.toISOString(),
      end_at: new Date(laterStart.getTime() + 60 * 60 * 1000).toISOString(),
    };
    mocks.listInterviewSessions.mockImplementation((params: { cursor?: string }) =>
      Promise.resolve(
        params.cursor
          ? { items: [laterSession], next_cursor: null }
          : { items: [session], next_cursor: "next-session-page" },
      ),
    );

    render(<InterviewCenterPage view="records" />);
    expect(await screen.findByText("分页公司")).toBeInTheDocument();
    expect(mocks.listInterviewSessions).toHaveBeenCalledWith({
      include_archived: true,
      cursor: "next-session-page",
      limit: 500,
    });
  });

  it("requires confirmation before cancelling or archiving a record", async () => {
    render(<InterviewCenterPage view="records" />);
    await screen.findByRole("heading", { name: "腾讯 · 后端开发工程师" });

    fireEvent.click(screen.getByRole("button", { name: "取消面试安排" }));
    expect(screen.getByRole("dialog", { name: "取消这场面试安排？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));
    await waitFor(() =>
      expect(mocks.cancelInterviewSession).toHaveBeenCalledWith("31", {
        base_lock_version: 2,
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "归档进程" }));
    fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
    await waitFor(() =>
      expect(mocks.archiveJobApplication).toHaveBeenCalledWith("21", 3),
    );
  });

  it("uses assessment wording for cancelling a scheduled written test", async () => {
    const assessmentSession = {
      ...session,
      stage_type: "other" as const,
      round_no: null,
      stage_label: "笔试",
    };
    const assessmentApplication = {
      ...application,
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
      stage_state: "scheduled" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [assessmentSession], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [assessmentApplication], next_cursor: null });
    mocks.getInterviewSession.mockResolvedValue({ session: assessmentSession, application: assessmentApplication, assets: [] });

    render(<InterviewCenterPage view="records" />);

    fireEvent.click(await screen.findByRole("button", { name: "取消笔试安排" }));
    const confirmation = await screen.findByRole("dialog", { name: "取消这场笔试安排？" });
    expect(confirmation).toHaveTextContent("该场次会保留在面试记录中，并从当前排期退出；求职进程回到待安排状态。");
    fireEvent.click(within(confirmation).getByRole("button", { name: "确认取消" }));

    await waitFor(() => expect(mocks.cancelInterviewSession).toHaveBeenCalledWith("31", {
      base_lock_version: 2,
    }));
  });

  it("creates a scheduled stage only from an eligible completed process", async () => {
    const firstEligibleApplication = {
      ...application,
      id: "91",
      company_name_snapshot: "完成面试公司",
      current_stage_label: "二面",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-20T01:00:00Z",
      lock_version: 7,
    };
    const secondEligibleApplication = {
      ...application,
      id: "92",
      company_name_snapshot: "完成笔试公司",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "笔试",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-21T01:00:00Z",
      lock_version: 8,
    };
    const pendingApplication = {
      ...application,
      id: "93",
      company_name_snapshot: "待投递公司",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "待投递",
      stage_state: "awaiting_result" as const,
      applied_at: null,
    };
    const unfinishedApplication = {
      ...application,
      id: "94",
      company_name_snapshot: "未完成面试公司",
      applied_at: "2026-08-22T01:00:00Z",
      stage_state: "scheduled" as const,
    };
    const offerApplication = {
      ...application,
      id: "95",
      company_name_snapshot: "Offer 公司",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-23T01:00:00Z",
    };
    mocks.listJobApplications.mockResolvedValue({
      items: [firstEligibleApplication, secondEligibleApplication, pendingApplication, unfinishedApplication, offerApplication],
      next_cursor: null,
    });
    mocks.advanceJobApplication.mockResolvedValue({ application: secondEligibleApplication });
    mocks.createInterviewSession.mockResolvedValue({
      session: { ...session, application_id: secondEligibleApplication.id },
      application: secondEligibleApplication,
      assets: [],
    });

    render(<InterviewCenterPage view="schedule" />);
    fireEvent.click(await screen.findByRole("button", { name: "安排面试" }));
    const dialog = await screen.findByRole("dialog", { name: "新建面试" });
    expect(within(dialog).getAllByRole("radio", { name: /测评|笔试|AI 面试|面试/ })).toHaveLength(4);
    expect(within(dialog).queryByRole("radio", { name: "Offer" })).not.toBeInTheDocument();
    const processSelect = within(dialog).getByRole("combobox", { name: "选择流程" });
    expect(processSelect.closest(".career-next-stage-process-picker")).not.toBeNull();
    expect(processSelect.closest(".career-next-stage-field")).not.toHaveClass("career-next-stage-field--full");
    fireEvent.click(processSelect);
    const processOptions = screen.getAllByRole("option");
    expect(processOptions.map((option) => option.textContent)).toEqual([
      "完成面试公司 · 后端开发工程师 · 二面",
      "完成笔试公司 · 后端开发工程师 · 笔试",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "完成笔试公司 · 后端开发工程师 · 笔试" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "面试" }));
    expect(within(dialog).getByLabelText("面试链接或地点（选填）").closest(".career-next-stage-field")).toHaveClass("career-next-stage-field--full");
    fireEvent.change(within(dialog).getByLabelText("面试轮次"), { target: { value: "一面" } });
    fireEvent.change(within(dialog).getByLabelText("面试链接或地点（选填）"), { target: { value: "https://meeting.example/92" } });
    chooseScheduleDateTime(dialog, "面试时间", "2026-09-15", "10", "00");
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("92", {
      client_request_id: expect.any(String),
      stage_type: "interview",
      interview_round_no: 1,
      stage_label: "一面",
      base_lock_version: 8,
    }));
    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledWith("92", expect.objectContaining({
      stage_type: "interview",
      round_no: 1,
      stage_label: "一面",
      meeting_url: "https://meeting.example/92",
    })));
    expect(mocks.createJobDescription).not.toHaveBeenCalled();
    expect(mocks.createJobApplication).not.toHaveBeenCalled();
  });

  it("lets users permanently delete an archived process after all sessions are gone", async () => {
    const archivedApplication = {
      ...application,
      id: "55",
      archived_at: "2026-08-20T12:00:00Z",
      next_session_id: null,
      next_session_start_at: null,
      next_session_end_at: null,
      next_session_mode: null,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({
      items: [archivedApplication],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="records" />);
    fireEvent.click(await screen.findByRole("button", { name: "删除 腾讯 求职进程" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(mocks.deleteJobApplication).toHaveBeenCalledWith("55"));
  });

  it("lets a screening-only process advance without inventing an interview session", async () => {
    const screeningApplication = {
      ...application,
      id: "56",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选",
      stage_state: "awaiting_result" as const,
      lock_version: 1,
      next_session_id: null,
      next_session_start_at: null,
      next_session_end_at: null,
      next_session_mode: null,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({
      items: [screeningApplication],
      next_cursor: null,
    });
    mocks.advanceJobApplication.mockResolvedValue({
      application: {
        ...screeningApplication,
        current_stage_type: "interview",
        current_round_no: 1,
        current_stage_label: "一面",
        stage_state: "awaiting_schedule",
      },
    });

    render(<InterviewCenterPage view="records" />);
    fireEvent.click(await screen.findByRole("button", { name: "通过并进入一面" }));
    await waitFor(() =>
      expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("56", {
        client_request_id: expect.any(String),
        stage_type: "interview",
        interview_round_no: 1,
        stage_label: "一面",
        base_lock_version: 1,
      }),
    );
  });
});


it("空岗位库从新建进程切换到导入后只保留可关闭的导入弹窗", async () => {
  mocks.listJobDescriptions.mockResolvedValue({ items: [], next_cursor: null });
  const { rerender } = render(<InterviewCenterPage view="applications" initialCreateApplication />);
  const createDialog = await screen.findByRole("dialog", { name: "新建求职进程" });
  fireEvent.click(await within(createDialog).findByRole("button", { name: "导入岗位" }));
  // The app router reuses the page when the import query parameter changes.
  rerender(<InterviewCenterPage view="applications" initialJobImport />);
  expect(screen.queryByText("新建求职进程")).not.toBeInTheDocument();
  const importDialog = screen.getByRole("dialog", { name: "导入岗位" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(within(importDialog).getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.createJobApplication).not.toHaveBeenCalled();
});

it("按求职分类分行且保留一致的阶段列，修改分类后移动记录", async () => {
  const original = {...application, job_snapshot: {...application.job_snapshot, employment_type: "internship"}};
  const campus = {...application, id: "920", company_name_snapshot: "校招公司", current_stage_label: "三面", current_round_no: 3, job_snapshot: {employment_type: "campus"}};
  mocks.listJobApplications.mockResolvedValue({items: [original, campus], next_cursor: null});
  render(<InterviewCenterPage view="applications" />);
  await screen.findByRole("article", {name: "腾讯 后端开发工程师"});
  chooseSelectOption(openViewSettings(), "分类分组", "求职分类");
  const internship = screen.getByRole("region", {name: "实习分类"});
  const campusRegion = screen.getByRole("region", {name: "校招分类"});
  expect(within(internship).getByRole("article", {name: "腾讯 后端开发工程师"})).toBeInTheDocument();
  expect(within(campusRegion).queryByRole("article", {name: "腾讯 后端开发工程师"})).not.toBeInTheDocument();
  expect([...internship.querySelectorAll("[data-column-id]")].map(e => e.getAttribute("data-column-id")))
    .toEqual([...campusRegion.querySelectorAll("[data-column-id]")].map(e => e.getAttribute("data-column-id")));
  const card = within(internship).getByRole("article", {name: "腾讯 后端开发工程师"});
  fireEvent.click(within(card).getByRole("button", {name: "更多求职操作 腾讯 后端开发工程师"}));
  fireEvent.click(within(card).getByRole("menuitem", {name: "修改分类"}));
  const dialog = screen.getByRole("dialog", {name: "修改求职分类"});
  chooseSelectOption(dialog, "求职分类", "校招");
  const updated = {...original, job_snapshot: {...original.job_snapshot, employment_type: "campus"}, lock_version: original.lock_version + 1};
  mocks.updateJobApplication.mockResolvedValue({application: updated});
  mocks.listJobApplications.mockResolvedValue({items: [updated, campus], next_cursor: null});
  fireEvent.click(within(dialog).getByRole("button", {name: "保存"}));
  await waitFor(() => expect(mocks.updateJobApplication).toHaveBeenCalledWith(original.id, {employment_type: "campus", base_lock_version: original.lock_version}));
  await waitFor(() => expect(screen.queryByRole("dialog", {name: "修改求职分类"})).not.toBeInTheDocument());
  expect(within(screen.getByRole("region", {name: "校招分类"})).getByRole("article", {name: "腾讯 后端开发工程师"})).toBeInTheDocument();
  expect(within(screen.getByRole("region", {name: "实习分类"})).queryByRole("article")).not.toBeInTheDocument();
});

it("分类保存失败时保留弹窗与原卡片", async () => {
  mocks.listJobApplications.mockResolvedValue({items: [application], next_cursor: null});
  mocks.updateJobApplication.mockRejectedValue(new Error("network failure"));
  render(<InterviewCenterPage view="applications" />);
  const card = await screen.findByRole("article", {name: "腾讯 后端开发工程师"});
  fireEvent.click(within(card).getByRole("button", {name: "更多求职操作 腾讯 后端开发工程师"}));
  fireEvent.click(within(card).getByRole("menuitem", {name: "修改分类"}));
  const dialog = screen.getByRole("dialog", {name: "修改求职分类"});
  chooseSelectOption(dialog, "求职分类", "实习");
  fireEvent.click(within(dialog).getByRole("button", {name: "保存"}));
  expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
  expect(card).toBeInTheDocument();
  expect(within(dialog).getByRole("combobox", {name: "求职分类"})).toHaveTextContent("实习");
});

it("分组看板拖动仅推进本行阶段，不跨分类修改", async () => {
  const pending = {...application, id: "90", current_stage_type: "screening" as const,
    current_round_no: null, current_stage_label: "待投递", stage_state: "awaiting_schedule" as const,
    applied_at: null, job_snapshot: {employment_type: "internship"}};
  mocks.listInterviewSessions.mockResolvedValue({items: [], next_cursor: null});
  mocks.listJobApplications.mockResolvedValue({items: [pending], next_cursor: null});
  render(<InterviewCenterPage view="applications" />);
  const card = await screen.findByRole("article", {name: "腾讯 后端开发工程师"});
  chooseSelectOption(openViewSettings(), "分类分组", "求职分类");
  const activeCard = screen.getByRole("article", {name: "腾讯 后端开发工程师"});
  const transfer = {effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: () => "90"} as unknown as DataTransfer;
  const otherTarget = screen.getByRole("region", {name: "校招分类"}).querySelector('[data-column-key="screening"]')!;
  fireEvent.dragStart(activeCard, {dataTransfer: transfer});
  fireEvent.dragOver(otherTarget, {dataTransfer: transfer});
  fireEvent.drop(otherTarget, {dataTransfer: transfer});
  expect(mocks.updateJobApplication).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const target = screen.getByRole("region", {name: "实习分类"}).querySelector('[data-column-key="screening"]')!;
  fireEvent.dragOver(target, {dataTransfer: transfer});
  fireEvent.drop(target, {dataTransfer: transfer});
  expect(await screen.findByRole("dialog", {name: "投递岗位"})).toBeInTheDocument();
  expect(mocks.updateJobApplication).not.toHaveBeenCalled();
});


it.each([
  [130, 60, 60, 60, "", 60],
  [101, 30, 30, 0, ".is-start", 60],
  [159, 30, 0, 30, ".is-end", 60],
  [107, 30, 30, 0, ".is-start", 22],
  [115, 30, 0, 30, ".is-end", 22],
] as const)("周排期指针调整：起点 %s 位移 %s", async (y, delta, startDelta, endDelta, edgeSelector, height) => {
  render(<InterviewCenterPage view="schedule" />);
  const calendar = await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
  const card = within(calendar).getByRole("button", { name: /腾讯.*二面/ });
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 100 + height, height } as DOMRect);
  const target = edgeSelector ? card.querySelector(edgeSelector)! : card;
  const pointer = (name: string, clientY: number) => {
    const event = new MouseEvent(name, { bubbles: true, button: 0, clientY });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(name === "pointerdown" ? target : card, event);
  };
  pointer("pointerdown", y);
  pointer("pointermove", y + delta);
  expect(mocks.rescheduleInterviewSession).not.toHaveBeenCalled();
  pointer("pointerup", y + delta);
  expect(mocks.rescheduleInterviewSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
    start_at: new Date(new Date(session.start_at).getTime() + startDelta * 60_000).toISOString(),
    end_at: new Date(new Date(session.end_at).getTime() + endDelta * 60_000).toISOString(),
    base_lock_version: session.lock_version,
  }));
  fireEvent.click(card);
  expect(screen.queryByRole("dialog", { name: "面试详情" })).not.toBeInTheDocument();
});

it.each([false, true])("鼠标离开卡片后仍可拖动，Escape 取消=%s", async (cancel) => {
  render(<InterviewCenterPage view="schedule" />);
  const calendar = await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
  const card = within(calendar).getByRole("button", { name: /腾讯.*二面/ });
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 160, height: 60 } as DOMRect);
  const send = (target: EventTarget, type: string, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 17 });
    target.dispatchEvent(event);
  };
  act(() => send(card, "pointerdown", 130));
  const original = card.style.transform;
  act(() => send(window, "pointermove", 137));
  expect(card.style.transform).toBe("translateY(7px)");
  expect(mocks.rescheduleInterviewSession).not.toHaveBeenCalled();
  act(() => send(window, "pointermove", 190));
  expect(card.style.transform).not.toBe(original);
  expect(mocks.rescheduleInterviewSession).not.toHaveBeenCalled();
  if (cancel) fireEvent.keyDown(window, { key: "Escape" });
  act(() => send(window, "pointerup", 190));
  if (cancel) {
    expect(mocks.rescheduleInterviewSession).not.toHaveBeenCalled();
    expect(card.style.transform).toBe(original);
  } else {
    expect(mocks.rescheduleInterviewSession).toHaveBeenCalledTimes(1);
  }
});


it.each(["completed", "cancelled", "scheduled"] as const)("已结束场次 %s 从排期直接进入对应记录弹窗路由", async (status) => {
  vi.spyOn(Date, "now").mockReturnValue(status === "scheduled" ? fixtureSessionEnd.getTime() + 1 : fixtureSessionStart.getTime() - 1);
  mocks.listInterviewSessions.mockResolvedValue({ items: [{ ...session, status }], next_cursor: null });
  render(<InterviewCenterPage view="schedule" />);
  const calendar = await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
  fireEvent.click(within(calendar).getByRole("button", { name: /腾讯.*二面/ }));
  expect(window.location.pathname).toBe("/career/applications/21");
  expect(window.location.search).toBe("?session=31");
  expect(screen.queryByRole("dialog", { name: "面试详情" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "进入会议" })).not.toBeInTheDocument();
});


it("列表固定显示更新时间与分类分组", async () => {
  const futureStart = new Date(Date.now() + 86_400_000).toISOString();
  const futureEnd = new Date(Date.now() + 90_000_000).toISOString();
  mocks.listInterviewSessions.mockResolvedValue({ items: [
    { ...session, id: "future", stage_label: "技术沟通", start_at: futureStart, end_at: futureEnd },
    { ...session, id: "completed", status: "completed", stage_label: "已完成场次", start_at: futureStart, end_at: futureEnd },
    { ...session, id: "past", stage_label: "过去场次", start_at: new Date(Date.now() - 7_200_000).toISOString(), end_at: new Date(Date.now() - 3_600_000).toISOString() },
  ], next_cursor: null });
  mocks.listJobApplications.mockResolvedValue({ items: [{ ...application, applied_at: "2026-08-18T01:00:00Z", job_snapshot: { employment_type: "internship" } }], next_cursor: null });
  vi.spyOn(Date, "now").mockReturnValue(fixtureSessionStart.getTime() - 60_000);
  render(<InterviewCenterPage view="applications" />);
  await screen.findByRole("region", { name: "求职进程看板" });
  switchToApplicationList();
  const table = screen.getByRole("table", { name: "求职记录列表" });
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["公司 / 岗位", "求职分类", "当前进度", "最近安排", "投递日期", "更新时间"]);
  expect(table).toHaveTextContent("实习");
  expect(within(table).getAllByRole("cell")[3]).toHaveTextContent("技术沟通");
  expect(table).not.toHaveTextContent("已完成场次");
  expect(table).not.toHaveTextContent("过去场次");
  expect(table.querySelector('time[datetime="2026-08-18T01:00:00Z"]')).toHaveTextContent("8月18日");
  expect(within(openViewSettings()).queryByRole("checkbox", { name: "显示更新时间" })).not.toBeInTheDocument();
  expect(within(table).getByRole("columnheader", { name: "更新时间" })).toBeInTheDocument();
  chooseSelectOption(openViewSettings(), "分类分组", "求职分类");
  const groupedTable = screen.getByRole("table", { name: "实习求职记录列表" });
  expect(within(groupedTable).queryByRole("columnheader", { name: "求职分类" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "实习 1" })).toBeInTheDocument();
});
