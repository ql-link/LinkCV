import { ArrowUp, BriefcaseBusiness, Check, FileText, Folder, Plus, Sparkles } from "lucide-react";
import { Img } from "remotion";
import deepseek from "@web-assets/model-icons/deepseek.svg";
import { c, font } from "../app/theme";
import { fadeIn, fadeUp, ramp, typed, typedDone, useT } from "../app/anim";
import { Button } from "../app/ui";

export const CHAT = {
  prompt: "按星河科技的 JD 改一下我的简历，参考我的项目复盘。",
  reply: "对照星河科技 JD 的「数据驱动」要求，你的项目复盘里有 3 条可量化结果还没写进简历。我准备了 2 处修改，确认后才会写入。",
  oldLine: "负责审批配置功能优化，通过原型测试改进配置流程，提升了用户体验。",
  newLine: "主导审批配置改版：基于 1,200+ 条工单归因出 3 类高频问题，灰度期任务完成率 71% → 86%，平均配置时长缩短 42%。",
};

function Chip({ icon, label, p = 1 }: { icon: React.ReactNode; label: string; p?: number }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px", borderRadius: 6, background: c.soft, fontSize: 12, opacity: p, transform: `scale(${0.85 + 0.15 * p})` }}>{icon}{label}</span>;
}

/**
 * 首页对话改简历：输入并发送 → 读取资料 → AI 回复 → 修改提案 → 采用后右侧简历被改写。
 * 时间点（秒）：typeAt 开始输入，sendAt 发送，applyAt 点击采用。
 */
export function ChatPage({ typeAt, sendAt, applyAt }: { typeAt: number; sendAt: number; applyAt: number }) {
  const t = useT();
  const sent = t >= sendAt;
  const chipsP = ramp(t, typeAt + 1.2, 0.3);
  const readAt = sendAt + 0.5;
  const replyAt = sendAt + 1.2;
  const proposalAt = typedDone(CHAT.reply, replyAt, 26) + 0.3;
  const previewP = ramp(t, readAt, 0.5);
  const applied = ramp(t, applyAt + 0.15, 0.35);
  const sendMove = ramp(t, sendAt, 0.4);
  const chips = <>
    <Chip icon={<FileText size={12} />} label="产品经理 · 张三" />
    <Chip icon={<BriefcaseBusiness size={12} />} label="星河科技 · 高级产品经理" p={sent ? 1 : chipsP} />
    <Chip icon={<Folder size={12} />} label="审批配置项目复盘.md" p={sent ? 1 : ramp(t, typeAt + 1.5, 0.3)} />
  </>;
  return <>
    {/* 对话列 */}
    <div style={{ position: "absolute", left: 60, top: 0, width: 600, height: 876 }}>
      {sent && <div style={{ position: "absolute", right: 0, top: 40, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, opacity: sendMove, transform: `translateY(${(1 - sendMove) * 300}px)` }}>
        <div style={{ display: "flex", gap: 6 }}>{chips}</div>
        <p style={{ margin: 0, maxWidth: 420, padding: "10px 16px", borderRadius: 14, background: c.soft, fontSize: 14, lineHeight: "22px" }}>{CHAT.prompt}</p>
      </div>}
      {t >= readAt && <p style={{ position: "absolute", left: 0, top: 152, margin: 0, fontSize: 12.5, color: c.mute, display: "flex", alignItems: "center", gap: 6, ...fadeIn(t, readAt) }}><Check size={14} color={c.green} />已读取 简历、岗位 JD、项目复盘</p>}
      {t >= replyAt && <p style={{ position: "absolute", left: 0, top: 184, width: 580, margin: 0, fontFamily: font.sans, fontSize: 14.5, lineHeight: "26px", color: c.text }}>{typed(CHAT.reply, t, replyAt, 26)}</p>}
      {/* 修改提案 */}
      <div style={{ position: "absolute", left: 0, top: 280, width: 580, height: 270, borderRadius: 14, background: "#fff", boxShadow: `0 0 0 1px ${c.line2}, 0 6px 18px #17191c0d`, ...fadeUp(t, proposalAt, 14) }}>
        <div style={{ height: 46, display: "flex", alignItems: "center", gap: 8, padding: "0 18px", borderBottom: `1px solid ${c.line}` }}>
          <Sparkles size={15} color={c.blue} /><span style={{ fontSize: 14, fontWeight: 600 }}>修改提案</span>
          <span style={{ fontSize: 12, color: c.mute, background: c.soft, padding: "2px 8px", borderRadius: 999 }}>{applied > 0.5 ? "已采用 1 / 2" : "2 处待确认"}</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: c.mute }}>项目经历 · 审批配置体验优化</span>
        </div>
        <div style={{ padding: "14px 18px" }}>
          <p style={{ margin: 0, fontSize: 12, color: c.mute }}>原文</p>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: "22px", color: c.faint, textDecoration: "line-through" }}>{CHAT.oldLine}</p>
          <p style={{ margin: "12px 0 0", fontSize: 12, color: c.blue }}>修改为</p>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: "22px" }}>主导审批配置改版：基于 <b style={{ color: c.green }}>1,200+</b> 条工单归因出 3 类高频问题，灰度期任务完成率 <b style={{ color: c.green }}>71% → 86%</b>，平均配置时长缩短 <b style={{ color: c.green }}>42%</b>。</p>
        </div>
        <div style={{ position: "absolute", right: 18, bottom: 16, display: "flex", gap: 8 }}>
          <Button>忽略</Button>
          <Button primary style={{ background: applied > 0.5 ? c.green : c.ink, transform: `scale(${1 - Math.max(0, 1 - Math.abs(t - applyAt) / 0.15) * 0.06})` }}>{applied > 0.5 ? <><Check size={14} />已采用</> : "采用"}</Button>
        </div>
      </div>
      {/* 输入框 */}
      <div style={{ position: "absolute", left: 0, top: 760, width: 600, height: 92, borderRadius: 18, background: "#fff", boxShadow: `inset 0 0 0 1px ${c.line2}, 0 2px 8px #0000000a` }}>
        <p style={{ position: "absolute", left: 18, top: 14, margin: 0, fontSize: 14, color: sent || t < typeAt ? c.faint : c.ink }}>{sent || t < typeAt ? "继续提问或说明调整要求…" : typed(CHAT.prompt, t, typeAt, 16)}{!sent && t >= typeAt && Math.floor(t * 2) % 2 === 0 && <span style={{ color: c.blue }}>|</span>}</p>
        <div style={{ position: "absolute", left: 14, bottom: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ width: 26, height: 26, borderRadius: "50%", boxShadow: `inset 0 0 0 1px ${c.line2}`, display: "grid", placeItems: "center" }}><Plus size={13} /></span>
          {!sent && chips}
        </div>
        <span style={{ position: "absolute", right: 58, bottom: 17, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><Img src={deepseek} style={{ width: 15, height: 15 }} />DeepSeek V4</span>
        <span style={{ position: "absolute", right: 12, bottom: 11, width: 34, height: 34, borderRadius: "50%", background: !sent && t > typeAt + 1 ? c.ink : "#c7c7c3", color: "#fff", display: "grid", placeItems: "center" }}><ArrowUp size={15} /></span>
      </div>
    </div>
    {/* 右侧简历预览 */}
    <div style={{ position: "absolute", left: 700, top: 0, width: 500, height: 876, background: "#fafaf9", borderLeft: `1px solid ${c.line}`, transform: `translateX(${(1 - previewP) * 500}px)` }}>
      <div style={{ display: "flex", gap: 6, padding: "14px 16px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, padding: "4px 10px", borderRadius: 7, background: "#fff", boxShadow: `0 0 0 1px ${c.line}`, fontWeight: 500 }}><FileText size={12} />产品经理 · 张三</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, padding: "4px 10px", color: c.mute }}><BriefcaseBusiness size={12} />星河科技 JD</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, padding: "4px 10px", color: c.mute }}><Folder size={12} />项目复盘.md</span>
      </div>
      <ResumePaper t={t} pendingAt={proposalAt} applyAt={applyAt} />
    </div>
  </>;
}

function Section({ title }: { title: string }) {
  return <p style={{ margin: "14px 0 6px", paddingBottom: 4, borderBottom: `1px solid ${c.ink}`, fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>{title}</p>;
}

function ResumePaper({ t, pendingAt, applyAt }: { t: number; pendingAt: number; applyAt: number }) {
  const pending = ramp(t, pendingAt, 0.4);
  const strike = ramp(t, applyAt + 0.2, 0.4);
  const writeAt = applyAt + 0.7;
  const writing = t >= writeAt;
  const flash = writing ? 1 - ramp(t, typedDone(CHAT.newLine, writeAt, 30) + 0.6, 0.8) : 0;
  const li = { margin: "3px 0", fontSize: 11.5, lineHeight: "19px", color: "#30333a" } as const;
  return <div style={{ position: "absolute", left: 24, top: 56, width: 452, height: 800, background: "#fff", boxShadow: "0 1px 3px #0000001a", padding: "30px 32px", fontFamily: font.paper }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      <div><p style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: 3 }}>张三</p><p style={{ margin: "4px 0 0", fontSize: 11.5, color: c.mute }}>高级产品经理 · B 端 SaaS</p></div>
      <p style={{ margin: 0, fontSize: 10.5, color: c.mute, textAlign: "right", lineHeight: "16px" }}>138 0000 0000<br />zhangsan@example.com<br />上海</p>
    </div>
    <Section title="工作经历" />
    <p style={{ ...li, display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span>星图软件 · 产品经理</span><span style={{ fontWeight: 400, color: c.mute }}>2021.07 – 至今</span></p>
    <p style={li}>· 负责企业审批与权限模块，服务 3,000+ 家企业客户，月活管理员 4.2 万。</p>
    <p style={li}>· 搭建权限模板体系，权限相关工单季度环比下降 35%。</p>
    <Section title="项目经历" />
    <p style={{ ...li, display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span>审批配置体验优化 · 负责人</span><span style={{ fontWeight: 400, color: c.mute }}>2025.03 – 2025.09</span></p>
    <div style={{ position: "relative", margin: "3px -6px", padding: "2px 6px", borderRadius: 4, background: writing ? `rgba(47,143,91,${0.12 * flash})` : `rgba(217,130,43,${0.12 * pending})`, boxShadow: writing ? "none" : `inset 2px 0 0 rgba(217,130,43,${pending})` }}>
      {!writing && <p style={{ ...li, margin: 0, opacity: 1 - ramp(t, applyAt + 0.5, 0.2) }}><span style={{ backgroundImage: `linear-gradient(${c.ink}, ${c.ink})`, backgroundSize: `${strike * 100}% 1px`, backgroundPosition: "0 55%", backgroundRepeat: "no-repeat" }}>· {CHAT.oldLine}</span></p>}
      {writing && <p style={{ ...li, margin: 0 }}>· {typed(CHAT.newLine, t, writeAt, 30)}</p>}
    </div>
    <p style={li}>· 联合研发、运营梳理 23 个配置项，沉淀 6 套行业模板，新客户上线周期从 14 天缩短至 5 天。</p>
    <Section title="教育经历" />
    <p style={{ ...li, display: "flex", justifyContent: "space-between", fontWeight: 600 }}><span>华东理工大学 · 工商管理 本科</span><span style={{ fontWeight: 400, color: c.mute }}>2014 – 2018</span></p>
    <Section title="专业技能" />
    <p style={li}>需求分析、用户研究、数据分析（SQL 入门）、原型设计（Figma、Axure）、跨团队项目推进。</p>
  </div>;
}
