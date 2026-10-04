import { createHash } from "node:crypto";

// Only the admitted input lives here; editing and ordering stay in the browser.
export function createSteeringHandle(runId, enqueue, isActive) {
  const receipts = new Map();
  let pending = null;
  return {
    async submit(payload) {
      if (!payload || typeof payload.content !== "string" || !payload.content.trim()
          || payload.content.length > 32768 || !/^[A-Za-z0-9_-]{8,64}$/.test(payload.idempotency_key ?? "")) {
        throw Object.assign(new Error("INVALID_AGENT_MESSAGE"), { status: 400 });
      }
      const key = payload.idempotency_key;
      const canonical = (value) => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])])) : value;
      const hash = createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
      const previous = receipts.get(key);
      if (previous) {
        if (previous.hash !== hash) throw Object.assign(new Error("AGENT_SUBMISSION_CONFLICT"), { status: 409 });
        return previous.receipt;
      }
      if (!isActive()) throw Object.assign(new Error("AGENT_STEER_TARGET_FINISHED"), { status: 409 });
      if (pending) throw Object.assign(new Error("AGENT_STEER_BUSY"), { status: 409 });
      const receipt = { run_id: runId, submission_key: key, state: "waiting", run_status: "running" };
      const input = structuredClone(payload);
      pending = { payload: input, receipt };
      receipts.set(key, { hash, receipt });
      try {
        await enqueue(input);
      } catch (error) {
        pending = null;
        receipts.delete(key);
        throw error;
      }
      return receipt;
    },
    current: () => pending,
    fingerprint: (key) => receipts.get(key)?.hash ?? null,
    update(state, data = {}) {
      if (!pending) return;
      Object.assign(pending.receipt, data, { state });
      if (["applied", "not_applied"].includes(state)) pending = null;
    },
    lookup: (key) => receipts.get(key)?.receipt ?? {
      run_id: runId, submission_key: key, state: isActive() ? "unknown" : "not_applied", run_status: "running",
    },
  };
}
