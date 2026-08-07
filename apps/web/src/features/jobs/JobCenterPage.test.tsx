import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type JobDescriptionRecord, type JobDescriptionSummary } from "../../api/client";
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
  archived_at: null,
  lock_version: 2,
  updated_at: "2026-07-29T08:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("JobCenterPage", () => {
  it("按范围和关键词读取列表，并使用当前版本归档", async () => {
    useResumeStore.setState({ user: { id: "user-1", email: "user@example.test", nickname: "测试用户", is_admin: false } });
    const list = vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [job], next_cursor: null });
    const archived = { ...job, archived_at: "2026-07-29T09:00:00Z", lock_version: 3 } as JobDescriptionRecord;
    const archive = vi.spyOn(api, "archiveJobDescription").mockResolvedValue({ job_description: archived });

    render(<JobCenterPage />);

    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ scope: "active", keyword: undefined });
    expect(screen.queryByRole("button", { name: "删除 Java 开发实习生" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "归档 Java 开发实习生" }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith("job-1", 2));
    expect(screen.queryByText("Java 开发实习生")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索 JD" }), { target: { value: "Java 后端" } });
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ scope: "archived", keyword: "Java 后端" }));
  });

  it("永久删除前显示站内确认，取消时不调用接口", async () => {
    const archived = { ...job, archived_at: "2026-07-29T09:00:00Z", lock_version: 3 };
    vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [archived], next_cursor: null });
    const remove = vi.spyOn(api, "deleteJobDescription");

    render(<JobCenterPage />);
    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除 Java 开发实习生" }));

    expect(screen.getByRole("alertdialog", { name: "永久删除「Java 开发实习生」？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it("归档岗位在删除前被恢复时保留记录并提示刷新", async () => {
    const archived = { ...job, archived_at: "2026-07-29T09:00:00Z", lock_version: 3 };
    vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [archived], next_cursor: null });
    const remove = vi.spyOn(api, "deleteJobDescription").mockRejectedValue(
      new ApiRequestError(409, "JD_DELETE_REQUIRES_ARCHIVE"),
    );

    render(<JobCenterPage />);
    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除 Java 开发实习生" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(archived.id));
    expect(screen.getByRole("alert")).toHaveTextContent("岗位已经恢复为活动状态");
    expect(screen.getByText("Java 开发实习生")).toBeInTheDocument();
  });

  it("从 JD 页头打开插件安装入口", async () => {
    vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [], next_cursor: null });
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "unpublished", release: null });

    render(<JobCenterPage />);
    fireEvent.click(screen.getByRole("button", { name: "安装岗位采集插件" }));

    expect(await screen.findByRole("dialog", { name: "安装岗位采集插件" })).toBeInTheDocument();
    expect(screen.getByText("暂未提供插件安装包。")).toBeInTheDocument();
  });
});
