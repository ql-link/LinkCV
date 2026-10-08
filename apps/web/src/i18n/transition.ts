import { flushSync } from "react-dom";
import { getLocale, setLocale, type Locale } from "./index";
import "./transition.css";

let generation = 0;
let cancelMotion: (() => void) | undefined;

function commitLocale(next: Locale) {
  const positions = typeof document === "undefined" ? [] : Array.from(
    document.querySelectorAll<HTMLElement>("[data-locale-scroll]"),
    (node) => ({ node, top: node.scrollTop, left: node.scrollLeft }),
  );
  flushSync(() => setLocale(next));
  for (const { node, top, left } of positions) { node.scrollTop = top; node.scrollLeft = left; }
}

/** Explicit changes fade only marked UI copy. Preference hydration stays immediate. */
export async function setLocaleWithTransition(next: Locale): Promise<void> {
  const current = ++generation;
  cancelMotion?.();
  cancelMotion = undefined;
  if (next === getLocale()) return;
  if (typeof document === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    commitLocale(next);
    return;
  }

  const root = document.documentElement;
  const style = getComputedStyle(root);
  const fadeOut = Number.parseFloat(style.getPropertyValue("--locale-fade-out")) || 80;
  const fadeIn = Number.parseFloat(style.getPropertyValue("--locale-fade-in")) || 140;
  root.dataset.localeStage = "out";
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, fadeOut);
    cancelMotion = () => {
      window.clearTimeout(timer);
      delete root.dataset.localeStage;
      resolve();
    };
  });
  if (current !== generation) return;

  // Replace copy while it is invisible, keeping the existing forms and scroll containers.
  commitLocale(next);
  root.dataset.localeStage = "in";
  const cleanup = () => {
    delete root.dataset.localeStage;
    if (current === generation) cancelMotion = undefined;
  };
  const timer = window.setTimeout(cleanup, fadeIn);
  cancelMotion = () => { window.clearTimeout(timer); cleanup(); };
}
