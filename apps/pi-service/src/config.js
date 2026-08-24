const PLACEHOLDER_MARKERS = ["replace-with", "change-me", "example"];

export function isUnsafeSecret(value) {
  const normalized = (value ?? "").trim().toLowerCase();
  return (
    normalized.length < 32 ||
    PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))
  );
}

function positiveNumber(value, fallback, name) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const production = (env.APP_ENV ?? "development").toLowerCase() === "production";
  const serviceToken = env.PI_SERVICE_TOKEN ?? "";
  const linkcvToken = env.LINKCV_INTERNAL_AGENT_TOKEN ?? "";
  if (production && (isUnsafeSecret(serviceToken) || isUnsafeSecret(linkcvToken))) {
    throw new Error("Pi service tokens are missing or unsafe");
  }
  const baseUrl = new URL(env.LINKCV_BASE_URL ?? "http://127.0.0.1:8000");
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error("LINKCV_BASE_URL must use HTTP(S)");
  }
  return {
    host: env.PI_SERVICE_HOST ?? "127.0.0.1",
    port: positiveNumber(env.PI_SERVICE_PORT, 8010, "PI_SERVICE_PORT"),
    serviceToken,
    linkcvToken,
    linkcvBaseUrl: baseUrl.toString().replace(/\/$/, ""),
    toolTimeoutMs: positiveNumber(env.AGENT_TOOL_TIMEOUT_SECONDS, 15, "AGENT_TOOL_TIMEOUT_SECONDS") * 1000,
    runTimeoutMs: positiveNumber(env.AGENT_RUN_TIMEOUT_SECONDS, 120, "AGENT_RUN_TIMEOUT_SECONDS") * 1000,
  };
}
