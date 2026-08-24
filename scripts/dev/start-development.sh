#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
base_env="${LINKCV_ENV_FILE:-${repo_root}/.env.development}"
local_env="${base_env}.local"
runtime_agent_env="${repo_root}/.runtime/development-agent.env"

if [[ ! -f "${base_env}" ]]; then
  echo "Missing Development environment file: ${base_env}" >&2
  exit 10
fi

backend_port="${LINKCV_LOCAL_BACKEND_PORT:-18000}"
pi_port="${LINKCV_LOCAL_PI_PORT:-8010}"

export LINKCV_ENV_FILE="${base_env}"
export BACKEND_HOST="127.0.0.1"
export BACKEND_PORT="${backend_port}"
export BACKEND_PROXY_TARGET="http://127.0.0.1:${backend_port}"
export PI_SERVICE_HOST="127.0.0.1"
export PI_SERVICE_PORT="${pi_port}"
export PI_SERVICE_BASE_URL="http://127.0.0.1:${pi_port}"
export LINKCV_BASE_URL="http://127.0.0.1:${backend_port}"
export LOG_DIRECTORY="${LINKCV_LOCAL_LOG_DIRECTORY:-${repo_root}/.runtime/logs}"

mkdir -p "${LOG_DIRECTORY}"

node_env_args=("--env-file=${base_env}")
if [[ -f "${local_env}" ]]; then
  node_env_args+=("--env-file=${local_env}")
fi

node "${node_env_args[@]}" \
  "${script_dir}/prepare-development-agent-env.mjs" \
  "${runtime_agent_env}"
node_env_args+=("--env-file=${runtime_agent_env}")

node "${node_env_args[@]}" -e '
  const required = [
    "PI_SERVICE_TOKEN",
    "LINKCV_INTERNAL_AGENT_TOKEN",
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.error(`Missing Development Agent secrets: ${missing.join(", ")}`);
    process.exit(11);
  }
  if (process.env.PI_SERVICE_TOKEN === process.env.LINKCV_INTERNAL_AGENT_TOKEN) {
    console.error("PI_SERVICE_TOKEN and LINKCV_INTERNAL_AGENT_TOKEN must be different");
    process.exit(12);
  }
  if (!process.env.LLM_CREDENTIAL_ENCRYPTION_KEYS?.trim()) {
    console.warn(
      "LLM_CREDENTIAL_ENCRYPTION_KEYS is missing; the application can start, " +
      "but Pi readiness and model credential management remain unavailable.",
    );
  }
'

cd "${repo_root}"
exec node "${node_env_args[@]}" \
  "${script_dir}/run-development.mjs"
