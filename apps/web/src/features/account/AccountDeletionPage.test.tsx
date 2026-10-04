import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { AccountDeletionPage, saveDeletionReceipt } from "./AccountDeletionPage";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("匿名注销进度", () => {
  it("通过请求体回执查询，到完成状态后停止轮询", async () => {
    vi.useFakeTimers();
    const receipt = { job_id: "fictional-job", receipt_token: "fictional-secret", status: "pending" as const };
    saveDeletionReceipt(receipt);
    const poll = vi.spyOn(api, "accountDeletionStatus").mockResolvedValueOnce({ status: "processing", phase: "objects" }).mockResolvedValue({ status: "completed", phase: "complete" });
    await act(async () => { render(<AccountDeletionPage />); });
    expect(screen.getByText("正在清理个人数据，可以关闭此页面。")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText("个人数据已清理完成。")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll).toHaveBeenCalledWith(receipt);
    expect(window.location.href).not.toContain(receipt.receipt_token);
    expect(screen.queryByText(receipt.receipt_token)).not.toBeInTheDocument();
  });
  it("回执到期停止轮询并显示到期信息", async () => {
    vi.useFakeTimers();
    saveDeletionReceipt({ job_id: "fictional-expired", receipt_token: "fictional-secret", status: "pending" });
    const poll = vi.spyOn(api, "accountDeletionStatus").mockRejectedValue(new ApiRequestError(404, "NOT_FOUND"));
    await act(async () => { render(<AccountDeletionPage />); });
    expect(screen.getByText("注销回执已失效，无法继续查询。")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(poll).toHaveBeenCalledOnce();
  });
});
