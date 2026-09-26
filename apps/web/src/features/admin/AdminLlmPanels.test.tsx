import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiRequestError,
  ChatCapability,
  LlmCallRecord,
  LlmModelConfig,
  LlmProvider,
  LlmProviderModel,
  ModelCapabilityRecord,
} from "../../api/client";
import { LogsPanel, ModelsPanel } from "./AdminLlmPanels";

const provider: LlmProvider = {
  id: "3",
  name: "aihubmix",
  baseUrl: "https://aihubmix.com/v1",
  keyConfigured: true,
  modelCatalogUrl: "https://aihubmix.com/api/v1/models",
  modelCount: 2,
  priceSyncStatus: "succeeded",
  priceSyncError: null,
  priceSyncedAt: "2026-09-26T01:00:00Z",
  version: 1,
};

const catalogModels: LlmProviderModel[] = [
  {
    modelId: "z-ai/glm-4.6",
    displayName: "GLM 4.6",
    contextLength: 200000,
    maxOutput: 32768,
    inputModalities: "text",
    supportsReasoning: true,
    inputPricePerMillion: "0.60000000",
    outputPricePerMillion: "2.20000000",
  },
  {
    modelId: "moonshotai/kimi-k2",
    displayName: "Kimi K2",
    contextLength: 256000,
    maxOutput: 32768,
    inputModalities: "text",
    supportsReasoning: false,
    inputPricePerMillion: "0.40000000",
    outputPricePerMillion: "1.60000000",
  },
];

const model: LlmModelConfig = {
  id: "7",
  capability: "chat",
  provider: { id: "3", name: "aihubmix" },
  model: "z-ai/glm-4.6",
  keyConfigured: true,
  active: true,
  lastTest: {
    status: "succeeded",
    callId: "llmcall_previous_test",
    testedAt: "2026-07-30T01:30:00Z",
  },
  createdAt: "2026-07-30T01:00:00Z",
  updatedAt: "2026-07-30T01:00:00Z",
};

function capability(models: LlmModelConfig[] = [model]): ChatCapability {
  const activeModel = models.find((item) => item.active) ?? null;
  return {
    capability: "chat",
    activeModelId: activeModel?.id ?? null,
    activeModel,
    models,
  };
}

const call: LlmCallRecord = {
  callId: "llmcall_fictional",
  capability: "chat",
  source: "resume_editor",
  userId: "12",
  modelConfigId: "7",
  adapter: null,
  model: "z-ai/glm-4.6",
  status: "succeeded",
  meteringStatus: "complete",
  inputTokens: 120,
  outputTokens: 45,
  inputPricePerMillion: "0.60000000",
  outputPricePerMillion: "2.20000000",
  estimatedCostUsd: "0.00017100",
  latencyMs: 845,
  errorCode: null,
  createdAt: "2026-07-30T02:00:00Z",
};

const emptyCalls = {
  calls: [],
  summary: {
    callCount: 0,
    incompleteMeteringCount: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
  },
  nextCursor: null,
};

function mockModels(
  nextCapability = capability(),
  providers: LlmProvider[] = [provider],
) {
  vi.spyOn(api, "getChatCapability").mockResolvedValue(nextCapability);
  vi.spyOn(api, "getLlmProviders").mockResolvedValue({ providers });
  vi.spyOn(api, "listLlmProviderModels").mockResolvedValue({
    models: catalogModels,
    nextCursor: null,
  });
}

const renderModels = () =>
  render(<ModelsPanel notify={vi.fn()} onSessionExpired={vi.fn()} />);

const renderLogs = () =>
  render(<LogsPanel notify={vi.fn()} onSessionExpired={vi.fn()} />);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelsPanel", () => {
  it("展示供应商与它的同步状态，而不是逐个模型的接入类型", async () => {
    mockModels();

    renderModels();

    expect(await screen.findByText("模型供应商")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 aihubmix" })).toBeInTheDocument();
    expect(screen.getByText("https://aihubmix.com/v1")).toBeInTheDocument();
    expect(screen.getByText(/目录已同步 2 个模型/)).toBeInTheDocument();
    // 模型卡片展示供应商归属与继承关系，不再展示接入类型枚举。
    expect(screen.getByText("继承 aihubmix 的地址与凭据")).toBeInTheDocument();
    expect(screen.queryByText(/deepseek|dashscope|openai/)).not.toBeInTheDocument();
  });

  it("新增供应商并提交名称、地址、目录地址与凭据", async () => {
    mockModels(capability([]), []);
    const create = vi.spyOn(api, "createLlmProvider").mockResolvedValue({
      provider: { ...provider, modelCount: 0, priceSyncStatus: "unknown", priceSyncedAt: null },
    });

    renderModels();
    await screen.findByText("还没有接入供应商");
    fireEvent.click(screen.getAllByRole("button", { name: "新增供应商" })[0]);
    expect(screen.getByRole("dialog", { name: "新增供应商" })).toHaveClass("llm-modal");

    fireEvent.change(screen.getByLabelText(/供应商名称/), {
      target: { value: "aihubmix" },
    });
    fireEvent.change(screen.getByLabelText(/模型调用地址/), {
      target: { value: "https://aihubmix.com/v1" },
    });
    fireEvent.change(screen.getByLabelText(/模型目录地址/), {
      target: { value: "https://aihubmix.com/api/v1/models" },
    });
    fireEvent.change(screen.getByLabelText(/API Key/), {
      target: { value: "fictional-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: "aihubmix",
        baseUrl: "https://aihubmix.com/v1",
        modelCatalogUrl: "https://aihubmix.com/api/v1/models",
        apiKey: "fictional-secret",
      }),
    );
  });

  it("同步目录并把结果通知管理员", async () => {
    mockModels();
    const sync = vi.spyOn(api, "syncLlmProviderCatalog").mockResolvedValue({
      syncedAt: "2026-09-26T02:00:00Z",
      modelCount: 42,
    });
    const notify = vi.fn();

    render(<ModelsPanel notify={notify} onSessionExpired={vi.fn()} />);
    await screen.findByRole("button", { name: "同步目录" });
    fireEvent.click(screen.getByRole("button", { name: "同步目录" }));

    await waitFor(() => expect(sync).toHaveBeenCalledWith("3"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("aihubmix 目录已同步 42 个模型。"),
    );
  });

  it("展示同步失败的原因且仍保留上一次目录", async () => {
    mockModels(capability(), [
      {
        ...provider,
        priceSyncStatus: "failed",
        priceSyncError: "LLM_PROVIDER_CATALOG_INVALID",
      },
    ]);

    renderModels();

    expect(
      await screen.findByText(/目录同步失败（LLM_PROVIDER_CATALOG_INVALID）/),
    ).toBeInTheDocument();
  });

  it("从目录中挂载模型并提交供应商与模型标识", async () => {
    mockModels(capability([]));
    const create = vi.spyOn(api, "createLlmModel").mockResolvedValue({
      model: { ...model, active: false },
    });

    renderModels();
    await screen.findByText("还没有挂载任何模型");
    fireEvent.click(screen.getAllByRole("button", { name: "挂载模型" })[0]);
    expect(screen.getByRole("dialog", { name: "挂载模型" })).toHaveClass("llm-modal");

    // 目录中的模型来自供应商同步结果，不是手填的。
    await screen.findByRole("option", { name: /z-ai\/glm-4\.6/ });
    fireEvent.change(screen.getByRole("combobox", { name: /^模型/ }), {
      target: { value: "z-ai/glm-4.6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        providerId: "3",
        model: "z-ai/glm-4.6",
      }),
    );
  });

  it("目录里没有该供应商时提示先接入供应商", async () => {
    mockModels(capability([]), []);

    renderModels();

    expect(await screen.findByText("还没有接入供应商")).toBeInTheDocument();
    expect(
      screen.getByText("先新增一个供应商并同步它的模型目录，然后从目录中挂载模型。"),
    ).toBeInTheDocument();
  });

  it("opens Chat binding settings from the capability card instead of editing the model", async () => {
    mockModels();

    renderModels();

    const chatCard = await screen.findByRole("button", { name: /Chat/ });
    expect(chatCard).toHaveTextContent("已绑定 aihubmix / z-ai/glm-4.6");
    expect(screen.getByText("已绑定", { selector: ".enabled-pill" })).toBeInTheDocument();
    expect(screen.queryByText(/优先级|输入价格|输出价格/)).not.toBeInTheDocument();

    fireEvent.click(chatCard);
    expect(screen.getByRole("heading", { name: "设置 Chat" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "设置 Chat" })).toHaveClass("llm-modal");
    expect(screen.getByRole("radio", { name: /aihubmix \/ z-ai\/glm-4\.6/ })).toBeChecked();
  });

  it("展示 JD 图片解析能力并可打开独立绑定设置", async () => {
    mockModels();
    const visualCapability: ModelCapabilityRecord = {
      capability: "job_image_structuring",
      activeModelId: null,
      activeModel: null,
      bindingVersion: 1,
      models: [{ ...model, configVersion: 1, activeCapabilities: ["chat"] }],
    };
    vi.spyOn(api, "getModelCapabilities").mockResolvedValue({
      capabilities: [visualCapability],
    });

    renderModels();

    const visualCard = await screen.findByRole("button", { name: /JD 图片解析/ });
    expect(visualCard).toHaveTextContent("尚未绑定模型");
    fireEvent.click(visualCard);
    expect(
      screen.getByRole("dialog", { name: "设置 JD 图片解析" }),
    ).toBeInTheDocument();
  });

  it("shows a retryable load error and then the true empty state", async () => {
    vi.spyOn(api, "getChatCapability")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(capability([]));
    vi.spyOn(api, "getLlmProviders").mockResolvedValue({ providers: [provider] });
    vi.spyOn(api, "listLlmProviderModels").mockResolvedValue({
      models: catalogModels,
      nextCursor: null,
    });

    renderModels();

    expect(await screen.findByRole("alert")).toHaveTextContent("模型配置加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("还没有挂载任何模型")).toBeInTheDocument();
  });

  it("changes the mounted model through the catalog only", async () => {
    mockModels();
    const update = vi.spyOn(api, "updateLlmModel").mockResolvedValue({
      model: { ...model, model: "moonshotai/kimi-k2" },
      validationCallId: null,
    });

    renderModels();
    await screen.findByText("z-ai/glm-4.6", { selector: "h3" });
    fireEvent.click(screen.getByRole("button", { name: "编辑 z-ai/glm-4.6" }));
    // The options come from the provider catalog, so wait for the load.
    await screen.findByRole("option", { name: /moonshotai\/kimi-k2/ });
    fireEvent.change(screen.getByRole("combobox", { name: /^模型/ }), {
      target: { value: "moonshotai/kimi-k2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("7", { model: "moonshotai/kimi-k2" }),
    );
  });

  it("surfaces the unknown-model error when the catalog does not contain the choice", async () => {
    mockModels(capability([]));
    vi.spyOn(api, "createLlmModel").mockRejectedValue(
      new ApiRequestError(400, "LLM_PROVIDER_MODEL_UNKNOWN"),
    );

    renderModels();
    await screen.findByText("还没有挂载任何模型");
    fireEvent.click(screen.getAllByRole("button", { name: "挂载模型" })[0]);
    await screen.findByRole("option", { name: /z-ai\/glm-4\.6/ });
    fireEvent.change(screen.getByRole("combobox", { name: /^模型/ }), {
      target: { value: "z-ai/glm-4.6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "所选模型不在该供应商已同步的目录中",
    );
  });

  it("tests a model from the model list and binds it from Chat settings", async () => {
    const candidate = { ...model, id: "8", active: false, lastTest: null };
    mockModels(capability([candidate]));
    vi.spyOn(api, "testLlmModel").mockResolvedValue({
      ok: true,
      callId: "llmcall_test_1",
    });
    const bind = vi.spyOn(api, "bindChatModel").mockResolvedValue({
      activeModel: { ...candidate, active: true },
      callId: "llmcall_activate_1",
    });

    renderModels();
    await screen.findByText("z-ai/glm-4.6", { selector: "h3" });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText(/llmcall_test_1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Chat/ }));
    fireEvent.click(screen.getByRole("radio", { name: /aihubmix \/ z-ai\/glm-4\.6/ }));
    fireEvent.click(screen.getByRole("button", { name: "测试并绑定" }));
    await waitFor(() => expect(bind).toHaveBeenCalledWith("8"));
  });

  it("keeps Chat settings open and shows the backend callId when binding fails", async () => {
    const candidate = { ...model, id: "8", active: false, lastTest: null };
    mockModels(capability([candidate]));
    vi.spyOn(api, "bindChatModel").mockRejectedValue(
      new ApiRequestError(502, "LLM_CONNECTION_FAILED", {
        callId: "llmcall_bind_failed",
      }),
    );

    renderModels();
    fireEvent.click(await screen.findByRole("button", { name: /Chat/ }));
    fireEvent.click(screen.getByRole("radio", { name: /aihubmix \/ z-ai\/glm-4\.6/ }));
    fireEvent.click(screen.getByRole("button", { name: "测试并绑定" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("llmcall_bind_failed");
    expect(screen.getByRole("heading", { name: "设置 Chat" })).toBeInTheDocument();
  });

  it("shows the backend callId when a connection test fails", async () => {
    mockModels(capability([{ ...model, active: false }]));
    vi.spyOn(api, "testLlmModel").mockRejectedValue(
      new ApiRequestError(502, "LLM_CONNECTION_FAILED", {
        callId: "llmcall_failed_1",
      }),
    );

    renderModels();
    await screen.findByText("z-ai/glm-4.6", { selector: "h3" });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("llmcall_failed_1");
  });

  it("confirms model deletion, refreshes the list and reports success", async () => {
    const candidate = { ...model, active: false, lastTest: null };
    mockModels(capability([candidate]));
    const remove = vi.spyOn(api, "deleteLlmModel").mockResolvedValue(undefined);
    const notify = vi.fn();

    render(<ModelsPanel notify={notify} onSessionExpired={vi.fn()} />);
    await screen.findByText("z-ai/glm-4.6", { selector: "h3" });
    fireEvent.click(screen.getByRole("button", { name: "删除 z-ai/glm-4.6" }));

    expect(screen.getByRole("alertdialog", { name: "删除模型？" })).toHaveTextContent(
      "aihubmix / z-ai/glm-4.6",
    );
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("7"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith("已删除 aihubmix / z-ai/glm-4.6。"),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the delete dialog open when the model is bound to a capability", async () => {
    const candidate = { ...model, active: false, lastTest: null };
    mockModels(capability([candidate]));
    vi.spyOn(api, "deleteLlmModel").mockRejectedValue(
      new ApiRequestError(409, "LLM_MODEL_IN_USE"),
    );

    renderModels();
    await screen.findByText("z-ai/glm-4.6", { selector: "h3" });
    fireEvent.click(screen.getByRole("button", { name: "删除 z-ai/glm-4.6" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请先切换对应能力的绑定");
    expect(screen.getByRole("alertdialog", { name: "删除模型？" })).toBeInTheDocument();
  });

  it("keeps the provider delete dialog open while models still reference it", async () => {
    mockModels();
    vi.spyOn(api, "deleteLlmProvider").mockRejectedValue(
      new ApiRequestError(409, "LLM_PROVIDER_IN_USE"),
    );

    renderModels();
    await screen.findByRole("button", { name: "删除 aihubmix" });
    fireEvent.click(screen.getByRole("button", { name: "删除 aihubmix" }));

    expect(screen.getByRole("alertdialog", { name: "删除供应商？" })).toHaveTextContent(
      "仍有模型挂在该供应商下时无法删除",
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "仍有模型挂在该供应商下，请先删除这些模型",
    );
    expect(
      screen.getByRole("alertdialog", { name: "删除供应商？" }),
    ).toBeInTheDocument();
  });

  it("warns about affected bindings when a provider is edited", async () => {
    mockModels();
    vi.spyOn(api, "updateLlmProvider").mockResolvedValue({
      provider: { ...provider, version: 2 },
      affectedCapabilities: [
        { capability: "chat", modelConfigId: "7", model: "z-ai/glm-4.6" },
      ],
    });
    const notify = vi.fn();

    render(<ModelsPanel notify={notify} onSessionExpired={vi.fn()} />);
    await screen.findByRole("button", { name: "删除 aihubmix" });
    fireEvent.click(screen.getByRole("button", { name: "编辑 aihubmix" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "已更新供应商 aihubmix；受影响的绑定：Chat / z-ai/glm-4.6，请确认是否需要重新测试。",
      ),
    );
  });
});

describe("LogsPanel", () => {
  it("renders real Chat calls and submits source, model, user and call filters", async () => {
    vi.spyOn(api, "getChatCapability").mockResolvedValue(capability());
    const listCalls = vi
      .spyOn(api, "listLlmCalls")
      .mockResolvedValueOnce({
        calls: [call],
        summary: {
          callCount: 1,
          incompleteMeteringCount: 0,
          inputTokens: 120,
          outputTokens: 45,
          estimatedCostUsd: "0.00017100",
        },
        nextCursor: null,
      })
      .mockResolvedValueOnce(emptyCalls);

    renderLogs();

    expect(
      await screen.findByText("z-ai/glm-4.6", { selector: ".table-strong" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(
      screen.getByRole("dialog", { name: "筛选调用记录" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("调用来源"), {
      target: { value: "resume_editor" },
    });
    // 模型筛选展示供应商与模型标识，而不是接入类型。
    expect(
      screen.getByRole("option", { name: "aihubmix/z-ai/glm-4.6" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("实际模型"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("用户 ID"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("callId"), {
      target: { value: "llmcall_fictional" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2));
    expect(listCalls.mock.calls[1][0]).toMatchObject({
      source: "resume_editor",
      modelConfigId: "7",
      userId: "12",
      callId: "llmcall_fictional",
      limit: 50,
    });
  });

  it("supports manual refresh and cursor paging without realtime polling", async () => {
    vi.spyOn(api, "getChatCapability").mockResolvedValue(capability([]));
    const listCalls = vi
      .spyOn(api, "listLlmCalls")
      .mockResolvedValueOnce({ ...emptyCalls, nextCursor: "cursor-2" })
      .mockResolvedValueOnce(emptyCalls)
      .mockResolvedValueOnce(emptyCalls);

    renderLogs();
    expect(await screen.findByText("当前筛选下没有 LLM 调用记录")).toBeInTheDocument();
    expect(screen.queryByText("实时更新")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(listCalls).toHaveBeenCalledWith({ limit: 50, cursor: "cursor-2" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(3));
  });

  it("keeps a failed log request retryable", async () => {
    vi.spyOn(api, "getChatCapability").mockResolvedValue(capability([]));
    vi.spyOn(api, "listLlmCalls")
      .mockRejectedValueOnce(new ApiRequestError(400, "INVALID_LLM_CALL_QUERY"))
      .mockResolvedValueOnce(emptyCalls);

    renderLogs();
    expect(await screen.findByRole("alert")).toHaveTextContent("筛选条件不合法");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("当前筛选下没有 LLM 调用记录")).toBeInTheDocument();
  });
});
