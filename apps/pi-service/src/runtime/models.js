import { ModelRuntime } from "../../../../third_party/pi/packages/coding-agent/dist/index.js";
import { createAssistantMessageEventStream } from "../../../../third_party/pi/packages/ai/dist/utils/event-stream.js";
import { isRetryableAssistantError } from "../../../../third_party/pi/packages/ai/dist/utils/retry.js";
import { installInferenceOptions } from "./inference-options.js";

const ALLOWED_MODEL_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);

export async function configuredModels(modelConfigs) {
  if (!Array.isArray(modelConfigs) || modelConfigs.length === 0) throw new Error("AGENT_MODEL_UNSUPPORTED");
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  installInferenceOptions(modelRuntime);
  const routes = [];
  for (const modelConfig of modelConfigs) {
    if (!ALLOWED_MODEL_APIS.has(modelConfig.api) || !modelConfig.baseUrl?.startsWith("https://")) {
      throw new Error("AGENT_MODEL_UNSUPPORTED");
    }
    const provider = `drawoffer-${modelConfig.provider}${modelConfig.routeId ? `-${modelConfig.routeId}` : ""}`;
    const contextWindow = Number.isSafeInteger(modelConfig.contextWindow) && modelConfig.contextWindow > 0
      ? modelConfig.contextWindow : 128000;
    const maxTokens = Number.isSafeInteger(modelConfig.maxOutputTokens) && modelConfig.maxOutputTokens > 0
      ? Math.min(modelConfig.maxOutputTokens, contextWindow) : Math.min(8192, contextWindow);
    modelRuntime.registerProvider(provider, {
      baseUrl: modelConfig.baseUrl,
      api: modelConfig.api,
      authHeader: true,
      models: [{
        id: modelConfig.name,
        name: modelConfig.name,
        api: modelConfig.api,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
      }],
    });
    await modelRuntime.setRuntimeApiKey(provider, modelConfig.apiKey);
    const routeModel = modelRuntime.getModel(provider, modelConfig.name);
    if (!routeModel) throw new Error("AGENT_MODEL_UNSUPPORTED");
    routes.push({ ...modelConfig, model: routeModel });
  }
  return {
    modelRuntime,
    model: routes[0].model,
    routes,
  };
}

export async function configuredModel(modelConfig) {
  return configuredModels([modelConfig]);
}

function retryableRouteFailure(message) {
  if (message?.stopReason !== "error") return false;
  if (isRetryableAssistantError(message)) return true;
  const detail = message.errorMessage ?? "";
  return /(?:\b401\b|\b403\b|\b429\b|\b50[0-49]\b|no_available_channel|connection|timeout|timed out)/i.test(detail);
}

export function streamWithRouteFallback(routes, streamFor, onRoute, onFailedAttempt, signal) {
  const output = createAssistantMessageEventStream();
  void (async () => {
    let lastPartial = null;
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      const buffered = [];
      let emittedContent = false;
      let switched = false;
      try {
        onRoute(route);
        for await (const event of streamFor(route)) {
          if (event.partial) lastPartial = event.partial;
          if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") {
            emittedContent = true;
          }
          if (event.type === "error" && !emittedContent && !signal.aborted
              && index + 1 < routes.length && retryableRouteFailure(event.error)) {
            await onFailedAttempt(route, event.error);
            switched = true;
            break;
          }
          if (!emittedContent && event.type !== "done" && event.type !== "error") {
            buffered.push(event);
            continue;
          }
          for (const previous of buffered.splice(0)) output.push(previous);
          output.push(event);
          if (event.type === "done" || event.type === "error") return;
        }
        if (switched) continue;
        throw new Error("connection closed before response");
      } catch (error) {
        if (!emittedContent && !signal.aborted && index + 1 < routes.length
            && retryableRouteFailure({ stopReason: "error", errorMessage: String(error?.message ?? error) })) {
          await onFailedAttempt(route, { stopReason: "error", errorMessage: String(error?.message ?? error) });
          continue;
        }
        const failed = { ...(lastPartial ?? {}), role: "assistant", content: lastPartial?.content ?? [],
          stopReason: signal.aborted ? "aborted" : "error", errorMessage: String(error?.message ?? error) };
        output.push({ type: "error", reason: signal.aborted ? "aborted" : "error", error: failed });
        return;
      }
    }
    const failed = { ...(lastPartial ?? {}), role: "assistant", content: lastPartial?.content ?? [],
      stopReason: "error", errorMessage: "AGENT_MODEL_REQUEST_FAILED" };
    output.push({ type: "error", reason: "error", error: failed });
  })();
  return output;
}
