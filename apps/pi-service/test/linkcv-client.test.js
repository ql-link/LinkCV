import assert from "node:assert/strict";
import test from "node:test";

import { createLinkCVClient } from "../src/tools/linkcv-client.js";

test("readiness calls the protected LinkCV internal endpoint", async (context) => {
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
  const client = createLinkCVClient(
    {
      linkcvBaseUrl: "http://linkcv:8000",
      linkcvToken: "internal-token",
      toolTimeoutMs: 1000,
    },
    "readiness",
    controller.signal,
  );

  assert.deepEqual(await client.readiness(), { ready: true });
  assert.equal(captured.url, "http://linkcv:8000/internal/agent/readiness");
  assert.equal(captured.options.headers.Authorization, "Bearer internal-token");
});

test("scoped tools call run-bound LinkCV endpoints", async (context) => {
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
  const client = createLinkCVClient(
    { linkcvBaseUrl: "http://linkcv:8000", linkcvToken: "internal-token", toolTimeoutMs: 1000 },
    "run/with spaces",
    new AbortController().signal,
  );

  await client.resolveTarget({ quoted_text: "目标" });
  await client.scopedContext({ target: { resume_id: "1" }, scope: "target" });
  await client.searchMaterials({ query: "Java" });
  await client.diagnose({ target: { resume_id: "1" }, scope: "target" });
  await client.scopedProposal({ mode: "polish_local" });

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/internal/agent/runs/run%2Fwith%20spaces/targets:resolve",
    "/internal/agent/runs/run%2Fwith%20spaces/context:read",
    "/internal/agent/runs/run%2Fwith%20spaces/materials:search",
    "/internal/agent/runs/run%2Fwith%20spaces/diagnoses",
    "/internal/agent/runs/run%2Fwith%20spaces/proposals:v2",
  ]);
  assert.ok(calls.every((call) => call.options.method === "POST"));
});
