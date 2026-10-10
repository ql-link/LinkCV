import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { api, ApiRequestError, poolQueryParams, type PoolFilters, type PoolJob, type PoolQuery } from "../../api/client";
import { navigateTo } from "../../routing";
import { Icon } from "../../v3/Icon";
import { PageEyebrow, SearchBox, Select } from "../../v3/primitives";
import { Sk } from "../../v3/skeletons";
import { ErrorCardV3 } from "../../v3/states";
import { PoolEmptyArt, PoolUnavailableArt } from "./PoolArt";
import { PoolJoinButton, usePoolJoin } from "./PoolJoin";
import { CompanyFilter, PoolCompanyLogo } from "./PoolUi";
import { poolCollected, poolError, poolRecruitment, poolRelative } from "./jobPoolPresentation";
import { loadPreferredPoolQuery } from "./jobPoolPreferences";
import "./opportunities.css";

const LIST_PATH = "/career/opportunities";
const KEYWORD_ERROR = "关键词需要包含 2～100 个字符。";
const RECRUITMENT = [{ value: "", label: "全部" }, { value: "campus", label: "校招" }, { value: "internship", label: "实习" }, { value: "experienced", label: "社招" }] as const;
/** Below this content width the two columns collapse into list → detail. */
const WIDE_MIN = 900;

const readQuery = (): PoolQuery => {
  const params = new URLSearchParams(window.location.search);
  const query: PoolQuery = Object.fromEntries([...params].filter(([key, value]) => value && ["keyword", "company_id", "city", "job_category", "recruitment_type"].includes(key)));
  const ids = [...new Set(params.getAll("company_ids").filter(Boolean))].sort();
  if (ids.length) query.company_ids = ids;
  return query;
};
const jobPath = (id: string) => `${LIST_PATH}/${encodeURIComponent(id)}${window.location.search}`;
const followLink = (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  navigateTo(event.currentTarget.getAttribute("href")!);
};

function useWide() {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setWide(node.clientWidth === 0 || node.clientWidth >= WIDE_MIN);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, wide] as const;
}

/** Master-detail: the list stays mounted while `jobId` (from the URL) picks the job on the right. */
export function OpportunitiesPage({ jobId }: { jobId?: string }) {
  const [rootRef, wide] = useWide();
  const [query, setQuery] = useState<PoolQuery>(readQuery);
  const [keyword, setKeyword] = useState(query.keyword ?? "");
  const [keywordError, setKeywordError] = useState(false);
  const [filters, setFilters] = useState<PoolFilters>({ companies: [], cities: [], categories: [], recruitment_types: [] });
  const [filterError, setFilterError] = useState(false);
  const [jobs, setJobs] = useState<PoolJob[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [details, setDetails] = useState<Record<string, PoolJob>>({});
  const sequence = useRef(0);
  const queryKey = JSON.stringify(query);
  const patchJob = (id: string, change: Partial<PoolJob>) => {
    setJobs((previous) => previous.map((item) => item.id === id ? { ...item, ...change } : item));
    setDetails((previous) => previous[id] ? { ...previous, [id]: { ...previous[id]!, ...change } } : previous);
  };
  const join = usePoolJoin((id, applicationId) => patchJob(id, { joined_application_id: applicationId }), (id) => patchJob(id, { availability_status: "closed" }));

  useEffect(() => {
    const onNavigation = () => { const next = readQuery(); setQuery(next); setKeyword(next.keyword ?? ""); };
    window.addEventListener("popstate", onNavigation);
    return () => window.removeEventListener("popstate", onNavigation);
  }, []);
  useEffect(() => {
    // Preferences only seed an unfiltered visit; links with filters keep their own.
    if (Object.keys(readQuery()).length) return;
    let cancelled = false;
    loadPreferredPoolQuery().then((preferred) => {
      if (!cancelled && preferred && !Object.keys(readQuery()).length) changeQuery(preferred);
    }).catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let cancelled = false;
    api.poolFilters().then((data) => { if (!cancelled) { setFilters(data); setFilterError(false); } }).catch(() => { if (!cancelled) setFilterError(true); });
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => {
    const current = ++sequence.current;
    setLoading(true); setLoadingMore(false); setError(""); setMoreError(false); setCursor(null); setJobs([]);
    api.listPoolJobs(JSON.parse(queryKey) as PoolQuery).then((page) => {
      if (current === sequence.current) { setJobs(page.items); setCursor(page.next_cursor); }
    }).catch((reason) => { if (current === sequence.current) setError(poolError(reason)); })
      .finally(() => { if (current === sequence.current) setLoading(false); });
    return () => { sequence.current++; };
  }, [queryKey, revision]);

  const changeQuery = (next: PoolQuery) => {
    const params = poolQueryParams(next);
    navigateTo(`${LIST_PATH}${params.size ? `?${params}` : ""}`, { replace: true });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = keyword.trim();
    if (text && (text.length < 2 || text.length > 100)) { setKeywordError(true); return; }
    setKeywordError(false);
    changeQuery({ ...query, keyword: text || undefined });
  };
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const current = sequence.current;
    setLoadingMore(true); setMoreError(false);
    try {
      const page = await api.listPoolJobs({ ...query, cursor });
      if (current === sequence.current) {
        setJobs((previous) => [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))]);
        setCursor(page.next_cursor);
      }
    } catch { if (current === sequence.current) setMoreError(true); }
    finally { if (current === sequence.current) setLoadingMore(false); }
  };

  const selectedCompanies = [...new Set([...(query.company_ids ?? []), ...(query.company_id ? [query.company_id] : [])])];
  const narrowed = Boolean(selectedCompanies.length || query.city || query.job_category || query.recruitment_type);
  const filtered = narrowed || Boolean(query.keyword);
  const clear = () => { setKeyword(""); setKeywordError(false); changeQuery({}); };
  const select = (placeholder: string, all: string, key: "city" | "job_category", values: string[]) =>
    <Select size="sm" className="pool-filter" label={placeholder} placeholder={placeholder} value={query[key] ?? ""}
      options={[{ value: "all", label: all }, ...values.map((value) => ({ value, label: value }))]}
      onChange={(value) => changeQuery({ ...query, [key]: value === "all" ? undefined : value })} />;

  // Wide screens always show a job on the right; narrow screens open one only when chosen.
  const selectedId = jobId ?? (wide && !loading ? jobs[0]?.id : undefined);
  const singleDetail = !wide && Boolean(jobId);
  const companyNames = filters.companies.filter((company) => selectedCompanies.includes(company.id)).map((company) => company.name);
  const summary = [query.keyword, RECRUITMENT.find((item) => item.value && item.value === query.recruitment_type)?.label, query.city, query.job_category,
    companyNames.length ? `${companyNames[0]}${companyNames.length > 1 ? ` 等 ${companyNames.length} 家` : ""}` : undefined].filter(Boolean).join(" · ");
  const empty = !loading && !error && !jobs.length && !jobId;

  return <div ref={rootRef} className={`v3-page pool-page${wide ? " is-wide" : " is-narrow"}${singleDetail ? " is-detail" : ""}`}>
    {singleDetail ? <button type="button" className="v3-link pool-back" onClick={() => navigateTo(`${LIST_PATH}${window.location.search}`)}><Icon name="chevl" size={12} />返回岗位列表</button> : <>
      <header className="pool-head">
        <div>
          <PageEyebrow segments={["OPPORTUNITIES", "企业官网直招"]} />
          <h1 className="v3-page-title">发现岗位</h1>
        </div>
        <form className="pool-search" role="search" onSubmit={submit}>
          <SearchBox label="搜索岗位名称、职责或技能" placeholder="搜索岗位名称、职责或技能" value={keyword} onChange={(value) => { setKeyword(value); setKeywordError(false); }} />
          <button type="submit" className="sr-only">搜索</button>
        </form>
      </header>
      <div className="pool-bar">
        <div className="pool-tabs" role="tablist" aria-label="招聘类型">
          {RECRUITMENT.map((item) => <button key={item.value} type="button" role="tab" aria-selected={(query.recruitment_type ?? "") === item.value}
            className={(query.recruitment_type ?? "") === item.value ? "is-active" : undefined} onClick={() => changeQuery({ ...query, recruitment_type: item.value || undefined })}>{item.label}</button>)}
        </div>
        <div className="pool-filters" aria-label="筛选岗位">
          {filtered && <button type="button" className="v3-link pool-clear" onClick={clear}>清除筛选</button>}
          <CompanyFilter companies={filters.companies} selected={selectedCompanies} onChange={(ids) => changeQuery({ ...query, company_id: undefined, company_ids: ids.length ? ids : undefined })} />
          {select("城市", "全部城市", "city", filters.cities)}
          {select("类别", "全部类别", "job_category", filters.categories)}
        </div>
      </div>
      {keywordError && <p className="pool-note is-warn" role="alert">{KEYWORD_ERROR}</p>}
      {filterError && <p className="pool-note is-warn">筛选项暂时无法加载，关键词搜索仍可使用。<button type="button" className="v3-link" onClick={() => setRevision((value) => value + 1)}>重试</button></p>}
    </>}
    {error ? <div className="pool-state"><ErrorCardV3 title="岗位暂时无法加载" description="网络不稳定或服务暂时不可用，筛选条件已保留。" onRetry={() => setRevision((value) => value + 1)} /></div>
      : empty ? <div className="pool-state">
        <section className="v3-empty pool-empty">
          <div className="v3-stage has-dots"><PoolEmptyArt summary={filtered ? summary : "企业官网直招"} /></div>
          {filtered ? <>
            <h3>没有符合条件的岗位</h3>
            <p>换个关键词，或减少企业、城市、类别的筛选条件试试。</p>
            <div className="v3-empty-actions">
              <button type="button" className="v3-btn v3-btn-dark" onClick={clear}>清除筛选</button>
              {query.keyword && narrowed && <button type="button" className="v3-link" onClick={() => changeQuery({ keyword: query.keyword })}>只用关键词搜索</button>}
            </div>
          </> : <>
            <h3>暂时还没有岗位</h3>
            <p>企业官网的岗位同步后会出现在这里，稍后再来看看。</p>
          </>}
        </section>
      </div>
      : <div className="pool-split">
        {!singleDetail && <nav className="pool-list" aria-label="岗位列表">
          {loading ? <ul role="status" aria-label="正在加载官网岗位…">
            {Array.from({ length: 7 }, (_, index) => <li key={index} className="pool-item is-loading" aria-hidden="true">
              <Sk w={32} h={32} r={7} /><span className="pool-item-body"><Sk w="62%" h={13} /><Sk w="40%" h={10} /><Sk w="30%" h={10} /></span>
            </li>)}
          </ul> : <ul>
            {jobs.map((job) => <li key={job.id}>
              <a className={`pool-item${job.id === selectedId ? " is-selected" : ""}${job.availability_status === "closed" ? " is-closed" : ""}`} href={jobPath(job.id)}
                aria-current={job.id === selectedId ? "true" : undefined} onClick={followLink}>
                <PoolCompanyLogo company={job.company} size={32} />
                <span className="pool-item-body">
                  <span className="pool-item-top"><strong title={job.title}>{job.title}</strong><time dateTime={job.first_seen_at}>{poolRelative(job.first_seen_at)}</time></span>
                  <span className="pool-item-company">{job.company.name} · {job.locations.cities.join(" / ") || "地点未标明"}</span>
                  <span className="pool-item-meta">
                    <span>{[poolRecruitment(job), job.category].filter(Boolean).join(" · ")}{job.salary_text && <b> · {job.salary_text}</b>}</span>
                    {job.joined_application_id ? <em className="is-joined"><Icon name="check" size={10} />已加入</em>
                      : job.availability_status === "closed" ? <em>已下线</em>
                        : job.availability_status === "missing" ? <em className="is-warn">本轮未发现</em> : null}
                  </span>
                </span>
              </a>
            </li>)}
          </ul>}
          {!loading && <footer className="pool-list-foot">
            {moreError ? <span role="alert">加载失败，<button type="button" className="v3-link is-blue" onClick={() => void loadMore()}>重试</button></span>
              : loadingMore ? <span role="status">正在加载…</span>
                : cursor ? <button type="button" className="v3-btn v3-btn-ghost" onClick={() => void loadMore()}>加载更多</button>
                  : <span>没有更多了</span>}
          </footer>}
        </nav>}
        {(wide || singleDetail) && <section className="pool-detail" aria-label="岗位详情">
          {selectedId ? <OpportunityDetail key={selectedId} jobId={selectedId} cached={details[selectedId]} joiningId={join.joiningId}
            onLoaded={(job) => setDetails((previous) => ({ ...previous, [job.id]: job }))} onJoin={(job) => void join.join(job)} />
            : loading ? <DetailSkeleton /> : null}
        </section>}
      </div>}
    {join.feedback}
  </div>;
}

function DetailSkeleton() {
  return <div className="pool-detail-scroll" role="status" aria-label="正在加载岗位详情…">
    <div className="pool-detail-skeleton" aria-hidden="true">
      <Sk w={120} h={14} /><Sk w="55%" h={28} r={6} /><Sk w="35%" h={12} />
      <Sk w="100%" h={1} /><Sk w={80} h={14} /><Sk w="90%" h={12} /><Sk w="80%" h={12} /><Sk w="85%" h={12} />
    </div>
  </div>;
}

function Description({ text }: { text?: string }) {
  const sections: Array<{ title: string; lines: string[] }> = [];
  for (const line of (text ?? "").split("\n")) {
    const heading = /^(工作职责|岗位职责|职位描述|任职要求|岗位要求|职位要求|工作地点)[:：]?\s*$/.exec(line.trim());
    if (heading) sections.push({ title: heading[1]!, lines: [] });
    else { if (!sections.length) sections.push({ title: "岗位描述", lines: [] }); sections[sections.length - 1]!.lines.push(line); }
  }
  const visible = sections.filter((section) => section.lines.join("").trim());
  return <div className="pool-body">{visible.length ? visible.map((section, index) => <section key={index}><h2>{section.title}</h2><p>{section.lines.join("\n").trim()}</p></section>)
    : <section><h2>岗位描述</h2><p>官网暂未提供岗位正文，请查看招聘官网。</p></section>}</div>;
}

/** Join / offline changes reach `cached` through the page's shared patch, so list and detail stay in step. */
function OpportunityDetail({ jobId, cached, joiningId, onLoaded, onJoin }: {
  jobId: string; cached?: PoolJob; joiningId: string | null; onLoaded: (job: PoolJob) => void; onJoin: (job: PoolJob) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">(cached ? "ready" : "loading");
  const [revision, setRevision] = useState(0);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const hasCache = useRef(Boolean(cached));
  useEffect(() => {
    // A job opened before reuses its detail; "重新加载" always fetches again.
    if (hasCache.current && revision === 0) return;
    let cancelled = false;
    setState("loading");
    api.getPoolJob(jobId).then((data) => { if (!cancelled) { loaded.current(data); setState("ready"); } })
      .catch((reason) => { if (!cancelled) setState(reason instanceof ApiRequestError && reason.message === "JOB_POOL_NOT_FOUND" ? "missing" : "error"); });
    return () => { cancelled = true; };
  }, [jobId, revision]);
  if (state === "missing") return <div className="pool-detail-state">
    <section className="v3-empty pool-empty is-compact" role="alert">
      <div className="v3-stage has-dots"><PoolUnavailableArt tag="链接已失效" /></div>
      <h3>没有找到这个岗位</h3>
      <p>岗位可能已被移除，或链接不完整。可以在左侧继续浏览其他岗位。</p>
      <div className="v3-empty-actions"><button type="button" className="v3-link is-blue" onClick={() => navigateTo(LIST_PATH)}>返回全部岗位</button></div>
    </section>
  </div>;
  if (state === "error") return <div className="pool-detail-state">
    <ErrorCardV3 title="岗位详情暂时无法加载" description="左侧列表仍可继续浏览，稍后重试即可。" onRetry={() => setRevision((value) => value + 1)} />
  </div>;
  if (!cached || state === "loading") return <DetailSkeleton />;
  const job = cached;
  const status = job.joined_application_id ? { tone: "success", text: "已加入求职进程" }
    : job.availability_status === "closed" ? { tone: "muted", text: "官网已下线" }
      : job.availability_status === "missing" ? { tone: "warn", text: "本轮未发现，暂时保留" } : { tone: "success", text: "官网在招" };
  const meta = [job.locations.cities.join(" / ") || "地点未标明", poolRecruitment(job), job.category].filter(Boolean).join(" · ");
  return <article className="pool-detail-inner">
    <div className="pool-detail-scroll">
      <div className="pool-detail-company"><PoolCompanyLogo company={job.company} size={32} /><span>{job.company.name}</span></div>
      <h1 className="pool-detail-title">{job.title}</h1>
      <p className="pool-detail-meta">{job.salary_text && <><b>{job.salary_text}</b><i aria-hidden="true" /></>}{meta}</p>
      {job.availability_status !== "active" && !job.joined_application_id && <p className="pool-note is-warn" role="status"><Icon name="alert" size={14} />
        {job.availability_status === "closed" ? "该岗位已从官网下线，无法再加入；已有求职记录仍可继续管理。" : "本轮同步未发现该岗位，暂时保留；请到官网确认招聘状态。"}</p>}
      <hr />
      <Description text={job.description} />
    </div>
    <footer className="pool-actions">
      <p className={`pool-status is-${status.tone}`}><span aria-hidden="true" />{status.text} · {poolCollected(job.first_seen_at)}</p>
      <a className="v3-btn v3-btn-ghost is-lg" href={job.source_url} target="_blank" rel="noopener noreferrer">查看招聘官网<Icon name="ext" size={12} /></a>
      <PoolJoinButton job={job} joiningId={joiningId} onJoin={onJoin} />
    </footer>
  </article>;
}
