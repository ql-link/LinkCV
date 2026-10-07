/** Shared geometry for editor node views, clipboard HTML and read-only output. */
export function resumeInlineImageDimensions(attrs: Record<string, unknown> = {}) {
  const width = Math.min(240, Math.max(16, Number(attrs.width) || 72));
  const aspectRatio = Math.min(20, Math.max(0.1, Number(attrs.aspectRatio) || 3));
  const height = Math.min(240, Math.max(16, Number(attrs.height) || width / aspectRatio));
  return { width, height };
}
