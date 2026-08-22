import type { JSONContent } from "@tiptap/core";

export const INLINE_FONT_SIZE_MIN = 6;
export const INLINE_FONT_SIZE_MAX = 48;
export const INLINE_FONT_SIZE_STEP = 0.5;
export const INLINE_FONT_SIZE_CLOSE_MARKER = "[[/linkcv-size]]";

export function normalizeInlineFontSize(value: unknown) {
  const points = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(points) || points < INLINE_FONT_SIZE_MIN || points > INLINE_FONT_SIZE_MAX) return null;
  return Number(points.toFixed(1));
}

export function inlineFontSizeFromNode(node: JSONContent) {
  const value = node.marks?.find((mark) => mark.type === "textStyle")?.attrs?.fontSize;
  return normalizeInlineFontSize(value) ?? undefined;
}

export function inlineFontSizeOpenMarker(points: number) {
  return `[[linkcv-size:${normalizeInlineFontSize(points) ?? INLINE_FONT_SIZE_MIN}pt]]`;
}
