/** Six independently implemented reference-inspired layouts (migration 0071). */
export const studioThemes = [
  "studio-modular-cards",
  "studio-skill-cards",
  "studio-duotone-grid",
  "studio-portrait-feature",
  "studio-layered-capsule",
  "studio-node-timeline",
] as const;

export type StudioTheme = typeof studioThemes[number];
