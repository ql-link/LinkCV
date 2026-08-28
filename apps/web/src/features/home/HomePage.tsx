import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ExternalLink, FileText, FileUp, MoreHorizontal, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import {
  type ResumeImportSummary,
  type ResumeSummary,
} from "../../api/client";
import {
  Button,
  ConfirmDialog,
  ExpandableSearch,
  FeedbackNotice,
  PageLoading,
} from "@/components/ui";
import { useResumeStore } from "../../store/resumeStore";
import { editorPath, navigateTo } from "../../routing";
import { ResumePreview } from "../preview/ResumePreview";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { RenameResumeDialog } from "./RenameResumeDialog";
import { SharePanel } from "./SharePanel";
import { ResumeImportDialog } from "./ResumeImportDialog";
import { ResumeCreateDialog } from "./ResumeCreateDialog";

type HomeScreenProps = {
  loading?: boolean;
  resumes: ResumeSummary[];
  activeImports: ResumeImportSummary[];
  failedImports: ResumeImportSummary[];
  onOpen: (id: string) => void | Promise<void>;
  onRename: (id: string, title: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
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

function ImportTaskCard({
  task,
  failed = false,
  deleting = false,
  deleteDisabled = false,
  onDelete,
}: {
  task: ResumeImportSummary;
  failed?: boolean;
  deleting?: boolean;
  deleteDisabled?: boolean;
  onDelete?: () => void;
}) {
  const stage = task.upload_status === "uploading" ? "正在上传" : "正在解析";
  const stateLabel = failed
    ? task.upload_status === "failed" ? "上传失败" : "解析失败"
    : task.upload_status === "uploading" ? "上传中" : "解析中";

  return (
    <article
      className={`home-import-card${failed ? " home-import-card-failed" : ""}`}
      aria-label={`导入任务 ${task.source_filename}`}
    >
      <div className="home-import-preview">
        <div className="home-import-document" aria-hidden="true">
          <span className="home-import-document-title" />
          <span />
          <span />
          <span className="is-short" />
          <span className="home-import-document-heading" />
          <span />
          <span />
          <span className="is-short" />
          <span className="home-import-document-heading" />
          <span />
          <span className="is-short" />
        </div>
        <div className="home-import-state">
          <span className="home-import-state-label">{stateLabel}</span>
          {!failed && (
            <div
              className="home-import-progress"
              role="progressbar"
              aria-label={`${task.source_filename} ${stage}`}
              aria-valuetext={`${stage}，暂时无法估算完成时间`}
            >
              <span />
            </div>
          )}
        </div>
      </div>
      <div className="home-import-meta">
        <strong title={task.source_filename}>{task.source_filename}</strong>
        <small>{failed ? importFailureStatus(task) : `${stage} · 请稍候`}</small>
        {failed && onDelete && (
          <Button
            variant="secondary"
            size="sm"
            disabled={deleteDisabled}
            aria-label={`删除失败记录 ${task.source_filename}`}
            onClick={onDelete}
          >
            {deleting ? "正在删除…" : "删除记录"}
          </Button>
        )}
      </div>
    </article>
  );
}

function ResumeThumbnailCard({
  resume,
  onOpen,
  onDelete,
  onShare,
  onRename,
  deleteDisabled = false,
}: {
  resume: Pick<ResumeSummary, "id" | "title" | "updated_at" | "preview">;
  onOpen: () => void;
  onDelete?: () => void;
  onShare?: () => void;
  onRename?: () => void;
  deleteDisabled?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, [menuOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
    if (!items.length) return;
    if (event.key === "Home") return items[0].focus();
    if (event.key === "End") return items[items.length - 1].focus();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : items.length - 1
      : (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  };

  const runMenuAction = (action?: () => void) => {
    setMenuOpen(false);
    action?.();
  };

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
      <div className="home-card-menu" ref={menuRef}>
        <button
          ref={menuTriggerRef}
          className="home-card-menu-trigger"
          type="button"
          aria-label={`更多简历操作 ${resume.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div
            className="home-card-menu-panel"
            role="menu"
            aria-label={`${resume.title} 操作菜单`}
            onKeyDown={handleMenuKeyDown}
          >
            {onRename && (
              <button type="button" role="menuitem" onClick={() => runMenuAction(onRename)}>
                <Pencil size={15} aria-hidden="true" />重命名
              </button>
            )}
            {onShare && (
              <button type="button" role="menuitem" onClick={() => runMenuAction(onShare)}>
                <Share2 size={15} aria-hidden="true" />分享链接
              </button>
            )}
            {onDelete && (
              <button
                className="is-danger"
                type="button"
                role="menuitem"
                disabled={deleteDisabled}
                onClick={() => runMenuAction(onDelete)}
              >
                <Trash2 size={15} aria-hidden="true" />删除
              </button>
            )}
          </div>
        )}
      </div>
      <div className="home-card-meta">
        <strong>{resume.title}</strong>
        <small>更新于 {formatTime(resume.updated_at)}</small>
        <div className="home-card-actions">
          <button className="home-card-action is-primary" type="button" onClick={onOpen}>
            <ExternalLink size={14} />打开
          </button>
        </div>
      </div>
    </article>
  );
}

export function HomeScreen({
  loading = false,
  resumes,
  activeImports,
  failedImports,
  onOpen,
  onRename,
  onDelete,
  onDeleteImport,
}: HomeScreenProps) {
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ResumeSummary | null>(null);
  const [pendingRename, setPendingRename] = useState<ResumeSummary | null>(null);
  const [sharingResume, setSharingResume] = useState<ResumeSummary | null>(null);
  const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
  const [renamingResumeId, setRenamingResumeId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const visibleResumes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return resumes.filter((resume) => resume.title.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, resumes]);
  const visibleImports = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [
      ...activeImports.map((task) => ({ task, failed: false })),
      ...failedImports.map((task) => ({ task, failed: true })),
    ].filter(({ task }) => task.source_filename.toLocaleLowerCase().includes(normalizedQuery));
  }, [activeImports, failedImports, query]);
  const visibleCardCount = visibleImports.length + visibleResumes.length;

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

  const confirmRename = async (title: string) => {
    if (!pendingRename || renamingResumeId) return;
    const resume = pendingRename;
    if (title === resume.title) {
      setPendingRename(null);
      return;
    }
    setRenamingResumeId(resume.id);
    setRenameError(null);
    try {
      await onRename(resume.id, title);
      setNotice({ kind: "success", message: `已将简历重命名为“${title}”。` });
      setPendingRename(null);
    } catch {
      setRenameError("保存名称失败，请刷新列表后重试。");
    } finally {
      setRenamingResumeId(null);
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
    <main className="dashboard-content home-dashboard-content">
      <WorkspacePageHero
        icon={<FileText />}
        title="我的简历"
        description="集中管理简历、版本与分享，随时继续编辑或导入新内容。"
        actions={
          <>
            <ExpandableSearch
              label="搜索简历"
              name="resume-search"
              value={query}
              onValueChange={setQuery}
              placeholder="搜索简历…"
            />
            <Button
              variant="ghost"
              icon={<FileUp size={15} />}
              onClick={() => setImportDialogOpen(true)}
            >
              导入简历
            </Button>
            <Button
              className="dashboard-create"
              variant="outline"
              icon={<Plus size={15} />}
              onClick={() => setCreateDialogOpen(true)}
            >
              新建简历
            </Button>
          </>
        }
      />

      {loading ? (
        <PageLoading label="正在加载我的简历…" />
      ) : (
        <div className="dashboard-main">
          {visibleCardCount > 0 ? (
            <>
              <section className="home-card-grid" aria-label="全部简历">
              {visibleImports.map(({ task, failed }) => (
                <ImportTaskCard
                  task={task}
                  key={task.id}
                  failed={failed}
                  deleting={deletingImportId === task.id}
                  deleteDisabled={deletingImportId !== null}
                  onDelete={failed ? () => void deleteFailedImport(task) : undefined}
                />
              ))}
              {visibleResumes.map((resume) => (
                <ResumeThumbnailCard
                  key={resume.id}
                  resume={resume}
                  onOpen={() => void onOpen(resume.id)}
                  onShare={() => setSharingResume(resume)}
                  onRename={() => {
                    setRenameError(null);
                    setPendingRename(resume);
                  }}
                  onDelete={() => setPendingDelete(resume)}
                  deleteDisabled={deletingResumeId !== null}
                />
              ))}
              </section>
            </>
          ) : (
            <section className="home-resume-empty-state">
              <FileText aria-hidden="true" />
              <h2>{query ? "没有匹配的简历" : "还没有正式简历"}</h2>
              <p>
                {query
                  ? "换个关键词试试。"
                  : "创建一份新简历，或导入已有文件，开始整理你的求职资料。"}
              </p>
              {!query && (
                <div className="empty-state-actions">
                  <Button icon={<Plus size={15} />} onClick={() => setCreateDialogOpen(true)}>创建第一份简历</Button>
                  <Button
                    variant="outline"
                    icon={<FileUp size={15} />}
                    onClick={() => setImportDialogOpen(true)}
                  >
                    导入简历
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

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
      {pendingRename && (
        <RenameResumeDialog
          initialTitle={pendingRename.title}
          busy={renamingResumeId === pendingRename.id}
          error={renameError}
          onCancel={() => {
            setRenameError(null);
            setPendingRename(null);
          }}
          onSubmit={confirmRename}
        />
      )}
      {sharingResume && (
        <SharePanel
          resumeId={sharingResume.id}
          resumeTitle={sharingResume.title}
          onClose={() => setSharingResume(null)}
        />
      )}
      {importDialogOpen && (
        <ResumeImportDialog
          onClose={() => setImportDialogOpen(false)}
          onAccepted={(title) => setNotice({ kind: "success", message: `已开始导入“${title}”。` })}
        />
      )}
      {createDialogOpen && (
        <ResumeCreateDialog onClose={() => setCreateDialogOpen(false)} />
      )}
    </main>
  );
}

export function HomePage() {
  const [loading, setLoading] = useState(true);
  const resumes = useResumeStore((state) => state.resumes);
  const activeImports = useResumeStore((state) => state.activeImports);
  const failedImports = useResumeStore((state) => state.failedImports);
  const listResumes = useResumeStore((state) => state.listResumes);
  const pollResumeImport = useResumeStore((state) => state.pollResumeImport);
  const deleteResume = useResumeStore((state) => state.deleteResume);
  const renameResume = useResumeStore((state) => state.renameResume);
  const deleteResumeImport = useResumeStore((state) => state.deleteResumeImport);

  useEffect(() => {
    let cancelled = false;
    void listResumes()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listResumes]);

  return (
    <>
      {activeImports
        .filter((task) => (
          task.upload_status === "succeeded" && task.parse_status === "processing"
        ))
        .map((task) => (
          <ResumeImportPoller
            key={task.id}
            importId={task.id}
            pollResumeImport={pollResumeImport}
          />
        ))}
      <HomeScreen
        loading={loading}
        resumes={resumes}
        activeImports={activeImports}
        failedImports={failedImports}
        onOpen={(id) => navigateTo(editorPath(id))}
        onRename={renameResume}
        onDelete={deleteResume}
        onDeleteImport={deleteResumeImport}
      />
    </>
  );
}

const RESUME_IMPORT_POLL_INTERVAL_MS = 1000;

function ResumeImportPoller({
  importId,
  pollResumeImport,
}: {
  importId: string;
  pollResumeImport: (id: string) => Promise<void>;
}) {
  useEffect(() => {
    let requestInFlight = false;
    const timer = window.setInterval(() => {
      if (requestInFlight) return;
      requestInFlight = true;
      void pollResumeImport(importId)
        .catch(() => {
          // Transient polling failures are retried on the next tick.
        })
        .finally(() => {
          requestInFlight = false;
        });
    }, RESUME_IMPORT_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [importId, pollResumeImport]);

  return null;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
