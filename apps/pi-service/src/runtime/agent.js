import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
  SettingsManager,
} from "../../../../third_party/pi/packages/coding-agent/dist/index.js";
import { fileURLToPath } from "node:url";

import { configuredModel } from "./models.js";
import { agentUsage, assertAgentCompleted } from "./output.js";
import { objectSchema } from "./util.js";

// The runtime is split by responsibility; this module stays the single import point.
export { executeAgentRun } from "./orchestrator.js";
export { configuredModel, configuredModels, streamWithRouteFallback } from "./models.js";
export { agentUsage, assertAgentCompleted, clarificationFallbackText, createAssistantOutputFilter } from "./output.js";
export {
  buildAgentConversation, formatContextCatalog, formatContextMaterials, loadIntentDecision,
  SYSTEM_PROMPT, USER_FACING_RESPONSE_PROMPT,
} from "./prompts.js";
export {
  executeResumeEditPlan, materializeProposalOperations, prepareEditPlanArguments, proposalCallKey,
  retryIdempotentProposal, translationCallKey,
} from "./proposals.js";
export {
  createResumeContextPolicy, isExplicitResumeReference, referenceNeedsResolution, resourceReferenceParameters,
  resumeReferenceParameters, selectionForResume, validateMemoryReference,
} from "./resume-policy.js";
export { createSerialExecutor, explicitNumberedGoalCount } from "./util.js";
export { computeTaskOutcome, editPlanSummary, WORKFLOWS } from "./workflows.js";

export async function executeAgentProbe({ model: modelConfig, nonce, signal }) {
  const { modelRuntime, model } = await configuredModel(modelConfig);
  let toolCallId = null;
  const probeTool = defineTool({
    name: "linkresume_probe",
    label: "LinkResume Pi 探针",
    description: "完成 LinkResume Pi Agent 能力验证。",
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
      "你正在执行连接验证。必须且只能调用一次 linkresume_probe，并原样传入用户提供的 nonce；不要调用其他工具。",
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    model,
    modelRuntime,
    thinkingLevel: "off",
    noTools: "builtin",
    tools: ["linkresume_probe"],
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
