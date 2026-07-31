import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiRequestError,
  ChatCapability,
  ChatCatalog,
  LlmCallRecord,
  LlmModelConfig,
} from "../../api/client";
import { LogsPanel, ModelsPanel } from "./AdminLlmPanels";

const model: LlmModelConfig = {
  id: "7",
  capability: "chat",
  adapter: "deepseek",
  model: "deepseek-v4-flash",
  apiBase: null,
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

const catalog: ChatCatalog = {
  capability: "chat",
  adapters: [
    {
      code: "deepseek",
      label: "DeepSeek",
      requiresApiKey: true,
      models: ["deepseek-chat", "deepseek-v4-flash"],
    },
    {
      code: "openai",
      label: "OpenAI",
      requiresApiKey: true,
      models: ["gpt-4.1-mini"],
    },
    {
      code: "dashscope",
      label: "阿里云百炼（千问）",
      requiresApiKey: true,
      models: ["qwen-plus"],
    },
  ],
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
  adapter: "deepseek",
  model: "deepseek-v4-flash",
  status: "succeeded",
  meteringStatus: "complete",
  inputTokens: 120,
  outputTokens: 45,
  inputPricePerMillion: "0.40000000",
  outputPricePerMillion: "1.60000000",
  estimatedCostUsd: "0.00012000",
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

function mockModels(nextCapability = capability()) {
  vi.spyOn(api, "getChatCapability").mockResolvedValue(nextCapability);
  vi.spyOn(api, "getChatCatalog").mockResolvedValue(catalog);
}

const renderModels = () =>
  render(<ModelsPanel notify={vi.fn()} onSessionExpired={vi.fn()} />);

const renderLogs = () =>
  render(<LogsPanel notify={vi.fn()} onSessionExpired={vi.fn()} />);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelsPanel", () => {
  it("opens Chat binding settings from the capability card instead of editing the model", async () => {
    mockModels();

    renderModels();

    const chatCard = await screen.findByRole("button", { name: /Chat/ });
    expect(chatCard).toHaveTextContent("已绑定 DeepSeek / deepseek-v4-flash");
    expect(screen.getByText("已绑定", { selector: ".enabled-pill" })).toBeInTheDocument();
    expect(screen.queryByText(/优先级|输入价格|输出价格/)).not.toBeInTheDocument();

    fireEvent.click(chatCard);
    expect(screen.getByRole("heading", { name: "设置 Chat" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "设置 Chat" })).toHaveClass("llm-modal");
    expect(screen.getByRole("radio", { name: /DeepSeek \/ deepseek-v4-flash/ })).toBeChecked();
    expect(screen.queryByLabelText("模型供应商")).not.toBeInTheDocument();
  });

  it("shows a retryable load error and then the true empty state", async () => {
    vi.spyOn(api, "getChatCapability")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(capability([]));
    vi.spyOn(api, "getChatCatalog").mockResolvedValue(catalog);

    renderModels();

    expect(await screen.findByRole("alert")).toHaveTextContent("Chat 模型配置加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("还没有可用于 Chat 的模型")).toBeInTheDocument();
  });

  it("creates a DeepSeek model without asking for capability, priority or price", async () => {
    mockModels(capability([]));
    const create = vi.spyOn(api, "createLlmModel").mockResolvedValue({
      model: { ...model, active: false },
    });

    renderModels();
    await screen.findByText("还没有可用于 Chat 的模型");
    fireEvent.click(screen.getAllByRole("button", { name: "新增模型" })[0]);
    expect(screen.getByRole("dialog", { name: "新增模型" })).toHaveClass("llm-modal");
    fireEvent.change(screen.getByLabelText(/^模型名称/), {
      target: { value: "deepseek-v4-flash" },
    });
    fireEvent.change(screen.getByLabelText(/API Key/), {
      target: { value: "fictional-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模型" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        adapter: "deepseek",
        model: "deepseek-v4-flash",
        apiBase: null,
        apiKey: "fictional-secret",
      }),
    );
  });

  it("shows supplier names without adapter codes and creates a Qwen model", async () => {
    mockModels(capability([]));
    const create = vi.spyOn(api, "createLlmModel").mockResolvedValue({
      model: {
        ...model,
        adapter: "dashscope",
        model: "qwen-plus",
        active: false,
      },
    });

    renderModels();
    await screen.findByText("还没有可用于 Chat 的模型");
    fireEvent.click(screen.getAllByRole("button", { name: "新增模型" })[0]);

    expect(screen.getByRole("option", { name: "DeepSeek" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "阿里云百炼（千问）" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /dashscope|deepseek ·/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("模型供应商"), {
      target: { value: "dashscope" },
    });
    fireEvent.change(screen.getByLabelText(/^模型名称/), {
      target: { value: "qwen-plus" },
    });
    fireEvent.change(screen.getByLabelText(/API Key/), {
      target: { value: "fictional-qwen-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模型" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        adapter: "dashscope",
        model: "qwen-plus",
        apiBase: null,
        apiKey: "fictional-qwen-secret",
      }),
    );
  });

  it("prevents duplicate model creation while the first save is pending", async () => {
    mockModels(capability([]));
    let resolveCreate!: (value: { model: LlmModelConfig }) => void;
    const pending = new Promise<{ model: LlmModelConfig }>((resolve) => {
      resolveCreate = resolve;
    });
    const create = vi.spyOn(api, "createLlmModel").mockReturnValue(pending);

    renderModels();
    await screen.findByText("还没有可用于 Chat 的模型");
    fireEvent.click(screen.getAllByRole("button", { name: "新增模型" })[0]);
    fireEvent.change(screen.getByLabelText(/^模型名称/), {
      target: { value: "deepseek-chat" },
    });
    const save = screen.getByRole("button", { name: "保存模型" });
    const form = save.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(create).toHaveBeenCalledTimes(1);
    resolveCreate({ model: { ...model, active: false } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps an existing key when blank and explicitly clears it when selected", async () => {
    mockModels();
    const update = vi.spyOn(api, "updateLlmModel").mockResolvedValue({
      model,
      validationCallId: "llmcall_validation",
    });

    renderModels();
    await screen.findByText("deepseek-v4-flash", { selector: "h3" });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "验证并保存" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).not.toHaveProperty("apiKey");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByLabelText("明确清除已保存的 API Key"));
    fireEvent.click(screen.getByRole("button", { name: "验证并保存" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toMatchObject({ apiKey: null });
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
    await screen.findByText("deepseek-v4-flash", { selector: "h3" });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText(/llmcall_test_1/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设为当前" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Chat/ }));
    fireEvent.click(screen.getByRole("radio", { name: /DeepSeek \/ deepseek-v4-flash/ }));
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
    fireEvent.click(screen.getByRole("radio", { name: /DeepSeek \/ deepseek-v4-flash/ }));
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
    await screen.findByText("deepseek-v4-flash", { selector: "h3" });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("llmcall_failed_1");
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
          estimatedCostUsd: "0.00012000",
        },
        nextCursor: null,
      })
      .mockResolvedValueOnce(emptyCalls);

    renderLogs();

    expect(await screen.findByText("llmcall_fictional")).toBeInTheDocument();
    expect(
      screen.getByText("deepseek/deepseek-v4-flash", { selector: "strong" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("调用来源"), {
      target: { value: "resume_editor" },
    });
    fireEvent.change(screen.getByLabelText("实际模型"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("用户 ID"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("callId"), {
      target: { value: "llmcall_fictional" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

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
