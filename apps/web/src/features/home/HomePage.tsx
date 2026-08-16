import { useEffect, useMemo, useState } from "react";
import { FileUp, Plus, Search, Share2, X } from "lucide-react";
import {
  type ResumeImportSummary,
  type ResumeSummary,
  type ResumeTemplate,
} from "../../api/client";
import {
  Button,
  ConfirmDialog,
  FeedbackNotice,
} from "@/components/ui";
import { useResumeStore } from "../../store/resumeStore";
import { editorPath, navigateTo } from "../../routing";
import { ResumePreview } from "../preview/ResumePreview";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { SharePanel } from "./SharePanel";
import { api } from "../../api/client";

type HomeScreenProps = {
  view?: "all" | "templates";
  resumes: ResumeSummary[];
  activeImports: ResumeImportSummary[];
  failedImports: ResumeImportSummary[];
  onOpen: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onCreate: () => void | Promise<void>;
  onDeleteImport: (id: string) => void | Promise<void>;
};

function importFailureStatus(task: ResumeImportSummary) {
  const uploadFailed = task.upload_status === "failed";
  const stage = uploadFailed ? "上传失败" : "解析失败";
  const durationMs = uploadFailed ? task.upload_duration_ms : task.parse_duration_ms;
  if (durationMs === null) return `${stage} · —`;
  if (durationMs < 1000) return `${stage} · ${durationMs} 毫秒`;
  return `${stage} · ${(durationMs / 1000).toFixed(1)} 秒`;
}

function ResumeThumbnailCard({
  resume,
  onOpen,
  onDelete,
  onShare,
  deleteDisabled = false,
}: {
  resume: Pick<ResumeSummary, "id" | "title" | "updated_at" | "preview">;
  onOpen: () => void;
  onDelete?: () => void;
  onShare?: () => void;
  deleteDisabled?: boolean;
}) {
  return (
    <article className="home-resume-card">
      <button className="home-card-open" type="button" onClick={onOpen}>
        <span className="home-card-preview" aria-hidden="true">
          {resume.preview ? (
            <ResumePreview data={resume.preview.data} style={resume.preview.style} />
          ) : (
            <span className="home-preview-unavailable">预览不可用</span>
          )}
        </span>
      </button>
      {onDelete && (
        <button
          className="home-card-delete"
          type="button"
          aria-label={`删除简历 ${resume.title}`}
          title="删除简历"
          disabled={deleteDisabled}
          onClick={onDelete}
        >
          <X size={14} />
        </button>
      )}
      <div className="home-card-meta">
        <strong>{resume.title}</strong>
        <small>更新于 {formatTime(resume.updated_at)}</small>
        <div className="home-card-actions">
          {onShare && (
            <button
              className="home-card-action"
              type="button"
              aria-label={`分享简历 ${resume.title}`}
              onClick={onShare}
            >
              <Share2 size={14} />分享
            </button>
          )}
          <button className="home-card-action" type="button" onClick={onOpen}>
            打开
          </button>
        </div>
      </div>
    </article>
  );
}

export function HomeScreen({
  resumes,
  activeImports,
  failedImports,
  onOpen,
  onDelete,
  onCreate,
  onDeleteImport,
}: HomeScreenProps) {
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ResumeSummary | null>(null);
  const [sharingResume, setSharingResume] = useState<ResumeSummary | null>(null);
  const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const visibleResumes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return resumes.filter((resume) => resume.title.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, resumes]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const confirmDelete = async () => {
    if (!pendingDelete || deletingResumeId) return;
    const resume = pendingDelete;
    setDeletingResumeId(resume.id);
    try {
      await onDelete(resume.id);
      setNotice({ kind: "success", message: `已删除“${resume.title}”。` });
    } catch {
      setNotice({ kind: "error", message: `删除“${resume.title}”失败，请稍后重试。` });
    } finally {
      setDeletingResumeId(null);
      setPendingDelete(null);
    }
  };

  const deleteFailedImport = async (task: ResumeImportSummary) => {
    if (deletingImportId) return;
    setDeletingImportId(task.id);
    try {
      await onDeleteImport(task.id);
      setNotice({ kind: "success", message: `已删除“${task.source_filename}”的失败记录。` });
    } catch {
      setNotice({ kind: "error", message: `删除“${task.source_filename}”的失败记录失败，请稍后重试。` });
    } finally {
      setDeletingImportId(null);
    }
  };

  return (
    <main className="dashboard-content">
      <WorkspacePageHero
        eyebrow="求职工作台"
        title="全部简历"
        description={
          resumes.length > 0
            ? `${resumes.length} 份简历 · 按最近更新排列`
            : "从一份有针对性的简历开始，逐步整理你的求职版本。"
        }
        actions={
          <>
            <label className="page-hero-field dashboard-search-field">
              <span>搜索简历</span>
              <span className="dashboard-search">
                <Search size={14} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="请输入关键词"
                  aria-label="搜索简历"
                />
              </span>
            </label>
            <Button
              variant="ghost"
              icon={<FileUp size={15} />}
              onClick={() => navigateTo("/resumes/new?mode=import")}
            >
              导入简历
            </Button>
            <Button icon={<Plus size={15} />} onClick={() => void onCreate()}>
              新建简历
            </Button>
          </>
        }
      />

      <div className="dashboard-main">
        {(activeImports.length > 0 || failedImports.length > 0) && (
          <section className="home-import-task-list" aria-label="导入任务">
            {activeImports.map((task) => (
              <article className="home-import-task" key={task.id}>
                <div>
                  <strong>{task.source_filename}</strong>
                  <small>
                    {task.upload_status === "uploading" ? "正在上传" : "正在解析"}
                  </small>
                </div>
                <span aria-label="导入处理中">处理中</span>
              </article>
            ))}
            {failedImports.map((task) => (
              <article className="home-import-task home-import-task-failed" key={task.id}>
                <div>
                  <strong>{task.source_filename}</strong>
                  <small>{importFailureStatus(task)}</small>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={deletingImportId !== null}
                  onClick={() => void deleteFailedImport(task)}
                >
                  {deletingImportId === task.id ? "正在删除…" : "删除记录"}
                </Button>
              </article>
            ))}
          </section>
        )}
        {visibleResumes.length > 0 ? (
          <>
            <div className="home-filter-row">
              <span className="filter-pill is-active">全部 {visibleResumes.length}</span>
              <span className="home-filter-sort">最近更新</span>
            </div>
            <section className="home-card-grid" aria-label="全部简历">
              {visibleResumes.map((resume) => (
                <ResumeThumbnailCard
                  key={resume.id}
                  resume={resume}
                  onOpen={() => void onOpen(resume.id)}
                  onShare={() => setSharingResume(resume)}
                  onDelete={() => setPendingDelete(resume)}
                  deleteDisabled={deletingResumeId !== null}
                />
              ))}
            </section>
            <p className="home-page-tip">提示：点击简历卡片可继续编辑，分享按钮只管理当前简历的公开链接。</p>
          </>
        ) : (
          <section className="dashboard-empty-state">
            <span className="empty-state-icon" aria-hidden="true"><Plus size={28} strokeWidth={1.6} /></span>
            <h2>{query ? "没有匹配的简历" : "还没有正式简历"}</h2>
            <p>
              {query
                ? "换个关键词试试。"
                : "从空白模板创建，或导入一份已有文件作为起点。之后可以复制出不同岗位版本，分别维护和分享。"}
            </p>
            {!query && (
              <div className="empty-state-actions">
                <Button icon={<Plus size={15} />} onClick={() => void onCreate()}>创建第一份简历</Button>
                <Button
                  variant="outline"
                  icon={<FileUp size={15} />}
                  onClick={() => navigateTo("/resumes/new?mode=import")}
                >
                  导入简历
                </Button>
              </div>
            )}
            {!query && <small className="empty-state-hint">建议：先完成一份基础版，再为不同岗位复制出定向版本。</small>}
          </section>
        )}
      </div>

      {notice && <div className="home-action-toast"><FeedbackNotice kind={notice.kind}>{notice.message}</FeedbackNotice></div>}
      {pendingDelete && (
        <ConfirmDialog
          kind="delete"
          title={`删除“${pendingDelete.title}”？`}
          description="删除后无法恢复，相关历史版本也会一并移除。"
          confirmLabel="永久删除"
          busyLabel="正在删除…"
          busy={deletingResumeId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
      {sharingResume && (
        <SharePanel
          resumeId={sharingResume.id}
          resumeTitle={sharingResume.title}
          onClose={() => setSharingResume(null)}
        />
      )}
    </main>
  );
}

export function HomePage({ view = "all" }: { view?: "all" | "templates" }) {
  const resumes = useResumeStore((state) => state.resumes);
  const activeImports = useResumeStore((state) => state.activeImports);
  const failedImports = useResumeStore((state) => state.failedImports);
  const listResumes = useResumeStore((state) => state.listResumes);
  const deleteResume = useResumeStore((state) => state.deleteResume);
  const deleteResumeImport = useResumeStore((state) => state.deleteResumeImport);

  useEffect(() => {
    if (view !== "all") return;
    void listResumes();
    if (activeImports.length === 0) return;
    const timer = window.setInterval(() => void listResumes(), 2000);
    return () => window.clearInterval(timer);
  }, [activeImports.length, listResumes, view]);

  if (view === "templates") return <TemplateLibrary />;
  return (
    <HomeScreen
      resumes={resumes}
      activeImports={activeImports}
      failedImports={failedImports}
      onCreate={() => navigateTo("/resumes/new")}
      onOpen={(id) => navigateTo(editorPath(id))}
      onDelete={deleteResume}
      onDeleteImport={deleteResumeImport}
    />
  );
}

function TemplateLibrary() {
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.listResumeTemplates().then(
      ({ templates: next }) => {
        if (cancelled) return;
        setTemplates(next);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setError("模板暂时无法加载，请稍后重试。");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = templates.filter((template) =>
    template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <main className="dashboard-content template-library-page">
      <WorkspacePageHero
        eyebrow="简历模板"
        title="选择模板"
        description="从结构开始，而不是从空白页开始。"
        actions={
          <span className="dashboard-search template-library-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模板"
              aria-label="搜索模板"
            />
          </span>
        }
      />
      <div className="dashboard-main">
        {loading && <div className="template-picker-state">正在加载模板…</div>}
        {error && <div className="template-picker-state error">{error}</div>}
        {!loading && !error && visible.length === 0 && (
          <div className="template-picker-state">{query ? "没有匹配的模板。" : "当前没有可用模板。"}</div>
        )}
        {!loading && !error && visible.length > 0 && (
          <>
            <div className="home-filter-row">
              <span className="filter-pill is-active">全部 {visible.length}</span>
            </div>
            <section className="template-library-grid" aria-label="选择简历模板">
              {visible.map((template) => (
                <article key={template.id} className="template-library-card">
                  <span className="template-library-preview" aria-hidden="true">
                    <ResumePreview data={template.data} style={template.style} />
                  </span>
                  <div className="template-library-meta">
                    <strong>{template.name}</strong>
                    <small>{template.description ?? "适用于通用简历场景"}</small>
                  </div>
                  <Button
                    onClick={() =>
                      navigateTo(`/resumes/new?template=${encodeURIComponent(template.id)}`)
                    }
                  >
                    使用模板
                  </Button>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
