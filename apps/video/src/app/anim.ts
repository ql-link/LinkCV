import type { CSSProperties } from "react";
import { Easing, useCurrentFrame, useVideoConfig } from "remotion";

export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeOut = Easing.bezier(0.2, 0.8, 0.2, 1);

/** 当前 Sequence 内的秒数。 */
export function useT() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** start 秒开始、持续 dur 秒的 0→1 进度。 */
export function ramp(t: number, start: number, dur = 0.45, easing: (v: number) => number = easeOut) {
  return easing(clamp01((t - start) / dur));
}

export function mix(a: number, b: number, p: number) {
  return a + (b - a) * p;
}

/** 入场：淡入并上移。 */
export function fadeUp(t: number, at: number, dist = 12, dur = 0.45): CSSProperties {
  const p = ramp(t, at, dur);
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
}

export function fadeIn(t: number, at: number, dur = 0.35): CSSProperties {
  return { opacity: ramp(t, at, dur) };
}

/** 逐字输出：cps 为每秒字数。 */
export function typed(text: string, t: number, start: number, cps = 22) {
  const chars = Array.from(text);
  return chars.slice(0, Math.max(0, Math.floor((t - start) * cps))).join("");
}

export function typedDone(text: string, start: number, cps = 22) {
  return start + Array.from(text).length / cps;
}

/** 关键帧插值：keys 按 at 升序，值为数字字典。 */
export function keyframes<T extends Record<string, number>>(keys: (T & { at: number })[], t: number): T {
  if (t <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1];
    const b = keys[i];
    if (t <= b.at) {
      const p = easeInOut((t - a.at) / (b.at - a.at || 1));
      const out = {} as Record<string, number>;
      for (const k of Object.keys(b)) out[k] = mix(a[k as keyof T] as number, b[k as keyof T] as number, p);
      return out as T;
    }
  }
  return keys[keys.length - 1];
}
