import { Children, cloneElement, createContext, createElement, forwardRef, isValidElement, useCallback, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject, type ForwardedRef } from "react";
import { AnimatePresence, useIsPresent, usePresence } from "motion/react";
import "./motion.css";

/** Keep conditional overlays around only for their visual exit, never for interaction. */
export function MotionPresence({ children }: { children: ReactNode }) {
  const hasChildren = Children.toArray(children).length > 0;
  const [cycle, setCycle] = useState({ open: hasChildren, id: 0 });
  if (cycle.open !== hasChildren) setCycle({ open: hasChildren, id: cycle.id + (hasChildren ? 1 : 0) });
  // Empty nested menus must not register an exit that can never complete.
  // A quick reopen gets a fresh form while the inert previous surface finishes exiting.
  return <AnimatePresence propagate={hasChildren}>{Children.map(children, (child, index) => isValidElement(child)
    ? cloneElement(child, { key: `${cycle.id}:${child.key ?? index}` }) : child)}</AnimatePresence>;
}

function milliseconds(value: string) {
  return value.split(",").reduce((max, part) => {
    const amount = Number.parseFloat(part) || 0;
    return Math.max(max, part.trim().endsWith("ms") ? amount : amount * 1000);
  }, 0);
}

export function useExitPresence(ref: RefObject<HTMLElement | null>) {
  const [present, remove] = usePresence();
  useEffect(() => {
    if (present || !remove) return;
    const node = ref.current;
    const style = node ? getComputedStyle(node) : null;
    const duration = style ? milliseconds(style.animationDuration) + milliseconds(style.animationDelay) : 0;
    // CSS may be disabled, reduced, or absent (SSR/tests). Removal must still finish.
    if (!duration) { remove(); return; }
    const timer = window.setTimeout(remove, duration);
    return () => window.clearTimeout(timer);
  }, [present, ref, remove]);
  return present;
}

export const DialogMotionState = createContext(true);

export function useDialogPresence(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const present = useIsPresent();
  const [uncontrolled, setUncontrolled] = useState(props.defaultOpen ?? false);
  return {
    open: present && (props.open ?? uncontrolled),
    onOpenChange: (open: boolean) => { setUncontrolled(open); props.onOpenChange?.(open); },
  };
}

export function usePresenceRef<T extends HTMLElement>(forwarded: ForwardedRef<T>) {
  const ref = useRef<T>(null);
  const present = useExitPresence(ref);
  const open = useContext(DialogMotionState);
  const merged = useCallback((node: T | null) => {
    ref.current = node;
    if (typeof forwarded === "function") forwarded(node);
    else if (forwarded) forwarded.current = node;
  }, [forwarded]);
  return { ref: merged, inert: !present || !open || undefined, "aria-hidden": !present || !open || undefined };
}

/** Preserve the existing DOM/layout of legacy overlays while sharing their lifecycle. */
export const MotionSurface = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "aside";
  variant: "overlay" | "dialog" | "popover" | "drawer";
}>(({ as = "div", variant, className = "", ...props }, ref) => {
  const presence = usePresenceRef(ref);
  const present = useIsPresent();
  return createElement(as, { ...props, ...presence, className: `${className} ui-motion-${variant}`, "data-state": present ? "open" : "closed" });
});
MotionSurface.displayName = "MotionSurface";

/** Animate the existing surface: switching tabs must not remount forms or reset scroll. */
export function useContentMotion<T extends HTMLElement>(identity: string, { initial = true, from = "0 0", selector }: { initial?: boolean; from?: string; selector?: string } = {}) {
  const animation = useRef<Animation | null>(null);
  const previousIdentity = useRef(identity);
  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (preference?.matches) animation.current?.cancel(); };
    preference?.addEventListener("change", reduce);
    return () => { preference?.removeEventListener("change", reduce); animation.current?.cancel(); };
  }, []);
  return useCallback((node: T | null) => {
    animation.current?.cancel();
    animation.current = null;
    if (!node) return;
    const previous = previousIdentity.current;
    const changed = previous !== identity;
    previousIdentity.current = identity;
    if (!initial && !changed) return;
    // 从「还没有内容」（空标识）变成有内容，是加载完成而不是切换：交给骨架交接处理，这里不再淡一次
    if (!initial && previous === "") return;
    const target = selector ? node.querySelector<HTMLElement>(selector) ?? node : node;
    if (!target?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const style = getComputedStyle(target);
    // 页内切换（标签、月/周、筛选结果）：新内容原地淡入，不重新挂载 DOM；只有有方向含义的切换（如日历翻页）才传 from 做横向位移
    // 有方向的切换（左右滑入）从透明开始，配合位移像翻页；原地切换从 0.35 开始，避免整块闪白
    animation.current = target.animate([{ opacity: from === "0 0" ? 0.35 : 0, translate: from }, { opacity: 1, translate: "0 0" }], {
      duration: milliseconds(style.getPropertyValue("--ui-duration-slow")) || 360,
      easing: style.getPropertyValue("--ui-ease-standard").trim() || "cubic-bezier(0.32, 0.72, 0, 1)",
    });
    // Identity deliberately changes the callback ref without changing the DOM key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, initial, from, selector]);
}
