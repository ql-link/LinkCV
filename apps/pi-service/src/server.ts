import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runProbe, type ProbeRequest } from "./probe.ts";

const MAX_BODY_BYTES = 64 * 1024;

function send(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isProbeRequest(value: unknown): value is ProbeRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const model = item.model as Record<string, unknown> | undefined;
  return (
    typeof item.runId === "string" &&
    typeof item.nonce === "string" &&
    !!model &&
    typeof model.adapter === "string" &&
    typeof model.id === "string" &&
    typeof model.name === "string" &&
    typeof model.apiKey === "string" &&
    model.apiKey.length > 0 &&
    (model.baseUrl === undefined || typeof model.baseUrl === "string")
  );
}

export function createPiServer(serviceToken: string) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, { ok: true, service: "linkcv-pi" });
      return;
    }
    if (request.method !== "POST" || request.url !== "/internal/probes") {
      send(response, 404, { error: "NOT_FOUND" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${serviceToken}`) {
      send(response, 401, { error: "UNAUTHORIZED" });
      return;
    }
    try {
      const payload = await readJson(request);
      if (!isProbeRequest(payload)) {
        send(response, 422, { error: "INVALID_PROBE_REQUEST" });
        return;
      }
      send(response, 200, await runProbe(payload));
    } catch {
      send(response, 502, { error: "PI_PROBE_FAILED" });
    }
  });
}
