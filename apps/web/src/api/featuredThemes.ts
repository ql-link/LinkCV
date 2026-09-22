/** Independent implementations of the selected blue-layout references. */
export const featuredThemes = [
  "featured-campus",
  "featured-professional",
  "featured-intern",
  "featured-sales",
  "featured-product",
  "featured-finance",
  "featured-people",
  "featured-card-dashed",
  "featured-card-rail",
  "featured-classic-business",
  "featured-vitality",
] as const;

export type FeaturedTheme = typeof featuredThemes[number];
