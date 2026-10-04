import { useState, type ReactNode } from "react";
import { ArrowRight, BriefcaseBusiness, CalendarDays, Check, ChevronRight, FileText, FolderOpen, Mic, RotateCcw, Sparkles } from "lucide-react";
import type { AgentProposal } from "@/api/client";
import { SuggestionCard } from "@/features/assistant/SuggestionCard";
import "./case-scenes.css";

export type SceneKey = "workspace" | "agent" | "job-fit" | "progress" | "practice";
const resume = "产品经理 · 张三";
const project = "审批配置体验优化";
const before = "通过两轮原型测试优化配置路径，灰度期任务完成率从 71% 提升至 86%。";
const after = "围绕审批配置中的高频问题开展两轮原型测试，优化配置路径；灰度期任务完成率从 71% 提升至 86%。";

function Scene({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return <div className="cs-scene np-product v3"><header className="cs-window-head"><span>{icon}{title}</span><span className="cs-window-action">{action ?? "示例数据"}</span></header><div className="cs-body">{children}</div></div>;
}
function Context({ material = false }: { material?: boolean }) {
  return <div className="cs-contexts"><span className="assistant-context-chip"><FileText size={12} />{resume}</span><span className="assistant-context-chip">{material ? <FolderOpen size={12} /> : <BriefcaseBusiness size={12} />}{material ? "审批配置项目复盘.md" : "星河科技 · 高级产品经理"}</span></div>;
}
function JobIdentity() {
  return <div className="cs-job-identity"><span className="cs-company-mark">星</span><div><strong>高级产品经理</strong><p>星河科技 · 上海 · 20–30K</p></div><span className="cs-stage-tag">业务一面</span></div>;
}

function WorkspaceScene() {
  const [resource, setResource] = useState(0);
  const resources = [{ label: "关联简历", icon: <FileText size={15} /> }, { label: "项目资料", icon: <FolderOpen size={15} /> }, { label: "面试安排", icon: <CalendarDays size={15} /> }];
  return <Scene title="求职工作台" icon={<BriefcaseBusiness size={15} />}><JobIdentity /><p className="cs-label cs-resource-label">围绕这次机会准备</p><div className="cs-resource-tabs" role="group" aria-label="切换关联资料">{resources.map((item, index) => <button type="button" key={item.label} aria-pressed={resource === index} onClick={() => setResource(index)}>{item.icon}<span>{item.label}</span></button>)}</div><div className="cs-resource-panel" role="region" aria-label={resources[resource].label}>
    {resource === 0 ? <><div className="cs-panel-heading"><FileText size={15} /><strong>{resume}</strong><span><Check size={12} />已关联</span></div><div className="cs-resume-excerpt"><p className="cs-label">项目经历</p><h3>{project}</h3><p>{after}</p></div></> : resource === 1 ? <><div className="cs-panel-heading"><FolderOpen size={15} /><strong>审批配置项目复盘.md</strong></div><div className="cs-material-lines"><p><span>背景</span>用户在配置审批流程时经常中途退出。</p><p><span>行动</span>两轮原型测试，优化配置路径与即时预览。</p><p><span>结果</span>灰度期任务完成率从 71% 提升至 86%。</p></div></> : <><div className="cs-panel-heading"><CalendarDays size={15} /><strong>业务一面 · 视频面试</strong></div><p className="cs-schedule-time">周三 <b>14:00–15:00</b></p><p className="cs-label">准备清单</p><ul className="cs-checklist"><li><Check size={13} />练习 2 分钟自我介绍</li><li><span />复盘审批配置项目</li><li><span />准备产品决策与效果验证的例子</li></ul></>}
  </div><div className="cs-bottom-note"><span className="cs-linked-dot" />同一份经历，用于简历与面试准备</div></Scene>;
}

function AgentScene() {
  const [status, setStatus] = useState<AgentProposal["status"]>("pending");
  const proposal: AgentProposal = { id: "card-agent-proposal", run_id: "card-agent-run", resume_id: "landing-demo-resume", base_lock_version: 1, data: null, style: null, preview: { changes: [{ target: {}, op: "replace_target_text", before, after }] }, summary: "项目行动与结果", status, applied_lock_version: status === "applied" ? 2 : null, expires_at: "2099-01-01T00:00:00Z", created_at: "2026-10-04T02:30:00Z" };
  return <Scene title="简历 AI Agent" icon={<Sparkles size={15} />} action={<button type="button" className="cs-reset" aria-label="重置简历修改演示" onClick={() => setStatus("pending")}><RotateCcw size={13} />重置</button>}><Context material /><div className="cs-user-message">把这份项目复盘整理进简历。</div><ol className="cs-agent-steps" aria-label="Agent 执行过程">{["读取简历与资料", "分析项目表达", "生成修改提案"].map(label => <li key={label}><Check size={12} />{label}</li>)}</ol><SuggestionCard key={status === "pending" ? "pending" : "done"} proposals={[proposal]} resumeLabel={resume} historical={false} busyProposalId={null} running={false} batchProgress={null} batchLocked={false} onSelect={() => undefined} onApply={async () => { setStatus("applied"); return true; }} onReject={async () => { setStatus("rejected"); return true; }} onApplyAll={() => setStatus("applied")} onContinue={() => setStatus("pending")} /><p className="cs-operation-result" role="status">{status === "applied" ? "修改已应用到演示简历，保留原始事实。" : status === "rejected" ? "已忽略这条修改，保留原文。" : "修改由你确认，确认后才会采用。"}</p>{status === "applied" && <div className="cs-applied-excerpt"><p className="cs-label">采用后的项目经历</p><p>{after}</p></div>}</Scene>;
}

const fitItems = [
  { label: "用户研究", requirement: "通过用户研究发现产品问题，并验证候选方案。", evidence: "围绕审批配置中的高频问题开展两轮原型测试。", tip: "说明研究发现了什么，以及为什么选择这条优化路径。" },
  { label: "B2B 产品", requirement: "理解复杂业务流程，推动产品体验优化。", evidence: "优化审批配置路径，降低复杂流程的使用成本。", tip: "讲清流程中的具体障碍，以及你的方案取舍。" },
  { label: "数据验证", requirement: "建立业务指标，跟踪上线效果并持续优化。", evidence: "灰度期任务完成率从 71% 提升至 86%。", tip: "补充指标口径、验证周期和你负责的范围。" },
];
function JobFitScene() {
  const [selected, setSelected] = useState(0);
  const item = fitItems[selected];
  return <Scene title="岗位与简历" icon={<BriefcaseBusiness size={15} />}><JobIdentity /><div className="cs-fit-options" role="group" aria-label="查看岗位要求与经历的对应关系">{fitItems.map((option, index) => <button type="button" key={option.label} aria-pressed={selected === index} onClick={() => setSelected(index)}>{option.label}</button>)}</div><div className="cs-fit-flow"><section><p className="cs-label">岗位要求</p><p>{item.requirement}</p></section><div className="cs-flow-connector"><span /><ArrowRight size={14} /><span /></div><section className="cs-evidence"><p className="cs-label"><FileText size={12} />简历中的依据</p><h3>{project}</h3><p>{item.evidence}</p></section></div><div className="cs-fit-tip"><Sparkles size={14} /><p><strong>可以进一步写清楚</strong>{item.tip}</p></div></Scene>;
}

function ProgressScene() {
  const [advanced, setAdvanced] = useState(false);
  const [detail, setDetail] = useState(true);
  return <Scene title="岗位看板" icon={<BriefcaseBusiness size={15} />} action={<button type="button" className="cs-reset" aria-label="重置求职阶段演示" onClick={() => { setAdvanced(false); setDetail(true); }}><RotateCcw size={13} />重置</button>}><div className="cs-board"><section><header><span />简历筛选 <small>{advanced ? 1 : 2}</small></header><div className="cs-board-card"><span className="cs-company-mark">青</span><strong>增长产品经理</strong><p>青舟数据</p><small>等待筛选结果</small></div>{!advanced && <button type="button" className="cs-board-card is-selected" aria-expanded={detail} aria-label="查看星河科技求职记录" onClick={() => setDetail(value => !value)}><span className="cs-company-mark">星</span><strong>高级产品经理</strong><p>星河科技</p><small>已收到面试邀请<ChevronRight size={12} /></small></button>}</section><section><header><span className="is-blue" />面试中 <small>{advanced ? 1 : 0}</small></header>{advanced ? <button type="button" className="cs-board-card is-selected" aria-expanded={detail} aria-label="查看星河科技求职记录" onClick={() => setDetail(value => !value)}><span className="cs-company-mark">星</span><strong>高级产品经理</strong><p>星河科技</p><small><CalendarDays size={12} />周三 14:00 · 业务一面</small></button> : <div className="cs-board-empty">面试机会会出现在这里</div>}</section></div>{detail && <div className="cs-progress-detail"><div className="cs-panel-heading"><strong>星河科技 · 高级产品经理</strong><span>{advanced ? "面试中" : "简历筛选"}</span></div><p><FileText size={13} />关联简历 <strong>{resume}</strong></p><p><CalendarDays size={13} />面试安排 <strong>周三 14:00–15:00</strong></p><button type="button" className="v3-btn v3-btn-dark" disabled={advanced} onClick={() => setAdvanced(true)}>{advanced ? <><Check size={13} />已推进到业务一面</> : <>推进到业务一面<ArrowRight size={13} /></>}</button></div>}<p className="cs-operation-result" role="status">{advanced ? "阶段已更新，关联简历和面试安排仍在这条记录里。" : "点击岗位卡片，查看这次机会的准备。"}</p></Scene>;
}

function PracticeScene() {
  const [view, setView] = useState<"followup" | "feedback">("followup");
  return <Scene title="模拟面试 · 项目深挖" icon={<Mic size={15} />}><Context /><div className="cs-interview-question"><span className="cs-label">面试官 · 第 1 题</span><h3>你是如何发现审批配置的问题，并验证优化效果的？</h3></div><div className="cs-interview-answer"><span className="cs-label">张三的回答</span><p>我通过两轮原型测试优化了配置路径，灰度期任务完成率从 71% 提升至 86%。</p></div><div className="cs-practice-tabs" role="group" aria-label="切换面试追问与反馈"><button type="button" aria-pressed={view === "followup"} onClick={() => setView("followup")}>针对回答追问</button><button type="button" aria-pressed={view === "feedback"} onClick={() => setView("feedback")}>查看回答反馈</button></div><div className="cs-practice-result" role="region" aria-label={view === "followup" ? "面试追问" : "回答反馈"}>{view === "followup" ? <><p className="cs-label"><Mic size={12} />继续追问</p><p>两轮测试分别发现了什么？你怎样判断完成率的变化来自配置路径优化？</p></> : <><p className="cs-label"><Sparkles size={12} />下一次回答的改进点</p><p>结果具体。再补充问题证据、方案取舍和指标口径，让面试官理解你的判断过程。</p></>}</div></Scene>;
}

export function CaseScene({ scene }: { scene: SceneKey }) {
  return scene === "workspace" ? <WorkspaceScene /> : scene === "agent" ? <AgentScene /> : scene === "job-fit" ? <JobFitScene /> : scene === "progress" ? <ProgressScene /> : <PracticeScene />;
}
