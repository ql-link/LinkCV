import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildProfileEnvironment,
  resolveProfileFiles,
  serviceScriptForProfile,
  syncMiniprogramLocalConfig,
} from "./run_with_env_profile.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "linkcv-env-"));
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
  assert.equal(result.env.LINKCV_ENV_FILE, join(paths.worktree, ".env.development"));
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

test("LINKCV_SECRET_ENV_FILE explicitly overrides the shared default", () => {
  const paths = fixture();
  writeFileSync(join(paths.worktree, ".env.development"), "APP_ENV=development\n");
  writeFileSync(join(paths.worktree, "custom.local"), "CUSTOM=yes\n");

  const files = resolveProfileFiles({
    cwd: paths.worktree,
    profile: ".env.development",
    inheritedEnv: { LINKCV_SECRET_ENV_FILE: "custom.local" },
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

test("syncMiniprogramLocalConfig writes gitignored local.js with detected LAN IP", () => {
  const root = mkdtempSync(join(tmpdir(), "linkcv-miniprogram-"));
  const configDir = join(root, "apps/miniprogram/config");
  mkdirSync(configDir, { recursive: true });

  const result = syncMiniprogramLocalConfig(root);
  assert.ok(result);
  assert.equal(result.targetFile, join(configDir, "local.js"));
  assert.ok(result.lanIp);
});
