import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockInterviewPage } from "./MockInterviewPage";
import { mockInterviewApi, resetMockInterviewStore } from "./mockInterviewApi";
import { setLocale } from "../../i18n";

// 真实接口（简历 / 求职记录 / 面试安排 / 资料）全部替身；模拟面试本身走本地假数据层
const mocks = vi.hoisted(() => ({
  listResumes: vi.fn(),
  listJobApplications: vi.fn(),
  listInterviewSessions: vi.fn(),
  listDatasets: vi.fn(),
}));
vi.mock("@/api/client", async (original) => ({ ...await original<typeof import("@/api/client")>(), api: mocks }));
// 侧栏依赖会话 / 用户接口，这里只测内容卡
vi.mock("@/v3/Shell", () => ({ V3Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
// 语音输入按钮由另一模块负责，测试里换成最简替身
vi.mock("./voice/VoiceInputButton", () => ({
  VoiceInputButton: () => <button type="button">语音输入</button>,
  voiceInputFooterHint: () => "Enter 发送 · Shift + Enter 换行",
}));

const resume = { id: "resume-1", title: "示例简历 · 后端", source_type: "blank", lock_version: 1, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-25T00:00:00Z" };
const application = {
  id: "app-1", resume_id: "resume-1", job_description_id: "jd-1", company_name_snapshot: "示例科技", job_title_snapshot: "后端工程师",
  job_snapshot: {}, resume_title_snapshot: null, calendar_color: "blue", current_stage_type: "interview", current_round_no: 3, current_stage_label: "三面",
  stage_state: "scheduled", status: "active", lifecycle_status: "active", offer_status: "none", is_favorite: false, applied_at: null, notes: null, archived_at: null,
  lock_version: 1, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", next_session_id: "s-1", next_session_start_at: null, next_session_end_at: null, next_session_mode: null,
};

function go(path: string) {
  window.history.pushState(null, "", path);
}

beforeEach(() => {
  localStorage.clear();
  resetMockInterviewStore(true);
  mocks.listResumes.mockResolvedValue({ resumes: [resume] });
  mocks.listJobApplications.mockResolvedValue({ items: [application], next_cursor: null });
  mocks.listInterviewSessions.mockResolvedValue({ items: [], next_cursor: null });
  mocks.listDatasets.mockResolvedValue({ datasets: [] });
});
afterEach(() => { setLocale("zh-CN", false); vi.useRealTimers(); go("/"); });

describe("07 模拟面试 · 文字面试", () => {
  it("英文设置摘要不残留中文提示，也不会改变默认的面试作答语言", async () => {
    setLocale("en-US", false);
    go("/mock-interviews/new?application=app-1");
    render(<MockInterviewPage view="new" applicationId="app-1" />);
    await waitFor(() => expect(screen.getByLabelText("Resume")).toHaveTextContent(resume.title));
    const summary = screen.getByRole("button", { name: /More settings/ });
    expect(summary).toHaveTextContent("Chinese");
    expect(summary).toHaveTextContent("Allow follow-ups");
    expect(summary).not.toHaveTextContent("允许追问");
    const create = vi.spyOn(mockInterviewApi, "create").mockRejectedValueOnce(new Error("Fictional test failure"));
    fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ language: "zh" })));
    create.mockRestore();
  });

  it("新建 → 准备中 → 作答（逐字输出、追问）→ 跳过 → 结束 → 评估报告与单题详情", async () => {
    go("/mock-interviews/new?application=app-1");
    const view = render(<MockInterviewPage view="new" applicationId="app-1" />);
    // 求职记录带入：简历用记录关联的简历，三面默认综合面
    await waitFor(() => expect(screen.getByLabelText("简历")).toHaveTextContent("示例简历 · 后端"));
    expect(screen.getByLabelText("目标岗位")).toHaveTextContent("示例科技 · 后端工程师");
    expect(screen.getByRole("button", { name: "综合面" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "技术面" }));
    // 作答方式组件已接入
    expect(screen.getByRole("radiogroup", { name: "作答方式" })).toBeInTheDocument();
    // 更多设置：题数改成 3
    fireEvent.click(screen.getByRole("button", { name: /更多设置/ }));
    const dialog = await screen.findByRole("dialog", { name: "更多设置" });
    fireEvent.click(within(dialog).getByLabelText("主问题数"));
    fireEvent.click(await screen.findByRole("option", { name: /3 道题/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(screen.getByRole("button", { name: /更多设置/ })).toHaveTextContent("3 道题");

    const create = vi.spyOn(mockInterviewApi, "create");
    fireEvent.click(screen.getByRole("button", { name: "开始面试" }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/mock-interviews\/(?!new$)[^/]+$/));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ job_application_id: "app-1", resume_id: "resume-1", interview_type: "technical", question_count: 3, answer_mode: "text" }));
    const id = decodeURIComponent(window.location.pathname.split("/")[2]);

    view.unmount();
    render(<MockInterviewPage view="session" interviewId={id} />);
    expect(await screen.findByRole("heading", { name: "面试官正在准备题目" })).toBeInTheDocument();
    // 后台准备约 2.4 秒后推进到 in_progress
    expect(await screen.findByText(/你在简历里写了/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("第 1 / 3 题")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "语音输入" })).toBeInTheDocument();

    // 作答：Enter 发送，面试官追问逐字输出
    const input = screen.getByLabelText("你的回答");
    fireEvent.change(input, { target: { value: "按租户加任务 ID 取模分片，热点靠积压监控发现。" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("正在输入…")).toBeInTheDocument();
    expect(await screen.findByText(/某个分片突然成为热点/, undefined, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("正在输入…")).not.toBeInTheDocument());
    expect(await screen.findByText("第 1 / 3 题 · 追问 1")).toBeInTheDocument();
    expect(screen.getByText("按租户加任务 ID 取模分片，热点靠积压监控发现。")).toBeInTheDocument();

    // 跳过追问 → 第 2 题
    fireEvent.click(screen.getByRole("button", { name: "跳过此题" }));
    expect(await screen.findByText("第 2 / 3 题", undefined, { timeout: 5000 })).toBeInTheDocument();

    // 提前结束并评估
    fireEvent.click(screen.getByRole("button", { name: "结束并评估" }));
    const confirm = await screen.findByRole("dialog", { name: "结束并生成评估？" });
    fireEvent.click(within(confirm).getByRole("button", { name: "结束并评估" }));
    expect(await screen.findByRole("heading", { name: "正在生成评估报告" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(`/mock-interviews/${id}/report`), { timeout: 5000 });
  }, 20_000);

  it("评估报告：总分、维度、逐题筛选与单题详情翻页", async () => {
    const { items } = await mockInterviewApi.list();
    const seeded = items.find((item) => item.answer_mode === "text")!;
    go(`/mock-interviews/${seeded.id}/report`);
    render(<MockInterviewPage view="report" interviewId={seeded.id} />);
    expect(await screen.findByRole("heading", { name: /评估报告/ })).toBeInTheDocument();
    expect(screen.getByText("项目细节扎实，但故障边界与一致性权衡讲得不够深")).toBeInTheDocument();
    expect(screen.getByText("5 题全部作答", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "能力维度" })).toHaveTextContent("简历一致性");
    expect(screen.getByRole("region", { name: "事实核验" })).toHaveTextContent("一致");
    // 报告已接真实接口，不再贴「需后端」
    expect(screen.queryAllByTitle("需要后端支持，目前为示例数据")).toHaveLength(0);

    const questions = screen.getByRole("region", { name: "逐题表现" });
    fireEvent.click(within(questions).getByRole("button", { name: /待提升/ }));
    const weakCount = within(questions).getAllByRole("button", { name: /^Q\d/ }).length;
    fireEvent.click(within(questions).getByRole("button", { name: /^全部/ }));
    expect(within(questions).getAllByRole("button", { name: /^Q\d/ })).toHaveLength(5);
    expect(weakCount).toBeLessThan(5);

    fireEvent.click(within(questions).getByRole("button", { name: /^Q1/ }));
    const detail = await screen.findByRole("dialog", { name: "第 1 题详情" });
    expect(within(detail).getByText("第 1 题 / 共 5 题")).toBeInTheDocument();
    expect(within(detail).getByText("参考思路")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "‹ 上一题" })).toBeDisabled();
    fireEvent.click(within(detail).getByRole("button", { name: "下一题 ›" }));
    expect(await screen.findByRole("dialog", { name: "第 2 题详情" })).toBeInTheDocument();
  });

  it("首页：有面试安排时展示主卡、统计与其他在投岗位；练习记录可筛选", async () => {
    const start = new Date(Date.now() + 3 * 3_600_000).toISOString();
    mocks.listInterviewSessions.mockResolvedValue({ items: [{ id: "s-1", application_id: "app-1", stage_label: "三面", status: "scheduled", start_at: start, end_at: start, company_name: "示例科技", job_title: "后端工程师" }], next_cursor: null });
    go("/mock-interviews");
    const view = render(<MockInterviewPage view="home" />);
    const upcoming = await screen.findByRole("region", { name: "最近的面试安排" });
    expect(within(upcoming).getByRole("heading", { name: "示例科技 · 后端工程师" })).toBeInTheDocument();
    expect(within(upcoming).getByText("3 小时后")).toBeInTheDocument();
    // 每页只有一个黑色主按钮：主卡按钮是黑色，页头「开始新面试」降为描边
    expect(document.querySelectorAll(".v3-btn-dark")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "练习数据" })).toHaveTextContent("平均分");

    fireEvent.click(screen.getByRole("button", { name: /练习记录/ }));
    view.unmount();
    render(<MockInterviewPage view="home" />);
    const table = await screen.findByRole("table", { name: "练习记录" });
    expect(within(table).getAllByRole("row")).toHaveLength(3); // 表头 + 2 场示例
    fireEvent.click(screen.getByRole("button", { name: /已放弃/ }));
    expect(within(table).getAllByRole("row")).toHaveLength(1);
    expect(table).toHaveTextContent("没有符合条件的练习记录");
  });

  it("新用户：没有安排也没有记录时显示引导卡与占位统计", async () => {
    resetMockInterviewStore(false);
    go("/mock-interviews");
    render(<MockInterviewPage view="home" />);
    expect(await screen.findByRole("heading", { name: "还没有面试安排，也还没练过" })).toBeInTheDocument();
    expect(screen.getByText("完成第 1 场面试后生成")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "从在投岗位开始" })).toHaveTextContent("示例科技 · 后端工程师");
    expect(screen.getByRole("button", { name: /练习记录/ })).toBeDisabled();
  });

  it("已有进行中的场次时，新建会提示并保留在表单页", async () => {
    await act(async () => { await mockInterviewApi.create({ resume_id: "resume-1" }); });
    go("/mock-interviews/new");
    render(<MockInterviewPage view="new" />);
    await waitFor(() => expect(screen.getByLabelText("简历")).toHaveTextContent("示例简历 · 后端"));
    fireEvent.click(screen.getByRole("button", { name: "开始面试" }));
    expect(await screen.findByText("已有一场进行中的模拟面试")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/mock-interviews/new");
  });
});
