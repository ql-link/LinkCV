import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type JobDescriptionRecord } from "../../api/client";
import { JobDetailPage } from "./JobDetailPage";

const activeJob: JobDescriptionRecord = {
  id: "job-1",
  job_title: "Java 开发实习生",
  company_name: "示例科技",
  employment_type: "internship",
  description: "参与后端业务开发。",
  skills: ["Java", "MySQL"],
  education_requirement: "本科",
  experience_requirement: null,
  work_schedule: null,
  work_city: "南京",
  work_address: null,
  work_mode: "onsite",
  salary_text: "150-170 元/天",
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  salary_months_per_year: null,
  company_legal_name: null,
  company_industry: null,
  company_size: null,
  company_financing_stage: null,
  company_description: null,
  recruiter_name: null,
  recruiter_title: null,
  source_type: "manual",
  source_site: null,
  source_job_id: null,
  source_url: null,
  source_url_hash: null,
  imported_at: null,
  notes: null,
  lock_version: 2,
  created_at: "2026-07-29T08:00:00Z",
  updated_at: "2026-07-29T08:00:00Z",
};

beforeEach(() => {
  vi.spyOn(api, "listJobApplications").mockResolvedValue({ items: [], next_cursor: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("JobDetailPage", () => {
  it("岗位详情提供求职入口和编辑入口", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });

    render(<JobDetailPage jobId={activeJob.id} />);

    expect(await screen.findByRole("heading", { name: "岗位详情", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: activeJob.job_title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: activeJob.company_name, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回岗位库" })).toHaveAttribute("href", "/career/jobs");
    expect(await screen.findByRole("button", { name: "开始求职" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("点击‘编辑’按钮切换到表单视图", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    
    render(<JobDetailPage jobId={activeJob.id} />);

    // Click edit button
    const editBtn = await screen.findByRole("button", { name: "编辑" });
    fireEvent.click(editBtn);

    // Wait for the form to appear (JobFormPage in edit mode)
    expect(await screen.findByRole("button", { name: "保存岗位" })).toBeInTheDocument();
    expect(screen.getByLabelText("职位名称")).toHaveValue(activeJob.job_title);
    
    // We expect the original details to be hidden when editing
    expect(screen.queryByRole("heading", { name: "岗位详情", level: 1 })).not.toBeInTheDocument();
  });

  it("删除前要求确认，失败时关闭弹窗并保留详情", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const remove = vi.spyOn(api, "deleteJobDescription").mockRejectedValue(new Error("offline"));

    render(<JobDetailPage jobId={activeJob.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(activeJob.id));
    expect(screen.getByRole("alert")).toHaveTextContent("岗位服务暂时不可用");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
