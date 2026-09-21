/** Original layouts based on approved image references (0073–0076). */
export const originalThemes = [
  "original-vermilion",
  "original-balanced",
  "original-dossier",
  "original-axis",
  "original-warm",
  "original-index",
  "original-offset",
  "original-marginal",
  "original-hanging",
] as const;

export type OriginalTheme = typeof originalThemes[number];
