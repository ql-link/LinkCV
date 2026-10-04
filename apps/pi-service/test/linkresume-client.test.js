import assert from "node:assert/strict";
import test from "node:test";

import { createLinkResumeClient } from "../src/tools/linkresume-client.js";

for (const [label, requestId, modelId, expectedRequest, expectedModel] of [
  ["ordinary", "resp_fictional", "fictional-model", "resp_fictional", "fictional-model"],
  ["column boundary", "r".repeat(128), "m".repeat(256), "r".repeat(128), "m".repeat(256)],
  ["long Responses ID", "resp_" + "x".repeat(2048), "m".repeat(257), null, null],
  ["Unicode characters", "😀".repeat(128), "模".repeat(256), "😀".repeat(128), "模".repeat(256)],
]) {
  test(`LLM metering preserves usage with ${label}`, async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => { globalThis.fetch = originalFetch; });
    let captured;
    globalThis.fetch = async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = createLinkResumeClient(
      { linkresumeBaseUrl: "http://linkresume:8000", linkresumeToken: "fictional-token", toolTimeoutMs: 1000 },
      "fictional-run", new AbortController().signal,
    );
    const payload = {
      callId: "fictional-call", routeId: "3", configVersion: 2,
      status: "succeeded", inputTokens: 100, outputTokens: 20,
      responseModelId: modelId, upstreamRequestId: requestId,
    };
    assert.deepEqual(await client.recordLlmCall(payload), { ok: true });
    assert.equal(captured.url, "http://linkresume:8000/internal/agent/runs/fictional-run/llm-calls");
    assert.deepEqual(captured.body, { ...payload, responseModelId: expectedModel, upstreamRequestId: expectedRequest });
    assert.equal(payload.upstreamRequestId, requestId);
  });
}

test("readiness calls the protected LinkResume internal endpoint", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ ready: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const controller = new AbortController();
  const client = createLinkResumeClient(
    {
      linkresumeBaseUrl: "http://linkresume:8000",
      linkresumeToken: "internal-token",
      toolTimeoutMs: 1000,
    },
    "readiness",
    controller.signal,
  );

  assert.deepEqual(await client.readiness(), { ready: true });
  assert.equal(captured.url, "http://linkresume:8000/internal/agent/readiness");
  assert.equal(captured.options.headers.Authorization, "Bearer internal-token");
});

test("scoped tools call run-bound LinkResume endpoints", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = createLinkResumeClient(
    { linkresumeBaseUrl: "http://linkresume:8000", linkresumeToken: "internal-token", toolTimeoutMs: 1000 },
    "run/with spaces",
    new AbortController().signal,
  );

  await client.resolveResumeReference({ title: "张三的测试简历" });
  await client.listUserResources({ types: ["resume", "dataset", "interview"] });
  await client.resolveTarget({ resume_id: "1", quoted_text: "目标" });
  await client.scopedContext({ target: { resume_id: "1" }, scope: "target" });
  await client.searchMaterials({ query: "Java" });
  await client.diagnose({ target: { resume_id: "1" }, scope: "target" });
  await client.scopedProposal({ mode: "polish_local" });
  await client.translationProposal({ target_language: "en" });

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/internal/agent/runs/run%2Fwith%20spaces/resumes:resolve-reference",
    "/internal/agent/runs/run%2Fwith%20spaces/resources:list",
    "/internal/agent/runs/run%2Fwith%20spaces/targets:resolve",
    "/internal/agent/runs/run%2Fwith%20spaces/context:read",
    "/internal/agent/runs/run%2Fwith%20spaces/materials:search",
    "/internal/agent/runs/run%2Fwith%20spaces/diagnoses",
    "/internal/agent/runs/run%2Fwith%20spaces/proposals:v2",
    "/internal/agent/runs/run%2Fwith%20spaces/proposals:translation",
  ]);
  assert.ok(calls.every((call) => call.options.method === "POST"));
  assert.deepEqual(JSON.parse(calls[2].options.body), { resume_id: "1", quoted_text: "目标" });
});
