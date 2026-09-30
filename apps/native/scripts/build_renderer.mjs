// 把 renderer/entry.ts 打成一个自包含的离线 HTML，再分别复制进 Mac 与 Windows 客户端的资源目录。
// 复用 apps/web 已安装的 esbuild，不引入新依赖：node apps/native/scripts/build_renderer.mjs
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appsRoot = resolve(nativeRoot, "..");
const require = createRequire(resolve(appsRoot, "web/package.json"));
const { build } = require("esbuild");

const result = await build({
  entryPoints: [resolve(nativeRoot, "renderer/entry.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: ["safari17", "chrome120"],
  minify: true,
  // Web 源码里的 `?raw` 样式按文本读入，头像按 data URL 内联，保证纸面零网络请求
  plugins: [{
    name: "raw-query",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /\?raw$/ }, (args) => ({
        path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
        namespace: "raw",
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
        contents: await readFile(args.path, "utf8"),
        loader: "text",
      }));
    },
  }],
  loader: { ".png": "dataurl", ".jpg": "dataurl" },
  logLevel: "warning",
});

const script = result.outputFiles[0].text.replace(/<\/script/giu, "<\\/script");
const html = `<!doctype html>
<html lang="zh-CN" data-linkresume-native-renderer>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'unsafe-inline'">
<title>LinkResume Paper</title>
</head>
<body><div id="paper-root"></div><script>${script}</script></body>
</html>
`;

const outFile = resolve(nativeRoot, "renderer/dist/paper.html");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);

const targets = [
  resolve(appsRoot, "mac/Sources/LinkResumeRender/Resources/paper.html"),
  resolve(appsRoot, "windows/src/LinkResume.App/Assets/Renderer/paper.html"),
];
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(outFile, target);
}
console.log(`paper.html ${(html.length / 1024).toFixed(0)} KiB -> ${targets.length} clients`);
