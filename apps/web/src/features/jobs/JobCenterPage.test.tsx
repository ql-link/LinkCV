import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function stubIntersectionObserver() {
  const observer: { callback?: IntersectionObserverCallback } = {};
  class IntersectionObserverMock {
    constructor(callback: IntersectionObserverCallback) { observer.callback = callback; }
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "280px 0px";
    thresholds = [0];
  }
  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  return observer;
}

beforeEach(() => {
  vi.spyOn(api, "listJobApplications").mockResolvedValue({ items: [], next_cursor: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("JobCenterPage", () => {
  it("首次读取时在页头下方展示统一加载状态", () => {
    vi.spyOn(api, "listJobDescriptions").mockReturnValue(new Promise(() => undefined));

    const { container } = render(<JobCenterPage navigation={<nav aria-label="测试求职中心导航">岗位库 求职进程</nav>} />);

    expect(screen.getByRole("status", { name: "正在加载岗位…" })).toBeInTheDocument();
    expect(container.querySelector(".job-center-content > .page-loading")).toBeInTheDocument();
    expect(container.querySelector(".job-center-body")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "求职中心" })).toBeInTheDocument();
    const header = container.querySelector(".page-hero.is-module");
    const navigation = screen.getByRole("navigation", { name: "测试求职中心导航" });
    const content = container.querySelector(".job-center-content");
    expect(header).toBeInTheDocument();
    expect(header).toHaveClass("career-module-header", "job-center-header");
    expect(content).toBeInTheDocument();
    if (!header || !content) throw new Error("岗位库页面结构不完整");
    expect(header.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(navigation.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("读取全部岗位并展示求职入口、搜索与基础操作", async () => {
    useResumeStore.setState({ user: { id: "user-1", email: "user@example.test", nickname: "测试用户", is_admin: false } });
    const list = vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [job], next_cursor: null });

    const { container } = render(<JobCenterPage />);

    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ keyword: undefined });
    expect(screen.queryByText("全部岗位资料")).not.toBeInTheDocument();
    expect(screen.queryByText("按最近更新")).not.toBeInTheDocument();
    expect(screen.getByText("仅收藏")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始求职" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建岗位" })).not.toHaveClass("ui-button-transparent");
    expect(container.querySelector(".page-hero.is-module")).toBeInTheDocument();
    expect(container.querySelector(".job-center-content > .job-center-body")).toBeInTheDocument();
    const heroActions = container.querySelector(".page-hero-actions");
    expect(heroActions?.children[0]).toBe(screen.getByRole("button", { name: "搜索职位" }));
    expect(heroActions?.children[1]).toBe(screen.getByRole("button", { name: "安装采集插件" }));
    expect(screen.getByRole("button", { name: "删除 Java 开发实习生" })).toBeInTheDocument();
    expect(container.querySelector(".job-card-heading")).toHaveTextContent("Java 开发实习生·示例科技");
    expect(screen.getByRole("link", { name: /Java 开发实习生/ })).toHaveAttribute("href", "/career/jobs/job-1");
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

  it("滚动接近列表底部时自动读取下一页直到没有更多数据", async () => {
    const intersection = stubIntersectionObserver();
    const secondJob = { ...job, id: "job-2", job_title: "前端工程师" };
    const list = vi.spyOn(api, "listJobDescriptions")
      .mockResolvedValueOnce({ items: [job], next_cursor: "cursor-2" })
      .mockResolvedValueOnce({ items: [secondJob], next_cursor: null });

    render(<JobCenterPage />);

    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    await waitFor(() => expect(intersection.callback).toBeDefined());
    await act(async () => {
      intersection.callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      intersection.callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(await screen.findByText("前端工程师")).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith({ keyword: undefined, cursor: "cursor-2" });
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });

  it("自动加载失败后暂停请求，用户重试成功后继续追加", async () => {
    const intersection = stubIntersectionObserver();
    const secondJob = { ...job, id: "job-2", job_title: "前端工程师" };
    const list = vi.spyOn(api, "listJobDescriptions")
      .mockResolvedValueOnce({ items: [job], next_cursor: "cursor-2" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [secondJob], next_cursor: null });

    render(<JobCenterPage />);

    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    await waitFor(() => expect(intersection.callback).toBeDefined());
    await act(async () => {
      intersection.callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(await screen.findByText("后续岗位加载失败。")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("前端工程师")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(3);
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

  it("从岗位库页头打开插件安装入口", async () => {
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

    await waitFor(() => expect(container.querySelector(".page-hero h1")).toHaveTextContent("求职中心"));
    expect(screen.getByRole("dialog", { name: "新建岗位" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /填写/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /智能导入/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("职位名称")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /填写/ }));
    expect(screen.getByRole("dialog", { name: "手动填写岗位信息" })).toBeInTheDocument();
    expect(screen.getByLabelText("职位名称")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.location.pathname).toBe("/career/jobs");
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
    expect(screen.getByRole("dialog", { name: "智能填写岗位信息" })).toBeInTheDocument();
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
