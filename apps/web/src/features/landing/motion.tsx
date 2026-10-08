import { createContext, useContext, useEffect, useState, type CSSProperties, type RefObject } from "react";

/** static：直接显示结束帧；armed：停在开场帧等待进入视口；playing：播放一次。 */
export type ScenePlayback = "static" | "armed" | "playing";
export const SceneMotion = createContext<ScenePlayback>("static");

export function prefersStaticMotion() {
  if (typeof IntersectionObserver === "undefined") return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  return (navigator.hardwareConcurrency ?? 8) <= 2;
}

/** 卡片进入视口 40% 时播放一次；完全离开后回到开场帧，再次进入从头播放。 */
export function useScenePlayback(target: RefObject<HTMLElement | null>) {
  const [playback, setPlayback] = useState<{ state: ScenePlayback; cycle: number }>({ state: "static", cycle: 0 });
  useEffect(() => {
    const element = target.current;
    if (!element || prefersStaticMotion()) return;
    setPlayback({ state: "armed", cycle: 0 });
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio >= 0.4) setPlayback(value => value.state === "playing" ? value : { state: "playing", cycle: value.cycle });
      else if (!entry.isIntersecting) setPlayback(value => value.state === "armed" ? value : { state: "armed", cycle: value.cycle + 1 });
    }, { threshold: [0, 0.4] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return playback;
}

/** 数字从 0 滚动到目标值；结束帧和降级时直接显示目标值。 */
export function CountUp({ to, decimals = 0, delay = 0, duration = 1, format }: { to: number; decimals?: number; delay?: number; duration?: number; format?: (value: number) => string }) {
  const state = useContext(SceneMotion);
  const [value, setValue] = useState(state === "static" ? to : 0);
  useEffect(() => {
    if (state !== "playing") { setValue(state === "static" ? to : 0); return; }
    let frame = 0;
    const start = performance.now() + delay * 1000;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / (duration * 1000)));
      setValue(to * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state, to, delay, duration]);
  return <>{format ? format(value) : value.toFixed(decimals)}</>;
}

/** 逐字输出：每个字按顺序出现，总时长约为 duration 秒。 */
export function Typed({ text, start, duration }: { text: string; start: number; duration: number }) {
  const chars = Array.from(text);
  const step = duration / chars.length;
  return <>{chars.map((char, index) => <span key={index} className="fx-char" style={{ "--d": `${start + index * step}s` } as CSSProperties}>{char}</span>)}</>;
}

/** 演示点击与拖拽的假鼠标指针，只在播放状态出现。 */
export function FakePointer({ className }: { className: string }) {
  return <svg className={`fs-pointer ${className}`} width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden="true"><path d="M3 2.5v15.2l4-3.7 2.6 5.8 2.8-1.2-2.6-5.7h5.6L3 2.5Z" fill="#1d1d1b" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

export const at = (seconds: number) => ({ "--d": `${seconds}s` }) as CSSProperties;

/** 可以播放动效时，为 [data-reveal] 元素做一次滚动入场；返回是否已启用。 */
export function useScrollReveal(root: RefObject<HTMLElement | null>) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element || prefersStaticMotion()) return;
    setEnabled(true);
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    element.querySelectorAll("[data-reveal]").forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [root]);
  return enabled;
}
