import { Mic } from "lucide-react";
import type { CSSProperties } from "react";
import { AbsoluteFill } from "remotion";
import { clamp01, mix } from "../app/anim";
import { font } from "../app/theme";
import { EVENT } from "./apply";
import { Caption, Mask, bump, easeExit, easeIO, k, mixColor, pop, prog, shadow, useLocalT } from "./fx";
import { LOCALE, tr } from "./copy";

const TRANSCRIPT: [string, string][] = [
  [tr("面试官"), tr("线上 Full GC 频繁，你会怎么排查？")],
  [tr("我"), tr("先看 GC 日志确认频率，再用 jmap 导出堆，分析大对象……")],
  [tr("面试官"), tr("调优前后的数据有对比吗？")],
  [tr("我"), tr("嗯……当时没有特别记录。")],
];
const QUESTIONS: { q: string; status: string; note: string; weak: boolean }[] = [
  { q: tr("Q1 订单服务拆分"), status: tr("回答扎实"), note: tr("拆分边界与数据一致性讲得清楚"), weak: false },
  { q: tr("Q2 Full GC 排查"), status: tr("缺少数据支撑"), note: tr("步骤完整，但没有调优前后的对比"), weak: true },
  { q: tr("Q3 Redis 与 MySQL 一致性"), status: tr("思路清晰"), note: tr("能说明延迟双删的取舍"), weak: false },
];
const ANSWER = tr("我们的堆在 8G 左右，G1 的停顿已经可控；当时的 JDK 版本也还不支持生产可用的 ZGC……");
const METRICS: [string, string][] = [["186", tr("语速 · 字/分")], ["2", tr("长停顿 · 次")], ["3%", tr("口头禅占比")]];

const PANEL = { x: 200, y: 190, w: 700, h: 600 };
const REVIEW = { x: 980, y: 190, w: 740 };
const ROW = { x: REVIEW.x + 44, top: 418, h: 88, w: REVIEW.w - 88 };
/** Q2 浮起后停在模拟面试题目上方，成为追问来源。 */
const PILL = { w: 520, h: 48, y: 210 };
const LIFT_AT = 3.1;
const MOCK_AT = 3.75;
/** 能力图谱镜头开始接手的时间。 */
export const INTERVIEW_HAND = 6.2;
export const INTERVIEW_SECONDS = 6.6;

export function InterviewScene() {
  const t = useLocalT();
  // 一面日程块放大成录音面板
  const grow = prog(t, 0, 0.85, easeIO);
  const r = { x: mix(EVENT.x, PANEL.x, grow), y: mix(EVENT.y, PANEL.y, grow), w: mix(EVENT.w, PANEL.w, grow), h: mix(EVENT.h, PANEL.h, grow) };
  const aOut = prog(t, LIFT_AT + 0.15, 0.4, easeIO);
  const played = clamp01(t / 2.8) * 0.7;
  const score = Math.round(76 * prog(t, 1.3, 0.8, easeIO));
  const answering = clamp01((t - 4.45) / 1.0);
  const talking = t > 4.35 && t < 5.5 ? 1 : 0.15;
  // 图谱碎片出现前基本淡完，避免两层画面叠在一起
  const dissolve = prog(t, INTERVIEW_HAND - 0.3, 0.35, easeExit);

  // Q2 先浮起，再飞到画面上方
  const lift = prog(t, LIFT_AT, 0.3);
  const go = prog(t, LIFT_AT + 0.25, 0.65, easeIO);
  const q2 = { x: mix(ROW.x - 16, 960 - PILL.w / 2, go), y: mix(ROW.top + ROW.h, PILL.y, go), w: mix(ROW.w + 32, PILL.w, go), h: mix(ROW.h, PILL.h, go) };

  return <AbsoluteFill style={{ opacity: 1 - dissolve, transform: `scale(${mix(1, 0.97, dissolve)})`, fontFamily: font.sans }}>
    {aOut < 1 && <div style={{ position: "absolute", inset: 0, opacity: 1 - aOut, transform: `translateX(${aOut * -40}px)` }}>
      <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, boxSizing: "border-box", borderRadius: mix(8, 14, grow), background: mixColor(k.blueSoft, k.paper, grow), boxShadow: grow > 0.05 ? shadow.paper : undefined, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: k.blue, opacity: 1 - grow }} />
        <div style={{ position: "absolute", left: 13, top: 8, opacity: 1 - prog(t, 0.15, 0.3), whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: k.ink }}>{tr("一面 · 星河科技")}</div><div style={{ fontSize: 12.5, color: k.text, marginTop: 2 }}>14:00 – 15:00</div>
        </div>
        <div style={{ position: "absolute", left: 0, top: 0, width: PANEL.w, padding: "34px 40px", boxSizing: "border-box", opacity: prog(t, 0.4, 0.4) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, color: k.text }}><Mic size={17} strokeWidth={1.8} />{tr("一面录音 · 星河科技")}<span style={{ marginLeft: "auto", color: k.mute, fontVariantNumeric: "tabular-nums" }}>42:18</span></div>
          <div style={{ marginTop: 22, height: 44, display: "flex", alignItems: "center", gap: 3.2 }}>
            {Array.from({ length: 96 }, (_, i) => <span key={i} style={{ width: 2.6, height: 6 + Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.37)) * 36, borderRadius: 2, background: i / 96 < played ? k.ink : "#d9d3c9" }} />)}
          </div>
          <div style={{ marginTop: 18, height: 1, background: k.hair }} />
          {TRANSCRIPT.map(([who, text], i) => <div key={i} style={{ marginTop: 22, display: "flex", gap: 18, fontSize: 18, lineHeight: "28px", ...pop(t, 0.8 + i * 0.28, { soft: true, from: 0.97, origin: "0 50%" }) }}>
            <span style={{ width: LOCALE === "en" ? 92 : 56, flexShrink: 0, fontSize: 14, color: k.mute, paddingTop: 2 }}>{who}</span>
            <span style={{ color: who === tr("我") ? k.ink : k.text }}>{text}</span>
          </div>)}
        </div>
      </div>

      <div style={{ position: "absolute", left: REVIEW.x, top: REVIEW.y, width: REVIEW.w, height: 600, boxSizing: "border-box", padding: "34px 44px", ...pop(t, 0.9, { dx: 30, dy: 0, from: 0.96, origin: "0 30%" }) }}>
        <div style={{ fontFamily: font.serif, fontSize: 32, fontWeight: 600, color: k.ink }}>{tr("AI 复盘")}</div>
        <div style={{ marginTop: 26, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 15, color: k.mute }}>{tr("结果判断")}</div><div style={{ marginTop: 6, fontFamily: font.serif, fontSize: 30, fontWeight: 600, color: k.ink }}>{tr("倾向通过")}</div></div>
          <div style={{ fontSize: 76, lineHeight: "76px", fontWeight: 500, color: k.ink, fontVariantNumeric: "tabular-nums", transformOrigin: "100% 100%", transform: `scale(${bump(t, 2.1, 0.08)})` }}>{score}<span style={{ fontSize: 20, color: k.mute, marginLeft: 6 }}>/ 100</span></div>
        </div>
        <div style={{ marginTop: 26, height: 1, background: k.hair }} />
      </div>
      {QUESTIONS.map((q, j) => {
        if (j === 1) return null;
        const tone = q.weak ? k.orange : k.blue;
        return <QuestionRow key={q.q} q={q} tone={tone} style={{ position: "absolute", left: ROW.x, top: ROW.top + j * ROW.h, width: ROW.w, ...pop(t, 1.4 + j * 0.12, { soft: true, dy: 12, from: 0.97 }) }} />;
      })}
    </div>}

    {/* Q2：复盘里的薄弱题浮起，成为模拟面试的追问来源 */}
    <div style={{ position: "absolute", left: q2.x, top: q2.y, width: q2.w, height: q2.h, boxSizing: "border-box", padding: go > 0.5 ? "0 22px" : "0 16px", borderRadius: mix(10, 999, go), background: lift > 0 ? k.paper : undefined, boxShadow: lift > 0 ? (go < 1 ? shadow.lift : shadow.card) : undefined, transform: `scale(${1 + 0.03 * lift * (1 - go)})`, ...(t < LIFT_AT ? pop(t, 1.52, { soft: true, dy: 12, from: 0.97 }) : {}), display: "flex", alignItems: "center", justifyContent: go > 0.5 ? "center" : undefined, overflow: "hidden" }}>
      {go < 0.5
        ? <QuestionRow q={QUESTIONS[1]} tone={k.orange} style={{ width: ROW.w, opacity: 1 - prog(t, LIFT_AT + 0.35, 0.2) }} />
        : <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17, color: k.ink, whiteSpace: "nowrap", opacity: prog(t, LIFT_AT + 0.55, 0.25) }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: k.orange }} />{tr("来自一面复盘 · Full GC 排查")}<span style={{ color: k.orange }}>{tr("缺少数据支撑")}</span>
        </div>}
    </div>

    {t > MOCK_AT - 0.2 && <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 160, textAlign: "center", fontSize: 15, letterSpacing: "0.24em", color: k.mute, opacity: prog(t, MOCK_AT - 0.1, 0.4) }}>{tr("模拟面试 · 技术面 · 针对性追问")}</div>
      <Mask t={t} at={MOCK_AT + 0.1} dur={0.75} style={{ position: "absolute", left: 0, right: 0, top: 278, textAlign: "center" }}>
        <div style={{ fontFamily: font.serif, fontSize: 52, lineHeight: "76px", fontWeight: 600, color: k.ink }}>{tr("为什么选 G1，而不是 ZGC？")}</div>
      </Mask>
      <div style={{ position: "absolute", left: 560, top: 430, width: 800, display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", boxShadow: `inset 0 0 0 1.5px ${talking === 1 ? k.blue : k.border}`, display: "grid", placeItems: "center", background: k.paper, ...pop(t, 4.15, { dy: 0, from: 0.6 }) }}><Mic size={26} color={talking === 1 ? k.blue : k.ink} strokeWidth={1.8} /></div>
        <div style={{ flex: 1, height: 64, display: "flex", alignItems: "center", gap: 4, opacity: prog(t, 4.25, 0.3) }}>
          {Array.from({ length: 64 }, (_, i) => <span key={i} style={{ width: 3, height: 4 + talking * Math.abs(Math.sin(t * 9 + i * 0.6) * Math.cos(t * 3.1 + i * 0.23)) * 50, borderRadius: 2, background: k.ink, opacity: 0.85 }} />)}
        </div>
      </div>
      <div style={{ position: "absolute", left: 560, top: 528, width: 800, fontSize: 21, lineHeight: "34px", color: k.text }}>{Array.from(ANSWER).slice(0, Math.floor(Array.from(ANSWER).length * answering)).join("")}</div>
      <div style={{ position: "absolute", left: 560, top: 640, width: 800, display: "flex" }}>
        {METRICS.map(([n, label], i) => {
          const at = 5.1 + i * 0.12;
          return <div key={label} style={{ flex: 1, paddingLeft: i ? 28 : 0, borderLeft: i ? `1px solid ${k.hair}` : undefined, ...pop(t, at, { soft: true, dy: 14, from: 0.94, origin: "0 100%" }) }}>
            <div style={{ fontSize: 44, lineHeight: "52px", fontWeight: 500, color: k.ink, transformOrigin: "0 100%", transform: `scale(${bump(t, at + 0.15, 0.08)})` }}>{n}</div>
            <div style={{ fontSize: 15, color: k.mute }}>{label}</div>
          </div>;
        })}
      </div>
    </div>}
    <Caption text={tr("真实面试，AI 逐题复盘")} t={t} at={0.5} out={2.95} />
    <Caption text={tr("模拟面试，追问到底")} t={t} at={3.5} out={5.7} />
  </AbsoluteFill>;
}

function QuestionRow({ q, tone, style }: { q: (typeof QUESTIONS)[number]; tone: string; style: CSSProperties }) {
  return <div style={{ boxSizing: "border-box", padding: "18px 0", borderBottom: `1px solid ${k.hair}`, ...style }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 19, fontWeight: 600, color: k.ink }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone }} />{q.q}
      <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 500, color: tone }}>{q.status}</span>
    </div>
    <div style={{ marginTop: 6, marginLeft: 18, fontSize: 15, color: k.mute }}>{q.note}</div>
  </div>;
}
