const NON_THINKING_MODELS = new Set(["gpt-6-luna", "deepseek-v4.1-flash", "qwen3.8-flash"]);
const AIHUBMIX_HOSTS = new Set(["aihubmix.com", "api.inferera.com"]);

export function nonThinkingPayload(payload, model) {
  let hostname;
  try { hostname = new URL(model.baseUrl).hostname; } catch { return payload; }
  if (!AIHUBMIX_HOSTS.has(hostname) || !NON_THINKING_MODELS.has(model.id)) return payload;
  if (model.api === "openai-completions" && model.id === "deepseek-v4.1-flash") {
    return { ...payload, thinking: { type: "disabled" } };
  }
  if (model.api === "openai-completions" && model.id === "qwen3.8-flash") {
    return { ...payload, enable_thinking: false };
  }
  if (model.api === "openai-responses" && model.id === "gpt-6-luna") {
    return { ...payload, reasoning: { ...payload.reasoning, effort: "none" } };
  }
  return payload;
}

// Pi's thinkingLevel=off alone does not disable upstream default reasoning.
export function installInferenceOptions(modelRuntime) {
  const original = modelRuntime.streamSimple.bind(modelRuntime);
  modelRuntime.streamSimple = (model, context, options = {}) => original(model, context, {
    ...options,
    onPayload: async (payload, actualModel) => {
      const next = await options.onPayload?.(payload, actualModel);
      return nonThinkingPayload(next ?? payload, actualModel);
    },
  });
}
