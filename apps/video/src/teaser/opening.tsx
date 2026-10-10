import { Briefcase, CalendarClock, FileText, Mic, MessageSquare, PenLine } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AbsoluteFill } from "remotion";
import { clamp01, mix } from "../app/anim";
import { font } from "../app/theme";
import { Caption, LOCKUP, Lockup, bump, ease, easeIO, k, prog, shadow, springAt, useLocalT } from "./fx";
import { tr } from "./copy";

const W = 360;
const H = 76;

/** 十六张碎片，按“简历 / 岗位 / 面试 / 复盘”四列排好；乱序时各自散落。 */
const COLUMNS: { title: string; items: { icon: LucideIcon; text: string }[] }[] = [
  { title: "简历", items: [
    { icon: FileText, text: "简历_v3_最终版.pdf" },
    { icon: FileText, text: "简历_v5_真的最终.docx" },
    { icon: PenLine, text: "项目经历草稿" },
    { icon: PenLine, text: "两分钟自我介绍" },
  ] },
  { title: "岗位", items: [
    { icon: Briefcase, text: "星河科技 · Java 后端" },
    { icon: Briefcase, text: "北辰互娱 · 服务端开发" },
    { icon: Briefcase, text: "云栈科技 · 后端开发" },
    { icon: Briefcase, text: "数澜网络 · Java 开发" },
  ] },
  { title: "面试", items: [
    { icon: Mic, text: "一面录音 · 42:18" },
    { icon: CalendarClock, text: "二面 · 周四 14:00" },
    { icon: CalendarClock, text: "笔试 · 周三 19:30" },
    { icon: MessageSquare, text: "HR：方便发下最新简历吗？" },
  ] },
  { title: "复盘", items: [
    { icon: PenLine, text: "线上 Full GC 怎么排查？" },
    { icon: PenLine, text: "被问到 G1 和 ZGC" },
    { icon: PenLine, text: "Redis 一致性答得一般" },
    { icon: PenLine, text: "下次补上调优数据" },
  ] },
];

/** 乱序位置（镜头坐标），s 模拟前后景深：越小越远、越虚。 */
const SCATTER: { x: number; y: number; rot: number; s: number }[] = [
  { x: 330, y: 190, rot: -11, s: 1.06 }, { x: 800, y: 150, rot: 7, s: 0.87 }, { x: 1260, y: 230, rot: -6, s: 1.21 }, { x: 1640, y: 170, rot: 12, s: 0.92 },
  { x: 250, y: 470, rot: 9, s: 0.96 }, { x: 680, y: 400, rot: -14, s: 1.25 }, { x: 1080, y: 470, rot: 5, s: 1.01 }, { x: 1520, y: 430, rot: -8, s: 1.14 },
  { x: 1760, y: 640, rot: 6, s: 0.84 }, { x: 420, y: 690, rot: -5, s: 1.23 }, { x: 860, y: 640, rot: 13, s: 0.9 }, { x: 1290, y: 700, rot: -12, s: 1.25 },
  { x: 1640, y: 860, rot: 8, s: 1.06 }, { x: 200, y: 900, rot: -9, s: 0.9 }, { x: 1010, y: 820, rot: -4, s: 0.81 }, { x: 1800, y: 1000, rot: -13, s: 0.96 },
];
/** 第 i 张卡（按列优先编号）散落到 SCATTER 的哪个位置，让同类卡片彼此远离。 */
const PERM = [5, 12, 1, 9, 2, 14, 7, 4, 11, 0, 15, 6, 3, 10, 8, 13];

const COL_X = (c: number) => 960 + (c - 1.5) * 400;
/** 四行卡片整体排在横线上方，横线作为底边托住整块，不从卡片之间穿过。 */
const ROW_Y = (r: number) => LOCKUP.y - H / 2 - 32 - (3 - r) * 92;

const LINE_AT = 2.5;
const LINE_DUR = 1.5;
const ABSORB_AT = 5.1;
const ABSORB_ORDER = [0, 3, 1, 2];
const SHRINK_AT = 5.5;
const LOCKUP_AT = 6.05;
/** 品牌落版后开始退场；横线留给简历镜头接住。 */
export const OPENING_OUT = 7.5;

const LINE_FROM = -120;
const LINE_TO = 2040;
const drawAt = (t: number) => easeIO(clamp01((t - LINE_AT) / LINE_DUR));

/** 线头到达横坐标 x 的时刻（对缓动曲线二分求逆）。 */
function reachTime(x: number) {
  const u = clamp01((x - LINE_FROM) / (LINE_TO - LINE_FROM));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const m = (lo + hi) / 2;
    if (easeIO(m) < u) lo = m; else hi = m;
  }
  return LINE_AT + LINE_DUR * lo;
}

const CARDS = COLUMNS.flatMap((col, c) => col.items.map((item, r) => {
  const i = c * 4 + r;
  const from = SCATTER[PERM[i]];
  return {
    ...item, c, r, from,
    // 远处的先出现，近处的后出现并压在上面，越堆越乱
    popAt: 0.05 + [...SCATTER].sort((a, b) => a.s - b.s).indexOf(from) * 0.075,
    // 线头经过这一列时才被理顺，同列自上而下依次落位
    sortAt: reachTime(COL_X(c) - 150) + r * 0.06,
  };
}));
/** 绘制顺序：远的在下。 */
const Z = CARDS.map((_, i) => i).sort((a, b) => CARDS[a].from.s - CARDS[b].from.s);

export function OpeningScene() {
  const t = useLocalT();
  const shrink = prog(t, SHRINK_AT, 0.8, easeIO);
  // 乱的时候镜头慢慢压近，理顺后退回
  const cam = mix(mix(1, 1.05, prog(t, 0, LINE_AT, ease)), 1, prog(t, LINE_AT, 1.6, easeIO));
  const lineY = 540 + (LOCKUP.y - 540) * cam;
  const draw = drawAt(t);
  const head = mix(LINE_FROM, LINE_TO, draw);
  const x1 = mix(LINE_FROM, LOCKUP.x1, shrink);
  const x2 = mix(head, LOCKUP.x2, shrink);

  return <AbsoluteFill>
    {draw > 0 && <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <line x1={x1} y1={lineY} x2={x2} y2={lineY} stroke={k.ink} strokeWidth={2} strokeLinecap="round" />
    </svg>}
    <AbsoluteFill style={{ transform: `scale(${cam})` }}>
      {COLUMNS.map((col, c) => {
        const show = prog(t, reachTime(COL_X(c) - 150), 0.5) * (1 - prog(t, ABSORB_AT + ABSORB_ORDER.indexOf(c) * 0.1, 0.3));
        return show > 0 && <div key={col.title} style={{ position: "absolute", left: COL_X(c) - W / 2, top: ROW_Y(0) - H / 2 - 50, width: W, fontFamily: font.sans, fontSize: 18, color: k.mute, letterSpacing: "0.24em", opacity: show, transform: `translateY(${(1 - show) * 8}px)` }}>{tr(col.title)}</div>;
      })}
      {Z.map((i) => {
        const card = CARDS[i];
        const { from } = card;
        const v = springAt(t, card.popAt);
        const fade = prog(t, card.popAt, 0.25);
        const q = springAt(t, card.sortAt, true);
        const settled = prog(t, card.sortAt, 0.5);
        const absorb = prog(t, ABSORB_AT + ABSORB_ORDER.indexOf(card.c) * 0.1, 0.45, easeIO);
        if (absorb >= 1) return null;
        const drift = 1 - settled;
        const sx = from.x + Math.sin(t * 0.8 + i * 1.9) * 16 * drift;
        const sy = from.y + Math.cos(t * 0.7 + i * 2.7) * 12 * drift;
        const x = mix(sx, COL_X(card.c), q);
        const y = mix(mix(sy, ROW_Y(card.r), q), LOCKUP.y, absorb);
        const rot = mix(from.rot + Math.sin(t * 0.9 + i) * 2 * drift, 0, q);
        const depth = clamp01((1.0 - from.s) / 0.2);
        const s = mix(from.s, 1, settled) * mix(0.88, 1, v) * bump(t, card.sortAt + 0.15, 0.04);
        const Icon = card.icon;
        return <div key={i} style={{
          position: "absolute", left: x - W / 2, top: y - H / 2, width: W, height: H, boxSizing: "border-box", padding: "0 24px",
          display: "flex", alignItems: "center", gap: 14, borderRadius: 14, background: k.paper, boxShadow: shadow.card,
          fontFamily: font.sans, fontSize: 22, color: k.ink, whiteSpace: "nowrap", overflow: "hidden",
          opacity: fade * mix(1 - depth * 0.3, 1, settled) * (1 - absorb),
          filter: depth * drift > 0.02 ? `blur(${depth * drift * 1.6}px)` : undefined,
          transform: `translateY(${(1 - v) * 24}px) rotate(${rot}deg) scale(${s * mix(1, 0.7, absorb)}, ${s * mix(1, 0.02, absorb)})`,
        }}><Icon size={22} strokeWidth={1.7} color={k.mute} style={{ flex: "none" }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tr(card.text)}</span></div>;
      })}
    </AbsoluteFill>
    <Caption text={tr("简历、岗位、面试，散落在各处")} t={t} at={0.5} out={2.5} />
    <Caption text={tr("每一次投递和面试，都不该白费")} t={t} at={3.4} out={5.0} />
    <Lockup t={t} at={LOCKUP_AT} out={OPENING_OUT} />
  </AbsoluteFill>;
}
