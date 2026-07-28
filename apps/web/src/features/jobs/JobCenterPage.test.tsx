import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type JobDescriptionRecord, type JobDescriptionSummary } from "../../api/client";
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
    useResumeStore.setState({ user: { id: "user-1", email: "user@example.test" } });
    const list = vi.spyOn(api, "listJobDescriptions").mockResolvedValue({ items: [job], next_cursor: null });
    const archived = { ...job, archived_at: "2026-07-29T09:00:00Z", lock_version: 3 } as JobDescriptionRecord;
    const archive = vi.spyOn(api, "archiveJobDescription").mockResolvedValue({ job_description: archived });

    render(<JobCenterPage />);

    expect(await screen.findByText("Java 开发实习生")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ scope: "active", keyword: undefined });
    fireEvent.click(screen.getByRole("button", { name: "归档 Java 开发实习生" }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith("job-1", 2));
    expect(screen.queryByText("Java 开发实习生")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索 JD" }), { target: { value: "Java 后端" } });
    fireEvent.click(screen.getByRole("button", { name: "已归档" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ scope: "archived", keyword: "Java 后端" }));
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
});
