import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api, type InterviewSessionSummary, type JobApplicationSummary, type ResumeSummary } from "../../api/client";
import { buildHomeDashboard, homeCopy, pipelineColumns, useHomeDashboard } from "./homeDashboard";
import { useResumeStore } from "../../store/resumeStore";
import { MAX_PREVIEW_TABS, openPreviewTab, type PreviewTab } from "./PreviewPanel";
import { modelVendor } from "./ModelPicker";

// 固定「现在」为 2026-09-30（周三）14:00 本地时间
const now = new Date(2026, 8, 30, 14, 0, 0);

const resume = (id: string, updatedAt: string): ResumeSummary => ({
  id,
  title: `简历 ${id}`,
  source_type: "blank",
  lock_version: 1,
  created_at: updatedAt,
  updated_at: updatedAt,
});

const sessionAt = (start: Date, patch: Partial<InterviewSessionSummary> = {}) => ({
  id: `s-${start.getTime()}`,
  application_id: "a1",
  stage_type: "interview",
  round_no: 3,
  stage_label: "三面",
  status: "scheduled",
  start_at: start.toISOString(),
  end_at: new Date(start.getTime() + 3_600_000).toISOString(),
  schedule_kind: "fixed_slot",
  answer_plan_start_at: null,
  answer_plan_end_at: null,
  mode: "video",
  company_name: "示例科技",
  job_title: "后端开发",
  ...patch,
}) as InterviewSessionSummary;

const application = (patch: Partial<JobApplicationSummary> = {}) => ({
  id: "a1",
  company_name_snapshot: "示例科技",
  job_title_snapshot: "后端开发",
  status: "active",
  lifecycle_status: "active",
  archived_at: null,
  offer_status: "none",
  stage_state: "scheduled",
  current_stage_type: "interview",
  current_stage_label: "三面",
  phase: "applied",
  applied_at: null,
  ...patch,
}) as JobApplicationSummary;

const base = { now, latestResumeScore: null, sessions: [], applications: [] };

describe("首页异步状态", () => {
  it("prioritizes the earliest known Offer deadline and keeps missing dates last", () => {
    const dashboard = buildHomeDashboard({ ...base, resumes: [resume("1", "2026-09-29T00:00:00Z")], applications: [
      application({ id: "unknown", offer_status: "received" }),
      application({ id: "later", offer_status: "received", offer_reply_due_on: "2026-10-10" }),
      application({ id: "urgent", offer_status: "received", offer_reply_due_on: "2026-10-01" }),
    ] });
    expect(dashboard.cards[0]).toMatchObject({ kind: "offer", applicationId: "urgent", replyDueOn: "2026-10-01" });
  });
  const originalStore = useResumeStore.getState();
  afterEach(() => { vi.restoreAllMocks(); useResumeStore.setState(originalStore, true); });

  it("返回首页重新读取时不先展示上一次的业务文案", async () => {
    useResumeStore.setState({ resumes: [], listResumes: vi.fn().mockResolvedValue(undefined) });
    vi.spyOn(api, "listInterviewSessions").mockResolvedValue({ items: [], next_cursor: null });
    vi.spyOn(api, "listJobApplications").mockResolvedValue({ items: [], next_cursor: null });
    const view = renderHook(({ enabled }) => useHomeDashboard(enabled), { initialProps: { enabled: true } });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    let finish!: (value: Awaited<ReturnType<typeof api.listInterviewSessions>>) => void;
    vi.mocked(api.listInterviewSessions).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    view.rerender({ enabled: false });
    view.rerender({ enabled: true });
    expect(view.result.current.status).toBe("loading");
    expect(view.result.current).not.toHaveProperty("dashboard");
    await act(async () => { finish({ items: [], next_cursor: null }); });
    expect(view.result.current.status).toBe("ready");
  });

  it("账号变化后丢弃前一个账号的迟到结果", async () => {
    const user = { id: "home-user-a", email: "a@example.test", nickname: "用户甲", is_admin: false };
    useResumeStore.setState({ user, resumes: [], listResumes: vi.fn().mockResolvedValue(undefined) });
    let rejectOld!: (error: Error) => void;
    vi.spyOn(api, "listInterviewSessions").mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject; })).mockResolvedValue({ items: [], next_cursor: null });
    vi.spyOn(api, "listJobApplications").mockResolvedValue({ items: [], next_cursor: null });
    const view = renderHook(() => useHomeDashboard(true));
    act(() => { useResumeStore.setState({ user: { ...user, id: "home-user-b" } }); });
    await waitFor(() => expect(view.result.current.status).toBe("ready"));
    await act(async () => { rejectOld(new Error("old request failed")); });
    expect(view.result.current.status).toBe("ready");
  });
});

describe("首页卡片规则", () => {
  it("没有简历时固定显示三张引导卡", () => {
    const dashboard = buildHomeDashboard({ ...base, resumes: [] });
    expect(dashboard.variant).toBe("new");
    expect(dashboard.cards.map((card) => card.kind)).toEqual(["firstResume", "target", "plugin"]);
    expect(homeCopy(dashboard).title).toBe("先准备第一份简历吧。");
  });

  it("有未回复的 Offer 时位置 1 为 Offer，2 个以上 Offer 时位置 2 为 Offer 对比", () => {
    const dashboard = buildHomeDashboard({
      ...base,
      resumes: [resume("1", "2026-09-29T00:00:00Z")],
      applications: [
        application({ id: "a1", company_name_snapshot: "美团", offer_status: "received" }),
        application({ id: "a2", company_name_snapshot: "快手", offer_status: "received" }),
      ],
    });
    expect(dashboard.variant).toBe("offer");
    expect(dashboard.cards.map((card) => card.kind)).toEqual(["offer", "compare", "pipeline"]);
  });

  it("今天有面试时位置 1 为今日日程，简历完整度低于 90% 时位置 2 为简历待完善", () => {
    const dashboard = buildHomeDashboard({
      ...base,
      resumes: [resume("old", "2026-09-01T00:00:00Z"), resume("new", "2026-09-29T00:00:00Z")],
      latestResumeScore: { score: 82, missing: "经历成果描述" },
      sessions: [sessionAt(new Date(2026, 8, 30, 16, 0)), sessionAt(new Date(2026, 8, 30, 19, 0))],
      applications: [application()],
    });
    expect(dashboard.variant).toBe("today");
    const [today, resumeCard, pipeline] = dashboard.cards;
    expect(today).toMatchObject({ kind: "today", others: 1 });
    expect(resumeCard).toMatchObject({ kind: "resumeTodo", score: 82 });
    expect(resumeCard.kind === "resumeTodo" && resumeCard.resume.id).toBe("new");
    expect(pipeline.kind).toBe("pipeline");
  });

  it("3 天内有笔试截止时位置 1 为截止提醒", () => {
    const dashboard = buildHomeDashboard({
      ...base,
      resumes: [resume("1", "2026-09-29T00:00:00Z")],
      sessions: [sessionAt(new Date(2026, 9, 1, 9), {
        stage_label: "笔试",
        schedule_kind: "open_window",
        answer_plan_end_at: new Date(2026, 9, 2, 18).toISOString(),
      })],
      applications: [application()],
    });
    expect(dashboard.variant).toBe("deadline");
    expect(dashboard.cards[0]).toMatchObject({ kind: "deadline", daysLeft: 2 });
    expect(homeCopy(dashboard).subtitle).toBe("示例科技的笔试 2 天后截止。");
  });

  it("空闲日位置 1 为本周概览，位置 3 为推荐岗位；完整度达标时位置 2 为最近编辑的简历", () => {
    const dashboard = buildHomeDashboard({
      ...base,
      resumes: [resume("1", "2026-09-29T00:00:00Z")],
      latestResumeScore: { score: 95, missing: null },
      sessions: [sessionAt(new Date(2026, 9, 2, 10))],
      applications: [application()],
    });
    expect(dashboard.variant).toBe("idle");
    expect(dashboard.cards.map((card) => card.kind)).toEqual(["week", "resumeRecent", "jobs"]);
    expect(dashboard.cards[0].kind === "week" && dashboard.cards[0].sessions).toHaveLength(1);
  });

  it("岗位看板插图按待投递 / 笔试 / 面试 / Offer 分列", () => {
    expect(pipelineColumns([
      application({ phase: "pending" }),
      application({ current_stage: { stage_type: "written_test" } as JobApplicationSummary["current_stage"] }),
      application(),
      application({ offer_status: "received" }),
    ])).toEqual({ pending: 1, test: 1, interview: 1, offer: 1 });
  });
});

describe("右侧预览标签", () => {
  const tab = (id: string): PreviewTab => ({ kind: "dataset", id, label: `${id}.md` });

  it("已打开的文件不重复开，超过 6 个时关掉最早的一个", () => {
    let tabs: PreviewTab[] = [];
    for (let index = 1; index <= MAX_PREVIEW_TABS; index += 1) tabs = openPreviewTab(tabs, tab(String(index)));
    expect(openPreviewTab(tabs, tab("3"))).toBe(tabs);
    const next = openPreviewTab(tabs, tab("7"));
    expect(next).toHaveLength(MAX_PREVIEW_TABS);
    expect(next.map((item) => item.id)).toEqual(["2", "3", "4", "5", "6", "7"]);
  });
});

describe("模型厂商图标", () => {
  it("按模型名匹配厂商，认不出的返回空（用 spark 图标）", () => {
    expect(modelVendor("GPT-6 Sol")).toBe("openai");
    expect(modelVendor("o1-mini")).toBe("openai");
    expect(modelVendor("Claude Opus 5")).toBe("claude");
    expect(modelVendor("Gemini 3 Pro")).toBe("gemini");
    expect(modelVendor("deepseek/deepseek-v4-flash")).toBe("deepseek");
    expect(modelVendor("Moonshot Kimi K2.5")).toBe("kimi");
    expect(modelVendor("Grok 4")).toBe("grok");
    expect(modelVendor("Qwen 3")).toBeNull();
  });
});
