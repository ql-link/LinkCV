import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type JobDescriptionRecord } from "../../api/client";
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
  archived_at: null,
  lock_version: 2,
  created_at: "2026-07-29T08:00:00Z",
  updated_at: "2026-07-29T08:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("JobDetailPage", () => {
  it("活动岗位不展示删除入口", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });

    render(<JobDetailPage jobId={activeJob.id} />);

    expect(await screen.findByRole("heading", { name: activeJob.job_title })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("归档岗位允许发起删除，并反馈并发恢复冲突", async () => {
    const archivedJob = { ...activeJob, archived_at: "2026-07-29T09:00:00Z", lock_version: 3 };
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: archivedJob });
    const remove = vi.spyOn(api, "deleteJobDescription").mockRejectedValue(
      new ApiRequestError(409, "JD_DELETE_REQUIRES_ARCHIVE"),
    );

    render(<JobDetailPage jobId={archivedJob.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(archivedJob.id));
    expect(screen.getByRole("alert")).toHaveTextContent("岗位已经恢复为活动状态");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
