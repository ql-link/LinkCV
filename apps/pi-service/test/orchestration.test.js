import assert from "node:assert/strict";
import test from "node:test";

import { call, createHarness, say, task, withResume, wholeResumeContext } from "./support/harness.js";

const submit = (id, summary = "结论") => [call(id, "submit_task_result", { status: "completed", summary })];
const READ_ONLY_TOOLS = ["search_resume_materials", "submit_task_result"];
const noFlowTools = (harness) => harness.turns.every((turn) => !turn.tools.some((name) => (
  ["read", "start_agent_task", "finish_agent_task", "begin_final_response", "list_user_resources", "resolve_resume_target"].includes(name))));

test("a pure diagnosis takes two model turns and never opens a proposal tool", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_diagnosis", { context_refs: withResume() })],
    script: [submit("s1", "最重要的问题是项目缺少结果。"), [say("项目描述缺少结果。")]],
  });
  await h.run();
  assert.equal(h.turns.length, 2);
  assert.deepEqual(h.toolSets(), [READ_ONLY_TOOLS.slice().sort(), []]);
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
  assert.equal(h.proposals.length, 0);
  assert.equal(h.called("proposals:v2").length, 0);
  assert.match(h.turns[0].prompt, /<resume>/);
  assert.match(h.turns[1].prompt, /最重要的问题是项目缺少结果/);
  assert.ok(h.eventTypes("assistant.delta").length > 0);
  assert.ok(noFlowTools(h));
  assert.equal(h.called("tasks:plan").length, 0);
  assert.equal(h.called("diagnoses").length, 0, "a read-only diagnosis never asks for a proposal fingerprint");
});

test("selected resume access needs no identity step or model resolution", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_diagnosis", { context_refs: withResume() })],
    script: [submit("s1"), [say("好的")]],
  });
  await h.run();
  assert.ok(h.turns.every((turn) => !turn.tools.includes("resolve_resume_reference")));
  assert.equal(h.called("resumes:resolve-reference").length, 0);
});

test("diagnosis then interview preparation run one task at a time in three turns", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" },
    tasks: [task("intent_1", "resume_diagnosis", { context_refs: withResume() }),
      task("intent_2", "interview_guide", { depends_on: ["intent_1"], context_refs: withResume() })],
    script: [submit("s1", "诊断结论"), submit("s2", "面试建议"), [say("先看诊断，再看面试。")]],
  });
  await h.run();
  assert.equal(h.turns.length, 3);
  assert.deepEqual(h.statuses(), { intent_1: "completed", intent_2: "completed" });
  const order = h.called(":status").map((item) => `${item.path.match(/tasks\/([^/]+):/)[1]}:${item.payload.status}`);
  assert.deepEqual(order, ["intent_1:running", "intent_1:completed", "intent_2:running", "intent_2:completed"]);
  assert.match(h.turns[2].prompt, /诊断结论[\s\S]*面试建议/);
});

test("a single edit is two turns and one pending proposal built from a server-read block", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_edit", { context_refs: withResume() })],
    script: [
      [call("p1", "submit_resume_edit_plan", { mode: "polish_local", summary: "精简第二条", edits: [
        { block_id: "node_project000000002", op: "replace_target_text", new_text: "优化 MySQL 慢查询，降低接口延迟。", summary: "补充结果" }] })],
      [say("已生成一份待确认修改。")],
    ],
  });
  await h.run();
  assert.equal(h.turns.length, 2);
  assert.deepEqual(h.toolSets()[0], ["request_user_input", "search_resume_materials", "submit_resume_edit_plan"]);
  assert.equal(h.proposals.length, 1);
  assert.equal(h.proposals[0].operations[0].target.block_id, "node_project000000002");
  assert.equal(h.proposals[0].operations[0].new_text, "优化 MySQL 慢查询，降低接口延迟。");
  assert.equal(h.eventTypes("proposal.created").length, 1);
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
  assert.deepEqual(h.state.tasks[0].proposal_ids, ["proposal-1"]);
  assert.equal(h.called("context:read").length, 1, "the runtime reads the resume once; the model never asks");
});

test("a multi-edit plan with one unreadable target keeps the other proposals and is partial", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_edit", { context_refs: withResume() })],
    script: [
      [call("p1", "submit_resume_edit_plan", { mode: "polish_local", summary: "三处修改", edits: [
        { block_id: "node_summary000000001", op: "replace_target_text", new_text: "后端工程师", summary: "精简" },
        { block_id: "node_unread00000000001", op: "delete_target", new_text: "", summary: "未读取的块" },
        { block_id: "node_project000000001", op: "delete_target", new_text: "", summary: "删除" }] })],
      [say("两处已生成，一处未完成。")],
    ],
  });
  await h.run();
  assert.equal(h.proposals.length, 2);
  assert.deepEqual(h.statuses(), { intent_1: "partial" });
  assert.equal(h.state.tasks[0].error_code, "PATCH_OUT_OF_SCOPE");
  assert.match(h.turns[1].prompt, /第 2 项 PATCH_OUT_OF_SCOPE/);
});

test("a model that never submits is reminded once, the task fails, and the next task still runs", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" },
    tasks: [task("intent_1", "interview_guide", { context_refs: withResume() }), task("intent_2", "career_planning", { context_refs: withResume() })],
    script: [[say("我来分析一下。")], [say("仍然只有文字。")], submit("s2", "规划建议"), [say("第二项完成。")]],
  });
  await h.run();
  assert.equal(h.turns.length, 4);
  assert.match(h.turns[1].prompt, /你还没有调用 submit_task_result/);
  assert.deepEqual(h.statuses(), { intent_1: "failed", intent_2: "completed" });
  assert.equal(h.state.tasks[0].error_code, "AGENT_STEP_RESULT_MISSING");
});

test("a task whose dependency failed is blocked without reading any material", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" },
    tasks: [task("intent_1", "interview_guide", { context_refs: withResume() }),
      task("intent_2", "career_planning", { depends_on: ["intent_1"], context_refs: withResume() })],
    script: [[say("没有提交")], [say("还是没有")], [say("两项都没有完成。")]],
  });
  await h.run();
  assert.deepEqual(h.statuses(), { intent_1: "failed", intent_2: "blocked" });
  assert.equal(h.state.tasks[1].error_code, "AGENT_TASK_DEPENDENCY_PENDING");
  assert.equal(h.called("/intent_2/materials").length, 0);
  assert.ok(h.turns.at(-1).tools.length === 0);
});

test("ordinary conversation replies directly with no tools and no tasks", async (t) => {
  const h = createHarness(t, { intent: { mode: "conversation" }, script: [[say("你好，我可以帮你看简历。")]] });
  await h.run({ content: "你好" });
  assert.deepEqual(h.toolSets(), [[]]);
  assert.equal(h.called(":status").length, 0);
  assert.equal(h.completed.length, 1);
  assert.equal(h.completed[0].content, "你好，我可以帮你看简历。");
});

test("clarification only accepts the categories the intent allowed, then ends the run", async (t) => {
  const question = (purpose) => ({ purpose, id: "scope", header: "范围", question: "需要修改哪个范围？", options: [{ id: "a", label: "局部" }, { id: "b", label: "整份" }] });
  const h = createHarness(t, {
    intent: { mode: "clarify", clarification_purposes: ["edit_scope"] },
    script: [[call("c1", "request_user_input", { questions: [question("missing_fact")] })], [call("c2", "request_user_input", { questions: [question("edit_scope")] })]],
  });
  await h.run({ content: "帮我改一下" });
  assert.equal(h.turns.length, 2);
  assert.deepEqual(h.toolSets(), [["request_user_input"], ["request_user_input"]]);
  assert.ok(h.events.some((event) => event.type === "assistant.activity.status" && event.errorCode === "AGENT_INTENT_CLARIFICATION_SCOPE_INVALID"));
  assert.equal(h.eventTypes("clarification.requested").length, 1);
  assert.equal(h.completed.length, 1);
  assert.ok(h.completed[0].clarification);
  assert.equal(h.called(":status").length, 0);
});

test("a task that needs the user is blocked, the run stops, and later tasks stay planned", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" },
    tasks: [task("intent_1", "resume_diagnosis", { context_refs: withResume() }), task("intent_2", "interview_guide", { context_refs: withResume() })],
    script: [[call("n1", "submit_task_result", { status: "needs_input", summary: "需要确认", question: {
      purpose: "content_location", id: "which", header: "位置", question: "要诊断哪一段？", options: [{ id: "a", label: "工作经历" }, { id: "b", label: "项目" }] } })]],
  });
  await h.run();
  assert.equal(h.turns.length, 1);
  assert.deepEqual(h.statuses(), { intent_1: "blocked", intent_2: "planned" });
  assert.equal(h.state.tasks[0].error_code, "USER_INPUT_REQUIRED");
  assert.equal(h.completed.length, 1);
  assert.equal(h.eventTypes("assistant.delta").filter((event) => !/继续前需要确认/.test(event.delta)).length, 0);
});

test("without an intent result the chat model plans once, then the runtime executes the plan", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "fallback", reason: "INTENT_TIMEOUT", routing_rules: "唯一的路由规则 RULES-42" },
    script: [
      [call("p1", "plan_agent_request", { tasks: [{ id: "diagnose", workflow: "resume_diagnosis", output: "advice", label: "诊断" }] })],
      submit("s1", "诊断结论"),
      [say("诊断完成。")],
    ],
  });
  await h.run();
  assert.deepEqual(h.toolSets()[0], ["plan_agent_request", "reply_directly", "request_user_input"]);
  assert.match(h.turns[0].prompt, /唯一的路由规则 RULES-42/);
  assert.equal(h.called("tasks:plan").length, 1);
  assert.deepEqual(h.statuses(), { diagnose: "completed" });
  assert.equal(h.turns.length, 3);
});

test("the fallback can also reply directly without creating tasks", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "fallback", reason: "LLM_TIMEOUT", routing_rules: "规则" },
    script: [[call("r1", "reply_directly")], [say("你好！")]],
  });
  await h.run({ content: "你好" });
  assert.equal(h.called("tasks:plan").length, 0);
  assert.deepEqual(h.toolSets(), [["plan_agent_request", "reply_directly", "request_user_input"].sort(), []]);
  assert.equal(h.completed[0].content, "你好！");
});

test("a resume the system cannot determine is resolved in its own step, then diagnosed", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_diagnosis")],
    script: [[call("i1", "resolve_resume_reference", { title: "张三的简历" })], submit("s1", "诊断结论"), [say("完成。")]],
  });
  await h.run({ content: "请诊断张三的简历" });
  assert.deepEqual(h.toolSets()[0], ["request_user_input", "resolve_resume_reference"]);
  assert.deepEqual(h.toolSets()[1], READ_ONLY_TOOLS.slice().sort());
  assert.equal(h.called("resumes:resolve-reference").length, 1);
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
  assert.equal(h.turns.length, 3);
});

test("an unresolved resume identity blocks the task instead of failing it", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_diagnosis")],
    script: [[say("我不确定是哪一份。")], [say("仍不确定。")], [say("需要你告诉我是哪份简历。")]],
  });
  await h.run({ content: "请诊断简历" });
  assert.deepEqual(h.statuses(), { intent_1: "blocked" });
  assert.equal(h.state.tasks[0].error_code, "RESUME_IDENTITY_UNRESOLVED");
  assert.equal(h.called("context:read").length, 0);
});

test("a translation keeps the original style and sends only the translated body", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_translation", { context_refs: withResume() })],
    script: [
      [call("t1", "submit_translation", { target_language: "en", proposed_title: "Zhang San Resume", data: { identity: { name: "Zhang San" } }, summary: "整份翻译" })],
      [say("已生成翻译提案。")],
    ],
  });
  await h.run();
  assert.deepEqual(h.toolSets()[0], ["request_user_input", "submit_translation"]);
  assert.equal(h.proposals.length, 1);
  assert.deepEqual(h.proposals[0].style, wholeResumeContext.style);
  assert.deepEqual(h.proposals[0].data, { identity: { name: "Zhang San" } });
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
});

test("a resource catalog is listed by the runtime and never reads a resume body", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resource_catalog")],
    script: [submit("s1", "你有一份简历"), [say("你有一份简历。")]],
  });
  await h.run({ content: "我有哪些简历" });
  assert.deepEqual(h.toolSets()[0], ["submit_task_result"]);
  assert.equal(h.called("resources:list").length, 1);
  assert.equal(h.called("context:read").length, 0);
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
});

test("steps and their runtime actions are reported for the progress panel", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_diagnosis", { context_refs: withResume() })],
    script: [submit("s1"), [say("完成")]],
  });
  await h.run();
  const reported = h.events.filter((event) => event.type === "assistant.activity.status").map((event) => `${event.label}:${event.status}`);
  assert.ok(reported.includes("任务 intent_1：读取简历:running") && reported.includes("任务 intent_1：读取简历:succeeded"));
  assert.ok(reported.includes("诊断简历:succeeded"));
  assert.ok(h.toolEvents.some((event) => event.tool_name === "runtime_step" && event.status === "succeeded"));
  assert.ok(h.toolEvents.every((event) => event.tool_name !== "read_skill"));
});

test("a reply that finishes while a new message waits starts the next round with the new intent", async (t) => {
  const planFor = (id) => ({ mode: "plan", tasks: [task(id, "career_planning", { context_refs: withResume("2") })] });
  const activations = [];
  const h = createHarness(t, {
    intentFor: (source) => (source === "3" ? planFor("second") : planFor("first")),
    script: [submit("s1", "已有结果"), [say("第一条完整回复")], submit("s2", "新结果"), [say("第二条完整回复")]],
    runtime: { afterText: async ({ index, handle }) => {
      if (index === 1) await handle.submit({ content: "切换后继续", idempotency_key: "steer_native_1", contexts: [{ type: "resume", id: "2", version: "1" }], replace_inherited_resume: true });
    } },
    backend: {
      "steering:activate": (payload, state) => {
        activations.push(state.tasks.map((item) => item.id));
        return { receipt: { state: "accepted", user_sequence_no: 3 }, contextMaterials: [], selectionContext: null,
          conversationMemory: { schema_version: 1, truncated: false, events: [] } };
      },
      "steering:ack": () => ({}),
    },
  });
  await h.run({ content: "第一项工作" });
  assert.equal(h.turns.length, 4);
  assert.deepEqual(h.completed.map((item) => [item.user_sequence_no, item.content]), [[1, "第一条完整回复"], [3, "第二条完整回复"]]);
  assert.deepEqual(activations, [["first"]], "the earlier reply is durable before the input is activated");
  const activation = h.calls.findIndex((item) => item.path.endsWith("steering:activate"));
  assert.equal(h.calls[activation].source, "1");
  assert.ok(h.calls.slice(activation + 1).filter((item) => !item.path.endsWith("llm-calls")).every((item) => item.source === "3"));
  assert.equal(h.handle.lookup("steer_native_1").state, "applied");
  assert.deepEqual(h.called("intent:recognize").map((item) => item.source), ["1", "3"]);
  assert.deepEqual(h.statuses(), { second: "completed" });
});

test("a waiting input is not activated while a clarification ends the run", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "clarify", clarification_purposes: ["edit_scope"] },
    script: [async ({ handle }) => {
      await handle.submit({ content: "仍待发送", idempotency_key: "waiting_stop_input" });
      return [call("c1", "request_user_input", { questions: [{ purpose: "edit_scope", id: "scope", header: "范围", question: "请选择范围", options: [{ id: "a", label: "职业规划" }, { id: "b", label: "面试准备" }] }] })];
    }],
  });
  await h.run({ content: "需要澄清的工作" });
  assert.equal(h.called("steering:activate").length, 0);
  assert.equal(h.completed.length, 1);
  assert.equal(h.handle.lookup("waiting_stop_input").state, "not_applied");
});

test("cancelling the run does not activate a waiting input", async (t) => {
  const controller = new AbortController();
  const h = createHarness(t, {
    intent: { mode: "conversation" },
    script: [async ({ handle }) => {
      await handle.submit({ content: "仍待发送", idempotency_key: "waiting_cancel_input" });
      controller.abort("cancelled");
      return { content: [], stopReason: "aborted" };
    }],
  });
  await assert.rejects(h.run({ controller, content: "你好" }));
  assert.equal(h.called("steering:activate").length, 0);
  assert.equal(h.completed.length, 0);
});

test("an intent response from another version stops the run before any task", async (t) => {
  const h = createHarness(t, { intent: { mode: "conversation" }, script: [] });
  h.calls.length = 0;
  t.mock.method(globalThis, "fetch", async (url) => new Response(JSON.stringify(
    new URL(url).pathname.endsWith("runtime-config")
      ? { provider: "fake", api: "openai-completions", model: "fake", api_key: "k", api_base: "https://fake.test/v1", route_id: "1", config_version: 1 }
      : { version: 1, mode: "conversation" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(h.run(), { code: "AGENT_INTENT_RESPONSE_INVALID" });
});

test("a long block shown only in part cannot be replaced whole", async (t) => {
  const long = "负责订单系统重构。".repeat(200);
  const context = structuredClone(wholeResumeContext);
  context.blocks[1].content = long;
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_edit", { context_refs: withResume() })], context,
    script: [
      [call("p1", "submit_resume_edit_plan", { mode: "polish_local", summary: "两处修改", edits: [
        { block_id: "node_project000000001", op: "replace_target_text", new_text: "主导订单系统重构。", summary: "截断块" },
        { block_id: "node_project000000002", op: "replace_target_text", new_text: "优化 MySQL 慢查询。", summary: "短块" }] })],
      [say("一处已生成。")],
    ],
  });
  await h.run();
  assert.match(h.turns[0].prompt, /内容过长/);
  assert.equal(h.proposals.length, 1);
  assert.equal(h.proposals[0].operations[0].target.block_id, "node_project000000002");
  assert.deepEqual(h.statuses(), { intent_1: "partial" });
  assert.equal(h.state.tasks[0].error_code, "TARGET_TOO_LONG_FOR_BLOCK_EDIT");
});

test("a plan saved with the earlier resume_edit/advice spelling still runs as a read-only diagnosis", async (t) => {
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_edit", { output: "advice", context_refs: withResume() })],
    script: [submit("s1", "项目缺少结果。"), [say("项目缺少结果。")]],
  });
  await h.run();
  assert.deepEqual(h.toolSets()[0], READ_ONLY_TOOLS.slice().sort());
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
  assert.equal(h.proposals.length, 0);
});

test("an entry-less section is rewritten through one frozen range instead of failing", async (t) => {
  const context = structuredClone(wholeResumeContext);
  for (const block of context.blocks) block.target.entry_id = null;
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_edit", { context_refs: withResume() })], context,
    script: [
      [call("p1", "submit_resume_edit_plan", { mode: "rewrite_entry_star", summary: "改写实习经历", edits: [
        { block_id: "node_project000000001", op: "replace_target_text", new_text: "主导订单系统重构，缩短发布周期。", summary: "补充结果" },
        { block_id: "node_project000000002", op: "replace_target_text", new_text: "优化 MySQL 慢查询。", summary: "补充动作" }] })],
      [say("已生成一份待确认修改。")],
    ],
  });
  await h.run();
  assert.equal(h.proposals.length, 1);
  const range = h.called("targets:resolve").find((item) => item.payload.start_node_id);
  assert.equal(range.payload.start_node_id, "node_project000000001");
  assert.equal(range.payload.end_node_id, "node_project000000002");
  assert.equal(h.called("diagnoses")[0].payload.scope, "range");
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
});

test("a resume selected in a later turn is the one that is read, not the one from earlier turns", async (t) => {
  const context = structuredClone(wholeResumeContext);
  context.resume_id = "22"; context.title = "张三的第二份简历";
  const memory = { schema_version: 1, truncated: false, events: [{
    memory_ref: "m:1:resume:11", relation: "selected", resource: { type: "resume", id: "11", label: "张三的简历" } }] };
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_diagnosis", { context_refs: withResume("22") })], context, autoResume: "22",
    script: [submit("s1", "第二份简历是后端简历。"), [say("第二份简历是后端简历。")]],
  });
  await h.run({
    userSequenceNo: 5, content: "这份简历是做什么的",
    contextMaterials: [{ type: "resume", id: "22", resume_id: "22", presentation: "mention", label: "张三的第二份简历", version: "1", content: {} }],
    conversationMemory: memory,
    history: [{ role: "user", content: "这份简历是做什么的" }, { role: "assistant", content: "这是第一份简历的说明。" }],
  });
  assert.deepEqual(h.called("targets:resolve").map((item) => item.payload.resume_id), ["22"]);
  assert.match(h.turns[0].prompt, /张三的第二份简历/);
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
});

test("a resume selected this turn is never asked about again, even when the model tries", async (t) => {
  const question = { purpose: "resume_identity", id: "which", header: "简历", question: "你指的是哪一份简历？", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
  const h = createHarness(t, {
    intent: { mode: "fallback", reason: "INTENT_DECISION_INCONSISTENT", routing_rules: "规则" }, autoResume: "22",
    script: [
      [call("c1", "request_user_input", { questions: [question] })],
      [call("p1", "plan_agent_request", { tasks: [{ id: "diagnose", workflow: "resume_diagnosis", output: "advice", label: "诊断" }] })],
      submit("s1", "这段实习负责订单系统。"),
      [say("这段实习负责订单系统。")],
    ],
  });
  await h.run({ contextMaterials: [{ type: "resume", id: "22", resume_id: "22", presentation: "mention", label: "简历 B", version: "1", content: {} }] });
  assert.equal(h.eventTypes("clarification.requested").length, 0);
  assert.ok(h.events.some((event) => event.type === "assistant.activity.status" && event.errorCode === "AGENT_RESUME_ALREADY_SELECTED"));
  assert.deepEqual(h.statuses(), { diagnose: "completed" });
});

test("a follow-up without @ reads the resume from the previous turn through short-term memory", async (t) => {
  const memory = { schema_version: 1, truncated: false, events: [{
    memory_ref: "m:1:resume:11", relation: "selected", resource: { type: "resume", id: "11", label: "张三的简历" } }] };
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "resume_diagnosis", { context_refs: [] })], autoResume: "11",
    script: [
      [call("r1", "resolve_resume_reference", { memory_ref: "m:1:resume:11", relation: "continuation", referring_text: "告诉我第一段实习经历的职位" })],
      submit("s1", "第一段实习的职位是后端开发实习生。"),
      [say("第一段实习的职位是后端开发实习生。")],
    ],
  });
  await h.run({
    userSequenceNo: 5, content: "告诉我第一段实习经历的职位", contextMaterials: [], conversationMemory: memory,
    history: [{ role: "user", content: "分析我的第一段实习经历。" }, { role: "assistant", content: "第一段实习写得较具体。" }],
  });
  assert.deepEqual(h.called("resumes:resolve-reference").map((item) => item.payload.memory_ref), ["m:1:resume:11"]);
  assert.equal(h.eventTypes("clarification.requested").length, 0);
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
});

test("a follow-up about an earlier @ job or dataset can be read through memory even when no resume is involved", async (t) => {
  const memory = { schema_version: 1, truncated: false, events: [{
    memory_ref: "m:1:job:31", relation: "selected", resource: { type: "job", id: "31", label: "后端开发岗位" } }] };
  const h = createHarness(t, {
    intent: { mode: "plan" }, tasks: [task("intent_1", "material_lookup", { context_refs: [] })], autoResume: null,
    script: [
      [call("r1", "resolve_resource_reference", { memory_ref: "m:1:job:31", relation: "continuation", referring_text: "这个岗位要求什么" })],
      submit("s1", "岗位要求熟悉 Python。"),
      [say("岗位要求熟悉 Python。")],
    ],
  });
  await h.run({ userSequenceNo: 5, content: "这个岗位要求什么", contextMaterials: [], conversationMemory: memory });
  assert.equal(h.called("resources:resolve-reference").length, 1);
  assert.deepEqual(h.statuses(), { intent_1: "completed" });
});
