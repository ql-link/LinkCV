import assert from "node:assert/strict";
import test from "node:test";
import { validateConversationMemory, validateContextMaterials } from "../src/context.js";

const memory = () => ({ schema_version: 1, truncated: false, events: [{
  memory_ref: "m:1:resume:7", source_sequence_no: 1,
  resource: { type: "resume", id: "7", label: "张三的简历" },
  source: "explicit", tasks: [{ id: "a", label: "分析", status: "blocked" }],
}] });

test("memory protocol accepts bounded identities and defaults old callers to empty", () => {
  assert.equal(validateConversationMemory(memory()).events[0].resource.id, "7");
  assert.deepEqual(validateConversationMemory(undefined), { schema_version: 1, events: [], truncated: false });
  assert.deepEqual(validateContextMaterials(undefined), []);
});

test("memory supports every mention kind and distinguishes equal IDs by type", () => {
  const value = memory();
  value.events = ["resume", "dataset", "job", "application", "interview"].map((type) => ({
    ...value.events[0], resource: { type, id: "7", label: "虚构对象" }, memory_ref: `m:1:${type}:7`,
  }));
  assert.equal(validateConversationMemory(value).events.length, 5);
  value.events[0].resource.type = "resume_version";
  assert.throws(() => validateConversationMemory(value), /INVALID_CONVERSATION_MEMORY/);
});

test("memory rejects forged references, content, unknown versions and budgets", () => {
  for (const mutate of [
    (value) => { value.schema_version = 2; },
    (value) => { value.events[0].memory_ref = "m:1:resume:8"; },
    (value) => { value.events[0].resource.content = "private body"; },
    (value) => { value.events[0].tasks[0].result = "x".repeat(6001); },
    (value) => { value.events.push(value.events[0]); },
    (value) => { value.events[0].resource.id = "not-an-id"; },
  ]) {
    const value = memory();
    mutate(value);
    assert.throws(() => validateConversationMemory(value), /INVALID_CONVERSATION_MEMORY/);
  }
});
