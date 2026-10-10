import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiRequestError, type PoolSource } from "../../api/client";
import { JobPoolPanel } from "./JobPoolPanel";

const source: PoolSource = { id: "10", company_id: "20", company_name: "示例科技", adapter_key: "tencent", tenant_key: "careers.tencent.com", is_enabled: false, adapter_ready: true, sync_generation: "3", sync_status: "idle", next_sync_at: null, last_complete_at: null, careers_url: "https://careers.example.test/", supported_channels: ["experienced"], last_sync_result: {} };

beforeEach(() => {
  vi.spyOn(api, "listPoolSources").mockResolvedValue({ items: [source], sync_enabled: true });
  vi.spyOn(api, "setPoolSourceEnabled").mockResolvedValue({ ...source, is_enabled: true });
  vi.spyOn(api, "syncPoolSource").mockResolvedValue({ ...source, sync_status: "queued" });
  vi.spyOn(api, "acceptPoolSync").mockResolvedValue({ ...source, sync_status: "succeeded" });
});

it("lists every registered source and enables one directly with its current generation", async () => {
  render(<JobPoolPanel />);
  expect(await screen.findByText("careers.example.test")).toBeInTheDocument();
  expect(screen.getByLabelText("覆盖渠道：社招")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /登记/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "立即同步" })).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "启用示例科技" }));
  await waitFor(() => expect(api.setPoolSourceEnabled).toHaveBeenCalledWith(source, true));
  expect(api.listPoolSources).toHaveBeenCalledTimes(2);
});

it("filters by enabled tab, status, channel and keyword", async () => {
  const other: PoolSource = { ...source, id: "11", company_id: "21", company_name: "示例制造", is_enabled: true, sync_status: "succeeded", last_complete_at: "2026-01-01T00:00:00Z", supported_channels: ["campus"], careers_url: "https://jobs.example.test/" };
  vi.mocked(api.listPoolSources).mockResolvedValue({ items: [source, other], sync_enabled: true });
  render(<JobPoolPanel />);
  await screen.findByText("示例制造");
  fireEvent.click(screen.getByRole("tab", { name: /已启用/ }));
  expect(screen.queryByText("示例科技")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /全部/ }));
  fireEvent.change(screen.getByLabelText("搜索企业名称 / 招聘来源"), { target: { value: "jobs.example" } });
  expect(screen.getByText("示例制造")).toBeInTheDocument();
  expect(screen.queryByText("示例科技")).not.toBeInTheDocument();
  expect(screen.getByText("共 1 个来源 · 每页 10 个")).toBeInTheDocument();
});

it("keeps sync unavailable when the global switch is off", async () => {
  vi.mocked(api.listPoolSources).mockResolvedValue({ items: [{ ...source, is_enabled: true }], sync_enabled: false });
  render(<JobPoolPanel />);
  expect(await screen.findByRole("button", { name: "立即同步" })).toBeDisabled();
  expect(screen.getByText(/后台同步已在环境配置中关闭/)).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "停用示例科技" })).toBeEnabled();
});

it("confirms a complete anomalous result only from the source detail", async () => {
  const anomalous: PoolSource = { ...source, is_enabled: true, sync_status: "anomalous", last_sync_result: { baseline_count: 100, latest: { generation: "3", observed_count: 10, counts: { created: 0, updated: 10, missing: 0, restored: 0, closed: 0, invalid: 0 }, is_complete: true, is_reviewed: false, error_code: "JOB_SOURCE_COUNT_DROP", finished_at: "2026-01-01T00:00:00Z" } } };
  vi.mocked(api.listPoolSources).mockResolvedValue({ items: [anomalous], sync_enabled: true });
  render(<JobPoolPanel />);
  expect(await screen.findByText("数量异常 · 待确认")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认并处理下线" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("row", { name: "查看示例科技的同步结果" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/100 → 10/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认并处理下线" }));
  await waitFor(() => expect(api.acceptPoolSync).toHaveBeenCalledWith(anomalous));
});

it("shows partial sync counts and a never-synced explanation in the detail", async () => {
  const partial: PoolSource = { ...source, is_enabled: true, sync_status: "partial", last_sync_result: { latest: { generation: "3", observed_count: 12, counts: { created: 3, updated: 9, missing: 0, restored: 0, closed: 0, invalid: 2, filtered: 30 }, is_complete: false, is_reviewed: false, error_code: "JOB_SOURCE_PARTIAL", finished_at: "2026-01-01T00:00:00Z" } } };
  vi.mocked(api.listPoolSources).mockResolvedValue({ items: [partial, { ...source, id: "12", company_name: "示例新企业" }], sync_enabled: true });
  render(<JobPoolPanel />);
  fireEvent.click(await screen.findByRole("row", { name: "查看示例科技的同步结果" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/本轮不判断下线/)).toBeInTheDocument();
  expect(within(dialog).getByText("12")).toBeInTheDocument();
  expect(within(dialog).getByText("范围外").nextElementSibling).toHaveTextContent("30");
  expect(within(dialog).queryByRole("button", { name: "确认并处理下线" })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("row", { name: "查看示例新企业的同步结果" }));
  expect(await screen.findByText(/还没有同步记录/)).toBeInTheDocument();
  expect(screen.getByText("尚未同步过")).toBeInTheDocument();
});

it("refreshes a stale generation and retries with the new one", async () => {
  const refreshed = { ...source, sync_generation: "4" };
  vi.mocked(api.listPoolSources).mockResolvedValueOnce({ items: [source], sync_enabled: true }).mockResolvedValue({ items: [refreshed], sync_enabled: true });
  vi.mocked(api.setPoolSourceEnabled).mockRejectedValueOnce(new ApiRequestError(409, "JOB_SOURCE_CONFLICT"));
  render(<JobPoolPanel />);
  fireEvent.click(await screen.findByRole("switch", { name: "启用示例科技" }));
  expect(await screen.findByText("来源已被更新，请刷新后重试。")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("switch", { name: "启用示例科技" })).toBeEnabled());
  fireEvent.click(screen.getByRole("switch", { name: "启用示例科技" }));
  await waitFor(() => expect(api.setPoolSourceEnabled).toHaveBeenLastCalledWith(refreshed, true));
});
