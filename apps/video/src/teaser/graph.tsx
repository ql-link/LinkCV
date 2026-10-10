import { AbsoluteFill } from "remotion";
import { clamp01, mix } from "../app/anim";
import { font } from "../app/theme";
import { Caption, CaptionScrim, CheckDraw, LOCKUP, Lockup, Thread, bump, ease, easeIO, k, pop, prog, rnd, shadow, springAt, useLocalT } from "./fx";
import { tr } from "./copy";

/* 能力图谱：3D 星图，手写透视投影。节点是技术栈，颜色表示掌握程度。 */

type Node = { name: string; p: [number, number, number]; m: number };
const NODES: Node[] = [
  { name: "Java", p: [-160, -10, 0], m: 0.72 },
  { name: "JVM", p: [-300, -90, 110], m: 0.42 },
  { name: "GC", p: [-420, -170, 40], m: 0.38 },
  { name: tr("内存模型"), p: [-370, 30, 210], m: 0.62 },
  { name: tr("类加载"), p: [-240, -220, 230], m: 0.6 },
  { name: tr("并发编程"), p: [-120, 150, -60], m: 0.66 },
  { name: tr("线程池"), p: [-230, 260, -140], m: 0.7 },
  { name: tr("锁与 AQS"), p: [-10, 260, -200], m: 0.58 },
  { name: "Spring Boot", p: [60, -150, -40], m: 0.86 },
  { name: "MyBatis", p: [170, -260, 40], m: 0.8 },
  { name: "MySQL", p: [290, -170, 140], m: 0.83 },
  { name: tr("索引"), p: [410, -260, 80], m: 0.86 },
  { name: tr("事务"), p: [370, -70, 240], m: 0.7 },
  { name: "Redis", p: [230, 120, 20], m: 0.88 },
  { name: tr("缓存一致性"), p: [350, 40, 160], m: 0.78 },
  { name: tr("分布式锁"), p: [120, 250, -60], m: 0.68 },
  { name: "Kafka", p: [150, 60, -260], m: 0.64 },
  { name: tr("消息可靠性"), p: [270, 120, -370], m: 0.45 },
  { name: tr("微服务"), p: [-20, -40, -270], m: 0.7 },
  { name: tr("服务拆分"), p: [-150, -150, -340], m: 0.84 },
  { name: tr("限流熔断"), p: [-70, 100, -410], m: 0.44 },
  { name: tr("系统设计"), p: [60, -230, -270], m: 0.62 },
  { name: tr("秒杀架构"), p: [340, 240, -180], m: 0.83 },
  { name: "TCP/IP", p: [-430, 190, -40], m: 0.6 },
  { name: "Linux", p: [-470, 60, -210], m: 0.66 },
  { name: tr("算法"), p: [460, -20, -150], m: 0.7 },
];
const I = Object.fromEntries(NODES.map((n, i) => [n.name, i])) as Record<string, number>;
const EDGES: [string, string][] = [
  ["Java", "JVM"], ["JVM", "GC"], ["JVM", tr("内存模型")], ["JVM", tr("类加载")], ["Java", tr("并发编程")], [tr("内存模型"), tr("并发编程")], [tr("并发编程"), tr("线程池")], [tr("并发编程"), tr("锁与 AQS")],
  [tr("锁与 AQS"), tr("分布式锁")], ["Java", "Spring Boot"], ["Spring Boot", "MyBatis"], ["MyBatis", "MySQL"], ["MySQL", tr("索引")], ["MySQL", tr("事务")], ["Redis", tr("缓存一致性")],
  [tr("缓存一致性"), "MySQL"], ["Redis", tr("分布式锁")], ["Kafka", tr("消息可靠性")], [tr("微服务"), tr("服务拆分")], [tr("微服务"), tr("限流熔断")], [tr("微服务"), "Kafka"], [tr("系统设计"), tr("秒杀架构")],
  [tr("秒杀架构"), "Redis"], [tr("秒杀架构"), "Kafka"], [tr("系统设计"), tr("微服务")], ["Spring Boot", tr("微服务")], ["TCP/IP", "Linux"], ["Linux", "GC"], ["TCP/IP", tr("微服务")], [tr("算法"), tr("索引")], [tr("事务"), tr("缓存一致性")],
];
const JVM = I.JVM;
const NEIGHBORS = new Set(EDGES.flatMap(([a, b]) => (a === "JVM" ? [b] : b === "JVM" ? [a] : [])).map((n) => I[n]));
const DUST = Array.from({ length: 150 }, (_, i) => {
  const u = rnd(`du${i}`, -1, 1);
  const a = rnd(`da${i}`, 0, Math.PI * 2);
  const r = rnd(`dr${i}`, 380, 760);
  const s = Math.sqrt(1 - u * u);
  return { p: [Math.cos(a) * s * r, u * r * 0.7, Math.sin(a) * s * r] as [number, number, number], size: rnd(`ds${i}`, 1.2, 2.8) };
});
/** 碎片落在模拟面试画面原有内容的位置上：面试镜头散开时，原位凝成小片再飞入图谱。 */
const FRAGMENTS: { text: string; x: number; y: number; to: string; weak?: boolean }[] = [
  { text: tr("Full GC 排查 · 缺少数据"), x: 960, y: 234, to: "GC", weak: true },
  { text: tr("G1 与 ZGC 的取舍"), x: 960, y: 316, to: "JVM", weak: true },
  { text: tr("JVM 调优经验 · 简历未体现"), x: 760, y: 462, to: "JVM", weak: true },
  { text: tr("Redis + Lua 库存预扣"), x: 1180, y: 462, to: "Redis" },
  { text: tr("Kafka 日志异步落库"), x: 720, y: 560, to: "Kafka" },
  { text: tr("MySQL 一致性 · 思路清晰"), x: 1200, y: 560, to: tr("缓存一致性") },
  { text: tr("订单服务拆分 · 回答扎实"), x: 760, y: 672, to: tr("服务拆分") },
  { text: tr("秒杀系统 · 1 万并发"), x: 1160, y: 672, to: tr("秒杀架构") },
];
const F = 1100;
const CENTER = { x: 960, y: 470 };
const FOCUS_AT = 5.3;
const PRACTICE_AT = 8.1;
const LIFT_AT = 9.4;
const OUTRO_AT = 10.9;
const YAW_FOCUS = Math.atan2(300, 110) + Math.PI;

function freeYaw(t: number) {
  return -0.4 + 0.22 * t + 1.7 * easeIO(clamp01((t - 3.0) / 2.2));
}

export function GraphScene() {
  const t = useLocalT();
  const focus = prog(t, FOCUS_AT, 1.7, easeIO);
  const outro = prog(t, OUTRO_AT, 1.9, easeIO);
  const f = focus * (1 - outro);
  const yawTarget = YAW_FOCUS + 2 * Math.PI * Math.round((freeYaw(FOCUS_AT) - YAW_FOCUS) / (2 * Math.PI)) + 0.035 * (t - FOCUS_AT);
  const yaw = mix(freeYaw(t), yawTarget, f);
  const pitch = mix(0.28 + Math.sin(t * 0.45) * 0.1, 0.12, f);
  const zoom = mix(0.72, 1, prog(t, 0.9, 3.2, ease)) * mix(1, 1.5, f) * mix(1, 0.62, outro);
  const color = prog(t, 3.4, 0.9);
  const dim = prog(t, FOCUS_AT + 0.6, 0.6) * (1 - outro);
  const gather = prog(t, 0.4, 2.2, ease);

  const mastery = (i: number) => {
    if (i === JVM) return mix(0.42, 0.78, prog(t, LIFT_AT, 0.9, easeIO));
    if (i === I.GC) return mix(NODES[i].m, 0.6, prog(t, LIFT_AT + 0.9, 0.5));
    return NODES[i].m;
  };
  const tone = (m: number) => (m >= 0.75 ? k.blue : m < 0.5 ? k.orange : k.subtle);

  const project = (p: [number, number, number], spread = 1) => {
    const [x0, y0, z0] = [p[0] * spread, p[1] * spread, p[2]];
    const x1 = x0 * Math.cos(yaw) + z0 * Math.sin(yaw);
    const z1 = -x0 * Math.sin(yaw) + z0 * Math.cos(yaw);
    const y2 = y0 * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = y0 * Math.sin(pitch) + z1 * Math.cos(pitch);
    const s = F / (F + z2);
    return { x: x1 * s * zoom, y: y2 * s * zoom, z: z2, s };
  };
  const raw = NODES.map((n) => project(n.p));
  const jvmRaw = raw[JVM];
  const offset = { x: f * (680 - CENTER.x - jvmRaw.x), y: f * (480 - CENTER.y - jvmRaw.y) };
  const at = (r: { x: number; y: number }) => ({ x: CENTER.x + r.x + offset.x, y: CENTER.y + r.y + offset.y });
  const depth = (z: number) => mix(1, 0.32, clamp01((z + 450) / 900));
  // 拉远时先退成背景，落版出现时彻底淡出
  const graphOpacity = mix(1, 0.2, outro) * (1 - prog(t, OUTRO_AT + 0.8, 1.0, easeIO));

  const nodeIn = NODES.map((_, i) => {
    const fragHit = FRAGMENTS.findIndex((fr) => I[fr.to] === i);
    const start = fragHit >= 0 ? 1.3 + fragHit * 0.07 : 1.35 + ((i * 7) % 26) * 0.05;
    return prog(t, start, 0.6);
  });
  const pulseT = clamp01((t - LIFT_AT - 0.5) / 0.8);
  const cardStyle = pop(t, FOCUS_AT + 1.0, { out: OUTRO_AT - 0.2, dx: -50, dy: 0, from: 0.86, origin: "0 40%" });
  const practice = prog(t, PRACTICE_AT, 0.3);
  const jm = mastery(JVM);
  const lineP = prog(t, OUTRO_AT + 0.6, 0.8, easeIO);

  return <AbsoluteFill>
    <AbsoluteFill style={{ opacity: graphOpacity, isolation: "isolate" }}>
      {/* 星尘 */}
      {DUST.map((d, i) => {
        const r = project(d.p, mix(2.6, 1, gather));
        const p = at(r);
        const o = depth(r.z) * 0.5 * prog(t, 0.1 + (i % 20) * 0.03, 0.8) * (1 - dim * 0.6);
        return <div key={i} style={{ position: "absolute", left: p.x - d.size / 2, top: p.y - d.size / 2, width: d.size * r.s, height: d.size * r.s, borderRadius: "50%", background: k.ink, opacity: o }} />;
      })}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {EDGES.map(([a, b], j) => {
          const ia = I[a];
          const ib = I[b];
          const pa = at(raw[ia]);
          const pb = at(raw[ib]);
          const draw = prog(t, 1.8 + j * 0.04, 0.7, easeIO);
          if (draw <= 0) return null;
          const hot = (ia === JVM || ib === JVM) && f > 0;
          const o = mix(depth((raw[ia].z + raw[ib].z) / 2) * 0.9, hot ? 1 : 0.12, dim);
          return <line key={j} x1={pa.x} y1={pa.y} x2={mix(pa.x, pb.x, draw)} y2={mix(pa.y, pb.y, draw)} stroke={hot ? mix(0, 1, dim) > 0.5 ? k.ink : "#bdb5a8" : "#bdb5a8"} strokeWidth={hot ? mix(1.2, 2, dim) : 1.2} opacity={o} />;
        })}
        {/* 补强后沿连线扩散 */}
        {pulseT > 0 && pulseT < 1 && EDGES.filter(([a, b]) => a === "JVM" || b === "JVM").map(([a, b], j) => {
          const other = a === "JVM" ? I[b] : I[a];
          const pa = at(raw[JVM]);
          const pb = at(raw[other]);
          const q = easeIO(pulseT);
          return <circle key={j} cx={mix(pa.x, pb.x, q)} cy={mix(pa.y, pb.y, q)} r={5} fill={k.blue} opacity={1 - pulseT * 0.6} />;
        })}
      </svg>
      {NODES.map((n, i) => {
        const r = raw[i];
        const p = at(r);
        const a = nodeIn[i];
        if (a <= 0) return null;
        const m = mastery(i);
        const c = color > 0 ? tone(m) : k.ink;
        const isFocusSet = i === JVM || NEIGHBORS.has(i);
        const o = depth(r.z) * a * mix(1, isFocusSet ? 1 : 0.14, dim);
        const size = mix(7, m >= 0.75 || m < 0.5 ? 13 : 8, color) * Math.sqrt(r.s * zoom) * (i === JVM ? mix(1, 1.35, f) : 1);
        const ring = m < 0.5 && color > 0 ? (t * 0.9 + i * 0.13) % 1 : -1;
        const label = Math.max(13, Math.min(30, 17 * r.s * Math.sqrt(zoom))) * (i === JVM ? mix(1, 1.3, f) : 1);
        return <div key={n.name} style={{ position: "absolute", left: p.x, top: p.y, opacity: o, zIndex: Math.round(1000 - r.z) }}>
          {ring >= 0 && <div style={{ position: "absolute", left: -size * (1 + ring * 1.4), top: -size * (1 + ring * 1.4), width: size * 2 * (1 + ring * 1.4), height: size * 2 * (1 + ring * 1.4), borderRadius: "50%", border: `1.5px solid ${k.orange}`, opacity: (1 - ring) * color, boxSizing: "border-box" }} />}
          <div style={{ position: "absolute", left: -size, top: -size, width: size * 2, height: size * 2, borderRadius: "50%", background: c, transform: `scale(${mix(0.2, 1, a)})`, boxShadow: color > 0 && c !== k.subtle ? `0 0 0 ${size * 0.45}px ${c}22` : undefined }} />
          <div style={{ position: "absolute", left: size + 8, top: -label * 0.7, fontFamily: font.sans, fontSize: label, lineHeight: `${label * 1.4}px`, whiteSpace: "nowrap", color: c === k.subtle ? k.text : k.ink, fontWeight: c === k.subtle ? 400 : 600 }}>{n.name}</div>
        </div>;
      })}
      {/* 汇聚：前面镜头里的记录化成光点飞入图谱 */}
      {FRAGMENTS.map((fr, i) => {
        const start = 0.55 + i * 0.07;
        const collapse = prog(t, start, 0.4);
        const v = springAt(t, i * 0.04);
        const flyLin = clamp01((t - start - 0.2) / 0.8);
        const target = at(raw[I[fr.to]]);
        const q = easeIO(flyLin);
        const px = mix(fr.x, target.x, q);
        const py = mix(fr.y, target.y, q) - Math.sin(Math.PI * q) * 60;
        return <div key={fr.text}>
          {collapse < 1 && <div style={{ position: "absolute", left: fr.x, top: fr.y, transform: `translate(-50%, -50%) scale(${mix(0.8, 1, v) * mix(1, 0.3, collapse)})`, opacity: (1 - collapse) * prog(t, i * 0.04, 0.2), whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 16px", borderRadius: 999, background: k.paper, boxShadow: shadow.card, fontFamily: font.sans, fontSize: 16, color: k.text }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: fr.weak ? k.orange : k.blue }} />{fr.text}
          </div>}
          {flyLin > 0 && flyLin < 1 && <div style={{ position: "absolute", left: px - 4, top: py - 4, width: 8, height: 8, borderRadius: "50%", background: fr.weak ? k.orange : k.blue, boxShadow: `0 0 12px ${fr.weak ? k.orange : k.blue}` }} />}
        </div>;
      })}
    </AbsoluteFill>

    {/* 图例与统计 */}
    <div style={{ position: "absolute", left: 120, top: 110, display: "flex", gap: 26, fontFamily: font.sans, fontSize: 16, color: k.text, opacity: color * (1 - outro) * (1 - dim) }}>
      {[[k.blue, tr("掌握扎实")], [k.subtle, tr("一般")], [k.orange, tr("有待加强")]].map(([c, l]) => <span key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />{l}</span>)}
    </div>
    <div style={{ position: "absolute", right: 120, top: 110, fontFamily: font.sans, fontSize: 16, color: k.mute, opacity: prog(t, 2.8, 0.6) * (1 - prog(t, FOCUS_AT, 0.5)), letterSpacing: "0.06em" }}>{tr("26 个技能节点 · 来自 3 份简历、5 场面试与 7 次模拟")}</div>

    {/* JVM 证据卡与专项练习 */}
    {cardStyle.opacity !== 0 && <div style={{ position: "absolute", left: 1110, top: 250, width: 580, boxSizing: "border-box", padding: "34px 40px", borderRadius: 16, background: k.paper, boxShadow: shadow.paper, fontFamily: font.sans, ...cardStyle }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontFamily: font.serif, fontSize: 44, fontWeight: 600, color: k.ink }}>JVM</span>
        <span style={{ fontSize: 15, color: jm >= 0.75 ? k.blue : k.orange }}>{jm >= 0.75 ? tr("掌握扎实") : tr("有待加强")}</span>
      </div>
      <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 15, color: k.mute }}>{tr("掌握度")}</span>
        <span style={{ display: "inline-block", fontSize: 32, fontWeight: 500, color: k.ink, fontVariantNumeric: "tabular-nums", transformOrigin: "100% 100%", transform: `scale(${bump(t, LIFT_AT + 0.8, 0.1)})` }}>{Math.round(jm * 100)}%</span>
      </div>
      <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: k.hair }}>
        <div style={{ width: `${jm * 100}%`, height: 4, borderRadius: 2, background: jm >= 0.6 ? k.blue : k.orange }} />
      </div>
      <div style={{ position: "relative", marginTop: 26, height: 250 }}>
        <div style={{ position: "absolute", inset: 0, opacity: 1 - practice }}>
          <div style={{ fontSize: 14, color: k.mute }}>{tr("来自 3 条记录")}</div>
          {[[tr("一面复盘 · 星河科技"), tr("Full GC 排查缺少调优前后数据")], [tr("模拟面试 · 第 3 题"), tr("G1 与 ZGC 的取舍说得不够清楚")], [tr("岗位要求 · 星河科技"), tr("JVM 调优经验在简历中未体现")]].map(([src, text], j) => {
            return <div key={src} style={{ marginTop: 16, ...pop(t, FOCUS_AT + 1.3 + j * 0.12, { soft: true, from: 0.96, origin: "0 50%" }) }}>
              <div style={{ fontSize: 13, color: k.subtle }}>{src}</div>
              <div style={{ marginTop: 3, fontSize: 17, color: k.ink }}>{text}</div>
            </div>;
          })}
        </div>
        {practice > 0 && <div style={{ position: "absolute", inset: 0, opacity: practice }}>
          <div style={{ fontSize: 14, color: k.mute }}>{tr("专项练习 · JVM")}</div>
          {[tr("描述一次 Full GC 排查的完整步骤"), tr("G1 的 Region 设计解决了什么问题"), tr("如何按业务特点选择垃圾回收器")].map((q, j) => {
            const at = PRACTICE_AT + 0.6 + j * 0.32;
            const done = prog(t, at, 0.3);
            return <div key={q} style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, fontSize: 17, color: k.ink, ...pop(t, PRACTICE_AT + 0.15 + j * 0.12, { soft: true, from: 0.96, origin: "0 50%" }) }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", boxShadow: `inset 0 0 0 1.5px ${done > 0 ? k.blue : k.border}`, background: done > 0 ? `rgba(63,111,216,${done})` : undefined, transform: `scale(${bump(t, at, 0.2)})` }}>{done > 0 && <CheckDraw p={prog(t, at + 0.05, 0.25)} size={14} color="#fff" width={3} />}</span>{q}
            </div>;
          })}
        </div>}
      </div>
    </div>}

    <CaptionScrim opacity={1 - outro} />
    <Caption text={tr("每一场面试，都沉淀成你的能力图谱")} t={t} at={0.9} out={4.9} />
    <Caption text={tr("哪里薄弱，一眼看清")} t={t} at={FOCUS_AT + 0.2} out={PRACTICE_AT - 0.1} />
    <Caption text={tr("针对短板，专项补强")} t={t} at={PRACTICE_AT + 0.25} out={OUTRO_AT - 0.1} />

    <Thread pts={[{ x: LOCKUP.x1, y: LOCKUP.y }, { x: LOCKUP.x2, y: LOCKUP.y }]} from={0.5 - lineP / 2} to={0.5 + lineP / 2} width={2} />
    <Lockup t={t} at={OUTRO_AT + 0.95} />
  </AbsoluteFill>;
}
