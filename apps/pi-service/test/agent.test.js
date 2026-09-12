import assert from "node:assert/strict";
import test from "node:test";

import {
  agentUsage,
  assertAgentCompleted,
  createAssistantOutputFilter,
  createSkillReadTool,
  clarificationFallbackText,
  formatContextMaterials,
} from "../src/runtime/agent.js";
import { validateContextMaterials } from "../src/context.js";

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

test("assistant output filter hides tool-call narration and emits only the final reply", () => {
  const emitted = [];
  const filter = createAssistantOutputFilter(
    (type, payload) => emitted.push({ type, payload }),
    "run-1",
  );

  filter({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "我先读取 Skill，再调用定位工具。" },
  });
  filter({
    type: "message_end",
    message: { role: "assistant", stopReason: "toolUse" },
  });
  filter({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "已生成一份待确认的修改提案。" },
  });
  filter({
    type: "message_end",
    message: { role: "assistant", stopReason: "stop" },
  });

  assert.deepEqual(emitted, [{
    type: "assistant.delta",
    payload: { runId: "run-1", delta: "已生成一份待确认的修改提案。" },
  }]);
});

test("assistant output filter does not expose failed or aborted model text", () => {
  const emitted = [];
  const filter = createAssistantOutputFilter((...event) => emitted.push(event), "run-2");

  for (const stopReason of ["error", "aborted"]) {
    filter({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "内部错误详情" },
    });
    filter({
      type: "message_end",
      message: { role: "assistant", stopReason },
    });
  }

  assert.deepEqual(emitted, []);
});

test("assistant output filter suppresses final prose after a clarification request", () => {
  const emitted = [];
  const filter = createAssistantOutputFilter(
    (...event) => emitted.push(event),
    "run-3",
    () => true,
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
  const tool = createSkillReadTool((path) => { loadedPath = path; });
  const result = await tool.execute("read-1", {
    path: "resume-edit-workflow/SKILL.md",
  });

  assert.match(result.content[0].text, /name: resume-edit-workflow/);
  assert.equal(loadedPath, "resume-edit-workflow/SKILL.md");
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
