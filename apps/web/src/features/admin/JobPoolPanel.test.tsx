import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiRequestError, type PoolSource } from "../../api/client";
import { JobPoolPanel } from "./JobPoolPanel";

const source: PoolSource = { id: "10", company_id: "20", company_name: "示例科技", adapter_key: "tencent", tenant_key: "careers.tencent.com", is_enabled: false, adapter_ready: true, sync_generation: "3", sync_status: "idle", next_sync_at: null, last_complete_at: null, careers_url: "https://careers.example.test/", supported_channels: ["experienced"], last_sync_result: {} };

beforeEach(() => {
  vi.spyOn(api, "listPoolSources").mockResolvedValue({ items: [source], sync_enabled: true });
  vi.spyOn(api, "bootstrapPoolSources").mockResolvedValue({ items: [source] });
  vi.spyOn(api, "setPoolSourceEnabled").mockResolvedValue({ ...source, is_enabled: true });
  vi.spyOn(api, "syncPoolSource").mockResolvedValue({ ...source, sync_status: "queued" });
  vi.spyOn(api, "acceptPoolSync").mockResolvedValue({ ...source, sync_status: "succeeded" });
});

it("enables an existing source with its current generation and reports real channel coverage", async () => {
  render(<JobPoolPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "启用" }));
  expect(api.setPoolSourceEnabled).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "启用来源" }));
  await waitFor(() => expect(api.setPoolSourceEnabled).toHaveBeenCalledWith(source, true));
  expect(screen.getByLabelText("覆盖渠道：社招")).toBeInTheDocument();
});

it("keeps sync unavailable when the global switch is off", async () => {
  vi.mocked(api.listPoolSources).mockResolvedValue({ items: [{ ...source, is_enabled: true }], sync_enabled: false });
  render(<JobPoolPanel />);
  expect(await screen.findByRole("button", { name: "立即同步" })).toBeDisabled();
  expect(screen.getByText(/自动同步当前关闭/)).toBeInTheDocument();
});

it("requires review of a complete anomalous result before applying missing checks", async () => {
  const anomalous: PoolSource = { ...source, is_enabled: true, sync_status: "anomalous", last_sync_result: { baseline_count: 100, latest: { generation: "3", observed_count: 10, counts: { created: 0, updated: 10, missing: 0, restored: 0, closed: 0, invalid: 0 }, is_complete: true, is_reviewed: false, error_code: "JOB_SOURCE_COUNT_DROP", finished_at: "2026-01-01T00:00:00Z" } } };
  vi.mocked(api.listPoolSources).mockResolvedValue({ items: [anomalous], sync_enabled: true });
  render(<JobPoolPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "确认异常结果" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  expect(api.acceptPoolSync).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认并核对上下线" }));
  await waitFor(() => expect(api.acceptPoolSync).toHaveBeenCalledWith(anomalous));
});

it("shows partial sync counts and preserves the no-offline-detection rule", async () => {
  const partial: PoolSource = { ...source, is_enabled: true, sync_status: "partial", last_sync_result: { latest: { generation: "3", observed_count: 12, counts: { created: 3, updated: 9, missing: 0, restored: 0, closed: 0, invalid: 2 }, is_complete: false, is_reviewed: false, error_code: "JOB_SOURCE_PARTIAL", finished_at: "2026-01-01T00:00:00Z" } } };
  vi.mocked(api.listPoolSources).mockResolvedValue({ items: [partial], sync_enabled: true });
  render(<JobPoolPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "查看结果" }));
  expect(await screen.findByRole("dialog", { name: "示例科技 · 同步结果" })).toBeInTheDocument();
  expect(screen.getByText("有效岗位已保留，本轮未判断岗位下线。")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认异常结果" })).not.toBeInTheDocument();
  expect(api.acceptPoolSync).not.toHaveBeenCalled();
});

it("dismisses a stale confirmation and retries with the refreshed source generation", async () => {
  const refreshed = { ...source, sync_generation: "4" };
  vi.mocked(api.listPoolSources).mockResolvedValueOnce({ items: [source], sync_enabled: true }).mockResolvedValue({ items: [refreshed], sync_enabled: true });
  vi.mocked(api.setPoolSourceEnabled).mockRejectedValueOnce(new ApiRequestError(409, "JOB_SOURCE_CONFLICT"));
  render(<JobPoolPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "启用" }));
  fireEvent.click(screen.getByRole("button", { name: "启用来源" }));
  expect(await screen.findByText("来源已被更新，请刷新后重试。")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "启用" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "启用" }));
  fireEvent.click(screen.getByRole("button", { name: "启用来源" }));
  await waitFor(() => expect(api.setPoolSourceEnabled).toHaveBeenLastCalledWith(refreshed, true));
});
