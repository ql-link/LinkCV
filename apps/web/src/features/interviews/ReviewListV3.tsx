import { t, useLocale } from "@/i18n";
import { useMemo, useState } from "react";
import { Icon } from "@/v3/Icon";
import { navigateTo } from "../../routing";
import { CareerPageHead } from "./careerV3";
import "./review-list-v3.css";
type ReviewItem = { id: string; applicationId: string; company: string; role: string; stage: string; mode: string; startAt: string; endAt: string; status: string; improvement: string; review: string; reviewScore?: number | null; reviewState?: string };
function dateLabel(value: string) { const date = new Date(value); return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function ReviewListV3({ interviews }: { interviews: ReviewItem[] }) {
  useLocale();
  const [company, setCompany] = useState<string | null>(null);
  const [descending, setDescending] = useState(true);
  const companies = Array.from(new Set(interviews.map((item) => item.company)));
  const completed = interviews.filter((item) => item.status === "completed");
  const scored = completed.filter(item => item.reviewScore != null);
  const average = scored.length ? (scored.reduce((sum, item) => sum + item.reviewScore!, 0) / scored.length).toFixed(1) : null;
  const recent = [...interviews].sort((a, b) => +new Date(b.startAt) - +new Date(a.startAt))[0];
  const visible = useMemo(() => interviews.filter((item) => !company || item.company === company).sort((a, b) => (+new Date(b.startAt) - +new Date(a.startAt)) * (descending ? 1 : -1)), [interviews, company, descending]);
  const open = (item: ReviewItem) => navigateTo(`/career/reviews?session=${encodeURIComponent(item.id)}&application=${encodeURIComponent(item.applicationId)}`);
  return <section className="review-list-v3">
    <CareerPageHead eyebrow={["REVIEWS", t("{value0} 场", { value0: interviews.length })]} title={t("面试复盘")} subtitle={t("{value0} 场面试{value1}{value2}", { value0: interviews.length, value1: average ? t(" · 平均 {value0} 分", { value0: average }) : "", value2: recent ? t(" · 最近一次 {value0}", { value0: dateLabel(recent.startAt) }) : "" })} actions={<div className="v3-seg rv-view"><button type="button" onClick={() => navigateTo("/career/applications")}>{t("看板")}</button><button type="button" aria-pressed>{t("复盘")}</button></div>} />
    {interviews.length ? <><div className="rv-toolbar"><div role="group" aria-label={t("按公司筛选")}><button type="button" aria-pressed={company === null} onClick={() => setCompany(null)}>{t("全部")}</button>{companies.map((name) => <button key={name} type="button" aria-pressed={company === name} onClick={() => setCompany(name)}>{name}</button>)}</div><button type="button" className="rv-sort" onClick={() => setDescending((value) => !value)}>{t("按时间")}{descending ? t("排序") : t("正序")}</button></div>
    <div className="rv-table" role="table" aria-label={t("面试复盘列表")}><div className="rv-table-head" role="row"><span role="columnheader">{t("面试")}</span><span role="columnheader">{t("综合")}</span><span role="columnheader">{t("最需改进")}</span><span role="columnheader">{t("时间")}</span></div>{visible.map((item) => <button className="rv-row" role="row" type="button" key={item.id} onClick={() => open(item)} aria-label={t("{value0} · {value1}，查看复盘", { value0: item.company, value1: item.stage })}><span role="cell" className="rv-info"><strong>{item.company} · {item.stage}</strong><small>{item.role} · {item.mode} · {Math.max(0, Math.round((+new Date(item.endAt) - +new Date(item.startAt)) / 60000))}{t(" 分钟")}</small></span><span role="cell" className="rv-score">{item.status === "completed" && item.reviewScore != null ? <><b>{item.reviewScore!.toFixed(1)}</b><i><span style={{ width: `${item.reviewScore! * 10}%`, background: item.reviewScore! >= 7.5 ? "var(--v3-gn)" : item.reviewScore! >= 7 ? "var(--v3-bl)" : "var(--v3-rd)" }} /></i></> : "—"}</span><span role="cell" className="rv-improvement">{item.reviewState || item.improvement || (item.status === "completed" ? t("上传记录后生成复盘") : item.status === "cancelled" ? t("已取消") : t("面试尚未完成"))}</span><span role="cell" className="rv-time">{dateLabel(item.startAt)}<Icon name="chev" size={12} /></span></button>)}</div>
    <div className="rv-tip"><span><Icon name="spark" size={14} />{t("保存文字记录后生成 AI 复盘；录音可先转写并校对。")}</span><button type="button" onClick={() => open(completed[0] ?? interviews[0])}>{t("粘贴文字记录")}<Icon name="arrow" size={13} /></button></div></> : <div className="rv-empty"><Icon name="text" size={32} /><h2>{t("还没有面试记录")}</h2><p>{t("保存文字记录后生成 AI 复盘；录音可先转写并校对。")}</p><button type="button" className="v3-btn v3-btn-dark" onClick={() => navigateTo("/career/schedule")}>{t("查看面试日程")}</button></div>}
  </section>;
}
