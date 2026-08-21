type WheelZoomInput = Pick<WheelEvent, "ctrlKey" | "metaKey" | "deltaY">;

const A4_WIDTH_CSS_PX = (210 / 25.4) * 96;
const PAGE_GAP_CSS_PX = 24;

export function getTwoPageFitScale(workspaceWidth: number, horizontalPadding: number) {
  const usableWidth = Math.max(0, workspaceWidth - Math.max(0, horizontalPadding));
  const twoPageWidth = A4_WIDTH_CSS_PX * 2 + PAGE_GAP_CSS_PX;
  const scale = Math.min(1, Math.max(0.1, usableWidth / twoPageWidth));
  return Math.floor(scale * 10_000) / 10_000;
}

export function getWheelZoomScale(
  currentScale: number,
  event: WheelZoomInput,
  minScale = 0.5,
  maxScale = 1.6,
) {
  if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return null;

  const direction = event.deltaY < 0 ? 1 : -1;
  const nextScale = Math.min(maxScale, Math.max(minScale, currentScale + direction * 0.08));
  return Number(nextScale.toFixed(2));
}

export function handleWheelZoom(
  currentScale: number,
  event: WheelZoomInput & Pick<WheelEvent, "preventDefault">,
  setScale: (scale: number) => void,
) {
  const nextScale = getWheelZoomScale(currentScale, event);
  if (nextScale === null) return false;

  event.preventDefault();
  setScale(nextScale);
  return true;
}
