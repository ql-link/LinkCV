import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BriefcaseBusiness, Download, MapPin, Plus, Trash2, WalletCards } from "lucide-react";
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

type SortDirection = "desc" | "asc";

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
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
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

  const canSortByUpdatedAt = items.length > 0 && items.every((job) => Number.isFinite(Date.parse(job.updated_at)));
  const visibleItems = useMemo(() => {
    if (!canSortByUpdatedAt) return items;
    return [...items].sort((left, right) => {
      const difference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
      return sortDirection === "desc" ? difference : -difference;
    });
  }, [canSortByUpdatedAt, items, sortDirection]);

  return (
    <>
      <WorkspacePageHero
        className="career-module-header job-center-header"
        icon={<BriefcaseBusiness />}
        tone="warning"
        title="岗位库"
        description="保存目标岗位与 JD，建立求职进程后再管理投递与面试。"
        actions={(
          <>
            <ExpandableSearch
              label="搜索职位"
              name="job-search"
              value={keyword}
              onValueChange={setKeyword}
              placeholder="搜索职位、公司或技能…"
            />
            <Button
              className="job-sort-button"
              disabled={!canSortByUpdatedAt}
              size="sm"
              variant="outline"
              aria-label={`更新时间排序：${sortDirection === "desc" ? "从新到旧" : "从旧到新"}`}
              onClick={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")}
            >
              更新时间 {sortDirection === "desc" ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}
            </Button>
            <Button variant="ghost" icon={<Download size={15} />} onClick={() => setShowPluginInstall(true)}>安装采集插件</Button>
            <Button icon={<Plus size={15} />} onClick={() => navigateTo("/career/jobs/new")}>导入岗位</Button>
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
        ) : (
          <div className="job-list-surface">
            {items.length === 0 ? (
              <div className="job-empty-state job-table-empty-state">
                <BriefcaseBusiness size={44} strokeWidth={1.2} />
                <h2>{keyword ? "没有匹配的岗位" : "还没有岗位"}</h2>
                <p>{keyword ? "换个关键词试试。" : "手工填写一条结构化岗位信息，后续可继续编辑和整理。"}</p>
                {!keyword && <Button icon={<Plus size={15} />} onClick={() => navigateTo("/career/jobs/new")}>创建第一个岗位</Button>}
              </div>
            ) : (
              <div className="job-table-scroll">
                <table className="job-table">
                  <colgroup>
                    <col className="job-table-col-title" />
                    <col className="job-table-col-company" />
                    <col className="job-table-col-location" />
                    <col className="job-table-col-salary" />
                    <col className="job-table-col-skills" />
                    <col className="job-table-col-source" />
                    <col className="job-table-col-updated" />
                    <col className="job-table-col-status" />
                    <col className="job-table-col-actions" />
                    <col className="job-table-col-delete" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">岗位</th>
                      <th scope="col">公司</th>
                      <th scope="col">地点</th>
                      <th scope="col">薪资范围</th>
                      <th scope="col">技能标签</th>
                      <th scope="col">来源</th>
                      <th scope="col" aria-sort={sortDirection === "desc" ? "descending" : "ascending"}>更新时间</th>
                      <th scope="col">求职状态</th>
                      <th scope="col">操作</th>
                      <th scope="col">删除</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((job) => {
                      const history = applicationsForJob(applications, job.id);
                      const activeApplication = activeApplicationForJob(applications, job.id);
                      const latestApplication = history[0] ?? null;
                      const detailHref = jobDetailPath(job.id);
                      const skills = job.skills.slice(0, 3);
                      const remainingSkillCount = Math.max(0, job.skills.length - skills.length);
                      const processState = !applicationsLoaded
                        ? "进程状态不可用"
                        : activeApplication
                          ? activeApplication.current_stage_label
                          : latestApplication
                            ? applicationOutcome(latestApplication)
                            : "未建立进程";
                      const processStateClass = !applicationsLoaded
                        ? " is-unavailable"
                        : history.length === 0
                          ? " is-empty"
                          : "";
                      return (
                        <tr
                          key={job.id}
                          className="job-table-row"
                          tabIndex={0}
                          onClick={(event) => {
                            const target = event.target;
                            if (target instanceof Element && target.closest("a, button")) return;
                            navigateTo(detailHref);
                          }}
                          onKeyDown={(event) => {
                            if (event.target instanceof Element && event.target.closest("a, button")) return;
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            navigateTo(detailHref);
                          }}
                        >
                          <td>
                            <a className="job-table-job-link" href={detailHref} onClick={(event) => {
                              if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                              event.preventDefault();
                              navigateTo(detailHref);
                            }}>
                              <span className="job-company-mark" aria-hidden="true"><BriefcaseBusiness size={18} strokeWidth={1.8} /></span>
                              <span className="job-table-job-copy">
                                <strong>{job.job_title}</strong>
                                <span>{job.skills.length > 0 ? job.skills.slice(0, 2).join(" / ") : "岗位详情"}</span>
                              </span>
                            </a>
                          </td>
                          <td><span className="job-table-text">{job.company_name || "—"}</span></td>
                          <td><span className="job-table-text job-table-location"><MapPin size={13} aria-hidden="true" />{job.work_city || "—"}</span></td>
                          <td><span className="job-table-text job-table-salary"><WalletCards size={13} aria-hidden="true" />{job.salary_text || "—"}</span></td>
                          <td>
                            <div className="job-skill-row">
                              {skills.length > 0 ? skills.map((skill) => <span key={skill} className="job-skill-pill">{skill}</span>) : <span className="job-table-muted">—</span>}
                              {remainingSkillCount > 0 && <span className="job-skill-pill is-count">+{remainingSkillCount}</span>}
                            </div>
                          </td>
                          <td><span className="job-table-source">{formatSource(job)}</span></td>
                          <td><time className="job-table-updated" dateTime={job.updated_at}>{formatTime(job.updated_at)}</time></td>
                          <td><span className={`job-table-process-state${processStateClass}`}>{processState}</span></td>
                          <td className="job-table-actions-cell">
                            <div className="job-table-actions">
                              {applicationsLoaded && (activeApplication ? (
                                <Button size="sm" variant="outline" onClick={() => navigateTo(careerApplicationPath(activeApplication.id))}>查看进程</Button>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => navigateTo(startCareerApplicationPath(job.id))}>{latestApplication ? "再次求职" : "开始求职"}</Button>
                              ))}
                            </div>
                          </td>
                          <td className="job-table-delete-cell">
                            <IconButton className="job-table-delete" disabled={busyId !== null} label={`删除 ${job.job_title}`} onClick={() => setPendingDelete(job)}><Trash2 size={15} /></IconButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
  if (!Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatSource(job: JobDescriptionSummary): string {
  const sourceSite = job.source_site?.trim();
  if (!sourceSite) return "其他渠道";

  const normalizedSourceSite = sourceSite.toLowerCase();
  const sourceLabels: Record<string, string> = {
    web: "官网",
    website: "官网",
    official: "官网",
    boss: "BOSS 直聘",
    zhipin: "BOSS 直聘",
    "boss-zhipin": "BOSS 直聘",
    liepin: "猎聘",
    lagou: "拉勾",
    zhilian: "智联招聘",
    "51job": "前程无忧",
    linkedin: "LinkedIn",
  };

  return sourceLabels[normalizedSourceSite] ?? sourceSite;
}
