import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterviewSessionDetail, JobApplicationSummary } from "@/api/client";
import { AddNextStageDialog } from "./CareerDetailViews";
import { ApplicationV3Content, ReviewV3Content } from "./CareerDetailV3";

const mocks = vi.hoisted(() => ({ addJobApplicationStage: vi.fn(), createInterviewSession: vi.fn(), listResumes: vi.fn(), updateJobApplication: vi.fn() }));
vi.mock("@/api/client", async (original) => ({ ...await original<typeof import("@/api/client")>(), api: mocks }));
const application = { id: "sample-application", job_description_id: "sample-job", company_name_snapshot: "示例公司", job_title_snapshot: "后端工程师", job_snapshot: {}, current_stage_type: "interview", current_stage_label: "二面", current_round_no: 2, stage_state: "awaiting_schedule", current_stage: { id: "sample-stage", stage_type: "interview", stage_label: "二面", sequence_no: 2, stage_status: "active" }, status: "active", offer_status: "none", archived_at: null, applied_at: "2026-09-10T08:00:00Z", created_at: "2026-09-10T08:00:00Z", updated_at: "2026-09-20T08:00:00Z", lock_version: 4 } as JobApplicationSummary;
const detail = { application, session: { id: "sample-session", stage_label: "二面", status: "completed", start_at: "2026-09-20T08:00:00Z", end_at: "2026-09-20T09:00:00Z", questions_markdown: "示例文字记录" }, assets: [] } as unknown as InterviewSessionDetail;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Figma career detail interactions", () => {
  it("retries scheduling the existing stage without adding a duplicate stage", async () => {
    const onClose = vi.fn(); const onChanged = vi.fn();
    mocks.createInterviewSession.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ session: { id: "new-session", lock_version: 1 } });
    render(<AddNextStageDialog application={application} timezone="Asia/Shanghai" scheduleOnly lockStageSelection initialStage="interview" initialInterviewLabel="二面" initialStartAt="2026-10-12T14:30" onClose={onClose} onChanged={onChanged} onNotice={vi.fn()} />);
    expect(screen.getByLabelText("面试轮次")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存安排" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败");
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存安排" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mocks.addJobApplicationStage).not.toHaveBeenCalled();
    const [first, second] = mocks.createInterviewSession.mock.calls;
    expect(first[1]).toEqual(second[1]);
    expect(second).toEqual([application.id, expect.objectContaining({ application_stage_id: "sample-stage", round_no: 2, stage_label: "二面", schedule_kind: "fixed_slot" })]);
  });

  it("shows a retryable mock generation failure and finishes after retry", async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ReviewV3Content detail={detail} onBack={vi.fn()} onUpload={vi.fn()} onText={vi.fn()} onNotice={vi.fn()} recordContent={null} />);
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(screen.getByRole("progressbar", { name: "复盘生成进度" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Q3" })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByRole("heading", { name: "复盘没能生成" })).toBeInTheDocument();
    online.mockReturnValue(true);
    fireEvent.click(screen.getAllByRole("button", { name: "重新生成" })[1]);
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByRole("heading", { name: "做得好" })).toBeInTheDocument();
    expect(screen.getAllByTitle("需要后端支持，目前为示例数据").length).toBeGreaterThan(0);
  });

  it("enters generation after content is added to an empty completed record", () => {
    vi.useFakeTimers();
    const props = { onBack: vi.fn(), onUpload: vi.fn(), onText: vi.fn(), onNotice: vi.fn(), recordContent: null };
    const empty = { ...detail, session: { ...detail.session, questions_markdown: null } };
    const { rerender } = render(<ReviewV3Content detail={empty} {...props} />);
    expect(screen.getByRole("button", { name: "上传录音" })).toBeInTheDocument();
    rerender(<ReviewV3Content detail={detail} {...props} />);
    expect(screen.getByRole("progressbar", { name: "复盘生成进度" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByRole("heading", { name: "做得好" })).toBeInTheDocument();
  });

  it.each(["image/png", "application/pdf"])("keeps attachments of type %s without audio or text in the empty state", (mimeType) => {
    const attachmentOnly: InterviewSessionDetail = { ...detail, session: { ...detail.session, questions_markdown: "  ", review_summary: null }, assets: [{ id: "sample-document", interview_session_id: detail.session.id, source_type: "uploaded", asset_type: "document", content_type: mimeType, original_file_name: "sample-attachment", file_size: 32, duration_ms: null, sha256: null, created_at: "2026-09-20T08:00:00Z" }] };
    render(<ReviewV3Content detail={attachmentOnly} onBack={vi.fn()} onUpload={vi.fn()} onText={vi.fn()} onNotice={vi.fn()} recordContent={null} />);
    expect(screen.getByRole("button", { name: "上传录音" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "做得好" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "面试录音播放器" })).not.toBeInTheDocument();
  });

  it("keeps an existing review available after the audio and text source are removed", () => {
    const reviewed = { ...detail, session: { ...detail.session, questions_markdown: null, review_summary: "已保存的真实复盘摘要" } };
    render(<ReviewV3Content detail={reviewed} onBack={vi.fn()} onUpload={vi.fn()} onText={vi.fn()} onNotice={vi.fn()} recordContent={null} />);
    expect(screen.getByText("已保存的真实复盘摘要")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "做得好" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传录音" })).not.toBeInTheDocument();
  });

  it("records local preparation completion separately for each question and resets for another review", () => {
    vi.useFakeTimers();
    const onNotice = vi.fn();
    const props = { onBack: vi.fn(), onUpload: vi.fn(), onText: vi.fn(), onNotice, recordContent: null };
    const { rerender } = render(<ReviewV3Content detail={detail} {...props} />);
    const prepare = screen.getByRole("button", { name: /把 Q3 的回答整理进/ });
    fireEvent.click(prepare);
    expect(prepare).toHaveAttribute("aria-busy", "true");
    expect(prepare).toBeDisabled();
    expect(prepare).toHaveTextContent("整理中…");
    act(() => vi.advanceTimersByTime(600));
    expect(prepare).toHaveTextContent("已整理");
    expect(prepare).toHaveAttribute("aria-busy", "false");
    fireEvent.click(prepare);
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("需后端支持，刷新后不保留"));
    fireEvent.click(screen.getByRole("button", { name: "Q1" }));
    expect(screen.getByRole("button", { name: /把 Q1 的回答整理进/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Q3" }));
    expect(screen.getByRole("button", { name: /把 Q3 的回答整理进/ })).toHaveTextContent("已整理");
    rerender(<ReviewV3Content detail={{ ...detail, session: { ...detail.session, id: "another-session" } }} {...props} />);
    expect(screen.getByRole("button", { name: /把 Q3 的回答整理进/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /把 Q3 的回答整理进/ })).toHaveTextContent("开始");
  });

  it("links a resume from the empty state with the current application lock", async () => {
    const pending = { ...application, current_stage: null, current_stage_type: "screening", current_stage_label: "待投递", applied_at: null, phase: "pending" } as JobApplicationSummary;
    mocks.listResumes.mockResolvedValue({ resumes: [{ id: "sample-resume", title: "示例简历" }] });
    mocks.updateJobApplication.mockResolvedValue({ application: { ...pending, resume_id: "sample-resume" } });
    const onChanged = vi.fn();
    render(<ApplicationV3Content application={pending} sessions={[]} primaryLabel="添加求职阶段" onPrimary={vi.fn()} onBack={vi.fn()} onNotice={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "关联简历" }));
    fireEvent.click(await screen.findByRole("button", { name: "示例简历" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mocks.updateJobApplication).toHaveBeenCalledWith(pending.id, { resume_id: "sample-resume", base_lock_version: 4 });
  });
});
