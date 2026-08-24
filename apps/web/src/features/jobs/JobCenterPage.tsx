import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BriefcaseBusiness, Download, MapPin, Plus, Trash2, WalletCards } from "lucide-react";
import { api, type JobApplicationSummary, type JobDescriptionDraft, type JobDescriptionSummary } from "../../api/client";
import { Button, ConfirmDialog, ExpandableSearch, IconButton, PageLoading } from "@/components/ui";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { careerApplicationPath, jobDetailPath, navigateTo, startCareerApplicationPath } from "../../routing";
import { PluginInstallDialog } from "./PluginInstallDialog";
import { JobFormPage } from "./JobFormPage";
import { JobCreateMethodDialog } from "./JobCreateMethodDialog";
import { JobSmartImportDialog } from "./JobSmartImportDialog";
import { jobFormFromDraft, type JobFormState } from "./jobFormModel";
import { activeApplicationForJob, applicationOutcome, applicationsForJob, listAllJobApplications } from "./jobApplications";
import "./jobs.css";

export function JobCenterPage({
  createDialogOpen = false,
  navigation,
}: {
  createDialogOpen?: boolean;
  navigation?: ReactNode;
}) {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<JobDescriptionSummary[]>([]);
  const [applications, setApplications] = useState<JobApplicationSummary[]>([]);
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JobDescriptionSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPluginInstall, setShowPluginInstall] = useState(false);
  const [createStage, setCreateStage] = useState<"method" | "smart" | "form">("method");
  const [initialJobForm, setInitialJobForm] = useState<JobFormState | undefined>();
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const activeKeywordRef = useRef(keyword.trim());
  activeKeywordRef.current = keyword.trim();

  useEffect(() => {
    if (createDialogOpen) {
      setCreateStage("method");
      setInitialJobForm(undefined);
      setDraftWarnings([]);
    }
  }, [createDialogOpen]);

  const closeCreate = () => navigateTo("/career/jobs", { replace: true });
  const useDraft = (draft: JobDescriptionDraft, warnings: string[]) => {
    setInitialJobForm(jobFormFromDraft(draft));
    setDraftWarnings(warnings);
    setCreateStage("form");
  };

  useEffect(() => {
    let cancelled = false;
    void listAllJobApplications()
      .then((result) => {
        if (!cancelled) {
          setApplications(result);
          setApplicationsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApplications([]);
          setApplicationsLoaded(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNextCursor(null);
    setLoadMoreError(false);
    const timer = window.setTimeout(() => {
      void api.listJobDescriptions({ keyword: keyword.trim() || undefined })
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setNextCursor(result.next_cursor);
        })
        .catch(() => {
          if (!cancelled) setError("无法加载岗位列表，请稍后重试。");
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setInitialized(true);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    const requestQuery = { keyword: keyword.trim(), cursor: nextCursor };
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const result = await api.listJobDescriptions({
        keyword: requestQuery.keyword || undefined,
        cursor: requestQuery.cursor,
      });
      if (
        activeKeywordRef.current !== requestQuery.keyword
      ) return;
      setItems((current) => [...current, ...result.items]);
      setNextCursor(result.next_cursor);
    } catch {
      if (
        activeKeywordRef.current === requestQuery.keyword
      ) setLoadMoreError(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [keyword, nextCursor]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !nextCursor || loading || loadingMore || loadMoreError || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "280px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, loadMoreError, loading, loadingMore, nextCursor]);

  const deleteJob = async () => {
    if (!pendingDelete || busyId) return;
    setBusyId(pendingDelete.id);
    setError(null);
    try {
      await api.deleteJobDescription(pendingDelete.id);
      setItems((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch {
      setError("删除失败，请稍后重试。");
      setPendingDelete(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <WorkspacePageHero
        className="career-module-header job-center-header"
        icon={<BriefcaseBusiness />}
        tone="warning"
        title="求职中心"
        description="集中管理岗位机会、求职进程、面试排期与复盘记录。"
        actions={(
          <>
            <ExpandableSearch
              label="搜索职位"
              name="job-search"
              value={keyword}
              onValueChange={setKeyword}
              placeholder="搜索职位、公司或技能…"
            />
            <Button variant="ghost" icon={<Download size={15} />} onClick={() => setShowPluginInstall(true)}>安装采集插件</Button>
            <Button icon={<Plus size={15} />} onClick={() => navigateTo("/career/jobs/new")}>新建岗位</Button>
          </>
        )}
      />
      {navigation}
      <main className="dashboard-content job-center-content">
      {loading && !initialized ? (
        <PageLoading label="正在加载岗位…" />
      ) : (
        <div className="job-center-body">
        {error && <div className="job-error" role="alert">{error}</div>}

        {loading ? (
          <PageLoading label="正在更新岗位…" />
        ) : items.length === 0 ? (
          <div className="job-empty-state">
            <BriefcaseBusiness size={44} strokeWidth={1.2} />
            <h2>{keyword ? "没有匹配的岗位" : "还没有岗位"}</h2>
            <p>{keyword ? "换个关键词试试。" : "手工填写一条结构化岗位信息，后续可继续编辑和整理。"}</p>
            {!keyword && <Button icon={<Plus size={15} />} onClick={() => navigateTo("/career/jobs/new")}>创建第一个岗位</Button>}
          </div>
        ) : (
          <div className="job-card-list">
            {items.map((job) => {
              const history = applicationsForJob(applications, job.id);
              const activeApplication = activeApplicationForJob(applications, job.id);
              const latestApplication = history[0] ?? null;
              const detailHref = jobDetailPath(job.id);
              return <article key={job.id} className="job-card">
                <a className="job-card-main" href={detailHref} onClick={(event) => {
                  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                  event.preventDefault();
                  navigateTo(detailHref);
                }}>
                  <div className="job-card-heading">
                    <h2>{job.job_title}</h2>
                    <span className="job-card-heading-separator" aria-hidden="true">·</span>
                    <p>{job.company_name}</p>
                  </div>
                  <div className="job-card-meta">
                    {job.work_city && <span className="job-card-meta-item"><MapPin size={13} aria-hidden="true" />{job.work_city}</span>}
                    {job.salary_text && <span className="job-card-meta-item"><WalletCards size={13} aria-hidden="true" />{job.salary_text}</span>}
                    {job.skills.length > 0 && <span className="job-card-skills">{job.skills.slice(0, 6).join("、")}</span>}
                  </div>
                </a>
                <div className="job-card-side">
                  <span className={`job-status-badge${!applicationsLoaded ? " is-archived" : ""}`}>{!applicationsLoaded ? "进程状态不可用" : activeApplication ? activeApplication.current_stage_label : latestApplication ? applicationOutcome(latestApplication) : "仅收藏"}</span>
                  <div className="job-card-actions">
                    {applicationsLoaded && (activeApplication ? (
                      <Button size="sm" variant="outline" onClick={() => navigateTo(careerApplicationPath(activeApplication.id))}>查看进程</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => navigateTo(startCareerApplicationPath(job.id))}>{latestApplication ? "再次求职" : "开始求职"}</Button>
                    ))}
                    <span className="job-card-updated">更新于 {formatTime(job.updated_at)}</span>
                    <IconButton className="job-card-delete" disabled={busyId !== null} label={`删除 ${job.job_title}`} onClick={() => setPendingDelete(job)}><Trash2 size={15} /></IconButton>
                  </div>
                </div>
              </article>;
            })}
            {nextCursor && (
              <div ref={loadMoreSentinelRef} className="job-infinite-scroll-sentinel" aria-live="polite">
                {loadingMore && <span role="status">正在加载更多岗位…</span>}
                {loadMoreError && (
                  <div className="job-infinite-scroll-error">
                    <span>后续岗位加载失败。</span>
                    <Button variant="secondary" onClick={() => void loadMore()}>重试</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>
      )}
      {pendingDelete && <ConfirmDialog kind="delete" title={`永久删除「${pendingDelete.job_title}」？`} description="删除后无法恢复，并会释放该岗位的来源标识。" confirmLabel="永久删除" busyLabel="正在删除…" busy={busyId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={deleteJob} />}
      {showPluginInstall && <PluginInstallDialog onClose={() => setShowPluginInstall(false)} />}
      {createDialogOpen && createStage === "method" && (
        <JobCreateMethodDialog
          onClose={closeCreate}
          onManual={() => setCreateStage("form")}
          onSmartImport={() => setCreateStage("smart")}
        />
      )}
      {createDialogOpen && createStage === "smart" && (
        <JobSmartImportDialog
          onClose={closeCreate}
          onParsed={useDraft}
        />
      )}
      {createDialogOpen && createStage === "form" && (
        <JobFormPage
          mode="create"
          presentation="dialog"
          initialForm={initialJobForm}
          initialWarnings={draftWarnings}
          onClose={closeCreate}
        />
      )}
      </main>
    </>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
