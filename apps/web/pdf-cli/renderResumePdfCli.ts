import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import sansRegularAsset from "../node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf";
import serifRegularAsset from "../node_modules/@fontpkg/source-han-serif-sc/SourceHanSerifSC-Regular.otf";
import wenkaiRegularAsset from "../node_modules/@fontpkg/lxgw-wen-kai/LXGWWenKai-Regular.ttf";
import {
  resumePresentationPageMargins,
  type LayoutPlan,
  type CanonicalResumeDocument,
  type CanonicalResumePresentation,
} from "../src/api/resumeContract";
import administrativeAvatar from "../public/templates/avatar-administrative.png";
import campusAvatar from "../public/templates/avatar-campus.png";
import templateAvatar from "../public/templates/avatar-cat.jpg";
import civicAvatar from "../public/templates/avatar-civic.png";
import creativeAvatar from "../public/templates/avatar-creative.png";
import applicationStyles from "../src/app.css?raw";
import baseStyles from "../src/styles.css?raw";
import printStyles from "../src/features/preview/print/resume-print.css?raw";
import {
  renderResumePrintDocument,
  RESUME_RENDER_PROTOCOL_VERSION,
} from "../src/features/preview/print/resumePrintDocument";
import {
  A4_MIN_HEIGHT_MM,
  A4_WIDTH_MM,
  DEFAULT_MAX_SMART_HEIGHT_MM,
  smartPageHeightMm,
} from "../src/features/preview/print/resumePrintReady";

const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 15 * 1024 * 1024;
const TEMPLATE_PDF_ASSETS: Record<string, string> = {
  "/templates/avatar-administrative.png": administrativeAvatar,
  // Resumes created before template revision 0027 retain SVG source paths.
  // The print document accepts bounded raster data URLs, so keep those paths
  // renderable through their reviewed PNG counterparts.
  "/templates/avatar-administrative.svg": administrativeAvatar,
  "/templates/avatar-campus.png": campusAvatar,
  "/templates/avatar-campus.svg": campusAvatar,
  "/templates/avatar-cat.jpg": templateAvatar,
  "/templates/avatar-civic.png": civicAvatar,
  "/templates/avatar-civic.svg": civicAvatar,
  "/templates/avatar-creative.png": creativeAvatar,
  "/templates/avatar-creative.svg": creativeAvatar,
};
const FONT_ORIGIN = "https://linkcv-render.local";
const FONT_ASSETS = new Map([
  [fontUrl(serifRegularAsset), serifRegularAsset],
  [fontUrl(wenkaiRegularAsset), wenkaiRegularAsset],
  [fontUrl(sansRegularAsset), sansRegularAsset],
]);
const EMBEDDED_FONT_STYLES = `
@font-face{font-family:"Source Han Serif SC";src:url(${fontUrl(serifRegularAsset)}) format("opentype");font-weight:400;font-style:normal}
@font-face{font-family:"LXGW WenKai";src:url(${fontUrl(wenkaiRegularAsset)}) format("truetype");font-weight:400;font-style:normal}
@font-face{font-family:"LinkCV Noto Sans SC";src:url(${fontUrl(sansRegularAsset)}) format("opentype");font-weight:400;font-style:normal}
`;

function fontUrl(asset: string) {
  return `${FONT_ORIGIN}/${asset.replace(/^\.\//u, "")}`;
}

type RenderRequest = {
  protocol_version?: typeof RESUME_RENDER_PROTOCOL_VERSION;
  title: string;
  data: CanonicalResumeDocument;
  style: CanonicalResumePresentation;
  layout_plan?: LayoutPlan | null;
  assets?: Record<string, string>;
};

function isRenderRequest(value: unknown): value is RenderRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.protocol_version === undefined || item.protocol_version === RESUME_RENDER_PROTOCOL_VERSION
    ? typeof item.title === "string"
      && item.title.length <= 255
      && !!item.data
      && typeof item.data === "object"
      && (item.data as Record<string, unknown>).schema_version === "canonical-resume.v1"
      && !!item.style
      && typeof item.style === "object"
      && (item.style as Record<string, unknown>).schema_version === "resume-presentation.v1"
      && (item.assets === undefined || (!!item.assets && typeof item.assets === "object"))
    : false;
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
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("PDF_RENDER_INPUT_INVALID");
  }
  if (!isRenderRequest(value)) throw new Error("PDF_RENDER_INPUT_INVALID");
  return value;
}

function chromiumExecutablePath() {
  const configured = process.env.CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  if (process.env.APP_ENV === "production") throw new Error("PDF_RENDER_CHROMIUM_UNAVAILABLE");

  // Local development may run outside the production container. These paths
  // are development fallbacks only; packaged deployments must use the fixed
  // CHROMIUM_EXECUTABLE_PATH supplied by the application image.
  let playwrightPath = "";
  try {
    playwrightPath = chromium.executablePath();
  } catch {
    playwrightPath = "";
  }
  const candidates = [
    playwrightPath,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const fallback = candidates.find((candidate) => candidate && existsSync(candidate));
  if (fallback) return fallback;
  throw new Error("PDF_RENDER_CHROMIUM_UNAVAILABLE");
}

function maxSmartHeightMm() {
  const configured = Number(process.env.PDF_RENDERER_MAX_SMART_HEIGHT_MM ?? DEFAULT_MAX_SMART_HEIGHT_MM);
  return Number.isFinite(configured) && configured >= A4_MIN_HEIGHT_MM
    ? Math.min(configured, DEFAULT_MAX_SMART_HEIGHT_MM)
    : DEFAULT_MAX_SMART_HEIGHT_MM;
}

function printMargins(style: CanonicalResumePresentation) {
  const resolved = resumePresentationPageMargins(style);
  // Keep the established PDF pagination contract: a zero template inset means
  // that the theme owns its inner full-bleed decoration, while Chromium still
  // receives the reviewed default page gutter.  The independent edge values
  // remain available to the browser/editor renderer and are preserved in the
  // canonical snapshot; changing this PDF fallback would move all three
  // full-bleed official templates relative to their approved baselines.
  const x = resolved.left || 20;
  const y = resolved.top || 16;
  const columns = style.template_snapshot.regions.some((region) => region.region_kind === "sidebar");
  // Column layouts and flow layouts with a zero top margin own the complete
  // A4 canvas (for example a full-bleed header). Their inner spacing is
  // already expressed by the resume CSS variables, so Chromium must not add
  // a second @page margin around the template.
  return columns
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : { top: y, right: x, bottom: y, left: x };
}

function pageMarginStyles(style: CanonicalResumePresentation) {
  const margins = printMargins(style);
  const printableWidth = A4_WIDTH_MM - margins.left - margins.right;
  return [
    `@page{size:A4;margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm}`,
    `html[data-resume-pdf-cli],html[data-resume-pdf-cli] body{width:${printableWidth}mm!important}`,
  ].join("");
}

function withPrintStyles(html: string, style: CanonicalResumePresentation) {
  return html.replace(
    '<style data-resume-print-styles>/* injected by the renderer */</style>',
    `<style data-resume-print-styles>${baseStyles}\n${applicationStyles}\n${printStyles}\n${EMBEDDED_FONT_STYLES}\n${pageMarginStyles(style)}</style>`,
  );
}

async function main() {
  const payload = await readRequest();
  const assets = { ...TEMPLATE_PDF_ASSETS, ...(payload.assets ?? {}) };
  const html = withPrintStyles(
    renderResumePrintDocument({ ...payload, assets }, { includeStyles: true }),
    payload.style,
  );
  const margins = printMargins(payload.style);
  const executablePath = chromiumExecutablePath();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-gpu", "--font-render-hinting=none"],
  });

  try {
    // Keep the layout viewport below the smallest supported printable A4 area.
    // Chromium otherwise treats an A4-high viewport as document content and
    // can fragment its invisible remainder onto a blank second page once
    // @page margins are applied. Actual resume content still expands the body.
    const page = await browser.newPage({ viewport: { width: 794, height: 600 }, deviceScaleFactor: 1 });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      const fontAsset = FONT_ASSETS.get(url);
      if (fontAsset) {
        await route.fulfill({
          status: 200,
          contentType: fontAsset.endsWith(".ttf") ? "font/ttf" : "font/otf",
          body: readFileSync(resolve(__dirname, fontAsset)),
        });
      } else if (url.startsWith("data:") || url.startsWith("about:") || url.startsWith("blob:")) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    await page.setContent(`<!doctype html><html data-resume-pdf-cli><head><meta charset="utf-8"></head><body>${html}</body></html>`, {
      waitUntil: "load",
    });
    // Measure under the same print media rules that Chromium will use for PDF
    // output; screen and print fragmentation can otherwise produce different
    // block heights for the same snapshot.
    await page.emulateMedia({ media: "print" });
    const measurement = await page.evaluate(async () => {
      const root = document.querySelector<HTMLElement>("[data-resume-print-document]");
      if (!root) throw new Error("PDF_RENDER_LAYOUT_MEASUREMENT_FAILED");
      if (document.fonts) await document.fonts.ready;
      const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
      await Promise.all(images.map((image) => {
        if (image.complete) {
          if (image.naturalWidth <= 0) throw new Error("PDF_RENDER_IMAGE_UNAVAILABLE");
          return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error("PDF_RENDER_IMAGE_UNAVAILABLE")), { once: true });
        });
      }));
      const content = root.querySelector<HTMLElement>(".resume-print-content");
      if (!content) throw new Error("PDF_RENDER_LAYOUT_MEASUREMENT_FAILED");
      const computed = getComputedStyle(root);
      const configuredMarginTop = Number.parseFloat(computed.getPropertyValue("--resume-page-margin-top")) || 0;
      const configuredMarginBottom = Number.parseFloat(computed.getPropertyValue("--resume-page-margin-bottom")) || 0;
      const marginTop = root.classList.contains("theme-administrative-sidebar") ? 0 : configuredMarginTop;
      const marginBottom = root.classList.contains("theme-administrative-sidebar") ? 0 : configuredMarginBottom;
      const smart = root.classList.contains("smart-one-page");
      root.dataset.renderState = "ready";
      return { contentHeightPx: content.getBoundingClientRect().height, marginTop, marginBottom, smart };
    });

    const heightMm = measurement.smart
      ? smartPageHeightMm(measurement.contentHeightPx, measurement.marginTop, measurement.marginBottom, maxSmartHeightMm())
      : A4_MIN_HEIGHT_MM;
    if (!measurement.smart) {
      // The browser preview keeps a paper clipped to one A4 sheet. The print
      // document must instead let Chromium fragment the same content over A4
      // pages, otherwise content below the first sheet would be clipped.
      await page.locator("[data-resume-print-document]").evaluate((element) => {
        const paper = element as HTMLElement;
        paper.style.height = "auto";
        paper.style.minHeight = "0";
        paper.style.overflow = "visible";
        paper.style.breakAfter = "auto";
        paper.style.pageBreakAfter = "auto";
      });
    } else {
      // The shared stylesheet defaults to A4 for the screen/regular print
      // path. Override the fragmentainer as well as the PDF option so a smart
      // page remains one physical page instead of being split at 297mm.
      await page.locator("html, body").evaluateAll((elements) => {
        for (const element of elements) {
          (element as HTMLElement).style.overflow = "hidden";
        }
      });
      await page.addStyleTag({
        content: `@page { size: 210mm ${heightMm}mm !important; margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm !important; }`,
      });
    }
    const pdf = await page.pdf(measurement.smart
      ? {
        printBackground: true,
        preferCSSPageSize: true,
      }
      : {
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });
    if (!pdf.length || pdf.length > MAX_OUTPUT_BYTES || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("PDF_RENDER_OUTPUT_INVALID");
    }
    process.stdout.write(pdf);
  } finally {
    await browser.close();
  }
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
