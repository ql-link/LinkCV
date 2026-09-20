import assert from "node:assert/strict";
import test from "node:test";

import {
  agentUsage,
  assertAgentCompleted,
  buildAgentConversation,
  createAssistantOutputFilter,
  createSkillReadTool,
  clarificationFallbackText,
  formatContextMaterials,
  materializeProposalOperations,
  SYSTEM_PROMPT,
  USER_FACING_RESPONSE_PROMPT,
} from "../src/runtime/agent.js";
import { validateContextMaterials } from "../src/context.js";

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
