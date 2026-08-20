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
