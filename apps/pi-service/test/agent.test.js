import assert from "node:assert/strict";
import test from "node:test";

import {
  agentUsage,
  assertAgentCompleted,
  buildAgentConversation,
  createAssistantOutputFilter,
  configuredModel,
  configuredModels,
  streamWithRouteFallback,
  createResumeContextPolicy,
  validateMemoryReference,
  resumeReferenceParameters,
  resourceReferenceParameters,
  selectionForResume,
  referenceNeedsResolution,
  createSerialExecutor,
  explicitNumberedGoalCount,
  isExplicitResumeReference,
  clarificationFallbackText,
  formatContextCatalog,
  formatContextMaterials,
  materializeProposalOperations,
  executeResumeEditPlan,
  prepareEditPlanArguments,
  computeTaskOutcome,
  editPlanSummary,
  WORKFLOWS,
  proposalCallKey,
  retryIdempotentProposal,
  translationCallKey,
  SYSTEM_PROMPT,
  USER_FACING_RESPONSE_PROMPT,
  loadIntentDecision,
} from "../src/runtime/agent.js";
import { validateContextMaterials } from "../src/context.js";
import { validateToolArguments } from "../../../third_party/pi/packages/ai/dist/utils/validation.js";

const codedTestError = (code) => Object.assign(new Error(code), { code });

test("intent authorization failure and cancellation do not become fallback", async () => {
  for (const code of ["AGENT_TASK_CONTEXT_NOT_AUTHORIZED", "AGENT_RUN_NOT_ACTIVE", "AbortError"]) {
    await assert.rejects(loadIntentDecision({ recognizeIntent: async () => { throw codedTestError(code); } }), { code });
  }
  await assert.rejects(loadIntentDecision({ recognizeIntent: async () => ({ version: 1, mode: "plan", tasks: [] }) }), { code: "AGENT_INTENT_RESPONSE_INVALID" });
});

test("runtime registers an arbitrary OpenAI-compatible provider route", async () => {
  const { modelRuntime, model } = await configuredModel({
    provider: "aihubmix", api: "openai-completions", name: "vendor/model",
    apiKey: "fictional-key", baseUrl: "https://aihubmix.com/v1",
    contextWindow: 16384, maxOutputTokens: 4096,
  });
  assert.equal(model.provider, "drawoffer-aihubmix");
  assert.equal(model.id, "vendor/model");
  assert.equal(model.baseUrl, "https://aihubmix.com/v1");
  assert.equal(model.contextWindow, 16384);
  assert.equal(model.maxTokens, 4096);
  assert.ok(modelRuntime);
});

test("runtime keeps separate provider configuration for each route of one model", async () => {
  const { routes } = await configuredModels([
    { provider: "aihubmix", api: "openai-completions", name: "same-model", routeId: "11", apiKey: "fictional-one", baseUrl: "https://aihubmix.com/v1" },
    { provider: "deepseek", api: "openai-completions", name: "same-model", routeId: "12", apiKey: "fictional-two", baseUrl: "https://api.deepseek.com/v1" },
  ]);
  assert.deepEqual(routes.map((route) => route.model.provider), ["drawoffer-aihubmix-11", "drawoffer-deepseek-12"]);
});

test("configured Pi runtime sends non-thinking options through the actual OpenAI stream", async () => {
  for (const name of ["deepseek-v4.1-flash", "qwen3.8-flash"]) {
    const { modelRuntime, model } = await configuredModel({
      provider: "aihubmix", api: "openai-completions", name,
      apiKey: "fictional-key", baseUrl: "https://api.inferera.com/v1",
    });
    let requests = 0;
    const result = await modelRuntime.streamSimple(model, {
      messages: [{ role: "user", content: [{ type: "text", text: "虚构问题" }], timestamp: 0 }],
    }, {
      maxRetries: 0,
      fetch: async (url, options) => {
        requests += 1;
        assert.equal(new URL(url).hostname, "api.inferera.com");
        const payload = JSON.parse(options.body);
        if (name === "deepseek-v4.1-flash") assert.deepEqual(payload.thinking, { type: "disabled" });
        else assert.equal(payload.enable_thinking, false);
        assert.equal(payload.model, name);
        const chunks = [
          { id: "fixture", model: name, choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] },
          { id: "fixture", model: name, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ];
        return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      },
    }).result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(requests, 1);
    assert.equal(result.content[0].text, "OK");
  }
});

test("GPT-6 Luna Responses runtime sends reasoning none and reads its native stream", async () => {
  const { modelRuntime, model } = await configuredModel({
    provider: "aihubmix", api: "openai-responses", name: "gpt-6-luna",
    apiKey: "fictional-key", baseUrl: "https://api.inferera.com/v1",
  });
  const message = { type: "message", id: "msg_fixture", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: "OK", annotations: [] }] };
  const result = await modelRuntime.streamSimple(model, {
    messages: [{ role: "user", content: [{ type: "text", text: "虚构问题" }], timestamp: 0 }],
  }, {
    maxRetries: 0,
    fetch: async (url, options) => {
      assert.equal(new URL(url).pathname, "/v1/responses");
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.reasoning, { effort: "none" });
      assert.equal(payload.store, false);
      const chunks = [
        { type: "response.output_item.added", output_index: 0, item: { ...message, content: [] } },
        { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: message.id, delta: "OK" },
        { type: "response.output_item.done", output_index: 0, item: message },
        { type: "response.completed", response: { id: "resp_fixture", status: "completed", output: [message], usage: {
          input_tokens: 3, output_tokens: 1, total_tokens: 4, output_tokens_details: { reasoning_tokens: 0 },
        } } },
      ];
      return new Response(chunks.map((chunk) => `event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  }).result();
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(result.content[0].text, "OK");
  assert.equal(result.usage.reasoning, 0);
});

test("model request switches to the next route only before content is emitted", async () => {
  const routes = [{ routeId: "11" }, { routeId: "12" }];
  const used = [];
  const failed = [];
  const signal = new AbortController().signal;
  const stream = streamWithRouteFallback(
    routes,
    async function* (route) {
      used.push(route.routeId);
      if (route.routeId === "11") {
        yield { type: "start", partial: { content: [] } };
        yield { type: "error", reason: "error", error: { stopReason: "error", errorMessage: "503 unavailable" } };
      } else {
        yield { type: "start", partial: { content: [] } };
        yield { type: "text_delta", delta: "ok", partial: { content: [{ type: "text", text: "ok" }] } };
        yield { type: "done", reason: "stop", message: { stopReason: "stop", content: [{ type: "text", text: "ok" }] } };
      }
    },
    () => {},
    async (route) => { failed.push(route.routeId); },
    signal,
  );
  assert.deepEqual((await Array.fromAsync(stream)).map((event) => event.type), ["start", "text_delta", "done"]);
  assert.deepEqual(used, ["11", "12"]);
  assert.deepEqual(failed, ["11"]);

  used.length = 0;
  failed.length = 0;
  const partial = streamWithRouteFallback(
    routes,
    async function* (route) {
      used.push(route.routeId);
      yield { type: "text_delta", delta: "partial", partial: { content: [{ type: "text", text: "partial" }] } };
      yield { type: "error", reason: "error", error: { stopReason: "error", errorMessage: "503 unavailable" } };
    },
    () => {},
    async (route) => { failed.push(route.routeId); },
    signal,
  );
  assert.deepEqual((await Array.fromAsync(partial)).map((event) => event.type), ["text_delta", "error"]);
  assert.deepEqual(used, ["11"]);
  assert.deepEqual(failed, []);

  used.length = 0;
  const rejected = streamWithRouteFallback(
    routes,
    async function* (route) {
      used.push(route.routeId);
      yield { type: "error", reason: "error", error: { stopReason: "error", errorMessage: "400 invalid request" } };
    },
    () => {},
    async () => { throw new Error("must not switch"); },
    signal,
  );
  assert.deepEqual((await Array.fromAsync(rejected)).map((event) => event.type), ["error"]);
  assert.deepEqual(used, ["11"]);
});

test("selected resume identity wins over duplicate title search and model supplied IDs", async () => {
  const calls = [];
  const policy = createResumeContextPolicy([{ type: "resume", id: "83", resume_id: "83" }]);
  const result = await policy.resolveReference({
    resolveResumeReference: async (params) => { calls.push(params); return { status: "resolved", target: { resume_id: params.resume_id } }; },
  }, { title: "张三的简历", resume_id: "78" });
  assert.equal(result.target.resume_id, "83");
  // The selected identity wins over model guesses, and goes through the grant-recording endpoint.
  assert.deepEqual(calls, [{ resume_id: "83" }]);
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
  assert.equal(policy.unresolvedQuestions([{ purpose: "resume_identity" }]).length, 1);
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
  assert.match(USER_FACING_RESPONSE_PROMPT, /分析、诊断、评估、审阅和给建议类请求/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /发现之间不得写成一段连续正文/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /只报告本轮实际观察到的结果/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /内容说完后立即结束/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /在内部静默检查输出形状/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /删除“其次”“另外”“同时”等引出的次要事项/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /不得为了说明优先级而提及、对比或概括其他问题/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /列表后不得再有任何文字/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /“只分析，不修改”是行为边界/);
  assert.match(USER_FACING_RESPONSE_PROMPT, /先重写草稿再输出/);
  assert.ok(
    SYSTEM_PROMPT.indexOf("你是 DrawOffer 的简历智能助手") <
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

test("agent usage exposes safe tokens and leaves cost to backend call logs", () => {
  assert.deepEqual(agentUsage({
    tokens: { input: 120, output: 30 },
    cost: 0.00123456789,
  }), {
    inputTokens: 120,
    outputTokens: 30,
    estimatedCost: null,
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

test("career profile materials expose only the explicitly selected career fields", () => {
  const profile = { type: "user_profile", id: "1", version: "3", label: "个人画像", updated_at: "2026-10-02T00:00:00Z", content: { profile_markdown: "- skills: React, TypeScript" } };
  assert.deepEqual(validateContextMaterials([profile]), [profile]);
  assert.match(formatContextMaterials([profile]), /React, TypeScript/);
  assert.throws(() => validateContextMaterials([{ ...profile, content: { ...profile.content, contact_email: "fictional@example.test" } }]), /INVALID_CONTEXT_MATERIALS/);
  assert.throws(() => validateContextMaterials([profile, profile]), /INVALID_CONTEXT_MATERIALS/);

});

const identityMemory = { schema_version: 1, truncated: false, events: [
  { memory_ref: "m:1:resume:11", source_sequence_no: 1,
    resource: { type: "resume", id: "11", label: "张三后端简历" }, source: "explicit",
    tasks: [{ id: "a", label: "分析第一段", status: "completed", result: "建议说明职责" }] },
  { memory_ref: "m:3:resume:22", source_sequence_no: 3,
    resource: { type: "resume", id: "22", label: "张三产品简历" }, source: "explicit", tasks: [] },
] };

test("conversation memory preserves several identities separately from authorized context", () => {
  const prompt = buildAgentConversation({ content: "回到前面那份", history: [], conversationMemory: identityMemory });
  assert.match(prompt, /m:1:resume:11/);
  assert.match(prompt, /m:3:resume:22/);
  assert.match(prompt, /不是本轮正文授权或默认目标/);
  assert.doesNotMatch(prompt, /<authorized-context-catalog>/);
  assert.match(SYSTEM_PROMPT, /没有指向时即使只有一个历史对象也不能自动读取/);
});

test("history resolution requires a real memory key and current user evidence", () => {
  const params = { memory_ref: "m:1:resume:11", relation: "historical_selection", referring_text: "回到前面那份" };
  assert.equal(validateMemoryReference(params, identityMemory, "请回到前面那份看第二段"), "11");
  assert.throws(() => validateMemoryReference({ ...params, memory_ref: "m:9:resume:99" }, identityMemory, "回到前面那份"), /AGENT_MEMORY_REFERENCE_INVALID/);
  assert.throws(() => validateMemoryReference(params, identityMemory, "聊聊面试"), /AGENT_MEMORY_REFERENCE_INVALID/);
  assert.throws(() => validateMemoryReference({ ...params, resume_id: "22" }, identityMemory, "回到前面那份"), /AGENT_MEMORY_REFERENCE_INVALID/);
  assert.equal(validateMemoryReference(params, identityMemory, "确认", [{ value: "回到前面那份" }]), "11");
});

test("reference schema separates explicit selection and current-turn memory evidence", () => {
  const tool = { name: "resolve_resume_reference", parameters: resumeReferenceParameters(identityMemory, "再看第二段", [{ value: "回到前面那份" }]) };
  const call = (args) => validateToolArguments(tool, { type: "toolCall", id: "fictional-call", name: tool.name, arguments: args });
  const params = { memory_ref: "m:1:resume:11", relation: "continuation", referring_text: "再看第二段" };
  assert.deepEqual(call(params), params);
  assert.deepEqual(call({ title: "虚构简历" }), { title: "虚构简历" });
  assert.deepEqual(call({}), {});
  for (const invalid of [
    { ...params, resume_id: "11" }, { ...params, title: "虚构简历" },
    { ...params, memory_ref: "m:9:resume:99" }, { ...params, referring_text: "第二段实习经历" },
    { memory_ref: params.memory_ref }, { relation: "continuation" },
  ]) assert.throws(() => call(invalid));
  assert.deepEqual(call({ ...params, referring_text: "回到前面那份" }), { ...params, referring_text: "回到前面那份" });
  const empty = { ...tool, parameters: resumeReferenceParameters({ events: [] }, "继续") };
  assert.throws(() => validateToolArguments(empty, { name: tool.name, arguments: params }));
  const longRequest = "再看第二段" + "虚构说明".repeat(100);
  const longTool = { ...tool, parameters: resumeReferenceParameters(identityMemory, longRequest, [{ value: "确认" }]) };
  assert.deepEqual(validateToolArguments(longTool, { name: tool.name, arguments: params }), params);
  assert.equal(validateMemoryReference(params, identityMemory, longRequest), "11");
});

test("resource reference schema includes all mention kinds while resume tools remain scoped", () => {
  const memory = { ...identityMemory, events: ["user_profile", "resume", "dataset", "job", "application", "interview"].map((type) => ({
    ...identityMemory.events[0], resource: { type, id: "11", label: "虚构对象" }, memory_ref: `m:1:${type}:11`,
  })) };
  const tool = { name: "resolve_resource_reference", parameters: resourceReferenceParameters(memory, "继续刚才的资料") };
  for (const type of ["user_profile", "resume", "dataset", "job", "application", "interview"]) {
    const params = { memory_ref: `m:1:${type}:11`, relation: "continuation", referring_text: "继续刚才的资料" };
    assert.deepEqual(validateToolArguments(tool, { name: tool.name, arguments: params }), params);
    assert.equal(validateMemoryReference(params, memory, "继续刚才的资料", [], null), "11");
    if (type !== "resume") assert.throws(() => validateMemoryReference(params, memory, "继续刚才的资料"));
    assert.throws(() => validateToolArguments(tool, { name: tool.name, arguments: { ...params, title: "伪造" } }));
  }
  const scoped = resumeReferenceParameters(memory, "继续刚才的资料");
  assert.deepEqual(scoped.properties.memory_ref.enum, ["m:1:resume:11"]);
});

test("editor background permits switching instead of pinning the run", async () => {
  const policy = createResumeContextPolicy([{ type: "resume", id: "11", presentation: "implicit" }]);
  assert.equal(policy.resumeId, null);
  assert.equal(policy.backgroundId, "11");
  const calls = [];
  const client = {
    resolveResumeReference: async (params) => {
      calls.push(params);
      return { target: { resume_id: params.resume_id ?? "22" } };
    },
  };
  const result = await policy.resolveReference(client, { title: "张三产品简历" });
  assert.equal(result.target.resume_id, "22");
  assert.deepEqual(calls, [{ title: "张三产品简历" }]);
  await policy.resolveReference(client, {});
  assert.deepEqual(calls[1], { resume_id: "11" });
  const selection = { selected_text: "旧简历选区" };
  assert.equal(selectionForResume(policy, "11", selection), selection);
  assert.equal(selectionForResume(policy, "22", selection), null);
  assert.equal(selectionForResume(policy, null, selection), null);
});

test("explicit selected identity survives duplicate title guesses but real alternatives are checked", () => {
  const explicit = [{ type: "resume", id: "11", label: "张三后端简历" }];
  assert.equal(referenceNeedsResolution({ title: "张三后端简历" }, explicit, "看看张三后端简历"), false);
  assert.equal(referenceNeedsResolution({ resume_id: "999" }, explicit, "看看这份"), false);
  assert.equal(referenceNeedsResolution({ title: "张三产品简历" }, explicit, "换张三产品简历"), true);
  assert.equal(referenceNeedsResolution({ memory_ref: "m:1:resume:22" }, explicit, "回到前面那份"), true);
  assert.equal(referenceNeedsResolution({ title: "张三产品简历" }, [{ ...explicit[0], presentation: "implicit" }], "换张三产品简历"), true);
});



test("system prompt identifies the assistant and describes runtime-driven steps", () => {
  assert.match(SYSTEM_PROMPT, /你是 DrawOffer 的职业与简历智能助手/);
  assert.match(SYSTEM_PROMPT, /运行时按任务和步骤驱动整个流程/);
  assert.match(SYSTEM_PROMPT, /临时工作过程/);
  assert.match(SYSTEM_PROMPT, /不要调用没有提供的工具/);
  assert.doesNotMatch(SYSTEM_PROMPT, /通过 `@`/);
  assert.doesNotMatch(SYSTEM_PROMPT, new RegExp(["Link", "CV"].join(""), "i"));
  // The model no longer drives the lifecycle, so the prompt must not teach lifecycle tools.
  assert.doesNotMatch(SYSTEM_PROMPT, /career-assistant-router|begin_final_response|start_agent_task|finish_agent_task|list_user_resources/);
});

test("only the current intent response version is accepted", async () => {
  const tasks = [{ id: "diagnose", workflow: "resume_diagnosis", status: "planned" }];
  const plan = await loadIntentDecision({ recognizeIntent: async () => ({ version: 2, mode: "plan", tasks }) });
  assert.deepEqual(plan.tasks, tasks);
  for (const response of [
    { version: 1, mode: "plan", tasks },
    { version: 2, mode: "fallback", reason: "INTENT_TIMEOUT" },
    { version: 2, mode: "plan", tasks: [] },
    { version: 2, mode: "unknown" },
  ]) {
    await assert.rejects(loadIntentDecision({ recognizeIntent: async () => response }), { code: "AGENT_INTENT_RESPONSE_INVALID" });
  }
  const fallback = await loadIntentDecision({ recognizeIntent: async () => ({ version: 2, mode: "fallback", routing_rules: "规则" }) });
  assert.equal(fallback.routing_rules, "规则");
});

test("edit plans normalize deletion text without hiding missing replacement text", () => {
  const prepared = prepareEditPlanArguments({
    edits: [
      { quoted_text: "占位", op: "delete_target", summary: "删除占位" },
      { quoted_text: "旧内容", op: "replace_target_text", summary: "替换内容" },
    ],
  });
  assert.equal(prepared.edits[0].new_text, "");
  assert.equal("new_text" in prepared.edits[1], false);
});

const editTarget = (blockId, content, extra = {}) => ({
  resume_id: "88", base_lock_version: 1, surface: "editor", section: "section-projects", entry_id: null,
  field: "markdown", block_id: blockId, selected_text: content,
  expected_text_hash: `sha256:${blockId.padEnd(64, "a").slice(0, 64)}`, ...extra,
});

const proposalClient = (overrides = {}) => ({
  resolveTarget: async () => { throw new Error("must not locate by text"); },
  scopedContext: async () => { throw new Error("must not read again"); },
  diagnose: async ({ target }) => ({ diagnosis: { target }, diagnosis_fingerprint: `fingerprint:${target.block_id}` }),
  scopedProposal: async (payload) => ({ proposal: { id: `proposal-${payload.target.block_id}` } }),
  ...overrides,
});

test("edit plan cites server-read blocks and creates one proposal per edit in order", async () => {
  const first = editTarget("node_bullet000000001", "第一条");
  const second = editTarget("node_bullet000000002", "第二条");
  const context = { blocks: [first, second].map((target) => ({ target, content: target.selected_text })) };
  const created = [];
  const activities = [];
  const results = await executeResumeEditPlan({
    client: proposalClient({ scopedProposal: async (payload) => {
      created.push([payload.mode, payload.operations.map((item) => [item.op, item.new_text])]);
      return { proposal: { id: `proposal-${payload.target.block_id}` } };
    } }),
    resumeId: "88", context, mode: "polish_local", toolCallId: "plan-1", summary: "计划",
    edits: [
      { block_id: first.block_id, op: "replace_target_text", new_text: "更精炼的第一条", summary: "精简第一条" },
      { block_id: second.block_id, op: "delete_target", new_text: "", summary: "删除第二条" },
    ],
    onActivity: (activity) => activities.push(activity),
  });
  assert.deepEqual(results.map((item) => [item.status, item.proposal_ids]), [
    ["succeeded", ["proposal-node_bullet000000001"]], ["succeeded", ["proposal-node_bullet000000002"]],
  ]);
  assert.deepEqual(created, [["polish_local", [["replace_target_text", "更精炼的第一条"]]], ["polish_local", [["delete_target", ""]]]]);
  assert.ok(activities.some((item) => item.callKey === "plan-1:edit:2" && item.status === "succeeded"));
});

test("an edit that cites an unread block fails alone with PATCH_OUT_OF_SCOPE", async () => {
  const known = editTarget("node_bullet000000001", "第一条");
  const results = await executeResumeEditPlan({
    client: proposalClient(), resumeId: "88", mode: "polish_local", toolCallId: "plan-2",
    context: { blocks: [{ target: known, content: "第一条" }] },
    edits: [
      { block_id: "node_unknownblock0001", op: "delete_target", new_text: "", summary: "未读取的块" },
      { block_id: known.block_id, op: "delete_target", new_text: "", summary: "合法的块" },
    ],
  });
  assert.deepEqual(results.map((item) => [item.status, item.error_code]), [["failed", "PATCH_OUT_OF_SCOPE"], ["succeeded", undefined]]);
});

test("quoted text edits are located by the runtime, and a missing one fails alone", async () => {
  const placeholder = editTarget("node_skill00000000001", "占位");
  const results = await executeResumeEditPlan({
    client: proposalClient({ resolveTarget: async ({ quoted_text: text }) => (
      text === "missing" ? { status: "not_found", target: null } : { status: "resolved", target: placeholder }) }),
    resumeId: "88", mode: "polish_local", toolCallId: "plan-3", context: { blocks: [] },
    edits: [
      { quoted_text: "missing", op: "delete_target", new_text: "", summary: "不存在" },
      { quoted_text: "占位", op: "replace_target_text", new_text: "", summary: "清空占位" },
    ],
  });
  assert.deepEqual(results.map((item) => [item.status, item.error_code]), [["failed", "TARGET_NOT_FOUND"], ["succeeded", undefined]]);
});

test("match all expands a repeated text inside its parent and keeps proposals created before a failure", async () => {
  const parent = editTarget("node_entry0000000001", "LinkRag 项目", { entry_id: "node_entry0000000001" });
  const bullets = ["node_bullet000000001", "node_bullet000000002"].map((id) => editTarget(id, "1", { entry_id: "node_entry0000000001" }));
  const proposals = [];
  const results = await executeResumeEditPlan({
    client: proposalClient({
      resolveTarget: async () => ({ status: "resolved", target: parent }),
      scopedContext: async () => ({ blocks: bullets.map((target) => ({ target, content: "1" })) }),
      scopedProposal: async ({ target }) => {
        if (target.block_id === bullets[1].block_id) throw codedTestError("TARGET_STALE");
        return { proposal: { id: "proposal-first" } };
      },
    }),
    resumeId: "88", mode: "polish_local", toolCallId: "plan-4", context: { blocks: [] },
    edits: [{ quoted_text: "1", parent_quoted_text: "LinkRag 项目", match: "all", op: "delete_target", new_text: "", summary: "删除占位" }],
    onProposal: (proposal) => proposals.push(proposal.id),
  });
  assert.deepEqual(results, [{ edit: 1, status: "partial", error_code: "TARGET_STALE", proposal_ids: ["proposal-first"] }]);
  assert.deepEqual(proposals, ["proposal-first"]);
});

test("a global match without a parent is refused", async () => {
  const results = await executeResumeEditPlan({
    client: proposalClient(), resumeId: "88", mode: "polish_local", toolCallId: "plan-5", context: { blocks: [] },
    edits: [{ quoted_text: "1", match: "all", op: "delete_target", new_text: "", summary: "全局匹配" }],
  });
  assert.equal(results[0].error_code, "TARGET_PARENT_REQUIRED");
});

test("each edit mode only accepts its own operations and evidence", async () => {
  const target = editTarget("node_bullet000000001", "第一条", { entry_id: "node_entry0000000001" });
  const run = (mode, edit, sourceIds = []) => executeResumeEditPlan({
    client: proposalClient(), resumeId: "88", mode, toolCallId: "plan-6", sourceIds,
    context: { blocks: [{ target, content: "第一条" }] },
    edits: [{ block_id: target.block_id, summary: "修改", ...edit }],
  });
  assert.equal((await run("polish_local", { op: "insert_after_target", new_text: "新增" }))[0].error_code, "PATCH_OUT_OF_SCOPE");
  assert.equal((await run("generate_from_materials", { op: "replace_target_text", new_text: "替换" }, ["dataset:1:content-0"]))[0].error_code, "PATCH_OUT_OF_SCOPE");
  assert.equal((await run("generate_from_materials", { op: "insert_after_target", new_text: "新增" }))[0].error_code, "SOURCE_REQUIRED");
  assert.equal((await run("generate_from_materials", { op: "insert_after_target", new_text: "新增" }, ["dataset:1:content-0"]))[0].status, "succeeded");
  assert.equal((await run("polish_local", { op: "replace_target_text" }))[0].error_code, "TASK_NEW_TEXT_REQUIRED");
});

test("rewriting an entry is one proposal and refuses edits that reach another entry", async () => {
  const inEntry = (id) => editTarget(id, "内容", { entry_id: "node_entry0000000001" });
  const proposals = [];
  const targets = [inEntry("node_bullet000000001"), inEntry("node_bullet000000002"),
    editTarget("node_bullet000000003", "别处", { entry_id: "node_entry0000000002" })];
  const context = { blocks: targets.map((target) => ({ target, content: target.selected_text })) };
  const run = (ids) => executeResumeEditPlan({
    client: proposalClient({ scopedProposal: async (payload) => { proposals.push(payload.operations.length); return { proposal: { id: "proposal-entry" } }; } }),
    resumeId: "88", mode: "rewrite_entry_star", toolCallId: "plan-7", context, summary: "重写经历",
    edits: ids.map((id) => ({ block_id: id, op: "replace_target_text", new_text: "新内容", summary: "重写" })),
  });
  const same = await run(["node_bullet000000001", "node_bullet000000002"]);
  assert.deepEqual(same.map((item) => [item.status, item.proposal_ids]), [["succeeded", ["proposal-entry"]], ["succeeded", ["proposal-entry"]]]);
  assert.deepEqual(proposals, [2]);
  const across = await run(["node_bullet000000001", "node_bullet000000003"]);
  assert.deepEqual(across.map((item) => item.error_code), ["PATCH_OUT_OF_SCOPE", "PATCH_OUT_OF_SCOPE"]);
  assert.deepEqual(proposals, [2]);
});

test("an edit plan stops immediately after cancellation", async () => {
  const controller = new AbortController();
  let located = 0;
  await assert.rejects(executeResumeEditPlan({
    client: proposalClient({ resolveTarget: async () => {
      located += 1;
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    } }),
    resumeId: "88", mode: "polish_local", toolCallId: "plan-8", signal: controller.signal, context: { blocks: [] },
    edits: [
      { quoted_text: "first", op: "delete_target", new_text: "", summary: "第一项" },
      { quoted_text: "second", op: "delete_target", new_text: "", summary: "第二项" },
    ],
  }), { name: "AbortError" });
  assert.equal(located, 1);
});

test("an edit plan is limited to twenty expanded targets", async () => {
  const targets = Array.from({ length: 21 }, (_, index) => editTarget(`node_bullet${String(index).padStart(9, "0")}`, "1"));
  const results = await executeResumeEditPlan({
    client: proposalClient({
      resolveTarget: async () => ({ status: "resolved", target: editTarget("node_entry0000000001", "项目") }),
      scopedContext: async () => ({ blocks: targets.map((target) => ({ target, content: "1" })) }),
    }),
    resumeId: "88", mode: "polish_local", toolCallId: "plan-9", context: { blocks: [] },
    edits: [{ quoted_text: "1", parent_quoted_text: "项目", match: "all", op: "delete_target", new_text: "", summary: "删除" }],
  });
  assert.equal(results[0].error_code, "EDIT_PLAN_TARGET_LIMIT");
});

test("the runtime, not the model, decides each task outcome", () => {
  const proposal = { output: "proposal" };
  const advice = { output: "advice" };
  const ids = (count) => Array.from({ length: count }, (_, index) => `p${index}`);
  const cases = [
    [proposal, { proposalIds: ids(3), editFailures: 0 }, "completed"],
    [proposal, { proposalIds: ids(2), editFailures: 1, editErrorCode: "TARGET_NOT_FOUND" }, "partial"],
    [proposal, { proposalIds: [] }, "failed"],
    [proposal, { proposalIds: [], needsInput: true }, "blocked"],
    [proposal, { proposalIds: ids(1), needsInput: true }, "partial"],
    [proposal, { proposalIds: ids(1), error: "AGENT_STEP_RESULT_MISSING" }, "partial"],
    [advice, { proposalIds: [], summary: "诊断结论" }, "completed"],
    [advice, { proposalIds: [], needsInput: true }, "blocked"],
    [advice, { proposalIds: [] }, "failed"],
    [advice, { proposalIds: [], error: "RESUME_IDENTITY_UNRESOLVED" }, "blocked"],
    [advice, { proposalIds: [], error: "AGENT_TASK_CONTEXT_NOT_AUTHORIZED" }, "failed"],
  ];
  for (const [task, facts, expected] of cases) assert.equal(computeTaskOutcome(task, facts).status, expected, JSON.stringify([task, facts]));
  assert.equal(computeTaskOutcome(proposal, { proposalIds: [], needsInput: true }).errorCode, "USER_INPUT_REQUIRED");
  assert.equal(computeTaskOutcome(proposal, { proposalIds: [] }).errorCode, "AGENT_TASK_NO_PROPOSAL");
  assert.match(editPlanSummary([
    { edit: 1, status: "succeeded", proposal_ids: ["a"] }, { edit: 2, status: "failed", error_code: "TARGET_NOT_FOUND", proposal_ids: [] },
  ], "计划"), /已生成 1 份待确认提案，1 项未完成（第 2 项 TARGET_NOT_FOUND）/);
});

test("every workflow's rules are loadable content-only skills", async () => {
  const { loadSkillRules, REGISTERED_SKILLS } = await import("../src/runtime/skills.js");
  const toolNames = /\b(?:read|plan_agent_request|start_agent_task|finish_agent_task|begin_final_response|list_user_resources|resolve_resume_reference|resolve_resource_reference|resolve_resume_target|get_resume_context|search_resume_materials|analyze_resume_content|create_resume_change_proposal|execute_local_resume_edit_plan|create_resume_translation_proposal|request_user_input|submit_task_result|submit_resume_edit_plan|submit_translation)\b/;
  for (const name of REGISTERED_SKILLS) {
    const rules = await loadSkillRules(name);
    assert.ok(rules.length > 40, name);
    assert.doesNotMatch(rules, toolNames, `${name} must hold content rules, not tool instructions`);
    assert.doesNotMatch(rules, /career-assistant-router|SKILL\.md/);
  }
  for (const workflow of Object.values(WORKFLOWS)) for (const skill of workflow.skills) assert.ok(REGISTERED_SKILLS.includes(skill));
  await assert.rejects(loadSkillRules("career-assistant-router"), /AGENT_SKILL_UNKNOWN/);
});

test("analysis, edit, interview, planning and title workflows share the evidence method", async () => {
  const { loadSkillRules } = await import("../src/runtime/skills.js");
  for (const name of ["resume_diagnosis", "resume_edit", "interview_guide", "career_planning", "resume_title"]) {
    assert.equal(WORKFLOWS[name].skills[0], "resume-evidence-method", name);
  }
  const diagnosis = await loadSkillRules("resume-diagnosis");
  for (const scenario of ["整体诊断", "单段经历或项目分析", "岗位匹配分析", "结构与格式审查", "内容问答", "片段评价"]) {
    assert.ok(diagnosis.includes(scenario), scenario);
  }
  assert.match(diagnosis, /STAR/);
  assert.match(diagnosis, /XYZ/);
  const evidence = await loadSkillRules("resume-evidence-method");
  assert.match(evidence, /每个发现都要有证据/);
  // Ordinary dates and the user's own experiences are not findings.
  assert.match(evidence, /不质疑经历是否真实发生/);
  assert.doesNotMatch(evidence, /未来时间写成已发生|可信度风险/);
});
