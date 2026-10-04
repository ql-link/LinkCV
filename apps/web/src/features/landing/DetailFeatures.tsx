import { ArrowDown, AtSign, BriefcaseBusiness, Check, FileText, MapPin, MessageSquareText, Sparkles, UserRound } from "lucide-react";
import openai from "@/assets/model-icons/openai.svg";
import claude from "@/assets/model-icons/claude.svg";
import gemini from "@/assets/model-icons/gemini.svg";
import deepseek from "@/assets/model-icons/deepseek.svg";
import kimi from "@/assets/model-icons/kimi.svg";
import grok from "@/assets/model-icons/grok.svg";
import "./detail-features.css";

function Models() {
  return <div className="df-art df-models"><ul aria-label="模型品牌示例">{[
    { name: "GPT", icon: openai }, { name: "Claude", icon: claude }, { name: "Gemini", icon: gemini },
    { name: "DeepSeek", icon: deepseek }, { name: "Kimi", icon: kimi }, { name: "Grok", icon: grok },
  ].map(({ name, icon }) => <li key={name}><span className="df-model-tile"><img src={icon} alt="" width="38" height="38" /></span><span>{name}</span></li>)}</ul></div>;
}

function ImportResume() {
  return <div className="df-art df-import" role="img" aria-label="PDF、DOCX 和 Markdown 文件，汇入可编辑的简历"><div aria-hidden="true">
    <div className="df-import-files">{["PDF", "DOCX", "MD"].map(format => <div className={`df-format-file df-format-${format.toLowerCase()}`} key={format}><FileText size={24} strokeWidth={1.4} /><strong>{format}</strong><span className="df-paper-lines"><i /><i /><i /></span></div>)}</div>
    <ArrowDown className="df-import-arrow" size={20} strokeWidth={1.4} />
    <div className="df-result-pill"><span><Check size={13} /></span>可编辑的简历</div>
  </div></div>;
}

function Templates() {
  return <div className="df-art df-typography" role="img" aria-label="中文衬线字体与多种简历版式的纸张叠放"><div aria-hidden="true">
    <div className="df-type-paper df-type-back"><span>Aa</span><i /><i /><i /><i /></div>
    <div className="df-type-paper df-type-front"><span className="df-paper-kicker">简历 · 中文排版</span><strong>经历与成长<span>清楚呈现每一份积累</span></strong><div className="df-type-rule" /><span className="df-type-heading">01 / 项目经历</span><i /><i /><i /><span className="df-type-heading">02 / 教育背景</span><i /><i /></div>
    <div className="df-type-specimen"><span>字</span><span>Aa</span></div>
  </div></div>;
}

function References() {
  return <div className="df-art df-references" role="img" aria-label="项目复盘、面试笔记和岗位资料，通过引用连接到同一次讨论"><div aria-hidden="true">
    <svg className="df-reference-paths" viewBox="0 0 320 232" preserveAspectRatio="none" fill="none"><path d="M136 55H163Q180 55 180 75V98Q180 116 204 116H249M136 116H249M136 177H163Q180 177 180 157V136Q180 116 204 116" /><path className="df-reference-active" d="M136 116H249" /><circle cx="136" cy="55" r="2" /><circle cx="136" cy="116" r="2" /><circle cx="136" cy="177" r="2" /></svg>
    <div className="df-reference-note"><FileText size={17} /><span>项目复盘</span></div>
    <div className="df-reference-note"><MessageSquareText size={17} /><span>面试笔记</span></div>
    <div className="df-reference-note"><BriefcaseBusiness size={17} /><span>岗位资料</span></div>
    <div className="df-reference-hub"><AtSign size={28} strokeWidth={1.5} /></div><span className="df-reference-caption">随时引用，随时查看</span>
  </div></div>;
}

function CaptureJob() {
  return <div className="df-art df-capture" role="img" aria-label="从招聘文字与截图中，把岗位收集到我的机会"><div aria-hidden="true">
    <div className="df-opportunity df-opportunity-left"><span><BriefcaseBusiness size={15} />招聘文字</span><strong>产品经理</strong><i /><i /></div>
    <div className="df-opportunity df-opportunity-right"><span><FileText size={15} />岗位截图</span><strong>前端工程师</strong><i /><i /></div>
    <ArrowDown className="df-capture-arrow" size={19} strokeWidth={1.4} />
    <div className="df-folder-back" /><div className="df-folder-front"><BriefcaseBusiness size={22} strokeWidth={1.4} /><span>我的机会</span><span className="df-folder-check"><Check size={13} /></span></div>
  </div></div>;
}

function Preferences() {
  return <div className="df-art df-preferences" role="img" aria-label="个人画像周围环绕城市、薪资、工作类型和技能偏好"><div aria-hidden="true">
    <svg className="df-profile-paths" viewBox="0 0 320 232" preserveAspectRatio="none" fill="none"><path d="M92 45H133Q160 45 160 73V116M259 74H210Q160 74 160 116M50 122H160M264 167H196Q160 167 160 116M106 211H137Q160 211 160 171V116" /></svg>
    <div className="df-profile-avatar"><UserRound size={33} strokeWidth={1.3} /><span><Sparkles size={11} /></span></div>
    <span className="df-preference-tag df-tag-city"><MapPin size={13} />上海 / 杭州</span>
    <span className="df-preference-tag df-tag-salary">20–30K</span>
    <span className="df-preference-tag df-tag-type"><BriefcaseBusiness size={13} />全职</span>
    <span className="df-preference-tag df-tag-skill">产品设计</span>
    <span className="df-preference-tag df-tag-research">用户研究</span>
    <span className="df-profile-dot df-profile-dot-one" /><span className="df-profile-dot df-profile-dot-two" />
  </div></div>;
}

const features = [
  { id: "models", tag: "多模型选择", title: "多种模型，一个工作区", description: "选择你习惯的 AI，在同一个工作区继续求职准备。", component: Models },
  { id: "import", tag: "已有简历导入", title: "从已有简历开始", description: "导入 PDF、DOCX 或 Markdown，让已有经历变成可继续修改的内容。", component: ImportResume },
  { id: "templates", tag: "模板与中文排版", title: "让经历，也有好的呈现", description: "从合适的模板开始，用字体、间距与留白，清楚呈现你的经历。", component: Templates },
  { id: "references", tag: "资料随手引用", title: "带上资料，再开始讨论", description: "用 @ 引用项目资料或面试笔记，讨论时随手查看原文。", component: References },
  { id: "capture", tag: "岗位快速收集", title: "看到好机会，随手收进来", description: "粘贴招聘文字或上传截图，识别关键信息，核对后保存。", component: CaptureJob },
  { id: "preferences", tag: "个性化求职偏好", title: "让建议，更贴合你的选择", description: "保存城市、薪资与工作意向，让每一次讨论更贴合你的方向。", component: Preferences },
];

export function DetailFeatures() {
  return <section id="features" className="df-section fl-container" aria-labelledby="detail-features-title"><div className="df-section-heading"><div><p className="fl-eyebrow"><span />按自己的方式准备</p><h2 id="detail-features-title">让准备更顺手的细节</h2><p>从选择 AI，到收集机会，让日常准备少一些重复操作。</p></div></div><div className="df-grid">{features.map(({ id, tag, title, description, component: Component }, index) => <article className={`df-card df-card-${id}`} id={`feature-${id}`} key={id} aria-labelledby={`feature-title-${id}`}><div className="df-copy"><p className="df-topic"><span>0{index + 1}</span>{tag}</p><h3 id={`feature-title-${id}`}>{title}</h3><p>{description}</p>{id === "models" && <small>模型品牌示例，实际可用模型以工作区列表为准。</small>}</div><div className="df-media"><Component /></div></article>)}</div></section>;
}
