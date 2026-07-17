#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];
const TERMINAL_STATUSES = new Set(["done", "cancelled"]);
const MARKER_VERSION = "v1";
const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function buildMarker(workspaceId, issueId) {
  return `<!-- multica-sync:${MARKER_VERSION} workspace=${workspaceId} issue=${issueId} -->`;
}

export function githubStateFor(status) {
  return TERMINAL_STATUSES.has(status) ? "closed" : "open";
}

export function githubStateReasonFor(status) {
  if (status === "cancelled") return "not_planned";
  if (status === "done") return "completed";
  return "reopened";
}

export function findIssueByMarker(issues, marker) {
  return issues.find(
    (issue) => !issue.pull_request && typeof issue.body === "string" && issue.body.includes(marker),
  );
}

function issueIdentifier(issue) {
  return issue.identifier || issue.issue_identifier || issue.id;
}

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

export function desiredGithubIssue(issue, config) {
  const identifier = issueIdentifier(issue);
  const status = issue.status || "backlog";
  const priority = issue.priority || "none";
  const description = (issue.description || "_Multica 中暂未填写描述。_").trim();
  const marker = buildMarker(config.workspaceId, issue.id);
  const header = [
    marker,
    "> 此 Issue 由 Multica 自动镜像。Multica 是主数据源；请回到 Multica 修改标题、描述和状态。",
    "",
    `- Multica Issue: \`${identifier}\``,
    `- 状态: \`${status}\``,
    `- 优先级: \`${priority}\``,
    `- 工作区: \`${config.workspaceSlug}\``,
    "",
    "---",
    "",
  ].join("\n");
  const body = truncate(`${header}${description}`, 65_536);
  return {
    title: truncate(`[${identifier}] ${issue.title}`, 256),
    body,
    state: githubStateFor(status),
    stateReason: githubStateReasonFor(status),
    marker,
  };
}

function hashDesired(desired) {
  return createHash("sha256")
    .update(JSON.stringify({
      title: desired.title,
      body: desired.body,
      state: desired.state,
      stateReason: desired.stateReason,
    }))
    .digest("hex");
}

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} 返回了无效 JSON: ${error.message}`);
  }
}

function normalizeMetadata(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((item) => [item.key, item.value]));
  }
  if (raw.metadata && typeof raw.metadata === "object") return raw.metadata;
  return raw;
}

function normalizeIssue(raw) {
  return raw?.issue || raw;
}

function commandError(command, args, code, stderr) {
  const detail = stderr.trim() || `exit ${code}`;
  return new Error(`${command} ${args.join(" ")} 失败: ${detail}`);
}

async function runCommand(command, args, { input, allowExitCodes = [] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowExitCodes.includes(code)) {
        resolve({ stdout, stderr, code });
      } else {
        reject(commandError(command, args, code, stderr));
      }
    });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

function loadConfig() {
  const multicaConfigPath =
    process.env.MULTICA_CONFIG_PATH || join(homedir(), ".multica", "config.json");
  if (!existsSync(multicaConfigPath)) {
    throw new Error(`找不到 Multica 配置文件: ${multicaConfigPath}`);
  }
  const multicaConfig = parseJson(
    readFileSync(multicaConfigPath, "utf8"),
    "Multica 配置文件",
  );
  const workspaceId = process.env.MULTICA_WORKSPACE_ID;
  if (!workspaceId) throw new Error("缺少 MULTICA_WORKSPACE_ID");
  if (!multicaConfig.token) throw new Error("Multica 配置文件中没有登录 token");

  const serverUrl = process.env.MULTICA_SERVER_URL || multicaConfig.server_url;
  const wsUrl = new URL(process.env.MULTICA_WS_URL || "/ws", serverUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set(
    "workspace_slug",
    process.env.MULTICA_WORKSPACE_SLUG || "linkcv",
  );
  wsUrl.searchParams.set("client_platform", "linkcv-sync");
  wsUrl.searchParams.set("client_version", MARKER_VERSION);

  return {
    workspaceId,
    workspaceSlug: process.env.MULTICA_WORKSPACE_SLUG || "linkcv",
    repository: process.env.GITHUB_REPOSITORY || "ql-link/LinkCV",
    githubIssuePropertyId: process.env.MULTICA_GITHUB_ISSUE_PROPERTY_ID || "",
    githubSyncPropertyId: process.env.MULTICA_GITHUB_SYNC_PROPERTY_ID || "",
    githubSyncedOptionId: process.env.MULTICA_GITHUB_SYNCED_OPTION_ID || "",
    multicaCli: process.env.MULTICA_CLI || "multica",
    multicaToken: multicaConfig.token,
    wsUrl: wsUrl.toString(),
    reconcileIntervalMs: Number(
      process.env.SYNC_RECONCILE_INTERVAL_MS || DEFAULT_RECONCILE_INTERVAL_MS,
    ),
    dryRun: process.argv.includes("--dry-run"),
    once: process.argv.includes("--once"),
  };
}

function logger(level, message, fields = {}) {
  const suffix = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

function createBridge(config) {
  let githubIssueCache = null;

  async function multica(args) {
    const { stdout } = await runCommand(config.multicaCli, [
      "--workspace-id",
      config.workspaceId,
      ...args,
    ]);
    return stdout.trim() ? parseJson(stdout, `multica ${args.join(" ")}`) : null;
  }

  async function gh(args, input) {
    const { stdout } = await runCommand("gh", args, { input });
    return stdout.trim() ? parseJson(stdout, `gh ${args.join(" ")}`) : null;
  }

  async function ghApi(method, endpoint, payload) {
    const args = ["api", "--method", method, endpoint];
    const input = payload === undefined ? undefined : JSON.stringify(payload);
    if (input !== undefined) args.push("--input", "-");
    return gh(args, input);
  }

  async function setMetadata(issueId, key, value, type = "string") {
    if (config.dryRun) return;
    await multica([
      "issue",
      "metadata",
      "set",
      issueId,
      "--key",
      key,
      "--type",
      type,
      "--value",
      String(value),
      "--output",
      "json",
    ]);
  }

  async function setProperty(issueId, name, value) {
    if (config.dryRun) return;
    await multica([
      "issue",
      "property",
      "set",
      issueId,
      "--name",
      name,
      "--value",
      String(value),
      "--output",
      "json",
    ]);
  }

  async function listGithubIssues() {
    if (githubIssueCache) return githubIssueCache;
    const pages = await gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${config.repository}/issues?state=all&per_page=100`,
    ]);
    githubIssueCache = (pages || []).flat();
    return githubIssueCache;
  }

  async function getGithubIssue(number) {
    try {
      return await ghApi("GET", `repos/${config.repository}/issues/${number}`);
    } catch (error) {
      if (/HTTP 404|Not Found|status 404/i.test(error.message)) return null;
      throw error;
    }
  }

  async function findGithubIssue(metadata, desired) {
    const number = Number(metadata.github_issue_number);
    if (Number.isInteger(number) && number > 0) {
      const linked = await getGithubIssue(number);
      if (linked && !linked.pull_request && linked.body?.includes(desired.marker)) {
        return linked;
      }
    }
    return findIssueByMarker(await listGithubIssues(), desired.marker) || null;
  }

  async function createGithubIssue(desired) {
    const created = await ghApi("POST", `repos/${config.repository}/issues`, {
      title: desired.title,
      body: desired.body,
      labels: ["multica"],
    });
    githubIssueCache?.push(created);
    return created;
  }

  async function updateGithubIssue(current, desired) {
    const payload = {};
    if (current.title !== desired.title) payload.title = desired.title;
    if ((current.body || "") !== desired.body) payload.body = desired.body;
    if (current.state !== desired.state) {
      payload.state = desired.state;
      payload.state_reason = desired.stateReason;
    }
    if (!Object.keys(payload).length) return current;
    const updated = await ghApi(
      "PATCH",
      `repos/${config.repository}/issues/${current.number}`,
      payload,
    );
    if (githubIssueCache) {
      const index = githubIssueCache.findIndex((item) => item.number === updated.number);
      if (index >= 0) githubIssueCache[index] = updated;
    }
    return updated;
  }

  async function readMetadata(issueId) {
    const raw = await multica([
      "issue",
      "metadata",
      "list",
      issueId,
      "--output",
      "json",
    ]);
    return normalizeMetadata(raw);
  }

  async function markPending(issueId) {
    try {
      await setProperty(issueId, "GitHub Sync", "Pending");
    } catch (error) {
      logger("error", "无法写入 Pending 状态", { issueId, error: error.message });
    }
  }

  async function markError(issueId, error) {
    logger("error", "Issue 同步失败", { issueId, error: error.message });
    try {
      await setProperty(issueId, "GitHub Sync", "Error");
      await setMetadata(
        issueId,
        "github_sync_error",
        truncate(error.message, 1_000),
      );
    } catch (metadataError) {
      logger("error", "无法回写同步错误", {
        issueId,
        error: metadataError.message,
      });
    }
  }

  async function syncIssueById(issueId) {
    try {
      const rawIssue = await multica(["issue", "get", issueId, "--output", "json"]);
      const issue = normalizeIssue(rawIssue);
      if (!issue?.id) throw new Error("Multica issue get 没有返回 Issue ID");

      if (
        process.env.MULTICA_FILTER_PROJECT_ID &&
        issue.project_id !== process.env.MULTICA_FILTER_PROJECT_ID
      ) {
        await setProperty(issue.id, "GitHub Sync", "Ignored");
        return;
      }

      const metadata = issue.metadata
        ? normalizeMetadata(issue.metadata)
        : await readMetadata(issue.id);
      if (!metadata.github_issue_number) await markPending(issue.id);

      const desired = desiredGithubIssue(issue, config);
      if (config.dryRun) {
        logger("info", "dry-run: 将同步 Issue", {
          issue: issueIdentifier(issue),
          title: desired.title,
          state: desired.state,
        });
        return;
      }

      let githubIssue = await findGithubIssue(metadata, desired);
      githubIssue = githubIssue
        ? await updateGithubIssue(githubIssue, desired)
        : await createGithubIssue(desired);

      if (githubIssue.state !== desired.state) {
        githubIssue = await updateGithubIssue(githubIssue, desired);
      }

      const metadataWrites = [
        ["github_issue_number", githubIssue.number, "number"],
        ["github_issue_url", githubIssue.html_url, "string"],
        ["github_repository", config.repository, "string"],
        ["github_sync_version", MARKER_VERSION, "string"],
        ["github_sync_hash", hashDesired(desired), "string"],
      ].filter(([key, value]) => String(metadata[key] ?? "") !== String(value));
      for (const [key, value, type] of metadataWrites) {
        await setMetadata(issue.id, key, value, type);
      }
      await setMetadata(issue.id, "github_synced_at", new Date().toISOString());
      if (metadata.github_sync_error) {
        await setMetadata(issue.id, "github_sync_error", "");
      }
      const properties = issue.properties || {};
      if (
        !config.githubIssuePropertyId ||
        properties[config.githubIssuePropertyId] !== githubIssue.html_url
      ) {
        await setProperty(issue.id, "GitHub Issue", githubIssue.html_url);
      }
      if (
        !config.githubSyncPropertyId ||
        !config.githubSyncedOptionId ||
        properties[config.githubSyncPropertyId] !== config.githubSyncedOptionId
      ) {
        await setProperty(issue.id, "GitHub Sync", "Synced");
      }

      logger("info", "Issue 已同步", {
        issue: issueIdentifier(issue),
        github: `#${githubIssue.number}`,
        state: githubIssue.state,
      });
    } catch (error) {
      await markError(issueId, error);
    }
  }

  async function listMulticaIssues() {
    const byId = new Map();
    const statusResults = await Promise.all(
      ISSUE_STATUSES.map((status) =>
        multica([
          "issue",
          "list",
          "--status",
          status,
          "--limit",
          "1000",
          "--output",
          "json",
        ]),
      ),
    );
    for (const raw of statusResults) {
      const issues = Array.isArray(raw) ? raw : raw?.issues || [];
      for (const issue of issues) byId.set(issue.id, issue);
    }
    return [...byId.values()];
  }

  async function reconcile() {
    githubIssueCache = null;
    const issues = await listMulticaIssues();
    logger("info", "开始全量校准", { count: issues.length });
    for (const issue of issues) await syncIssueById(issue.id);
    logger("info", "全量校准完成", { count: issues.length });
  }

  async function ensureGithubLabel() {
    if (config.dryRun) return;
    await runCommand("gh", [
      "label",
      "create",
      "multica",
      "--repo",
      config.repository,
      "--color",
      "0969DA",
      "--description",
      "Mirrored from a Multica Issue; Multica is the source of truth.",
      "--force",
    ]);
  }

  return { ensureGithubLabel, reconcile, syncIssueById };
}

function issueIdFromEvent(message) {
  if (!message || !["issue:created", "issue:updated"].includes(message.type)) return null;
  return message.payload?.issue?.id || null;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(`用法: node ${fileURLToPath(import.meta.url)} [--once] [--dry-run]\n\n环境变量:\n  MULTICA_WORKSPACE_ID       必填\n  MULTICA_WORKSPACE_SLUG     默认 linkcv\n  MULTICA_CONFIG_PATH        默认 ~/.multica/config.json\n  MULTICA_CLI                默认 multica\n  GITHUB_REPOSITORY          默认 ql-link/LinkCV\n  SYNC_RECONCILE_INTERVAL_MS 默认 300000`);
    return;
  }

  const config = loadConfig();
  const bridge = createBridge(config);
  await bridge.ensureGithubLabel();
  if (config.once) {
    await bridge.reconcile();
    return;
  }

  let stopped = false;
  let reconnectAttempt = 0;
  let socket = null;
  let serial = Promise.resolve();
  let hasAuthenticated = false;

  const enqueueWork = (name, work) => {
    serial = serial
      .catch((error) => {
        logger("error", "前一个同步任务失败，队列继续运行", {
          name,
          error: error.message,
        });
      })
      .then(work)
      .catch((error) => {
        logger("error", "同步任务失败", { name, error: error.message });
      });
  };

  const enqueue = (issueId) => {
    enqueueWork(`issue:${issueId}`, () => bridge.syncIssueById(issueId));
  };

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(config.wsUrl);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({ type: "auth", payload: { token: config.multicaToken } }),
      );
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        logger("error", "收到无法解析的 Multica WebSocket 消息");
        return;
      }
      if (message.type === "auth_ack") {
        reconnectAttempt = 0;
        logger("info", "Multica 实时事件已连接");
        if (hasAuthenticated) {
          enqueueWork("reconnect-reconcile", () => bridge.reconcile());
        }
        hasAuthenticated = true;
        return;
      }
      const issueId = issueIdFromEvent(message);
      if (issueId) enqueue(issueId);
    });
    socket.addEventListener("close", () => {
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
      reconnectAttempt += 1;
      logger("error", "Multica 实时连接断开，准备重连", { delay });
      setTimeout(connect, delay).unref();
    });
    socket.addEventListener("error", () => {
      // close 事件负责重连，避免重复调度。
    });
  };

  const reconcileTimer = setInterval(() => {
    enqueueWork("scheduled-reconcile", () => bridge.reconcile());
  }, config.reconcileIntervalMs);
  reconcileTimer.unref();
  connect();
  enqueueWork("startup-reconcile", () => bridge.reconcile());

  const shutdown = () => {
    stopped = true;
    clearInterval(reconcileTimer);
    socket?.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isEntryPoint =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntryPoint) {
  main().catch((error) => {
    logger("error", "同步桥接器启动失败", { error: error.message });
    process.exitCode = 1;
  });
}
