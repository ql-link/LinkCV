import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api, type JobApplicationSummary, type JobDescriptionRecord, type JobMatch } from "../../api/client";
import { JobDetailPage } from "./JobDetailPage";

const activeJob: JobDescriptionRecord = {
  id: "job-1",
  job_title: "Java 开发实习生",
  company_name: "示例科技",
  logo_url: null,
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

async function clickWhenEnabled(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

const readyMatch: JobMatch = {
  status: "ready", stale: false, score: 72, headline: "有 Kubernetes 经验",
  hits: ["有后端开发经验"], gaps: ["有 Kubernetes 经验"],
  highlights: { covered: ["后端"], missing: ["Kubernetes"] }, analyzed_at: "2026-10-03T08:00:00Z", error_code: null,
};

beforeEach(() => {
  vi.spyOn(api, "listJobApplications").mockResolvedValue({ items: [], next_cursor: null });
  vi.spyOn(api, "getJobMatch").mockResolvedValue({ match: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("JobDetailPage", () => {
  it("岗位详情提供求职入口和字段就地编辑", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });

    render(<JobDetailPage jobId={activeJob.id} />);

    expect(await screen.findByRole("heading", { name: activeJob.job_title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: activeJob.job_title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回求职记录" })).toHaveAttribute("href", "/career/applications");
    expect(await screen.findByRole("button", { name: "开始求职" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑职位名称" })).toHaveClass("job-quick-edit-display");
    expect(screen.getByRole("button", { name: "编辑职位描述" })).toHaveClass("job-quick-edit-display");
    expect(screen.queryByText("编辑")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.queryByText("活动岗位")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "这个岗位的求职记录" })).not.toBeInTheDocument();
  });

  it("已有已结束进程时不再提供再次求职入口", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    vi.mocked(api.listJobApplications).mockResolvedValue({
      items: [{
        id: "application-ended",
        job_description_id: activeJob.id,
        status: "closed",
        lifecycle_status: "terminated",
        archived_at: null,
        created_at: "2026-09-01T08:00:00Z",
      } as JobApplicationSummary],
      next_cursor: null,
    });

    render(<JobDetailPage jobId={activeJob.id} />);

    expect(await screen.findByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再次开始求职" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始求职" })).not.toBeInTheDocument();
  });

  it("从求职记录进入岗位详情时返回对应记录", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    window.history.replaceState(null, "", `/career/jobs/${activeJob.id}?fromApplication=application-7`);

    render(<JobDetailPage jobId={activeJob.id} />);

    const backLink = await screen.findByRole("link", { name: "返回求职记录" });
    expect(backLink).toHaveAttribute("href", "/career/applications/application-7");
    fireEvent.click(backLink);
    expect(window.location.pathname).toBe("/career/applications/application-7");
  });

  it("求职分类使用固定尺寸的自定义选择框并在选择后保存", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const updatedJob = { ...activeJob, employment_type: "full_time" as const, lock_version: 3 };
    const update = vi.spyOn(api, "updateJobDescription").mockResolvedValue({ job_description: updatedJob });

    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑求职分类" }));
    const trigger = screen.getByLabelText("求职分类");
    expect(trigger).toHaveClass("job-quick-edit-select-trigger");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "正式" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(activeJob.id, expect.objectContaining({
      employment_type: "full_time",
      base_lock_version: activeJob.lock_version,
    })));
  });

  it("点击字段编辑入口后聚焦文本末尾，按 Enter 保存且不跳转", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const updatedJob = { ...activeJob, job_title: "高级 Java 开发工程师", lock_version: 3 };
    const update = vi.spyOn(api, "updateJobDescription").mockResolvedValue({ job_description: updatedJob });
    window.history.replaceState(null, "", `/career/jobs/${activeJob.id}`);

    render(<JobDetailPage jobId={activeJob.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑职位名称" }));
    expect(window.location.pathname).toBe(`/career/jobs/${activeJob.id}`);
    const titleInput = screen.getByLabelText("职位名称") as HTMLInputElement;
    expect(screen.getByText(/Enter 保存/)).toBeInTheDocument();
    expect(screen.getByText(/Esc 取消/)).toBeInTheDocument();
    expect(titleInput).toHaveFocus();
    expect(titleInput.selectionStart).toBe(activeJob.job_title.length);
    fireEvent.change(titleInput, { target: { value: updatedJob.job_title } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(activeJob.id, expect.objectContaining({
      job_title: updatedJob.job_title,
      base_lock_version: activeJob.lock_version,
    }));
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty("source_url");
    expect(await screen.findByRole("heading", { name: updatedJob.job_title, level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/career/jobs/${activeJob.id}`);
  });

  it("原岗位描述为空时仍可修改职位名称", async () => {
    const jobWithoutDescription = { ...activeJob, description: "" };
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: jobWithoutDescription });
    const updatedJob = { ...jobWithoutDescription, job_title: "Java 工程师-P4", lock_version: 3 };
    const update = vi.spyOn(api, "updateJobDescription").mockResolvedValue({ job_description: updatedJob });

    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑职位名称" }));
    const titleInput = screen.getByLabelText("职位名称");
    fireEvent.change(titleInput, { target: { value: updatedJob.job_title } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() => expect(update).toHaveBeenCalledWith(activeJob.id, expect.objectContaining({
      job_title: updatedJob.job_title,
      description: "",
      base_lock_version: activeJob.lock_version,
    })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("按 Escape 取消当前字段编辑", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const update = vi.spyOn(api, "updateJobDescription");

    render(<JobDetailPage jobId={activeJob.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑职位名称" }));
    const titleInput = screen.getByLabelText("职位名称");
    fireEvent.change(titleInput, { target: { value: "尚未保存的标题" } });
    fireEvent.keyDown(titleInput, { key: "Escape" });

    expect(screen.getByRole("heading", { name: activeJob.job_title, level: 1 })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("尚未保存的标题")).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("编辑框失去焦点时自动退出并恢复字段", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const update = vi.spyOn(api, "updateJobDescription");

    render(<JobDetailPage jobId={activeJob.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑职位名称" }));
    const titleInput = screen.getByLabelText("职位名称");
    fireEvent.change(titleInput, { target: { value: "" } });
    fireEvent.blur(titleInput);

    expect(screen.queryByLabelText("职位名称")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑职位名称" })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("已填写但未保存的内容失去焦点时也会退出", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const update = vi.spyOn(api, "updateJobDescription");

    render(<JobDetailPage jobId={activeJob.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑职位名称" }));
    const titleInput = screen.getByLabelText("职位名称");
    fireEvent.change(titleInput, { target: { value: "临时修改" } });
    fireEvent.blur(titleInput);

    expect(screen.queryByDisplayValue("临时修改")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑职位名称" })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("必填字段为空时保留当前编辑框并给出提示", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const update = vi.spyOn(api, "updateJobDescription");

    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑职位名称" }));
    const titleInput = screen.getByLabelText("职位名称");
    fireEvent.change(titleInput, { target: { value: "" } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    expect(screen.getByRole("alert")).toHaveTextContent("该字段为必填项");
    expect(screen.getByRole("alert")).toHaveClass("ui-feedback-notice", "is-floating");
    expect(screen.getByLabelText("职位名称")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("多行描述使用 Shift+Enter 换行，Enter 才保存", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const updatedJob = { ...activeJob, description: "参与后端业务开发。\n负责接口维护。", lock_version: 3 };
    const update = vi.spyOn(api, "updateJobDescription").mockResolvedValue({ job_description: updatedJob });

    render(<JobDetailPage jobId={activeJob.id} />);
    const descriptionDisplay = await screen.findByRole("button", { name: "编辑职位描述" });
    expect(descriptionDisplay.closest(".job-quick-edit")).toHaveClass("is-multiline");
    fireEvent.click(descriptionDisplay);
    const description = screen.getByLabelText("职位描述");
    const editor = description.closest(".job-quick-edit");
    expect(editor).toHaveClass("is-multiline", "is-editing");
    expect(editor?.querySelector(".job-quick-edit-multiline-mirror")).toHaveTextContent(activeJob.description);
    fireEvent.change(description, { target: { value: updatedJob.description } });
    expect(editor?.querySelector(".job-quick-edit-multiline-mirror")?.textContent).toBe(updatedJob.description);
    fireEvent.keyDown(description, { key: "Enter", shiftKey: true });
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(description, { key: "Enter" });

    await waitFor(() => expect(update).toHaveBeenCalledWith(activeJob.id, expect.objectContaining({ description: updatedJob.description })));
  });

  it("允许把职位描述清空后保存", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const updatedJob = { ...activeJob, description: "", lock_version: 3 };
    const update = vi.spyOn(api, "updateJobDescription").mockResolvedValue({ job_description: updatedJob });

    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑职位描述" }));
    const description = screen.getByLabelText("职位描述");
    fireEvent.change(description, { target: { value: "" } });
    fireEvent.keyDown(description, { key: "Enter" });

    await waitFor(() => expect(update).toHaveBeenCalledWith(activeJob.id, expect.objectContaining({
      description: "",
      base_lock_version: activeJob.lock_version,
    })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("结构化薪资作为一组字段编辑并一次性保存", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const updatedJob = { ...activeJob, salary_min: "150.00", salary_max: "170.00", salary_currency: "CNY", salary_period: "day" as const, salary_months_per_year: 13, lock_version: 3 };
    const update = vi.spyOn(api, "updateJobDescription").mockResolvedValue({ job_description: updatedJob });

    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑结构化薪资" }));
    expect(screen.getByRole("dialog", { name: "编辑结构化薪资" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("最低薪资"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("最高薪资"), { target: { value: "170" } });
    fireEvent.change(screen.getByLabelText("币种"), { target: { value: "cny" } });
    fireEvent.click(screen.getByLabelText("计薪周期"));
    const dayOption = await screen.findByRole("option", { name: "天" });
    expect(document.querySelector(".job-structured-salary-controls")).toBeInTheDocument();
    fireEvent.click(dayOption);
    const months = screen.getByLabelText("年薪月数");
    fireEvent.change(months, { target: { value: "13" } });
    fireEvent.keyDown(months, { key: "Enter" });

    await waitFor(() => expect(update).toHaveBeenCalledWith(activeJob.id, expect.objectContaining({
      salary_min: "150",
      salary_max: "170",
      salary_currency: "CNY",
      salary_period: "day",
      salary_months_per_year: 13,
      base_lock_version: activeJob.lock_version,
    })));
    expect(await screen.findByRole("button", { name: "编辑结构化薪资" })).toHaveTextContent(activeJob.salary_text!);
  });

  it("结构化薪资组内切换字段不退出，点击组外才取消编辑", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const update = vi.spyOn(api, "updateJobDescription");

    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑结构化薪资" }));
    const minimum = screen.getByLabelText("最低薪资");
    const maximum = screen.getByLabelText("最高薪资");
    fireEvent.change(minimum, { target: { value: "150" } });
    fireEvent.blur(minimum, { relatedTarget: maximum });

    expect(screen.getByRole("dialog", { name: "编辑结构化薪资" })).toBeInTheDocument();
    fireEvent.blur(maximum, { relatedTarget: document.body });
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑结构化薪资" })).toBeInTheDocument());
    expect(update).not.toHaveBeenCalled();
  });

  it("删除前要求确认，失败时关闭弹窗并保留详情", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const remove = vi.spyOn(api, "deleteJobDescription").mockRejectedValue(new Error("offline"));

    render(<JobDetailPage jobId={activeJob.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("求职进程、阶段和复盘会一起删除");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("关联资料的原文件仍保留在资料库");
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(activeJob.id));
    expect(screen.getByRole("alert")).toHaveTextContent("岗位服务暂时不可用");
    expect(screen.getByRole("alert")).toHaveClass("ui-feedback-notice", "is-floating");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("岗位详情 V3 状态", () => {
  const linkedApplication = {
    id: "application-1", job_description_id: activeJob.id, resume_id: "resume-1", resume_title_snapshot: "后端工程师 · 通用版",
    status: "active", lifecycle_status: "active", archived_at: null, current_stage_label: "三面", lock_version: 4,
  } as JobApplicationSummary;

  it("有关联简历与 JD 但还没分析时提示分析，不展示示例数字，并保留优化入口", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    vi.mocked(api.listJobApplications).mockResolvedValue({ items: [linkedApplication], next_cursor: null });
    render(<JobDetailPage jobId={activeJob.id} />);
    expect(await screen.findByText("还没有分析匹配度")).toBeInTheDocument();
    expect(api.getJobMatch).toHaveBeenCalledWith(activeJob.id, "resume-1");
    expect(screen.queryByText("需后端")).not.toBeInTheDocument();
    expect(screen.queryByText("86")).not.toBeInTheDocument();
    expect(screen.getByText("三面")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "按 JD 优化关联简历" }));
    expect(window.location.pathname).toBe("/resumes/resume-1/edit");
  });

  it("点击分析后展示分数、命中项、缺口，并按结果高亮岗位描述", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: { ...activeJob, description: "参与后端业务开发，需要 Kubernetes 经验" } });
    vi.mocked(api.listJobApplications).mockResolvedValue({ items: [linkedApplication], next_cursor: null });
    vi.spyOn(api, "analyzeJobMatch").mockResolvedValue({ match: readyMatch });
    const { container } = render(<JobDetailPage jobId={activeJob.id} />);
    await clickWhenEnabled("分析匹配度");
    expect(await screen.findByText("72")).toBeInTheDocument();
    expect(api.analyzeJobMatch).toHaveBeenCalledWith(activeJob.id, "resume-1");
    expect(screen.getByText("还缺：有 Kubernetes 经验")).toBeInTheDocument();
    expect(screen.getByText("有后端开发经验")).toBeInTheDocument();
    expect(container.querySelector(".jd-keyword-missing")?.textContent).toBe("Kubernetes");
    expect(container.querySelector(".jd-markdown strong")?.textContent).toBe("后端");
    expect(screen.getByRole("button", { name: "重新分析" })).toBeInTheDocument();
  });

  it("已有结果过期时仍展示旧分数并提示重新分析", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    vi.mocked(api.listJobApplications).mockResolvedValue({ items: [linkedApplication], next_cursor: null });
    vi.mocked(api.getJobMatch).mockResolvedValue({ match: { ...readyMatch, stale: true } });
    render(<JobDetailPage jobId={activeJob.id} />);
    expect(await screen.findByText("72")).toBeInTheDocument();
    expect(screen.getByText("简历或岗位描述已变化，这个分数可能已过期。")).toBeInTheDocument();
  });

  it("上次分析失败或被中断时显示原因而不是分数", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    vi.mocked(api.listJobApplications).mockResolvedValue({ items: [linkedApplication], next_cursor: null });
    vi.mocked(api.getJobMatch).mockResolvedValue({ match: { ...readyMatch, status: "failed", stale: false, score: null, headline: null, hits: [], gaps: [], error_code: "JOB_MATCH_INTERRUPTED" } });
    render(<JobDetailPage jobId={activeJob.id} />);
    expect(await screen.findByText("上次分析被中断，请重新分析。")).toBeInTheDocument();
    expect(screen.queryByText("72")).not.toBeInTheDocument();
  });

  it("模型未配置时提示暂未开放", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    vi.mocked(api.listJobApplications).mockResolvedValue({ items: [linkedApplication], next_cursor: null });
    vi.spyOn(api, "analyzeJobMatch").mockRejectedValue(new ApiRequestError(503, "LLM_MODEL_NOT_CONFIGURED"));
    render(<JobDetailPage jobId={activeJob.id} />);
    await clickWhenEnabled("分析匹配度");
    expect(await screen.findByText("AI 匹配分析暂未开放。")).toBeInTheDocument();
  });

  it("无 JD 时提供粘贴入口，匹配示例变淡且不可优化", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: { ...activeJob, description: "" } });
    vi.mocked(api.listJobApplications).mockResolvedValue({ items: [linkedApplication], next_cursor: null });
    render(<JobDetailPage jobId={activeJob.id} />);
    expect(await screen.findByText("岗位描述暂未记录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按 JD 优化关联简历" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "分析匹配度" })).toBeDisabled();
    expect(api.getJobMatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "粘贴岗位文字" }));
    expect(screen.getByLabelText("职位描述")).toHaveFocus();
  });

  it("无关联简历时通过已有求职进程接口保存本人简历", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    vi.mocked(api.listJobApplications).mockResolvedValue({ items: [{ ...linkedApplication, resume_id: null }], next_cursor: null });
    vi.spyOn(api, "listResumes").mockResolvedValue({ resumes: [{ id: "resume-2", title: "软件工程师" } as Awaited<ReturnType<typeof api.listResumes>>["resumes"][number]] });
    const update = vi.spyOn(api, "updateJobApplication").mockResolvedValue({ application: { ...linkedApplication, resume_id: "resume-2", lock_version: 5 } });
    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "选择关联简历" }));
    fireEvent.click(await screen.findByRole("button", { name: "软件工程师" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("application-1", { resume_id: "resume-2", base_lock_version: 4 }));
    expect(await screen.findByText("基于「软件工程师」")).toBeInTheDocument();
  });

  it("薪资原文与结构化薪资一起保存且不自动互相改写", async () => {
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    const update = vi.spyOn(api, "updateJobDescription").mockResolvedValue({ job_description: { ...activeJob, salary_text: "面议", salary_min: "150" } });
    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑结构化薪资" }));
    fireEvent.change(screen.getByLabelText("薪资"), { target: { value: "面议" } });
    fireEvent.change(screen.getByLabelText("最低薪资"), { target: { value: "150" } });
    fireEvent.keyDown(screen.getByLabelText("薪资"), { key: "Enter" });
    await waitFor(() => expect(update).toHaveBeenCalledWith(activeJob.id, expect.objectContaining({ salary_text: "面议", salary_min: "150" })));
    expect(await screen.findByRole("button", { name: "编辑结构化薪资" })).toHaveTextContent("面议");
  });

  it("保存冲突保留编辑内容并展示原有中文错误", async () => {
    const { ApiRequestError } = await import("../../api/client");
    vi.spyOn(api, "getJobDescription").mockResolvedValue({ job_description: activeJob });
    vi.spyOn(api, "updateJobDescription").mockRejectedValue(new ApiRequestError(409, "JD_EDIT_CONFLICT"));
    render(<JobDetailPage jobId={activeJob.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑职位名称" }));
    fireEvent.change(screen.getByLabelText("职位名称"), { target: { value: "新岗位名称" } });
    fireEvent.keyDown(screen.getByLabelText("职位名称"), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("岗位内容已经变化，请重新打开后再保存。");
    expect(screen.getByLabelText("职位名称")).toHaveValue("新岗位名称");
  });

  it("不存在的岗位使用应用内 404", async () => {
    const { ApiRequestError } = await import("../../api/client");
    vi.spyOn(api, "getJobDescription").mockRejectedValue(new ApiRequestError(404, "JD_NOT_FOUND"));
    render(<JobDetailPage jobId={activeJob.id} />);
    expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
  });
});
