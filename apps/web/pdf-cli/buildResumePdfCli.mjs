import { build, context } from "esbuild";

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
};

if (process.argv.includes("--watch")) {
  const buildContext = await context(options);
  await buildContext.watch();
} else {
  await build(options);
}
