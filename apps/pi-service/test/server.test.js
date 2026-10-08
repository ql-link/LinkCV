import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

test("Pi HTTP validates memory before execution and supports old requests", async (t) => {
  // This backend cannot invoke a model: every call fails with a fixed fake error.
  const backend = createServer((_request, response) => {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "AGENT_NOT_READY" }));
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  t.after(() => new Promise((resolve) => backend.close(resolve)));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [new URL("../src/server.js", import.meta.url).pathname], {
    env: { PATH: process.env.PATH, APP_ENV: "testing", PI_SERVICE_PORT: String(port),
      PI_SERVICE_TOKEN: "fictional-pi-test-token", LINKRESUME_INTERNAL_AGENT_TOKEN: "fictional-backend-token",
      LINKRESUME_BASE_URL: `http://127.0.0.1:${backend.address().port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, "exit"); } });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Pi test server did not start")), 15000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening on")) { clearTimeout(timeout); resolve(); }
    });
    child.once("exit", () => { clearTimeout(timeout); reject(new Error("Pi test server exited")); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
  });
  const post = (body) => fetch(`http://127.0.0.1:${port}/internal/agent/runs`, {
    method: "POST", headers: { Authorization: "Bearer fictional-pi-test-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  for (const conversationMemory of [
    { schema_version: 2, events: [], truncated: false },
    { schema_version: 1, events: [], truncated: false, content: "forbidden" },
    { schema_version: 1, events: [], truncated: "false" },
  ]) {
    const response = await post({ runId: "invalid-memory", content: "示例问题", conversationMemory });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "INVALID_AGENT_RUN" });
  }
  for (const addition of [{}, { conversationMemory: { schema_version: 1, events: [], truncated: false } }]) {
    const response = await post({ runId: `compat-${Object.keys(addition).length}`, content: "示例问题", ...addition });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /run.failed/);
  }
});
