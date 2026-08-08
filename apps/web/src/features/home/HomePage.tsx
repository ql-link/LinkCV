import { useEffect, useMemo, useState } from "react";
import { FileUp, PenLine, Plus, Search, Share2, X } from "lucide-react";
import {
  ApiRequestError,
  type ResumeImportSummary,
  type ResumeSummary,
  type ResumeTemplate,
} from "../../api/client";
import { Button, Toast } from "../../components/ds";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useResumeStore } from "../../store/resumeStore";
import { editorPath, navigateTo } from "../../routing";
import { ResumePreview } from "../preview/ResumePreview";
import { SharePanel } from "./SharePanel";
import { TemplatePicker } from "./TemplatePicker";

type HomeScreenProps = {
  view?: "all" | "templates";
  resumes: ResumeSummary[];
  activeImports: ResumeImportSummary[];
  failedImports: ResumeImportSummary[];
  onOpen: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onCreate: () => void | Promise<void>;
  onImport: (file: File, templateId: string) => Promise<string>;
  onDeleteImport: (id: string) => void | Promise<void>;
};

function importErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "导入请求失败，请检查网络后重试。";
  const messages: Record<string, string> = {
    RESUME_LIMIT_REACHED: "每个账号最多保存 10 份简历，请先删除一份后再导入。",
    TEMPLATE_INACTIVE: "所选模板已停用或不可用，请重新选择。",
    EMPTY_IMPORT_FILE: "文件为空，请重新选择。",
    IMPORT_FILE_TOO_LARGE: "文件过大，最大支持 10 MB。",
    UNSUPPORTED_IMPORT_FORMAT: "仅支持 Markdown、DOCX 和 PDF 文件。",
    INVALID_IMPORT_FILENAME: "文件名无效，请重新选择。",
    IMPORT_CONTENT_INVALID: "文件内容无法读取，请重新选择。",
    STRUCTURING_INPUT_TOO_LARGE: "转换后的简历内容过长，暂时无法结构化。",
    IMPORT_RATE_LIMITED: "导入请求过于频繁，请稍后重试。",
    IMPORT_ALREADY_PROCESSING: "这份简历正在导入，请等待当前请求完成。",
    IDEMPOTENCY_KEY_REUSED: "本次导入标识已被使用，请重新选择文件后再试。",
    IMPORT_IDEMPOTENCY_UNAVAILABLE: "导入保护服务暂时不可用，请稍后重试。",
    IMPORT_ACCEPTANCE_IN_PROGRESS: "导入正在受理，请稍后刷新查看。",
    IMPORT_PREVIOUSLY_FAILED: "这次导入已经失败，请删除失败记录后重新上传。",
    RESUME_SOURCE_UPLOAD_FAILED: "源文件上传失败，请稍后重试。",
    RESUME_IMPORT_QUEUE_UNAVAILABLE: "解析队列暂时不可用，失败记录已保留。",
    DOCUMENT_CONVERSION_UNAVAILABLE: "文档解析服务暂时不可用，请稍后重试。",
    DOCUMENT_CONVERSION_TIMEOUT: "文档解析超时，请稍后重新导入。",
    DOCUMENT_CONVERSION_FAILED: "文档解析失败，请检查文件内容后重试。",
    STRUCTURING_MODEL_UNAVAILABLE: "内容结构化模型未配置或凭据不可用，请联系管理员配置后重试。",
    STRUCTURING_MODEL_FAILED: "内容结构化失败，请稍后重试。",
    RESUME_STRUCTURE_INVALID: "文件已解析，但生成的简历结构无效，请检查内容后重试。",
    IMPORT_CREATE_FAILED: "正式简历创建失败，请稍后重试。",
    IMPORT_DEADLINE_EXCEEDED: "导入处理超时，请稍后重新导入。",
  };
  return messages[error.message] ?? `导入失败（${error.message}），请稍后重试。`;
}

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
        <span className="home-card-meta">
          <strong>{resume.title}</strong>
          <small>更新于 {formatTime(resume.updated_at)}</small>
        </span>
      </button>
      {onShare && (
        <button
          className="home-card-share"
          type="button"
          aria-label={`分享简历 ${resume.title}`}
          title="分享简历"
          onClick={onShare}
        >
          <Share2 size={14} />
        </button>
      )}
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
    </article>
  );
}

export function HomeScreen({
  view = "all",
  resumes,
  activeImports,
  failedImports,
  onOpen,
  onDelete,
  onCreate,
  onImport,
  onDeleteImport,
}: HomeScreenProps) {
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ResumeSummary | null>(null);
  const [sharingResume, setSharingResume] = useState<ResumeSummary | null>(null);
  const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplate | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
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

  const submitImport = async () => {
    if (!selectedFile || !selectedTemplate || importing) return;
    setImporting(true);
    setImportError(null);
    setNotice(null);
    try {
      await onImport(selectedFile, selectedTemplate.id);
      setImportOpen(false);
      setSelectedFile(null);
      setSelectedTemplate(null);
      setNotice({ kind: "success", message: "文件已上传，正在后台解析。" });
    } catch (error) {
      setImportError(importErrorMessage(error));
    } finally {
      setImporting(false);
    }
  };

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
      <header className="dashboard-header">
        <h1>{view === "all" ? "全部简历" : "模板"}</h1>
        {view === "all" && (
          <div className="dashboard-header-actions">
            <label className="dashboard-search">
              <Search size={14} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索简历" />
            </label>
            <Button
              variant="secondary"
              size="sm"
              icon={<FileUp size={14} />}
              onClick={() => {
                setImportError(null);
                setImportOpen(true);
              }}
            >
              导入简历
            </Button>
            <Button size="sm" icon={<Plus size={14} />} onClick={() => void onCreate()}>
              新建简历
            </Button>
          </div>
        )}
      </header>

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
        ) : (
          <section className="dashboard-empty-state">
            <PenLine size={48} strokeWidth={1.2} />
            <h2>{query ? "没有匹配的简历" : "还没有正式简历"}</h2>
            <p>{query ? "换个关键词试试。" : "从空白模板或其他模板创建第一份简历。"}</p>
            {!query && <Button icon={<Plus size={16} />} onClick={() => void onCreate()}>创建第一份简历</Button>}
          </section>
        )}
      </div>

      {notice && <div className="home-action-toast"><Toast kind={notice.kind}>{notice.message}</Toast></div>}
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
      {importOpen && (
        <div className="template-preview-backdrop" role="dialog" aria-modal="true" aria-label="导入简历">
          <div className="home-import-dialog">
            <header>
              <div><h2>导入简历</h2><p>先选择模板，再上传需要解析的文件。</p></div>
              <button
                type="button"
                aria-label="关闭"
                disabled={importing}
                onClick={() => {
                  setImportError(null);
                  setImportOpen(false);
                }}
              ><X size={18} /></button>
            </header>
            <TemplatePicker
              selectedTemplateId={selectedTemplate?.id ?? null}
              onSelect={(template) => {
                setSelectedTemplate(template);
                setImportError(null);
              }}
            />
            <label className="home-import-file">
              <span>{selectedFile ? selectedFile.name : "选择 Markdown、DOCX 或 PDF 文件"}</span>
              <input
                className="visually-hidden"
                type="file"
                accept=".md,.docx,.pdf,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  setSelectedFile(event.currentTarget.files?.[0] ?? null);
                  setImportError(null);
                }}
              />
              <span className="home-import-file-action">{selectedFile ? "重新选择" : "选择文件"}</span>
            </label>
            {importError && <p className="home-import-error" role="alert">{importError}</p>}
            <footer>
              <Button
                variant="secondary"
                disabled={importing}
                onClick={() => {
                  setImportError(null);
                  setImportOpen(false);
                }}
              >取消</Button>
              <Button
                aria-busy={importing}
                disabled={!selectedTemplate || !selectedFile || importing}
                onClick={() => void submitImport()}
              >
                {importing ? "正在导入…" : "开始导入"}
              </Button>
            </footer>
          </div>
        </div>
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
  const importResume = useResumeStore((state) => state.importResume);
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
      onImport={importResume}
      onOpen={(id) => navigateTo(editorPath(id))}
      onDelete={deleteResume}
      onDeleteImport={deleteResumeImport}
    />
  );
}

function TemplateLibrary() {
  const [selected, setSelected] = useState<ResumeTemplate | null>(null);
  return (
    <main className="dashboard-content template-library-page">
      <header className="dashboard-header"><h1>模板</h1></header>
      <div className="dashboard-main">
        <TemplatePicker selectedTemplateId={selected?.id ?? null} onSelect={setSelected} />
        <div className="template-library-actions">
          <Button disabled={!selected} onClick={() => selected && navigateTo(`/resumes/new?template=${encodeURIComponent(selected.id)}`)}>
            使用所选模板
          </Button>
        </div>
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
