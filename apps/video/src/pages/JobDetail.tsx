import { Check, ChevronLeft, Mic, Sparkles, Upload } from "lucide-react";
import { c } from "../app/theme";
import { fadeIn, fadeUp, ramp, useT } from "../app/anim";
import { Button, Card, Tag } from "../app/ui";

const transcript: [string, string][] = [
  ["面试官", "介绍一个你最有代表性的项目。"],
  ["张三", "我负责审批配置改版，先从 1,200 多条工单里做归因……"],
  ["面试官", "完成率的提升，怎么确认是改版带来的？"],
  ["张三", "嗯……当时主要看了灰度前后的数据对比……"],
];
const notes = [
  { q: "项目介绍", tone: "green" as const, label: "表现好", text: "背景、动作、结果完整，数据具体。" },
  { q: "效果归因追问", tone: "orange" as const, label: "待改进", text: "没有说明对照组或排除其他因素，论证偏弱。" },
  { q: "为什么选择我们", tone: "green" as const, label: "表现好", text: "结合岗位职责讲清了动机。" },
];

function Waveform({ p }: { p: number }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 2, height: 28 }}>{Array.from({ length: 64 }).map((_, i) => {
    const h = 6 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * 20;
    return <span key={i} style={{ width: 3, height: h, borderRadius: 2, background: i / 64 < p ? c.blue : "#d8dbe2" }} />;
  })}</div>;
}

function Stage({ label, meta, state }: { label: string; meta: string; state: "done" | "current" | "todo" }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
    <span style={{ width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", background: state === "done" ? c.green : "#fff", boxShadow: state === "done" ? "none" : `inset 0 0 0 1.5px ${state === "current" ? c.blue : c.line2}` }}>
      {state === "done" ? <Check size={12} color="#fff" strokeWidth={3} /> : state === "current" ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.blue }} /> : null}
    </span>
    <div><p style={{ margin: 0, fontSize: 13.5, fontWeight: state === "current" ? 600 : 400 }}>{label}</p><p style={{ margin: "2px 0 0", fontSize: 12, color: state === "current" ? c.blue : c.mute }}>{meta}</p></div>
  </div>;
}

/**
 * 岗位详情。variant=review：一面录音转文字、生成 AI 复盘；variant=prep：二面当天的准备清单。
 */
export function JobDetailPage({ variant, at }: { variant: "review" | "prep"; at: number }) {
  const t = useT();
  const review = variant === "review";
  const uploadP = ramp(t, at, 0.8);
  const reviewAt = at + 2.6;
  const ready = ramp(t, reviewAt + 0.9, 0.4);
  const score = Math.round(76 * ramp(t, reviewAt + 1, 0.8));
  const checkAt = at;
  return <>
    <p style={{ position: "absolute", left: 46, top: 32, margin: 0, fontSize: 13, color: c.mute, display: "flex", alignItems: "center", gap: 2 }}><ChevronLeft size={15} />岗位看板</p>
    <div style={{ position: "absolute", left: 50, top: 66, display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ width: 46, height: 46, borderRadius: 12, background: c.ink, color: "#fff", display: "grid", placeItems: "center", fontSize: 18 }}>星</span>
      <div><p style={{ margin: 0, fontSize: 20, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>高级产品经理<Tag>正式</Tag></p><p style={{ margin: "4px 0 0", fontSize: 13, color: c.mute }}>星河科技 · 上海 · 20–30K × 14 薪</p></div>
    </div>
    <div style={{ position: "absolute", right: 50, top: 74, display: "flex", gap: 8 }}><Button>编辑岗位</Button><Button primary>{review ? "推进到下一阶段" : "准备面试"}</Button></div>
    <Card style={{ left: 50, top: 140, width: 1100, height: 72, display: "flex", alignItems: "center", padding: "0 24px", gap: 10 }}>
      <Stage label="投递" meta="10-05 · 产品经理 · 张三" state="done" />
      <Stage label="业务一面" meta={review ? "10-09 10:00 · 已结束" : "10-09 · 复盘 76 分"} state={review ? "current" : "done"} />
      <Stage label="业务二面" meta={review ? "待安排" : "今天 14:00 · 现场"} state={review ? "todo" : "current"} />
      <Stage label="Offer" meta="—" state="todo" />
    </Card>
    {/* 左：一面记录 */}
    <Card style={{ left: 50, top: 232, width: 540, height: 600, padding: 22 }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>业务一面 · 视频面试</p>
      <p style={{ margin: "4px 0 0", fontSize: 12.5, color: c.mute }}>10-09 10:00–10:45 · 面试官：产品总监</p>
      {review && t < at ? <div style={{ marginTop: 18, height: 64, borderRadius: 12, border: `1.5px dashed ${c.line2}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: c.mute }}><Upload size={15} />上传录音或文字稿</div>
        : <div style={{ marginTop: 18, height: 64, borderRadius: 12, background: c.soft, display: "flex", alignItems: "center", gap: 12, padding: "0 14px", ...(review ? fadeIn(t, at, 0.3) : {}) }}>
          <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center" }}><Mic size={15} /></span>
          <div style={{ flex: 1 }}><p style={{ margin: "0 0 4px", fontSize: 12.5 }}>一面录音.m4a <span style={{ color: c.mute }}>· 45:12</span></p><Waveform p={review ? uploadP : 1} /></div>
        </div>}
      <p style={{ margin: "20px 0 8px", fontSize: 13, fontWeight: 600 }}>文字稿</p>
      {transcript.map(([who, text], i) => <div key={i} style={{ display: "flex", gap: 12, padding: "9px 0", borderTop: i ? `1px solid ${c.line}` : "none", fontSize: 13, lineHeight: "21px", ...(review ? fadeUp(t, at + 0.9 + i * 0.3, 6, 0.3) : {}), background: i === 3 && review ? `rgba(217,130,43,${0.1 * ramp(t, reviewAt + 2.2, 0.4)})` : "transparent" }}>
        <span style={{ width: 48, flexShrink: 0, color: who === "张三" ? c.blue : c.mute, fontSize: 12.5 }}>{who}</span><span>{text}</span>
      </div>)}
      {!review && <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: c.orangeSoft, fontSize: 13, lineHeight: "21px" }}><b style={{ color: c.orange }}>一面复盘 · 待改进</b><br />效果归因追问：没有说明对照组或排除其他因素。</div>}
    </Card>
    {/* 右：AI 复盘 或 二面准备清单 */}
    {review ? <Card style={{ left: 610, top: 232, width: 540, height: 600, padding: 22, ...fadeUp(t, reviewAt, 12) }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={15} color={c.blue} />AI 复盘</p>
      {ready < 1 && <div style={{ marginTop: 18, opacity: 1 - ready }}>{[90, 70, 84, 60].map((w, i) => <div key={i} style={{ width: `${w}%`, height: 12, borderRadius: 6, marginTop: 12, background: `linear-gradient(90deg, ${c.soft}, #e6e9f2, ${c.soft})`, backgroundSize: "200% 100%", backgroundPosition: `${(t * 120) % 200}% 0` }} />)}<p style={{ fontSize: 12.5, color: c.mute, marginTop: 14 }}>结合文字稿、简历和岗位要求生成中…</p></div>}
      {ready > 0 && <div style={{ opacity: ready }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 24, marginTop: 18 }}>
          <div><p style={{ margin: 0, fontSize: 12.5, color: c.mute }}>结果判断</p><p style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 600 }}>倾向通过 <span style={{ fontSize: 13, fontWeight: 400, color: c.mute }}>· 把握中等</span></p></div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}><p style={{ margin: 0, fontSize: 12.5, color: c.mute }}>总分</p><p style={{ margin: "2px 0 0", fontSize: 32, fontWeight: 600, lineHeight: "36px" }}>{score}<span style={{ fontSize: 13, color: c.faint, fontWeight: 400 }}> / 100</span></p></div>
        </div>
        <p style={{ margin: "22px 0 4px", fontSize: 13, fontWeight: 600 }}>逐题点评</p>
        {notes.map((n, i) => <div key={n.q} style={{ padding: "12px 14px", marginTop: 8, borderRadius: 10, background: n.tone === "orange" ? `rgba(253,241,228,${ramp(t, reviewAt + 2.2, 0.4)})` : c.soft, boxShadow: n.tone === "orange" ? `inset 0 0 0 ${1.5 * ramp(t, reviewAt + 2.2, 0.4)}px ${c.orange}` : "none", ...fadeUp(t, reviewAt + 1.2 + i * 0.2, 8, 0.35) }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>{n.q}<Tag tone={n.tone}>{n.label}</Tag></p>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, color: c.text, lineHeight: "19px" }}>{n.text}</p>
        </div>)}
        <p style={{ margin: "18px 0 0", fontSize: 12.5, color: c.mute, ...fadeIn(t, reviewAt + 2) }}>下一步：准备一个带对照依据的效果验证案例。</p>
      </div>}
    </Card>
      : <Card style={{ left: 610, top: 232, width: 540, height: 360, padding: 22, ...fadeUp(t, 0.3, 12) }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div><p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>二面准备清单</p><p style={{ margin: "4px 0 0", fontSize: 12.5, color: c.mute }}>今天 14:00 · 现场面试</p></div>
          <span style={{ fontSize: 13, color: c.green, fontWeight: 500 }}>2 / 3</span>
        </div>
        <div style={{ marginTop: 14, height: 5, borderRadius: 5, background: c.soft }}><div style={{ width: "66.7%", height: 5, borderRadius: 5, background: c.green }} /></div>
        {["复习一面复盘里的 2 个追问", "整理审批配置项目的灰度数据", "模拟一轮业务面，练习回应追问"].map((item, i) => {
          const done = i < 2;
          return <p key={item} style={{ margin: "16px 0 0", fontSize: 14, display: "flex", alignItems: "center", gap: 10, color: done ? c.faint : c.ink }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, display: "grid", placeItems: "center", background: done ? c.green : "#fff", boxShadow: done ? "none" : `inset 0 0 0 1.5px ${c.line2}` }}>{done && <Check size={11} color="#fff" strokeWidth={3} />}</span>{item}
          </p>;
        })}
        <span style={{ position: "absolute", left: 22, right: 22, bottom: 22, height: 40, borderRadius: 10, background: c.ink, color: "#fff", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 500, transform: `scale(${1 - Math.max(0, 1 - Math.abs(t - checkAt) / 0.15) * 0.04})` }}>开始模拟面试</span>
      </Card>}
  </>;
}
