import { ArrowRight, ArrowUp, Plus } from "lucide-react";
import { Img } from "remotion";
import deepseek from "@web-assets/model-icons/deepseek.svg";
import { c, font } from "../app/theme";
import { fadeUp, useT } from "../app/anim";
import { Lines } from "../app/ui";

const dots = { backgroundColor: "#f6f6f3", backgroundImage: "radial-gradient(#dcdcd6 1px, transparent 1px)", backgroundSize: "14px 14px" };

type HomeCard = { art: "calendar" | "resume" | "board" | "prep"; title: string; sub: string; link: string; badge?: string };

function Art({ kind, badge }: { kind: HomeCard["art"]; badge?: string }) {
  if (kind === "calendar" || kind === "prep") return <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
    <div style={{ width: 62, height: 80, borderRadius: 8, background: "#fff", boxShadow: "0 1px 3px #0000001a", textAlign: "center", overflow: "hidden" }}>
      <div style={{ background: "#fde8e8", color: c.red, fontSize: 10, lineHeight: "18px" }}>十月</div>
      <div style={{ fontSize: 26, fontWeight: 600, lineHeight: "36px" }}>{kind === "prep" ? 14 : 11}</div>
      <div style={{ fontSize: 9, color: c.mute }}>{kind === "prep" ? "周二" : "周日"}</div>
    </div>
    {badge && <span style={{ fontSize: 11, color: kind === "prep" ? c.green : c.orange, background: kind === "prep" ? c.greenSoft : c.orangeSoft, padding: "2px 7px", borderRadius: 5 }}>{badge}</span>}
  </div>;
  if (kind === "resume") return <div style={{ position: "absolute", left: 30, top: 10, width: 76, height: 98, background: "#fff", boxShadow: "0 1px 3px #0000001a", padding: 8 }}>
    <div style={{ width: 30, height: 4, background: c.ink, marginBottom: 6 }} /><Lines widths={[90, 70, 85, 40, 80, 60]} gap={5} h={2.5} />
  </div>;
  return <div style={{ position: "absolute", inset: "10px 10px", display: "flex", gap: 6 }}>
    {[["待投递", "#6f737a"], ["笔试", c.orange], ["面试", c.blue], ["Offer", c.green]].map(([label, color], i) => <div key={label} style={{ flex: 1 }}>
      <div style={{ fontSize: 9, display: "flex", gap: 3, alignItems: "center" }}><span style={{ width: 4, height: 4, borderRadius: 4, background: color }} />{label}</div>
      {Array.from({ length: [1, 2, 3, 1][i] }).map((_, j) => <div key={j} style={{ height: 13, marginTop: 5, borderRadius: 3, background: "#fff", boxShadow: "0 0 0 1px #e8e8e4" }} />)}
    </div>)}
  </div>;
}

/** 首页：问候、输入框、快捷指令与三张任务卡。variant=after 为二面当天的状态。 */
export function HomePage({ variant = "before" }: { variant?: "before" | "after" }) {
  const t = useT();
  const before = variant === "before";
  const greeting = before ? <>早上好，张三。远航物流的 <b style={{ fontFamily: font.sans }}>Offer</b> 还没回复。</> : <>下午好，张三。今天 14:00 星河科技二面。</>;
  const sub = before ? "对比一下手上的机会，再决定怎么回复。" : "准备清单已经完成，出发前再看一眼复盘。";
  const cards: HomeCard[] = before
    ? [{ art: "calendar", badge: "还有 5 天回复", title: "远航物流 · 还有 5 天回复", sub: "2026年10月11日", link: "查看 Offer" },
      { art: "resume", title: "产品经理 · 张三 · 20%", sub: "待完善：项目经历", link: "继续编辑" },
      { art: "board", title: "8 个岗位进行中", sub: "远航物流 Offer 待回复", link: "岗位看板" }]
    : [{ art: "prep", badge: "准备清单 3/3", title: "星河科技 · 今天 14:00 二面", sub: "上海 · 现场面试", link: "查看准备" },
      { art: "resume", title: "产品经理 · 张三 · 星河科技版", sub: "已按 JD 调整 2 处", link: "继续编辑" },
      { art: "board", title: "8 个岗位进行中", sub: "星河科技进入二面", link: "岗位看板" }];
  return <div style={{ position: "absolute", left: 240, top: 0, width: 720, height: 876 }}>
    <h1 style={{ position: "absolute", top: 232, width: "100%", textAlign: "center", margin: 0, fontFamily: font.serif, fontSize: 29, fontWeight: 500, ...fadeUp(t, 0.1) }}>{greeting}</h1>
    <p style={{ position: "absolute", top: 286, width: "100%", textAlign: "center", margin: 0, fontSize: 14, color: c.mute, ...fadeUp(t, 0.2) }}>{sub}</p>
    <div style={{ position: "absolute", top: 340, width: 720, height: 118, borderRadius: 18, boxShadow: `inset 0 0 0 1px ${c.line2}, 0 2px 8px #0000000a`, ...fadeUp(t, 0.3) }}>
      <p style={{ position: "absolute", left: 22, top: 20, margin: 0, fontSize: 14.5, color: c.faint }}>问问 LinkResume：改简历、分析 JD、准备面试…</p>
      <span style={{ position: "absolute", left: 16, bottom: 14, width: 30, height: 30, borderRadius: "50%", boxShadow: `inset 0 0 0 1px ${c.line2}`, display: "grid", placeItems: "center" }}><Plus size={14} /></span>
      <span style={{ position: "absolute", left: 56, bottom: 17, height: 24, padding: "0 8px", borderRadius: 6, background: c.soft, fontSize: 12, display: "flex", alignItems: "center" }}>简历 · 产品经理 · 张三</span>
      <span style={{ position: "absolute", right: 64, bottom: 20, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}><Img src={deepseek} style={{ width: 16, height: 16 }} />DeepSeek V4</span>
      <span style={{ position: "absolute", right: 14, bottom: 12, width: 36, height: 36, borderRadius: "50%", background: "#c7c7c3", color: "#fff", display: "grid", placeItems: "center" }}><ArrowUp size={16} /></span>
    </div>
    <div style={{ position: "absolute", top: 484, width: "100%", display: "flex", justifyContent: "center", gap: 10, ...fadeUp(t, 0.4) }}>
      {(before ? ["比较手上的 Offer", "帮我写回复邮件", "谈薪建议"] : ["模拟一轮业务面", "回顾一面复盘", "出发前提醒"]).map((s) => <span key={s} style={{ fontSize: 12.5, padding: "4px 9px", borderRadius: 6, background: c.soft, color: c.text }}>{s}</span>)}
    </div>
    {cards.map((card, i) => <div key={card.title} style={{ position: "absolute", top: 540, left: i * 246, width: 226, height: 236, borderRadius: 14, boxShadow: `0 0 0 1px ${c.line}`, background: "#fff", ...fadeUp(t, 0.5 + i * 0.1, 16) }}>
      <div style={{ position: "absolute", left: 8, top: 8, right: 8, height: 112, borderRadius: 10, overflow: "hidden", ...dots }}><Art kind={card.art} badge={card.badge} /></div>
      <p style={{ position: "absolute", left: 20, top: 138, margin: 0, fontSize: 15, fontWeight: 600 }}>{card.title}</p>
      <p style={{ position: "absolute", left: 20, top: 166, margin: 0, fontSize: 12.5, color: c.mute }}>{card.sub}</p>
      <p style={{ position: "absolute", left: 20, top: 192, margin: 0, fontSize: 13.5, display: "flex", alignItems: "center", gap: 4 }}>{card.link}<ArrowRight size={12} /></p>
    </div>)}
  </div>;
}
