import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { afterEach, describe, it } from "node:test";
import type { AssistantMessage, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "../../../third_party/pi/packages/agent/src/types.ts";
import { resolveRuntimeModel } from "../src/model-resolver.ts";
import { runProbe } from "../src/probe.ts";
import { createPiServer } from "../src/server.ts";

const servers: ReturnType<typeof createPiServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function toolStream(model: Model<any>, nonce: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: "tool-1", name: "probe", arguments: { nonce } }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 4,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 6,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
  queueMicrotask(() => stream.push({ type: "done", reason: "toolUse", message }));
  return stream;
}

describe("Pi native model resolver", () => {
  it("keeps DeepSeek compatibility while overriding the configured base URL", () => {
    const model = resolveRuntimeModel({
      adapter: "deepseek",
      id: "1",
      name: "deepseek-v4-flash",
      baseUrl: "https://gateway.example.test/v1/",
    });
    assert.equal(model.provider, "deepseek");
    assert.equal(model.api, "openai-completions");
    assert.equal(model.baseUrl, "https://gateway.example.test/v1");
    assert.equal(model.compat?.thinkingFormat, "deepseek");
  });

  it("uses Pi's Qwen profile for DashScope models", () => {
    const model = resolveRuntimeModel({ adapter: "dashscope", id: "2", name: "qwen3.7-plus" });
    assert.equal(model.api, "openai-completions");
    assert.equal(model.compat?.thinkingFormat, "qwen");
  });

  it("rejects unsupported adapters and non-local plaintext endpoints", () => {
    assert.throws(
      () => resolveRuntimeModel({ adapter: "anthropic", id: "3", name: "claude" }),
      /PI_MODEL_ADAPTER_UNSUPPORTED/,
    );
    assert.throws(
      () =>
        resolveRuntimeModel({
          adapter: "deepseek",
          id: "4",
          name: "deepseek-v4-flash",
          baseUrl: "http://provider.example.test/v1",
        }),
      /PI_MODEL_BASE_URL_UNSUPPORTED/,
    );
    assert.throws(
      () =>
        resolveRuntimeModel({
          adapter: "deepseek",
          id: "5",
          name: "deepseek-v4-flash",
          baseUrl: "https://user:password@provider.example.test/v1",
        }),
      /PI_MODEL_BASE_URL_UNSUPPORTED/,
    );
  });
});

describe("Pi probe", () => {
  it("passes the selected Pi model and request-scoped API key to the native stream", async () => {
    let selectedModel: Model<"openai-completions"> | undefined;
    let selectedOptions: SimpleStreamOptions | undefined;
    const streamFn: StreamFn = (model, _context, options) => {
      if (model.api !== "openai-completions") throw new Error("Unexpected API");
      selectedModel = model as Model<"openai-completions">;
      selectedOptions = options;
      return toolStream(model, "nonce-1");
    };

    const result = await runProbe(
      {
        runId: "run-1",
        nonce: "nonce-1",
        model: {
          adapter: "deepseek",
          id: "model-1",
          name: "deepseek-v4-flash",
          apiKey: "fictional-provider-key",
        },
      },
      { streamFn },
    );

    assert.equal(selectedModel?.provider, "deepseek");
    assert.equal(selectedModel?.compat?.thinkingFormat, "deepseek");
    assert.equal(selectedOptions?.reasoning, undefined);
    assert.deepEqual(result, {
      ok: true,
      runId: "run-1",
      toolCallId: "tool-1",
      usage: { inputTokens: 4, outputTokens: 2 },
    });
  });

  it("does not echo credentials when a probe fails", async () => {
    const server = createPiServer("service-token");
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const body = JSON.stringify({
      runId: "run-2",
      nonce: "nonce-2",
      model: { adapter: "unsupported", id: "2", name: "model", apiKey: "fictional-secret-key" },
    });
    const responseBody = await new Promise<string>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/internal/probes",
          method: "POST",
          headers: {
            authorization: "Bearer service-token",
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        },
      );
      request.on("error", reject);
      request.end(body);
    });
    assert.equal(responseBody, '{"error":"PI_PROBE_FAILED"}');
    assert.equal(responseBody.includes("fictional-secret-key"), false);
  });
});
