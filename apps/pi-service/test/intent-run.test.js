import assert from "node:assert/strict";
import test from "node:test";
import { executeAgentRun } from "../src/runtime/agent.js";

for (const mode of ["plan", "conversation", "clarify", "fallback"]) test(`Pi executes intent mode ${mode} through its actual tools`, async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const tasks = [{ id: "career", workflow: "career_planning", output: "advice", label: "职业规划", depends_on: [], context_refs: [], status: "planned", proposal_ids: [] }];
  const script = mode === "clarify" ? [
    ["read", { path: "career-assistant-router/SKILL.md" }],
    ["request_user_input", { questions: [{ purpose: "edit_scope", id: "scope", header: "修改范围", question: "需要修改哪个范围？", options: [{ id: "local", label: "局部" }, { id: "whole", label: "整份" }] }] }],
  ] : ["conversation", "fallback"].includes(mode) ? [
    ["read", { path: "career-assistant-router/SKILL.md" }],
    ["begin_final_response", {}],
    null,
  ] : [
    ["read", { path: "career-assistant-router/SKILL.md" }],
    ["start_agent_task", { task_id: "career" }],
    ["read", { path: "career-planning/SKILL.md" }],
    ["finish_agent_task", { status: "completed", result: "给出职业规划建议" }],
    ["begin_final_response", {}],
    null,
  ];
  const calls = [];
  const events = [];
  let turn = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    if (url.includes("aihubmix.com")) {
      const action = script[turn++];
      assert.ok(turn <= script.length, "model attempted an unexpected extra turn");
      const delta = action ? { tool_calls: [{ index: 0, id: `tool_${turn}`, type: "function", function: { name: action[0], arguments: JSON.stringify(action[1]) } }] } : { content: "建议先明确职业目标，再制定行动计划。" };
      const base = { id: `response_${turn}`, object: "chat.completion.chunk", created: 1, model: "intent-test-model" };
      const chunks = [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: action ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    }
    calls.push(url);
    if (url.includes("runtime-config")) return Response.json({ provider: "aihubmix", api: "openai-completions", model: "intent-test-model", api_base: "https://aihubmix.com/v1", api_key: "fictional-key", route_id: "1", config_version: 1 });
    if (url.endsWith("intent:recognize")) return Response.json({ version: 1, mode, ...(mode === "plan" ? { tasks: structuredClone(tasks) } : mode === "clarify" ? { clarification_purposes: ["edit_scope"] } : {}) });
    if (url.endsWith("tasks/career:status")) {
      const payload = JSON.parse(options.body);
      tasks[0].status = payload.status;
      return Response.json({ tasks: structuredClone(tasks) });
    }
    if (url.endsWith("tasks/career/materials")) return Response.json({ materials: [], sources: [] });
    if (url.endsWith("tool-events") || url.endsWith("llm-calls")) return Response.json({ recorded: true });
    throw new Error(`unexpected endpoint ${url}`);
  };
  await executeAgentRun({
    config: { linkresumeBaseUrl: "http://127.0.0.1:8000", linkresumeToken: "fictional-token", toolTimeoutMs: 15000 },
    runId: "intent-test-run", content: ["conversation", "fallback"].includes(mode) ? "你好" : "给我职业规划建议", history: [], contextMaterials: [],
    emit: (type, payload) => events.push({ type, payload }), signal: new AbortController().signal,
  });
  assert.equal(tasks[0].status, mode === "plan" ? "completed" : "planned");
  if (["conversation", "fallback"].includes(mode)) assert.equal(calls.some((url) => url.includes("tasks/career")), false);
  if (mode === "clarify") {
    assert.ok(events.some((event) => event.type === "clarification.requested"));
    assert.equal(calls.some((url) => url.includes("tasks/career")), false);
  }
  assert.equal(turn, script.length);
  assert.equal(calls.filter((url) => url.endsWith("intent:recognize")).length, 1);
  assert.equal(calls.some((url) => url.endsWith("tasks:plan")), false);
  assert.ok(events.some((event) => event.type === "assistant.delta"));
});
