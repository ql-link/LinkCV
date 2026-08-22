export type PageArrangement = "vertical" | "horizontal";

export type PageViewportAnchor = {
  pageIndex: number;
  withinPageY: number;
};

export type PageViewportMetrics = {
  arrangement: PageArrangement;
  scale: number;
  pageCount: number;
  clientWidth: number;
  clientHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  paperLeft: number;
  paperTop: number;
};

const A4_WIDTH_CSS_PX = (210 / 25.4) * 96;
const A4_HEIGHT_CSS_PX = (297 / 25.4) * 96;
const PAGE_GAP_CSS_PX = 24;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function capturePageViewportAnchor(
  metrics: PageViewportMetrics,
  preferredPageIndex?: number,
): PageViewportAnchor {
  const scale = Math.max(0.01, metrics.scale);
  const pageWidth = A4_WIDTH_CSS_PX * scale;
  const pageHeight = A4_HEIGHT_CSS_PX * scale;
  const gap = PAGE_GAP_CSS_PX * scale;
  const centerX = metrics.scrollLeft + metrics.clientWidth / 2 - metrics.paperLeft;
  const centerY = metrics.scrollTop + metrics.clientHeight / 2 - metrics.paperTop;
  const primaryPosition = metrics.arrangement === "horizontal" ? centerX : centerY;
  const primaryPageSize = metrics.arrangement === "horizontal" ? pageWidth : pageHeight;
  const pageStride = primaryPageSize + gap;
  const pageBeforeGap = Math.floor(primaryPosition / pageStride);
  const positionInStride = primaryPosition - pageBeforeGap * pageStride;
  const centerFallsInGap = positionInStride > primaryPageSize;
  const preferredNeighbor = preferredPageIndex !== undefined
    && (preferredPageIndex === pageBeforeGap || preferredPageIndex === pageBeforeGap + 1)
    ? preferredPageIndex
    : null;
  const pageIndex = clamp(centerFallsInGap && preferredNeighbor !== null
    ? preferredNeighbor
    : Math.floor((primaryPosition + gap / 2) / pageStride), 0, Math.max(0, metrics.pageCount - 1));
  const pageY = metrics.arrangement === "vertical"
    ? centerY - pageIndex * (pageHeight + gap)
    : centerY;

  return {
    pageIndex,
    withinPageY: clamp(pageY / pageHeight, 0, 1),
  };
}

export function restorePageViewportAnchor(
  metrics: PageViewportMetrics,
  anchor: PageViewportAnchor,
) {
  const scale = Math.max(0.01, metrics.scale);
  const pageWidth = A4_WIDTH_CSS_PX * scale;
  const pageHeight = A4_HEIGHT_CSS_PX * scale;
  const gap = PAGE_GAP_CSS_PX * scale;
  const pageIndex = clamp(anchor.pageIndex, 0, Math.max(0, metrics.pageCount - 1));
  const targetTop = metrics.paperTop
    + (metrics.arrangement === "vertical" ? pageIndex * (pageHeight + gap) : 0)
    + clamp(anchor.withinPageY, 0, 1) * pageHeight
    - metrics.clientHeight / 2;
  const targetLeft = metrics.arrangement === "horizontal"
    ? metrics.paperLeft + pageIndex * (pageWidth + gap) + pageWidth / 2 - metrics.clientWidth / 2
    : 0;

  return {
    left: clamp(targetLeft, 0, Math.max(0, metrics.scrollWidth - metrics.clientWidth)),
    top: clamp(targetTop, 0, Math.max(0, metrics.scrollHeight - metrics.clientHeight)),
  };
}
