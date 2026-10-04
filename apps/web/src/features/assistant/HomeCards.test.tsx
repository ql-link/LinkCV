import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type JobApplicationSummary, type JobMatchRecommendations } from "../../api/client";
import { HomeCardView } from "./HomeCards";

const item = (index: number, score: number, status: string | null = "待投递") => ({
  job_id: `job-${index}`, job_title: `后端开发${index}`, company_name: `示例公司${index}`,
  logo_url: null, score, application_status: status,
});

const base: JobMatchRecommendations = {
  state: "ready", resume: { id: "resume-1", title: "后端工程师 · 通用版" }, items: [],
  pending_count: 0, can_compute: false,
};

function renderCard() {
  return render(<HomeCardView card={{ kind: "jobs" }} now={new Date("2026-10-03T08:00:00Z")} />);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("首页匹配岗位卡", () => {
  it.each([
    ["2026-10-05", "还有 2 天回复"],
    ["2026-10-03", "今天截止"],
    ["2026-10-01", "回复截止已过 2 天"],
    [null, "回复截止待填写"],
  ])("shows the real Offer deadline state for %s", (replyDueOn, label) => {
    const { container } = render(<HomeCardView card={{ kind: "offer", company: "日期示例公司", applicationId: "42", replyDueOn }} now={new Date(2026, 9, 3, 23, 59)} />);
    expect(screen.getByText(`日期示例公司 · ${label}`)).toBeInTheDocument();
    expect(screen.queryByText("需后端")).not.toBeInTheDocument();
    expect(container.querySelector("a")).toHaveAttribute("href", "/career/applications/42");
    expect(container).not.toHaveTextContent("18:00");
  });
  it("opens a real Offer comparison with dates and does not compare mismatched salaries", () => {
    const offer = { id: "1", company_name_snapshot: "示例公司A", job_title_snapshot: "工程师", offer_salary: "30000", offer_salary_currency: "CNY", offer_salary_period: "month", offer_reply_due_on: "2026-10-05" } as JobApplicationSummary;
    render(<HomeCardView card={{ kind: "compare", offers: [offer, { ...offer, id: "2", company_name_snapshot: "示例公司B", offer_salary_currency: "USD", offer_reply_due_on: null }] }} now={new Date()} />);
    fireEvent.click(screen.getByRole("link", { name: "开始对比 Offer" }));
    expect(screen.getByRole("dialog", { name: "Offer 对比" })).toHaveTextContent("2026年10月5日");
    expect(screen.getByRole("table")).toHaveTextContent("30K/月");
    expect(screen.getByText(/暂不比较薪资差距/)).toBeInTheDocument();
    expect(screen.queryByText(/薪资相差/)).not.toBeInTheDocument();
  });
  it("展示最近简历下得分最高的岗位、投递状态和简历名，并进入第一个岗位", async () => {
    vi.spyOn(api, "getJobMatchRecommendations").mockResolvedValue({ ...base, items: [item(1, 91, "一面"), item(2, 82), item(3, 70, null)] });
    const ensure = vi.spyOn(api, "ensureJobMatchRecommendations");
    const { container } = renderCard();
    expect(await screen.findByText("基于《后端工程师 · 通用版》")).toBeInTheDocument();
    expect(screen.getByText("示例公司1 · 后端开发1")).toBeInTheDocument();
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText("一面")).toBeInTheDocument();
    expect(screen.getByText("未投递")).toBeInTheDocument();
    expect(screen.queryByText("需后端")).not.toBeInTheDocument();
    expect(ensure).not.toHaveBeenCalled();
    expect((container.querySelector("a") as HTMLAnchorElement).getAttribute("href")).toContain("job-1");
  });

  it("没有结果时自动触发计算，显示进度，算完后无需刷新就出现结果", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, "getJobMatchRecommendations")
      .mockResolvedValueOnce({ ...base, state: "idle", can_compute: true })
      .mockResolvedValueOnce({ ...base, items: [item(1, 88)] });
    const ensure = vi.spyOn(api, "ensureJobMatchRecommendations").mockResolvedValue({ ...base, state: "computing", pending_count: 2 });
    renderCard();
    expect(await screen.findByText("正在对照你的简历…")).toBeInTheDocument();
    expect(ensure).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(await screen.findByText("88")).toBeInTheDocument();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("没有可分析的岗位时引导保存岗位，不显示示例数字", async () => {
    vi.spyOn(api, "getJobMatchRecommendations").mockResolvedValue({ ...base, state: "no_jobs" });
    renderCard();
    expect(await screen.findByText("保存岗位，查看匹配度")).toBeInTheDocument();
    expect(screen.queryByText("91")).not.toBeInTheDocument();
  });

  it("模型未配置或计算失败时显示说明并停止", async () => {
    vi.spyOn(api, "getJobMatchRecommendations").mockResolvedValue({ ...base, state: "idle", can_compute: true });
    vi.spyOn(api, "ensureJobMatchRecommendations").mockResolvedValue({ ...base, state: "unavailable" });
    renderCard();
    expect(await screen.findByText("暂时无法计算匹配度")).toBeInTheDocument();
  });

  it("接口出错时同样显示说明，不抛错", async () => {
    vi.spyOn(api, "getJobMatchRecommendations").mockRejectedValue(new Error("network"));
    renderCard();
    await waitFor(() => expect(screen.getByText("暂时无法计算匹配度")).toBeInTheDocument());
  });

  it("轮询超过次数上限后停止并提示稍后刷新", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const read = vi.spyOn(api, "getJobMatchRecommendations").mockResolvedValue({ ...base, state: "computing", pending_count: 1 });
    renderCard();
    await screen.findByText("正在对照你的简历…");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 25); });
    expect(await screen.findByText("还在分析，稍后刷新查看")).toBeInTheDocument();
    const calls = read.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(read.mock.calls.length).toBe(calls);
  });
});
