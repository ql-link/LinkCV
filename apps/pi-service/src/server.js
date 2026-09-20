import { createServer } from "node:http";
import { configureHttpDispatcher } from "../../../third_party/pi/packages/coding-agent/dist/index.js";

import { bearerToken, tokensEqual } from "./auth.js";
import { loadConfig } from "./config.js";
import { validateContextMaterials } from "./context.js";
import { executeAgentProbe, executeAgentRun } from "./runtime/agent.js";
import { createLinkResumeClient } from "./tools/linkresume-client.js";

configureHttpDispatcher();
const config = loadConfig();
const activeRuns = new Map();

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const parts = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error("REQUEST_TOO_LARGE");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

function writeEvent(response, type, payload) {
  response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function agentFailureCode(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/.test(message)
    ? message
    : (error?.name || "UNKNOWN_AGENT_ERROR");
}


const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { status: "ok", service: "linkresume-pi" });
  }
  if (!tokensEqual(bearerToken(request.headers), config.serviceToken)) {
    return json(response, 401, { error: "AGENT_SERVICE_UNAUTHORIZED" });
  }
  if (request.method === "GET" && url.pathname === "/internal/agent/readiness") {
    const controller = new AbortController();
    try {
      const result = await createLinkResumeClient(config, "readiness", controller.signal).readiness();
      if (result?.ready !== true) throw new Error("AGENT_NOT_READY");
      return json(response, 200, { ready: true, service: "linkresume-pi" });
    } catch {
      return json(response, 503, { error: "AGENT_NOT_READY" });
    }
  }
  if (request.method === "POST" && url.pathname === "/internal/probes") {
    let payload;
    try {
      payload = await readJson(request);
    } catch {
      return json(response, 400, { error: "INVALID_AGENT_PROBE" });
    }
    const model = payload?.model;
    if (
      typeof payload?.runId !== "string" ||
      typeof payload?.nonce !== "string" ||
      payload.nonce.length < 16 ||
      !model ||
      typeof model.adapter !== "string" ||
      typeof model.id !== "string" ||
      typeof model.name !== "string" ||
      typeof model.apiKey !== "string" ||
      (model.baseUrl !== undefined && typeof model.baseUrl !== "string")
    ) {
      return json(response, 400, { error: "INVALID_AGENT_PROBE" });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), config.runTimeoutMs);
    try {
      const result = await executeAgentProbe({ model, nonce: payload.nonce, signal: controller.signal });
      return json(response, 200, {
        ok: true,
        runId: payload.runId,
        toolCallId: result.toolCallId,
        usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
      });
    } catch {
      return json(response, controller.signal.aborted ? 504 : 502, {
        error: controller.signal.aborted ? "AGENT_TIMEOUT" : "AGENT_PROBE_FAILED",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  if (request.method === "POST" && url.pathname === "/internal/agent/runs") {
    let payload;
    try {
      payload = await readJson(request);
    } catch {
      return json(response, 400, { error: "INVALID_AGENT_RUN" });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json(response, 400, { error: "INVALID_AGENT_RUN" });
    }
    let contextMaterials;
    try {
      contextMaterials = validateContextMaterials(payload.contextMaterials);
    } catch {
      return json(response, 400, { error: "INVALID_AGENT_RUN" });
    }
    const clarificationAnswers = payload.clarificationAnswers ?? [];
    if (
      typeof payload.runId !== "string" ||
      typeof payload.content !== "string" ||
      !payload.content.trim() ||
      payload.content.length > 32_768 ||
      !Array.isArray(payload.history ?? []) ||
      !Array.isArray(clarificationAnswers) ||
      clarificationAnswers.length > 3 ||
      clarificationAnswers.some((answer) =>
        !answer ||
        typeof answer !== "object" ||
        typeof answer.question_id !== "string" ||
        typeof answer.option_id !== "string" ||
        typeof answer.value !== "string"
      ) ||
      (payload.history ?? []).some((message) =>
        !message ||
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string"
      ) ||
      (payload.selectionContext != null && (
        !Array.isArray(payload.selectionContext.block_ids) ||
        payload.selectionContext.block_ids.length === 0 ||
        typeof payload.selectionContext.from !== "number" ||
        typeof payload.selectionContext.to !== "number" ||
        typeof payload.selectionContext.selected_text !== "string" ||
        typeof payload.selectionContext.selected_text_hash !== "string" ||
        !contextMaterials.some((item) => item.type === "resume")
      ))
    ) {
      return json(response, 400, { error: "INVALID_AGENT_RUN" });
    }
    if (activeRuns.has(payload.runId)) {
      return json(response, 409, { error: "AGENT_RUN_IN_PROGRESS" });
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), config.runTimeoutMs);
    activeRuns.set(payload.runId, controller);
    response.on("close", () => {
      if (!response.writableEnded) controller.abort("client_disconnected");
    });
    writeEvent(response, "run.started", { runId: payload.runId });
    try {
      const usage = await executeAgentRun({
        config,
        runId: payload.runId,
        content: payload.content.trim(),
        history: payload.history ?? [],
        clarificationAnswers,
        selectionContext: payload.selectionContext ?? null,
        contextMaterials,
        emit: (type, data) => writeEvent(response, type, data),
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw new Error("AGENT_ABORTED");
      writeEvent(response, "run.completed", { runId: payload.runId, usage });
    } catch (error) {
      const timedOut = controller.signal.aborted && controller.signal.reason === "timeout";
      const cancelled = controller.signal.aborted && !timedOut;
      const internalErrorCode = agentFailureCode(error);
      const safeErrorCodes = new Set([
        "AGENT_MODEL_UNSUPPORTED",
        "AGENT_MODEL_TIMEOUT",
        "AGENT_MODEL_REQUEST_FAILED",
        "AGENT_EMPTY_RESPONSE",
        "WORKFLOW_SKILL_REQUIRED",
        "TARGET_RESOLUTION_REQUIRED",
        "DIAGNOSIS_REQUIRED",
        "SKILL_MODE_CONFLICT",
        "TARGET_STALE",
        "PATCH_OUT_OF_SCOPE",
        "SOURCE_REQUIRED",
        "SOURCE_FORBIDDEN",
        "USER_INPUT_REQUIRED",
        "AGENT_CLARIFICATION_INVALID",
      ]);
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        service: "linkresume-pi",
        event: "agent_run_failed",
        run_id: payload.runId,
        error_code: timedOut ? "AGENT_TIMEOUT" : internalErrorCode,
        cancelled,
      }));
      writeEvent(response, cancelled ? "run.cancelled" : "run.failed", {
        runId: payload.runId,
        ...(cancelled ? {} : {
          error: timedOut
            ? "AGENT_TIMEOUT"
            : safeErrorCodes.has(internalErrorCode) ? internalErrorCode : "AGENT_EXECUTION_FAILED",
        }),
      });
    } finally {
      clearTimeout(timeout);
      activeRuns.delete(payload.runId);
      response.end();
    }
    return;
  }
  const cancelMatch = url.pathname.match(/^\/internal\/agent\/runs\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    const runId = decodeURIComponent(cancelMatch[1]);
    const controller = activeRuns.get(runId);
    if (controller) controller.abort("cancelled");
    return json(response, 200, { runId, status: controller ? "cancelled" : "not_running" });
  }
  return json(response, 404, { error: "NOT_FOUND" });
});

server.listen(config.port, config.host, () => {
  process.stdout.write(`linkresume-pi listening on ${config.host}:${config.port}\n`);
});
