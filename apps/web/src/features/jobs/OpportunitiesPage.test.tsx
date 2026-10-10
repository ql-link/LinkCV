import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  description: "参与虚构平台开发。\n要求掌握 Python。",
};

beforeEach(() => {
  window.history.replaceState(null, "", "/career/opportunities");
  vi.spyOn(api, "poolFilters").mockResolvedValue({ companies: [{ id: "10", name: "示例科技" }], cities: ["上海", "北京"], categories: ["研发"], recruitment_types: ["campus", "internship", "experienced"] });
  vi.spyOn(api, "listPoolJobs").mockResolvedValue({ items: [job], next_cursor: null });
  vi.spyOn(api, "getPoolJob").mockResolvedValue(job);
  vi.spyOn(api, "joinPoolJob").mockResolvedValue({ job_id: "2001", application_id: "3001", created: true });
});

describe("official opportunities", () => {
  it("applies multiple companies with Logos and restores the selection from the URL", async () => {
    vi.mocked(api.poolFilters).mockResolvedValue({ companies: [
      { id: "10", name: "示例科技", aliases: ["Example Tech"], logo_url: "https://cdn.example.test/a.png" },
      { id: "11", name: "示例制造", logo_url: "https://cdn.example.test/b.png" },
    ], cities: [], categories: [], recruitment_types: [] });
    const view = render(<OpportunitiesPage />);
    await screen.findByRole("link", { name: job.title });
    fireEvent.click(screen.getByRole("button", { name: "全部企业" }));
    fireEvent.change(screen.getByLabelText("搜索企业"), { target: { value: "example" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "示例科技" }));
    fireEvent.change(screen.getByLabelText("搜索企业"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "示例制造" }));
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() => expect(api.listPoolJobs).toHaveBeenLastCalledWith({ company_ids: ["10", "11"] }));
    expect(new URLSearchParams(window.location.search).getAll("company_ids")).toEqual(["10", "11"]);
    view.unmount();
    render(<OpportunitiesPage />);
    await screen.findByRole("link", { name: job.title });
    fireEvent.click(screen.getByRole("button", { name: "全部企业" }));
    expect(screen.getByRole("checkbox", { name: "示例科技" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "示例制造" })).toBeChecked();
  });

  it("keeps original personal paths and parses the new pool routes", () => {
    expect(parseAppRoute("/career/opportunities")).toEqual({ kind: "opportunities" });
    expect(parseAppRoute("/career/opportunities/1001")).toEqual({ kind: "opportunities", jobId: "1001" });
    expect(parseAppRoute("/career/jobs/2001")).toEqual({ kind: "jobDetail", jobId: "2001" });
  });

  it("validates keywords, saves the query in the URL and searches full body", async () => {
    render(<OpportunitiesPage />);
    await screen.findByRole("link", { name: job.title });
    fireEvent.change(screen.getByLabelText("搜索岗位标题或正文"), { target: { value: "研" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("关键词需要包含 2～100 个字符。")).toBeInTheDocument();
    expect(api.listPoolJobs).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("搜索岗位标题或正文"), { target: { value: "Python" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(api.listPoolJobs).toHaveBeenLastCalledWith({ keyword: "Python" }));
    expect(window.location.search).toBe("?keyword=Python");
  });

  it("loads the next cursor and exposes repeat join as the same application", async () => {
    vi.mocked(api.listPoolJobs).mockResolvedValueOnce({ items: [job], next_cursor: "fictional-cursor" }).mockResolvedValueOnce({ items: [{ ...job, id: "1002", title: "示例产品工程师" }], next_cursor: null });
    render(<OpportunitiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    await screen.findByRole("link", { name: "示例产品工程师" });
    expect(api.listPoolJobs).toHaveBeenLastCalledWith({ cursor: "fictional-cursor" });
    fireEvent.click(screen.getAllByRole("button", { name: "加入求职进程" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "查看求职进程" }));
    expect(api.joinPoolJob).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/career/applications/3001");
  });

  it("shows full safe text, original link, missing status and personal snapshot rule", async () => {
    vi.mocked(api.getPoolJob).mockResolvedValue({ ...job, availability_status: "missing", description: "<script>fictional()</script>\n完整正文" });
    render(<OpportunitiesPage jobId="1001" />);
    expect(await screen.findByRole("heading", { name: job.title })).toBeInTheDocument();
    expect(screen.getByText(/本轮同步未发现该岗位/)).toBeInTheDocument();
    expect(screen.getByText(/后续官网更新不会覆盖/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看招聘官网 ↗" })).toHaveAttribute("href", job.source_url);
    expect(document.querySelector("script")).toBeNull();
  });

  it("blocks new joins to closed jobs while keeping existing applications accessible", async () => {
    vi.mocked(api.getPoolJob).mockResolvedValue({ ...job, availability_status: "closed" });
    const view = render(<OpportunitiesPage jobId="1001" />);
    expect(await screen.findByRole("button", { name: "岗位已下线" })).toBeDisabled();
    view.unmount();
    vi.mocked(api.getPoolJob).mockResolvedValue({ ...job, availability_status: "closed", joined_application_id: "3001" });
    render(<OpportunitiesPage jobId="1001" />);
    expect(await screen.findByRole("button", { name: "查看求职进程" })).toBeEnabled();
    expect(api.joinPoolJob).not.toHaveBeenCalled();
  });

  it("shows join conflicts without claiming success", async () => {
    vi.mocked(api.joinPoolJob).mockRejectedValue(new ApiRequestError(409, "JOB_POOL_CLOSED"));
    render(<OpportunitiesPage jobId="1001" />);
    fireEvent.click(await screen.findByRole("button", { name: "加入求职进程" }));
    expect(await screen.findByText("该岗位已下线，无法新加入求职进程。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看求职进程" })).not.toBeInTheDocument();
  });

  it("displays official company artwork and falls back after an image error", async () => {
    vi.mocked(api.listPoolJobs).mockResolvedValue({ items: [{ ...job, company: { ...job.company, logo_url: "https://cdn.example.test/fictional-logo.png" } }], next_cursor: null });
    render(<OpportunitiesPage />);
    const logo = await screen.findByRole("img", { name: "示例科技 Logo" });
    expect(logo).toHaveAttribute("src", "https://cdn.example.test/fictional-logo.png");
    expect(logo).toHaveAttribute("referrerpolicy", "no-referrer");
    fireEvent.error(logo);
    expect(screen.queryByRole("img", { name: "示例科技 Logo" })).not.toBeInTheDocument();
    expect(screen.getByText("示")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: job.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看示例科技图标加载提示" }));
    expect(screen.getByRole("dialog", { name: "图标加载失败" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("img", { name: "示例科技 Logo" })).toHaveAttribute("src", "https://cdn.example.test/fictional-logo.png");
  });

  it("cancels draft company filters and applies only the confirmed selection", async () => {
    vi.mocked(api.poolFilters).mockResolvedValue({ companies: [{ id: "10", name: "示例科技" }, { id: "11", name: "示例制造" }], cities: [], categories: [], recruitment_types: [] });
    render(<OpportunitiesPage />);
    await screen.findByRole("link", { name: job.title });
    fireEvent.click(screen.getByRole("button", { name: "全部企业" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "示例科技" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.location.search).toBe("");
    expect(api.listPoolJobs).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "全部企业" }));
    expect(screen.getByRole("checkbox", { name: "示例科技" })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("搜索企业"), { target: { value: "制造" } });
    expect(screen.queryByRole("checkbox", { name: "示例科技" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "示例制造" }));
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() => expect(api.listPoolJobs).toHaveBeenLastCalledWith({ company_ids: ["11"] }));
    expect(window.location.search).toBe("?company_ids=11");
  });

  it("shows the existing record when another tab has already joined the job", async () => {
    vi.mocked(api.joinPoolJob).mockResolvedValue({ job_id: "2001", application_id: "3001", created: false });
    render(<OpportunitiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "加入求职进程" }));
    expect(await screen.findByRole("dialog", { name: "这个岗位已经加入" })).toBeInTheDocument();
    expect(screen.queryByText("添加成功")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看已有记录" }));
    expect(window.location.pathname).toBe("/career/applications/3001");
    expect(api.joinPoolJob).toHaveBeenCalledTimes(1);
  });

  it("allows retry after a failed join without claiming that a record was saved", async () => {
    vi.mocked(api.joinPoolJob).mockRejectedValueOnce(new Error("NETWORK_ERROR"));
    render(<OpportunitiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "加入求职进程" }));
    expect(await screen.findByRole("dialog", { name: "加入失败" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看求职进程" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加入" }));
    expect(await screen.findByRole("dialog", { name: "已加入求职进程" })).toBeInTheDocument();
    expect(api.joinPoolJob).toHaveBeenCalledTimes(2);
  });

  it("opens the missing-job notice without discarding the official detail link", async () => {
    vi.mocked(api.getPoolJob).mockResolvedValue({ ...job, availability_status: "missing" });
    render(<OpportunitiesPage jobId="1001" />);
    fireEvent.click(await screen.findByRole("button", { name: "查看岗位招聘状态" }));
    expect(screen.getByRole("dialog", { name: "暂未发现岗位" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看招聘官网" })).toHaveAttribute("href", job.source_url);
    expect(api.joinPoolJob).not.toHaveBeenCalled();
  });
});
