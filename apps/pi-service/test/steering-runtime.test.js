import assert from "node:assert/strict";
import test from "node:test";
import { configuredModels, executeAgentRun } from "../src/runtime/agent.js";
import { createAssistantMessageEventStream } from "../../../third_party/pi/packages/ai/dist/utils/event-stream.js";

test("native Pi persists each reply before inserting, restores tools and switches callback scope", async (t) => {
  let handle;
  let tasks = [];
  const callbacks = [];
  const events = [];
  const completed = [];
  const material = { type: "resume", id: "2", resume_id: "2", version: "1", lock_version: 1,
    label: "张三的第二份简历", updated_at: "2026-10-04T00:00:00Z", content: {} };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.ok(String(url).startsWith("http://app.test/internal/agent/"));
    const path = new URL(url).pathname;
    const payload = options.body ? JSON.parse(options.body) : null;
    const source = options.headers["X-Agent-User-Sequence"];
    callbacks.push({ path, source, payload });
    let body = {};
    if (path.endsWith("runtime-config")) body = { provider: "fake", api: "openai-completions", model: "fake",
      api_key: "fictional-key", api_base: "https://fake.test/v1", route_id: "1", config_version: 1 };
    if (path.endsWith("tasks:plan")) {
      tasks = payload.tasks.map((task) => ({ ...task, depends_on: [], context_refs: [], status: "planned", proposal_ids: [] }));
      body = { tasks };
    }
    if (/\/tasks\/[^/]+:status$/.test(path)) {
      tasks = tasks.map((task) => ({ ...task, ...payload }));
      body = { tasks };
    }
    if (path.endsWith("/materials")) body = { materials: [], sources: [] };
    if (path.endsWith("steering:activate")) {
      assert.equal(completed.length, 1, "earlier complete reply must be durable at the boundary");
      assert.equal(tasks[0].status, "completed", "all tools finish before activation");
      body = { receipt: { state: "accepted", user_sequence_no: 3 }, contextMaterials: [material], selectionContext: null };
    }
    if (path.endsWith("messages:complete")) {
      completed.push(payload);
      body = { sequence_no: payload.user_sequence_no + 1 };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
  const plan = (id) => ({ tasks: [{ id, workflow: "career_planning", output: "advice", label: "职业建议" }] });
  const responses = [
    [call("r1", "read", { path: "career-assistant-router/SKILL.md" }), call("p1", "plan_agent_request", plan("first"))],
    [call("s1", "start_agent_task", { task_id: "first" }), call("w1", "read", { path: "career-planning/SKILL.md" }), call("f1", "finish_agent_task", { status: "completed", result: "已有结果" })],
    [call("b1", "begin_final_response", {})],
    [{ type: "text", text: "第一条完整回复" }],
    [call("r2", "read", { path: "career-assistant-router/SKILL.md" }), call("p2", "plan_agent_request", plan("second"))],
    [call("s2", "start_agent_task", { task_id: "second" }), call("w2", "read", { path: "career-planning/SKILL.md" }), call("f2", "finish_agent_task", { status: "completed", result: "新结果" })],
    [call("b2", "begin_final_response", {})],
    [{ type: "text", text: "第二条完整回复" }],
  ];
  let turn = 0;
  await executeAgentRun({ config: { linkresumeBaseUrl: "http://app.test", linkresumeToken: "fictional-token", toolTimeoutMs: 10000 },
    runId: "run", userSequenceNo: 1, submissionKey: "initial_1", content: "第一项工作", history: [],
    contextMaterials: [], signal: new AbortController().signal, emit: (type, data) => events.push({ type, ...data }),
    onReady: (value) => { handle = value; },
    modelFactory: async (configs) => {
      const runtime = await configuredModels(configs);
      runtime.modelRuntime.streamSimple = (_model, context) => {
        const output = createAssistantMessageEventStream();
        void (async () => {
          const index = turn++;
          assert.ok(index < responses.length, `unexpected turn ${index}: ${JSON.stringify(context.messages.at(-1))}`);
          if (index === 4) {
            assert.ok(context.tools.some((tool) => tool.name === "plan_agent_request"), "final-response tools must be restored");
            assert.match(JSON.stringify(context.messages.at(-1)), /第二份简历/);
          }
          const content = responses[index];
          const message = { role: "assistant", api: "openai-completions", provider: runtime.model.provider,
            model: "fake", content, stopReason: content[0].type === "text" ? "stop" : "toolUse", timestamp: Date.now(),
            usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          output.push({ type: "start", partial: message });
          if (content[0].type === "text") {
            output.push({ type: "text_delta", contentIndex: 0, delta: content[0].text, partial: message });
            if (index === 3) await handle.submit({ content: "切换后继续", idempotency_key: "steer_native_1", contexts: [{ type: "resume", id: "2", version: "1" }], replace_inherited_resume: true });
          }
          output.push({ type: "done", reason: message.stopReason, message });
        })().catch((error) => {
          output.push({ type: "error", reason: "error", error: { role: "assistant", content: [], stopReason: "error", errorMessage: error.message } });
        });
        return output;
      };
      return runtime;
    },
  });
  assert.equal(turn, 8);
  assert.deepEqual(completed.map((item) => [item.user_sequence_no, item.content]), [[1, "第一条完整回复"], [3, "第二条完整回复"]]);
  assert.deepEqual(events.filter((event) => event.type === "assistant.message.completed").map((event) => event.userSequenceNo), [1, 3]);
  const activation = callbacks.findIndex((item) => item.path.endsWith("steering:activate"));
  assert.equal(callbacks[activation].source, "1");
  assert.ok(callbacks.slice(activation + 1).filter((item) => !item.path.endsWith("llm-calls")).every((item) => item.source === "3"));
  assert.equal(handle.lookup("steer_native_1").state, "applied");
});

for (const outcome of ["clarification", "cancel"]) {
  test(`native Pi does not activate waiting input when the current turn ends with ${outcome}`, async (t) => {
    const controller = new AbortController();
    const callbacks = [];
    let handle;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const path = new URL(url).pathname;
      callbacks.push(path);
      const body = path.endsWith("runtime-config")
        ? { provider: "fake", api: "openai-completions", model: "fake", api_key: "fictional", api_base: "https://fake.test/v1", route_id: "1", config_version: 1 }
        : path.endsWith("messages:complete") ? { sequence_no: 2 } : {};
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    });
    let turns = 0;
    const run = executeAgentRun({ config: { linkresumeBaseUrl: "http://app.test", linkresumeToken: "fictional-token", toolTimeoutMs: 10000 },
      runId: "run", userSequenceNo: 1, content: "需要澄清的工作", history: [], contextMaterials: [],
      signal: controller.signal, emit: () => {}, onReady: (value) => { handle = value; },
      modelFactory: async (configs) => {
        const runtime = await configuredModels(configs);
        runtime.modelRuntime.streamSimple = () => {
          assert.equal(turns++, 0, "the native stop must prevent another model turn");
          const output = createAssistantMessageEventStream();
          void (async () => {
            await handle.submit({ content: "仍待发送", idempotency_key: "waiting_stop_input" });
            if (outcome === "cancel") controller.abort("cancelled");
            const message = { role: "assistant", api: "openai-completions", provider: runtime.model.provider, model: "fake", timestamp: Date.now(),
              content: outcome === "cancel" ? [] : [
                { type: "toolCall", id: "router", name: "read", arguments: { path: "career-assistant-router/SKILL.md" } },
                { type: "toolCall", id: "ask", name: "request_user_input", arguments: { questions: [{ purpose: "missing_fact", id: "scope", header: "范围", question: "请选择范围",
                  options: [{ id: "a", label: "职业规划" }, { id: "b", label: "面试准备" }] }] } },
              ], stopReason: outcome === "cancel" ? "aborted" : "toolUse",
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            output.push({ type: "done", reason: message.stopReason, message });
          })();
          return output;
        };
        return runtime;
      },
    });
    if (outcome === "cancel") await assert.rejects(run);
    else await run;
    assert.ok(!callbacks.some((path) => path.endsWith("steering:activate")));
    assert.equal(callbacks.filter((path) => path.endsWith("messages:complete")).length, outcome === "clarification" ? 1 : 0);
  });
}
