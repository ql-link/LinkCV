import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { AbsoluteFill, Img, continueRender, delayRender } from "remotion";
import claude from "@web-assets/model-icons/claude.svg";
import deepseek from "@web-assets/model-icons/deepseek.svg";
import openai from "@web-assets/model-icons/openai.svg";
import { clamp01, mix } from "../app/anim";
import { font } from "../app/theme";
import { Caption, CaptionScrim, CheckDraw, bezierPts, easeIO, k, mixColor, pop, prog, shadow, springAt, toPath, useLocalT } from "./fx";
import { LOCALE, tr } from "./copy";

/* 满页简历：字体就绪后测量每个字在两套模板中的坐标，切换模板时逐字在两组坐标之间流动。 */

export const PAPER = { x: 580, y: 30, w: 760, h: 1074 };
/** 交给投递镜头的简历缩略图（屏幕坐标）。 */
export const THUMB = { x: 1000, y: 540, w: 150 };
const THUMB_S = THUMB.w / PAPER.w;
const SIDE_W = 250;
const SIDE_BG = "#f2f4f8";
const SECTION_INK = "#2c4a7c";

const LINE_MOVE = 0.3;
const SCAN_AT = 1.1;
const SCAN_DUR = 1.2;
const TS = 2.6;
const PUSH_AT = 4.9;
const CHECK_AT = 5.5;
const ADOPT_AT = 6.9;
/** 简历缩成缩略图的起点；投递镜头从这里开始。 */
export const RESUME_HAND = 8.8;
/** 缩略图从开始缩小到停稳的时长。 */
export const THUMB_ARRIVE = 0.8;
export const RESUME_SECONDS = RESUME_HAND + THUMB_ARRIVE + 0.3;

/* ---------- 内容 ---------- */

const NAME = tr("周屿");
const PHONE = "138-0000-0000";
const EMAIL = "zhouyu@example.com";
const GITHUB = "github.com/zhouyu-dev";
const SCHOOL = tr("江城大学 · 计算机科学与技术 · 本科 · 2022.09 – 2026.06");
type Para = { id: string; text: string };
type Entry = { id: string; co: string; date: string; role: string; lines: Para[] };
const MAIN: { id: string; title: string; entries: Entry[] }[] = [
  { id: "intern", title: tr("实习经历"), entries: [
    { id: "e1", co: tr("云栈科技"), date: "2025.07 – 2025.12", role: tr("Java 后端开发实习"), lines: [
      { id: "l1", text: tr("技术栈：Java、Spring Boot、MySQL、Redis、Kafka") },
      { id: "l2", text: tr("1. 负责订单服务拆分重构，将单体下单链路拆为订单、库存、支付三个服务，核心接口 P99 延迟从 420ms 降至 160ms；") },
      { id: "l3", text: tr("2. 设计 Redis + Lua 库存预扣方案，解决大促超卖问题，峰值 QPS 8000；") },
      { id: "jvm", text: tr("3. 参与 JVM 调优，排查线上 Full GC 频繁问题。") },
    ] },
    { id: "e2", co: tr("数澜网络"), date: "2025.01 – 2025.06", role: tr("后端开发实习"), lines: [
      { id: "l4", text: tr("1. 基于 Kafka 实现用户行为日志异步落库，削峰后数据库写入压力降低 60%；") },
      { id: "l5", text: tr("2. 编写 MyBatis 批量写入组件，10 万条数据导入耗时由 95s 降至 12s。") },
    ] },
  ] },
  { id: "proj", title: tr("项目经历"), entries: [
    { id: "e3", co: tr("分布式秒杀系统"), date: "2024.10 – 2024.12", role: tr("个人项目"), lines: [
      { id: "l6", text: tr("1. 使用 Redis 预减库存 + MQ 异步下单，支撑 1 万并发压测无超卖；") },
      { id: "bloom", text: tr("2. 通过本地缓存和布隆过滤器解决了缓存穿透问题并且把接口命中率提升到了 98%。") },
    ] },
  ] },
];
const SIDE: { id: string; title: string; lines: Para[] }[] = [
  { id: "skill", title: tr("专业技能"), lines: [
    { id: "s1", text: tr("• 熟悉 Java 集合与并发编程，了解 JVM 内存模型与垃圾回收机制；") },
    { id: "s2", text: tr("• 熟悉 MySQL 索引与事务隔离级别，掌握 Redis 常用数据结构与持久化；") },
    { id: "s3", text: tr("• 熟悉 Spring Boot、MyBatis，了解 Kafka、Docker 与 Linux 常用命令。") },
  ] },
  { id: "award", title: tr("荣誉奖项"), lines: [
    { id: "a1", text: tr("• 校级程序设计竞赛一等奖（2024）") },
    { id: "a2", text: tr("• 校级一等奖学金（2 次）") },
  ] },
];
const JVM_NEW = tr("3. 定位大对象缓存导致的 Full GC 频繁，调整 G1 参数与缓存淘汰策略，Full GC 由每小时 6 次降至 0，Young GC 停顿降低 35%；");

/* ---------- 测量与排版 ---------- */

type St = { fam: "paper" | "sans"; size: number; weight: number; color: string; lh: number; ls?: number };
type G = { ch: string; x: number; y: number; w: number; st: St };
type Deco = { underlines: { x: number; y: number; w: number }[]; bars: { x: number; y: number }[]; dots: { x: number; y: number }[]; rails: { x: number; y1: number; y2: number }[] };
type Layout = { items: Record<string, G[]>; deco: Deco };
type Layouts = { cl: Layout; sb: Layout; sb2: Layout };

const familyOf = (st: St) => (st.fam === "paper" ? font.paper : font.sans);
const fontCss = (st: St) => `${st.weight} ${st.size}px ${familyOf(st)}`;
let ctx: CanvasRenderingContext2D | null = null;

function charWidths(text: string, st: St) {
  ctx ??= document.createElement("canvas").getContext("2d");
  ctx!.font = fontCss(st);
  return Array.from(text).map((c) => ctx!.measureText(c).width + (st.ls ?? 0));
}
const sum = (w: number[], a = 0, b = w.length) => w.slice(a, b).reduce((n, v) => n + v, 0);

// 英文单词连同括号与紧跟的标点一起折行，不把 “(” 或 “,” 单独留在行尾或行首
const TOKEN = /[A-Za-z0-9.%+\-@/_:(),;'’&→]+|\s+|[^\s]/gu;
const NO_START = /^[，。；、：）%·]/;

/** 按宽度折行：拉丁词不拆开，标点不放行首；hang 时续行与序号后的正文对齐。 */
function flow(text: string, st: St, x: number, y: number, width: number, opt: { align?: "left" | "center" | "right"; hang?: boolean } = {}) {
  const chars = Array.from(text);
  const w = charWidths(text, st);
  const prefix = opt.hang ? /^(\d+\. |• )/.exec(text)?.[0] : undefined;
  const indent = prefix ? sum(w, 0, Array.from(prefix).length) : 0;
  const lines: [number, number][] = [];
  let start = 0;
  let cur = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const a = i;
    const b = i + Array.from(m[0]).length;
    i = b;
    const tw = sum(w, a, b);
    const limit = lines.length ? width - indent : width;
    if (cur + tw > limit && cur > 0 && !NO_START.test(m[0])) {
      lines.push([start, a]);
      start = a;
      cur = 0;
      if (/^\s+$/.test(m[0])) { start = b; continue; }
    }
    cur += tw;
  }
  lines.push([start, chars.length]);
  const glyphs: G[] = chars.map((ch, j) => ({ ch, x, y, w: w[j], st }));
  lines.forEach(([a, b], li) => {
    const avail = li ? width - indent : width;
    const lw = sum(w, a, b);
    let gx = x + (li ? indent : 0) + (opt.align === "center" ? (avail - lw) / 2 : opt.align === "right" ? avail - lw : 0);
    for (let j = a; j < b; j += 1) {
      glyphs[j] = { ch: chars[j], x: gx, y: y + li * st.lh, w: w[j], st };
      gx += w[j];
    }
  });
  return { glyphs, lines: lines.length };
}

const emptyDeco = (): Deco => ({ underlines: [], bars: [], dots: [], rails: [] });

const C: Record<string, St> = {
  name: { fam: "paper", size: 38, weight: 600, color: k.ink, lh: 50, ls: 7.6 },
  contact: { fam: "sans", size: 13.5, weight: 400, color: k.text, lh: 22 },
  sec: { fam: "paper", size: 19, weight: 600, color: SECTION_INK, lh: 26, ls: 1.1 },
  co: { fam: "sans", size: 15.5, weight: 600, color: k.ink, lh: 28 },
  date: { fam: "sans", size: 15.5, weight: 400, color: k.ink, lh: 28 },
  role: { fam: "sans", size: 15.5, weight: 600, color: k.ink, lh: 28 },
  line: { fam: "sans", size: 15, weight: 400, color: k.text, lh: 27 },
};

/** 经典单栏：顶部居中信息，全部章节通栏，标题下细线。 */
function classic(): Layout {
  const items: Record<string, G[]> = {};
  const deco = emptyDeco();
  const M = 56;
  const W = PAPER.w - M * 2;
  items.name = flow(NAME, C.name, M, 50, W, { align: "center" }).glyphs;
  const parts: [string, string][] = [["phone", PHONE], ["sep1", tr("｜")], ["email", EMAIL], ["sep2", tr("｜")], ["github", GITHUB]];
  const GAP = 14;
  const pw = parts.map(([, s]) => sum(charWidths(s, C.contact)));
  let x = M + (W - sum(pw) - GAP * 4) / 2;
  parts.forEach(([id, s], i) => { items[id] = flow(s, C.contact, x, 108, 9999).glyphs; x += pw[i] + GAP; });
  items.school = flow(SCHOOL, C.contact, M, 132, W, { align: "center" }).glyphs;
  let y = 164;
  const section = (id: string, title: string) => {
    y += 10;
    items[`sec_${id}`] = flow(title, C.sec, M, y + 3, W).glyphs;
    deco.underlines.push({ x: M, y: y + 33, w: W });
    y += 42;
  };
  const para = (p: Para) => {
    const r = flow(p.text, C.line, M, y, W, { hang: true });
    items[p.id] = r.glyphs;
    y += r.lines * C.line.lh;
  };
  for (const s of MAIN) {
    section(s.id, s.title);
    for (const e of s.entries) {
      items[`${e.id}_co`] = flow(e.co, C.co, M, y, W).glyphs;
      items[`${e.id}_date`] = flow(e.date, C.date, M, y, W, { align: "center" }).glyphs;
      items[`${e.id}_role`] = flow(e.role, C.role, M, y, W, { align: "right" }).glyphs;
      y += 32;
      e.lines.forEach(para);
    }
  }
  for (const s of SIDE) {
    section(s.id, s.title);
    s.lines.forEach(para);
  }
  return { items, deco };
}

const S: Record<string, St> = {
  // 英文姓名更长，缩小字号以免在侧栏里折行
  name: { fam: "paper", size: LOCALE === "en" ? 34 : 42, weight: 600, color: k.ink, lh: 54, ls: LOCALE === "en" ? 1 : 4 },
  hdr: { fam: "sans", size: 12, weight: 600, color: k.blue, lh: 18, ls: 2.4 },
  contact: { fam: "sans", size: 13, weight: 400, color: k.text, lh: 22 },
  sideSec: { fam: "paper", size: 17, weight: 600, color: k.blue, lh: 24, ls: 1 },
  sideLine: { fam: "sans", size: 13, weight: 400, color: k.text, lh: 22 },
  sec: { fam: "paper", size: 19, weight: 600, color: k.blue, lh: 26, ls: 1.1 },
  co: { fam: "sans", size: 16, weight: 600, color: k.ink, lh: 24 },
  date: { fam: "sans", size: 13, weight: 400, color: k.mute, lh: 24 },
  role: { fam: "sans", size: 14, weight: 400, color: k.mute, lh: 22 },
  line: { fam: "sans", size: 15, weight: 400, color: k.text, lh: 27 },
};

/** 侧栏双栏：左栏放姓名、联系方式、教育、技能与奖项，右栏只放经历并带时间线。 */
function sidebar(rewritten: boolean): Layout {
  const items: Record<string, G[]> = {};
  const deco = emptyDeco();
  const SX = 30;
  const SW = SIDE_W - 56;
  let y = 58;
  items.name = flow(NAME, S.name, SX, y, SW).glyphs;
  y += 76;
  items.hdr_contact = flow(tr("联系方式"), S.hdr, SX, y, SW).glyphs;
  y += 28;
  for (const [id, s] of [["phone", PHONE], ["email", EMAIL], ["github", GITHUB]]) {
    items[id] = flow(s, S.contact, SX, y, SW).glyphs;
    y += 24;
  }
  y += 26;
  items.hdr_edu = flow(tr("教育背景"), S.hdr, SX, y, SW).glyphs;
  y += 28;
  const school = flow(SCHOOL, S.contact, SX, y, SW);
  items.school = school.glyphs;
  y += school.lines * S.contact.lh + 34;
  for (const s of SIDE) {
    items[`sec_${s.id}`] = flow(s.title, S.sideSec, SX, y, SW).glyphs;
    y += 34;
    for (const p of s.lines) {
      const r = flow(p.text, S.sideLine, SX, y, SW, { hang: true });
      items[p.id] = r.glyphs;
      y += r.lines * S.sideLine.lh + 6;
    }
    y += 30;
  }

  const MX = SIDE_W + 40;
  const MW = PAPER.w - MX - 44;
  const cx = MX + 24;
  const cw = MW - 24;
  y = 60;
  for (const s of MAIN) {
    items[`sec_${s.id}`] = flow(s.title, S.sec, MX, y, MW).glyphs;
    deco.bars.push({ x: MX, y: y + 33 });
    y += 52;
    const top = y + 12;
    let last = top;
    for (const e of s.entries) {
      last = y + 12;
      deco.dots.push({ x: MX + 4, y: last });
      items[`${e.id}_co`] = flow(e.co, S.co, cx, y, cw).glyphs;
      items[`${e.id}_date`] = flow(e.date, S.date, cx, y, cw, { align: "right" }).glyphs;
      y += 26;
      items[`${e.id}_role`] = flow(e.role, S.role, cx, y, cw).glyphs;
      y += 26;
      for (const p of e.lines) {
        const id = p.id === "jvm" && rewritten ? "jvm2" : p.id;
        const r = flow(id === "jvm2" ? JVM_NEW : p.text, S.line, cx, y, cw, { hang: true });
        items[id] = r.glyphs;
        y += r.lines * S.line.lh;
      }
      y += 22;
    }
    deco.rails.push({ x: MX + 4, y1: top, y2: last });
    y += 24;
  }
  return { items, deco };
}

let cache: Layouts | null = null;

async function measureAll(): Promise<Layouts> {
  const all = [NAME, PHONE, EMAIL, GITHUB, SCHOOL, JVM_NEW, tr("联系方式教育背景｜"), ...MAIN.flatMap((s) => [s.title, ...s.entries.flatMap((e) => [e.co, e.date, e.role, ...e.lines.map((l) => l.text)])]), ...SIDE.flatMap((s) => [s.title, ...s.lines.map((l) => l.text)])].join("");
  const styles = [...Object.values(C), ...Object.values(S)];
  await Promise.all(styles.map((st) => document.fonts.load(fontCss(st), all)));
  await document.fonts.ready;
  return { cl: classic(), sb: sidebar(false), sb2: sidebar(true) };
}

/** 两套模板的逐字坐标；字体与测量就绪前阻塞渲染。 */
function useResumeLayouts() {
  const [lay, setLay] = useState(cache);
  const [handle] = useState(() => (cache ? null : delayRender("resume-layout")));
  useEffect(() => {
    if (cache) {
      if (handle !== null) continueRender(handle);
      return;
    }
    measureAll().then((l) => {
      cache = l;
      setLay(l);
      if (handle !== null) continueRender(handle);
    });
  }, [handle]);
  return lay;
}

/* ---------- 逐字渲染 ---------- */

const ORDER_A = ["name", "phone", "sep1", "email", "sep2", "github", "school"];
const ORDER_B = SIDE.flatMap((s) => [`sec_${s.id}`, ...s.lines.map((l) => l.id)]);
const ORDER_C = MAIN.flatMap((s) => [`sec_${s.id}`, ...s.entries.flatMap((e) => [`${e.id}_co`, `${e.id}_date`, `${e.id}_role`, ...e.lines.map((l) => l.id)])]);
const DELAY: Record<string, number> = Object.fromEntries([
  ...ORDER_A.map((id, i) => [id, 0.1 + i * 0.05]),
  ...ORDER_B.map((id, i) => [id, 0.3 + i * 0.06]),
  ...ORDER_C.map((id, i) => [id, 0.75 + i * 0.03]),
]);
const FLOW_DUR = 0.95;
const IDS = [...ORDER_A, "hdr_contact", "hdr_edu", ...ORDER_B, ...ORDER_C, "jvm2"];

type View = {
  /** 相对模板切换开始的秒数，<0 为经典模板。 */
  sw: number;
  /** 改写后下方内容下移的进度。 */
  g: number;
  /** 改写句已经显示的比例。 */
  typed: number;
  oldFade: number;
  /** 导入阶段的模糊旧图层使用统一灰色。 */
  mono?: string;
};

const FINAL: View = { sw: 99, g: 1, typed: 1, oldFade: 1 };

function shiftY(L: Layouts, id: string, j: number, g: number) {
  const b = L.sb.items[id]?.[j];
  const c = L.sb2.items[id]?.[j];
  return b && c ? (c.y - b.y) * g : 0;
}

function Glyphs({ L, v }: { L: Layouts; v: View }) {
  const out: ReactNode[] = [];
  for (const id of IDS) {
    const a = L.cl.items[id];
    const b = L.sb.items[id];
    const c = L.sb2.items[id];
    const list = a ?? b ?? c;
    if (!list) continue;
    list.forEach((g0, j) => {
      if (g0.ch === " ") return;
      let x: number;
      let y: number;
      let st: St;
      let size: number;
      let lh: number;
      let color: string;
      let opacity = 1;
      if (a && b) {
        const q = clamp01((v.sw - DELAY[id] - j * 0.0035) / FLOW_DUR);
        const qx = easeIO(clamp01(q / 0.85));
        const qy = easeIO(clamp01((q - 0.15) / 0.85));
        const ga = a[j];
        const gb = b[j];
        x = mix(ga.x, gb.x, qx);
        y = mix(ga.y, gb.y, qy) + shiftY(L, id, j, v.g);
        st = qx < 0.5 ? ga.st : gb.st;
        size = mix(ga.st.size, gb.st.size, qx);
        lh = mix(ga.st.lh, gb.st.lh, qy);
        color = mixColor(ga.st.color, gb.st.color, qx);
        // 移动途中变淡，交错穿过的文字读起来是流动而不是叠字
        opacity = 1 - 0.6 * Math.sin(Math.PI * q);
        if (id === "jvm") opacity *= 1 - v.oldFade;
      } else if (a) {
        ({ x, y, st } = a[j]);
        size = st.size;
        lh = st.lh;
        color = st.color;
        opacity = 1 - prog(v.sw, 0, 0.35);
      } else if (b) {
        ({ x, st } = b[j]);
        y = b[j].y + shiftY(L, id, j, v.g);
        size = st.size;
        lh = st.lh;
        color = st.color;
        opacity = prog(v.sw, 1.2, 0.5);
      } else {
        ({ x, y, st } = c![j]);
        size = st.size;
        lh = st.lh;
        color = k.ink;
        opacity = j < Math.floor(c!.length * v.typed) ? 1 : 0;
      }
      if (opacity <= 0) return;
      out.push(<span key={`${id}-${j}`} style={{ position: "absolute", left: x, top: y, fontFamily: familyOf(st), fontSize: size, lineHeight: `${lh}px`, fontWeight: st.weight, color: v.mono ?? color, opacity, whiteSpace: "pre" }}>{g0.ch}</span>);
    });
  }
  return <>{out}</>;
}

function Decorations({ L, v }: { L: Layouts; v: View }) {
  const side = prog(v.sw, 0, 0.6, easeIO);
  const under = 1 - prog(v.sw, 0.05, 0.4);
  const bar = prog(v.sw, 1.7, 0.5, easeIO);
  const rail = prog(v.sw, 1.8, 0.7, easeIO);
  const sy = (b: number, c: number) => mix(b, c, v.g);
  return <>
    {side > 0 && <div style={{ position: "absolute", left: 0, top: 0, width: SIDE_W * side, height: PAPER.h, background: SIDE_BG }} />}
    {under > 0 && L.cl.deco.underlines.map((u, i) => <div key={i} style={{ position: "absolute", left: u.x, top: u.y, width: u.w, height: 1, background: SECTION_INK, opacity: under }} />)}
    {bar > 0 && L.sb.deco.bars.map((b, i) => <div key={i} style={{ position: "absolute", left: b.x, top: sy(b.y, L.sb2.deco.bars[i].y), width: 28 * bar, height: 2, borderRadius: 1, background: k.blue }} />)}
    {rail > 0 && L.sb.deco.rails.map((r, i) => {
      const y1 = sy(r.y1, L.sb2.deco.rails[i].y1);
      const y2 = sy(r.y2, L.sb2.deco.rails[i].y2);
      return <div key={i} style={{ position: "absolute", left: r.x - 0.5, top: y1, width: 1, height: (y2 - y1) * rail, background: "#c9d3e6" }} />;
    })}
    {L.sb.deco.dots.map((d, i) => {
      const s = springAt(v.sw, 1.9 + i * 0.08);
      if (s <= 0) return null;
      return <div key={i} style={{ position: "absolute", left: d.x - 4.5, top: sy(d.y, L.sb2.deco.dots[i].y) - 4.5, width: 9, height: 9, borderRadius: "50%", boxSizing: "border-box", border: `2px solid ${k.blue}`, background: k.paper, transform: `scale(${s})` }} />;
    })}
  </>;
}

/** 按行合并字形，得到高亮用的行框。 */
function lineBoxes(glyphs: G[], dy = 0) {
  const rows = new Map<number, { x0: number; x1: number; y: number; lh: number }>();
  for (const g of glyphs) {
    if (g.ch === " ") continue;
    const r = rows.get(g.y) ?? { x0: g.x, x1: g.x + g.w, y: g.y + dy, lh: g.st.lh };
    r.x0 = Math.min(r.x0, g.x);
    r.x1 = Math.max(r.x1, g.x + g.w);
    rows.set(g.y, r);
  }
  return [...rows.values()];
}

function Highlight({ glyphs, soft, tone, o, dy = 0 }: { glyphs: G[]; soft: string; tone: string; o: number; dy?: number }) {
  if (o <= 0 || glyphs.length === 0) return null;
  const rows = lineBoxes(glyphs, dy);
  const top = rows[0].y;
  const bottom = rows[rows.length - 1].y + rows[rows.length - 1].lh;
  return <div style={{ opacity: o }}>
    {rows.map((r, i) => <div key={i} style={{ position: "absolute", left: r.x0 - 2, top: r.y + 3, width: r.x1 - r.x0 + 4, height: r.lh - 6, borderRadius: 3, background: soft }} />)}
    <div style={{ position: "absolute", left: rows[0].x0 - 16, top: top + 4, width: 3, height: bottom - top - 8, borderRadius: 2, background: tone }} />
  </div>;
}

function Paper({ L, v, children, style }: { L: Layouts; v: View; children?: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: "absolute", left: PAPER.x, top: PAPER.y, width: PAPER.w, height: PAPER.h, borderRadius: 6, background: k.paper, boxShadow: shadow.paper, overflow: "hidden", ...style }}>
    <Decorations L={L} v={v} />
    {children}
  </div>;
}

/** 投递镜头里的简历缩略图，与简历镜头缩小后的最终画面逐像素一致。 */
export function ResumeThumb({ style }: { style?: CSSProperties }) {
  const L = useResumeLayouts();
  if (!L) return null;
  return <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${THUMB.x - PAPER.x * THUMB_S}px, ${THUMB.y - PAPER.y * THUMB_S}px) scale(${THUMB_S})`, ...style }}>
    <Paper L={L} v={FINAL}><Glyphs L={L} v={FINAL} /></Paper>
  </div>;
}

/* ---------- 镜头 ---------- */

type Cam = { x: number; y: number; s: number };
const CAM0: Cam = { x: 960, y: 560, s: 0.92 };
const toScreen = (c: Cam, p: { x: number; y: number }) => ({ x: 960 + (p.x - c.x) * c.s, y: 540 + (p.y - c.y) * c.s });
const toStage = (c: Cam, p: { x: number; y: number }) => ({ x: c.x + (p.x - 960) / c.s, y: c.y + (p.y - 540) / c.s });
const camStyle = (c: Cam): CSSProperties => ({ transformOrigin: "0 0", transform: `translate(${960 - c.x * c.s}px, ${540 - c.y * c.s}px) scale(${c.s})` });

const CARD = { x: PAPER.x + PAPER.w + 80, w: 430 };
const SUGGEST_Y = 84;
const models = [{ src: deepseek, name: "DeepSeek" }, { src: claude, name: "Claude" }, { src: openai, name: "GPT" }];

export function ResumeScene() {
  const t = useLocalT();
  const L = useResumeLayouts();
  if (!L) return null;

  const jvm = L.sb.items.jvm;
  const jvm2 = L.sb2.items.jvm2;
  const bloom = L.sb.items.bloom;
  const bloomDy = (L.sb2.items.bloom[0].y - bloom[0].y);
  const jvmY = PAPER.y + jvm[0].y;
  const bloomY = PAPER.y + bloom[0].y;
  const cardY = [jvmY - 92, Math.max(jvmY + 120, bloomY - 40)];
  const CAM1: Cam = { x: 1180, y: (jvmY + bloomY) / 2 + 10, s: 1.18 };

  // 镜头：导入全景 → 推近检查 → 缩成缩略图交给投递镜头
  let cam: Cam;
  if (t < RESUME_HAND) {
    const p = prog(t, PUSH_AT, 1.3, easeIO);
    cam = { x: mix(CAM0.x, CAM1.x, p), y: mix(CAM0.y, CAM1.y, p), s: mix(CAM0.s, CAM1.s, p) };
  } else {
    const p = prog(t, RESUME_HAND, THUMB_ARRIVE, easeIO);
    const tl0 = toScreen(CAM1, PAPER);
    const s = Math.exp(mix(Math.log(CAM1.s), Math.log(THUMB_S), p));
    const tl = { x: mix(tl0.x, THUMB.x, p), y: mix(tl0.y, THUMB.y, p) };
    cam = { x: PAPER.x - (tl.x - 960) / s, y: PAPER.y - (tl.y - 540) / s, s };
  }

  // 开场横线落到纸面顶端，再向下扫描
  const move = prog(t, LINE_MOVE, SCAN_AT - LINE_MOVE, easeIO);
  const top = toScreen(CAM0, PAPER);
  const bottom = toScreen(CAM0, { x: PAPER.x + PAPER.w, y: PAPER.y + PAPER.h });
  const scan = prog(t, SCAN_AT, SCAN_DUR, easeIO);
  const lineY = t < SCAN_AT ? mix(560, top.y, move) : mix(top.y, bottom.y, scan);
  const lineX1 = mix(660, top.x, move);
  const lineX2 = mix(1260, bottom.x, move);
  const lineO = 1 - prog(t, SCAN_AT + SCAN_DUR, 0.2);
  const scanPaper = t < SCAN_AT ? 0 : toStage(CAM0, { x: 0, y: lineY }).y - PAPER.y;
  const scanned = t >= SCAN_AT + SCAN_DUR;
  const paperIn = prog(t, 0.6, 0.5);

  const sw = t - TS;
  const typed = clamp01((t - ADOPT_AT - 0.75) / 0.6);
  const g = prog(t, ADOPT_AT + 0.75, 0.5, easeIO);
  const v: View = { sw, g, typed, oldFade: prog(t, ADOPT_AT + 0.65, 0.15) };
  const leave = RESUME_HAND - 0.25;
  const hlJ = prog(t, CHECK_AT, 0.3) * (1 - prog(t, leave, 0.25));
  const hlB = prog(t, CHECK_AT + 0.2, 0.3) * (1 - prog(t, leave, 0.25));
  const adopted = t > ADOPT_AT + 0.75;
  const modelIdx = t < CHECK_AT + 0.5 ? 0 : t < CHECK_AT + 0.85 ? 1 : 2;
  const modelSwitch = [CHECK_AT + 0.1, CHECK_AT + 0.5, CHECK_AT + 0.85][modelIdx];

  // 建议卡里的改写句飞回简历原句
  const sugg = { x: CARD.x + 24, y: cardY[0] + SUGGEST_Y };
  const dest = { x: PAPER.x + jvm[0].x, y: PAPER.y + jvm[0].y };
  const fly = prog(t, ADOPT_AT + 0.15, 0.6, easeIO);
  const flyPts = bezierPts(sugg, { x: sugg.x - 120, y: sugg.y - 140 }, { x: dest.x + 160, y: dest.y - 120 }, dest, 40);
  const flyAt = flyPts[Math.round(fly * 40)];
  const chipO = prog(t, ADOPT_AT, 0.15) * (1 - prog(t, ADOPT_AT + 0.7, 0.15));

  return <AbsoluteFill>
    <AbsoluteFill style={camStyle(cam)}>
      <Paper L={L} v={v} style={{ opacity: paperIn, transform: `translateY(${(1 - paperIn) * 14}px)` }}>
        <Highlight glyphs={jvm} soft={k.orangeSoft} tone={k.orange} o={hlJ * (1 - v.oldFade)} />
        <Highlight glyphs={jvm2.slice(0, Math.floor(jvm2.length * typed))} soft={k.blueSoft} tone={k.blue} o={hlJ * (adopted ? 1 : 0)} />
        <Highlight glyphs={bloom} soft={k.blueSoft} tone={k.blue} o={hlB} dy={bloomDy * g} />
        <div style={{ position: "absolute", inset: 0, clipPath: scanned ? undefined : `inset(0 0 ${Math.max(0, PAPER.h - scanPaper)}px 0)` }}>
          <Glyphs L={L} v={v} />
        </div>
        {!scanned && <div style={{ position: "absolute", inset: 0, clipPath: `inset(${Math.max(0, scanPaper)}px 0 0 0)`, background: "#f7f6f3" }}>
          <div style={{ position: "absolute", inset: 0, filter: "blur(1.6px)", opacity: 0.85 }}><Glyphs L={L} v={{ ...v, mono: "#9ea4ad" }} /></div>
        </div>}
        {typed > 0 && typed < 1 && (() => {
          const last = jvm2[Math.max(0, Math.floor(jvm2.length * typed) - 1)];
          return <div style={{ position: "absolute", left: last.x + last.w + 1, top: last.y + 4, width: 1.5, height: last.st.lh - 8, background: k.ink }} />;
        })()}
      </Paper>

      {/* 检查建议：虚线连到右侧卡片 */}
      <svg width={1920} height={1200} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {[{ y: jvmY + 12, n: 0 }, { y: bloomY + 12 + bloomDy * g, n: 1 }].map(({ y, n }) => {
          const from = { x: PAPER.x + PAPER.w - 26, y };
          const to = { x: CARD.x, y: cardY[n] + 34 };
          const pts = bezierPts(from, { x: from.x + 50, y: from.y }, { x: to.x - 50, y: to.y }, to);
          const p = prog(t, CHECK_AT + 0.3 + n * 0.2, 0.45, easeIO);
          const o = (n === 0 ? 1 - prog(t, ADOPT_AT + 0.75, 0.3) : 1) * (1 - prog(t, leave, 0.25));
          const color = n === 0 ? k.orange : k.blue;
          if (p <= 0 || o <= 0) return null;
          return <g key={n} opacity={o}>
            <path d={toPath(pts.slice(0, Math.max(2, Math.round(pts.length * p))))} stroke={color} strokeWidth={1.4} strokeDasharray="4 5" fill="none" />
            <circle cx={from.x} cy={from.y} r={4} fill={color} />
          </g>;
        })}
      </svg>

      <div style={{ position: "absolute", left: CARD.x, top: cardY[0] - 50, display: "flex", alignItems: "center", gap: 10, fontFamily: font.sans, fontSize: 15, color: k.mute, ...pop(t, CHECK_AT + 0.1, { out: leave, origin: "0 50%" }) }}>
        {tr("AI 检查")}
        <span key={modelIdx} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, boxShadow: `inset 0 0 0 1px ${k.border}`, background: k.paper, color: k.ink, ...pop(t, modelSwitch, { from: 0.85, dy: 0 }) }}>
          <Img src={models[modelIdx].src} style={{ width: 16, height: 16 }} />{models[modelIdx].name}
        </span>
      </div>
      <SuggestionCard y={cardY[0]} style={pop(t, CHECK_AT + 0.6, { out: leave, dx: -30, dy: 0, origin: "0 30px" })} tone={k.orange} title={tr("调优缺少前后数据")} tag={tr("缺信息")} desc={tr("补充 Full GC 频率、停顿时间的变化，结果更可信")}>
        <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, background: k.blueSoft, fontSize: 14, lineHeight: "21px", color: k.ink, opacity: t > ADOPT_AT ? 0.4 : 1 }}><div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{JVM_NEW.replace(/^3\. /, "")}</div></div>
        <div style={{ marginTop: 10, height: 22, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, color: k.subtle }}>
          {tr("建议改写")}
          {adopted && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: k.blue, fontSize: 14, ...pop(t, ADOPT_AT + 0.75, { from: 0.8, dy: 0, origin: "100% 50%" }) }}><CheckDraw p={prog(t, ADOPT_AT + 0.8, 0.3)} size={15} />{tr("已采用")}</span>}
        </div>
      </SuggestionCard>
      <SuggestionCard y={cardY[1]} style={pop(t, CHECK_AT + 0.8, { out: leave, dx: -30, dy: 0, origin: "0 30px" })} tone={k.blue} title={tr("长句层次可更清晰")} tag={tr("表达")} desc={tr("拆开方案与结果，先写做法，再写收益")} />

      {chipO > 0 && <div style={{ position: "absolute", left: flyAt.x, top: flyAt.y, width: mix(382, 420, fly), boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, background: k.blueSoft, boxShadow: shadow.lift, fontFamily: font.sans, fontSize: 14, lineHeight: "21px", color: k.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: chipO, transform: `scale(${mix(1.04, 1, fly)})` }}>{JVM_NEW.replace(/^3\. /, "")}</div>}
    </AbsoluteFill>

    {lineO > 0 && <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: lineO }}>
      {t >= SCAN_AT && <rect x={lineX1} y={lineY - 60} width={lineX2 - lineX1} height={60} fill="url(#scanGlow)" />}
      <defs><linearGradient id="scanGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={k.blue} stopOpacity={0} /><stop offset="1" stopColor={k.blue} stopOpacity={0.1} /></linearGradient></defs>
      <line x1={lineX1} y1={lineY} x2={lineX2} y2={lineY} stroke={mixColor(k.ink, k.blue, move)} strokeWidth={mix(2, 1.5, move)} strokeLinecap="round" />
    </svg>}

    <CaptionScrim opacity={1 - prog(t, RESUME_HAND, 0.4)} />
    <Caption text={tr("导入旧简历，秒变可编辑")} t={t} at={0.6} out={2.45} />
    <Caption text={tr("换个模板，排版自动重排")} t={t} at={2.75} out={4.95} />
    <Caption text={tr("逐句检查，对着岗位改到位")} t={t} at={5.45} out={8.35} />
  </AbsoluteFill>;
}

function SuggestionCard({ y, style, tone, title, tag, desc, children }: { y: number; style: CSSProperties; tone: string; title: string; tag: string; desc: string; children?: ReactNode }) {
  if (style.opacity === 0) return null;
  return <div style={{ position: "absolute", left: CARD.x, top: y, width: CARD.w, boxSizing: "border-box", padding: "18px 24px 18px 26px", borderRadius: 12, background: k.paper, boxShadow: shadow.card, fontFamily: font.sans, overflow: "hidden", ...style }}>
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone }} />
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 24 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone }} />
      <span style={{ fontSize: 17, fontWeight: 600, color: k.ink, flex: 1 }}>{title}</span>
      <span style={{ fontSize: 13, color: k.mute }}>{tag}</span>
    </div>
    <div style={{ marginTop: 8, fontSize: 14, lineHeight: "20px", color: k.mute }}>{desc}</div>
    {children}
  </div>;
}
