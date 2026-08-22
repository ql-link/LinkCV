import assert from "node:assert/strict";
import test from "node:test";

import { agentUsage, assertAgentCompleted, createSkillReadTool } from "../src/runtime/agent.js";

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

test("read tool can load a registered resume skill", async () => {
  const tool = createSkillReadTool();
  const result = await tool.execute("read-1", {
    path: "resume-diagnosis/SKILL.md",
  });

  assert.match(result.content[0].text, /name: resume-diagnosis/);
});

test("read tool rejects files outside the registered skills directory", async () => {
  const tool = createSkillReadTool();

  await assert.rejects(
    tool.execute("read-2", { path: new URL("../../../package.json", import.meta.url).pathname }),
    /AGENT_SKILL_READ_FORBIDDEN/,
  );
});
