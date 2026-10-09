import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewProcessDialog } from "./NewProcessDialog";
const mocks = vi.hoisted(() => ({ listJobDescriptions: vi.fn(), createJobDescription: vi.fn(), getJobApplication: vi.fn(), createJobApplication: vi.fn(), addJobApplicationStage: vi.fn(), createInterviewSession: vi.fn(), getInterviewSession: vi.fn(), updateInterviewAnswerPlan: vi.fn() }));
vi.mock("@/api/client", async (original) => ({ ...await original<typeof import("@/api/client")>(), api: mocks }));
const application = { id: "app-test", lock_version: 1, current_stage: { id: "stage-test" } };
const session = { session: { id: "session-test", start_at: "2030-10-01T06:00:00.000Z", lock_version: 2 } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.listJobDescriptions.mockResolvedValue({ items: [] });
  mocks.createJobDescription.mockResolvedValue({ job_description: { id: "job-test" }, application: { id: application.id } });
  mocks.getJobApplication.mockResolvedValue({ application }); mocks.addJobApplicationStage.mockResolvedValue({ application });
  mocks.createJobApplication.mockResolvedValue({ application }); mocks.getInterviewSession.mockResolvedValue(session);
  mocks.createInterviewSession.mockResolvedValue(session); mocks.updateInterviewAnswerPlan.mockResolvedValue(session);
});
function open() { const onCreated = vi.fn(); render(<NewProcessDialog applications={[]} timezone="Asia/Shanghai" initialStartAt="2030-10-01T14:00" onClose={vi.fn()} onCreated={onCreated} />); fireEvent.change(screen.getByLabelText("公司"), { target: { value: "示例公司" } }); fireEvent.change(screen.getByLabelText("职位"), { target: { value: "开发工程师" } }); return onCreated; }
function chooseDate(label: string, day = 3) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const picker = screen.getByRole("dialog", { name: label });
  fireEvent.click(within(picker).getByRole("button", { name: "下个月" }));
  const button = Array.from(picker.querySelectorAll<HTMLButtonElement>(".v3-picker-day:not(.is-muted)")).find((element) => element.textContent === String(day))!;
  fireEvent.click(button);
  fireEvent.click(within(picker).getByRole("button", { name: "确定" }));
}
function addPlan() {
  fireEvent.click(screen.getByRole("button", { name: "我的作答计划" }));
  chooseDate("计划作答时间", 2);
  fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
}
describe("新建求职流程的分步保存", () => {
  it("阶段成功、排期失败后只重试排期，并继续使用同一个幂等键", async () => {
    mocks.createInterviewSession.mockRejectedValueOnce(new Error("排期暂不可用"));
    const done = open(); fireEvent.click(screen.getByRole("button", { name: "创建求职流程" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("岗位和流程已创建");
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByLabelText("公司")).toBeDisabled();
    const first = mocks.createInterviewSession.mock.calls[0][1];
    fireEvent.click(screen.getByRole("button", { name: "重试保存排期" }));
    await waitFor(() => expect(done).toHaveBeenCalledWith("session-test", expect.objectContaining({ company: "示例公司", stage: "一面" })));
    expect(mocks.createJobDescription).toHaveBeenCalledTimes(1); expect(mocks.getJobApplication).toHaveBeenCalledTimes(1); expect(mocks.addJobApplicationStage).toHaveBeenCalledTimes(1);
    expect(mocks.createInterviewSession).toHaveBeenCalledTimes(2); expect(mocks.createInterviewSession.mock.calls[1][1].client_request_id).toBe(first.client_request_id);
  });
  it("岗位成功、读取待投递流程失败后不会重复创建岗位", async () => {
    mocks.getJobApplication.mockRejectedValueOnce(new Error("读取失败"));
    open(); fireEvent.click(screen.getByRole("button", { name: "创建求职流程" })); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试保存" })); await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledTimes(1));
    expect(mocks.createJobDescription).toHaveBeenCalledTimes(1); expect(mocks.createJobApplication).not.toHaveBeenCalled(); expect(mocks.getJobApplication).toHaveBeenCalledTimes(2);
  });
  it("测评没有截止时间时阻止所有写入", async () => {
    open(); fireEvent.click(screen.getByRole("button", { name: "测评" })); fireEvent.click(screen.getByRole("button", { name: "创建求职流程" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("截止时间"); expect(mocks.createJobDescription).not.toHaveBeenCalled(); expect(mocks.addJobApplicationStage).not.toHaveBeenCalled();
  });
  it("测评允许省略开放时间，并写入截止前完成的现有契约", async () => {
    const done = open(); fireEvent.click(screen.getByRole("button", { name: "测评" })); chooseDate("截止时间"); fireEvent.click(screen.getByRole("button", { name: "创建求职流程" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocks.addJobApplicationStage).toHaveBeenCalledWith("app-test", expect.objectContaining({ stage_type: "assessment", interview_round_no: null }));
    const payload = mocks.createInterviewSession.mock.calls[0][1]; expect(payload.schedule_kind).toBe("open_window"); expect(+new Date(payload.end_at)).toBeGreaterThan(+new Date(payload.start_at)); expect(payload.duration_minutes).toBeUndefined();
  });
  it("AI面试默认按时参加，切换阶段时不沿用测评的截止窗口", async () => {
    open(); fireEvent.click(screen.getByRole("button", { name: "测评" })); fireEvent.click(screen.getByRole("button", { name: "AI 面试" }));
    expect(screen.getByRole("button", { name: "按时参加" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "截止前完成" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "开始时间" })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "截止时间" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建求职流程" })); await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalled()); expect(mocks.createInterviewSession.mock.calls[0][1].schedule_kind).toBe("fixed_slot");
  });
  it("AI面试可选择截止前完成并保存开放窗口", async () => {
    open(); fireEvent.click(screen.getByRole("button", { name: "AI 面试" }));
    fireEvent.click(screen.getByRole("button", { name: "截止前完成" }));
    chooseDate("截止时间");
    fireEvent.click(screen.getByRole("button", { name: "创建求职流程" }));
    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalled());
    const payload = mocks.createInterviewSession.mock.calls[0][1];
    expect(payload.stage_label).toBe("AI 面试");
    expect(payload.schedule_kind).toBe("open_window");
    expect(+new Date(payload.end_at)).toBeGreaterThan(+new Date(payload.start_at));
    expect(payload.duration_minutes).toBeUndefined();
  });
  it("开放时间省略且排期响应丢失时，重试保持整份原始请求不变", async () => {
    mocks.createInterviewSession.mockRejectedValueOnce(new Error("连接中断"));
    open(); fireEvent.click(screen.getByRole("button", { name: "测评" })); chooseDate("截止时间"); fireEvent.click(screen.getByRole("button", { name: "创建求职流程" }));
    await screen.findByRole("alert");
    const first = structuredClone(mocks.createInterviewSession.mock.calls[0][1]);
    expect(screen.getByRole("button", { name: "截止时间" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试保存排期" }));
    await waitFor(() => expect(mocks.createInterviewSession).toHaveBeenCalledTimes(2));
    expect(mocks.createInterviewSession.mock.calls[1][1]).toEqual(first);
    expect(mocks.addJobApplicationStage).toHaveBeenCalledTimes(1);
  });
  it("岗位创建结果未知时禁止盲目重试，并允许确认后选择已创建岗位继续", async () => {
    const job = { id: "found-job", company_name: "示例公司", job_title: "开发工程师" };
    mocks.createJobDescription.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mocks.listJobDescriptions.mockResolvedValue({ items: [job], next_cursor: null });
    const done = open(); fireEvent.click(screen.getByRole("button", { name: "创建求职流程" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("岗位创建结果暂时无法确认");
    expect(screen.getByRole("button", { name: "创建求职流程" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("button", { name: "创建求职流程" }).closest("form")!);
    expect(mocks.createJobDescription).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "从岗位库确认" }));
    fireEvent.click(await screen.findByRole("option", { name: "示例公司 · 开发工程师" }));
    expect(screen.getByRole("button", { name: "新岗位" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "创建求职流程" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocks.createJobDescription).toHaveBeenCalledTimes(1);
    expect(mocks.createJobApplication).toHaveBeenCalledWith({ job_description_id: "found-job" });
  });
  it("岗位选择读取后续页，不丢弃100条之后的岗位", async () => {
    mocks.listJobDescriptions.mockResolvedValueOnce({ items: [], next_cursor: "next-page" }).mockResolvedValue({ items: [{ id: "later-job", company_name: "后续页公司", job_title: "开发" }], next_cursor: null });
    open(); await waitFor(() => expect(mocks.listJobDescriptions).toHaveBeenCalledWith({ limit: 100, cursor: "next-page" }));
    fireEvent.click(screen.getByRole("button", { name: "从岗位库选" }));
    fireEvent.click(screen.getByRole("button", { name: "已有岗位" }));
    expect(await screen.findByRole("option", { name: "后续页公司 · 开发" })).toBeInTheDocument();
  });
  it("作答计划失败时保留排期，只读回最新版本并重试计划", async () => {
    mocks.updateInterviewAnswerPlan.mockRejectedValueOnce(new Error("暂时无法保存计划"));
    mocks.getInterviewSession.mockResolvedValue({ session: { ...session.session, lock_version: 3 } });
    const done = open(); fireEvent.click(screen.getByRole("button", { name: "测评" })); chooseDate("截止时间"); addPlan();
    fireEvent.click(screen.getByRole("button", { name: "创建求职流程" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("排期已创建");
    fireEvent.click(screen.getByRole("button", { name: "重试保存计划" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocks.createJobDescription).toHaveBeenCalledTimes(1); expect(mocks.addJobApplicationStage).toHaveBeenCalledTimes(1); expect(mocks.createInterviewSession).toHaveBeenCalledTimes(1);
    expect(mocks.getInterviewSession).toHaveBeenCalledWith("session-test");
    expect(mocks.updateInterviewAnswerPlan).toHaveBeenLastCalledWith("session-test", expect.objectContaining({ base_lock_version: 3 }));
  });
  it("计划已保存但响应丢失时读回确认，不再次写入", async () => {
    mocks.updateInterviewAnswerPlan.mockImplementationOnce(async (_id, payload) => {
      mocks.getInterviewSession.mockResolvedValue({ session: { ...session.session, lock_version: 3, answer_plan_start_at: payload.answer_plan_start_at, answer_plan_end_at: new Date(+new Date(payload.answer_plan_start_at) + payload.duration_minutes * 60000).toISOString() } });
      throw new TypeError("Failed to fetch");
    });
    const done = open(); fireEvent.click(screen.getByRole("button", { name: "测评" })); chooseDate("截止时间"); addPlan();
    fireEvent.click(screen.getByRole("button", { name: "创建求职流程" })); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试保存计划" })); await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocks.updateInterviewAnswerPlan).toHaveBeenCalledTimes(1); expect(mocks.createInterviewSession).toHaveBeenCalledTimes(1);
  });
  it("同步重复提交在首次响应前也只创建一次岗位", async () => {
    let resolve: (result: unknown) => void = () => undefined;
    mocks.createJobDescription.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const done = open(); const form = screen.getByRole("button", { name: "创建求职流程" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form); expect(mocks.createJobDescription).toHaveBeenCalledTimes(1);
    resolve({ job_description: { id: "job-test" }, application: { id: application.id } }); await waitFor(() => expect(done).toHaveBeenCalled());
  });
  it("计划响应未知后选择清除，会读回并清除已保存的计划", async () => {
    mocks.updateInterviewAnswerPlan.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mocks.getInterviewSession.mockResolvedValue({ session: { ...session.session, lock_version: 4, answer_plan_start_at: "2030-10-01T06:00:00Z", answer_plan_end_at: "2030-10-01T07:00:00Z" } });
    const done = open(); fireEvent.click(screen.getByRole("button", { name: "测评" })); chooseDate("截止时间"); addPlan();
    fireEvent.click(screen.getByRole("button", { name: "创建求职流程" })); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "我的作答计划" })); fireEvent.click(screen.getByRole("button", { name: "清除" }));
    fireEvent.click(screen.getByRole("button", { name: "重试保存计划" })); await waitFor(() => expect(done).toHaveBeenCalled());
    expect(mocks.updateInterviewAnswerPlan).toHaveBeenLastCalledWith("session-test", { base_lock_version: 4, answer_plan_start_at: null, answer_plan_end_at: null });
    expect(mocks.createInterviewSession).toHaveBeenCalledTimes(1);
  });
});
