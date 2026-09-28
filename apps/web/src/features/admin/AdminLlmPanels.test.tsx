import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type LlmBinding, type LlmConnection, type LlmModel, type LlmRoute } from "../../api/client";
import { LogsPanel, ModelsPanel } from "./AdminLlmPanels";

const connection: LlmConnection = { id: "1", providerCode: "aihubmix", name: "主连接", settings: {}, keyConfigured: true, enabled: true, runtimeConfigVersion: 1, catalogSyncedAt: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };
const model: LlmModel = { id: "2", displayName: "示例模型", developerName: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };
const route: LlmRoute = { id: "3", modelId: "2", connectionId: "1", targetKind: "model", invokeTarget: "vendor/model", catalogModelId: "vendor/model", identifierKind: "unknown", origin: "catalog", metadata: null, pricing: null, targetAvailable: true, enabled: false, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };
const binding: LlmBinding = { useCase: "assistant_conversation", routeId: "3", protocolCode: "openai_chat", priority: 100, enabled: false, validatedAt: null, effective: false };

beforeEach(() => {
  vi.spyOn(api, "getLlmCatalog").mockResolvedValue({ useCases: ["assistant_conversation"], providers: [{ code: "aihubmix", label: "AIHubMix", protocols: ["openai_chat"], targetKinds: ["model"], catalogSync: true }] });
  vi.spyOn(api, "listLlmConnections").mockResolvedValue({ connections: [connection] });
  vi.spyOn(api, "listLlmModels").mockResolvedValue({ models: [model] });
  vi.spyOn(api, "listLlmRoutes").mockResolvedValue({ routes: [route] });
  vi.spyOn(api, "listLlmBindings").mockResolvedValue({ bindings: [binding] });
});
afterEach(() => vi.restoreAllMocks());

describe("ModelsPanel", () => {
  it("shows provider, logical model, route and conversation binding", async () => {
    render(<ModelsPanel onSessionExpired={vi.fn()} notify={vi.fn()} />);
    expect((await screen.findAllByText("主连接")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("示例模型").length).toBeGreaterThan(0);
    expect(screen.getAllByText("vendor/model").length).toBeGreaterThan(0);
    expect(screen.getAllByText("用户对话").length).toBeGreaterThan(0);
  });

  it("requires a probe before enabling a binding", async () => {
    const probe = vi.spyOn(api, "probeLlmBinding").mockResolvedValue({ callId: "probe-1", validated: true });
    render(<ModelsPanel onSessionExpired={vi.fn()} notify={vi.fn()} />);
    await screen.findAllByText("主连接");
    fireEvent.click(screen.getByRole("button", { name: "探测" }));
    await waitFor(() => expect(probe).toHaveBeenCalledWith("assistant_conversation", "3"));
  });

  it("switches an AIHubMix connection to the allowlisted alternate endpoint", async () => {
    const update = vi.spyOn(api, "updateLlmConnection").mockResolvedValue({ connection });
    render(<ModelsPanel onSessionExpired={vi.fn()} notify={vi.fn()} />);
    await screen.findAllByText("主连接");
    fireEvent.click(screen.getByRole("button", { name: "使用备用地址" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("1", {
      baseVersion: 1, settings: { endpoint: "alternate" },
    }));
  });

  it("updates the route priority used for failover", async () => {
    const update = vi.spyOn(api, "updateLlmBinding").mockResolvedValue({ binding });
    render(<ModelsPanel onSessionExpired={vi.fn()} notify={vi.fn()} />);
    const input = await screen.findByRole("spinbutton", { name: "线路 3 优先级" });
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("assistant_conversation", "3", { priority: 50 }));
  });
});

describe("LogsPanel", () => {
  it("shows the route and cost currency of a model call", async () => {
    vi.spyOn(api, "listLlmCalls").mockResolvedValue({ calls: [{ id: "1", callId: "call-1", useCase: "assistant_conversation", source: "pi_agent", userId: "10", agentRunId: "20", routeId: "3", protocolCode: "openai_chat", status: "succeeded", meteringStatus: "complete", inputTokens: 12, outputTokens: 5, estimatedCost: "0.0001", costCurrency: "USD", errorCode: null, createdAt: "2026-09-01T00:00:00Z" }], nextCursor: null, summary: { callCount: 1 } });
    render(<LogsPanel onSessionExpired={vi.fn()} notify={vi.fn()} />);
    expect(await screen.findByText("call-1")).toBeInTheDocument();
    expect(screen.getByText("0.0001 USD")).toBeInTheDocument();
  });
});
