type WheelZoomInput = Pick<WheelEvent, "ctrlKey" | "metaKey" | "deltaY">;

type WheelZoomOptions = {
  minScale?: number;
  maxScale?: number;
  step?: number;
};

export function getWheelZoomScale(
  currentScale: number,
  event: WheelZoomInput,
  { minScale = 0.5, maxScale = 1.6, step = 0.08 }: WheelZoomOptions = {},
) {
  if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return null;

  const direction = event.deltaY < 0 ? 1 : -1;
  const nextScale = Math.min(maxScale, Math.max(minScale, currentScale + direction * step));
  return Number(nextScale.toFixed(2));
}

export function handleWheelZoom(
  currentScale: number,
  event: WheelZoomInput & Pick<WheelEvent, "preventDefault">,
  setScale: (scale: number) => void,
  options?: WheelZoomOptions,
) {
  const nextScale = getWheelZoomScale(currentScale, event, options);
  if (nextScale === null) return false;

  event.preventDefault();
  setScale(nextScale);
  return true;
}
