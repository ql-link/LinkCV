import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

function absolutePath(path, cwd) {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export function resolveMainWorktreeRoot(cwd, gitCommonDir) {
  let commonDir = gitCommonDir;
  if (!commonDir) {
    const result = spawnSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8" },
    );
    commonDir = result.status === 0 ? result.stdout?.trim() : undefined;
  }

  if (!commonDir) {
    throw new Error("无法定位 Git 主工作目录，不能解析共享私密配置");
  }
  return dirname(absolutePath(commonDir, cwd));
}

export function resolveProfileFiles({
  cwd,
  profile,
  inheritedEnv = process.env,
  gitCommonDir,
}) {
  const mainRoot = resolveMainWorktreeRoot(cwd, gitCommonDir);
  const worktreeBase = absolutePath(profile, cwd);
  const mainBase = resolve(mainRoot, basename(profile));
  const base = existsSync(worktreeBase) ? worktreeBase : mainBase;
  const configuredSecret = inheritedEnv.LINKCV_SECRET_ENV_FILE;
  const secret = configuredSecret
    ? absolutePath(configuredSecret, cwd)
    : resolve(mainRoot, `${basename(profile)}.local`);

  if (!existsSync(base) && !existsSync(secret)) {
    throw new Error(`基础配置与共享私密覆盖均不存在：${base}、${secret}`);
  }
  return { base, secret, mainRoot };
}

export function buildProfileEnvironment(options) {
  const inheritedEnv = options.inheritedEnv ?? process.env;
  const files = resolveProfileFiles({ ...options, inheritedEnv });
  const baseEnv = existsSync(files.base)
    ? parseEnv(readFileSync(files.base, "utf8"))
    : {};
  const secretEnv = existsSync(files.secret)
    ? parseEnv(readFileSync(files.secret, "utf8"))
    : {};

  return {
    files,
    env: {
      ...baseEnv,
      ...secretEnv,
      ...inheritedEnv,
      LINKCV_ENV_FILE: files.base,
      LINKCV_SECRET_ENV_FILE: files.secret,
    },
  };
}

function run() {
  const profile = process.argv[2];
  if (!profile) {
    console.error("用法：node scripts/dev/run_with_env_profile.mjs <profile>");
    process.exit(2);
  }

  let runtime;
  try {
    runtime = buildProfileEnvironment({ cwd: process.cwd(), profile });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const secretState = existsSync(runtime.files.secret) ? "已加载" : "不存在";
  console.log(`基础配置：${runtime.files.base}`);
  console.log(`共享私密覆盖：${runtime.files.secret}（${secretState}）`);

  const child = spawn("npm", ["run", "dev:services"], {
    cwd: process.cwd(),
    env: runtime.env,
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    console.error(`启动失败：${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run();
}
