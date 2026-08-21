import assert from "node:assert/strict";
import test from "node:test";

import { assertAgentCompleted, createSkillReadTool } from "../src/runtime/agent.js";

test("agent completion accepts a successful assistant message", () => {
  assert.doesNotThrow(() => assertAgentCompleted({ role: "assistant", stopReason: "stop" }));
});

test("agent completion rejects provider failures hidden in assistant messages", () => {
  assert.throws(
    () => assertAgentCompleted({ role: "assistant", stopReason: "error", errorMessage: "Request timed out." }),
    /AGENT_MODEL_REQUEST_FAILED/,
  );
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
