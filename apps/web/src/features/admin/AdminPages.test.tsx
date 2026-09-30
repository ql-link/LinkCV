import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type AdminAnnouncement, type LlmBinding, type LlmCatalog, type LlmConnection, type LlmModel, type LlmRoute } from "../../api/client";
import { AnnouncementsPage } from "./AnnouncementsPage";
import { AdminConsoleProvider, insertionIndex, parseRecordSearch } from "./kit";
import { LlmCallsPage, countDelta } from "./SecurityPages";
import { CapabilitiesPage, planPriorities, previewOrder, type ModelGroup } from "./CapabilitiesPage";
import { ConnectionsPage, ModelsPage, compositionSlices, groupByVendor } from "./LlmPages";
import { SERIES_COLORS, donutArcs } from "./charts";
import { DateTimeInput, dayLabel } from "./DateTimeInput";
import { modelIcon, providerIcon, vendorIcon } from "./brandIcons";
import alibabaIcon from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg?url";
import gemmaIcon from "@lobehub/icons-static-svg/icons/gemma-color.svg?url";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg?url";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg?url";
import siliconIcon from "@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url";

const notify = vi.fn();
const wrap = (node: ReactNode) => <AdminConsoleProvider value={{ notify, onSessionExpired: vi.fn(), navigate: vi.fn() }}>{node}</AdminConsoleProvider>;
const stamp = "2026-09-29T01:00:00Z";

const catalog: LlmCatalog = {
  useCases: ["assistant_conversation", "resume_structuring"],
  providers: [
    { code: "aihubmix", label: "AIHubMix", protocols: ["openai_chat"], targetKinds: ["model"], catalogSync: true },
    { code: "aliyun", label: "阿里云百炼", protocols: ["openai_chat"], targetKinds: ["model", "deployment"], catalogSync: false },
  ],
};
const connection: LlmConnection = { id: "1", providerCode: "aihubmix", name: "生产主账号", settings: {}, keyConfigured: true, enabled: true, runtimeConfigVersion: 3, catalogSyncedAt: null, createdAt: stamp, updatedAt: stamp };
const model: LlmModel = { id: "5", displayName: "示例模型", developerName: "示例厂商", userSelectable: true, createdAt: stamp, updatedAt: stamp };
const route: LlmRoute = { id: "12", modelId: "5", connectionId: "1", targetKind: "model", invokeTarget: "vendor/sample-model", catalogModelId: null, identifierKind: "pinned", origin: "manual", metadata: null, pricing: { currency: "USD", input_per_million: "0.8", output_per_million: "4" }, targetAvailable: true, enabled: true, createdAt: stamp, updatedAt: stamp };

function mockLlm(overrides: { models?: LlmModel[]; routes?: LlmRoute[] } = {}) {
  vi.spyOn(api, "getLlmCatalog").mockResolvedValue(catalog);
  vi.spyOn(api, "listLlmConnections").mockResolvedValue({ connections: [connection] });
  vi.spyOn(api, "listLlmModels").mockResolvedValue({ models: overrides.models ?? [model] });
  vi.spyOn(api, "listLlmRoutes").mockResolvedValue({ routes: overrides.routes ?? [route] });
  vi.spyOn(api, "listLlmBindings").mockResolvedValue({ bindings: [{ useCase: "assistant_conversation", routeId: "12", protocolCode: "openai_chat", priority: 10, enabled: true, validatedAt: stamp, effective: true }] });
  const empty = { calls: 0, successRate: null, p95Ms: null, costs: [], unmeteredCallCount: 0 };
  vi.spyOn(api, "adminInsightLlmUsage").mockResolvedValue({ from: stamp, to: stamp, summary: empty, previous: empty, groups: [{ ...empty, key: "5", label: "示例模型", calls: 1234 }] });
}

beforeEach(() => notify.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("ConnectionsPage", () => {
  it("creates an Aliyun connection that needs a workspace in cn-beijing", async () => {
    mockLlm();
    const create = vi.spyOn(api, "createLlmConnection").mockResolvedValue({ connection });
    render(wrap(<ConnectionsPage />));
    fireEvent.click(await screen.findByRole("button", { name: "添加连接" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /阿里云百炼/ }));
    fireEvent.change(within(dialog).getByLabelText("连接名称"), { target: { value: "百炼 · 北京" } });
    fireEvent.change(within(dialog).getByLabelText("API Key"), { target: { value: "sk-test-value" } });
    const submit = within(dialog).getByRole("button", { name: "添加连接" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Workspace ID"), { target: { value: "ws-demo" } });
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledWith({ providerCode: "aliyun", name: "百炼 · 北京", apiKey: "sk-test-value", settings: { region: "cn-beijing", workspace_id: "ws-demo" } }));
  });

  it("explains why a referenced connection cannot be deleted", async () => {
    mockLlm();
    vi.spyOn(api, "deleteLlmConnection").mockRejectedValue(new ApiRequestError(409, "LLM_CONNECTION_IN_USE"));
    render(wrap(<ConnectionsPage />));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("连接下的线路仍被绑定或已有调用记录，不能删除", "error"));
  });
});

describe("parseRecordSearch", () => {
  it("reads digits as a user, UPPER_SNAKE as an error code and the rest as a record ID", () => {
    expect(parseRecordSearch(" 10284 ")).toEqual({ kind: "user", value: "10284" });
    expect(parseRecordSearch("AUTH_FAILED")).toEqual({ kind: "error", value: "AUTH_FAILED" });
    expect(parseRecordSearch("llmcall_4f2a")).toEqual({ kind: "id", value: "llmcall_4f2a" });
    expect(parseRecordSearch("  ")).toBeNull();
  });
});

describe("LlmCallsPage", () => {
  it("sends a pasted call ID as an exact filter", async () => {
    vi.spyOn(api, "listLlmRoutes").mockResolvedValue({ routes: [] });
    vi.spyOn(api, "listLlmModels").mockResolvedValue({ models: [] });
    vi.spyOn(api, "listLlmConnections").mockResolvedValue({ connections: [] });
    const list = vi.spyOn(api, "listLlmCalls").mockResolvedValue({ calls: [], nextCursor: null, summary: { callCount: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0, costs: [], unmeteredCallCount: 0 } });
    render(wrap(<LlmCallsPage />));
    const box = await screen.findByLabelText("调用 ID / 用户 ID / 错误码");
    fireEvent.change(box, { target: { value: "llmcall_demo" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ callId: "llmcall_demo", userId: undefined, errorCode: undefined })));
    fireEvent.change(box, { target: { value: "20931" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "20931", callId: undefined })));
  });
});

describe("countDelta", () => {
  it("marks more errors as bad and fewer as good", () => {
    expect(countDelta(18, 14)).toEqual({ note: "+4", tone: "bad" });
    expect(countDelta(10, 12)).toEqual({ note: "-2", tone: "ok" });
    expect(countDelta(3, 3)).toEqual({ note: "持平", tone: "muted" });
    expect(countDelta(3, undefined)).toEqual({});
  });
});

describe("groupByVendor", () => {
  const m = (id: string, developerName: string | null): LlmModel => ({ ...model, id, displayName: `模型 ${id}`, developerName });

  it("merges vendor aliases, orders by size and keeps unlabelled models last", () => {
    const groups = groupByVendor([m("1", null), m("2", "qwen"), m("3", "alibaba"), m("4", "openai"), m("5", ""), m("6", "Alibaba")]);
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([["阿里云 · 通义", 3], ["OpenAI", 1], ["未标注厂商", 2]]);
  });
});

describe("compositionSlices", () => {
  it("keeps colours on entities and folds the tail into 其他", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"].map((key, index) => ({ key, calls: 70 - index * 10 }));
    const colorOf = new Map(items.slice(0, 5).map((item, index) => [item.key, SERIES_COLORS[index]]));
    const slices = compositionSlices(items, (item) => item.calls, (item) => item.key, colorOf);
    expect(slices.map((slice) => slice.key)).toEqual(["a", "b", "c", "d", "e", "__other"]);
    expect(slices[slices.length - 1]).toMatchObject({ label: "其他", value: 30 });
    // Re-sorting by another measure must not repaint an entity.
    const byCost = compositionSlices(items, (item) => (item.key === "e" ? 999 : item.calls), (item) => item.key, colorOf);
    expect(byCost[0]).toMatchObject({ key: "e", color: SERIES_COLORS[4] });
  });
});

describe("donutArcs", () => {
  it("skips empty slices and draws a lone slice as a full ring", () => {
    expect(donutArcs([0, 5])[0]).toBeNull();
    const [start, end] = donutArcs([0, 5])[1]!;
    expect(end - start).toBeGreaterThan(Math.PI * 1.99);
  });
});

describe("ModelsPage", () => {
  it("groups routes under their model and shows the price", async () => {
    mockLlm();
    render(wrap(<ModelsPage />));
    // The list groups models by vendor; the first model opens in the detail pane.
    const vendor = await screen.findByRole("button", { name: /示例厂商/ });
    expect(vendor).toHaveAttribute("aria-expanded", "true");
    const detail = screen.getByRole("region", { name: "示例模型 详情" });
    expect(within(detail).getByText("vendor/sample-model")).toBeInTheDocument();
    expect(within(detail).getByText(/\$0\.80 \/ \$4\.00/)).toBeInTheDocument();
    expect(within(detail).getByText("用户可选")).toBeInTheDocument();
    expect(await within(detail).findByText("1,234")).toBeInTheDocument();
  });

  it("hides a model from users through the edit modal", async () => {
    mockLlm();
    const update = vi.spyOn(api, "updateLlmModel").mockResolvedValue({ model: { ...model, userSelectable: false } });
    render(wrap(<ModelsPage />));
    fireEvent.click(await screen.findByRole("button", { name: /^编辑模型/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: "用户可选" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("5", { displayName: "示例模型", developerName: "示例厂商", userSelectable: false }));
  });

  it("rejects half-filled pricing when adding a route", async () => {
    mockLlm({ routes: [] });
    const create = vi.spyOn(api, "createLlmRoute").mockResolvedValue({ route });
    render(wrap(<ModelsPage />));
    fireEvent.click((await screen.findAllByRole("button", { name: "添加线路" }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("调用目标 ID"), { target: { value: "vendor/new" } });
    fireEvent.change(within(dialog).getByLabelText("输入单价 / 百万 Token"), { target: { value: "1" } });
    expect(within(dialog).getByText("输入和输出单价需要同时填写")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "添加线路" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("输出单价 / 百万 Token"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加线路" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ modelId: 5, connectionId: 1, invokeTarget: "vendor/new", pricing: { currency: "USD", input_per_million: "1", output_per_million: "2" } })));
  });

  it("deletes an unused route after confirmation", async () => {
    mockLlm();
    const remove = vi.spyOn(api, "deleteLlmRoute").mockResolvedValue(undefined);
    render(wrap(<ModelsPage />));
    await screen.findByText("vendor/sample-model");
    const routeRow = screen.getByText("vendor/sample-model").closest("[role=row]") as HTMLElement;
    fireEvent.click(within(routeRow).getByRole("button", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("12"));
    expect(notify).toHaveBeenCalledWith("线路已删除");
  });
});

describe("planPriorities", () => {
  const b = (routeId: string, priority: number): LlmBinding => ({ useCase: "assistant_conversation", routeId, protocolCode: "openai_chat", priority, enabled: true, validatedAt: stamp, effective: true });
  const group = (modelId: string, ...bindings: LlmBinding[]): ModelGroup => ({ model: undefined, modelId, bindings });

  it("keeps rows that already sit on their slot and parks the rest above every value", () => {
    // Model B moves in front of model A; A's two routes stay together behind it.
    const plan = planPriorities([group("B", b("3", 30)), group("A", b("1", 10), b("2", 20))]);
    expect(plan.place).toEqual([{ routeId: "3", priority: 10 }, { routeId: "1", priority: 20 }, { routeId: "2", priority: 30 }]);
    expect(plan.park.map((step) => step.routeId)).toEqual(["3", "1", "2"]);
    expect(Math.min(...plan.park.map((step) => step.priority))).toBeGreaterThan(30);
  });

  it("never lets two rows share a priority at any step", () => {
    const start = [b("1", 10), b("2", 20), b("3", 30), b("4", 40)];
    const plan = planPriorities([group("X", start[3], start[0]), group("Y", start[2], start[1])]);
    const current = new Map(start.map((item) => [item.routeId, item.priority]));
    for (const step of [...plan.park, ...plan.place]) {
      current.set(step.routeId, step.priority);
      expect(new Set(current.values()).size).toBe(current.size);
    }
    expect([...current.values()].sort((x, y) => x - y)).toEqual([10, 20, 30, 40]);
  });

  it("does nothing when the order is unchanged", () => {
    expect(planPriorities([group("A", b("1", 10), b("2", 20))])).toEqual({ park: [], place: [] });
  });
});

describe("drag preview", () => {
  const b = (routeId: string, priority: number): LlmBinding => ({ useCase: "assistant_conversation", routeId, protocolCode: "openai_chat", priority, enabled: true, validatedAt: stamp, effective: true });
  const groups: ModelGroup[] = [
    { model: undefined, modelId: "A", bindings: [b("1", 10), b("2", 20)] },
    { model: undefined, modelId: "B", bindings: [b("3", 30)] },
  ];

  it("counts the item middles above the pointer as the insertion index", () => {
    expect(insertionIndex([50, 150, 250], 10)).toBe(0);
    expect(insertionIndex([50, 150, 250], 160)).toBe(2);
    expect(insertionIndex([50, 150, 250], 999)).toBe(3);
  });

  it("shows the dragged model or route at its prospective slot", () => {
    expect(previewOrder(groups, null)).toBe(groups);
    expect(previewOrder(groups, { kind: "model", id: "B", to: 0 }).map((group) => group.modelId)).toEqual(["B", "A"]);
    expect(previewOrder(groups, { kind: "route", group: "A", id: "2", to: 0 })[0].bindings.map((item) => item.routeId)).toEqual(["2", "1"]);
  });
});

describe("CapabilitiesPage", () => {
  it("groups bindings by model and marks the resolver default", async () => {
    mockLlm();
    render(wrap(<CapabilitiesPage />));
    expect(await screen.findByText("1 个模型 · 1 条线路 · 1 条生效")).toBeInTheDocument();
    const lanes = screen.getByRole("list", { name: /模型顺序/ });
    const card = within(lanes).getByText("示例模型").closest("li") as HTMLElement;
    expect(within(card).getByText("默认")).toBeInTheDocument();
    expect(within(card).getByText("主")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^简历结构化/ }));
    expect(await screen.findByText("这个场景还没有模型")).toBeInTheDocument();
  });

  it("skips a hidden model when choosing the default for chat", async () => {
    const hidden: LlmModel = { ...model, id: "6", displayName: "隐藏模型", userSelectable: false };
    const hiddenRoute: LlmRoute = { ...route, id: "13", modelId: "6", invokeTarget: "vendor/hidden" };
    mockLlm({ models: [model, hidden], routes: [route, hiddenRoute] });
    vi.mocked(api.listLlmBindings).mockResolvedValue({ bindings: [
      { useCase: "assistant_conversation", routeId: "13", protocolCode: "openai_chat", priority: 5, enabled: true, validatedAt: stamp, effective: true },
      { useCase: "assistant_conversation", routeId: "12", protocolCode: "openai_chat", priority: 10, enabled: true, validatedAt: stamp, effective: true },
    ] });
    render(wrap(<CapabilitiesPage />));
    const lanes = await screen.findByRole("list", { name: /模型顺序/ });
    const hiddenCard = within(lanes).getByText("隐藏模型").closest("li") as HTMLElement;
    expect(within(hiddenCard).getByText("对用户隐藏")).toBeInTheDocument();
    expect(within(hiddenCard).queryByText("默认")).not.toBeInTheDocument();
    expect(within(within(lanes).getByText("示例模型").closest("li") as HTMLElement).getByText("默认")).toBeInTheDocument();
    // The use-case list names the model the resolver would pick.
    expect(screen.getByRole("tab", { name: /用户对话.*示例模型/ })).toBeInTheDocument();
  });

  it("moves a model up with the keyboard and rewrites priorities without collisions", async () => {
    const second: LlmModel = { ...model, id: "6", displayName: "第二模型" };
    const secondRoute: LlmRoute = { ...route, id: "13", modelId: "6", invokeTarget: "vendor/second" };
    mockLlm({ models: [model, second], routes: [route, secondRoute] });
    vi.mocked(api.listLlmBindings).mockResolvedValue({ bindings: [
      { useCase: "assistant_conversation", routeId: "12", protocolCode: "openai_chat", priority: 10, enabled: true, validatedAt: stamp, effective: true },
      { useCase: "assistant_conversation", routeId: "13", protocolCode: "openai_chat", priority: 20, enabled: true, validatedAt: stamp, effective: true },
    ] });
    const update = vi.spyOn(api, "updateLlmBinding").mockResolvedValue({ binding: {} as LlmBinding });
    render(wrap(<CapabilitiesPage />));
    fireEvent.keyDown(await screen.findByRole("button", { name: /调整模型 第二模型 的顺序/ }), { key: "ArrowUp" });
    await waitFor(() => expect(notify).toHaveBeenCalledWith("顺序已保存"));
    const calls = update.mock.calls.map(([, routeId, body]) => [routeId, body.priority]);
    // Both rows are parked first, then placed: 13 → 10, 12 → 20.
    expect(calls.slice(-2)).toEqual([["13", 10], ["12", 20]]);
    expect(calls.slice(0, 2).every(([, priority]) => (priority as number) > 20)).toBe(true);
  });

  it("drags a model with a placeholder and saves only on drop", async () => {
    const second: LlmModel = { ...model, id: "6", displayName: "第二模型" };
    const secondRoute: LlmRoute = { ...route, id: "13", modelId: "6", invokeTarget: "vendor/second" };
    mockLlm({ models: [model, second], routes: [route, secondRoute] });
    vi.mocked(api.listLlmBindings).mockResolvedValue({ bindings: [
      { useCase: "assistant_conversation", routeId: "12", protocolCode: "openai_chat", priority: 10, enabled: true, validatedAt: stamp, effective: true },
      { useCase: "assistant_conversation", routeId: "13", protocolCode: "openai_chat", priority: 20, enabled: true, validatedAt: stamp, effective: true },
    ] });
    const update = vi.spyOn(api, "updateLlmBinding").mockResolvedValue({ binding: {} as LlmBinding });
    render(wrap(<CapabilitiesPage />));
    const grip = await screen.findByRole("button", { name: /调整模型 第二模型 的顺序/ });
    const list = screen.getByRole("list", { name: /模型顺序/ });
    fireEvent.dragStart(grip, { dataTransfer: { setData: vi.fn(), setDragImage: vi.fn() } });
    await waitFor(() => expect(list.querySelector(".is-placeholder")).not.toBeNull());
    // jsdom has no layout: every middle sits at 0, so a pointer above it targets slot 0.
    fireEvent.dragOver(list, { clientY: -10, dataTransfer: {} });
    await waitFor(() => expect(list.children[0].classList.contains("is-placeholder")).toBe(true));
    expect(update).not.toHaveBeenCalled();
    fireEvent.drop(list, { dataTransfer: {} });
    await waitFor(() => expect(notify).toHaveBeenCalledWith("顺序已保存"));
    expect(update.mock.calls.map(([, routeId, body]) => [routeId, body.priority]).slice(-2)).toEqual([["13", 10], ["12", 20]]);
    expect(list.querySelector(".is-placeholder")).toBeNull();
  });

  it("toggles user selectability from the model card", async () => {
    mockLlm();
    const updateModel = vi.spyOn(api, "updateLlmModel").mockResolvedValue({ model: { ...model, userSelectable: false } });
    render(wrap(<CapabilitiesPage />));
    fireEvent.click(await screen.findByRole("switch", { name: "示例模型 用户可选" }));
    await waitFor(() => expect(updateModel).toHaveBeenCalledWith("5", { userSelectable: false }));
  });

  it("adds an existing model with all of its enabled routes, disabled and after the last priority", async () => {
    const other: LlmModel = { ...model, id: "7", displayName: "另一个模型" };
    const r1: LlmRoute = { ...route, id: "21", modelId: "7", invokeTarget: "vendor/other-a" };
    const r2: LlmRoute = { ...route, id: "22", modelId: "7", invokeTarget: "vendor/other-b" };
    const r3: LlmRoute = { ...route, id: "23", modelId: "7", invokeTarget: "vendor/other-off", enabled: false };
    mockLlm({ models: [model, other], routes: [route, r1, r2, r3] });
    const put = vi.spyOn(api, "putLlmBinding").mockResolvedValue({ binding: {} as LlmBinding });
    render(wrap(<CapabilitiesPage />));
    fireEvent.click(await screen.findByRole("button", { name: "添加模型" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("搜索模型"), { target: { value: "另一个" } });
    fireEvent.click(within(dialog).getByRole("option", { name: /另一个模型/ }));
    expect(within(dialog).getByRole("checkbox", { name: /vendor\/other-off/ })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: /加入 2 条线路/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenNthCalledWith(1, "assistant_conversation", "21", { protocolCode: "openai_chat", priority: 20, enabled: false });
    expect(put).toHaveBeenNthCalledWith(2, "assistant_conversation", "22", { protocolCode: "openai_chat", priority: 30, enabled: false });
  });

  it("creates a new model with its first route and binds it", async () => {
    mockLlm();
    const createModel = vi.spyOn(api, "createLlmModel").mockResolvedValue({ model: { ...model, id: "9", displayName: "新模型" } });
    const createRoute = vi.spyOn(api, "createLlmRoute").mockResolvedValue({ route: { ...route, id: "40", modelId: "9" } });
    const put = vi.spyOn(api, "putLlmBinding").mockResolvedValue({ binding: {} as LlmBinding });
    render(wrap(<CapabilitiesPage />));
    fireEvent.click(await screen.findByRole("button", { name: "添加模型" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "新建模型" }));
    fireEvent.change(within(dialog).getByLabelText("模型名称"), { target: { value: "新模型" } });
    fireEvent.change(within(dialog).getByLabelText("调用目标 ID"), { target: { value: "vendor/new" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并加入" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("assistant_conversation", "40", { protocolCode: "openai_chat", priority: 20, enabled: false }));
    expect(createModel).toHaveBeenCalledWith({ displayName: "新模型", developerName: null, userSelectable: true });
    expect(createRoute).toHaveBeenCalledWith(expect.objectContaining({ modelId: 9, connectionId: 1, invokeTarget: "vendor/new", targetKind: "model" }));
  });

  it("removes a model from the use case by unbinding all its routes", async () => {
    mockLlm();
    const remove = vi.spyOn(api, "deleteLlmBinding").mockResolvedValue(undefined);
    render(wrap(<CapabilitiesPage />));
    // Low-frequency actions live in the model's "⋯" menu.
    fireEvent.keyDown(await screen.findByRole("button", { name: "示例模型 更多操作" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "移出场景" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "移除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("assistant_conversation", "12"));
    expect(notify).toHaveBeenCalledWith("模型已移出场景");
  });
});

describe("AnnouncementsPage", () => {
  const draft: AdminAnnouncement = { id: "7", level: "normal", title: "示例公告", body: "示例正文", status: "draft", visibility: "draft", startsAt: null, endsAt: null, publishedAt: null, unpublishedAt: null, createdBy: "1", publishedBy: null, unpublishedBy: null, createdAt: stamp, updatedAt: stamp };

  beforeEach(() => {
    vi.spyOn(api, "adminAnnouncementStats").mockResolvedValue({ draft: 1, published: 0, unpublished: 0, active: 0, scheduled: 0 });
  });

  it("creates and publishes an announcement in one step", async () => {
    const list = vi.spyOn(api, "adminListAnnouncements").mockResolvedValue({ items: [], nextCursor: null });
    const create = vi.spyOn(api, "adminCreateAnnouncement").mockResolvedValue({ announcement: draft });
    const publish = vi.spyOn(api, "adminPublishAnnouncement").mockResolvedValue({ announcement: { ...draft, status: "published", visibility: "active" } });
    render(wrap(<AnnouncementsPage />));
    fireEvent.click(await screen.findByRole("button", { name: "新建公告" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "示例公告" } });
    fireEvent.change(within(dialog).getByLabelText("正文"), { target: { value: "示例正文" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并发布" }));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("7"));
    expect(create).toHaveBeenCalledWith({ level: "normal", title: "示例公告", body: "示例正文", startsAt: null, endsAt: null });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("blocks an end time before the start time", async () => {
    vi.spyOn(api, "adminListAnnouncements").mockResolvedValue({ items: [], nextCursor: null });
    render(wrap(<AnnouncementsPage />));
    fireEvent.click(await screen.findByRole("button", { name: "新建公告" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "示例" } });
    fireEvent.change(within(dialog).getByLabelText("正文"), { target: { value: "示例" } });
    // Pick "next month, day 2" as the start and "next month, day 1" (defaults to 23:59) as the end.
    const next = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
    const pick = async (field: string, day: number) => {
      fireEvent.click(within(dialog).getByLabelText(field));
      const pop = await screen.findByRole("dialog", { name: `${field}选择器` });
      fireEvent.click(within(pop).getByRole("button", { name: "下个月" }));
      fireEvent.click(within(pop).getByRole("gridcell", { name: dayLabel(new Date(next.getFullYear(), next.getMonth(), day)) }));
      fireEvent.click(within(pop).getByRole("button", { name: "完成" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: `${field}选择器` })).not.toBeInTheDocument());
    };
    await pick("开始时间", 2);
    await pick("结束时间", 1);
    expect(within(dialog).getByText("结束时间必须晚于开始时间")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it("splits published announcements into live, scheduled and expired", async () => {
    vi.mocked(api.adminAnnouncementStats).mockResolvedValue({ draft: 3, published: 6, unpublished: 8, active: 2, scheduled: 1 });
    vi.spyOn(api, "adminListAnnouncements").mockResolvedValue({ items: [], nextCursor: null });
    render(wrap(<AnnouncementsPage />));
    const ribbon = await screen.findByRole("region", { name: "公告状态" });
    expect(ribbon).toHaveTextContent("生效中2定时1草稿3已下线11共 17 条");
  });

  it("offers only unpublish for a published announcement", async () => {
    vi.spyOn(api, "adminListAnnouncements").mockResolvedValue({ items: [{ ...draft, status: "published", visibility: "active", publishedAt: stamp }], nextCursor: null });
    const unpublish = vi.spyOn(api, "adminUnpublishAnnouncement").mockResolvedValue({ announcement: { ...draft, status: "unpublished", visibility: "unpublished" } });
    render(wrap(<AnnouncementsPage />));
    const row = (await screen.findByText("示例公告")).closest("li") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "下线" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认下线" }));
    await waitFor(() => expect(unpublish).toHaveBeenCalledWith("7"));
  });
});

describe("DateTimeInput", () => {
  it("keeps the datetime-local value shape and edits day, hour and minute", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<DateTimeInput label="开始时间" value="2026-03-10T08:05" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "开始时间" })).toHaveTextContent("2026-03-10 08:05");
    fireEvent.click(screen.getByRole("button", { name: "开始时间" }));
    const pop = await screen.findByRole("dialog", { name: "开始时间选择器" });
    expect(within(pop).getByText("2026 年 3 月")).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("gridcell", { name: "2026年3月12日" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-03-12T08:05");
    fireEvent.click(within(pop).getByRole("button", { name: "选择小时" }));
    fireEvent.click(within(within(pop).getByRole("listbox", { name: "小时" })).getByRole("option", { name: "17" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-03-10T17:05");
    // Picking an hour moves on to minutes; a 5-minute step closes back to the calendar.
    fireEvent.click(within(within(pop).getByRole("listbox", { name: "分钟" })).getByRole("option", { name: ":45" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-03-10T08:45");
    expect(within(pop).getByRole("grid")).toBeInTheDocument();
    // Exact minutes through the keyboard.
    fireEvent.keyDown(within(pop).getByRole("button", { name: "选择分钟" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("2026-03-10T08:06");
    fireEvent.click(within(pop).getByRole("button", { name: "清除" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    rerender(<DateTimeInput label="开始时间" value="" onChange={onChange} placeholder="不限" />);
    expect(screen.getByRole("button", { name: "开始时间" })).toHaveTextContent("不限");
  });

  it("uses the default time when a day is picked on an empty field", async () => {
    const onChange = vi.fn();
    render(<DateTimeInput label="结束时间" value="" onChange={onChange} defaultTime="23:59" />);
    fireEvent.click(screen.getByRole("button", { name: "结束时间" }));
    const pop = await screen.findByRole("dialog", { name: "结束时间选择器" });
    const today = new Date();
    fireEvent.click(within(pop).getByRole("gridcell", { name: dayLabel(today) }));
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}T23:59`;
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });
});

describe("brand icons", () => {
  it("prefers the model family, then the vendor, then nothing", () => {
    expect(modelIcon("openrouter/qwen/qwen3-8b", null)).toBe(qwenIcon);
    expect(modelIcon("gemma-3-27b-it", "google")).toBe(gemmaIcon);
    expect(modelIcon("示例模型", "openai")).toBe(openaiIcon);
    expect(modelIcon("示例模型", null)).toBeNull();
    expect(providerIcon("siliconflow")).toBe(siliconIcon);
    expect(providerIcon("unknown")).toBeNull();
    expect(vendorIcon("Alibaba")).toBe(alibabaIcon);
  });
});

describe("FunnelPage", () => {
  afterEach(() => vi.restoreAllMocks());

  const funnelData = {
    window: { from: "2026-08-30T00:00:00Z", to: "2026-09-30T00:00:00Z" },
    steps: [
      { key: "registered" as const, users: 200 },
      { key: "resume" as const, users: 120 },
      { key: "ai_customization" as const, users: 48 },
      { key: "mock_interview" as const, users: 10 },
      { key: "pdf_export" as const, users: 30 },
    ],
    registrationsByMethod: { wechat_qr: 150, email: 50 },
    aiCustomizationByEntry: { assistant: 30, editor: 18 },
    resumeBySource: { template: 90, import: 30 },
    daily: [{ date: "2026-09-29", registered: 7 }, { date: "2026-09-30", registered: 9 }],
  };

  it("chains the main steps with step-over-step loss and highlights the largest drop", async () => {
    const { FunnelPage } = await import("./FunnelPage");
    vi.spyOn(api, "adminInsightFunnel").mockResolvedValue(funnelData);
    const { container } = render(wrap(<FunnelPage />));
    const steps = await screen.findByRole("region", { name: "逐步转化" });
    const items = within(steps).getAllByRole("listitem").filter((item) => item.classList.contains("adm-funnel-step"));
    expect(items.map((item) => item.querySelector("strong")?.textContent)).toEqual(["注册", "有简历", "首次 AI 定制", "首次 PDF 导出", "模拟面试完成"]);
    const resume = items[1];
    expect(within(resume).getByText("60.0% 的注册用户")).toBeInTheDocument();
    expect(within(resume).getByText("↓ 60.0%")).toBeInTheDocument();
    expect(within(resume).getByText("流失 80 人")).toBeInTheDocument();
    // AI keeps 40% of resume users, the lowest rate in the chain; PDF export is compared with AI, not the interview.
    expect(items[2].querySelector(".adm-funnel-drop")).toHaveClass("is-worst");
    expect(within(items[3]).getByText("↓ 62.5%")).toBeInTheDocument();
    // The mock interview is optional: no step-over-step comparison.
    expect(items[4].querySelector(".adm-funnel-drop")).toBeNull();
    expect(within(items[4]).getByText("5.0% 的注册用户")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "注册方式：微信扫码 75.0%，邮箱 25.0%" })).toBeInTheDocument();
    expect(container.querySelectorAll(".adm-funnel-drop.is-worst")).toHaveLength(1);
    expect(api.adminInsightFunnel).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
  });

  it("explains the definitions from the header", async () => {
    const { FunnelPage } = await import("./FunnelPage");
    vi.spyOn(api, "adminInsightFunnel").mockResolvedValue(funnelData);
    render(wrap(<FunnelPage />));
    await screen.findByRole("region", { name: "逐步转化" });
    fireEvent.click(screen.getByRole("button", { name: "统计口径" }));
    expect(await screen.findByText(/复制与翻译来自已有简历，不计入/)).toBeInTheDocument();
  });

  it("offers a retry when the funnel cannot be loaded", async () => {
    const { FunnelPage } = await import("./FunnelPage");
    vi.spyOn(api, "adminInsightFunnel").mockRejectedValue(new ApiRequestError(503, "SERVICE_UNAVAILABLE"));
    render(wrap(<FunnelPage />));
    expect(await screen.findByText("无法读取转化漏斗")).toBeInTheDocument();
  });
});

describe("worstDrop", () => {
  it("picks the lowest step-over-step rate and ignores empty predecessors", async () => {
    const { worstDrop } = await import("./FunnelPage");
    expect(worstDrop([200, 120, 48, 30])).toBe(2);
    expect(worstDrop([0, 0, 0])).toBeNull();
    expect(worstDrop([10, 10])).toBeNull();
  });
});
