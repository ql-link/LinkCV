import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type PoolJob } from "../../api/client";
import { OpportunitiesPage } from "./OpportunitiesPage";
import { parseAppRoute } from "../../routing";

const job: PoolJob = {
  id: "1001", company: { id: "10", name: "示例科技" }, title: "示例平台工程师", category: "研发",
  recruitment_channel: "campus", employment_type: "internship", salary_text: null,
  locations: { schema_version: 1, cities: ["上海", "北京"], raw: ["上海市", "北京市"] },
  availability_status: "active", published_at: null, first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-02T00:00:00Z",
  source_url: "https://careers.example.test/jobs/1001", joined_application_id: null,
  source: { name: "示例科技", is_enabled: true, sync_status: "succeeded", last_complete_at: "2026-01-02T00:00:00Z" },
  description: "工作职责\n参与虚构平台开发。\n任职要求\n要求掌握 Python。",
};
const second: PoolJob = { ...job, id: "1002", title: "示例产品工程师", salary_text: "15–25K · 14 薪", description: "负责虚构产品规划。" };

const detail = () => within(screen.getByRole("region", { name: "岗位详情" }));
const list = () => within(screen.getByRole("navigation", { name: "岗位列表" }));

beforeEach(() => {
  window.history.replaceState(null, "", "/career/opportunities");
  vi.spyOn(api, "poolFilters").mockResolvedValue({ companies: [{ id: "10", name: "示例科技" }], cities: ["上海", "北京"], categories: ["研发"], recruitment_types: ["campus", "internship", "experienced"] });
  vi.spyOn(api, "listPoolJobs").mockResolvedValue({ items: [job, second], next_cursor: null });
  vi.spyOn(api, "getPoolJob").mockImplementation(async (id) => (id === second.id ? second : job));
  vi.spyOn(api, "joinPoolJob").mockResolvedValue({ job_id: "2001", application_id: "3001", created: true });
});

describe("official opportunities", () => {
  it("keeps original personal paths and parses the pool routes", () => {
    expect(parseAppRoute("/career/opportunities")).toEqual({ kind: "opportunities" });
    expect(parseAppRoute("/career/opportunities/1001")).toEqual({ kind: "opportunities", jobId: "1001" });
    expect(parseAppRoute("/career/jobs/2001")).toEqual({ kind: "jobDetail", jobId: "2001" });
  });

  it("shows the first job beside the list and switches the detail from the list", async () => {
    const view = render(<OpportunitiesPage />);
    expect(await detail().findByRole("heading", { name: job.title })).toBeInTheDocument();
    expect(detail().getByText("参与虚构平台开发。")).toBeInTheDocument();
    expect(detail().getByRole("heading", { name: "任职要求" })).toBeInTheDocument();
    expect(list().getByRole("link", { name: /示例平台工程师/ })).toHaveAttribute("aria-current", "true");
    expect(list().getByText("没有更多了")).toBeInTheDocument();
    fireEvent.click(list().getByRole("link", { name: /示例产品工程师/ }));
    expect(window.location.pathname).toBe("/career/opportunities/1002");
    view.rerender(<OpportunitiesPage jobId="1002" />);
    expect(await detail().findByRole("heading", { name: second.title })).toBeInTheDocument();
    expect(detail().getByText("15–25K · 14 薪")).toBeInTheDocument();
    expect(api.listPoolJobs).toHaveBeenCalledTimes(1);
  });

  it("applies multiple companies at once and restores the selection from the URL", async () => {
    vi.mocked(api.poolFilters).mockResolvedValue({ companies: [
      { id: "10", name: "示例科技", aliases: ["Example Tech"], logo_url: "https://cdn.example.test/a.png" },
      { id: "11", name: "示例制造", logo_url: "https://cdn.example.test/b.png" },
    ], cities: [], categories: [], recruitment_types: [] });
    const view = render(<OpportunitiesPage />);
    await detail().findByRole("heading", { name: job.title });
    fireEvent.click(screen.getByRole("button", { name: "筛选企业" }));
    fireEvent.change(screen.getByLabelText("搜索企业"), { target: { value: "example" } });
    expect(screen.queryByRole("checkbox", { name: "示例制造" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "示例科技" }));
    await waitFor(() => expect(api.listPoolJobs).toHaveBeenLastCalledWith({ company_ids: ["10"] }));
    fireEvent.change(screen.getByLabelText("搜索企业"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "示例制造" }));
    await waitFor(() => expect(api.listPoolJobs).toHaveBeenLastCalledWith({ company_ids: ["10", "11"] }));
    expect(new URLSearchParams(window.location.search).getAll("company_ids")).toEqual(["10", "11"]);
    view.unmount();
    render(<OpportunitiesPage />);
    await detail().findByRole("heading", { name: job.title });
    expect(screen.getByRole("button", { name: "筛选企业" })).toHaveTextContent("示例科技 等 2 家");
    fireEvent.click(screen.getByRole("button", { name: "筛选企业" }));
    expect(screen.getByRole("checkbox", { name: "示例制造" })).toBeChecked();
  });

  it("validates keywords, filters by recruitment tab and saves the query in the URL", async () => {
    render(<OpportunitiesPage />);
    await detail().findByRole("heading", { name: job.title });
    fireEvent.change(screen.getByLabelText("搜索岗位名称、职责或技能"), { target: { value: "研" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("关键词需要包含 2～100 个字符。")).toBeInTheDocument();
    expect(api.listPoolJobs).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("搜索岗位名称、职责或技能"), { target: { value: "Python" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(api.listPoolJobs).toHaveBeenLastCalledWith({ keyword: "Python" }));
    fireEvent.click(screen.getByRole("tab", { name: "校招" }));
    await waitFor(() => expect(api.listPoolJobs).toHaveBeenLastCalledWith({ keyword: "Python", recruitment_type: "campus" }));
    expect(screen.getByRole("tab", { name: "校招" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("?keyword=Python&recruitment_type=campus");
  });

  it("explains an empty filtered result with clear and keyword-only actions", async () => {
    window.history.replaceState(null, "", "/career/opportunities?keyword=FPGA&recruitment_type=campus");
    vi.mocked(api.listPoolJobs).mockResolvedValue({ items: [], next_cursor: null });
    render(<OpportunitiesPage />);
    expect(await screen.findByRole("heading", { name: "没有符合条件的岗位" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "只用关键词搜索" }));
    await waitFor(() => expect(api.listPoolJobs).toHaveBeenLastCalledWith({ keyword: "FPGA" }));
    fireEvent.click(screen.getAllByRole("button", { name: "清除筛选" }).at(-1)!);
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("loads the next cursor and retries a failed page from the list footer", async () => {
    vi.mocked(api.listPoolJobs).mockResolvedValueOnce({ items: [job], next_cursor: "fictional-cursor" })
      .mockRejectedValueOnce(new Error("NETWORK_ERROR"))
      .mockResolvedValueOnce({ items: [second], next_cursor: null });
    render(<OpportunitiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    expect(await list().findByRole("link", { name: /示例产品工程师/ })).toBeInTheDocument();
    expect(api.listPoolJobs).toHaveBeenLastCalledWith({ cursor: "fictional-cursor" });
    expect(list().getByText("没有更多了")).toBeInTheDocument();
  });

  it("joins in place with a toast and then links to the application", async () => {
    render(<OpportunitiesPage />);
    fireEvent.click(await detail().findByRole("button", { name: "加入求职进程" }));
    expect(await screen.findByText("已加入求职进程", { selector: "strong" })).toBeInTheDocument();
    expect(detail().getByText(/已加入求职进程 ·/)).toBeInTheDocument();
    expect(list().getByText("已加入")).toBeInTheDocument();
    fireEvent.click(detail().getByRole("button", { name: "查看求职进程" }));
    expect(api.joinPoolJob).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/career/applications/3001");
  });

  it("shows the official link and missing status without rendering unsafe markup", async () => {
    vi.mocked(api.getPoolJob).mockResolvedValue({ ...job, availability_status: "missing", description: "<script>fictional()</script>\n完整正文" });
    render(<OpportunitiesPage jobId="1001" />);
    expect(await detail().findByRole("heading", { name: job.title })).toBeInTheDocument();
    expect(detail().getByText(/本轮同步未发现该岗位/)).toBeInTheDocument();
    expect(detail().getByRole("link", { name: "查看招聘官网" })).toHaveAttribute("href", job.source_url);
    expect(document.querySelector("script")).toBeNull();
  });

  it("blocks new joins to closed jobs while keeping existing applications accessible", async () => {
    vi.mocked(api.listPoolJobs).mockResolvedValue({ items: [{ ...job, availability_status: "closed" }], next_cursor: null });
    vi.mocked(api.getPoolJob).mockResolvedValue({ ...job, availability_status: "closed" });
    const view = render(<OpportunitiesPage jobId="1001" />);
    expect(await detail().findByRole("button", { name: "岗位已下线" })).toBeDisabled();
    expect(detail().getByText(/该岗位已从官网下线/)).toBeInTheDocument();
    view.unmount();
    vi.mocked(api.listPoolJobs).mockResolvedValue({ items: [{ ...job, availability_status: "closed", joined_application_id: "3001" }], next_cursor: null });
    vi.mocked(api.getPoolJob).mockResolvedValue({ ...job, availability_status: "closed", joined_application_id: "3001" });
    render(<OpportunitiesPage jobId="1001" />);
    expect(await detail().findByRole("button", { name: "查看求职进程" })).toBeEnabled();
    expect(api.joinPoolJob).not.toHaveBeenCalled();
  });

  it("explains a job that went offline while joining", async () => {
    vi.mocked(api.joinPoolJob).mockRejectedValue(new ApiRequestError(409, "JOB_POOL_CLOSED"));
    render(<OpportunitiesPage jobId="1001" />);
    fireEvent.click(await detail().findByRole("button", { name: "加入求职进程" }));
    const dialog = await screen.findByRole("dialog", { name: "岗位已下线" });
    fireEvent.click(within(dialog).getByRole("button", { name: "知道了" }));
    expect(detail().getByRole("button", { name: "岗位已下线" })).toBeDisabled();
    expect(list().getByText("已下线")).toBeInTheDocument();
  });

  it("allows retry after a failed join without claiming that a record was saved", async () => {
    vi.mocked(api.joinPoolJob).mockRejectedValueOnce(new Error("NETWORK_ERROR"));
    render(<OpportunitiesPage />);
    fireEvent.click(await detail().findByRole("button", { name: "加入求职进程" }));
    const dialog = await screen.findByRole("dialog", { name: "加入失败" });
    expect(detail().queryByRole("button", { name: "查看求职进程" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "重新加入" }));
    expect(await detail().findByRole("button", { name: "查看求职进程" })).toBeInTheDocument();
    expect(api.joinPoolJob).toHaveBeenCalledTimes(2);
  });

  it("shows the existing record when another tab has already joined the job", async () => {
    vi.mocked(api.joinPoolJob).mockResolvedValue({ job_id: "2001", application_id: "3001", created: false });
    render(<OpportunitiesPage />);
    fireEvent.click(await detail().findByRole("button", { name: "加入求职进程" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看已有记录" }));
    expect(window.location.pathname).toBe("/career/applications/3001");
  });

  it("keeps the list when a linked job no longer exists or its detail fails", async () => {
    vi.mocked(api.getPoolJob).mockRejectedValueOnce(new ApiRequestError(404, "JOB_POOL_NOT_FOUND"));
    const view = render(<OpportunitiesPage jobId="9999" />);
    expect(await detail().findByRole("heading", { name: "没有找到这个岗位" })).toBeInTheDocument();
    expect(list().getByRole("link", { name: /示例平台工程师/ })).not.toHaveAttribute("aria-current");
    view.unmount();
    vi.mocked(api.getPoolJob).mockRejectedValueOnce(new Error("NETWORK_ERROR")).mockResolvedValueOnce(job);
    render(<OpportunitiesPage jobId="1001" />);
    expect(await detail().findByRole("heading", { name: "岗位详情暂时无法加载" })).toBeInTheDocument();
    fireEvent.click(detail().getByRole("button", { name: "重新加载" }));
    expect(await detail().findByRole("heading", { name: job.title })).toBeInTheDocument();
  });

  it("shows a retryable error when the list cannot load", async () => {
    vi.mocked(api.listPoolJobs).mockRejectedValueOnce(new Error("NETWORK_ERROR"));
    render(<OpportunitiesPage />);
    expect(await screen.findByRole("heading", { name: "岗位暂时无法加载" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await detail().findByRole("heading", { name: job.title })).toBeInTheDocument();
  });

  it("displays company artwork and falls back to the first character after an image error", async () => {
    vi.mocked(api.listPoolJobs).mockResolvedValue({ items: [{ ...job, company: { ...job.company, logo_url: "/api/company-logos/" + "a".repeat(64) + ".webp" } }], next_cursor: null });
    render(<OpportunitiesPage />);
    const logo = await list().findByRole("img", { name: "示例科技 Logo" });
    expect(logo).toHaveAttribute("referrerpolicy", "no-referrer");
    fireEvent.error(logo);
    expect(list().queryByRole("img", { name: "示例科技 Logo" })).not.toBeInTheDocument();
    expect(list().getByText("示")).toBeInTheDocument();
  });
});
