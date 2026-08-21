import { Agent } from "../../../third_party/pi/packages/agent/src/agent.ts";
import type { StreamFn } from "../../../third_party/pi/packages/agent/src/types.ts";
import { openAICompletionsApi } from "../../../third_party/pi/packages/ai/src/api/openai-completions.lazy.ts";
import { Type } from "typebox";
import { resolveRuntimeModel, type RuntimeModelInput } from "./model-resolver.ts";

export interface ProbeRequest {
  runId: string;
  nonce: string;
  model: RuntimeModelInput & { apiKey: string };
}

export interface ProbeResult {
  ok: true;
  runId: string;
  toolCallId: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ProbeDependencies {
  streamFn?: StreamFn;
}

export async function runProbe(
  request: ProbeRequest,
  dependencies: ProbeDependencies = {},
): Promise<ProbeResult> {
  let executedToolCallId: string | undefined;
  const probeTool = {
    name: "probe",
    label: "Connection probe",
    description: "Confirm the LinkCV Pi Agent model path with the supplied nonce.",
    parameters: Type.Object(
      { nonce: Type.String({ minLength: 1, maxLength: 128 }) },
      { additionalProperties: false },
    ),
    async execute(toolCallId: string, params: unknown) {
      const nonce = (params as { nonce?: unknown }).nonce;
      if (nonce !== request.nonce) {
        throw new Error("Probe nonce mismatch");
      }
      executedToolCallId = toolCallId;
      return {
        content: [{ type: "text" as const, text: "probe accepted" }],
        details: { accepted: true },
        terminate: true,
      };
    },
  };
  const model = resolveRuntimeModel(request.model);
  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: "off",
      tools: [probeTool],
      systemPrompt:
        "You are a connection probe. Call the probe tool exactly once using the nonce from the user. Do not answer with text.",
    },
    streamFn:
      dependencies.streamFn ??
      ((selectedModel, context, options) =>
        openAICompletionsApi().streamSimple(selectedModel, context, {
          ...options,
          apiKey: request.model.apiKey,
        })),
  });
  await agent.prompt(`Call probe with nonce: ${request.nonce}`);
  if (!executedToolCallId) {
    throw new Error(agent.state.errorMessage ?? "Model did not execute the probe tool");
  }
  const usage = agent.state.messages.reduce(
    (total, message) => {
      if (message.role === "assistant") {
        total.inputTokens += message.usage.input;
        total.outputTokens += message.usage.output;
      }
      return total;
    },
    { inputTokens: 0, outputTokens: 0 },
  );
  return { ok: true, runId: request.runId, toolCallId: executedToolCallId, usage };
}
