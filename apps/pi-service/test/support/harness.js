// Scripted agent runs: a fake model that answers per turn, and a fake FastAPI that applies the
// same task-state rules as the real one, so a run can be asserted end to end without a network.
import assert from "node:assert/strict";

import { configuredModels, executeAgentRun } from "../../src/runtime/agent.js";
import { createAssistantMessageEventStream } from "../../../../third_party/pi/packages/ai/dist/utils/event-stream.js";

export const call = (id, name, args = {}) => ({ type: "toolCall", id, name, arguments: args });
export const say = (text) => ({ type: "text", text });

export const resumeBlocks = [
  { id: "node_summary000000001", text: "后端工程师，负责服务端开发。" },
  { id: "node_project000000001", text: "参与订单系统重构。" },
  { id: "node_project000000002", text: "维护 MySQL 慢查询。" },
];

export const wholeResumeContext = {
  run_id: "run", resume_id: "11", title: "张三的简历", lock_version: 1, scope: "resume",
  content: resumeBlocks.map((block) => block.text).join("\n\n"),
  data: { identity: { name: "张三" } }, style: { template: "classic" },
  target: { resume_id: "11", section: "resume" },
  blocks: resumeBlocks.map((block) => ({
    content: block.text,
    target: {
      resume_id: "11", base_lock_version: 1, surface: "editor", section: "section-work", entry_id: "node_entry0000000001",
      field: "markdown", block_id: block.id, selected_text: null, expected_text_hash: `sha256:${block.id.padEnd(64, "a").slice(0, 64)}`,
    },
  })),
};

export const task = (id, workflow, extra = {}) => ({
  id, workflow, label: `任务 ${id}`, depends_on: [], context_refs: [], status: "planned", proposal_ids: [],
  output: workflow === "resume_edit" || workflow === "resume_translation" ? "proposal" : workflow === "resource_catalog" ? "catalog" : "advice",
  ...extra,
});

export const withResume = (id = "11") => [{ type: "resume", id }];

// Same rules the server enforces on task state, so a wrong status fails the test.
function applyTaskStatus(tasks, id, payload) {
  const item = tasks.find((candidate) => candidate.id === id);
  if (!item) throw Object.assign(new Error("AGENT_TASK_NOT_FOUND"), { status: 404 });
  const reject = (code, status = 409) => { throw Object.assign(new Error(code), { status }); };
  if (payload.status === "running") {
    if (item.status !== "planned") reject("AGENT_TASK_STATUS_CONFLICT");
    if (item.depends_on.some((dep) => tasks.find((other) => other.id === dep).status !== "completed")) reject("AGENT_TASK_DEPENDENCY_PENDING");
    if (tasks.some((other) => other.status === "running")) reject("AGENT_TASK_ALREADY_RUNNING");
  } else if (payload.status === "blocked" && item.status === "planned") {
    if (!item.depends_on.some((dep) => ["failed", "blocked", "partial"].includes(tasks.find((other) => other.id === dep).status))) reject("AGENT_TASK_STATUS_CONFLICT");
  } else if (item.status !== "running") reject("AGENT_TASK_STATUS_CONFLICT");
  const ids = payload.proposal_ids ?? [];
  if (item.output !== "proposal" && ids.length) reject("AGENT_TASK_RESULT_INVALID", 422);
  if (payload.status === "partial" && item.output === "proposal" && !ids.length) reject("AGENT_TASK_RESULT_INVALID", 422);
  if (["blocked", "failed"].includes(payload.status) && ids.length) reject("AGENT_TASK_RESULT_INVALID", 422);
  if (["completed", "partial"].includes(payload.status) && item.output === "proposal" && !ids.length) reject("AGENT_TASK_PROPOSAL_REQUIRED");
  if (["completed", "partial"].includes(payload.status) && item.output !== "proposal" && !payload.result) reject("AGENT_TASK_RESULT_REQUIRED");
  Object.assign(item, { status: payload.status, proposal_ids: ids, error_code: payload.error_code ?? null, result: payload.result ?? null });
}

export function createHarness(t, {
  intent, tasks = [], script, materials = [], context = wholeResumeContext, backend = {}, intentFor,
  runtime = {}, autoResume = "11",
}) {
  const calls = [];
  const turns = [];
  const events = [];
  const proposals = [];
  const toolEvents = [];
  const completed = [];
  const state = { tasks: structuredClone(tasks), turn: 0 };
  const routes = (path, payload, source) => {
    if (path.endsWith("runtime-config")) return { provider: "fake", api: "openai-completions", model: "fake", api_key: "fictional-key", api_base: "https://fake.test/v1", route_id: "1", config_version: 1 };
    if (path.endsWith("intent:recognize")) {
      const decision = intentFor ? intentFor(source) : intent;
      if (decision.tasks) state.tasks = structuredClone(decision.tasks);
      return { version: 2, ...decision, ...(decision.mode === "plan" ? { tasks: structuredClone(state.tasks) } : {}) };
    }
    if (path.endsWith("tasks:plan")) {
      // The server derives resume access from the request; mirror that for planned tasks.
      state.tasks = payload.tasks.map((item) => ({ depends_on: [], status: "planned", proposal_ids: [], ...item,
        context_refs: [...(autoResume && item.workflow !== "resource_catalog" ? [{ type: "resume", id: autoResume }] : []),
          ...(item.context_refs ?? []).filter((ref) => ref.type !== "resume")] }));
      return { tasks: structuredClone(state.tasks) };
    }
    const status = path.match(/\/tasks\/([^/]+):status$/);
    if (status) { applyTaskStatus(state.tasks, status[1], payload); return { tasks: structuredClone(state.tasks) }; }
    if (/\/tasks\/[^/]+\/materials$/.test(path)) return { materials, sources: [] };
    if (path.endsWith("targets:resolve")) return { status: "resolved", target: { ...context.target, resume_id: payload.resume_id ?? "11" }, candidates: [] };
    if (path.endsWith("context:read")) return structuredClone(context);
    if (path.endsWith("diagnoses")) return { diagnosis: { target: payload.target }, diagnosis_fingerprint: `diag:${"a".repeat(64)}` };
    if (path.endsWith("proposals:v2")) { const proposal = { id: `proposal-${proposals.length + 1}` }; proposals.push({ ...payload, id: proposal.id }); return { proposal }; }
    if (path.endsWith("proposals:translation")) { const proposal = { id: `proposal-${proposals.length + 1}` }; proposals.push({ ...payload, id: proposal.id }); return { proposal }; }
    if (path.endsWith("tool-events")) { toolEvents.push(payload); return {}; }
    if (path.endsWith("llm-calls")) return { recorded: true };
    if (path.endsWith("messages:complete")) { completed.push(payload); return { sequence_no: payload.user_sequence_no + 1 }; }
    if (path.endsWith("resumes:resolve-reference")) return { status: "resolved", target: { ...context.target, resume_id: payload.resume_id ?? "11" }, candidates: [] };
    if (path.endsWith("resources:list")) return { resources: [{ type: "resume", id: "11", label: "张三的简历" }] };
    if (path.endsWith("materials:search")) return { sources: [] };
    return undefined;
  };
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const path = new URL(url).pathname;
    const payload = options.body ? JSON.parse(options.body) : null;
    const source = options.headers?.["X-Agent-User-Sequence"] ?? null;
    calls.push({ path, source, payload });
    try {
      const handled = backend[path.split("/").pop()]?.(payload, state) ?? routes(path, payload, source);
      assert.notEqual(handled, undefined, `unexpected endpoint ${path}`);
      return new Response(JSON.stringify(handled), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (error) {
      if (error.status) return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers: { "Content-Type": "application/json" } });
      throw error;
    }
  });
  let handle;
  const run = async (overrides = {}) => {
    const controller = overrides.controller ?? new AbortController();
    return executeAgentRun({
      config: { drawofferBaseUrl: "http://app.test", drawofferToken: "fictional-token", toolTimeoutMs: 10000 },
      runId: "run", userSequenceNo: 1, submissionKey: "initial_1", content: "请诊断这份简历", history: [], contextMaterials: [],
      signal: controller.signal, emit: (type, data) => events.push({ type, ...data }),
      onReady: (value) => { handle = value; },
      modelFactory: async (configs) => {
        const modelRuntime = await configuredModels(configs);
        modelRuntime.modelRuntime.streamSimple = (_model, ctx) => {
          const output = createAssistantMessageEventStream();
          void (async () => {
            const index = state.turn++;
            const turn = { index, tools: ctx.tools.map((tool) => tool.name), prompt: JSON.stringify(ctx.messages.at(-1)) };
            turns.push(turn);
            assert.ok(index < script.length, `unexpected extra model turn ${index} with tools ${turn.tools}`);
            const entry = typeof script[index] === "function" ? await script[index]({ ...turn, handle, state }) : script[index];
            const spec = Array.isArray(entry) ? { content: entry } : entry.content ? entry : { content: [entry] };
            const content = spec.content;
            const message = { role: "assistant", api: "openai-completions", provider: modelRuntime.model.provider, model: "fake", content,
              stopReason: spec.stopReason ?? (content.some((part) => part.type === "toolCall") ? "toolUse" : "stop"), timestamp: Date.now(),
              usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            output.push({ type: "start", partial: message });
            for (const part of content) if (part.type === "text") {
              output.push({ type: "text_delta", contentIndex: 0, delta: part.text, partial: message });
              await runtime.afterText?.({ index, handle });
            }
            output.push({ type: "done", reason: message.stopReason, message });
          })().catch((error) => {
            output.push({ type: "error", reason: "error", error: { role: "assistant", content: [], stopReason: "error", errorMessage: error.message } });
          });
          return output;
        };
        return modelRuntime;
      },
      ...overrides,
    });
  };
  return {
    run, calls, turns, events, proposals, toolEvents, completed, state,
    get handle() { return handle; },
    toolSets: () => turns.map((turn) => turn.tools.slice().sort()),
    statuses: () => Object.fromEntries(state.tasks.map((item) => [item.id, item.status])),
    called: (suffix) => calls.filter((item) => item.path.endsWith(suffix)),
    eventTypes: (type) => events.filter((event) => event.type === type),
  };
}
