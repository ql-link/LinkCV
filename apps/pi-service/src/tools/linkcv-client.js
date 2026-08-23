export class LinkCVToolError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function createLinkCVClient(config, runId, signal) {
  async function request(path, options = {}) {
    const timeout = AbortSignal.timeout(config.toolTimeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const response = await fetch(`${config.linkcvBaseUrl}${path}`, {
      ...options,
      signal: combined,
      headers: {
        Authorization: `Bearer ${config.linkcvToken}`,
        "Content-Type": "application/json",
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
      throw new LinkCVToolError(code, response.status);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    readiness: () => request("/internal/agent/readiness"),
    runtimeConfig: () => request(`/internal/agent/runtime-config?run_id=${encodeURIComponent(runId)}`),
    context: () => request(`/internal/agent/runs/${encodeURIComponent(runId)}/context`),
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
    toolEvent: (payload) => request(`/internal/agent/runs/${encodeURIComponent(runId)}/tool-events`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  };
}
