import type { ComponentType, CSSProperties } from "react";
import { ArrowUp, BriefcaseBusiness, Check, ChevronDown, FileText, X } from "lucide-react";
import openai from "@/assets/model-icons/openai.svg";
import claude from "@/assets/model-icons/claude.svg";
import gemini from "@/assets/model-icons/gemini.svg";
import deepseek from "@/assets/model-icons/deepseek.svg";
import kimi from "@/assets/model-icons/kimi.svg";
import { FitStage } from "./FitStage";
import { lt } from "./landingCopy";
import "./detail-cards.css";

function SendButton() {
  return <span className="dc-send"><ArrowUp size={13} strokeWidth={2.2} /></span>;
}

function Models() {
  const models = [{ name: "DeepSeek", icon: deepseek }, { name: "Claude", icon: claude }, { name: "GPT", icon: openai }, { name: "Gemini", icon: gemini }, { name: "Kimi", icon: kimi }];
  return <>
    <div className="dc-menu dc-model-menu"><p className="dc-menu-head">{lt("选择模型")}</p>{models.map((model, index) => <p key={model.name} className={`dc-menu-row${index === 0 ? " is-selected" : ""}`}><span><img src={model.icon} alt="" width="16" height="16" />{model.name}{index === 0 && <em>{lt("默认")}</em>}</span>{index === 0 && <Check size={14} strokeWidth={2} />}</p>)}</div>
    <div className="dc-composer dc-model-composer"><p>{lt("问点什么，或输入 @ 引用资料")}</p><span className="dc-model-pill"><img src={deepseek} alt="" width="13" height="13" />DeepSeek</span><SendButton /></div>
  </>;
}

function ImportResume() {
  const modules = [["教育经历", "1 段"], ["工作经历", "3 段"], ["项目经历", "2 个"], ["专业技能", "8 项"]];
  return <div className="dc-dialog dc-import"><strong>{lt("导入简历")}</strong><div className="dc-file"><span>PDF</span><div><p>{lt("张三_产品经理_2026.pdf")}</p><small>1.2 MB&ensp;{lt("已解析")}</small></div></div><p className="dc-label">{lt("识别到 4 个模块")}</p><div className="dc-modules">{modules.map(([name, count]) => <p key={name}><span><Check size={13} strokeWidth={2} />{lt(name)}</span><small>{lt(count)}</small></p>)}</div></div>;
}

function Typography() {
  return <>
    <div className="dc-type-paper"><h4>{lt("张三")}</h4><p className="dc-type-meta">{lt("产品经理")}&ensp;{lt("上海")}&ensp;138 0000 0000</p><h5>{lt("工作经历")}</h5><p className="dc-type-entry"><b>{lt("星图软件")}&ensp;{lt("产品经理")}</b><span>{lt("2023.07 – 至今")}</span></p><p>{lt("负责 B 端协同产品的增长，搭建新用户引导流程，次月留存提升 12%。")}</p><p>{lt("主导 3 次定价实验，付费转化率从 4.1% 提升到 5.6%。")}</p></div>
    <div className="dc-dialog dc-type-panel"><strong>{lt("排版")}</strong>
      <div className="dc-field"><p className="dc-label">{lt("字体")}</p><span className="dc-select">{lt("思源宋体")}<ChevronDown size={12} /></span></div>
      <div className="dc-field"><p className="dc-label">{lt("字号")}</p><span className="dc-segment is-size"><span>10.5</span><b>11</b><span>12</span></span></div>
      <div className="dc-field"><p className="dc-label">{lt("行距")}</p><span className="dc-slider"><i><b /><em /></i>1.5</span></div>
    </div>
  </>;
}

function References() {
  const rows = [{ name: "增长实验复盘.md", kind: "资料", icon: <FileText size={15} /> }, { name: "二面准备笔记", kind: "资料", icon: <FileText size={15} /> }, { name: "星河科技 高级产品经理", kind: "岗位", icon: <BriefcaseBusiness size={15} /> }, { name: "张三 产品经理简历", kind: "简历", icon: <FileText size={15} /> }];
  return <>
    <div className="dc-menu dc-mention-menu"><p className="dc-menu-head">{lt("可引用的资料和简历")}</p>{rows.map((row, index) => <p key={row.name} className={`dc-menu-row${index === 0 ? " is-active" : ""}`}><span>{row.icon}{lt(row.name)}</span><small>{lt(row.kind)}</small></p>)}</div>
    <div className="dc-composer dc-mention-composer"><p className="dc-mention-line">{lt("结合")}<span><FileText size={13} />{lt("增长实验复盘.md")}</span>{lt("准备二面回答")}<i /></p><span className="dc-hint">{lt("@ 引用")}</span><SendButton /></div>
  </>;
}

function CaptureJob() {
  const fields = [["公司", "云帆科技"], ["岗位", "增长产品经理"], ["城市", "杭州"], ["薪资", "25–35K × 15 薪"], ["经验", "3–5 年"]];
  return <>
    <div className="dc-pasted"><p className="dc-label">{lt("粘贴岗位文字")}</p><p>{lt("【云帆科技】增长产品经理\n杭州 余杭区  25-35K·15薪\n经验 3-5 年  本科\n\n岗位职责：\n1. 负责新用户增长策略，设计并推动拉新、激活实验；\n2. 搭建增长数据看板，定位转化漏斗中的关键问题；")}</p></div>
    <div className="dc-dialog dc-parsed"><p className="dc-parsed-head">{lt("已识别 6 项")}</p><div className="dc-fields">{fields.map(([label, value]) => <p key={label}><small>{lt(label)}</small>{lt(value)}</p>)}<p><small>{lt("类型")}</small><span className="dc-type-chip">{lt("正式")}</span></p></div><footer><small>{lt("核对后保存")}</small><span className="dc-primary">{lt("保存岗位")}</span></footer></div>
  </>;
}

function Preferences() {
  return <div className="dc-dialog dc-preferences"><div><strong>{lt("求职偏好")}</strong><small>{lt("AI 讨论时会参考这些信息")}</small></div>
    <div className="dc-field"><p className="dc-label">{lt("期望城市")}</p><div className="dc-row">{["上海", "杭州"].map(city => <span className="dc-chip" key={city}>{lt(city)}<X size={10} /></span>)}<span className="dc-chip is-add">{lt("+ 添加")}</span></div></div>
    <div className="dc-field"><p className="dc-label">{lt("期望薪资")}</p><div className="dc-row is-salary"><span className="dc-chip">25K</span>–<span className="dc-chip">35K</span><small>{lt("/ 月")}</small></div></div>
    <div className="dc-field"><p className="dc-label">{lt("工作类型")}</p><span className="dc-segment is-type"><b>{lt("正式")}</b><span>{lt("实习")}</span><span>{lt("校招")}</span></span></div>
  </div>;
}

const cards: { id: string; tag: string; lead: string; rest: string; label: string; visual: ComponentType; note?: string }[] = [
  { id: "models", tag: "多模型选择", lead: "DeepSeek、Claude、GPT 随时切换。", rest: "换模型后继续当前对话，不用重新开始。", label: "在对话输入框中选择 DeepSeek、Claude、GPT、Gemini 或 Kimi", visual: Models, note: "模型品牌示例，实际可用模型以工作区列表为准。" },
  { id: "import", tag: "已有简历导入", lead: "PDF、Word、Markdown 都能导入。", rest: "自动识别教育、工作、项目等模块，导入后直接编辑。", label: "导入 PDF 简历后识别出教育、工作、项目和技能四个模块", visual: ImportResume },
  { id: "templates", tag: "模板与中文排版", lead: "字体、字号、行距都能单独调整。", rest: "选好模板后再细调，中文简历也能排得整齐。", label: "简历排版面板：思源宋体、11 号字、1.5 倍行距", visual: Typography },
  { id: "references", tag: "资料随手引用", lead: "对话里 @ 一下就能引用资料。", rest: "项目复盘、面试笔记、岗位 JD 都能引用，原文随时可查。", label: "在对话中用 @ 引用项目复盘、面试笔记、岗位和简历", visual: References },
  { id: "capture", tag: "岗位快速收集", lead: "粘贴招聘文字或截图即可保存岗位。", rest: "自动识别公司、薪资和经验要求，核对后保存。", label: "从粘贴的招聘文字中识别公司、岗位、城市、薪资、经验和类型", visual: CaptureJob },
  { id: "preferences", tag: "个性化求职偏好", lead: "城市、薪资、工作类型设置一次。", rest: "之后 AI 给建议时都会参考。", label: "求职偏好：期望城市、期望薪资和工作类型", visual: Preferences },
];

export function DetailCards() {
  return <section id="features" className="dc-section" aria-labelledby="detail-cards-title"><div className="fl-container">
    <header className="dc-header" data-reveal><p className="fl-eyebrow"><span />{lt("细节")}</p><h2 id="detail-cards-title">{lt("更多实用功能")}</h2><p>{lt("切换模型、导入简历、收集岗位，常用操作一步完成。")}</p></header>
    <div className="dc-grid">{cards.map(({ id, tag, lead, rest, label, visual: Visual, note }, index) => <article id={`feature-${id}`} className="dc-card" data-reveal style={{ "--reveal-delay": `${(index % 3) * 0.08}s` } as CSSProperties} key={id} aria-labelledby={`feature-${id}-copy`}>
      <FitStage width={370} height={288} className="dc-media" stageClassName="dc-stage" label={lt(label)}><Visual /></FitStage>
      <div className="dc-copy"><p className="dc-topic"><span>0{index + 1}</span>{lt(tag)}</p><h3 id={`feature-${id}-copy`}>{lt(lead)}<span> {lt(rest)}</span></h3>{note && <small>{lt(note)}</small>}</div>
    </article>)}</div>
  </div></section>;
}
