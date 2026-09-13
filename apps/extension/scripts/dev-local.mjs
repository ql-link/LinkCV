import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "wxt";

const { values } = parseArgs({
  options: {
    origin: { type: "string", default: "http://127.0.0.1:5173" },
    port: { type: "string", default: "3000" },
    "output-dir": { type: "string" },
  },
});
const origin = new URL(values.origin);
if (
  origin.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
  origin.pathname !== "/" || origin.search || origin.hash ||
  origin.username || origin.password
) {
  throw new Error("--origin 必须是本机 Web 的 HTTP 根地址，例如 http://127.0.0.1:5175");
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("--port 必须是 1–65535 的 WXT 监视服务端口");
}

// Bind both the API client and manifest to the same local Web instance.
process.env.WXT_RELEASE_BUILD = "1";
process.env.WXT_PUBLIC_LINKRESUME_CHANNEL = "development";
process.env.WXT_PUBLIC_LINKRESUME_ORIGIN = origin.origin;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = values["output-dir"]
  ? resolve(values["output-dir"])
  : resolve(root, ".output/development");
console.log(`开发版连接：${origin.origin}`);
console.log(`首次加载目录：${resolve(outDir, "chrome-mv3")}`);
const server = await createServer({
  root,
  browser: "chrome",
  manifestVersion: 3,
  outDir,
  outDirTemplate: "chrome-mv3",
  webExt: { disabled: true },
  dev: { server: { host: "127.0.0.1", port } },
});
await server.start();
