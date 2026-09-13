import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import config from "../dist/config.cjs";

const require = createRequire(import.meta.url);
const scriptRoot = dirname(fileURLToPath(import.meta.url));

const devUrl = process.env.LINKCV_DESKTOP_DEV_URL ?? config.DEFAULT_DEV_URL;

function validateDevUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // 落入下方统一报错。
  }
  console.error(`[linkcv-desktop] LINKCV_DESKTOP_DEV_URL 非法：${value}`);
  process.exit(1);
}

const target = validateDevUrl(devUrl);
const timeoutMs = 120_000;
const intervalMs = 500;
const startedAt = Date.now();

async function reachable(url) {
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    // 开发服务器任何 HTTP 响应（包括 404/500）都代表端口已就绪。
    return response.status > 0;
  } catch {
    return false;
  }
}

async function waitForDevServer() {
  process.stdout.write(`[linkcv-desktop] 等待开发服务器就绪：${target}\n`);
  while (Date.now() - startedAt < timeoutMs) {
    if (await reachable(target)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  console.error(
    "[linkcv-desktop] 等待超时。请先启动开发服务（npm run dev:local 或 npm run dev:development），再运行 npm run dev:desktop。",
  );
  process.exit(1);
}

function electronBinary() {
  const local = join(scriptRoot, "..", "node_modules", ".bin", "electron");
  try {
    require.resolve("electron/package.json");
    return local;
  } catch {
    return null;
  }
}

await waitForDevServer();

const binary = electronBinary();
if (!binary) {
  console.error("[linkcv-desktop] 未找到 electron，请先在 apps/desktop 执行 npm install。");
  process.exit(1);
}

const child = spawn(binary, ["."], {
  cwd: join(scriptRoot, ".."),
  env: { ...process.env, LINKCV_DESKTOP_MODE: "dev", LINKCV_DESKTOP_DEV_URL: target },
  stdio: "inherit",
});
child.on("exit", (code) => {
  process.exit(code ?? 0);
});
