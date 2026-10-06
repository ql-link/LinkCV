import test from "node:test";
import assert from "node:assert/strict";
import { installInferenceOptions, nonThinkingPayload } from "../src/runtime/inference-options.js";

for (const [id, api, fields] of [
  ["gpt-6-luna", "openai-responses", { reasoning: { effort: "none" } }],
  ["deepseek-v4.1-flash", "openai-completions", { thinking: { type: "disabled" } }],
  ["qwen3.8-flash", "openai-completions", { enable_thinking: false }],
]) {
  test(`${id} uses the verified non-thinking protocol and parameter`, () => {
    const model = { id, baseUrl: "https://api.inferera.com/v1", api };
    assert.deepEqual(nonThinkingPayload({ input: "虚构问题" }, model), { input: "虚构问题", ...fields });
  });
}

test("other hosts and models keep their original payload", () => {
  const payload = { input: "虚构问题" };
  assert.equal(nonThinkingPayload(payload, { id: "other", baseUrl: "https://aihubmix.com/v1" }), payload);
  assert.equal(nonThinkingPayload(payload, { id: "gpt-6-luna", baseUrl: "https://aihubmix.com.invalid/v1" }), payload);
});

test("runtime hook preserves existing payload hooks and stream options", async () => {
  const model = { id: "deepseek-v4.1-flash", baseUrl: "https://aihubmix.com/v1", api: "openai-completions" };
  const runtime = { streamSimple: async (actual, context, options) => {
    assert.equal(actual, model);
    assert.equal(context, "context");
    assert.equal(options.maxRetries, 0);
    return options.onPayload({ input: "test" }, actual);
  } };
  installInferenceOptions(runtime);
  assert.deepEqual(await runtime.streamSimple(model, "context", {
    maxRetries: 0, onPayload: (payload) => ({ ...payload, metadata: "preserved" }),
  }), { input: "test", metadata: "preserved", thinking: { type: "disabled" } });
});
