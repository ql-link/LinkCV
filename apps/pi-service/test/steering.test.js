import assert from "node:assert/strict";
import test from "node:test";
import { createSteeringHandle } from "../src/steering.js";
import { createDrawOfferClient } from "../src/tools/drawoffer-client.js";

test("one admitted input, immutable snapshots, stable replay and changed-body rejection", async () => {
  const inputs = [];
  const handle = createSteeringHandle("run", (payload) => { inputs.push(payload); }, () => true);
  const payload = { idempotency_key: "steer_key_1", content: "改变目标", contexts: [] };
  const first = await handle.submit(payload);
  payload.content = "编辑浏览器草稿";
  assert.equal(inputs[0].content, "改变目标");
  assert.equal(handle.current().payload.content, "改变目标");
  assert.deepEqual(await handle.submit({ ...payload, content: "改变目标" }), first);
  await assert.rejects(handle.submit(payload), { message: "AGENT_SUBMISSION_CONFLICT" });
  await assert.rejects(handle.submit({ ...payload, idempotency_key: "steer_key_2" }), { message: "AGENT_STEER_BUSY" });
  handle.update("accepted", { user_sequence_no: 3 });
  assert.equal(handle.lookup("steer_key_1").state, "accepted");
  handle.update("applied");
  assert.equal(handle.current(), null);
  assert.equal(handle.lookup("steer_key_1").state, "applied");
  await handle.submit({ ...payload, idempotency_key: "steer_key_2" });
  assert.equal(inputs.length, 2);
});

test("ended and unknown runs do not silently admit another input", async () => {
  const handle = createSteeringHandle("run", () => {}, () => false);
  await assert.rejects(handle.submit({ idempotency_key: "steer_key_1", content: "后续" }), { message: "AGENT_STEER_TARGET_FINISHED" });
  assert.equal(handle.lookup("steer_key_1").state, "not_applied");
});

test("trusted client updates source on every tool callback and completion", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const client = createDrawOfferClient({ toolTimeoutMs: 1000, drawofferBaseUrl: "http://example.test", drawofferToken: "fictional-token" },
    "run", new AbortController().signal, 1);
  await client.planTasks({ tasks: [] });
  await client.activateSteering({ idempotency_key: "steer_key_1", content: "后续" });
  client.setSource(3);
  await client.acknowledgeSteering({ submission_key: "steer_key_1", user_sequence_no: 3 });
  await client.completeReply({ user_sequence_no: 3, content: "新回复" });
  assert.deepEqual(calls.map(({ options }) => options.headers["X-Agent-User-Sequence"]), ["1", "1", "3", "3"]);
  assert.ok(calls[3].url.endsWith("/messages:complete"));
});
