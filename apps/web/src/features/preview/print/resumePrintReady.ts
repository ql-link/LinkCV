export const A4_WIDTH_MM = 210;
export const A4_MIN_HEIGHT_MM = 297;
export const DEFAULT_MAX_SMART_HEIGHT_MM = 2000;
export const CSS_PX_TO_MM = 25.4 / 96;

function cssLengthMm(computed: CSSStyleDeclaration, property: string, fallbackProperty: string) {
  const raw = computed.getPropertyValue(property).trim();
  if (raw) {
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value)) return value;
  }
  const fallback = Number.parseFloat(computed.getPropertyValue(fallbackProperty));
  return Number.isFinite(fallback) ? fallback : 0;
}

export function smartPageHeightMm(
  contentHeightPx: number,
  marginTopMm = 0,
  marginBottomMm = 0,
  maxHeightMm = DEFAULT_MAX_SMART_HEIGHT_MM,
) {
  if (!Number.isFinite(contentHeightPx) || contentHeightPx < 0) {
    throw new Error("PDF_RENDER_LAYOUT_MEASUREMENT_FAILED");
  }
  const contentHeightMm = contentHeightPx * CSS_PX_TO_MM + marginTopMm + marginBottomMm;
  const height = Math.max(A4_MIN_HEIGHT_MM, Math.ceil(contentHeightMm * 100) / 100);
  if (height > maxHeightMm) throw new Error("PDF_RENDER_PAGE_TOO_TALL");
  return height;
}

export function ensurePrintImagesReady(root: ParentNode = document) {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  return Promise.all(images.map((image) => {
    if (image.complete) {
      return image.naturalWidth > 0
        ? Promise.resolve()
        : Promise.reject(new Error("PDF_RENDER_IMAGE_UNAVAILABLE"));
    }
    return new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("PDF_RENDER_IMAGE_UNAVAILABLE")), { once: true });
    });
  }));
}

export async function waitForResumePrintReady(
  root: HTMLElement,
  maxSmartHeightMm = DEFAULT_MAX_SMART_HEIGHT_MM,
) {
  root.dataset.renderState = "pending";
  if (typeof document !== "undefined" && "fonts" in document) {
    await document.fonts.ready;
  }
  await ensurePrintImagesReady(root);
  const content = root.querySelector<HTMLElement>(".resume-print-content");
  if (!content) throw new Error("PDF_RENDER_LAYOUT_MEASUREMENT_FAILED");
  const computed = getComputedStyle(root);
  const marginTop = cssLengthMm(computed, "--resume-page-margin-top", "--resume-page-margin-y");
  const marginBottom = cssLengthMm(computed, "--resume-page-margin-bottom", "--resume-page-margin-y");
  const heightMm = root.classList.contains("smart-one-page")
    ? smartPageHeightMm(content.getBoundingClientRect().height, marginTop, marginBottom, maxSmartHeightMm)
    : A4_MIN_HEIGHT_MM;
  root.dataset.renderState = "ready";
  root.dataset.renderHeightMm = String(heightMm);
  return { heightMm, contentHeightPx: content.getBoundingClientRect().height };
}
