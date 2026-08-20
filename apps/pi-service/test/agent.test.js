import assert from "node:assert/strict";
import test from "node:test";

import { createSkillReadTool } from "../src/runtime/agent.js";

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
