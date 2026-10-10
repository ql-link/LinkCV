import { Mic } from "lucide-react";
import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { clamp01, mix } from "../app/anim";
import { font } from "../app/theme";
import { Caption, LOCKUP, Lockup, bump, ease, easeIO, k, prog, shadow, spline, springAt, toPath, useLocalT } from "./fx";
import type { Pt } from "./fx";
import { tr } from "./copy";

const W = 420;
const H = 120;

function Bars({ n = 34 }: { n?: number }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 30 }}>
    {Array.from({ length: n }, (_, i) => <span key={i} style={{ width: 3, height: 5 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)) * 24, borderRadius: 2, background: k.ink }} />)}
  </span>;
}

/** 四张碎片卡，s 模拟前后景深：靠近镜头的更大。 */
const FRAGMENTS: { x: number; y: number; rot: number; s: number; body: ReactNode }[] = [
  { x: 420, y: 320, rot: -4, s: 1.06, body: <><div style={{ fontSize: 16, color: k.mute, letterSpacing: "0.2em" }}>{tr("简历")}</div><div style={{ marginTop: 8, fontSize: 22, color: k.ink }}>{tr("订单服务重构，P99 降至 160ms")}</div></> },
  { x: 830, y: 790, rot: 3, s: 0.9, body: <><div style={{ fontSize: 25, fontWeight: 600, color: k.ink }}>{tr("星河科技")}</div><div style={{ marginTop: 6, fontSize: 19, color: k.mute }}>{tr("Java 后端开发 · 杭州 · 25–40K")}</div></> },
  { x: 1300, y: 290, rot: 3, s: 0.95, body: <><div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 18, color: k.mute }}><Mic size={18} strokeWidth={1.8} />{tr("一面录音 · 42:18")}</div><div style={{ marginTop: 10 }}><Bars /></div></> },
  { x: 1520, y: 770, rot: -3, s: 1.08, body: <><div style={{ fontSize: 16, color: k.mute, letterSpacing: "0.2em" }}>{tr("模拟面试")}</div><div style={{ marginTop: 8, fontSize: 23, color: k.ink }}>{tr("线上 Full GC 怎么排查？")}</div></> },
];
const LINE_AT = 1.5;
const LINE_DUR = 1.6;
/** 四张卡从两侧向中间依次收进横线。 */
const ABSORB_AT = 4.0;
const ABSORB_ORDER = [0, 3, 1, 2];
const SHRINK_AT = 4.3;
const LOCKUP_AT = 4.85;
/** 品牌落版后开始退场；横线留给简历镜头接住。 */
export const OPENING_OUT = 6.3;

const drawAt = (t: number) => easeIO(clamp01((t - LINE_AT) / LINE_DUR));

/** 线头到达比例 u 的时刻（对缓动曲线二分求逆）。 */
function reachTime(u: number) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const m = (lo + hi) / 2;
    if (easeIO(m) < u) lo = m; else hi = m;
  }
  return LINE_AT + LINE_DUR * lo;
}
const HIT = FRAGMENTS.map((_, i) => reachTime((i + 1) / (FRAGMENTS.length + 1)));

/** 按采样序号截取折线：卡片恰好落在 (i+1)/5 处，线头经过卡片的时刻可以精确对齐。 */
function upTo(pts: Pt[], u: number): Pt[] {
  const n = (pts.length - 1) * clamp01(u);
  const i = Math.floor(n);
  const out = pts.slice(0, i + 1);
  if (i < pts.length - 1) out.push({ x: mix(pts[i].x, pts[i + 1].x, n - i), y: mix(pts[i].y, pts[i + 1].y, n - i) });
  return out;
}

export function OpeningScene() {
  const t = useLocalT();
  const straight = prog(t, LINE_AT + 0.2, 2.0, easeIO);
  const shrink = prog(t, SHRINK_AT, 0.8, easeIO);
  const cards = FRAGMENTS.map((f, i) => {
    // 线头经过时才被“牵”住，轻跳一下再顺势滑入队列
    const snap = prog(t, HIT[i], 1.1);
    const drift = 1 - snap;
    const absorb = prog(t, ABSORB_AT + ABSORB_ORDER.indexOf(i) * 0.12, 0.45, easeIO);
    return {
      ...f,
      x: mix(f.x + Math.sin(t * 0.7 + i * 1.7) * 12 * drift, 960 + (i - 1.5) * 440, snap),
      y: mix(f.y + Math.cos(t * 0.6 + i * 2.3) * 9 * drift, LOCKUP.y, snap),
      rot: mix(f.rot, 0, snap),
      s: mix(f.s, 0.92, snap) * bump(t, HIT[i], 0.05),
      v: springAt(t, 0.05 + i * 0.18),
      fade: prog(t, 0.05 + i * 0.18, 0.25),
      absorb,
    };
  });
  const cam = mix(1.04, 1, prog(t, 0, 5, ease));
  // 线穿过卡片中心；卡片缩放在镜头里，线在镜头外，按镜头缩放换算到屏幕坐标
  const screen = (p: Pt) => ({ x: 960 + (p.x - 960) * cam, y: 540 + (p.y - 540) * cam });
  const ends = [{ x: -120, y: mix(660, LOCKUP.y, straight) }, { x: 2040, y: mix(450, LOCKUP.y, straight) }];
  const raw = spline([ends[0], ...cards.map((c) => screen({ x: c.x, y: mix(c.y, LOCKUP.y, straight) })), ends[1]]);
  // 收拢：整条线向中心收成落版横线
  const pts = raw.map((p) => ({ x: mix(p.x, mix(LOCKUP.x1, LOCKUP.x2, (p.x + 120) / 2160), shrink), y: mix(p.y, LOCKUP.y, shrink) }));
  const draw = drawAt(t);

  return <AbsoluteFill>
    {draw > 0 && <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <path d={toPath(upTo(pts, draw))} stroke={k.ink} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>}
    <AbsoluteFill style={{ transform: `scale(${cam})` }}>
      {cards.map((c, i) => c.absorb < 1 && <div key={i} style={{ position: "absolute", left: c.x - W / 2, top: c.y - H / 2, width: W, height: H, boxSizing: "border-box", padding: "22px 30px", borderRadius: 14, background: k.paper, boxShadow: shadow.card, fontFamily: font.sans, opacity: c.fade * (1 - c.absorb), transform: `translateY(${(1 - c.v) * 26}px) rotate(${c.rot}deg) scale(${c.s * mix(0.9, 1, c.v) * mix(1, 0.7, c.absorb)}, ${c.s * mix(0.9, 1, c.v) * mix(1, 0.02, c.absorb)})`, whiteSpace: "nowrap" }}>{c.body}</div>)}
    </AbsoluteFill>
    <Caption text={tr("每一次投递和面试，都不该白费")} t={t} at={0.6} out={3.6} />
    <Lockup t={t} at={LOCKUP_AT} out={OPENING_OUT} />
  </AbsoluteFill>;
}
