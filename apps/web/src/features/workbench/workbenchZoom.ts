type WheelZoomInput = Pick<WheelEvent, "ctrlKey" | "metaKey" | "deltaY">;

export function getWheelZoomScale(currentScale: number, event: WheelZoomInput) {
  if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return null;

  const direction = event.deltaY < 0 ? 1 : -1;
  const nextScale = Math.min(1.6, Math.max(0.5, currentScale + direction * 0.08));
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
