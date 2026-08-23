import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../dist/config.cjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptRoot, "..");

const requested = process.env.LINKCV_DESKTOP_ENV;
if (requested !== undefined && requested !== "development" && requested !== "production") {
  console.error(`[linkcv-desktop] LINKCV_DESKTOP_ENV 仅支持 development/production：${requested}`);
  process.exit(1);
}
const preset = requested === "development" ? "development" : "production";

let origin = process.env.LINKCV_DESKTOP_ORIGIN?.trim();
if (preset === "development" && !origin) {
  origin = config.DEFAULT_DEVELOPMENT_ORIGIN;
}

if (origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    console.error(`[linkcv-desktop] LINKCV_DESKTOP_ORIGIN 不是合法 URL：${origin}`);
    process.exit(1);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    console.error(`[linkcv-desktop] LINKCV_DESKTOP_ORIGIN 必须使用 http(s) 协议：${origin}`);
    process.exit(1);
  }
  if (
    preset === "production" &&
    parsed.protocol === "http:" &&
    !config.isLoopbackHostname(parsed.hostname)
  ) {
    console.error(
      "[linkcv-desktop] production 包不允许非回环 http 源；连内网 Dev 请使用 LINKCV_DESKTOP_ENV=development。",
    );
    process.exit(1);
  }
  origin = parsed.origin;
}

const payload = { env: preset, ...(origin ? { origin } : {}) };
mkdirSync(join(appRoot, "dist"), { recursive: true });
writeFileSync(join(appRoot, "dist", "built-in-env.json"), `${JSON.stringify(payload, null, 2)}\n`);
console.log(`[linkcv-desktop] 构建目标环境：${preset}${origin ? `，源：${origin}` : "（默认生产源）"}`);
