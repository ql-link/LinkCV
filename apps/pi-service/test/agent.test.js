import assert from "node:assert/strict";
import test from "node:test";

import {
  agentUsage,
  assertAgentCompleted,
  buildAgentConversation,
  createAssistantOutputFilter,
  createResumeContextPolicy,
  createSerialExecutor,
  createSkillReadTool,
  enableToolOnce,
  explicitNumberedGoalCount,
  isExplicitResumeReference,
  isModelDefinition,
  clarificationFallbackText,
  configuredModel,
  executeLocalResumeEditPlan,
  formatContextCatalog,
  formatContextMaterials,
  materializeProposalOperations,
  prepareLocalResumeEditPlanArguments,
  proposalCallKey,
  retryIdempotentProposal,
  translationCallKey,
  SYSTEM_PROMPT,
  USER_FACING_RESPONSE_PROMPT,
} from "../src/runtime/agent.js";
import { validateContextMaterials } from "../src/context.js";

const codedTestError = (code) => Object.assign(new Error(code), { code });

test("selected resume identity wins over duplicate title search and model supplied IDs", async () => {
  const calls = [];
  const policy = createResumeContextPolicy([{ type: "resume", id: "83", resume_id: "83" }]);
  const result = await policy.resolveReference({
    resolveTarget: async (params) => { calls.push(params); return { status: "resolved", target: { resume_id: params.resume_id } }; },
    resolveResumeReference: async () => { throw new Error("must not search duplicate titles"); },
  }, { title: "张三的简历", resume_id: "78" });
  assert.equal(result.target.resume_id, "83");
  assert.deepEqual(calls, [{ resume_id: "83", scope_hint: "resume" }]);
  assert.equal(policy.canListResources(null), false);
  assert.equal(policy.canListResources("resume_edit"), false);
  assert.equal(policy.canListResources("resource_catalog"), true);
  assert.deepEqual(policy.unresolvedQuestions([
    { purpose: "resume_identity", id: "which_resume" },
    { purpose: "edit_scope", id: "scope" },
  ]), [{ purpose: "edit_scope", id: "scope" }]);
});

test("without a selected resume, explicit names can be resolved and identity clarified", async () => {
  const policy = createResumeContextPolicy([{ type: "resume_version", id: "83", resume_id: "83" }]);
  const params = { title: "张三的简历" };
  const result = await policy.resolveReference({ resolveResumeReference: async (value) => value }, params);
  assert.deepEqual(result, params);
  assert.equal(policy.canListResources("resume_edit"), true);
  assert.equal(policy.unresolvedQuestions([{ purpose: "resume_identity" }]).length, 1);
});

test("system prompt identifies the assistant as LinkResume", () => {
  assert.match(SYSTEM_PROMPT, /你是 LinkResume 的职业与简历智能助手/);
  assert.match(SYSTEM_PROMPT, /career-assistant-router/);
  assert.match(SYSTEM_PROMPT, /list_user_resources/);
  assert.match(SYSTEM_PROMPT, /resolve_resume_reference/);
  assert.match(SYSTEM_PROMPT, /begin_final_response/);
  assert.match(SYSTEM_PROMPT, /临时工作过程/);
  assert.match(SYSTEM_PROMPT, /不绑定或改写会话/);
  assert.doesNotMatch(SYSTEM_PROMPT, /通过 `@`/);
  assert.doesNotMatch(SYSTEM_PROMPT, new RegExp(["Link", "CV"].join(""), "i"));
});

test("system prompt applies the user-facing response style after agent policy", () => {
  assert.match(USER_FACING_RESPONSE_PROMPT, /第一句话必须包含用户问题的答案/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /一至三句连续正文/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /这是硬上限/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /不能成为新的事项、单独段落或列表后的补充/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /必须使用真正的 Markdown 列表/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /不得用正文中的“第一、第二、第三”模拟列表/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /恰好对应数量的 Markdown 列表项/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /整项使用一至两句完整句子/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /最多三个/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /只报告本轮实际观察到的结果/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /内容说完后立即结束/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /在内部静默检查输出形状/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /删除“其次”“另外”“同时”等引出的次要事项/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /不得为了说明优先级而提及、对比或概括其他问题/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /列表后不得再有任何文字/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /“只分析，不修改”是行为边界/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /先重写草稿再输出/);
  assert.ok(
    SYSTEM_PROMPT.indexOf("你是 LinkResume 的简历智能助手") <
      SYSTEM_PROMPT.indexOf("以下规则只约束用户最终能够看到的自然语言回复"),
  );
  assert.doesNotMatch(SYSTEM_PROMPT, /Claude Code|IS_TEXT_OUTPUT_VISIBLE_TO_USER/);
});

test("current structured clarification answers are authoritative in the agent prompt", () => {
  const prompt = buildAgentConversation({
    history: [{ role: "assistant", content: "你想修改哪一部分？" }],
    clarificationAnswers: [{
      question_id: "scope",
      option_id: "internship",
      value: "实习经历",
    }],
    content: "修改范围：其他展示文本",
  });

  assert.match(prompt, /本轮权威值/);
  assert.match(prompt, /"question_id":"scope"/);
  assert.match(prompt, /"value":"实习经历"/);
  assert.match(prompt, /用户本轮请求/);
});

test("proposal operations use only server-read locators and hashes", () => {
  const target = {
    resume_id: "88",
    base_lock_version: 1,
    surface: "editor",
    section: "skills",
    entry_id: null,
    field: "markdown",
    item_id: null,
    block_id: "node_skillblock000001",
    selected_text: "Go：能够构建服务。",
    expected_text_hash: `sha256:${"a".repeat(64)}`,
  };
  assert.deepEqual(
    materializeProposalOperations(
      [{
        op: "replace_target_text",
        block_id: target.block_id,
        new_text: "Go：使用 Gin 构建服务。",
        target: { resume_id: "999" },
        expected_text_hash: `sha256:${"b".repeat(64)}`,
      }],
      { target, blocks: [{ target }] },
    ),
    [{
      op: "replace_target_text",
      target,
      new_text: "Go：使用 Gin 构建服务。",
      expected_text_hash: target.expected_text_hash,
    }],
  );
  assert.throws(
    () => materializeProposalOperations(
      [{ op: "replace_target_text", block_id: "node_unknownblock0001", new_text: "x" }],
      { target, blocks: [{ target }] },
    ),
    /PATCH_OUT_OF_SCOPE/,
  );
  assert.deepEqual(
    materializeProposalOperations(
      [{ op: "delete_target", block_id: target.block_id, new_text: "" }],
      { target, blocks: [{ target }] },
    ),
    [{
      op: "delete_target",
      target,
      new_text: "",
      expected_text_hash: target.expected_text_hash,
    }],
  );
});

test("serial executor never overlaps stateful agent tools", async () => {
  const executeSerially = createSerialExecutor();
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const run = (value) => executeSerially(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push(`start:${value}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(`end:${value}`);
    active -= 1;
  });

  await Promise.all([run(1), run(2), run(3)]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ["start:1", "end:1", "start:2", "end:2", "start:3", "end:3"]);
});

test("local edit plan normalizes deletion text without hiding missing replacement text", () => {
  const prepared = prepareLocalResumeEditPlanArguments({
    tasks: [
      { quoted_text: "占位", match: "unique", op: "delete_target", summary: "删除占位" },
      { quoted_text: "旧内容", match: "unique", op: "replace_target_text", summary: "替换内容" },
    ],
  });

  assert.equal(prepared.tasks[0].new_text, "");
  assert.equal("new_text" in prepared.tasks[1], false);
});

test("skill reads opt into Pi sequential execution", () => {
  assert.equal(createSkillReadTool().executionMode, "sequential");
});

test("resource catalog activation does not duplicate an already enabled tool", () => {
  const updates = [];
  const session = {
    getActiveToolNames: () => ["read", "list_user_resources"],
    setActiveToolsByName: (names) => updates.push(names),
  };
  enableToolOnce(session, "list_user_resources");
  assert.deepEqual(updates, []);
  enableToolOnce({ ...session, getActiveToolNames: () => ["read"] }, "list_user_resources");
  assert.deepEqual(updates, [["read", "list_user_resources"]]);
});

test("resource listing cannot turn an unmentioned resume into an explicit target", () => {
  assert.equal(isExplicitResumeReference({ title: "张三的简历" }, "帮我优化简历"), false);
  assert.equal(isExplicitResumeReference({ resume_id: "92" }, "帮我优化简历"), false);
  assert.equal(isExplicitResumeReference({ title: "张三的简历" }, "请优化张三的简历"), true);
  assert.equal(isExplicitResumeReference({ resume_id: "92" }, "请优化 ID 92 的简历"), true);
  assert.equal(isExplicitResumeReference(
    { title: "张三的简历" }, "按我选的简历继续", [{ value: "张三的简历" }],
  ), true);
});

test("explicitly numbered goals over the task limit cannot be silently truncated", () => {
  const nineGoals = "请分别完成 9 项：1分析简历，2准备面试，3复盘面试，4职业规划，5标题建议，6翻译简历，7修改教育经历，8修改项目经历，9列出资料";
  assert.equal(explicitNumberedGoalCount(nineGoals), 9);
  assert.equal(explicitNumberedGoalCount("1分析简历，2准备面试，3职业规划"), 3);
  assert.equal(explicitNumberedGoalCount("我有 9 年经验，请给 3 个建议"), 0);
});

test("compound local edit plan freezes selectors and creates proposals serially", async () => {
  const target = (blockId, content, extra = {}) => ({
    resume_id: "88",
    base_lock_version: 1,
    surface: "editor",
    section: "section-projects",
    entry_id: null,
    field: "markdown",
    block_id: blockId,
    selected_text: content,
    expected_text_hash: `sha256:${blockId.padEnd(64, "a").slice(0, 64)}`,
    ...extra,
  });
  const fieldTarget = target("node_field0000000001", "asd", { section: "section-education", field: "location" });
  const parentTarget = target("node_entry0000000001", "LinkRag 项目", { entry_id: "node_entry0000000001" });
  const placeholderTargets = [
    target("node_bullet000000001", "1", { entry_id: "node_entry0000000001" }),
    target("node_bullet000000002", "1", { entry_id: "node_entry0000000001" }),
  ];
  const calls = [];
  let activeProposals = 0;
  let maximumActiveProposals = 0;
  const client = {
    resolveTarget: async ({ quoted_text: quotedText }) => {
      calls.push(`resolve:${quotedText}`);
      return { status: "resolved", target: quotedText === "asd" ? fieldTarget : parentTarget };
    },
    scopedContext: async ({ target: currentTarget, scope }) => {
      calls.push(`context:${currentTarget.block_id}:${scope}`);
      if (currentTarget === parentTarget) {
        return { target: parentTarget, blocks: placeholderTargets.map((item) => ({ target: item, content: "1" })) };
      }
      return { target: currentTarget, blocks: [{ target: currentTarget, content: currentTarget.selected_text }] };
    },
    diagnose: async ({ target: currentTarget }) => {
      calls.push(`diagnose:${currentTarget.block_id}`);
      return { diagnosis: { issues: [] }, diagnosis_fingerprint: `fingerprint:${currentTarget.block_id}` };
    },
    scopedProposal: async (payload) => {
      activeProposals += 1;
      maximumActiveProposals = Math.max(maximumActiveProposals, activeProposals);
      calls.push(`proposal:${payload.target.block_id}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeProposals -= 1;
      return { proposal: { id: `proposal-${payload.target.block_id}` } };
    },
  };
  const activities = [];
  const proposals = [];
  const tasks = [
    { quoted_text: "asd", match: "unique", op: "replace_target_text", new_text: "", summary: "删除占位字段" },
    { quoted_text: "1", parent_quoted_text: "LinkRag 项目", parent_scope: "entry", match: "all", op: "delete_target", new_text: "", summary: "删除占位条目" },
  ];
  const pending = executeLocalResumeEditPlan({
    client,
    resumeId: "88",
    tasks,
    toolCallId: "plan-1",
    onActivity: (activity) => activities.push(activity),
    onProposal: (proposal) => proposals.push(proposal),
  });
  tasks[0].quoted_text = "changed after execution started";
  const results = await pending;

  assert.equal(maximumActiveProposals, 1);
  assert.deepEqual(results.map((item) => item.status), ["succeeded", "succeeded"]);
  assert.equal(proposals.length, 3);
  assert.equal(calls[0], "resolve:asd");
  assert.deepEqual(calls.filter((item) => item.startsWith("proposal:")), [
    "proposal:node_field0000000001",
    "proposal:node_bullet000000001",
    "proposal:node_bullet000000002",
  ]);
  assert.ok(activities.some((item) => item.callKey === "plan-1:task:2:target:2" && item.status === "succeeded"));
});

test("compound local edit plan records a failed task once and continues", async () => {
  let resolveCalls = 0;
  const activities = [];
  const results = await executeLocalResumeEditPlan({
    client: {
      resolveTarget: async ({ quoted_text: quotedText }) => {
        resolveCalls += 1;
        if (quotedText === "missing") return { status: "not_found", target: null };
        return {
          status: "resolved",
          target: {
            resume_id: "88",
            base_lock_version: 1,
            surface: "editor",
            section: "section-skills",
            entry_id: null,
            field: "markdown",
            block_id: "node_skill00000000001",
            selected_text: quotedText,
            expected_text_hash: `sha256:${"a".repeat(64)}`,
          },
        };
      },
      scopedContext: async ({ target: currentTarget }) => ({ target: currentTarget, blocks: [{ target: currentTarget }] }),
      diagnose: async () => ({ diagnosis: {}, diagnosis_fingerprint: "fingerprint" }),
      scopedProposal: async ({ target: currentTarget }) => {
        if (currentTarget.selected_text === "broken") throw codedTestError("PATCH_OUT_OF_SCOPE");
        return { proposal: { id: "proposal-1" } };
      },
    },
    resumeId: "88",
    toolCallId: "plan-2",
    onActivity: (activity) => activities.push(activity),
    tasks: [
      { quoted_text: "missing", match: "unique", op: "delete_target", new_text: "", summary: "不存在" },
      { quoted_text: "broken", match: "unique", op: "delete_target", new_text: "", summary: "提案失败" },
      { quoted_text: "占位", match: "unique", op: "replace_target_text", new_text: "", summary: "删除占位" },
    ],
  });

  assert.equal(resolveCalls, 3);
  assert.deepEqual(results.map((item) => item.status), ["failed", "failed", "succeeded"]);
  assert.equal(results[0].error_code, "TARGET_NOT_FOUND");
  assert.equal(results[1].error_code, "PATCH_OUT_OF_SCOPE");
  assert.ok(activities.some((item) => (
    item.callKey === "plan-2:task:2:target:1" &&
    item.status === "failed" &&
    item.errorCode === "PATCH_OUT_OF_SCOPE"
  )));
});

test("compound edit retains proposals created before a later target fails", async () => {
  const target = (blockId) => ({
    resume_id: "88", base_lock_version: 1, surface: "editor", section: "projects",
    entry_id: "node_entry0000000001", field: "markdown", block_id: blockId,
    selected_text: "占位", expected_text_hash: `sha256:${"a".repeat(64)}`,
  });
  const first = target("node_bullet000000001");
  const second = target("node_bullet000000002");
  const proposals = [];
  const results = await executeLocalResumeEditPlan({
    client: {
      resolveTarget: async () => ({ status: "resolved", target: target("node_entry0000000001") }),
      scopedContext: async ({ target: current }) => current.block_id === "node_entry0000000001"
        ? { blocks: [first, second].map((item) => ({ target: item, content: "占位" })) }
        : { target: current, blocks: [{ target: current, content: "占位" }] },
      diagnose: async () => ({ diagnosis: {}, diagnosis_fingerprint: "fingerprint" }),
      scopedProposal: async ({ target: current }) => {
        if (current.block_id === second.block_id) throw codedTestError("TARGET_STALE");
        return { proposal: { id: "proposal-first" } };
      },
    },
    resumeId: "88", toolCallId: "plan-partial",
    tasks: [{ quoted_text: "占位", parent_quoted_text: "项目", match: "all", op: "delete_target", summary: "删除占位" }],
    onProposal: (proposal) => proposals.push(proposal.id),
  });
  assert.deepEqual(results, [{
    task: 1, status: "partial", error_code: "TARGET_STALE", proposal_ids: ["proposal-first"],
  }]);
  assert.deepEqual(proposals, ["proposal-first"]);
});

test("proposal retries use the same server idempotency key", () => {
  const target = { resume_id: "88", block_id: "node_bullet000000001", expected_text_hash: `sha256:${"a".repeat(64)}` };
  const operations = [{ op: "delete_target", new_text: "", target }];
  assert.equal(proposalCallKey("polish_local", target, operations), proposalCallKey("polish_local", target, operations));
  assert.notEqual(proposalCallKey("polish_local", target, operations), proposalCallKey("polish_local", target, [
    { op: "replace_target_text", new_text: "", target },
  ]));
  assert.notEqual(proposalCallKey("generate_from_materials", target, operations, ["source-1"]),
    proposalCallKey("generate_from_materials", target, operations, ["source-2"]));
});

test("an uncertain proposal response retries once with the same payload", async () => {
  const calls = [];
  const request = async (payload) => {
    calls.push(payload.call_key);
    if (calls.length === 1) throw Object.assign(new Error("gateway"), { status: 502 });
    return { proposal: { id: "proposal-existing" } };
  };
  const result = await retryIdempotentProposal(request, { call_key: "proposal:stable" });
  assert.equal(result.proposal.id, "proposal-existing");
  assert.deepEqual(calls, ["proposal:stable", "proposal:stable"]);
  let rejectedCalls = 0;
  await assert.rejects(retryIdempotentProposal(async () => {
    rejectedCalls += 1;
    throw Object.assign(codedTestError("TARGET_STALE"), { status: 409 });
  }, { call_key: "proposal:invalid" }), /TARGET_STALE/);
  assert.equal(rejectedCalls, 1);
});

test("translation retries preserve their proposal identity", () => {
  const target = { resume_id: "88", expected_text_hash: "sha256:original" };
  const params = { target_language: "en", proposed_title: "Resume", data: { identity: { name: "Zhang San" } }, style: {} };
  assert.equal(translationCallKey(target, params), translationCallKey(target, params));
  assert.notEqual(translationCallKey(target, params), translationCallKey(target, { ...params, target_language: "fr" }));
});

test("compound local edit plan rejects replacement tasks without replacement text", async () => {
  const activities = [];
  const results = await executeLocalResumeEditPlan({
    client: {},
    resumeId: "88",
    toolCallId: "plan-missing-text",
    onActivity: (activity) => activities.push(activity),
    tasks: [{ quoted_text: "旧内容", match: "unique", op: "replace_target_text", summary: "替换内容" }],
  });

  assert.deepEqual(results, [{
    task: 1,
    status: "failed",
    error_code: "TASK_NEW_TEXT_REQUIRED",
    proposal_ids: [],
  }]);
  assert.ok(activities.some((item) => (
    item.callKey === "plan-missing-text:task:1" &&
    item.status === "failed" &&
    item.errorCode === "TASK_NEW_TEXT_REQUIRED"
  )));
});

test("compound local edit plan stops immediately after cancellation", async () => {
  const controller = new AbortController();
  let resolveCalls = 0;
  const target = {
    resume_id: "88",
    base_lock_version: 1,
    surface: "editor",
    section: "section-skills",
    entry_id: null,
    field: "markdown",
    block_id: "node_skill00000000001",
    selected_text: "占位",
    expected_text_hash: `sha256:${"a".repeat(64)}`,
  };

  await assert.rejects(executeLocalResumeEditPlan({
    client: {
      resolveTarget: async () => {
        resolveCalls += 1;
        return { status: "resolved", target };
      },
      scopedContext: async () => {
        controller.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    },
    resumeId: "88",
    toolCallId: "plan-3",
    signal: controller.signal,
    tasks: [
      { quoted_text: "first", match: "unique", op: "delete_target", new_text: "", summary: "第一项" },
      { quoted_text: "second", match: "unique", op: "delete_target", new_text: "", summary: "第二项" },
    ],
  }), { name: "AbortError" });

  assert.equal(resolveCalls, 1);
});

test("agent completion accepts a successful assistant message", () => {
  assert.doesNotThrow(() => assertAgentCompleted({ role: "assistant", stopReason: "stop" }));
});

test("agent completion rejects provider failures hidden in assistant messages", () => {
  assert.throws(
    () => assertAgentCompleted({ role: "assistant", stopReason: "error", errorMessage: "Provider rejected the request." }),
    /AGENT_MODEL_REQUEST_FAILED/,
  );
});

test("agent completion classifies model timeouts", () => {
  assert.throws(
    () => assertAgentCompleted({ role: "assistant", stopReason: "error", errorMessage: "Request timed out." }),
    /AGENT_MODEL_TIMEOUT/,
  );
});

test("agent completion preserves a tool failure code exposed by the SDK", () => {
  assert.throws(
    () => assertAgentCompleted({
      role: "assistant",
      stopReason: "error",
      errorMessage: "Tool create_resume_change_proposal failed: PATCH_OUT_OF_SCOPE",
    }),
    /PATCH_OUT_OF_SCOPE/,
  );
});

test("agent usage exposes safe token and cost totals", () => {
  assert.deepEqual(agentUsage({
    tokens: { input: 120, output: 30 },
    cost: 0.00123456789,
  }), {
    inputTokens: 120,
    outputTokens: 30,
    estimatedCost: "0.00123457",
  });
  assert.equal(agentUsage({ tokens: { input: -1, output: 2 }, cost: 0 }), null);
});

test("agent completion rejects missing and aborted assistant messages", () => {
  assert.throws(() => assertAgentCompleted(undefined), /AGENT_EMPTY_RESPONSE/);
  assert.throws(
    () => assertAgentCompleted({ role: "assistant", stopReason: "aborted" }),
    /AGENT_ABORTED/,
  );
});

test("assistant output filter keeps tool-stage text in activity and streams final text immediately", () => {
  const emitted = [];
  let finalResponse = false;
  const filter = createAssistantOutputFilter(
    (type, payload) => emitted.push({ type, payload }),
    "run-1",
    { isFinalResponse: () => finalResponse },
  );

  filter({ type: "message_start", message: { role: "assistant" } });
  filter({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "I'll read the router skill." },
  });
  assert.deepEqual(emitted, [{
    type: "assistant.activity.delta",
    payload: { runId: "run-1", delta: "I'll read the router skill." },
  }]);

  filter({
    type: "message_update",
    assistantMessageEvent: { type: "toolcall_delta", delta: "内部工具参数" },
  });
  assert.equal(emitted.length, 1);

  filter({ type: "message_start", message: { role: "assistant" } });
  filter({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "I'll inspect the resume." },
  });

  finalResponse = true;
  filter({ type: "message_start", message: { role: "assistant" } });
  filter({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "面试重点包括" },
  });
  assert.equal(emitted.at(-1).type, "assistant.delta");
  filter({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "项目证据。" },
  });

  assert.deepEqual(emitted, [
    {
      type: "assistant.activity.delta",
      payload: { runId: "run-1", delta: "I'll read the router skill." },
    },
    {
      type: "assistant.activity.delta",
      payload: { runId: "run-1", delta: "\nI'll inspect the resume." },
    },
    {
      type: "assistant.delta",
      payload: { runId: "run-1", delta: "面试重点包括" },
    },
    {
      type: "assistant.delta",
      payload: { runId: "run-1", delta: "项目证据。" },
    },
  ]);
});

test("assistant output filter does not expose tool arguments", () => {
  const emitted = [];
  const filter = createAssistantOutputFilter((...event) => emitted.push(event), "run-2");
  filter({
    type: "message_update",
    assistantMessageEvent: { type: "toolcall_delta", delta: '{"secret":"value"}' },
  });
  filter({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "hidden reasoning" },
  });
  assert.deepEqual(emitted, []);
});

test("assistant output filter suppresses final prose after a clarification request", () => {
  const emitted = [];
  const filter = createAssistantOutputFilter(
    (...event) => emitted.push(event),
    "run-3",
    { shouldSuppress: () => true },
  );
  filter({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "请回答上面的问题。" },
  });
  filter({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
  assert.deepEqual(emitted, []);
});

test("clarification fallback remains readable for clients that ignore the structured event", () => {
  assert.equal(clarificationFallbackText({
    version: 1,
    questions: [{
      id: "scope",
      header: "修改范围",
      question: "要修改哪段经历？",
      options: [
        { id: "internship", label: "实习经历" },
        { id: "project", label: "项目经历" },
      ],
    }],
  }), "继续前需要确认：\n1. 要修改哪段经历？\n   选项：实习经历 / 项目经历 / 其他");
});

test("read tool can load a registered resume skill", async () => {
  let loadedPath;
  let started = false;
  const tool = createSkillReadTool(
    (path) => { loadedPath = path; },
    () => { started = true; },
  );
  const result = await tool.execute("read-1", {
    path: "resume-edit-workflow/SKILL.md",
  });

  assert.equal(started, true);
  assert.match(result.content[0].text, /name: resume-edit-workflow/);
  assert.equal(loadedPath, "resume-edit-workflow/SKILL.md");
});

test("read tool can load every P1 career workflow", async () => {
  const tool = createSkillReadTool();
  for (const path of [
    "resource-catalog/SKILL.md",
    "career-assistant-router/SKILL.md",
    "resume-translation/SKILL.md",
    "interview-guide/SKILL.md",
    "career-planning/SKILL.md",
    "resume-title-generator/SKILL.md",
  ]) {
    const result = await tool.execute(`read-${path}`, { path });
    assert.match(result.content[0].text, /^---/);
  }
});

test("read tool rejects files outside the registered skills directory", async () => {
  const tool = createSkillReadTool();

  await assert.rejects(
    tool.execute("read-2", { path: new URL("../../../package.json", import.meta.url).pathname }),
    /AGENT_SKILL_READ_FORBIDDEN/,
  );
});

test("context materials accept only bounded, unique authorized categories", () => {
  const materials = [{
    type: "job",
    id: "7",
    version: "2",
    label: "示例公司 · 后端工程师",
    updated_at: "2026-08-26T00:00:00Z",
    content: { description: "负责服务端开发" },
  }];

  assert.deepEqual(validateContextMaterials(materials), materials);
  assert.throws(
    () => validateContextMaterials([
      ...materials,
      { ...materials[0], id: "8" },
    ]),
    /INVALID_CONTEXT_MATERIALS/,
  );
  assert.throws(
    () => validateContextMaterials([{ ...materials[0], user_id: "other" }]),
    /INVALID_CONTEXT_MATERIALS/,
  );
});

test("parsed dataset materials are accepted with only their authorized content", () => {
  const material = {
    type: "dataset",
    id: "37",
    version: "1",
    label: "面试资料.md",
    updated_at: "2026-09-24T00:00:00Z",
    content: { dataset_markdown: "Go API 与 MySQL 项目经历" },
  };

  assert.deepEqual(validateContextMaterials([material]), [material]);
  assert.match(formatContextMaterials([material]), /Go API 与 MySQL 项目经历/);
  assert.throws(
    () => validateContextMaterials([{ ...material, content: { ...material.content, secret: "不可读取" } }]),
    /INVALID_CONTEXT_MATERIALS/,
  );
  assert.throws(
    () => validateContextMaterials([material, material]),
    /INVALID_CONTEXT_MATERIALS/,
  );
});

test("authorized materials are marked read-only and are the only prompt data", () => {
  const prompt = formatContextMaterials([{
    type: "resume",
    id: "1",
    version: "3",
    label: "张三的简历",
    updated_at: "2026-08-26T00:00:00Z",
    content: { resume_markdown: "已选择的经历" },
  }]);

  assert.match(prompt, /authorized-context-materials/);
  assert.match(prompt, /已选择的经历/);
  assert.doesNotMatch(prompt, /未选择的经历/);
});

test("planning catalog reveals authorized identities without another task's body", () => {
  const catalog = formatContextCatalog([
    { type: "resume", id: "1", version: "2", label: "张三的简历", updated_at: "2026-09-24T00:00:00Z", content: { resume_markdown: "PRIVATE_FIRST_TASK" } },
    { type: "job", id: "2", version: "3", label: "示例岗位", updated_at: "2026-09-24T00:00:00Z", content: { description: "PRIVATE_SECOND_TASK" } },
  ]);
  assert.match(catalog, /authorized-context-catalog/);
  assert.match(catalog, /张三的简历/);
  assert.match(catalog, /示例岗位/);
  assert.doesNotMatch(catalog, /PRIVATE_FIRST_TASK|PRIVATE_SECOND_TASK/);
});

test("gateway model definition is validated before Pi builds a provider", () => {
  const definition = {
    model_id: "z-ai/glm-4.6",
    display_name: "GLM 4.6",
    reasoning: true,
    input_modalities: ["text"],
    context_window: 200000,
    max_output: 32768,
    input_price_per_million: 0.6,
    output_price_per_million: 2.2,
    cache_read_price_per_million: null,
    cache_write_price_per_million: null,
  };

  assert.equal(isModelDefinition(definition), true);
  assert.equal(isModelDefinition({ ...definition, model_id: "" }), false);
  assert.equal(isModelDefinition({ ...definition, input_modalities: "text" }), false);
  assert.equal(isModelDefinition({ ...definition, context_window: 0 }), false);
  assert.equal(isModelDefinition({ ...definition, input_price_per_million: "0.6" }), false);
  assert.equal(isModelDefinition(null), false);
});

test("configuredModel registers the gateway provider and resolves the catalog model", async () => {
  const { model } = await configuredModel({
    providerId: "7",
    api: "openai-completions",
    apiKey: "fictional-gateway-key",
    baseUrl: "https://gateway.example.invalid/v1",
    definition: {
      model_id: "z-ai/glm-4.6",
      display_name: "GLM 4.6",
      reasoning: true,
      input_modalities: ["text", "image", "audio"],
      context_window: 200000,
      max_output: 32768,
      input_price_per_million: 0.6,
      output_price_per_million: 2.2,
      cache_read_price_per_million: 0.11,
      cache_write_price_per_million: null,
    },
  });

  assert.equal(model.id, "z-ai/glm-4.6");
  assert.equal(model.name, "GLM 4.6");
  assert.equal(model.api, "openai-completions");
  assert.equal(model.provider, "linkresume-p7");
  assert.equal(model.baseUrl, "https://gateway.example.invalid/v1");
  assert.equal(model.reasoning, true);
  assert.equal(model.contextWindow, 200000);
  assert.equal(model.maxTokens, 32768);
  // Only modalities Pi understands survive; prices default to zero when absent.
  assert.deepEqual(model.input, ["text", "image"]);
  assert.equal(model.cost.input, 0.6);
  assert.equal(model.cost.output, 2.2);
  assert.equal(model.cost.cacheRead, 0.11);
  assert.equal(model.cost.cacheWrite, 0);
});

test("configuredModel refuses models it cannot build", async () => {
  await assert.rejects(
    configuredModel({
      providerId: "7",
      api: "openai-completions",
      apiKey: "fictional-gateway-key",
      baseUrl: "https://gateway.example.invalid/v1",
      definition: null,
    }),
    /AGENT_MODEL_UNSUPPORTED/,
  );
  await assert.rejects(
    configuredModel({
      providerId: "7",
      api: "openai-completions",
      apiKey: "fictional-gateway-key",
      baseUrl: "",
      definition: {
        model_id: "z-ai/glm-4.6",
        display_name: "GLM 4.6",
        reasoning: false,
        input_modalities: ["text"],
        context_window: 1000,
        max_output: 100,
        input_price_per_million: null,
        output_price_per_million: null,
        cache_read_price_per_million: null,
        cache_write_price_per_million: null,
      },
    }),
    /AGENT_MODEL_UNSUPPORTED/,
  );
});
