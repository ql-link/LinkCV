/** MIT-licensed layout adaptations. See public/third-party/template-notices.txt. */
export const openThemes = [
  "open-even",
  "open-moderncv",
  "open-caffeine",
  "open-classy",
  "open-actual",
  "open-class",
] as const;

export type OpenTheme = typeof openThemes[number];
