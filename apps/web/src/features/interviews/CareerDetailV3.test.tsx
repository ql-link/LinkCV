import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterviewSessionDetail, InterviewSessionSummary, JobApplicationSummary } from "@/api/client";
import { AddNextStageDialog } from "./CareerDetailViews";
import { ReviewV3Content } from "./CareerDetailV3";

const mocks = vi.hoisted(() => ({ addJobApplicationStage: vi.fn(), createInterviewSession: vi.fn(), listResumes: vi.fn(), updateJobApplication: vi.fn(), generateInterviewReview: vi.fn(), getInterviewSession: vi.fn(), listInterviewSessions: vi.fn(), updateInterviewSession: vi.fn() }));
vi.mock("@/api/client", async (original) => ({ ...await original<typeof import("@/api/client")>(), api: mocks }));
const application = { id: "sample-application", job_description_id: "sample-job", company_name_snapshot: "示例公司", job_title_snapshot: "后端工程师", job_snapshot: {}, current_stage_type: "interview", current_stage_label: "二面", current_round_no: 2, stage_state: "awaiting_schedule", current_stage: { id: "sample-stage", stage_type: "interview", stage_label: "二面", sequence_no: 2, stage_status: "active" }, status: "active", offer_status: "none", archived_at: null, applied_at: "2026-09-10T08:00:00Z", created_at: "2026-09-10T08:00:00Z", updated_at: "2026-09-20T08:00:00Z", lock_version: 4 } as JobApplicationSummary;
const detail = { application, session: { id: "sample-session", stage_label: "二面", status: "completed", start_at: "2026-09-20T08:00:00Z", end_at: "2026-09-20T09:00:00Z", lock_version: 2, questions_markdown: "示例文字记录" }, assets: [] } as unknown as InterviewSessionDetail;
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

  it("generates and displays real scores, with no fake timeline or percentage", async () => {
    let finish!: (result: InterviewSessionDetail) => void;
    mocks.generateInterviewReview.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const report = { schema_version: 1, source_hash: "hash", generated_at: "2026-10-03T00:00:00Z", summary: "真实摘要",
      overall_score: null, project_expression: { score: 6, reason: "有证据", evidence: "原文" },
      system_design: { score: null, reason: "记录不足", evidence: null }, communication: { score: 8, reason: "清楚", evidence: "原文" },
      questions: [{ question: "真实问题", answer: "原回答", evidence: "原文", strength: "表达清楚", improvement: "补充数据", suggested_answer: "真实建议" }] } as const;
    const props = { onBack: vi.fn(), onUpload: vi.fn(), onText: vi.fn(), onNotice: vi.fn(), onChanged: vi.fn(), recordContent: null };
    render(<ReviewV3Content detail={detail} {...props} />);
    expect(screen.queryByText("9")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成复盘" }));
    expect(screen.getByRole("button", { name: "正在生成…" })).toBeDisabled();
    expect(screen.queryByText(/60%/)).not.toBeInTheDocument();
    finish({ ...detail, session: { ...detail.session, review_report: { ...report, questions: [...report.questions] }, review_status: "ready" } });
    expect(await screen.findByText("真实摘要")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "复盘评分" })).toHaveTextContent("记录不足");
    expect(screen.getAllByText("真实建议").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Q3" })).not.toBeInTheDocument();
    expect(props.onChanged).toHaveBeenCalledOnce();
    expect(mocks.generateInterviewReview).toHaveBeenCalledWith(detail.session.id, expect.objectContaining({ base_lock_version: 2, request_id: expect.any(String) }));
    mocks.listInterviewSessions.mockResolvedValue({ items: [{ ...detail.session, id: "next", status: "scheduled", stage_label: "三面" }], next_cursor: null });
    mocks.getInterviewSession.mockResolvedValue({ ...detail, session: { ...detail.session, id: "next", status: "scheduled", prep_items: [], lock_version: 5 } });
    mocks.updateInterviewSession.mockResolvedValue({});
    fireEvent.click(screen.getByRole("button", { name: "加入下一轮准备清单" }));
    const select = await screen.findByRole("combobox", { name: "选择下一轮面试" });
    fireEvent.change(select, { target: { value: "next" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到准备清单" }));
    await waitFor(() => expect(mocks.updateInterviewSession).toHaveBeenCalledWith("next", expect.objectContaining({ base_lock_version: 5, preparation_note: expect.stringContaining("真实建议"), prep_items: [expect.objectContaining({ title: "真实问题", reason: "补充数据", done: false })] })));
  });

  it.each(["unavailable", "previous_ready"])("reuses an unknown request result when the read is %s", async (readState) => {
    mocks.generateInterviewReview.mockRejectedValue(new Error("offline"));
    if (readState === "unavailable") mocks.getInterviewSession.mockRejectedValue(new Error("offline"));
    else mocks.getInterviewSession.mockResolvedValue({ ...detail, session: { ...detail.session, review_status: "ready", review_request_id: "previous-request" } });
    const props = { onBack: vi.fn(), onUpload: vi.fn(), onText: vi.fn(), onNotice: vi.fn(), recordContent: null };
    const previousCalls = mocks.generateInterviewReview.mock.calls.length;
    render(<ReviewV3Content detail={detail} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "生成复盘" }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "生成复盘" }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledTimes(2));
    expect(mocks.generateInterviewReview.mock.calls[previousCalls][1]).toEqual(mocks.generateInterviewReview.mock.calls[previousCalls + 1][1]);
  });

  it("uses a fresh request only after reading the matching failed generation", async () => {
    let requestId = "";
    mocks.generateInterviewReview.mockImplementation((_id, payload) => { requestId = payload.request_id; return Promise.reject(new Error("offline")); });
    mocks.getInterviewSession.mockImplementation(() => Promise.resolve({ ...detail, session: { ...detail.session, lock_version: 4, review_status: "failed", review_request_id: requestId } }));
    const onNotice = vi.fn();
    const previousCalls = mocks.generateInterviewReview.mock.calls.length;
    render(<ReviewV3Content detail={detail} onBack={vi.fn()} onUpload={vi.fn()} onText={vi.fn()} onNotice={onNotice} recordContent={null} />);
    fireEvent.click(screen.getByRole("button", { name: "生成复盘" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "生成复盘" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(2));
    const first = mocks.generateInterviewReview.mock.calls[previousCalls][1];
    const second = mocks.generateInterviewReview.mock.calls[previousCalls + 1][1];
    expect(second.request_id).not.toBe(first.request_id);
    expect(second.base_lock_version).toBe(4);
  });

  it.each(["image/png", "application/pdf"])("keeps non-text attachments of type %s without invented scores", (mimeType) => {
    const attachmentOnly: InterviewSessionDetail = { ...detail, session: { ...detail.session, questions_markdown: "  ", review_summary: null }, assets: [{ id: "sample-document", interview_session_id: detail.session.id, source_type: "uploaded", asset_type: "document", content_type: mimeType, original_file_name: "sample-attachment", file_size: 32, duration_ms: null, sha256: null, created_at: "2026-09-20T08:00:00Z" }] };
    render(<ReviewV3Content detail={attachmentOnly} onBack={vi.fn()} onUpload={vi.fn()} onText={vi.fn()} onNotice={vi.fn()} recordContent={null} />);
    expect(screen.getByRole("button", { name: "生成复盘" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "做得好" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "面试录音播放器" })).not.toBeInTheDocument();
  });

  it("preserves manual review summaries without inventing scores", () => {
    const reviewed = { ...detail, session: { ...detail.session, questions_markdown: null, review_summary: "已保存的真实复盘摘要" } };
    render(<ReviewV3Content detail={reviewed} onBack={vi.fn()} onUpload={vi.fn()} onText={vi.fn()} onNotice={vi.fn()} recordContent={null} />);
    expect(screen.getByText("已保存的真实复盘摘要")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "复盘评分" })).not.toBeInTheDocument();
  });
});
