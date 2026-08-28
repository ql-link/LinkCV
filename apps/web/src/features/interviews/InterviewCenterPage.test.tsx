import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/api/client";
import { InterviewCenterPage } from "./InterviewCenterPage";

const mocks = vi.hoisted(() => ({
  listInterviewSessions: vi.fn(),
  listJobApplications: vi.fn(),
  getInterviewSession: vi.fn(),
  updateJobApplication: vi.fn(),
  rescheduleInterviewSession: vi.fn(),
  listJobDescriptions: vi.fn(),
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

  it("renders the high-fidelity application detail from snapshots and all sessions", async () => {
    const detailedApplication = {
      ...application,
      applied_at: "2026-08-16T09:30:00Z",
      resume_title_snapshot: "后端技术简历",
      notes: "通过官网投递，等待二面结果。",
      job_snapshot: {
        schema_version: 1,
        salary_text: "25-40K·13薪",
        work_city: "上海",
        employment_type: "full_time",
        description: "负责服务端接口与稳定性建设。",
        skills: ["Java", "MySQL", "Redis"],
        education_requirement: "本科及以上",
        experience_requirement: "3-5年",
        work_schedule: "周一至周五",
      },
    };
    const completedSession = {
      ...session,
      id: "30",
      stage_label: "一面",
      round_no: 1,
      status: "completed" as const,
      start_at: new Date(new Date(session.start_at).getTime() - 86_400_000).toISOString(),
      end_at: new Date(new Date(session.end_at).getTime() - 86_400_000).toISOString(),
      questions_markdown: "请介绍一个缓存设计。",
      review_summary: "回答完成。",
      improvement_markdown: null,
    };
    mocks.listInterviewSessions.mockResolvedValue({
      items: [session, completedSession],
      next_cursor: null,
    });
    mocks.listJobApplications.mockResolvedValue({
      items: [{
        ...detailedApplication,
        next_session_id: session.id,
        next_session_start_at: session.start_at,
        next_session_end_at: session.end_at,
        next_session_mode: session.mode,
      }],
      next_cursor: null,
    });

    render(
      <InterviewCenterPage
        view="applications"
        initialApplicationId="21"
        navigation={<nav aria-label="不应显示的求职导航">岗位库 求职进程</nav>}
      />,
    );

    expect(await screen.findByRole("heading", { name: /腾讯.*后端开发工程师/ })).toBeInTheDocument();
    expect(document.querySelector(".career-module-header")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "不应显示的求职导航" })).not.toBeInTheDocument();
    expect(screen.getByText("25-40K·13薪")).toBeInTheDocument();
    expect(screen.getByText("上海")).toBeInTheDocument();
    expect(screen.getByText("全职")).toBeInTheDocument();
    expect(screen.getByText("负责服务端接口与稳定性建设。")).toBeInTheDocument();
    expect(screen.getAllByText("后端技术简历")).toHaveLength(2);
    expect(screen.getByText("通过官网投递，等待二面结果。")).toBeInTheDocument();
    const sessionLinks = screen.getAllByRole("link", { name: /进入记录查看录音与素材/ });
    expect(sessionLinks[0]).toHaveTextContent("一面");
    expect(sessionLinks[0]).toHaveAttribute("href", "/career/applications/21?session=30");
    expect(sessionLinks[1]).toHaveTextContent("二面");
    expect(mocks.getInterviewSession).not.toHaveBeenCalled();
    expect(mocks.listInterviewSessions).toHaveBeenCalledWith({
      include_archived: true,
      application_id: "21",
      cursor: undefined,
      limit: 500,
    });
    expect(mocks.listInterviewSessions.mock.calls[0][0]).not.toHaveProperty("start_at");
    expect(mocks.listInterviewSessions.mock.calls[0][0]).not.toHaveProperty("end_at");
  });

  it("renders the empty detail state and only enables scheduling for an active awaiting stage", async () => {
    const awaitingApplication = {
      ...application,
      current_stage_type: "interview" as const,
      current_round_no: 1,
      current_stage_label: "一面",
      stage_state: "awaiting_schedule" as const,
      next_session_id: null,
      next_session_start_at: null,
      next_session_end_at: null,
      next_session_mode: null,
    };
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
    mocks.listJobApplications.mockResolvedValue({
      items: [awaitingApplication],
      next_cursor: null,
    });

    render(<InterviewCenterPage view="applications" initialApplicationId="21" />);

    expect(await screen.findByRole("heading", { name: "暂无面试记录" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "安排面试" })).toHaveLength(1);
    expect(screen.getByText("当前阶段还没有安排面试，完成安排后会显示在这里。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "安排面试" }));
    expect(await screen.findByRole("dialog", { name: "新建面试" })).toBeInTheDocument();
  });

  it("uses the shared loading component while career data is pending", () => {
    mocks.listInterviewSessions.mockReturnValue(new Promise(() => {}));

    render(<InterviewCenterPage view="applications" />);

    expect(screen.getByRole("status", { name: "正在加载求职数据…" })).toHaveClass(
      "page-loading",
      "is-workspace",
    );
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

  it("shows mock schedule events and mock detail when the development database is empty", async () => {
    mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });

    render(<InterviewCenterPage view="schedule" />);

    const calendar = await screen.findByRole("grid", { name: "面试周排期，可拖动并按 30 分钟调整" });
    const event = within(calendar).getByRole("button", { name: /阿里巴巴.*二面/ });
    fireEvent.click(event);
    const dialog = await screen.findByRole("dialog", { name: "面试详情" });
    expect(within(dialog).getByText("李明（技术专家）")).toBeInTheDocument();
    expect(within(dialog).getByText("项目经验整理.pdf")).toBeInTheDocument();
    expect(within(dialog).getByText("准备提问：团队技术栈与挑战")).toBeInTheDocument();
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

  it("renders the Figma list-first career records and switches to the six-stage board", async () => {
    render(<InterviewCenterPage view="applications" />);

    expect(await screen.findByRole("table", { name: "求职记录列表" })).toBeInTheDocument();
    const moduleHeader = document.querySelector(".career-module-header") as HTMLElement;
    expect(within(moduleHeader).getByRole("searchbox", { name: "搜索公司、岗位" })).toBeInTheDocument();
    expect(within(moduleHeader).getByRole("button", { name: "导入岗位" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /全部记录 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "列表" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "公司", "岗位", "当前进度", "下一阶段", "最近面试", "更新时间", "操作",
    ]);
    expect(screen.getByRole("button", { name: "查看记录" })).toBeInTheDocument();
    expect(screen.queryByText("进行中的进程")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "阶段看板" }));
    expect(await screen.findByRole("region", { name: "求职阶段看板" })).toBeInTheDocument();
    expect(["待投递", "筛选中", "测评中", "面试中", "等待通知", "已结束"].map((label) =>
      screen.getByRole("heading", { name: new RegExp(`^${label}`) }).textContent,
    )).toHaveLength(6);
    expect(screen.getByRole("link", { name: "查看 腾讯 后端开发工程师 求职记录" })).not.toHaveAttribute("draggable");
    expect(mocks.advanceJobApplication).not.toHaveBeenCalled();
  });

  it("renders the Figma empty record state without the removed dashboard metrics", async () => {
    mocks.listJobApplications.mockResolvedValue({ items: [], next_cursor: null });

    const { container } = render(<InterviewCenterPage view="applications" />);

    expect(await screen.findByRole("heading", { name: "还没有求职记录" })).toBeInTheDocument();
    expect(container.querySelector(".career-applications-empty-surface")).not.toHaveClass("interview-surface");
    expect(screen.getByRole("button", { name: "导入第一个岗位" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /全部记录 0/ })).toBeInTheDocument();
    for (const label of ["进行中的进程", "本周待面试", "待跟进", "已拿 Offer"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "阶段看板" }));
    expect(screen.getByRole("region", { name: "求职阶段看板" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "还没有求职记录" })).not.toBeInTheDocument();
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
      current_stage_label: "筛选中",
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
