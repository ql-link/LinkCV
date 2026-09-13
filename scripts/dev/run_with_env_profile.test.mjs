import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildProfileEnvironment,
  npmInvocation,
  resolveProfileFiles,
  serviceScriptForProfile,
  syncMiniprogramLocalConfig,
} from "./run_with_env_profile.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "linkresume-env-"));
  const mainRoot = join(root, "main");
  const worktree = join(root, "worktree");
  mkdirSync(join(mainRoot, ".git"), { recursive: true });
  mkdirSync(worktree, { recursive: true });
  return { mainRoot, worktree, gitCommonDir: join(mainRoot, ".git") };
}

test("worktree profile uses the main worktree secret overlay", () => {
  const paths = fixture();
  writeFileSync(join(paths.worktree, ".env.development"), "VALUE=base\nBASE_ONLY=yes\n");
  writeFileSync(join(paths.mainRoot, ".env.development.local"), "VALUE=secret\nSECRET_ONLY=yes\n");

  const result = buildProfileEnvironment({
    cwd: paths.worktree,
    profile: ".env.development",
    inheritedEnv: { VALUE: "process" },
    gitCommonDir: paths.gitCommonDir,
  });

  assert.equal(result.files.secret, join(paths.mainRoot, ".env.development.local"));
  assert.equal(result.env.VALUE, "process");
  assert.equal(result.env.BASE_ONLY, "yes");
  assert.equal(result.env.SECRET_ONLY, "yes");
  assert.equal(result.env.LINKRESUME_ENV_FILE, join(paths.worktree, ".env.development"));
});

test("local profile can run from the main worktree secret file alone", () => {
  const paths = fixture();
  writeFileSync(join(paths.mainRoot, ".env.local"), "APP_ENV=local\n");

  const result = buildProfileEnvironment({
    cwd: paths.worktree,
    profile: ".env",
    inheritedEnv: {},
    gitCommonDir: paths.gitCommonDir,
  });

  assert.equal(result.files.base, join(paths.mainRoot, ".env"));
  assert.equal(result.files.secret, join(paths.mainRoot, ".env.local"));
  assert.equal(result.env.APP_ENV, "local");
});

test("local profile aligns a loopback RabbitMQ URL with the Compose host port", () => {
  const paths = fixture();
  writeFileSync(
    join(paths.mainRoot, ".env"),
    "RABBITMQ_PORT=5676\n",
  );
  writeFileSync(
    join(paths.mainRoot, ".env.local"),
    "RABBITMQ_URL=amqp://linkresume:secret@127.0.0.1:5672/\n",
  );

  const result = buildProfileEnvironment({
    cwd: paths.mainRoot,
    profile: ".env",
    inheritedEnv: {},
    gitCommonDir: join(paths.mainRoot, ".git"),
  });

  assert.equal(
    result.env.RABBITMQ_URL,
    "amqp://linkresume:secret@127.0.0.1:5676/",
  );
});

test("local profile does not rewrite a remote RabbitMQ URL", () => {
  const paths = fixture();
  writeFileSync(
    join(paths.mainRoot, ".env"),
    "RABBITMQ_PORT=5676\n",
  );
  writeFileSync(
    join(paths.mainRoot, ".env.local"),
    "RABBITMQ_URL=amqp://linkresume:secret@rabbit.example.test:5672/\n",
  );

  const result = buildProfileEnvironment({
    cwd: paths.mainRoot,
    profile: ".env",
    inheritedEnv: {},
    gitCommonDir: join(paths.mainRoot, ".git"),
  });

  assert.equal(
    result.env.RABBITMQ_URL,
    "amqp://linkresume:secret@rabbit.example.test:5672/",
  );
});

test("LINKRESUME_SECRET_ENV_FILE explicitly overrides the shared default", () => {
  const paths = fixture();
  writeFileSync(join(paths.worktree, ".env.development"), "APP_ENV=development\n");
  writeFileSync(join(paths.worktree, "custom.local"), "CUSTOM=yes\n");

  const files = resolveProfileFiles({
    cwd: paths.worktree,
    profile: ".env.development",
    inheritedEnv: { LINKRESUME_SECRET_ENV_FILE: "custom.local" },
    gitCommonDir: paths.gitCommonDir,
  });

  assert.equal(files.secret, join(paths.worktree, "custom.local"));
});

test("Development profile keeps the Agent-aware four-service launcher", () => {
  assert.equal(
    serviceScriptForProfile(".env.development"),
    "dev:development-services",
  );
  assert.equal(serviceScriptForProfile(".env"), "dev:services");
});

test("the profile launcher reuses npm's JavaScript entrypoint", () => {
  const invocation = npmInvocation(
    { npm_execpath: "C:/npm/npm-cli.js" },
    "win32",
  );
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.prefixArgs, ["C:/npm/npm-cli.js"]);
});

test("the profile launcher has platform fallbacks outside npm scripts", () => {
  assert.deepEqual(npmInvocation({ ComSpec: "cmd.exe" }, "win32"), {
    command: "cmd.exe",
    prefixArgs: ["/d", "/s", "/c", "npm"],
  });
  assert.deepEqual(npmInvocation({}, "linux"), {
    command: "npm",
    prefixArgs: [],
  });
});

test("syncMiniprogramLocalConfig writes gitignored local.js with detected LAN IP", () => {
  const root = mkdtempSync(join(tmpdir(), "linkresume-miniprogram-"));
  const configDir = join(root, "apps/miniprogram/config");
  mkdirSync(configDir, { recursive: true });

  const result = syncMiniprogramLocalConfig(root);
  assert.ok(result);
  assert.equal(result.targetFile, join(configDir, "local.js"));
  assert.ok(result.lanIp);
});

test("generated simulator and phone addresses follow the selected launch profile and actual port", () => {
  for (const [profile, env, port] of [
    [".env", {}, 8000],
    [".env", { BACKEND_PORT: "8123" }, 8123],
    [".env.development", { BACKEND_PORT: "9999" }, 18000],
    [".env.development", { LINKRESUME_LOCAL_BACKEND_PORT: "8000", BACKEND_PORT: "9999" }, 8000],
    [".env.development", { LINKRESUME_LOCAL_BACKEND_PORT: "18123" }, 18123],
  ]) {
    const { worktree, mainRoot } = fixture();
    mkdirSync(join(worktree, "apps/miniprogram/config"), { recursive: true });
    const result = syncMiniprogramLocalConfig(worktree, undefined, { profile, env });
    const config = JSON.parse(readFileSync(join(worktree, "apps/miniprogram/config/local.json"), "utf8"));
    assert.equal(config.devtoolsApiBaseUrl, "http://127.0.0.1:" + port);
    assert.equal(config.apiBaseUrl, "http://" + result.lanIp + ":" + port);
    assert.ok(readFileSync(result.targetFile, "utf8").includes(config.devtoolsApiBaseUrl));
    assert.equal(result.devtoolsApiBaseUrl, config.devtoolsApiBaseUrl);
  }
});
