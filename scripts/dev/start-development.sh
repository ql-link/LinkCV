#!/usr/bin/env bash
# Git Bash requires this launcher to remain LF-only; .gitattributes enforces it.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
base_env="${LINKCV_ENV_FILE:-${repo_root}/.env.development}"
if [[ "${base_env}" =~ ^[A-Za-z]:[\\/] ]] && command -v wslpath >/dev/null 2>&1; then
  base_env="$(wslpath -u "${base_env}")"
fi
local_env="${base_env}.local"
runtime_agent_env="${repo_root}/.runtime/development-agent.env"

if [[ ! -f "${base_env}" ]]; then
  echo "Missing Development environment file: ${base_env}" >&2
  exit 10
fi

node_bin="node"
node_uses_windows_interop=false
node_path() {
  printf '%s' "$1"
}
if ! command -v "${node_bin}" >/dev/null 2>&1; then
  if command -v node.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
    node_bin="node.exe"
    node_uses_windows_interop=true
    node_path() {
      wslpath -w "$1"
    }
  else
    echo "Node.js is not available to the Development launcher" >&2
    exit 13
  fi
fi

backend_port="${LINKCV_LOCAL_BACKEND_PORT:-18000}"
pi_port="${LINKCV_LOCAL_PI_PORT:-8010}"
worktree_queue_id="$(printf '%s' "${repo_root}" | cksum | awk '{print $1}')"
log_directory="${LINKCV_LOCAL_LOG_DIRECTORY:-${repo_root}/.runtime/logs}"

export LINKCV_ENV_FILE="$(node_path "${base_env}")"
if [[ -f "${local_env}" ]]; then
  export LINKCV_SECRET_ENV_FILE="$(node_path "${local_env}")"
fi
export BACKEND_HOST="127.0.0.1"
export BACKEND_PORT="${backend_port}"
export BACKEND_PROXY_TARGET="http://127.0.0.1:${backend_port}"
export PI_SERVICE_HOST="127.0.0.1"
export PI_SERVICE_PORT="${pi_port}"
export PI_SERVICE_BASE_URL="http://127.0.0.1:${pi_port}"
export LINKCV_BASE_URL="http://127.0.0.1:${backend_port}"
export LOG_DIRECTORY="$(node_path "${log_directory}")"
export RABBITMQ_QUEUE="${LINKCV_LOCAL_RABBITMQ_QUEUE:-linkcv.resume_import.worker.local.${worktree_queue_id}.v2}"
export RABBITMQ_ROUTING_KEY="${LINKCV_LOCAL_RABBITMQ_ROUTING_KEY:-resume.import.local.${worktree_queue_id}.v2}"

mkdir -p "${log_directory}"

echo "本地 Dev MQ 队列：${RABBITMQ_QUEUE}"
echo "本地 Dev MQ 路由：${RABBITMQ_ROUTING_KEY}"

node_env_args=("--env-file=$(node_path "${base_env}")")
if [[ -f "${local_env}" ]]; then
  node_env_args+=("--env-file=$(node_path "${local_env}")")
fi

"${node_bin}" "${node_env_args[@]}" \
  "$(node_path "${script_dir}/prepare-development-agent-env.mjs")" \
  "$(node_path "${runtime_agent_env}")"
# The tracked profile contains blank placeholders, and inherited environment
# values take precedence over every Node --env-file. Promote generated tokens
# into the process environment without printing them.
set -a
source "${runtime_agent_env}"
set +a
if [[ "${node_uses_windows_interop}" == true ]]; then
  windows_env_names="LINKCV_ENV_FILE:LINKCV_SECRET_ENV_FILE:BACKEND_HOST:BACKEND_PORT:BACKEND_PROXY_TARGET:PI_SERVICE_HOST:PI_SERVICE_PORT:PI_SERVICE_BASE_URL:LINKCV_BASE_URL:LOG_DIRECTORY:RABBITMQ_QUEUE:RABBITMQ_ROUTING_KEY:PI_SERVICE_TOKEN:LINKCV_INTERNAL_AGENT_TOKEN"
  export WSLENV="${WSLENV:+${WSLENV}:}${windows_env_names}"
fi
# Node keeps the first value across repeated --env-file flags. Runtime tokens
# must precede the blank placeholders from the tracked Development profile.
node_env_args=("--env-file=$(node_path "${runtime_agent_env}")" "${node_env_args[@]}")

"${node_bin}" "${node_env_args[@]}" -e '
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
exec "${node_bin}" "${node_env_args[@]}" \
  "$(node_path "${script_dir}/run-development.mjs")"
