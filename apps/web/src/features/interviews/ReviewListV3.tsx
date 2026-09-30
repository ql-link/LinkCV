import { useMemo, useState } from "react";
import { BeTag } from "@/v3/primitives";
import { Icon } from "@/v3/Icon";
import { navigateTo } from "../../routing";
import { CareerPageHead } from "./careerV3";
import "./review-list-v3.css";
type ReviewItem = { id: string; applicationId: string; company: string; role: string; stage: string; mode: string; startAt: string; endAt: string; status: string; improvement: string; review: string };
// 评分接口尚未提供；仅为已完成场次呈现 Figma 的模拟评分。
function scoreFor(item: ReviewItem) { return [8.2, 7.6, 7.1, 8.0, 6.4][Array.from(item.id).reduce((n, c) => n + c.charCodeAt(0), 0) % 5]; }
function dateLabel(value: string) { const date = new Date(value); return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function ReviewListV3({ interviews }: { interviews: ReviewItem[] }) {
  const [company, setCompany] = useState<string | null>(null);
  const [descending, setDescending] = useState(true);
  const companies = Array.from(new Set(interviews.map((item) => item.company)));
  const completed = interviews.filter((item) => item.status === "completed");
  const average = completed.length ? (completed.reduce((sum, item) => sum + scoreFor(item), 0) / completed.length).toFixed(1) : null;
  const recent = [...interviews].sort((a, b) => +new Date(b.startAt) - +new Date(a.startAt))[0];
  const visible = useMemo(() => interviews.filter((item) => !company || item.company === company).sort((a, b) => (+new Date(b.startAt) - +new Date(a.startAt)) * (descending ? 1 : -1)), [interviews, company, descending]);
  const open = (item: ReviewItem) => navigateTo(`/career/reviews?session=${encodeURIComponent(item.id)}&application=${encodeURIComponent(item.applicationId)}`);
  return <section className="review-list-v3">
    <CareerPageHead eyebrow={["REVIEWS", `${interviews.length} 场`]} title={<>面试复盘 <BeTag /></>} subtitle={`${interviews.length} 场面试${average ? ` · 平均 ${average} 分` : ""}${recent ? ` · 最近一次 ${dateLabel(recent.startAt)}` : ""}`} actions={<div className="v3-seg rv-view"><button type="button" onClick={() => navigateTo("/career/applications")}>看板</button><button type="button" aria-pressed>复盘</button></div>} />
    {interviews.length ? <><div className="rv-toolbar"><div role="group" aria-label="按公司筛选"><button type="button" aria-pressed={company === null} onClick={() => setCompany(null)}>全部</button>{companies.map((name) => <button key={name} type="button" aria-pressed={company === name} onClick={() => setCompany(name)}>{name}</button>)}</div><button type="button" className="rv-sort" onClick={() => setDescending((value) => !value)}>按时间{descending ? "排序" : "正序"}</button></div>
    <div className="rv-table" role="table" aria-label="面试复盘列表"><div className="rv-table-head" role="row"><span role="columnheader">面试</span><span role="columnheader">综合</span><span role="columnheader">最需改进</span><span role="columnheader">时间</span></div>{visible.map((item) => <button className="rv-row" role="row" type="button" key={item.id} onClick={() => open(item)} aria-label={`${item.company} · ${item.stage}，查看复盘`}><span role="cell" className="rv-info"><strong>{item.company} · {item.stage}</strong><small>{item.role} · {item.mode} · {Math.max(0, Math.round((+new Date(item.endAt) - +new Date(item.startAt)) / 60000))} 分钟</small></span><span role="cell" className="rv-score">{item.status === "completed" ? <><b>{scoreFor(item).toFixed(1)}</b><i><span style={{ width: `${scoreFor(item) * 10}%`, background: scoreFor(item) >= 7.5 ? "var(--v3-gn)" : scoreFor(item) >= 7 ? "var(--v3-bl)" : "var(--v3-rd)" }} /></i></> : "—"}</span><span role="cell" className="rv-improvement">{item.improvement || (item.status === "completed" ? "上传记录后生成复盘" : item.status === "cancelled" ? "已取消" : "面试尚未完成")}</span><span role="cell" className="rv-time">{dateLabel(item.startAt)}<Icon name="chev" size={12} /></span></button>)}</div>
    <div className="rv-tip"><span><Icon name="spark" size={14} />面试结束后上传录音或粘贴文字记录，AI 会自动生成复盘。</span><button type="button" onClick={() => open(completed[0] ?? interviews[0])}>去上传录音<Icon name="arrow" size={13} /></button></div></> : <div className="rv-empty"><Icon name="text" size={32} /><h2>还没有面试记录</h2><p>面试结束后上传录音或粘贴文字记录，AI 会自动生成复盘。</p><button type="button" className="v3-btn v3-btn-dark" onClick={() => navigateTo("/career/schedule")}>查看面试日程</button></div>}
  </section>;
}
