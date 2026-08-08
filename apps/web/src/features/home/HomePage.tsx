import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, PenLine, Plus, Search, Share2, X } from "lucide-react";
import { ApiRequestError, type ResumeSummary } from "../../api/client";
import { Button, Toast } from "../../components/ds";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useResumeStore } from "../../store/resumeStore";
import { editorPath, navigateTo } from "../../routing";
import { SharePanel } from "./SharePanel";

type HomeScreenProps = {
  view?: "all" | "templates";
  resumes: ResumeSummary[];
  onOpen: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onCreate: () => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
};

function resumeCreationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.message === "RESUME_LIMIT_REACHED") {
    return "每个账号最多保存 10 份简历，请先删除一份后再创建。";
  }
  return fallback;
}

function resumeImportErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "导入简历失败，请稍后重试。";

  switch (error.message) {
    case "RESUME_LIMIT_REACHED":
      return "每个账号最多保存 10 份简历，请先删除一份后再导入。";
    case "STRUCTURING_MODEL_UNAVAILABLE":
      return "简历结构化服务尚未配置，暂时无法导入。";
    case "DOCUMENT_CONVERSION_UNAVAILABLE":
      return "PDF 解析服务暂时不可用；Markdown 和 DOCX 仍可导入。";
    case "UNSUPPORTED_IMPORT_FORMAT":
    case "INVALID_IMPORT_FILENAME":
      return "仅支持 Markdown、DOCX 和 PDF 文件。";
    case "IMPORT_FILE_TOO_LARGE":
      return "文件过大，最大支持 10 MB。";
    case "EMPTY_IMPORT_FILE":
    case "IMPORT_CONTENT_INVALID":
      return "文件为空或内容无法读取。";
    case "STRUCTURING_INPUT_TOO_LARGE":
      return "转换后的简历内容过长，暂时无法结构化。";
    case "IMPORT_RATE_LIMITED":
      return "导入请求过于频繁，请稍后重试。";
    case "IMPORT_ALREADY_PROCESSING":
      return "这份简历正在导入，请等待当前处理完成。";
    case "IDEMPOTENCY_KEY_REUSED":
      return "本次导入标识已被使用，请重新选择文件后再试。";
    case "IMPORT_IDEMPOTENCY_UNAVAILABLE":
      return "导入保护服务暂时不可用，请稍后重试。";
    case "DOCUMENT_CONVERSION_TIMEOUT":
    case "IMPORT_DEADLINE_EXCEEDED":
      return "文件解析超时，请稍后重新导入。";
    case "DOCUMENT_CONVERSION_FAILED":
    case "STRUCTURING_MODEL_FAILED":
    case "RESUME_STRUCTURE_INVALID":
    case "IMPORT_STORAGE_FAILED":
    case "IMPORT_CREATE_FAILED":
      return "导入服务暂时不可用，请稍后重试。";
    default:
      return error.status >= 500 ? "导入服务暂时不可用，请稍后重试。" : "导入简历失败，请稍后重试。";
  }
}

function ResumeThumbnailCard({
  resume,
  onOpen,
  onDelete,
  onShare,
  deleteDisabled = false,
}: {
  resume: Pick<ResumeSummary, "id" | "title" | "updated_at">;
  onOpen: () => void;
  onDelete?: () => void;
  onShare?: () => void;
  deleteDisabled?: boolean;
}) {
  return (
    <article className="home-resume-card">
      <button className="home-card-open" type="button" onClick={onOpen}>
        <span className="home-card-preview" aria-hidden="true">
          <span className="home-card-paper">
            <i className="home-card-title-line" />
            <i style={{ width: "92%" }} />
            <i />
            <i style={{ width: "70%" }} />
            <i style={{ width: "85%" }} />
          </span>
        </span>
        <span className="home-card-meta">
          <strong>{resume.title}</strong>
          <small>更新于 {resume.updated_at === "内置" ? "内置" : formatTime(resume.updated_at)}</small>
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

export function HomeScreen({ view = "all", resumes, onOpen, onDelete, onCreate, onImport }: HomeScreenProps) {
  const scrollRef = useRef<HTMLElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [scrollAmount, setScrollAmount] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<ResumeSummary | null>(null);
  const [sharingResume, setSharingResume] = useState<ResumeSummary | null>(null);
  const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [importing, setImporting] = useState(false);
  const [templateConfirmOpen, setTemplateConfirmOpen] = useState(false);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);
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

  const requestDelete = (resume: ResumeSummary) => {
    if (deletingResumeId) return;
    setNotice(null);
    setPendingDelete(resume);
  };

  const confirmDelete = async () => {
    const resume = pendingDelete;
    if (!resume || deletingResumeId) return;
    setDeletingResumeId(resume.id);
    try {
      await onDelete(resume.id);
      setNotice({ kind: "success", message: `已删除「${resume.title}」` });
    } catch {
      setNotice({ kind: "error", message: `删除「${resume.title}」失败，请稍后重试。` });
    } finally {
      setDeletingResumeId(null);
      setPendingDelete(null);
    }
  };

  const createBlankResume = async () => {
    if (creatingBlank || importing || creatingFromTemplate) return;
    setCreatingBlank(true);
    setNotice(null);
    try {
      await onCreate();
    } catch (error) {
      setNotice({
        kind: "error",
        message: resumeCreationErrorMessage(error, "创建简历失败，请稍后重试。"),
      });
    } finally {
      setCreatingBlank(false);
    }
  };

  const importResume = async (file: File) => {
    if (importing || creatingBlank || creatingFromTemplate) return;
    setImporting(true);
    setNotice(null);
    try {
      await onImport(file);
    } catch (error) {
      setNotice({ kind: "error", message: resumeImportErrorMessage(error) });
    } finally {
      setImporting(false);
    }
  };

  const confirmTemplateCreate = async () => {
    if (creatingFromTemplate || creatingBlank || importing) return;
    setCreatingFromTemplate(true);
    setNotice(null);
    try {
      await onCreate();
      setTemplateConfirmOpen(false);
    } catch (error) {
      setNotice({
        kind: "error",
        message: resumeCreationErrorMessage(error, "从模板创建简历失败，请稍后重试。"),
      });
      setTemplateConfirmOpen(false);
    } finally {
      setCreatingFromTemplate(false);
    }
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (element) setScrollAmount(Math.min(1, element.scrollTop / 60));
  };

  return (
    <main ref={scrollRef} className="dashboard-content" onScroll={handleScroll}>
        <header
          className="dashboard-header"
          style={{
            "--header-alpha": 0.5 + scrollAmount * 0.4,
            "--header-blur": `${8 + scrollAmount * 14}px`,
            "--header-border-alpha": scrollAmount,
          } as React.CSSProperties}
        >
          <h1>{view === "all" ? "全部简历" : "模板"}</h1>
          <div className="dashboard-header-actions">
            {view === "all" && (
              <label className="dashboard-search">
                <span className="visually-hidden">搜索简历</span>
                <Search size={14} aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索简历" />
              </label>
            )}
            {view === "all" && (
              <>
                <input
                  ref={importInputRef}
                  className="visually-hidden"
                  type="file"
                  aria-label="选择简历文件"
                  accept=".md,.docx,.pdf,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void importResume(file);
                  }}
                />
                <Button
                  className="dashboard-import"
                  variant="secondary"
                  size="sm"
                  icon={<FileUp size={14} />}
                  disabled={importing || creatingBlank || creatingFromTemplate}
                  onClick={() => importInputRef.current?.click()}
                >
                  {importing ? "正在导入…" : "导入简历"}
                </Button>
              </>
            )}
            {view === "all" && (
              <Button
                className="dashboard-create"
                size="sm"
                icon={<Plus size={14} />}
                disabled={creatingBlank || importing || creatingFromTemplate}
                onClick={() => void createBlankResume()}
              >
                {creatingBlank ? "正在创建…" : "新建简历"}
              </Button>
            )}
          </div>
        </header>

        <div className="dashboard-main">
          {view === "templates" ? (
            <section className="home-card-grid" aria-label="简历模板">
              <ResumeThumbnailCard
                resume={{ id: "standard-template", title: "标准简历模板", updated_at: "内置" }}
                onOpen={() => setTemplateConfirmOpen(true)}
              />
            </section>
          ) : visibleResumes.length > 0 ? (
            <section className="home-card-grid" aria-label="全部简历">
              {visibleResumes.map((resume) => (
                <ResumeThumbnailCard
                  key={resume.id}
                  resume={resume}
                  onOpen={() => void onOpen(resume.id)}
                  onShare={() => setSharingResume(resume)}
                  onDelete={() => requestDelete(resume)}
                  deleteDisabled={deletingResumeId !== null}
                />
              ))}
            </section>
          ) : (
            <section className="dashboard-empty-state">
              <PenLine size={48} strokeWidth={1.2} />
              <h2>{query ? "没有匹配的简历" : "您还没有简历"}</h2>
              <p>{query ? "换个关键词试试。" : "创建一个新的文档，开始您的创作之旅。"}</p>
              {!query && (
                <Button
                  icon={<Plus size={16} />}
                  disabled={creatingBlank || importing || creatingFromTemplate}
                  onClick={() => void createBlankResume()}
                >
                  {creatingBlank ? "正在创建…" : "创建第一份简历"}
                </Button>
              )}
            </section>
          )}
        </div>

        {notice && (
          <div className="home-action-toast">
            <Toast kind={notice.kind}>{notice.message}</Toast>
          </div>
        )}
      {pendingDelete && (
        <ConfirmDialog
          kind="delete"
          title={`删除「${pendingDelete.title}」？`}
          description="删除后无法恢复，相关历史版本也会一并移除。"
          confirmLabel="永久删除"
          busyLabel="正在删除…"
          busy={deletingResumeId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}

      {templateConfirmOpen && (
        <ConfirmDialog
          kind="template"
          title="使用「标准简历模板」创建简历？"
          description="将以该模板新建一份简历，不会覆盖或修改已有简历。"
          confirmLabel="使用模板创建"
          busyLabel="正在创建…"
          busy={creatingFromTemplate}
          onCancel={() => setTemplateConfirmOpen(false)}
          onConfirm={confirmTemplateCreate}
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
  const createResume = useResumeStore((state) => state.createResume);
  const importResume = useResumeStore((state) => state.importResume);
  const deleteResume = useResumeStore((state) => state.deleteResume);

  const createAndOpenResume = async () => {
    await createResume("未命名简历");
    const resumeId = useResumeStore.getState().activeResumeId;
    if (resumeId) navigateTo(editorPath(resumeId));
  };

  const importAndOpenResume = async (file: File) => {
    const resumeId = await importResume(file);
    navigateTo(editorPath(resumeId));
  };

  return (
    <HomeScreen
      view={view}
      resumes={resumes}
      onCreate={createAndOpenResume}
      onImport={importAndOpenResume}
      onOpen={(id) => navigateTo(editorPath(id))}
      onDelete={deleteResume}
    />
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
