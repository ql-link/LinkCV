import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type InterviewSessionRecord, type JobApplicationRecord, type InterviewTranscriptionTask } from "@/api/client";
import { RecordingTranscription } from "./RecordingTranscription";

const session = { id: "11", lock_version: 7, questions_markdown: "原手写内容" } as InterviewSessionRecord;
const ready = { id: "22", dataset_id: "33", status: "ready", text: "问：介绍项目。答：张三负责虚构项目。", sentences: [], duration_ms: 3000, error_code: null, created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:01:00Z", completed_at: "2026-10-03T00:01:00Z" } as InterviewTranscriptionTask;
const changed = vi.fn();
const renderCard = () => render(<RecordingTranscription session={session} datasetId="33" readOnly={false} onChanged={changed} />);

beforeEach(() => {
  vi.spyOn(api, "interviewTranscriptionCapability").mockResolvedValue({ available: true, error_code: null });
  vi.spyOn(api, "getInterviewTranscription").mockResolvedValue({ task: ready });
  vi.spyOn(api, "updateInterviewSession").mockResolvedValue({ session: { ...session, lock_version: 8 }, application: {} as JobApplicationRecord, assets: [] });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("recording transcription", () => {
  it("keeps ASR as a draft until review and appends edited text to the original", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "校对转写文字" }));
    expect(api.updateInterviewSession).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "转写文字" }), { target: { value: "校对后的文字" } });
    fireEvent.click(screen.getByRole("button", { name: "确认加入文字记录" }));
    await waitFor(() => expect(api.updateInterviewSession).toHaveBeenCalledWith("11", { base_lock_version: 7, questions_markdown: "原手写内容\n\n校对后的文字" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(changed).toHaveBeenCalledOnce();
  });
  it("keeps the edited draft open on a version conflict", async () => {
    vi.mocked(api.updateInterviewSession).mockRejectedValue(new ApiRequestError(409, "INTERVIEW_EDIT_CONFLICT"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "校对转写文字" }));
    fireEvent.change(screen.getByRole("textbox", { name: "转写文字" }), { target: { value: "不要丢失的校对稿" } });
    fireEvent.click(screen.getByRole("button", { name: "确认加入文字记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("其他页面更新");
    expect(screen.getByRole("textbox")).toHaveValue("不要丢失的校对稿");
    expect(changed).not.toHaveBeenCalled();
  });
  it("disables submission when the model is unavailable", async () => {
    vi.mocked(api.getInterviewTranscription).mockResolvedValue({ task: null });
    vi.mocked(api.interviewTranscriptionCapability).mockResolvedValue({ available: false, error_code: "INTERVIEW_TRANSCRIPTION_MODEL_UNAVAILABLE" });
    renderCard();
    expect(await screen.findByText(/联系管理员配置文件识别模型/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "转成文字" })).toBeDisabled();
  });
  it("does not truncate a long draft and prevents an oversized merged save", async () => {
    vi.mocked(api.getInterviewTranscription).mockResolvedValue({ task: { ...ready, text: "文".repeat(500000) } });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "校对转写文字" }));
    expect(screen.getByRole("textbox")).toHaveValue("文".repeat(500000));
    expect(screen.getByRole("button", { name: "确认加入文字记录" })).toBeDisabled();
    expect(api.updateInterviewSession).not.toHaveBeenCalled();
  });
  it("submits only on an explicit click and cancels the exact active task", async () => {
    vi.mocked(api.getInterviewTranscription).mockResolvedValue({ task: null });
    vi.spyOn(api, "createInterviewTranscription").mockResolvedValue({ task: { ...ready, status: "queued", text: null } });
    vi.spyOn(api, "cancelInterviewTranscription").mockResolvedValue({ task: { ...ready, status: "cancelled", text: null } });
    renderCard();
    await waitFor(() => expect(screen.getByRole("button", { name: "转成文字" })).toBeEnabled());
    expect(api.createInterviewTranscription).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "转成文字" }));
    expect(await screen.findByRole("status")).toHaveTextContent("等待转写");
    fireEvent.click(screen.getByRole("button", { name: "取消转写" }));
    expect(await screen.findByText(/转写已取消/)).toBeInTheDocument();
    expect(api.cancelInterviewTranscription).toHaveBeenCalledWith("11", "33", "22");
  });
});
