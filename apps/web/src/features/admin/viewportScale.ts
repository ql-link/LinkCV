import { useLayoutEffect } from "react";

/*
 * The console is drawn at Figma's "Desktop Window" (1392 × 976 inside the 1440 artboard, whose outer 24px is
 * only presentation margin). Wider screens (14"/16" MacBook, 1080p/1200p displays) would otherwise show the
 * same pixel sizes with empty margins, so the whole console is scaled with CSS `zoom`: the layout width stays
 * at the design's 1392 CSS px and every size grows by the same factor, matching the design's proportions.
 *
 * Proportions follow the user's reference console (LinkRag admin, 1920 × 1078): nav text ≈ 0.75% and the page
 * title ≈ 1.7% of the viewport width; the user then asked for a touch smaller, so width is fitted to 1500px
 * (≈ 7% under width / 1392). Height only tempers it: fitting the
 * design's full 976px height shrank 13" laptops too far (≈ 0.85), so the fit height is 820px — about the
 * design minus one list screen — and longer pages scroll inside the card. Never exceeding width / 1392 keeps
 * the layout at least the design's 1392 CSS px wide; below ADMIN_MIN_SCALE the responsive layout takes over.
 */
export const ADMIN_DESIGN_WIDTH = 1392;
export const ADMIN_FIT_WIDTH = 1500;
export const ADMIN_FIT_HEIGHT = 820;
export const ADMIN_MIN_SCALE = 0.85;
export const ADMIN_MAX_SCALE = 2;

export function adminScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const fit = Math.min(width / ADMIN_FIT_WIDTH, height / ADMIN_FIT_HEIGHT);
  // Rounded down so width / scale never drops below the design width.
  return Math.floor(Math.min(ADMIN_MAX_SCALE, Math.max(ADMIN_MIN_SCALE, fit)) * 1000) / 1000;
}

/**
 * Publishes the scale on <html> so portalled dialogs and menus pick it up too. Inside a zoomed element
 * `vh`/`vw` would be multiplied by the zoom, so the viewport is also published in zoomed px
 * (`--adm-vh` / `--adm-vw` = 1% of the viewport) for rules that must fit the screen.
 */
export function useAdminViewportScale() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const width = root.clientWidth || window.innerWidth;
      const height = window.innerHeight;
      const scale = adminScale(width, height);
      root.style.setProperty("--adm-zoom", String(scale));
      root.style.setProperty("--adm-vw", `${width / scale / 100}px`);
      root.style.setProperty("--adm-vh", `${height / scale / 100}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      for (const name of ["--adm-zoom", "--adm-vw", "--adm-vh"]) root.style.removeProperty(name);
    };
  }, []);
}

/**
 * Ratio between on-screen px (getBoundingClientRect, pointer clientX/Y) and layout px (offsetTop,
 * scrollTop, transforms) inside `element`. Measured rather than read from `--adm-zoom` so it stays right
 * whatever the browser's zoom model is.
 */
export function visualScale(element: HTMLElement | null | undefined): number {
  if (!element || !element.offsetWidth) return 1;
  const ratio = element.getBoundingClientRect().width / element.offsetWidth;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}
