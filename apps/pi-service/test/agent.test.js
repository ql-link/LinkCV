import assert from "node:assert/strict";
import test from "node:test";

import {
  agentUsage,
  assertAgentCompleted,
  createAssistantOutputFilter,
  createSkillReadTool,
} from "../src/runtime/agent.js";

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
