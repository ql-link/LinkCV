import { resolve } from "node:path";
import { getSchema } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { parseHTML } from "linkedom";
import sansRegularAsset from "../node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf";
import sansMediumAsset from "../node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Medium.otf";
import serifRegularAsset from "../node_modules/@fontpkg/source-han-serif-sc/SourceHanSerifSC-Regular.otf";
import serifSemiBoldAsset from "../node_modules/@fontpkg/source-han-serif-sc/SourceHanSerifSC-SemiBold.otf";
import wenkaiRegularAsset from "../node_modules/@fontpkg/lxgw-wen-kai/LXGWWenKai-Regular.ttf";
import wenkaiMediumAsset from "../node_modules/@fontpkg/lxgw-wen-kai/LXGWWenKai-Medium.ttf";
import type { ResumeDocumentV1, ResumeStyleV1 } from "../src/api/resumeContract";
import { resumeDocumentToMarkdown, styleToEditorSettings } from "../src/api/resumeContract";
import { createResumePdfBlob, registerResumePdfFonts } from "../src/features/preview/exportTextPdf";
import { resumeEditorExtensions } from "../src/features/workbench/editorExtensions";
import { renderResumeMarkdown } from "../src/parser/resumeMarkdown";

const MAX_INPUT_BYTES = 12 * 1024 * 1024;

type RenderRequest = {
  title: string;
  data: ResumeDocumentV1;
  style: ResumeStyleV1;
  assets?: Record<string, string>;
};

function assetPath(relativePath: string) {
  return resolve(__dirname, relativePath);
}

function isRenderRequest(value: unknown): value is RenderRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.title === "string"
    && item.title.length <= 255
    && !!item.data
    && typeof item.data === "object"
    && !!item.style
    && typeof item.style === "object"
    && (item.assets === undefined || (!!item.assets && typeof item.assets === "object"))
  );
}

async function readRequest() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) throw new Error("PDF_RENDER_INPUT_TOO_LARGE");
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRenderRequest(value)) throw new Error("PDF_RENDER_INPUT_INVALID");
  return value;
}

async function main() {
  const payload = await readRequest();
  registerResumePdfFonts({
    sansRegular: assetPath(sansRegularAsset),
    sansMedium: assetPath(sansMediumAsset),
    serifRegular: assetPath(serifRegularAsset),
    serifSemiBold: assetPath(serifSemiBoldAsset),
    wenkaiRegular: assetPath(wenkaiRegularAsset),
    wenkaiMedium: assetPath(wenkaiMediumAsset),
  });
  const html = renderResumeMarkdown(resumeDocumentToMarkdown(payload.data));
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const content = ProseMirrorDOMParser
    .fromSchema(getSchema(resumeEditorExtensions))
    .parse(document.body)
    .toJSON();
  const settings = {
    ...styleToEditorSettings(payload.style),
    smartOnePage: true,
    showSource: false,
  };
  const assets = payload.assets ?? {};
  const blob = await createResumePdfBlob(
    content,
    settings,
    payload.title || "LinkCV Resume",
    async (source) => {
      if (/^data:image\/(?:png|jpe?g);base64,/i.test(source)) return source;
      const resolved = assets[source];
      if (!resolved || !/^data:image\/(?:png|jpe?g);base64,/i.test(resolved)) {
        throw new Error("PDF_IMAGE_UNAVAILABLE");
      }
      return resolved;
    },
  );
  process.stdout.write(Buffer.from(await blob.arrayBuffer()));
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^PDF_[A-Z_]+$/.test(error.message)
    ? error.message
    : "PDF_RENDER_FAILED";
  if (process.env.PDF_RENDER_DEBUG === "1" && error instanceof Error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
  }
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
