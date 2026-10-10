import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, poolQueryParams, type PoolFilters, type PoolJob, type PoolQuery } from "../../api/client";
import { Button, FeedbackNotice, PageHeader, buttonVariants } from "@/components/ui";
import { careerApplicationPath, navigateTo } from "../../routing";
import { CompanyPicker, PoolCompanyLogo, PoolDialog, PoolSearch, PoolSelect, PoolState, PoolTag } from "./PoolUi";
import { PoolJoinButton, usePoolJoin } from "./PoolJoin";
import { poolDate, poolError, poolRecruitment } from "./jobPoolPresentation";
import "./opportunities.css";

const readQuery = (): PoolQuery => {
  const params = new URLSearchParams(window.location.search);
  const query: PoolQuery = Object.fromEntries([...params].filter(([key, value]) => value && ["keyword", "company_id", "city", "job_category", "recruitment_type"].includes(key)));
  const ids = [...new Set(params.getAll("company_ids").filter(Boolean))].sort();
  if (ids.length) query.company_ids = ids;
  return query;
};
export function OpportunitiesPage({ jobId }: { jobId?: string }) {
  return jobId ? <OpportunityDetail key={jobId} jobId={jobId} /> : <OpportunityList />;
}
function PoolLoading({ detail = false }: { detail?: boolean }) {
  return <section className={detail ? "pool-detail-loading" : "pool-loading-grid"} role="status" aria-label={detail ? "正在加载岗位详情…" : "正在加载官网岗位…"}>
    {Array.from({ length: detail ? 3 : 9 }, (_, index) => <div className="pool-loading-card" key={index}><span /><span /><span /></div>)}
    <span className="sr-only">正在加载</span>
  </section>;
}
function OpportunityList() {
  const [query, setQuery] = useState<PoolQuery>(readQuery);
  const [keyword, setKeyword] = useState(query.keyword ?? "");
  const [filters, setFilters] = useState<PoolFilters>({ companies: [], cities: [], categories: [], recruitment_types: [] });
  const [filterError, setFilterError] = useState(false);
  const [jobs, setJobs] = useState<PoolJob[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const queryKey = JSON.stringify(query);
  const join = usePoolJoin((jobId, id) => setJobs((previous) => previous.map((item) => item.id === jobId ? { ...item, joined_application_id: id } : item)),
    (id) => setJobs((previous) => previous.map((item) => item.id === id ? { ...item, availability_status: "closed" } : item)));
  useEffect(() => {
    const onNavigation = () => { const next = readQuery(); setQuery(next); setKeyword(next.keyword ?? ""); };
    window.addEventListener("popstate", onNavigation);
    return () => window.removeEventListener("popstate", onNavigation);
  }, []);
  useEffect(() => {
    let cancelled = false;
    api.poolFilters().then((data) => { if (!cancelled) { setFilters(data); setFilterError(false); } }).catch(() => { if (!cancelled) setFilterError(true); });
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => {
    const current = ++sequence.current;
    setLoading(true); setLoadingMore(false); setError(""); setCursor(null); setJobs([]);
    api.listPoolJobs(JSON.parse(queryKey) as PoolQuery).then((page) => {
      if (current === sequence.current) { setJobs(page.items); setCursor(page.next_cursor); }
    }).catch((reason) => { if (current === sequence.current) setError(poolError(reason)); })
      .finally(() => { if (current === sequence.current) setLoading(false); });
    return () => { sequence.current++; };
  }, [queryKey, revision]);
  const changeQuery = (next: PoolQuery) => {
    const params = poolQueryParams(next);
    navigateTo(`/career/opportunities${params.size ? `?${params}` : ""}`, { replace: true });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = keyword.trim();
    if (text && (text.length < 2 || text.length > 100)) { setError("关键词需要包含 2～100 个字符。"); return; }
    setError("");
    changeQuery({ ...query, keyword: text || undefined });
  };
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const current = sequence.current;
    setLoadingMore(true); setError("");
    try {
      const page = await api.listPoolJobs({ ...query, cursor });
      if (current === sequence.current) {
        setJobs((previous) => [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))]);
        setCursor(page.next_cursor);
      }
    } catch (reason) { if (current === sequence.current) setError(poolError(reason)); }
    finally { if (current === sequence.current) setLoadingMore(false); }
  };
  const select = (label: string, key: "city" | "job_category", options: Array<{ value: string; label: string }>) =>
    <PoolSelect label={label} value={query[key] ?? "all"} options={[{ value: "all", label }, ...options]} onChange={({ target }) => changeQuery({ ...query, [key]: target.value === "all" ? undefined : target.value })} />;
  return <main className="pool-theme pool-page">
    <PageHeader eyebrow={null} title="发现岗位" description="从企业官方招聘渠道，发现下一份工作。" actions={<Button variant="outline" onClick={() => setRevision((value) => value + 1)}>刷新</Button>} />
    <div className="pool-toolbar">
      <div className="pool-channels" role="group" aria-label="招聘类型">{[["", "全部"], ["campus", "校招"], ["internship", "实习"], ["experienced", "社招"]].map(([value, label]) => <button type="button" key={value} aria-pressed={(query.recruitment_type ?? "") === value} onClick={() => changeQuery({ ...query, recruitment_type: value || undefined })}>{label}</button>)}</div>
      <form className="pool-search" onSubmit={submit}><PoolSearch aria-label="搜索岗位标题或正文" placeholder="搜索岗位名称 / 关键词" maxLength={100} value={keyword} onChange={(event) => setKeyword(event.target.value)} /><button type="submit" className="sr-only">搜索</button></form>
    </div>
    <div className="pool-filters" aria-label="筛选岗位">
      <CompanyPicker companies={filters.companies} selected={[...new Set([...(query.company_ids ?? []), ...(query.company_id ? [query.company_id] : [])])]} onApply={(ids) => changeQuery({ ...query, company_id: undefined, company_ids: ids.length ? ids : undefined })} />
      {select("全部城市", "city", filters.cities.map((city) => ({ value: city, label: city })))}
      {select("全部类别", "job_category", filters.categories.map((category) => ({ value: category, label: category })))}
      <button className="pool-clear" type="button" onClick={() => changeQuery({})}>清除筛选</button>
    </div>
    {filterError && <FeedbackNotice kind="warning">筛选项暂时无法加载，可刷新重试；关键词搜索仍可使用。</FeedbackNotice>}
    <div className="pool-results-summary"><span>官网岗位</span><span>按最近收录展示</span></div>
    {error && (error === "关键词需要包含 2～100 个字符。" ? <FeedbackNotice kind="warning">{error}</FeedbackNotice> : <PoolState title="加载失败" description={error} error><Button variant="outline" onClick={() => jobs.length && cursor ? void loadMore() : setRevision((value) => value + 1)}>重新加载</Button></PoolState>)}
    {loading ? <PoolLoading /> : !jobs.length && !error ? <PoolState title="没有符合条件的岗位" description="换个关键词，或减少企业、城市和岗位类别限制。"><Button onClick={() => changeQuery({})}>清除筛选</Button></PoolState> : <ul className="pool-list">
      {jobs.map((job) => <li key={job.id} className="pool-card">
        <div className="pool-card-company"><PoolCompanyLogo company={job.company} jobTitle={job.title} /><span>{job.company.name}</span><span className="pool-card-origin">官网</span></div>
        <a className="pool-title" href={`/career/opportunities/${job.id}${window.location.search}`} title={job.title} onClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigateTo(event.currentTarget.getAttribute("href")!); } }}>{job.title}</a>
        <p className="pool-card-meta" title={`${job.locations.cities.join(" / ")} · ${poolRecruitment(job)}${job.category ? ` · ${job.category}` : ""}`}>{job.locations.cities.join(" / ") || "地点未标明"} · {poolRecruitment(job)}{job.category ? ` · ${job.category}` : ""}</p>
        <div className="pool-card-footer"><span className={job.availability_status === "missing" ? "pool-card-warning" : ""}>{job.availability_status === "missing" ? "本轮未发现 · 暂保留" : job.salary_text || "薪资未标明"}</span><PoolJoinButton job={job} joiningId={join.joiningId} onJoin={(item) => void join.join(item)} compact /></div>
      </li>)}
    </ul>}
    <footer className="pool-list-footer"><span>招聘信息以企业官网为准</span>{cursor && <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载…" : "加载更多"}</Button>}</footer>
    {join.dialog}
  </main>;
}

function Description({ text }: { text?: string }) {
  const sections: Array<{ title: string; lines: string[] }> = [];
  for (const line of (text ?? "").split("\n")) {
    const heading = /^(工作职责|岗位职责|职位描述|任职要求|岗位要求|职位要求|工作地点)[:：]?\s*$/.exec(line.trim());
    if (heading) sections.push({ title: heading[1], lines: [] });
    else { if (!sections.length) sections.push({ title: "岗位描述", lines: [] }); sections[sections.length - 1]!.lines.push(line); }
  }
  return <section className="pool-body" aria-label="岗位描述">{sections.length ? sections.map((section, i) => <div key={i}><h2>{section.title}</h2><p>{section.lines.join("\n")}</p></div>) : <><h2>岗位描述</h2><p>官网暂未提供岗位正文，请查看招聘官网。</p></>}</section>;
}
function OpportunityDetail({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<PoolJob | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [showAvailability, setShowAvailability] = useState(false);
  const join = usePoolJoin((_jobId, id) => setJob((item) => item && { ...item, joined_application_id: id }), () => setJob((item) => item && { ...item, availability_status: "closed" }));
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    api.getPoolJob(jobId).then((data) => { if (!cancelled) setJob(data); }).catch((reason) => { if (!cancelled) setError(poolError(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobId, revision]);
  return <main className="pool-theme pool-page pool-detail">
    <button type="button" className="pool-back" onClick={() => navigateTo(`/career/opportunities${window.location.search}`)}>← 返回发现岗位</button>
    {error && <PoolState title="加载失败" description={error} error><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>重新加载</Button></PoolState>}
    {loading ? <PoolLoading detail /> : job && <>
      <header className="pool-detail-heading"><PoolCompanyLogo company={job.company} jobTitle={job.title} size={48} /><div><p>{job.company.name}</p><h1>{job.title}</h1><p>{job.locations.cities.join(" / ") || "地点未标明"} · {poolRecruitment(job)}{job.category ? ` · ${job.category}` : ""}</p></div></header>
      {job.availability_status !== "active" && <FeedbackNotice kind="warning">{job.availability_status === "closed" ? "该岗位已从官网下线，已有求职记录仍可继续管理。" : "本轮同步未发现该岗位，暂时保留；请到官网确认招聘状态。"}</FeedbackNotice>}
      <div className="pool-detail-columns"><Description text={job.description} /><aside className="pool-detail-info">
        <h2>岗位信息</h2><dl><div><dt>招聘类型</dt><dd>{poolRecruitment(job)}</dd></div><div><dt>岗位类别</dt><dd>{job.category || "官网未标明"}</dd></div><div><dt>薪资待遇</dt><dd>{job.salary_text || "官网未标明"}</dd></div></dl>
        <PoolJoinButton job={job} joiningId={join.joiningId} onJoin={(item) => void join.join(item)} />
        <a className={buttonVariants({ variant: "outline" })} href={job.source_url} target="_blank" rel="noopener noreferrer">查看招聘官网 ↗</a>
        <p className="pool-snapshot-rule">加入后保存为个人岗位，后续官网更新不会覆盖你的记录。</p><hr />
        {job.availability_status === "active" ? <PoolTag tone="success">官网在招</PoolTag> : <button type="button" className="pool-availability" aria-label="查看岗位招聘状态" onClick={() => setShowAvailability(true)}><PoolTag tone="warning">{job.availability_status === "closed" ? "岗位已下线" : "暂未发现"}</PoolTag></button>}
        <p className="pool-muted">最近发现 · {poolDate(job.last_seen_at)}</p>
        {!job.source.is_enabled && <p className="pool-muted">来源已暂停 · 上次完整同步 {poolDate(job.source.last_complete_at)}</p>}
      </aside></div>
      <footer className="pool-source"><p>岗位描述来自企业官方招聘页面</p><a href={job.source_url} target="_blank" rel="noopener noreferrer">查看企业官网原文 ↗</a></footer>
    </>}
    {job && showAvailability && <PoolDialog title={job.availability_status === "closed" ? "岗位已下线" : "暂未发现岗位"} onClose={() => setShowAvailability(false)} footer={job.availability_status === "closed" && job.joined_application_id
      ? <Button onClick={() => navigateTo(careerApplicationPath(job.joined_application_id!))}>查看求职记录</Button>
      : <a className={buttonVariants()} href={job.source_url} target="_blank" rel="noopener noreferrer">查看招聘官网</a>}>
      <PoolTag tone="warning">提示</PoolTag>
      <p>{job.availability_status === "closed" ? "该岗位已从官网下线。已有求职记录仍可继续管理。" : "本轮同步暂未发现该岗位，仍保留岗位信息。请到招聘官网核实。"}</p>
    </PoolDialog>}
    {join.dialog}
  </main>;
}
