import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const pdfCliDirectory = fileURLToPath(new URL(".", import.meta.url));
const mediumFontPath = resolve(
  pdfCliDirectory,
  "../node_modules/@fontpkg/lxgw-wen-kai/LXGWWenKai-Medium.ttf",
);

const useWenkaiMedium = {
  name: "use-wenkai-medium",
  setup(esbuild) {
    esbuild.onResolve({ filter: /LXGWWenKai-Regular\.ttf$/ }, (args) => {
      if (!args.path.includes("@fontpkg/lxgw-wen-kai")) {
        return null;
      }

      return { path: mediumFontPath };
    });
  },
};

const options = {
  entryPoints: ["pdf-cli/renderResumePdfCli.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "dist-server/render-resume-pdf.cjs",
  external: ["playwright-core"],
  loader: {
    ".css": "text",
    ".otf": "file",
    ".ttf": "file",
    ".jpg": "dataurl",
    ".png": "dataurl",
  },
  assetNames: "fonts/[name]-[hash]",
  plugins: [useWenkaiMedium],
};

if (process.argv.includes("--watch")) {
  const buildContext = await context(options);
  await buildContext.watch();
} else {
  await build(options);
}
