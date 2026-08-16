import { useEffect, useRef, useState } from "react";
import { Archive, BriefcaseBusiness, Download, MapPin, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { api, ApiRequestError, type JobDescriptionSummary } from "../../api/client";
import { Button, ConfirmDialog } from "@/components/ui";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { jobDetailPath, navigateTo } from "../../routing";
import { PluginInstallDialog } from "./PluginInstallDialog";
import "./jobs.css";

type JobScope = "active" | "archived" | "all";

export function JobCenterPage() {
  const [scope, setScope] = useState<JobScope>("active");
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<JobDescriptionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JobDescriptionSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPluginInstall, setShowPluginInstall] = useState(false);
  const activeQueryRef = useRef({ scope, keyword: keyword.trim() });
  activeQueryRef.current = { scope, keyword: keyword.trim() };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNextCursor(null);
    const timer = window.setTimeout(() => {
      void api.listJobDescriptions({ scope, keyword: keyword.trim() || undefined })
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setNextCursor(result.next_cursor);
        })
        .catch(() => {
          if (!cancelled) setError("无法加载 JD 列表，请稍后重试。");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword, scope]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const requestQuery = { scope, keyword: keyword.trim(), cursor: nextCursor };
    setLoadingMore(true);
    try {
      const result = await api.listJobDescriptions({
        scope: requestQuery.scope,
        keyword: requestQuery.keyword || undefined,
        cursor: requestQuery.cursor,
      });
      if (
        activeQueryRef.current.scope !== requestQuery.scope
        || activeQueryRef.current.keyword !== requestQuery.keyword
      ) return;
      setItems((current) => [...current, ...result.items]);
      setNextCursor(result.next_cursor);
    } catch {
      if (
        activeQueryRef.current.scope === requestQuery.scope
        && activeQueryRef.current.keyword === requestQuery.keyword
      ) setError("无法加载更多 JD，请稍后重试。");
    } finally {
      setLoadingMore(false);
    }
  };

  const changeArchived = async (job: JobDescriptionSummary) => {
    if (busyId) return;
    setBusyId(job.id);
    setError(null);
    try {
      const result = job.archived_at
        ? await api.restoreJobDescription(job.id, job.lock_version)
        : await api.archiveJobDescription(job.id, job.lock_version);
      const updated = result.job_description;
      if (scope === "all") {
        setItems((current) => current.map((item) => item.id === job.id ? updated : item));
      } else {
        setItems((current) => current.filter((item) => item.id !== job.id));
      }
    } catch {
      setError("岗位状态已经变化，请刷新列表后重试。");
    } finally {
      setBusyId(null);
    }
  };

  const deleteJob = async () => {
    if (!pendingDelete || busyId) return;
    setBusyId(pendingDelete.id);
    setError(null);
    try {
      await api.deleteJobDescription(pendingDelete.id);
      setItems((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (deleteError) {
      setError(deleteErrorMessage(deleteError));
      setPendingDelete(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="dashboard-content job-center-content">
        <WorkspacePageHero
          eyebrow="岗位资料库"
          title="JD 中心"
          description="把岗位身份和下一步判断放在第一层，来源与更新时间退到辅助信息。"
          actions={(
            <>
              <Button variant="ghost" icon={<Download size={15} />} onClick={() => setShowPluginInstall(true)}>安装采集插件</Button>
              <Button icon={<Plus size={15} />} onClick={() => navigateTo("/jobs/new")}>新建 JD</Button>
            </>
          )}
        />

        <div className="job-toolbar">
          <label className="job-search-field">
            <span>搜索职位</span>
            <span className="job-search">
              <Search size={15} />
              <input aria-label="搜索 JD" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="职位、公司或技能" />
            </span>
          </label>
          <div className="job-filter-row">
            <div className="job-scope-tabs" aria-label="归档范围">
              {(["all", "active", "archived"] as const).map((value) => <button key={value} type="button" className={scope === value ? "is-active" : ""} onClick={() => setScope(value)}>{value === "active" ? "活动" : value === "archived" ? "已归档" : "全部"}</button>)}
            </div>
            <span className="job-sort-note">按最近更新</span>
          </div>
        </div>

        {error && <div className="job-error" role="alert">{error}</div>}

        {loading ? (
          <div className="job-list-state">正在加载 JD…</div>
        ) : items.length === 0 ? (
          <div className="job-empty-state">
            <BriefcaseBusiness size={44} strokeWidth={1.2} />
            <h2>{keyword ? "没有匹配的 JD" : scope === "archived" ? "没有已归档 JD" : "还没有 JD"}</h2>
            <p>{keyword ? "换个关键词试试。" : "手工填写一条结构化岗位信息，后续可继续编辑和整理。"}</p>
            {!keyword && scope !== "archived" && <Button icon={<Plus size={15} />} onClick={() => navigateTo("/jobs/new")}>创建第一条 JD</Button>}
          </div>
        ) : (
          <div className="job-card-list">
            {items.map((job) => (
              <article key={job.id} className="job-card">
                <button className="job-card-main" type="button" onClick={() => navigateTo(jobDetailPath(job.id))}>
                  <div className="job-card-heading"><h2>{job.job_title}</h2><p>{job.company_name}</p></div>
                  <div className="job-card-facts">{job.work_city && <span><MapPin size={13} />{job.work_city}</span>}{job.salary_text && <span>{job.salary_text}</span>}</div>
                  {job.skills.length > 0 && <div className="job-skill-row">{job.skills.slice(0, 6).map((skill, index) => <span key={skill} className={index === 0 ? "is-primary" : ""}>{skill}</span>)}</div>}
                </button>
                <div className="job-card-side">
                  <span className={`job-status-badge${job.archived_at ? " is-archived" : ""}`}>{job.archived_at ? "已归档" : "活动"}</span>
                  <div className="job-card-source">
                    {job.source_site && <span>{job.source_site}</span>}
                    <span>更新于 {formatTime(job.updated_at)}</span>
                  </div>
                  <div className="job-card-actions">
                    <button type="button" disabled={busyId !== null} aria-label={`${job.archived_at ? "恢复" : "归档"} ${job.job_title}`} onClick={() => void changeArchived(job)}>{job.archived_at ? <RotateCcw size={15} /> : <Archive size={15} />}</button>
                    {job.archived_at && <button type="button" disabled={busyId !== null} aria-label={`删除 ${job.job_title}`} onClick={() => setPendingDelete(job)}><Trash2 size={15} /></button>}
                  </div>
                </div>
              </article>
            ))}
            {nextCursor && <Button className="job-load-more" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载…" : "加载更多"}</Button>}
          </div>
        )}
      {pendingDelete && <ConfirmDialog kind="delete" title={`永久删除「${pendingDelete.job_title}」？`} description="删除后无法恢复，并会释放该岗位的来源标识。" confirmLabel="永久删除" busyLabel="正在删除…" busy={busyId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={deleteJob} />}
      {showPluginInstall && <PluginInstallDialog onClose={() => setShowPluginInstall(false)} />}
    </main>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.message === "JD_DELETE_REQUIRES_ARCHIVE") {
    return "岗位已经恢复为活动状态，请刷新列表后重试。";
  }
  return "删除失败，请稍后重试。";
}
