import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type JobDescriptionSummary } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { JobCenterPage } from "./JobCenterPage";

const job: JobDescriptionSummary = {
  id: "job-1",
  job_title: "Java 开发实习生",
  company_name: "示例科技",
  work_city: "南京",
  salary_text: "150-170 元/天",
  skills: ["Java", "MySQL"],
  source_type: "manual",
  source_site: "boss",
  source_url: "https://www.zhipin.com/job_detail/abc123.html",
  lock_version: 2,
  updated_at: "2026-07-29T08:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("JobCenterPage", () => {
  it("首次读取时在页头下方展示统一加载状态", () => {
    vi.spyOn(api, "listJobDescriptions").mockReturnValue(new Promise(() => undefined));

    const { container } = render(<JobCenterPage />);

    expect(screen.getByRole("status", { name: "正在加载 JD…" })).toBeInTheDocument();
    expect(container.querySelector(".job-center-content > .page-loading")).toBeInTheDocument();
    expect(container.querySelector(".job-center-body")).not.toBeInTheDocument();
  });

  it("读取全部 JD，不展示状态语义并保留搜索与基础操作", async () => {
    useResumeStore.setState({ user: { id: "user-1", email: "user@example.test", nickname: "测试用户", is_admin: false } });
    const list = vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [job], next_cursor: null });

    const { container } = render(<JobCenterPage />);

    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ keyword: undefined });
    expect(screen.queryByText("全部岗位资料")).not.toBeInTheDocument();
    expect(screen.queryByText("按最近更新")).not.toBeInTheDocument();
    expect(screen.queryByText("活动")).not.toBeInTheDocument();
    expect(screen.queryByText("已归档")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建 JD" })).toHaveClass("ui-button-transparent");
    expect(container.querySelector(".job-center-content > .page-hero")).toBeInTheDocument();
    expect(container.querySelector(".job-center-content > .job-center-body")).toBeInTheDocument();
    const heroActions = container.querySelector(".page-hero-actions");
    expect(heroActions?.children[0]).toBe(screen.getByRole("button", { name: "搜索职位" }));
    expect(heroActions?.children[1]).toBe(screen.getByRole("button", { name: "安装采集插件" }));
    expect(screen.getByRole("button", { name: "删除 Java 开发实习生" })).toBeInTheDocument();
    expect(container.querySelector(".job-card-heading")).toHaveTextContent("Java 开发实习生·示例科技");
    expect(container.querySelector(".job-card-meta .lucide-map-pin")).toBeInTheDocument();
    expect(container.querySelector(".job-card-meta .lucide-wallet-cards")).toBeInTheDocument();
    expect(container.querySelector(".job-card-skills")).toHaveTextContent("Java、MySQL");
    expect(container.querySelector(".job-skill-row")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "搜索职位" }));
    const searchInput = screen.getByRole("searchbox", { name: "搜索职位" });
    expect(searchInput).toHaveAttribute("name", "job-search");
    fireEvent.change(searchInput, { target: { value: "Java 后端" } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ keyword: "Java 后端" }));
  });

  it("永久删除前显示站内确认，取消时不调用接口", async () => {
    vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [job], next_cursor: null });
    const remove = vi.spyOn(api, "deleteJobDescription");

    render(<JobCenterPage />);
    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除 Java 开发实习生" }));

    expect(screen.getByRole("alertdialog", { name: "永久删除「Java 开发实习生」？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it("删除失败时保留记录并提供可重试提示", async () => {
    vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [job], next_cursor: null });
    const remove = vi.spyOn(api, "deleteJobDescription").mockRejectedValue(new Error("offline"));

    render(<JobCenterPage />);
    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除 Java 开发实习生" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(job.id));
    expect(screen.getByRole("alert")).toHaveTextContent("删除失败，请稍后重试");
    expect(screen.getByText("Java 开发实习生")).toBeInTheDocument();
  });

  it("从 JD 页头打开插件安装入口", async () => {
    vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [], next_cursor: null });
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "unpublished", release: null });

    render(<JobCenterPage />);
    fireEvent.click(screen.getByRole("button", { name: "安装采集插件" }));

    expect(await screen.findByRole("dialog", { name: "安装 LinkResume 岗位采集插件" })).toBeInTheDocument();
    expect(screen.getByText("暂未提供插件安装包。")).toBeInTheDocument();
  });

  it("在新建路由中先选择创建方式，填写后打开现有表单", async () => {
    vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [], next_cursor: null });

    const { container } = render(<JobCenterPage createDialogOpen />);

    await waitFor(() => expect(container.querySelector(".page-hero h1")).toHaveTextContent("JD 中心"));
    expect(screen.getByRole("dialog", { name: "新建 JD" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /填写/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /智能导入/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("职位名称")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /填写/ }));
    expect(screen.getByLabelText("职位名称")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(window.location.pathname).toBe("/jobs");
  });

  it("智能导入只预填表单，用户提交前不创建 JD", async () => {
    vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [], next_cursor: null });
    const parse = vi.spyOn(api, "parseJobDescriptionDraft").mockResolvedValue({
      draft: {
        job_title: "平台工程师",
        company_name: "示例科技",
        description: "负责内部平台建设",
        skills: ["Kubernetes", "Go"],
      },
      warnings: [],
      inputType: "text",
      callId: "llmcall_fixture",
    });
    const create = vi.spyOn(api, "createJobDescription");

    render(<JobCenterPage createDialogOpen />);
    fireEvent.click(screen.getByRole("button", { name: /智能导入/ }));
    fireEvent.change(screen.getByLabelText("岗位文字"), {
      target: { value: "示例科技招聘平台工程师，负责内部平台建设" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始识别" }));

    await waitFor(() => expect(parse).toHaveBeenCalledWith(expect.objectContaining({
      text: "示例科技招聘平台工程师，负责内部平台建设",
      signal: expect.any(AbortSignal),
    })));
    expect(await screen.findByDisplayValue("平台工程师")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kubernetes, Go")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});
