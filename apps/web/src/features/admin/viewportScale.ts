import { useLayoutEffect } from "react";

/*
 * The console is drawn at Figma's 1440px desktop frame. Wider or taller screens (16" MacBook, 1080p/1200p
 * displays) would otherwise show the same pixel sizes with empty margins, so the whole console is scaled
 * with CSS `zoom` instead: the layout stays at ~1440 CSS px while everything grows proportionally.
 */
export const ADMIN_BASE_WIDTH = 1440;
export const ADMIN_BASE_HEIGHT = 800;
export const ADMIN_MAX_SCALE = 1.6;

/** Never shrinks below the design size; the height bound keeps short, wide windows from overflowing. */
export function adminScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const fit = Math.min(width / ADMIN_BASE_WIDTH, height / ADMIN_BASE_HEIGHT);
  return Math.round(Math.min(ADMIN_MAX_SCALE, Math.max(1, fit)) * 1000) / 1000;
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
