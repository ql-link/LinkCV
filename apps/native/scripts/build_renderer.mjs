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
<html lang="zh-CN" data-drawoffer-native-renderer>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'unsafe-inline'">
<title>DrawOffer Paper</title>
</head>
<body><div id="paper-root"></div><script>${script}</script></body>
</html>
`;

const outFile = resolve(nativeRoot, "renderer/dist/paper.html");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);

const targets = [
  resolve(appsRoot, "mac/Sources/DrawOfferRender/Resources/paper.html"),
  resolve(appsRoot, "windows/src/DrawOffer.App/Assets/Renderer/paper.html"),
];
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(outFile, target);
}
console.log(`paper.html ${(html.length / 1024).toFixed(0)} KiB -> ${targets.length} clients`);

// The native shell uses the exact Web brand asset; regenerate with every paper build.
for (const directory of [
  resolve(appsRoot, 'mac/Sources/DrawOfferApp/Resources/Branding'),
  resolve(appsRoot, 'windows/src/DrawOffer.App/Assets/Branding'),
]) {
  mkdirSync(directory, { recursive: true });
  copyFileSync(resolve(appsRoot, 'web/src/assets/drawoffer-wordmark.png'), resolve(directory, 'wordmark.png'));
}

for (const directory of [resolve(appsRoot, 'mac/Sources/DrawOfferApp/Resources/Home'), resolve(appsRoot, 'windows/src/DrawOffer.App/Assets/Home')]) {
  mkdirSync(directory, { recursive: true });
  for (const filename of ['content.json', 'firstResume.png', 'target.png', 'plugin.png'])
    copyFileSync(resolve(nativeRoot, 'shared/home', filename), resolve(directory, filename));
}
