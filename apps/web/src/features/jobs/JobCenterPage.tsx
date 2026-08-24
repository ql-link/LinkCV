import { useEffect, useRef, useState } from "react";
import { BriefcaseBusiness, Download, MapPin, Plus, Trash2, WalletCards } from "lucide-react";
import { api, type JobDescriptionDraft, type JobDescriptionSummary } from "../../api/client";
import { Button, ConfirmDialog, ExpandableSearch, IconButton, PageLoading } from "@/components/ui";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { jobDetailPath, navigateTo } from "../../routing";
import { PluginInstallDialog } from "./PluginInstallDialog";
import { JobFormPage } from "./JobFormPage";
import { JobCreateMethodDialog } from "./JobCreateMethodDialog";
import { JobSmartImportDialog } from "./JobSmartImportDialog";
import { jobFormFromDraft, type JobFormState } from "./jobFormModel";
import "./jobs.css";

export function JobCenterPage({ createDialogOpen = false }: { createDialogOpen?: boolean }) {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<JobDescriptionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JobDescriptionSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPluginInstall, setShowPluginInstall] = useState(false);
  const [createStage, setCreateStage] = useState<"method" | "smart" | "form">("method");
  const [initialJobForm, setInitialJobForm] = useState<JobFormState | undefined>();
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const activeKeywordRef = useRef(keyword.trim());
  activeKeywordRef.current = keyword.trim();

  useEffect(() => {
    if (createDialogOpen) {
      setCreateStage("method");
      setInitialJobForm(undefined);
      setDraftWarnings([]);
    }
  }, [createDialogOpen]);

  const closeCreate = () => navigateTo("/jobs", { replace: true });
  const useDraft = (draft: JobDescriptionDraft, warnings: string[]) => {
    setInitialJobForm(jobFormFromDraft(draft));
    setDraftWarnings(warnings);
    setCreateStage("form");
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNextCursor(null);
    const timer = window.setTimeout(() => {
      void api.listJobDescriptions({ keyword: keyword.trim() || undefined })
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setNextCursor(result.next_cursor);
        })
        .catch(() => {
          if (!cancelled) setError("无法加载 JD 列表，请稍后重试。");
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

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const requestQuery = { keyword: keyword.trim(), cursor: nextCursor };
    setLoadingMore(true);
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
      ) setError("无法加载更多 JD，请稍后重试。");
    } finally {
      setLoadingMore(false);
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
    } catch {
      setError("删除失败，请稍后重试。");
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
        description="集中保存岗位要求和公司信息，方便随时搜索、查看与编辑。"
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
            <Button variant="outline" icon={<Plus size={15} />} onClick={() => navigateTo("/jobs/new")}>新建 JD</Button>
          </>
        )}
      />

      {loading && !initialized ? (
        <PageLoading label="正在加载 JD…" />
      ) : (
        <div className="job-center-body">
        {error && <div className="job-error" role="alert">{error}</div>}

        {loading ? (
          <PageLoading label="正在更新 JD…" />
        ) : items.length === 0 ? (
          <div className="job-empty-state">
            <BriefcaseBusiness size={44} strokeWidth={1.2} />
            <h2>{keyword ? "没有匹配的 JD" : "还没有 JD"}</h2>
            <p>{keyword ? "换个关键词试试。" : "手工填写一条结构化岗位信息，后续可继续编辑和整理。"}</p>
            {!keyword && <Button icon={<Plus size={15} />} onClick={() => navigateTo("/jobs/new")}>创建第一条 JD</Button>}
          </div>
        ) : (
          <div className="job-card-list">
            {items.map((job) => (
              <article key={job.id} className="job-card">
                <button className="job-card-main" type="button" onClick={() => navigateTo(jobDetailPath(job.id))}>
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
                </button>
                <div className="job-card-side">
                  <span className="job-card-updated">更新于 {formatTime(job.updated_at)}</span>
                  <IconButton className="job-card-delete" disabled={busyId !== null} label={`删除 ${job.job_title}`} onClick={() => setPendingDelete(job)}><Trash2 size={15} /></IconButton>
                </div>
              </article>
            ))}
            {nextCursor && <Button className="job-load-more" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载…" : "加载更多"}</Button>}
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
          onBack={() => setCreateStage("method")}
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
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
