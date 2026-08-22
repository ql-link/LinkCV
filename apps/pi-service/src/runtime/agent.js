import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "../../../../third_party/pi/packages/coding-agent/dist/index.js";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { createLinkCVClient } from "../tools/linkcv-client.js";

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const SYSTEM_PROMPT = `你是 LinkCV 的简历智能助手。你只能服务当前已授权运行。
必须先调用 get_resume_context 获取简历，不能猜测或索取其他用户数据。
分析类请求可以直接回答；任何修改都必须调用 create_resume_proposal 创建完整提案，绝不能声称已经直接修改简历。
只允许使用 read 读取已注册的 Skill 文件；禁止读取其他文件、执行 Shell、浏览网络或调用未注册工具。回答使用清晰、克制的中文。`;

const SKILLS_ROOT = fileURLToPath(new URL("../../resources/skills/", import.meta.url));

const PI_PROVIDER_BY_ADAPTER = {
  openai: "openai",
  anthropic: "anthropic",
  deepseek: "deepseek",
  openrouter: "openrouter",
  gemini: "google",
  xai: "xai",
  groq: "groq",
  mistral: "mistral",
};

async function configuredModel(modelConfig) {
  const provider = PI_PROVIDER_BY_ADAPTER[modelConfig.adapter];
  if (!provider) throw new Error("AGENT_MODEL_UNSUPPORTED");
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  if (modelConfig.apiKey) {
    await modelRuntime.setRuntimeApiKey(provider, modelConfig.apiKey);
  }
  const baseModel = modelRuntime.getModel(provider, modelConfig.name);
  if (!baseModel) throw new Error("AGENT_MODEL_UNSUPPORTED");
  return {
    modelRuntime,
    model: modelConfig.baseUrl ? { ...baseModel, baseUrl: modelConfig.baseUrl } : baseModel,
  };
}

export function createSkillReadTool() {
  return defineTool({
    name: "read",
    label: "读取 Skill",
    description: "读取已注册的 LinkCV Agent Skill Markdown；不能访问其他服务端文件。",
    parameters: objectSchema({
      path: { type: "string", minLength: 1, maxLength: 1024 },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1, maximum: 2000 },
    }, ["path"]),
    execute: async (_toolCallId, params) => {
      const root = await realpath(SKILLS_ROOT);
      const requested = isAbsolute(params.path)
        ? params.path
        : resolve(root, params.path);
      const target = await realpath(requested);
      const relativePath = relative(root, target);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath) ||
        extname(target).toLowerCase() !== ".md"
      ) {
        throw new Error("AGENT_SKILL_READ_FORBIDDEN");
      }
      const content = await readFile(target, "utf8");
      if (Buffer.byteLength(content, "utf8") > 128 * 1024) {
        throw new Error("AGENT_SKILL_TOO_LARGE");
      }
      const lines = content.split("\n");
      const start = Math.max(0, (params.offset ?? 1) - 1);
      const limit = params.limit ?? 2000;
      return {
        content: [{ type: "text", text: lines.slice(start, start + limit).join("\n") }],
        details: { path: relativePath, totalLines: lines.length },
      };
    },
  });
}

export function assertAgentCompleted(message) {
  if (!message || message.role !== "assistant") {
    throw new Error("AGENT_EMPTY_RESPONSE");
  }
  if (message.stopReason === "error") {
    const detail = String(message.errorMessage ?? "");
    if (/\b(?:timeout|timed out|etimedout)\b/i.test(detail)) {
      throw new Error("AGENT_MODEL_TIMEOUT");
    }
    throw new Error("AGENT_MODEL_REQUEST_FAILED");
  }
  if (message.stopReason === "aborted") {
    throw new Error("AGENT_ABORTED");
  }
}

export function agentUsage(stats) {
  if (!stats?.tokens) return null;
  const inputTokens = Number(stats.tokens.input);
  const outputTokens = Number(stats.tokens.output);
  const estimatedCost = Number(stats.cost);
  if (
    !Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
    !Number.isSafeInteger(outputTokens) || outputTokens < 0
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    estimatedCost: Number.isFinite(estimatedCost) && estimatedCost >= 0
      ? estimatedCost.toFixed(8)
      : null,
  };
}

export async function executeAgentProbe({ model: modelConfig, nonce, signal }) {
  const { modelRuntime, model } = await configuredModel(modelConfig);
  let toolCallId = null;
  const probeTool = defineTool({
    name: "linkcv_probe",
    label: "LinkCV Pi 探针",
    description: "完成 LinkCV Pi Agent 能力验证。",
    parameters: objectSchema({ nonce: { type: "string" } }, ["nonce"]),
    execute: async (callId, params) => {
      if (params.nonce !== nonce) throw new Error("AGENT_PROBE_NONCE_MISMATCH");
      toolCallId = callId;
      return { content: [{ type: "text", text: "OK" }], details: {} };
    },
  });
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: fileURLToPath(new URL("../../resources/", import.meta.url)),
    settingsManager,
    systemPromptOverride: () =>
      "你正在执行连接验证。必须且只能调用一次 linkcv_probe，并原样传入用户提供的 nonce；不要调用其他工具。",
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    model,
    modelRuntime,
    thinkingLevel: "off",
    noTools: "builtin",
    tools: ["linkcv_probe"],
    customTools: [probeTool],
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });
  let finalAssistantMessage;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      finalAssistantMessage = event.message;
    }
  });
  const abort = () => void session.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await session.prompt(`nonce: ${nonce}`);
    assertAgentCompleted(finalAssistantMessage);
    if (!toolCallId) throw new Error("AGENT_PROBE_TOOL_NOT_CALLED");
    return { toolCallId, usage: agentUsage(session.getSessionStats()) };
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}

export async function executeAgentRun({ config, runId, content, history, emit, signal }) {
  const client = createLinkCVClient(config, runId, signal);
  const runtimeConfig = await client.runtimeConfig();
  const { modelRuntime, model } = await configuredModel({
    adapter: runtimeConfig.provider === "google" ? "gemini" : runtimeConfig.provider,
    name: runtimeConfig.model,
    apiKey: runtimeConfig.api_key,
    baseUrl: runtimeConfig.api_base,
  });

  const getContextTool = defineTool({
    name: "get_resume_context",
    label: "读取当前简历",
    description: "读取本次运行授权的简历内容、样式和乐观锁版本。",
    parameters: objectSchema({}),
    execute: async (toolCallId) => {
      const startedAt = Date.now();
      emit("tool.started", { runId, tool: "get_resume_context", callKey: toolCallId });
      await client.toolEvent({ call_key: toolCallId, tool_name: "get_resume_context", status: "running" });
      try {
        const context = await client.context();
        await client.toolEvent({
          call_key: toolCallId,
          tool_name: "get_resume_context",
          status: "succeeded",
          target_type: "resume",
          target_id: context.resume_id,
          duration_ms: Date.now() - startedAt,
        });
        emit("tool.completed", { runId, tool: "get_resume_context", callKey: toolCallId });
        return { content: [{ type: "text", text: JSON.stringify(context) }], details: {} };
      } catch (error) {
        await client.toolEvent({
          call_key: toolCallId,
          tool_name: "get_resume_context",
          status: "failed",
          error_code: error.code ?? "AGENT_TOOL_FAILED",
          duration_ms: Date.now() - startedAt,
        }).catch(() => {});
        throw error;
      }
    },
  });

  const createProposalTool = defineTool({
    name: "create_resume_proposal",
    label: "创建简历修改提案",
    description: "提交完整且合法的 ResumeDocumentV1 与 ResumeStyleV1 快照，等待用户确认。",
    parameters: objectSchema(
      {
        data: { type: "object", description: "完整 ResumeDocumentV1" },
        style: { type: "object", description: "完整 ResumeStyleV1" },
        summary: { type: "string", minLength: 1, maxLength: 4000 },
      },
      ["data", "style", "summary"],
    ),
    execute: async (toolCallId, params) => {
      const startedAt = Date.now();
      emit("tool.started", { runId, tool: "create_resume_proposal", callKey: toolCallId });
      await client.toolEvent({ call_key: toolCallId, tool_name: "create_resume_proposal", status: "running" });
      try {
        const result = await client.proposal({
          call_key: toolCallId,
          data: params.data,
          style: params.style,
          summary: params.summary,
        });
        await client.toolEvent({
          call_key: toolCallId,
          tool_name: "create_resume_proposal",
          status: "succeeded",
          target_type: "proposal",
          target_id: result.proposal.id,
          duration_ms: Date.now() - startedAt,
        });
        emit("proposal.created", { runId, proposal: result.proposal });
        emit("tool.completed", { runId, tool: "create_resume_proposal", callKey: toolCallId });
        return {
          content: [{ type: "text", text: `提案已创建：${result.proposal.id}，等待用户确认。` }],
          details: {},
        };
      } catch (error) {
        await client.toolEvent({
          call_key: toolCallId,
          tool_name: "create_resume_proposal",
          status: "failed",
          error_code: error.code ?? "AGENT_TOOL_FAILED",
          duration_ms: Date.now() - startedAt,
        }).catch(() => {});
        throw error;
      }
    },
  });
  const skillReadTool = createSkillReadTool();

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 1 },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: fileURLToPath(new URL("../../resources/", import.meta.url)),
    settingsManager,
    systemPromptOverride: () => SYSTEM_PROMPT,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    model,
    modelRuntime,
    thinkingLevel: "off",
    noTools: "builtin",
    tools: ["read", "get_resume_context", "create_resume_proposal"],
    customTools: [skillReadTool, getContextTool, createProposalTool],
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });
  let finalAssistantMessage;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      finalAssistantMessage = event.message;
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      emit("assistant.delta", { runId, delta: event.assistantMessageEvent.delta });
    }
  });
  const abort = () => void session.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const conversation = history.length
      ? `以下是由 LinkCV 数据库恢复的同一会话最近记录，仅作为对话上下文：\n${JSON.stringify(history)}\n\n用户本轮请求：\n${content}`
      : content;
    await session.prompt(conversation);
    assertAgentCompleted(finalAssistantMessage);
    return agentUsage(session.getSessionStats());
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}
