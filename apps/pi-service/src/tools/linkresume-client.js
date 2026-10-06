export class LinkResumeToolError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function optionalLogIdentifier(value, maxLength) {
  if (typeof value !== "string") return null;
  let length = 0;
  // Match Python/MySQL character counts rather than UTF-16 code units.
  for (const character of value) {
    if (++length > maxLength) return null;
  }
  return value;
}

export function createLinkResumeClient(config, runId, signal, initialSource = null) {
  let source = initialSource;
  async function request(path, options = {}) {
    const timeout = AbortSignal.timeout(config.toolTimeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const response = await fetch(`${config.linkresumeBaseUrl}${path}`, {
      ...options,
      signal: combined,
      headers: {
        Authorization: `Bearer ${config.linkresumeToken}`,
        "Content-Type": "application/json",
        ...(source == null ? {} : { "X-Agent-User-Sequence": String(source) }),
        ...options.headers,
      },
    });
    if (!response.ok) {
      let code = "AGENT_TOOL_FAILED";
      try {
        const body = await response.json();
        if (typeof body.error === "string") code = body.error;
      } catch {
        // The public error remains intentionally generic.
      }
      throw new LinkResumeToolError(code, response.status);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    setSource: (value) => { source = value; },
    activateSteering: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/steering:activate`, {
      method: "POST", body: JSON.stringify(payload),
    }),
    acknowledgeSteering: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/steering:ack`, {
      method: "POST", body: JSON.stringify(payload),
    }),
    completeReply: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/messages:complete`, {
      method: "POST", body: JSON.stringify(payload),
    }),
    readiness: () => request("/internal/agent/readiness"),
    runtimeConfig: () => request(`/internal/agent/runtime-config?run_id=${encodeURIComponent(runId)}`),
    recognizeIntent: () => request(`/internal/agent/runs/${encodeURIComponent(runId)}/intent:recognize`, {
      method: "POST",
    }),
    recordLlmCall: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/llm-calls`, {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        // Existing PiCallRecord/LLMCallLog limits; identifiers are optional.
        responseModelId: optionalLogIdentifier(payload.responseModelId, 256),
        upstreamRequestId: optionalLogIdentifier(payload.upstreamRequestId, 128),
      }),
    }),
    context: (resumeId) => request(
      `/internal/agent/runs/${encodeURIComponent(runId)}/context?resume_id=${encodeURIComponent(resumeId)}`,
    ),
    resolveResumeReference: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/resumes:resolve-reference`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    resolveResourceReference: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/resources:resolve-reference`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    listUserResources: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/resources:list`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    resolveTarget: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/targets:resolve`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    scopedContext: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/context:read`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    searchMaterials: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/materials:search`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    diagnose: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/diagnoses`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    proposal: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/proposals`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    scopedProposal: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/proposals:v2`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    translationProposal: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/proposals:translation`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    planTasks: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/tasks:plan`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    taskMaterials: (taskId) => request(
      `/internal/agent/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/materials`,
    ),
    taskStatus: (taskId, payload) => request(
      `/internal/agent/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}:status`, {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
    toolEvent: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/tool-events`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  };
}
