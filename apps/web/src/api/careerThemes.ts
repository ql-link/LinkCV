/** MIT layout adaptations; see public/third-party/template-notices.txt. */
export const careerThemes = [
  "career-kendall",
  "career-stack",
  "career-spartan",
  "career-onepage",
  "career-classic",
] as const;

export type CareerTheme = typeof careerThemes[number];
