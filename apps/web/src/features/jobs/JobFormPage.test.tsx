import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiRequestError,
  type JobDescriptionRecord,
  type JobDescriptionSummary,
} from "../../api/client";
import { JobFormPage } from "./JobFormPage";

const summary: JobDescriptionSummary = {
  id: "job-1",
  job_title: "Java 开发实习生",
  company_name: "示例科技",
  work_city: "南京",
  salary_text: "150-170 元/天",
  skills: ["Java", "MySQL"],
  source_type: "external_import",
  source_site: "boss",
  source_url: "https://www.zhipin.com/job_detail/abc123.html",
  archived_at: null,
  lock_version: 3,
  updated_at: "2026-07-29T08:00:00Z",
};

const record: JobDescriptionRecord = {
  ...summary,
  employment_type: "internship",
  description: "参与业务系统后端开发",
  education_requirement: "本科",
  experience_requirement: null,
  work_schedule: "5天/周",
  work_address: "浦口区",
  work_mode: "onsite",
  salary_min: "150.00",
  salary_max: "170.00",
  salary_currency: "CNY",
  salary_period: "day",
  salary_months_per_year: null,
  company_legal_name: "示例科技有限公司",
  company_industry: "互联网",
  company_size: "100-499人",
  company_financing_stage: "A轮",
  company_description: "虚构测试公司",
  recruiter_name: "招聘负责人",
  recruiter_title: "HRBP",
  source_job_id: "abc123",
  source_url_hash: "hash",
  imported_at: "2026-07-29T07:00:00Z",
  notes: "优先准备 Java",
  created_at: "2026-07-29T07:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("JobFormPage", () => {
  it("明确标记创建表单中的必填字段", () => {
    render(<JobFormPage mode="create" />);

    for (const label of ["岗位名称", "公司名称", "JD 正文（Markdown）"]) {
      const field = screen.getByLabelText(label);
      expect(field).toBeRequired();
      expect(field.closest("label")).toHaveTextContent("必填");
    }

    const skills = screen.getByLabelText("技能");
    expect(skills).not.toBeRequired();
    expect(skills.closest("label")).not.toHaveTextContent("必填");
  });

  it("发现重复来源后要求用户选择，并把更新动作与版本一起提交", async () => {
    const duplicate = {
      existing: summary,
      allowed_actions: ["update", "cancel"] as Array<"update" | "cancel">,
    };
    const create = vi.spyOn(api, "createJobDescription")
      .mockRejectedValueOnce(new ApiRequestError(409, "JD_SOURCE_DUPLICATE", {
        error: "JD_SOURCE_DUPLICATE",
        duplicate,
      }))
      .mockResolvedValueOnce({ job_description: record });

    render(<JobFormPage mode="create" />);
    fireEvent.change(screen.getByLabelText("岗位名称"), { target: { value: "Java 开发实习生" } });
    fireEvent.change(screen.getByLabelText("公司名称"), { target: { value: "示例科技" } });
    fireEvent.change(screen.getByLabelText("JD 正文（Markdown）"), { target: { value: "参与业务系统后端开发" } });
    fireEvent.change(screen.getByLabelText("来源链接（可选）"), { target: { value: summary.source_url } });
    fireEvent.click(screen.getByRole("button", { name: "保存 JD" }));

    expect(await screen.findByRole("dialog", { name: "Java 开发实习生" })).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "更新原记录" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0].duplicate_resolution).toEqual({
      action: "update",
      job_description_id: "job-1",
      base_lock_version: 3,
    });
    expect(window.location.pathname).toBe("/jobs/job-1");
  });

  it("编辑时展示只读来源且提交中不包含任何来源身份字段", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: record });
    const update = vi.spyOn(api, "updateJobDescription").mockResolvedValue({
      job_description: { ...record, job_title: "高级 Java 开发实习生", lock_version: 4 },
    });

    render(<JobFormPage mode="edit" jobId="job-1" />);

    expect(await screen.findByText("来源信息（只读）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: summary.source_url as string })).toHaveAttribute("href", summary.source_url);
    expect(screen.queryByLabelText("来源链接（可选）")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("岗位名称"), { target: { value: "高级 Java 开发实习生" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 JD" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const payload = update.mock.calls[0][1];
    expect(payload).toMatchObject({
      job_title: "高级 Java 开发实习生",
      base_lock_version: 3,
    });
    expect(payload).not.toHaveProperty("source_type");
    expect(payload).not.toHaveProperty("source_url");
    expect(payload).not.toHaveProperty("duplicate_resolution");
  });

  it("编辑目标不可见时展示错误页而不是空白可提交表单", async () => {
    vi.spyOn(api, "getJobDescription").mockRejectedValue(
      new ApiRequestError(404, "JD_NOT_FOUND"),
    );

    render(<JobFormPage mode="edit" jobId="missing" />);

    expect(await screen.findByRole("heading", { name: "无法打开这条 JD" })).toBeInTheDocument();
    expect(screen.getByText("岗位不存在，或当前账号没有访问权限。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存 JD" })).not.toBeInTheDocument();
  });
});
