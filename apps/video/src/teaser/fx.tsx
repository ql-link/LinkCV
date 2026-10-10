import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, Sequence, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import wordmark from "@web-assets/linkresume-wordmark.png";
import { clamp01, mix } from "../app/anim";
import { font } from "../app/theme";
import { LOCALE, tr } from "./copy";

/** 与 Web Token 对齐的黑白中性色，蓝色只做点睛（apps/web/src/design-system/tokens.css）。 */
export const k = {
  bg: "#fcfcfc",
  paper: "#ffffff",
  ink: "#17191c",
  text: "#3f4752",
  mute: "#66717f",
  subtle: "#8791a1",
  border: "#ded7cc",
  hair: "#ebe6de",
  blue: "#3f6fd8",
  blueSoft: "#eef2fc",
  /** 与简历检查面板一致：橙色表示缺信息、薄弱。 */
  orange: "#d9822b",
  orangeSoft: "#fcf0e2",
};

/** Web 的 --ui-ease-standard：快起步、长而柔的收尾。 */
export const ease = Easing.bezier(0.32, 0.72, 0, 1);
export const easeExit = Easing.bezier(0.4, 0, 1, 1);
export const easeIO = Easing.bezier(0.65, 0, 0.35, 1);

export function prog(t: number, at: number, dur: number, easing: (v: number) => number = ease) {
  return easing(clamp01((t - at) / dur));
}

/** 确定性随机，范围 [a, b)。 */
export function rnd(seed: string | number, a = 0, b = 1) {
  return mix(a, b, random(seed));
}

/** 全片节奏：脚本里的秒数按此倍率放慢后播放。 */
export const PACE = 1.3;

/** 当前镜头内的脚本秒数（已按 PACE 放慢）。 */
export function useLocalT() {
  return useCurrentFrame() / 30 / PACE;
}

export const shadow = {
  paper: "0 0 0 1px rgba(23,25,28,0.06), 0 2px 6px rgba(15,18,22,0.04), 0 30px 70px rgba(15,18,22,0.08)",
  card: `0 0 0 1px ${k.border}, 0 2px 8px rgba(15,18,22,0.05)`,
  lift: `0 0 0 1px ${k.border}, 0 18px 40px rgba(15,18,22,0.12)`,
};

/** 全片背景：近白底和极淡的暖色暗角。 */
export function Backdrop() {
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 75% at 50% 45%, ${k.bg} 55%, #f4f1ec 100%)` }} />;
}

/** 镜头：相邻镜头在交接处重叠，由上一镜头交出承接元素、下一镜头原位接住，不做整体淡入淡出。 */
export function Shot({ from, seconds, children }: { from: number; seconds: number; children: ReactNode }) {
  const { fps } = useVideoConfig();
  return <Sequence from={Math.round(from * PACE * fps)} durationInFrames={Math.round(seconds * PACE * fps)}>
    <AbsoluteFill>{children}</AbsoluteFill>
  </Sequence>;
}

const SPRING = {
  /** 阻尼比约 0.4：冲过头约 2–3%，只回弹一次。 */
  pop: { damping: 11, stiffness: 190, mass: 1 },
  /** 列表项用的更柔版本。 */
  soft: { damping: 15, stiffness: 180, mass: 1 },
};

export function springAt(t: number, at: number, soft = false) {
  if (t < at) return 0;
  return spring({ frame: (t - at) * 30, fps: 30, config: soft ? SPRING.soft : SPRING.pop });
}

/** 弹层：从触发位置轻弹入场，退场不弹，0.25 秒缩小淡出。 */
export function pop(t: number, at: number, o: { out?: number; from?: number; dx?: number; dy?: number; soft?: boolean; origin?: string } = {}): CSSProperties {
  const v = springAt(t, at, o.soft);
  const fade = clamp01((t - at) / 0.2);
  const q = o.out === undefined ? 0 : easeExit(clamp01((t - o.out) / 0.25));
  const s = mix(o.from ?? 0.9, 1, v) * mix(1, 0.96, q);
  return { opacity: fade * (1 - q), transform: `translate(${(1 - v) * (o.dx ?? 0)}px, ${(1 - v) * (o.dy ?? 10)}px) scale(${s})`, transformOrigin: o.origin ?? "50% 50%" };
}

/** 数字滚到终点时轻跳一下。 */
export function bump(t: number, at: number, amp = 0.12) {
  const x = clamp01((t - at) / 0.4);
  return 1 + amp * Math.sin(Math.PI * x) * (1 - x);
}

export function mixColor(a: string, b: string, p: number) {
  if (p <= 0 || a === b) return a;
  if (p >= 1) return b;
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(mix(ch(a, i), ch(b, i), p))).join(",")})`;
}

/** 描边画出的对勾。 */
export function CheckDraw({ p, size = 16, color = k.blue, width = 2.4 }: { p: number; size?: number; color?: string; width?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", overflow: "visible" }}>
    <path d="M4.5 12.5l5 5L19.5 7" pathLength={1} strokeDasharray={`${clamp01(p)} 1`} stroke={color} strokeWidth={width * (24 / size)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** 遮罩揭开：内容从遮罩下方升起，out 时继续向上离开。dir="down" 时方向相反。 */
export function Mask({ t, at, out, dur = 0.7, dir = "up", children, style }: { t: number; at: number; out?: number; dur?: number; dir?: "up" | "down"; children: ReactNode; style?: CSSProperties }) {
  const pin = prog(t, at, dur);
  const pout = out === undefined ? 0 : prog(t, out, 0.45, easeExit);
  const sign = dir === "up" ? 1 : -1;
  const y = ((1 - pin) * 110 - pout * 110) * sign;
  return <div style={{ overflow: "hidden", ...style }}>
    <div style={{ transform: `translateY(${y}%)` }}>{children}</div>
  </div>;
}

/** 镜头：把舞台坐标中的 (fx, fy) 放到画面中心并缩放 s 倍。 */
export function camera(fx: number, fy: number, s: number) {
  return { transformOrigin: "0 0", transform: `translate(${960 - fx * s}px, ${540 - fy * s}px) scale(${s})` } as const;
}

/** 字幕下方的淡出底，避免字幕压在画面内容上。 */
export function CaptionScrim({ opacity = 1 }: { opacity?: number }) {
  return <div style={{ position: "absolute", left: 0, right: 0, top: 800, bottom: 0, opacity, background: `linear-gradient(rgba(252,252,252,0), ${k.bg} 38%)` }} />;
}

/** 镜头字幕：衬线标题，按行遮罩升起。 */
export function Caption({ text, t, at, out, y = 912 }: { text: string; t: number; at: number; out?: number; y?: number }) {
  return <div style={{ position: "absolute", left: 0, right: 0, top: y, display: "flex", justifyContent: "center" }}>
    <Mask t={t} at={at} out={out} dur={0.8}>
      <div style={{ fontFamily: font.serif, fontSize: 50, lineHeight: "72px", fontWeight: 600, color: k.ink, letterSpacing: "0.04em" }}>{text}</div>
    </Mask>
  </div>;
}

/** 品牌落版：横线之上升起字标，横线之下落下标语。line 为横线两端与高度。 */
export const LOCKUP = { x1: 660, x2: 1260, y: 560 };

export function Lockup({ t, at, out }: { t: number; at: number; out?: number }) {
  const width = 720;
  const height = width * (349 / 1701);
  return <>
    <Mask t={t} at={at} out={out} dur={0.9} style={{ position: "absolute", left: 960 - width / 2, top: LOCKUP.y - 34 - height, width, height: height + 6 }}>
      <Img src={wordmark} style={{ width, height, display: "block" }} />
    </Mask>
    <Mask t={t} at={at + 0.45} out={out === undefined ? undefined : out + 0.05} dur={0.9} dir="down" style={{ position: "absolute", left: 0, right: 0, top: LOCKUP.y + 26, textAlign: "center" }}>
      <div style={{ fontFamily: font.serif, fontSize: LOCALE === "en" ? 30 : 34, lineHeight: "48px", fontWeight: 400, color: k.text, letterSpacing: LOCALE === "en" ? "0.04em" : "0.42em", paddingLeft: LOCALE === "en" ? 0 : "0.42em" }}>{tr("懂你经历的求职搭档")}</div>
    </Mask>
  </>;
}

export type Pt = { x: number; y: number };

/** Catmull-Rom 采样成折线，便于按长度截取。 */
export function spline(points: Pt[], steps = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s += 1) {
      const u = s / steps;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function bezierPts(a: Pt, c1: Pt, c2: Pt, b: Pt, steps = 60): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const u = i / steps;
    const v = 1 - u;
    return {
      x: v * v * v * a.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * b.x,
      y: v * v * v * a.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * b.y,
    };
  });
}

/** 截取折线的 [from, to] 比例段（按长度）。 */
export function segment(pts: Pt[], from: number, to: number): Pt[] {
  const lens = [0];
  for (let i = 1; i < pts.length; i += 1) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens[lens.length - 1];
  const at = (d: number): Pt => {
    for (let i = 1; i < pts.length; i += 1) {
      if (lens[i] >= d) {
        const q = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
        return { x: mix(pts[i - 1].x, pts[i].x, q), y: mix(pts[i - 1].y, pts[i].y, q) };
      }
    }
    return pts[pts.length - 1];
  };
  const a = total * clamp01(from);
  const b = total * clamp01(to);
  return [at(a), ...pts.filter((_, i) => lens[i] > a && lens[i] < b), at(b)];
}

export const toPath = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

/** 一根细线，按 [from, to] 截取绘制。 */
export function Thread({ pts, from = 0, to, width = 2, color = k.ink, opacity = 1, dot = false }: { pts: Pt[]; from?: number; to: number; width?: number; color?: string; opacity?: number; dot?: boolean }) {
  if (to <= from || opacity <= 0) return null;
  const seg = segment(pts, from, to);
  const head = seg[seg.length - 1];
  return <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible", opacity }}>
    <path d={toPath(seg)} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {dot && to < 1 && <circle cx={head.x} cy={head.y} r={5} fill={color} />}
  </svg>;
}
