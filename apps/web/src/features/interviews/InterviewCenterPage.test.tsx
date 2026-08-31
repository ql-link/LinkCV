import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type JobApplicationSummary, type ResumeSummary } from "@/api/client";
import { useResumeStore } from "@/store/resumeStore";
import { InterviewCenterPage } from "./InterviewCenterPage";

const mocks = vi.hoisted(() => ({
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
  advanceJobApplication: vi.fn(),
  closeJobApplication: vi.fn(),
  recordJobApplicationOffer: vi.fn(),
  uploadInterviewAsset: vi.fn(),
  downloadInterviewAsset: vi.fn(),
  deleteInterviewAsset: vi.fn(),
  getPluginRelease: vi.fn(),
}));

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
  const timeInput = within(picker).getByRole("textbox", { name: "时间" });
  fireEvent.change(timeInput, { target: { value: `${hour}${minute}` } });
  expect(timeInput).toHaveValue(`${hour}:${minute}`);
  fireEvent.click(within(picker).getByRole("button", { name: "确定" }));
}

function chooseSelectOption(dialog: HTMLElement, label: string, option: string) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

beforeEach(() => {
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
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

describe("InterviewCenterPage API projections", () => {
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

  it("切换到面试排期时保留旧数据并避免回退到整页加载态", async () => {
    const { rerender } = render(<InterviewCenterPage view="applications" />);
    await screen.findByRole("table", { name: "求职记录列表" });

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
    render(<InterviewCenterPage view="schedule" />);

    const calendar = await screen.findByRole("grid", {
      name: "面试周排期，可拖动并按 30 分钟调整",
    });
    const moduleHeader = document.querySelector(".career-module-header") as HTMLElement;
    expect(screen.queryByRole("heading", { name: "面试排期" })).not.toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "搜索面试排期" })).toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "安排面试" })).toBeInTheDocument();
    expect(within(calendar).getByText("00:00")).toBeInTheDocument();
    expect(within(calendar).getByText("23:00")).toBeInTheDocument();
    const event = within(calendar).getByRole("button", { name: /腾讯.*二面/ });
    expect(event).toHaveClass("calendar-blue");
    fireEvent.click(event);
    const dialog = await screen.findByRole("dialog", { name: "面试详情" });
    expect(within(dialog).getByText("后端开发工程师")).toBeInTheDocument();
    expect(within(dialog).getByText("王老师（后端技术专家）")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "https://meeting.example/31" })).toBeInTheDocument();
    expect(within(dialog).getByText("interview.m4a")).toBeInTheDocument();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0]);
    expect(screen.queryByRole("dialog", { name: "面试详情" })).not.toBeInTheDocument();
  });

  it("switches to the monthly schedule and opens creation from a blank day", async () => {
    render(<InterviewCenterPage view="schedule" />);

    await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
    fireEvent.click(screen.getByRole("button", { name: "月" }));

    const month = await screen.findByRole("grid", { name: /月面试排期$/ });
    expect(month).toBeInTheDocument();
    const blankDay = within(month).getAllByRole("gridcell")[10];
    fireEvent.doubleClick(blankDay);
    expect(await screen.findByRole("dialog", { name: "新建面试" })).toBeInTheDocument();
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

  it("renders the default application list with hero search and import entry", async () => {
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

    expect(await screen.findByRole("table", { name: "求职记录列表" })).toBeInTheDocument();
    const moduleHeader = document.querySelector(".career-module-header") as HTMLElement;
    expect(screen.queryByRole("heading", { name: "求职进程" })).not.toBeInTheDocument();
    expect(within(moduleHeader).getByText("导入岗位，记录每一轮面试，并完成复盘。")).toBeInTheDocument();
    const searchButton = within(moduleHeader).getByRole("button", { name: "搜索求职进程" });
    expect(searchButton).toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "安装采集插件" })).toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "导入岗位" })).toBeInTheDocument();
    expect(within(moduleHeader).queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();
    expect(within(moduleHeader).queryByRole("button", { name: "新建求职进程" })).not.toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "求职中心导航" });
    const viewControls = screen.getByRole("group", { name: "求职记录显示设置" });
    expect(navigation.parentElement).toHaveClass("career-applications-navigation-row");
    expect(viewControls.parentElement).toBe(navigation.parentElement);
    expect(screen.queryByText("全部记录")).not.toBeInTheDocument();
    const viewToggle = screen.getByRole("button", { name: "切换到阶段看板" });
    expect(viewToggle).toHaveAttribute("title", "切换到阶段看板");
    expect(viewToggle).toHaveTextContent("列表");
    expect(viewToggle).not.toHaveAttribute("aria-pressed");
    expect(screen.getByRole("button", { name: "切换为最早更新" })).toHaveTextContent("最近更新");
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.queryByRole("columnheader", { name: "操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看记录" })).not.toBeInTheDocument();
    fireEvent.click(searchButton);
    const searchbox = within(moduleHeader).getByRole("searchbox", { name: "搜索求职进程" });
    expect(searchbox).toHaveAttribute("name", "career-application-search");
    fireEvent.change(searchbox, { target: { value: "腾讯" } });
    expect(screen.queryByText("全部记录")).not.toBeInTheDocument();
    fireEvent.change(searchbox, { target: { value: "" } });
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

    const table = await screen.findByRole("table", { name: "求职记录列表" });
    const recordRow = within(table).getAllByRole("row")[1];
    fireEvent.keyDown(recordRow, { key });

    expect(window.location.pathname).toBe("/career/applications/21");
  });

  it("opens an application detail from an ordinary table cell", async () => {
    render(<InterviewCenterPage view="applications" />);

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
        makeProgressApplication("4", { current_stage_label: "Offer 沟通", stage_state: "negotiating" }),
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
      ],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="applications" />);

    expect(await screen.findByLabelText("一面 · 进行中")).toHaveClass("is-active");
    expect(screen.getByLabelText("二面 · 等待安排")).toHaveClass("is-scheduled");
    expect(screen.getByLabelText("终面 · 等待结果")).toHaveClass("is-waiting");
    expect(screen.getByLabelText("Offer 沟通 · Offer 沟通中")).toHaveClass("is-offer");
    expect(screen.getByLabelText("Offer · 已接受 Offer")).toHaveClass("is-offer");
    expect(screen.getByLabelText("筛选中 · 未通过")).toHaveClass("is-danger");
    expect(screen.getByLabelText("assessment · 在线作业 · 等待安排")).toHaveClass("is-scheduled");
    expect(screen.getByLabelText("在线笔试 · 等待安排")).toHaveClass("is-scheduled");
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

  it("projects the latest loaded interview and toggles list sorting and board view", async () => {
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

    const table = await screen.findByRole("table", { name: "求职记录列表" });
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    const firstRow = within(table).getAllByRole("row")[1];
    expect(firstRow).toHaveTextContent("腾讯");
    expect(firstRow).toHaveTextContent("后端开发工程师");
    expect(firstRow).toHaveTextContent("二面");
    expect(firstRow).toHaveTextContent("终面 · 已完成复盘");
    expect(firstRow).toHaveTextContent("8月18日");

    fireEvent.click(screen.getByRole("button", { name: "切换为最早更新" }));
    expect(screen.getByRole("button", { name: "切换为最近更新" })).toHaveTextContent("最早更新");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("旧公司");

    fireEvent.click(screen.getByRole("button", { name: "切换到阶段看板" }));
    expect(screen.queryByRole("table", { name: "求职记录列表" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "求职进程看板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到列表" })).toHaveTextContent("阶段看板");
    expect(screen.queryByText("横向滑动查看更多阶段")).not.toBeInTheDocument();
    for (const label of ["进行中的进程", "本周待面试", "待跟进", "已拿 Offer"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "切换到列表" }));
    expect(screen.getByRole("button", { name: "切换到阶段看板" })).toHaveAttribute("title", "切换到阶段看板");
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
    expect(screen.getByRole("button", { name: "查看面试记录" })).toBeInTheDocument();
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
    mocks.advanceJobApplication.mockResolvedValue({ application: awaitingResultApplication });
    mocks.createInterviewSession.mockResolvedValue({ session, application: awaitingResultApplication, assets: [] });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加求职阶段" });
    expect(within(dialog).getAllByRole("tab")).toHaveLength(2);
    expect(within(dialog).getByRole("tab", { name: "笔试 / 测评" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).queryByRole("tab", { name: "筛选" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("筛选轮次")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("展示名称")).toHaveValue("笔试");
    expect(within(dialog).queryByLabelText("当前状态")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("测评时间")).toHaveAttribute("aria-required", "true");
    expect(within(dialog).getByLabelText("链接或地点")).toBeRequired();
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeDisabled();
    expect(dialog.querySelector("select")).not.toBeInTheDocument();
    expect(dialog.querySelector('input[type="datetime-local"], input[type="date"], input[type="time"]')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("tab", { name: "面试" }));
    expect(within(dialog).getByText("添加后会立即保存排期；如需调整，可从安排时间入口继续修改。")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("展示名称")).toHaveValue("");
    expect(within(dialog).getByLabelText("展示名称")).toHaveAttribute("placeholder", "如：一面、业务面、HR 面");
    expect(within(dialog).queryByLabelText("面试轮次")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("当前状态")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("面试时间")).toHaveAttribute("aria-required", "true");
    expect(within(dialog).getByLabelText("链接或地点")).toBeRequired();
    expect(within(dialog).getByRole("combobox", { name: "时长" })).toHaveTextContent("60 分钟");
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("展示名称"), { target: { value: "三面" } });
    fireEvent.change(within(dialog).getByLabelText("链接或地点"), { target: { value: "深圳科技园 3 号楼" } });
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeDisabled();
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
    chooseScheduleDateTime(dialog, "面试时间", "2026-09-10", "09", "30");
    chooseSelectOption(dialog, "时长", "90 分钟");
    chooseSelectOption(dialog, "方式", "现场面试");
    expect(within(dialog).getByRole("button", { name: "面试时间" })).toHaveTextContent("2026-09-10 09:30");
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(mocks.advanceJobApplication).toHaveBeenCalledWith("21", {
      target_stage_type: "interview",
      target_round_no: 3,
      target_stage_label: "三面",
      base_lock_version: 7,
    }));
    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledWith("21", expect.objectContaining({
      client_request_id: expect.any(String),
      stage_type: "interview",
      round_no: 3,
      stage_label: "三面",
      start_at: new Date("2026-09-10T09:30").toISOString(),
      end_at: new Date("2026-09-10T11:00").toISOString(),
      timezone: "Asia/Shanghai",
      mode: "onsite",
      meeting_url: null,
      location: "深圳科技园 3 号楼",
    })));
    expect(mocks.advanceJobApplication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createInterviewSession.mock.invocationCallOrder[0],
    );
  });

  it("adds and schedules an assessment stage with the screening payload", async () => {
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
    mocks.advanceJobApplication.mockResolvedValue({ application: awaitingResultApplication });
    mocks.createInterviewSession.mockResolvedValue({ session, application: awaitingResultApplication, assets: [] });

    render(<InterviewCenterPage view="applications" initialApplicationId="68" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const dialog = await screen.findByRole("dialog", { name: "添加求职阶段" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "笔试 / 测评" }));
    expect(within(dialog).getByText("添加后会立即保存排期；如需调整，可从安排时间入口继续修改。")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("展示名称")).toHaveValue("笔试");
    expect(within(dialog).queryByLabelText("当前状态")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("测评时间")).toHaveAttribute("aria-required", "true");
    expect(within(dialog).getByLabelText("链接或地点")).toBeRequired();
    expect(within(dialog).getByRole("combobox", { name: "时长" })).toHaveTextContent("90 分钟");
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("展示名称"), { target: { value: "在线作业" } });
    fireEvent.change(within(dialog).getByLabelText("链接或地点"), { target: { value: "https://assessment.example/68" } });
    const schedulePicker = openScheduleDateTimePicker(dialog, "测评时间", "2026-09-12");
    expect(schedulePicker).toBeInTheDocument();
    const timeInput = within(schedulePicker).getByRole("textbox", { name: "时间" });
    expect(timeInput).toBeRequired();
    fireEvent.change(timeInput, { target: { value: "1435" } });
    expect(timeInput).toHaveValue("14:35");
    expect(timeInput).toHaveAttribute("aria-invalid", "true");
    expect(within(schedulePicker).getByRole("alert")).toHaveTextContent("分钟仅支持 00 或 30");
    expect(within(schedulePicker).getByRole("button", { name: "确定" })).toBeDisabled();
    fireEvent.change(timeInput, { target: { value: "1400" } });
    expect(timeInput).toHaveValue("14:00");
    expect(within(schedulePicker).getByRole("button", { name: "确定" })).toBeEnabled();
    fireEvent.click(within(schedulePicker).getByRole("button", { name: "确定" }));
    expect(within(dialog).getByRole("button", { name: "添加并保存" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(mocks.advanceJobApplication).toHaveBeenCalledWith("68", {
      target_stage_type: "screening",
      target_round_no: null,
      target_stage_label: "笔试 · 在线作业",
      base_lock_version: 10,
    }));
    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledWith("68", expect.objectContaining({
      client_request_id: expect.any(String),
      stage_type: "other",
      round_no: null,
      stage_label: "笔试 · 在线作业",
      start_at: new Date("2026-09-12T14:00").toISOString(),
      end_at: new Date("2026-09-12T15:30").toISOString(),
      timezone: "Asia/Shanghai",
      mode: "video",
      meeting_url: "https://assessment.example/68",
      location: null,
    })));
    expect(mocks.advanceJobApplication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createInterviewSession.mock.invocationCallOrder[0],
    );
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
    mocks.advanceJobApplication.mockResolvedValue({ application: awaitingResultApplication });
    mocks.createInterviewSession.mockRejectedValue(new Error("保存排期失败"));

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const stageDialog = await screen.findByRole("dialog", { name: "添加求职阶段" });
    fireEvent.change(within(stageDialog).getByLabelText("链接或地点"), { target: { value: "https://assessment.example/fail" } });
    chooseScheduleDateTime(stageDialog, "测评时间", "2026-09-10", "09", "30");
    fireEvent.click(within(stageDialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("阶段已添加，但排期保存失败，可从安排时间入口重试"));
    expect(mocks.advanceJobApplication).toHaveBeenCalledTimes(1);
    expect(mocks.createInterviewSession).toHaveBeenCalledTimes(1);
    expect(mocks.listJobApplications.mock.calls.length).toBeGreaterThan(1);
    expect(screen.queryByRole("dialog", { name: "添加求职阶段" })).not.toBeInTheDocument();
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
    mocks.advanceJobApplication.mockRejectedValue(new ApiRequestError(409, "INTERVIEW_EDIT_CONFLICT"));

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    fireEvent.click(await screen.findByRole("button", { name: "添加下一阶段" }));
    const stageDialog = await screen.findByRole("dialog", { name: "添加求职阶段" });
    fireEvent.change(within(stageDialog).getByLabelText("链接或地点"), { target: { value: "https://assessment.example/conflict" } });
    chooseScheduleDateTime(stageDialog, "测评时间", "2026-09-10", "09", "30");
    fireEvent.click(within(stageDialog).getByRole("button", { name: "添加并保存" }));

    await waitFor(() => expect(within(stageDialog).getByRole("alert")).toHaveTextContent("这条面试已在其他页面更新，请刷新后再试"));
    expect(mocks.advanceJobApplication).toHaveBeenCalledTimes(1);
    expect(mocks.createInterviewSession).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "添加求职阶段" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "面试概况" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "面试内容" })).toBeInTheDocument();
    expect(await screen.findByText("如何保证接口幂等？")).toBeInTheDocument();
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
    fireEvent.change(within(dialog).getByPlaceholderText("粘贴面试过程、逐字稿或整理后的文字记录…"), {
      target: { value: "新的面试文字记录" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存内容" }));

    await waitFor(() => expect(mocks.updateInterviewSession).toHaveBeenCalledWith("31", {
      questions_markdown: "新的面试文字记录",
      base_lock_version: 2,
    }));
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
    fireEvent.click(within(dialog).getByRole("button", { name: "完成本轮面试" }));

    await waitFor(() => expect(mocks.completeInterviewSession).toHaveBeenCalledWith("31", {
      questions_markdown: "如何保证接口幂等？",
      review_summary: "等待面试后填写。",
      improvement_markdown: "补充分布式事务边界。",
      base_lock_version: 2,
    }));
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
      offer_status: "written_offer_received",
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
      items: [pending, screening, assessment, interview, waiting, firstInterview, hrInterview, unnamedInterview, defaultWaiting, offer, ended, acceptedOffer],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="applications" />);

    fireEvent.click(await screen.findByRole("button", { name: "切换到阶段看板" }));
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
      "笔试中1",
      "一面1",
      "二面2",
      "HR 面1",
      "面试中1",
      "Offer1",
      "已结束2",
    ]);
    expect(screen.queryByText("等待通知")).not.toBeInTheDocument();
    expect(screen.queryByText("横向滑动查看更多阶段")).not.toBeInTheDocument();

    const screeningCard = screen.getByRole("article", { name: "筛选公司 筛选岗位" });
    expect(screeningCard).toHaveAttribute("draggable", "false");
    expect(within(screeningCard).getByText("实习")).toBeInTheDocument();
    expect(within(screeningCard).getByText("筛选中 · 进行中")).toBeInTheDocument();
    expect(within(screeningCard).getByText(/^今天 10:20$/)).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "笔试公司 笔试岗位" })).toHaveAttribute("draggable", "false");
    expect(within(screen.getByRole("article", { name: "笔试公司 笔试岗位" })).getByText("笔试中 · 进行中")).toBeInTheDocument();

    const interviewCard = screen.getByRole("article", { name: "腾讯 后端开发工程师" });
    expect(within(interviewCard).getByText("全职")).toBeInTheDocument();
    expect(within(interviewCard).getByText(/二面 · \d+月\d+日 \d{2}:\d{2}/)).toBeInTheDocument();
    expect(within(interviewCard).getByText(/^昨天 \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(interviewCard).toHaveAttribute("draggable", "false");

    const waitingCard = screen.getByRole("article", { name: "完成公司 完成岗位" });
    expect(within(waitingCard).getByText("二面 · 等待结果")).toBeInTheDocument();
    expect(waitingCard).toHaveAttribute("draggable", "false");
    const submittedScreeningCard = screen.getByRole("article", { name: "待通知公司 待通知岗位" });
    expect(within(submittedScreeningCard).getByText("筛选中 · 等待结果")).toBeInTheDocument();
    expect(submittedScreeningCard).toHaveAttribute("draggable", "true");

    const offerCard = screen.getByRole("article", { name: "Offer 公司 Offer 岗位" });
    expect(within(offerCard).getByText("Offer · Offer 沟通中")).toBeInTheDocument();
    expect(offerCard).toHaveAttribute("draggable", "false");
    const interviewColumn = columns.find((column) => column.dataset.columnId === "interview:二面");
    const offerColumn = columns.find((column) => column.dataset.columnKey === "offer");
    expect(within(interviewColumn!).queryByRole("article", { name: "Offer 公司 Offer 岗位" })).not.toBeInTheDocument();
    expect(within(offerColumn!).getByRole("article", { name: "Offer 公司 Offer 岗位" })).toBe(offerCard);

    const endedCard = screen.getByRole("article", { name: "结束公司 结束岗位" });
    expect(within(endedCard).getByText("未通过")).toBeInTheDocument();
    expect(within(endedCard).queryByText("筛选中 · 未通过")).not.toBeInTheDocument();
    expect(within(endedCard).queryByText("校招")).not.toBeInTheDocument();
    expect(endedCard).toHaveAttribute("draggable", "false");
    const acceptedOfferCard = screen.getByRole("article", { name: "已接受公司 已接受岗位" });
    expect(within(acceptedOfferCard).getByText("已接受 Offer")).toBeInTheDocument();
    expect(acceptedOfferCard).toHaveAttribute("draggable", "false");
    expect(within(offerColumn!).queryByRole("article", { name: "已接受公司 已接受岗位" })).not.toBeInTheDocument();
    expect(within(columns.find((column) => column.dataset.columnKey === "ended")!).getByRole("article", { name: "已接受公司 已接受岗位" })).toBe(acceptedOfferCard);

    fireEvent.click(within(screeningCard).getByRole("button", { name: "查看 筛选公司 筛选岗位 求职进程" }));
    expect(window.location.pathname).toBe("/career/applications/46");
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

  it("confirms the applied date and submits the selected resume together", async () => {
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
    mocks.updateJobApplication.mockResolvedValue({
      application: {
        ...screeningApplication,
        applied_at: "2026-08-22T04:00:00Z",
        resume_version_id: "resume-version-2",
        resume_title_snapshot: "后端工程师简历 · 后端投递终版",
      },
    });

    render(<InterviewCenterPage view="applications" initialApplicationId="58" />);

    const markAppliedButton = await screen.findByRole("button", { name: "标记已投递" });
    expect(screen.getAllByText("待投递").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "更新筛选结果" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "当前阶段：待投递" })).not.toHaveTextContent("筛选中");
    fireEvent.click(markAppliedButton);
    const dialog = await screen.findByRole("dialog", { name: "推进求职流程" });
    fireEvent.click(within(dialog).getByRole("button", { name: "投递日期" }));
    const datePicker = within(dialog).getByRole("dialog", { name: "选择投递日期" });
    if (!within(datePicker).queryByRole("button", { name: "2026年8月22日" })) {
      fireEvent.click(within(datePicker).getByRole("button", { name: "上一月" }));
    }
    const dateButton = within(datePicker).getByRole("button", { name: "2026年8月22日" });
    fireEvent.click(dateButton);
    expect(within(dialog).getByRole("button", { name: "投递日期" })).toHaveTextContent("2026-08-22");
    fireEvent.click(within(dialog).getByRole("combobox", { name: "使用的简历" }));
    fireEvent.click(await screen.findByRole("option", { name: "后端工程师简历" }));
    expect(within(dialog).queryByRole("combobox", { name: "投递简历版本" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("系统会自动绑定所选简历最新的正式版本。")).toBeInTheDocument();
    expect(mocks.listVersions).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认标记" }));

    await waitFor(() => expect(mocks.updateJobApplication).toHaveBeenCalledWith("58", {
      applied_at: "2026-08-22T04:00:00.000Z",
      resume_id: "resume-1",
      base_lock_version: 9,
    }));
  });

  it("clears the applied date and closes the calendar on Escape", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: "标记已投递" }));
    const dialog = await screen.findByRole("dialog", { name: "推进求职流程" });
    const dateTrigger = within(dialog).getByRole("button", { name: "投递日期" });
    fireEvent.click(dateTrigger);
    const datePicker = within(dialog).getByRole("dialog", { name: "选择投递日期" });
    fireEvent.click(within(datePicker).getByRole("button", { name: "清除" }));
    expect(dateTrigger).toHaveTextContent("选择日期");
    expect(within(dialog).getByRole("button", { name: "确认标记" })).toBeDisabled();

    fireEvent.click(dateTrigger);
    expect(within(dialog).getByRole("dialog", { name: "选择投递日期" })).toBeInTheDocument();
    fireEvent.keyDown(dateTrigger, { key: "Escape" });
    expect(within(dialog).queryByRole("dialog", { name: "选择投递日期" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "推进求职流程" })).toBeInTheDocument();
  });

  it("submits a selected resume without prefetching its formal versions", async () => {
    const screeningApplication = {
      ...application,
      id: "59",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      applied_at: null,
      lock_version: 10,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [screeningApplication], next_cursor: null });
    mocks.updateJobApplication.mockRejectedValueOnce(
      new ApiRequestError(409, "INTERVIEW_RESUME_VERSION_REQUIRED"),
    );

    render(<InterviewCenterPage view="applications" initialApplicationId="59" />);

    fireEvent.click(await screen.findByRole("button", { name: "标记已投递" }));
    const dialog = await screen.findByRole("dialog", { name: "推进求职流程" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "使用的简历" }));
    fireEvent.click(await screen.findByRole("option", { name: "后端工程师简历（无正式版本）" }));
    expect(within(dialog).getByText("系统会自动绑定所选简历最新的正式版本。"))
      .toBeInTheDocument();
    expect(mocks.listVersions).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认标记" }));

    await waitFor(() => expect(mocks.updateJobApplication).toHaveBeenCalledWith("59", expect.objectContaining({
      applied_at: expect.any(String),
      resume_id: "resume-2",
      base_lock_version: 10,
    })));
    expect(screen.getByText("所选简历暂无正式版本，请先保存正式版本。")).toBeInTheDocument();
  });

  it("disables marking as applied when the resume list is empty", async () => {
    useResumeStore.setState({ resumes: [] });
    const screeningApplication = {
      ...application,
      id: "60",
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选中",
      stage_state: "awaiting_result" as const,
      applied_at: null,
      lock_version: 11,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [screeningApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="60" />);

    fireEvent.click(await screen.findByRole("button", { name: "标记已投递" }));
    const dialog = await screen.findByRole("dialog", { name: "推进求职流程" });
    expect(within(dialog).getByText("暂无可用简历，请先创建简历并保存正式版本后再标记已投递。"))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "使用的简历" })).toHaveTextContent("请选择简历");
    expect(within(dialog).getByRole("button", { name: "确认标记" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认标记" }));

    expect(mocks.updateJobApplication).not.toHaveBeenCalled();
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

  it("keeps Offer actions in the header progression dialog and preserves the offer API payload", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: "更新 Offer 状态" }));
    const dialog = await screen.findByRole("dialog", { name: "推进求职流程" });
    expect(dialog).toHaveTextContent("当前阶段：Offer");
    fireEvent.click(within(dialog).getByRole("button", { name: "收到 OC" }));

    await waitFor(() => expect(mocks.recordJobApplicationOffer).toHaveBeenCalledWith("65", "oc_received", 3));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "推进求职流程" })).not.toBeInTheDocument());
    expect(document.querySelector(".career-offer-actions")).not.toBeInTheDocument();
  });

  it("preserves Offer accept and decline actions in the header dialog", async () => {
    const offerApplication = {
      ...application,
      id: "66",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer",
      stage_state: "negotiating" as const,
      offer_status: "written_offer_received" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [offerApplication], next_cursor: null });
    mocks.closeJobApplication.mockResolvedValue({ application: offerApplication });

    render(<InterviewCenterPage view="applications" initialApplicationId="66" />);

    fireEvent.click(await screen.findByRole("button", { name: "更新 Offer 状态" }));
    const dialog = await screen.findByRole("dialog", { name: "推进求职流程" });
    fireEvent.click(within(dialog).getByRole("button", { name: "婉拒 Offer" }));

    await waitFor(() => expect(mocks.closeJobApplication).toHaveBeenCalledWith("66", {
      status: "closed",
      offer_status: "declined",
      base_lock_version: 3,
    }));
  });

  it("renders a received Offer with a crown above its dedicated journey node", async () => {
    const offerApplication = {
      ...application,
      id: "61",
      current_stage_type: "offer" as const,
      current_round_no: null,
      current_stage_label: "Offer 沟通",
      stage_state: "negotiating" as const,
      offer_status: "written_offer_received" as const,
      applied_at: "2026-08-22T04:00:00Z",
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [offerApplication], next_cursor: null });

    render(<InterviewCenterPage view="applications" initialApplicationId="61" />);

    await screen.findByRole("list", { name: "当前阶段：Offer 沟通" });
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
    const dialog = await screen.findByRole("dialog", { name: "添加求职阶段" });
    expect(within(dialog).getAllByRole("tab")).toHaveLength(2);
    expect(within(dialog).getByRole("tab", { name: "笔试 / 测评" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).queryByRole("tab", { name: "筛选" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("筛选轮次")).not.toBeInTheDocument();
  });

  it("advances a screening card to the selected free-form interview column", async () => {
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
    const advancedApplication = {
      ...screeningApplication,
      current_stage_type: "interview" as const,
      current_round_no: 3,
      current_stage_label: "HR 面",
      stage_state: "awaiting_schedule" as const,
      lock_version: 5,
    };
    mocks.listJobApplications
      .mockResolvedValueOnce({ items: [screeningApplication, hrApplication], next_cursor: null })
      .mockResolvedValueOnce({ items: [advancedApplication], next_cursor: null });
    mocks.advanceJobApplication.mockResolvedValue({ application: advancedApplication });

    render(<InterviewCenterPage view="applications" />);

    fireEvent.click(await screen.findByRole("button", { name: "切换到阶段看板" }));
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

    await waitFor(() => expect(mocks.advanceJobApplication).toHaveBeenCalledWith("57", {
      target_stage_type: "interview",
      target_round_no: 3,
      target_stage_label: "HR 面",
      base_lock_version: 4,
    }));
    await waitFor(() => expect(mocks.listJobApplications).toHaveBeenCalledTimes(2));
  });

  it("does not call the advance API when an interview card stays in its aggregate column", async () => {
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({ items: [application], next_cursor: null });

    render(<InterviewCenterPage view="applications" />);

    fireEvent.click(await screen.findByRole("button", { name: "切换到阶段看板" }));
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

  it("shows an error, refreshes real data, and restores a safe screening drag after a conflict", async () => {
    const screeningApplication = {
      ...application,
      current_stage_type: "screening" as const,
      current_round_no: null,
      current_stage_label: "筛选",
      stage_state: "awaiting_result" as const,
      applied_at: "2026-08-22T04:00:00Z",
      lock_version: 4,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications
      .mockResolvedValueOnce({ items: [screeningApplication], next_cursor: null })
      .mockResolvedValueOnce({ items: [screeningApplication], next_cursor: null });
    mocks.advanceJobApplication.mockRejectedValueOnce(
      new ApiRequestError(409, "INTERVIEW_EDIT_CONFLICT"),
    );

    render(<InterviewCenterPage view="applications" />);

    fireEvent.click(await screen.findByRole("button", { name: "切换到阶段看板" }));
    const card = await screen.findByRole("article", { name: "腾讯 后端开发工程师" });
    const interviewColumn = document.querySelector('[data-column-key="interview"]');
    expect(within(interviewColumn as HTMLElement).getByRole("heading")).toHaveTextContent("面试中0");
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("21"),
    } as unknown as DataTransfer;
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(interviewColumn as HTMLElement, { dataTransfer });
    fireEvent.drop(interviewColumn as HTMLElement, { dataTransfer });

    expect(await screen.findByRole("alert")).toHaveTextContent("请刷新后再试");
    await waitFor(() => expect(mocks.listJobApplications).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const restoredCard = screen.getByRole("article", { name: "腾讯 后端开发工程师" });
      expect(restoredCard).not.toHaveClass("is-advancing");
      expect(restoredCard).toHaveAttribute("draggable", "true");
    });
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

  it("renders the shared review fields and assets for the selected session", async () => {
    render(<InterviewCenterPage view="records" />);

    expect(await screen.findByRole("heading", { name: "腾讯 · 后端开发工程师" })).toBeInTheDocument();
    expect(screen.getByText("如何保证接口幂等？")).toBeInTheDocument();
    expect(screen.getByText("补充分布式事务边界。")).toBeInTheDocument();
    expect(screen.getByText("interview.m4a")).toBeInTheDocument();
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

  it("stops an active microphone stream when the record sidebar unmounts", async () => {
    const stopTrack = vi.fn();
    const stopRecorder = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream);
    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
      }

      stop() {
        stopRecorder();
        this.state = "inactive";
        this.onstop?.();
      }
    }
    const originalMediaDevices = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    try {
      const rendered = render(<InterviewCenterPage view="records" />);
      fireEvent.click(
        await screen.findByRole("button", { name: /开始录音/ }),
      );
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
      rendered.unmount();
      expect(stopRecorder).toHaveBeenCalledTimes(1);
      expect(stopTrack).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      if (originalMediaDevices)
        Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
      else delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
    }
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

    fireEvent.click(screen.getByRole("button", { name: "取消面试" }));
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

  it("reuses the created application and request id when confirming a time conflict", async () => {
    const newApplication = {
      ...application,
      id: "99",
      job_description_id: "88",
      current_round_no: 1,
      current_stage_label: "一面",
      stage_state: "awaiting_schedule" as const,
      lock_version: 1,
    };
    mocks.createJobDescription.mockResolvedValue({
      job_description: { id: "88" },
    });
    mocks.createJobApplication.mockResolvedValue({ application: newApplication });
    mocks.createInterviewSession
      .mockRejectedValueOnce(new ApiRequestError(409, "INTERVIEW_TIME_CONFLICT"))
      .mockResolvedValueOnce({
        session: { ...session, id: "77", application_id: "99" },
        application: { ...newApplication, stage_state: "scheduled" },
        assets: [],
      });

    render(<InterviewCenterPage view="schedule" />);
    fireEvent.click(await screen.findByRole("button", { name: "安排面试" }));
    fireEvent.change(screen.getByLabelText("公司"), { target: { value: "新建公司" } });
    fireEvent.change(screen.getByLabelText("岗位"), { target: { value: "后端开发工程师" } });
    fireEvent.click(screen.getByRole("button", { name: "创建面试" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("与其他面试重叠");
    expect(mocks.createJobDescription).toHaveBeenCalledTimes(1);
    expect(mocks.createJobApplication).toHaveBeenCalledTimes(1);
    const firstPayload = mocks.createInterviewSession.mock.calls[0][1];
    fireEvent.click(screen.getByRole("button", { name: "仍然保存" }));
    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledTimes(2));
    expect(mocks.createInterviewSession.mock.calls[1][0]).toBe("99");
    expect(mocks.createInterviewSession.mock.calls[1][1]).toMatchObject({
      client_request_id: firstPayload.client_request_id,
      allow_conflict: true,
    });
    expect(mocks.createJobDescription).toHaveBeenCalledTimes(1);
    expect(mocks.createJobApplication).toHaveBeenCalledTimes(1);
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
      expect(mocks.advanceJobApplication).toHaveBeenCalledWith("56", {
        target_stage_type: "interview",
        target_round_no: 1,
        target_stage_label: "一面",
        base_lock_version: 1,
      }),
    );
  });
});
