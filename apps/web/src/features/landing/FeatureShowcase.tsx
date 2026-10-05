import { useRef, type ReactNode } from "react";
import { ArrowUp, BriefcaseBusiness, Check, ChevronLeft, ChevronRight, FileText, Folder, Mic, PenLine, Sparkles } from "lucide-react";
import { FitStage } from "./FitStage";
import { at, CountUp, FakePointer, SceneMotion, Typed, useScenePlayback } from "./motion";
import { lt } from "./landingCopy";
import "./feature-showcase.css";
import "./showcase-motion.css";

const projectUrl = "https://linkresume.cn/resumes";

function AppWindow({ children }: { children: ReactNode }) {
  return <div className="fs-window">{children}</div>;
}
function JobHeader({ tagTone = "muted" }: { tagTone?: "muted" | "neutral" }) {
  return <>
    <p className="fs-breadcrumb"><ChevronLeft size={13} />{lt("岗位看板")}</p>
    <div className="fs-job-header"><span className="fs-job-logo">{lt("星")}</span><div><p className="fs-job-title">{lt("高级产品经理")}<span className={`fs-tag-outline is-${tagTone}`}>{lt("正式")}</span></p><p className="fs-job-meta">{lt("星河科技")}&emsp;{lt("上海")}&emsp;{lt("20–30K × 14 薪")}</p></div></div>
  </>;
}

/* 场景 1：二面当天，准备清单完成最后一项（约 5s） */
const steps = [
  { title: "投递", meta: "产品经理简历  9月12日", tag: "已投递", tone: "muted" },
  { title: "简历筛选", meta: "9月15日", tag: "已通过", tone: "green" },
  { title: "一面 视频面试", meta: "9月24日 10:00", tag: "复盘 8.2", tone: "green" },
];
const materials = [
  { icon: <FileText size={14} />, title: "产品经理简历", meta: "投递简历" },
  { icon: <BriefcaseBusiness size={14} />, title: "星河科技 JD", meta: "岗位 JD" },
  { icon: <Folder size={14} />, title: "项目复盘.md", meta: "岗位资料" },
  { icon: <Mic size={14} />, title: "一面录音与记录", meta: "录音与记录  32 分钟" },
];
function JobDetailVisual() {
  return <>
    <AppWindow>
      <JobHeader />
      <p className="fs-current-stage fx-in" style={at(0.8)}><span />{lt("二面")}<b>{lt("今天 14:00")}</b></p>
      <section className="fs-card fs-progress-card">
        <header><strong>{lt("求职进度")}</strong><span>{lt("5 条记录")}</span></header>
        {steps.map((step, index) => <div className="fs-step fx-rise" style={at(index * 0.08)} key={step.title}><span className="fs-step-marker is-done"><Check size={11} strokeWidth={2.4} /></span><div><p>{lt(step.title)}</p><small>{lt(step.meta)}</small></div><em className={`is-${step.tone}`}>{lt(step.tag)}</em></div>)}
        <div className="fs-step is-current fx-rise" style={at(0.24)}><span className="fs-step-marker is-current"><i /></span><div><p>{lt("二面")}&ensp;{lt("现场面试")}</p><small>{lt("10月4日 14:00–15:00")}</small></div><em className="is-blue">{lt("今天 14:00")}</em></div>
        <div className="fs-step is-waiting fx-rise" style={at(0.32)}><span className="fs-step-marker" /><div><p>Offer</p><small>{lt("还有 16 天回复")}</small></div><span className="fs-step-wait">{lt("等待中")}</span></div>
      </section>
      <section className="fs-card fs-material-card fx-in" style={at(0.4)}>
        <header><strong>{lt("关联资料")}</strong><span>{lt("4 个")}</span></header>
        {materials.map(item => <div className="fs-material" key={item.title}><span>{item.icon}</span><div><p>{lt(item.title)}</p><small>{lt(item.meta)}</small></div></div>)}
      </section>
    </AppWindow>
    <div className="fs-fade" />
    <div className="fs-float fs-checklist fx-up" style={at(1.6)}>
      <header><div><strong>{lt("二面准备清单")}</strong><small>{lt("今天 14:00 现场面试")}</small></div><em className="fs-count"><span className="fs-count-old">2 / 3</span><span className="fs-count-new">3 / 3</span></em></header>
      <div className="fs-checklist-bar"><span /></div>
      <p className="is-done"><span><Check size={11} strokeWidth={2.6} /></span>{lt("复习一面复盘里的 2 个追问")}</p>
      <p className="is-done"><span><Check size={11} strokeWidth={2.6} /></span>{lt("整理审批配置项目的灰度数据")}</p>
      <p className="is-done is-last"><span><Check size={11} strokeWidth={2.6} /></span>{lt("模拟一轮业务面，练习回应追问")}</p>
      <span className="fs-primary-btn is-block">{lt("开始模拟面试")}</span>
    </div>
  </>;
}

/* 场景 2：用户发一句话，AI 给出修改建议并写入简历（约 6s） */
const assistantReply = "复盘里有 4 条可量化结果，简历目前一条都没用上。对照 JD 的「数据驱动」要求，我准备了 2 处修改。";
function AgentVisual() {
  return <>
    <AppWindow>
      <div className="fs-thread">
        <div className="fs-user-message fx-up" style={at(0)}>
          <div className="fs-chips"><span><FileText size={12} />{lt("产品经理简历")}</span><span><Folder size={12} />{lt("项目复盘.md")}</span><span><BriefcaseBusiness size={12} />{lt("星河科技 JD")}</span></div>
          <p className="fs-bubble">{lt("按这个 JD，把复盘里的结果整理进简历。")}</p>
        </div>
        <p className="fs-thinking fx-in" style={at(0.4)}><Check size={13} />{lt("已分析 3 份资料，提取 4 条可量化结果")}<ChevronRight size={12} /></p>
        <div className="fs-assistant"><span className="fx-in" style={at(0.6)}><Sparkles size={13} /></span><p><Typed text={lt(assistantReply)} start={0.6} duration={1.2} /></p></div>
      </div>
      <div className="fs-preview">
        <div className="fs-preview-tabs"><span className="is-active"><FileText size={12} />{lt("产品经理简历")}</span><span><Folder size={12} />{lt("项目复盘.md")}</span><span><BriefcaseBusiness size={12} />{lt("星河科技 JD")}</span></div>
        <div className="fs-paper">
          <h4>{lt("张三")}</h4>
          <p className="fs-paper-contact">138 0000 0000&emsp;&ensp;zhangsan@example.com&emsp;&ensp;{lt("上海")}</p>
          <p className="fs-paper-intent">{lt("求职意向：高级产品经理（B 端 SaaS）")}</p>
          <h5>{lt("工作经历")}</h5>
          <p className="fs-paper-item">{lt("星图软件")}&ensp;{lt("产品经理")}<span>{lt("2021.07 – 至今")}</span></p>
          <p>{lt("负责企业审批与权限模块，服务 3,000+ 家企业客户，月活管理员 4.2 万。")}</p>
          <h5>{lt("项目经历")}</h5>
          <p className="fs-paper-item">{lt("审批配置体验优化")}<span>2025.03 – 2025.09</span></p>
          <p className="fs-paper-pending" style={at(3)}>{lt("主导审批配置改版：基于 1,200+ 条工单归因出 3 类高频问题，两轮原型测试后重构配置路径；灰度期任务完成率 71% → 86%，平均配置时长缩短 42%。")}</p>
          <p>{lt("联合研发、运营梳理 23 个配置项，沉淀 6 套行业模板，新客户上线周期从 14 天缩短至 5 天。")}</p>
          <h5>{lt("教育经历")}</h5>
          <p className="fs-paper-item">{lt("华东理工大学")}&ensp;{lt("工商管理")}<span>2014 – 2018</span></p>
        </div>
      </div>
    </AppWindow>
    <div className="fs-fade" />
    <div className="fs-float fs-suggestion fx-up" style={at(2)}>
      <header><strong>{lt("建议修改")}</strong><span>{lt("2 项待确认")}</span></header>
      <div className="fs-pill-tabs"><span className="is-active">{lt("量化项目结果")}</span><span>{lt("补充协作范围")}</span></div>
      <div className="fs-change">
        <div className="fx-in" style={at(2.3)}><small>{lt("原文")}</small><p className="is-before">{lt("负责审批配置功能优化，通过原型测试改进配置流程，提升了用户体验。")}</p></div>
        <div className="fx-in" style={at(2.6)}><small className="is-after">{lt("建议")}</small><p>{lt("主导审批配置改版：基于 ")}<b>1,200+</b>{lt(" 条工单归因出 3 类高频问题，两轮原型测试后重构配置路径；灰度期任务完成率 ")}<b>71% → 86%</b>{lt("，平均配置时长缩短 ")}<b>42%</b>{lt("。")}</p></div>
      </div>
      <footer><span className="fs-pager"><ChevronLeft size={14} className="is-disabled" />1 / 2<ChevronRight size={14} /></span><span className="fs-actions"><span className="fs-text-btn">{lt("忽略")}</span><span className="fs-ghost-btn fs-hover-target">{lt("采用此项")}</span><span className="fs-primary-btn">{lt("全部采用")}</span></span></footer>
    </div>
    <FakePointer className="is-agent" />
  </>;
}

/* 场景 3：对照 JD 逐条检查简历（约 5s） */
const requirements = [
  { text: "5 年以上 B 端产品经验", hit: true },
  { text: "熟悉审批、权限或工作流类产品", hit: true },
  { text: "能用 SQL 独立完成数据分析", hit: false },
  { text: "具备用户研究与原型设计能力", hit: true },
  { text: "有 SaaS 商业化或定价经验", hit: false },
  { text: "能推动研发、设计与运营跨团队协作", hit: true },
];
const matchTags = [...["B 端产品", "审批流程", "权限设计", "用户研究", "原型设计", "跨团队协作"].map(tag => ({ tag, hit: true })), ...["SQL", "SaaS 商业化"].map(tag => ({ tag, hit: false }))];
function JobMatchVisual() {
  return <>
    <AppWindow>
      <JobHeader tagTone="neutral" />
      <section className="fs-card fs-jd-card">
        <span className="fs-scan" />
        <header><strong>{lt("岗位描述")}</strong><span>{lt("9月12日导入")}</span></header>
        <h5>{lt("岗位职责")}</h5>
        <p>{lt("负责企业审批与流程引擎的产品规划，提升配置效率与易用性。")}</p>
        <p>{lt("通过数据分析与用户研究定位问题，推动方案落地并验证效果。")}</p>
        <h5>{lt("任职要求")}</h5>
        {requirements.map((item, index) => <div className={`fs-requirement${item.hit ? "" : " is-missing"}`} key={item.text}><span>{lt(item.text)}</span><em className={`fx-pop ${item.hit ? "is-green" : "is-orange"}`} style={at(0.3 + index * 0.15)}>{lt(item.hit ? "已命中" : "待补充")}</em></div>)}
      </section>
    </AppWindow>
    <div className="fs-fade" />
    <div className="fs-float fs-match fx-up" style={at(1.4)}>
      <div className="fs-gauge">
        <svg viewBox="0 0 276 140" fill="none"><path d="M52 118a86 86 0 0 1 172 0" stroke="#e6e6e2" strokeWidth="12" strokeLinecap="round" /><path className="fs-gauge-arc" style={at(1.5)} d="M52 118a86 86 0 0 1 172 0" stroke="#3b9a5b" strokeWidth="12" strokeLinecap="round" pathLength="100" strokeDasharray="82 100" /></svg>
        <strong><CountUp to={82} delay={1.5} duration={1} /></strong><small>{lt("匹配度")}</small><i className="is-min">0</i><i className="is-max">100</i>
      </div>
      <p className="fs-match-basis fx-in" style={at(2.4)}>{lt("基于「产品经理简历」")}</p>
      <p className="fs-match-gap fx-in" style={at(2.4)}>{lt("还缺：SQL 数据分析、SaaS 商业化经验")}</p>
      {[true, false].map(hit => <div className="fs-match-group" key={String(hit)}><small>{hit ? "已命中 6" : "待补充 2"}</small><div>{matchTags.filter(item => item.hit === hit).map(item => <span className={`fx-pop ${hit ? "is-green" : "is-orange"}`} style={at(2.6 + matchTags.indexOf(item) * 0.06)} key={item.tag}>{lt(item.tag)}</span>)}</div></div>)}
      <div className="fs-match-actions"><span className="fs-ghost-btn"><Sparkles size={13} />{lt("重新分析")}</span><span className="fs-primary-btn"><PenLine size={13} />{lt("按 JD 优化简历")}</span></div>
    </div>
  </>;
}

/* 场景 4：把一张卡从「一面」拖到「二面」（约 5s，停在拖拽中） */
type BoardCard = { company: string; title: string; category: string; status: string; logo: string; tone: string };
const columns: { title: string; tone: string; count: number; cards: BoardCard[] }[] = [
  { title: "筛选中", tone: "muted", count: 3, cards: [
    { company: "北辰数据", title: "数据产品经理", category: "正式", status: "投递于 9月30日", logo: "北", tone: "muted" },
    { company: "澄海科技", title: "产品运营", category: "校招", status: "投递于 10月1日", logo: "澄", tone: "muted" },
    { company: "星图云", title: "B 端产品经理", category: "正式", status: "投递于 9月28日", logo: "图", tone: "muted" },
  ] },
  { title: "笔试", tone: "orange", count: 1, cards: [{ company: "拾光互娱", title: "游戏策划", category: "校招", status: "截止 10月8日 18:00", logo: "拾", tone: "orange" }] },
  { title: "一面", tone: "blue", count: 1, cards: [{ company: "云杉医疗", title: "产品经理", category: "正式", status: "10月9日 10:00", logo: "云", tone: "blue" }] },
  { title: "二面", tone: "blue", count: 2, cards: [{ company: "星河科技", title: "高级产品经理", category: "正式", status: "今天 14:00", logo: "星", tone: "today" }] },
  { title: "Offer", tone: "green", count: 1, cards: [{ company: "远航物流", title: "产品经理", category: "正式", status: "9月26日 获得 Offer", logo: "远", tone: "green" }] },
];
function ProgressCard({ card, className = "" }: { card: BoardCard; className?: string }) {
  return <div className={`fs-board-card ${className}`}><div><small>{lt(card.company)}</small><strong>{lt(card.title)}</strong><span>{lt(card.category)}</span></div><footer>{card.tone === "today" ? <em>{lt(card.status)}</em> : <p><i className={`is-${card.tone}`} />{lt(card.status)}</p>}<b>{lt(card.logo)}</b></footer></div>;
}
function BoardVisual() {
  return <>
    <AppWindow>
      <p className="fs-board-head"><strong>{lt("岗位看板")}</strong>{lt("9 个求职进程")}</p>
      <div className="fs-board-tools"><span className="fs-toggle"><b>{lt("看板")}</b><span>{lt("列表")}</span></span><span className="fs-outline-btn">{lt("+ 新建求职")}</span></div>
      <div className="fs-board">{columns.map(column => <section key={column.title}>
        <header><i className={`is-${column.tone}`} /><strong>{lt(column.title)}</strong>{column.count}</header>
        {column.title === "二面" && <div className="fs-drop-slot fx-in" style={at(0.9)} />}
        {column.cards.map(card => <ProgressCard key={card.company} card={card} />)}
      </section>)}</div>
    </AppWindow>
    <div className="fs-fade is-board" />
    <ProgressCard className="is-dragging" card={{ company: "蓝鲸支付", title: "产品经理", category: "正式", status: "10月10日 15:00", logo: "鲸", tone: "blue" }} />
    <p className="fs-drop-hint fx-up" style={at(2)}><strong>{lt("推进到二面")}</strong>{lt("10月12日 14:00")}</p>
    <FakePointer className="is-board" />
  </>;
}

/* 场景 5：回答追问后生成评估报告（约 6s） */
const answer = "先从 1,200 多条工单里做归因，发现 3 类高频问题都出在配置路径上。两轮原型测试后重构了流程，灰度期任务完成率从 71% 提升到 86%……";
const rubric = [{ label: "结构清晰", score: 8.6, width: 76, tone: "green" }, { label: "数据支撑", score: 8.0, width: 71, tone: "green" }, { label: "回应追问", score: 6.8, width: 60, tone: "orange" }];
function InterviewVisual() {
  return <>
    <AppWindow>
      <div className="fs-session-title"><strong>{lt("星河科技")}&ensp;{lt("高级产品经理")}</strong><small>{lt("业务面")}&emsp;{lt("6 个考察点")}&emsp;{lt("中级难度")}</small></div>
      <div className="fs-session-actions"><small>{lt("已用时")}</small><strong>12:48</strong><span>{lt("放弃")}</span><span className="fs-primary-btn fs-click-target">{lt("结束并评估")}</span></div>
      <div className="fs-session-divider" />
      <div className="fs-answer-progress"><small>{lt("作答进度")}</small><span className="fs-segments"><i className="is-done" /><i className="is-done" /><i className="is-current" style={at(1.8)} /><i /><i /><i /></span><span>{lt("第 3 / 6 题")}</span></div>
      <div className="fs-interview-thread">
        <div className="fx-up" style={at(0)}><span className="fs-question-pill">{lt("主问题")}</span><p className="fs-question">{lt("你是如何发现审批配置的问题，并验证优化效果的？")}</p></div>
        <div className="fs-answer"><small className="fx-in" style={at(0.3)}>{lt("你的回答")}&emsp;{lt("186 字")}&emsp;{lt("语音输入")}</small><p className="fx-in" style={at(0.3)}><Typed text={lt(answer)} start={0.35} duration={1.5} /></p></div>
        <div className="fx-up" style={at(1.8)}><span className="fs-followup-pill">{lt("追问 L1")}</span><p className="fs-followup">{lt("完成率的提升，你怎么确认是配置路径改动带来的，而不是其他因素？")}</p></div>
      </div>
      <div className="fs-interview-composer"><p>{lt("输入你的回答…")}</p><footer><span><Mic size={15} />{lt("Enter 发送")}&emsp;{lt("Shift + Enter 换行")}</span><b><ArrowUp size={15} /></b></footer></div>
    </AppWindow>
    <div className="fs-fade is-interview" />
    <div className="fs-float fs-report fx-up" style={at(3.2)}>
      <header><div><strong>{lt("评估报告")}</strong><small>{lt("上一场")}&ensp;{lt("一面模拟")}</small></div><p><b><CountUp to={8.2} decimals={1} delay={3.2} duration={0.8} /></b>/ 10</p></header>
      <div className="fs-rubric">{rubric.map((item, index) => <p key={item.label} className={`is-${item.tone}`}><span>{lt(item.label)}</span><i><b className="fx-grow" style={{ width: `${item.width}%`, ...at(3.6 + index * 0.12) }} /></i><strong>{item.score.toFixed(1)}</strong></p>)}</div>
      <div className="fs-report-note is-green fx-in" style={at(4.4)}><i /><div><small>{lt("亮点")}</small><p>{lt("用工单归因和灰度数据讲清了因果。")}</p></div></div>
      <div className="fs-report-note is-orange fx-in" style={at(4.55)}><i /><div><small>{lt("待改进")}</small><p>{lt("被追问对照组时有些犹豫，可以补充 A/B 实验设计。")}</p></div></div>
      <span className="fs-report-link fx-in" style={at(4.7)}>{lt("查看完整报告 →")}</span>
    </div>
    <FakePointer className="is-interview" />
  </>;
}

const blocks = [
  { id: "job", title: "一个岗位的所有东西，都在一处。", description: "简历、JD、面试录音和复盘都挂在岗位下。二面之前，它已经帮你把准备清单列好。", visual: JobDetailVisual, label: "岗位详情：求职进度、关联资料与二面准备清单（示例数据）", tint: "blue" },
  { id: "agent", title: "它来动笔，你来拍板。", description: "它读完你的项目复盘，找出简历里漏掉的成果，写好修改等你确认。", visual: AgentVisual, label: "AI 助手读取简历、项目复盘和 JD 后给出修改建议（示例数据）", tint: "violet" },
  { id: "match", title: "投之前，先对一遍 JD。", description: "它逐条对照岗位要求，告诉你哪些已经命中、还差什么，再帮你按 JD 改简历。", visual: JobMatchVisual, label: "岗位要求逐条对照与 82 分匹配分析（示例数据）", tint: "green" },
  { id: "board", title: "每个岗位走到哪，一眼看清。", description: "拖一下卡片就能推进阶段，面试时间和记录跟着岗位走。", visual: BoardVisual, label: "岗位看板：拖动卡片推进求职阶段（示例数据）", tint: "slate" },
  { id: "interview", title: "面试官会追问的，先练一遍。", description: "它按你的简历出题、追问、打分，再告诉你下次可以怎么答。", visual: InterviewVisual, label: "模拟面试：主问题、追问与评估报告（示例数据）", tint: "indigo" },
];

function ShowcaseBlock({ block, index }: { block: (typeof blocks)[number]; index: number }) {
  const article = useRef<HTMLElement>(null);
  const { state, cycle } = useScenePlayback(article);
  const { id, title, description, visual: Visual, label, tint } = block;
  return <article ref={article} id={`feature-${id}`} className={`fs-block${index % 2 ? " is-reversed" : ""}`} data-motion={state === "static" ? undefined : state} aria-labelledby={`feature-${id}-title`}>
    <div className="fs-copy" data-reveal><h3 id={`feature-${id}-title`}>{lt(title)}</h3><p>{lt(description)}</p><a href={projectUrl}>{lt("了解更多")}<span aria-hidden="true">→</span></a></div>
    <FitStage width={800} height={640} className="fs-visual-box" stageClassName={`fs-visual is-${tint}`} label={lt(label)}><SceneMotion.Provider value={state}><Visual key={cycle} /></SceneMotion.Provider></FitStage>
  </article>;
}

export function FeatureShowcase() {
  return <section id="use-cases" className="fs-section" aria-labelledby="feature-showcase-title">
    <div className="fs-inner">
      <header className="fs-header" data-reveal><p className="fl-eyebrow"><span />{lt("它能帮你做什么")}</p><h2 id="feature-showcase-title">{lt("求职要用的，都连在一起。")}</h2></header>
      {blocks.map((block, index) => <ShowcaseBlock key={block.id} block={block} index={index} />)}
    </div>
  </section>;
}
