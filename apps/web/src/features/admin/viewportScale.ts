/*
 * The console no longer zooms the page to the viewport: components keep Figma's 1:1 px and the layout
 * absorbs extra width (see "Sizing model" in console.css). `visualScale` stays because the browser's own
 * zoom or a future scaled container can still make on-screen px differ from layout px.
 */

/**
 * Ratio between on-screen px (getBoundingClientRect, pointer clientX/Y) and layout px (offsetTop,
 * scrollTop, transforms) inside `element`. Measured rather than assumed so it stays right whatever the
 * browser's zoom model is.
 */
export function visualScale(element: HTMLElement | null | undefined): number {
  if (!element || !element.offsetWidth) return 1;
  const ratio = element.getBoundingClientRect().width / element.offsetWidth;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}
