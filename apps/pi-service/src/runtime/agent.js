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

const SYSTEM_PROMPT = `你是 LinkCV 的简历智能助手，只能服务当前已授权运行。
每轮必须先用 read 读取 resume-edit-workflow/SKILL.md，并严格执行其中的定位、读取和诊断顺序。
修改请求在诊断后只能选择并读取一个执行 Skill：resume-edit-local、resume-edit-entry-star、resume-generate-from-materials；禁止同轮混用。
必须先调用 resolve_resume_target；未唯一定位或缺失会改变结果的关键信息时，必须调用 request_user_input 生成结构化问题，不能用普通文本代替澄清，也不能生成提案。调用 request_user_input 后本轮立即停止其他工具和最终回答。随后调用 get_resume_context 和 analyze_resume_content。
任何修改都必须调用 create_resume_change_proposal 生成待确认 diff，绝不能声称已经直接修改简历，也不能编造事实或量化数据。
只允许使用 read 读取已注册 Skill；禁止读取其他文件、执行 Shell、浏览网络或调用未注册工具。
工具选择、调用、参数校验、失败重试和内部执行顺序不得向用户叙述；只输出需要用户澄清的内容或工具执行完成后的最终结果。回答使用清晰、克制的中文。`;

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

export function createSkillReadTool(onRead = () => undefined) {
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
      onRead(relativePath);
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

export function createAssistantOutputFilter(emit, runId, shouldSuppress = () => false) {
  let pendingText = [];
  return (event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      pendingText.push(event.assistantMessageEvent.delta);
      return;
    }
    if (event.type !== "message_end" || event.message.role !== "assistant") {
      return;
    }
    const visibleText = pendingText.join("");
    pendingText = [];
    if (
      visibleText &&
      !shouldSuppress() &&
      (event.message.stopReason === "stop" || event.message.stopReason === "length")
    ) {
      emit("assistant.delta", { runId, delta: visibleText });
    }
  };
}

export function clarificationFallbackText(clarification) {
  const lines = ["继续前需要确认："];
  clarification.questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.question}`);
    lines.push(`   选项：${question.options.map((option) => option.label).join(" / ")} / 其他`);
  });
  return lines.join("\n");
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

export async function executeAgentRun({
  config,
  runId,
  content,
  history,
  selectionContext,
  emit,
  signal,
}) {
  const client = createLinkCVClient(config, runId, signal);
  const runtimeConfig = await client.runtimeConfig();
  const { modelRuntime, model } = await configuredModel({
    adapter: runtimeConfig.provider === "google" ? "gemini" : runtimeConfig.provider,
    name: runtimeConfig.model,
    apiKey: runtimeConfig.api_key,
    baseUrl: runtimeConfig.api_base,
  });

  let workflowLoaded = false;
  let selectedMode = null;
  let resolvedTarget = null;
  let diagnosisResult = null;
  let pendingClarification = null;
  const executionSkills = new Map([
    ["resume-edit-local/SKILL.md", "polish_local"],
    ["resume-edit-entry-star/SKILL.md", "rewrite_entry_star"],
    ["resume-generate-from-materials/SKILL.md", "generate_from_materials"],
  ]);

  const onSkillRead = (path) => {
    if (path === "resume-edit-workflow/SKILL.md") {
      workflowLoaded = true;
      return;
    }
    const mode = executionSkills.get(path);
    if (!mode) return;
    if (!workflowLoaded) throw new Error("WORKFLOW_SKILL_REQUIRED");
    if (selectedMode && selectedMode !== mode) throw new Error("SKILL_MODE_CONFLICT");
    selectedMode = mode;
  };

  const requireWorkflow = () => {
    if (!workflowLoaded) throw new Error("WORKFLOW_SKILL_REQUIRED");
  };

  const auditedTool = ({ name, label, description, parameters, run }) => defineTool({
    name,
    label,
    description,
    parameters,
    execute: async (toolCallId, params) => {
      if (pendingClarification) throw new Error("USER_INPUT_REQUIRED");
      const startedAt = Date.now();
      emit("tool.started", { runId, tool: name, callKey: toolCallId });
      await client.toolEvent({ call_key: toolCallId, tool_name: name, status: "running" });
      try {
        const output = await run(params, toolCallId);
        await client.toolEvent({
          call_key: toolCallId,
          tool_name: name,
          status: "succeeded",
          ...(output.targetType ? { target_type: output.targetType } : {}),
          ...(output.targetId ? { target_id: output.targetId } : {}),
          duration_ms: Date.now() - startedAt,
        });
        if (output.proposal) emit("proposal.created", { runId, proposal: output.proposal });
        emit("tool.completed", { runId, tool: name, callKey: toolCallId });
        return {
          content: [{ type: "text", text: output.text ?? JSON.stringify(output.value) }],
          details: {},
        };
      } catch (error) {
        await client.toolEvent({
          call_key: toolCallId,
          tool_name: name,
          status: "failed",
          error_code: error.code ?? "AGENT_TOOL_FAILED",
          duration_ms: Date.now() - startedAt,
        }).catch(() => {});
        throw error;
      }
    },
  });

  const requestUserInputTool = auditedTool({
    name: "request_user_input",
    label: "向用户澄清",
    description: "仅当缺失信息会改变结果时调用。一次提供 1–3 个短问题，每题 2–3 个互斥选项；界面会自动提供“其他”输入。调用后本轮不得继续任何工具或普通回答。",
    parameters: objectSchema({
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: objectSchema({
          id: { type: "string", pattern: "^[A-Za-z0-9_-]+$", minLength: 1, maxLength: 48 },
          header: { type: "string", minLength: 1, maxLength: 24 },
          question: { type: "string", minLength: 1, maxLength: 500 },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: objectSchema({
              id: { type: "string", pattern: "^[A-Za-z0-9_-]+$", minLength: 1, maxLength: 48 },
              label: { type: "string", minLength: 1, maxLength: 80 },
              description: { type: "string", maxLength: 240 },
            }, ["id", "label"]),
          },
        }, ["id", "header", "question", "options"]),
      },
    }, ["questions"]),
    run: async (params) => {
      requireWorkflow();
      const questionIds = params.questions.map((question) => question.id);
      if (new Set(questionIds).size !== questionIds.length) {
        throw new Error("AGENT_CLARIFICATION_INVALID");
      }
      for (const question of params.questions) {
        const optionIds = question.options.map((option) => option.id);
        if (new Set(optionIds).size !== optionIds.length) {
          throw new Error("AGENT_CLARIFICATION_INVALID");
        }
      }
      pendingClarification = { version: 1, questions: params.questions };
      emit("clarification.requested", { runId, clarification: pendingClarification });
      emit("assistant.delta", { runId, delta: clarificationFallbackText(pendingClarification) });
      return { text: "已向用户请求补充信息；本轮到此结束。" };
    },
  });

  const resolveTargetTool = auditedTool({
    name: "resolve_resume_target",
    label: "定位简历内容",
    description: "根据页面选区或用户引用文字解析稳定目标。若返回 ambiguous，必须让用户选择，不能继续修改。",
    parameters: objectSchema({
      quoted_text: { type: "string", minLength: 1, maxLength: 20000 },
      scope_hint: { type: "string", enum: ["target", "resume"] },
    }),
    run: async (params) => {
      requireWorkflow();
      const result = await client.resolveTarget({
        ...(selectionContext ? { selection_context: selectionContext } : {}),
        ...(params.quoted_text ? { quoted_text: params.quoted_text } : {}),
        scope_hint: params.scope_hint ?? "target",
      });
      resolvedTarget = result.status === "resolved" ? result.target : null;
      diagnosisResult = null;
      return { value: result, targetType: "resume", targetId: result.target?.resume_id };
    },
  });

  const getContextTool = auditedTool({
    name: "get_resume_context",
    label: "读取授权简历上下文",
    description: "仅按已解析目标读取 target、entry、section 或 resume 范围，并返回各块稳定 locator。",
    parameters: objectSchema({
      scope: { type: "string", enum: ["target", "entry", "section", "resume"] },
    }, ["scope"]),
    run: async (params) => {
      requireWorkflow();
      if (!resolvedTarget) throw new Error("TARGET_RESOLUTION_REQUIRED");
      const result = await client.scopedContext({ target: resolvedTarget, scope: params.scope });
      return { value: result, targetType: "resume", targetId: result.resume_id };
    },
  });

  const searchMaterialsTool = auditedTool({
    name: "search_resume_materials",
    label: "召回授权资料",
    description: "只搜索当前用户拥有的历史简历、资料集和目标职位，返回带版本的 source_id。",
    parameters: objectSchema({
      query: { type: "string", minLength: 1, maxLength: 500 },
      types: { type: "array", items: { type: "string", enum: ["resume", "dataset", "job"] }, minItems: 1, maxItems: 3 },
      limit: { type: "integer", minimum: 1, maximum: 10 },
    }, ["query"]),
    run: async (params) => {
      requireWorkflow();
      const result = await client.searchMaterials({
        query: params.query,
        ...(params.types ? { types: params.types } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
      });
      return { value: result };
    },
  });

  const analyzeTool = auditedTool({
    name: "analyze_resume_content",
    label: "结构化诊断简历",
    description: "在编写前诊断岗位匹配、关键词、量化结果、STAR 和 ATS；结果带不可伪造指纹。",
    parameters: objectSchema({
      scope: { type: "string", enum: ["target", "entry", "section", "resume"] },
      job_id: { type: "string", pattern: "^[0-9]+$" },
      source_ids: { type: "array", items: { type: "string" }, maxItems: 20 },
    }, ["scope"]),
    run: async (params) => {
      requireWorkflow();
      if (!resolvedTarget) throw new Error("TARGET_RESOLUTION_REQUIRED");
      diagnosisResult = await client.diagnose({
        target: resolvedTarget,
        scope: params.scope,
        ...(params.job_id ? { job_id: params.job_id } : {}),
        source_ids: params.source_ids ?? [],
      });
      return { value: diagnosisResult, targetType: "resume", targetId: resolvedTarget.resume_id };
    },
  });

  const createProposalTool = auditedTool({
    name: "create_resume_change_proposal",
    label: "创建待确认简历修改",
    description: "依据当前诊断创建范围受限的 diff 提案。只会生成待确认提案，不会直接覆盖简历。",
    parameters: objectSchema({
      mode: { type: "string", enum: ["polish_local", "rewrite_entry_star", "generate_from_materials"] },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: objectSchema({
          op: { type: "string", enum: ["replace_target_text", "insert_after_target"] },
          target: { type: "object" },
          new_text: { type: "string", minLength: 1, maxLength: 20000 },
          expected_text_hash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        }, ["op", "target", "new_text", "expected_text_hash"]),
      },
      rationale: { type: "array", items: { type: "object" }, maxItems: 20 },
      source_ids: { type: "array", items: { type: "string" }, maxItems: 20 },
      summary: { type: "string", minLength: 1, maxLength: 4000 },
    }, ["mode", "operations", "summary"]),
    run: async (params, toolCallId) => {
      requireWorkflow();
      if (!resolvedTarget) throw new Error("TARGET_RESOLUTION_REQUIRED");
      if (!diagnosisResult) throw new Error("DIAGNOSIS_REQUIRED");
      if (!selectedMode || selectedMode !== params.mode) throw new Error("SKILL_MODE_CONFLICT");
      const result = await client.scopedProposal({
          call_key: toolCallId,
          mode: params.mode,
          target: resolvedTarget,
          diagnosis: diagnosisResult.diagnosis,
          diagnosis_fingerprint: diagnosisResult.diagnosis_fingerprint,
          operations: params.operations,
          rationale: params.rationale ?? [],
          source_ids: params.source_ids ?? [],
          summary: params.summary,
        });
      return {
        value: result,
        proposal: result.proposal,
        targetType: "proposal",
        targetId: result.proposal.id,
        text: `提案已创建：${result.proposal.id}，等待用户确认。`,
      };
    },
  });
  const skillReadTool = createSkillReadTool(onSkillRead);

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
    tools: [
      "read",
      "resolve_resume_target",
      "get_resume_context",
      "search_resume_materials",
      "analyze_resume_content",
      "create_resume_change_proposal",
      "request_user_input",
    ],
    customTools: [
      skillReadTool,
      resolveTargetTool,
      getContextTool,
      searchMaterialsTool,
      analyzeTool,
      createProposalTool,
      requestUserInputTool,
    ],
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });
  let finalAssistantMessage;
  const filterAssistantOutput = createAssistantOutputFilter(
    emit,
    runId,
    () => pendingClarification !== null,
  );
  const unsubscribe = session.subscribe((event) => {
    filterAssistantOutput(event);
    if (event.type === "message_end" && event.message.role === "assistant") {
      finalAssistantMessage = event.message;
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
