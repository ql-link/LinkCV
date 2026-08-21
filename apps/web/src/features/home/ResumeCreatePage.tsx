import { ArrowLeft, ArrowRight, Check, FileUp, LayoutTemplate, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiRequestError, type ResumeTemplate } from "../../api/client";
import { Brand, Button, FeedbackNotice, FileUpload, PageLoading } from "@/components/ui";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { ResumePreview } from "../preview/ResumePreview";
import { formatImportFileSize, importErrorMessage, validateImportTitle } from "@/lib/resumeImport";

function createErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "创建简历失败，请稍后重试。";
  if (error.message === "INVALID_RESUME_TITLE") return "请输入 1–255 个字符的简历名称。";
  if (error.message === "RESUME_TITLE_CONFLICT") return "该名称已经存在，请换一个名称。";
  if (error.message === "RESUME_LIMIT_REACHED") return "简历数量已达上限，请先清理已有简历。";
  if (error.message === "TEMPLATE_INACTIVE") return "所选模板已不可用，请重新选择。";
  return "创建简历失败，请稍后重试。";
}

export function ResumeCreatePage() {
  const createResume = useResumeStore((state) => state.createResume);
  const importResume = useResumeStore((state) => state.importResume);
  const [mode, setMode] = useState<"template" | "import">(() =>
    new URLSearchParams(window.location.search).get("mode") === "import" ? "import" : "template",
  );
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ResumeTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.listResumeTemplates().then(
      ({ templates: next }) => {
        if (cancelled) return;
        setTemplates(next);
        setTemplatesLoading(false);
        const initialId = new URLSearchParams(window.location.search).get("template");
        const initial = next.find((template) => template.id === initialId) ?? next[0] ?? null;
        setSelected(initial);
      },
      () => {
        if (cancelled) return;
        setTemplatesLoading(false);
        setTemplatesError("模板暂时无法加载，请稍后重试。");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const importTemplate = templates.find((template) => template.key === "blank-cn") ?? templates[0] ?? null;

  const pickFile = (next: File | null) => {
    setFile(next);
    setError(null);
    if (next && !titleTouched) {
      setTitle(next.name.replace(/\.[^.]+$/, ""));
    }
  };

  const submitCreate = async () => {
    if (submitting) return;
    if (!selected) {
      setError("请先选择一套简历模板。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resumeId = await createResume(title, selected.id);
      navigateTo(editorPath(resumeId));
    } catch (reason) {
      setError(createErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const submitImport = async () => {
    if (submitting) return;
    if (!file) {
      setError("请先选择需要导入的文件。");
      return;
    }
    const titleError = validateImportTitle(title, file.name);
    if (titleError) {
      setError(titleError);
      return;
    }
    if (!importTemplate) {
      setError("模板暂时无法加载，请稍后重试。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await importResume(file, importTemplate.id, title);
      navigateTo("/resumes");
    } catch (reason) {
      setError(importErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const previewTemplate = mode === "template" ? selected : importTemplate;

  return (
    <main className="create-page" data-ui-theme="light">
      <header className="create-topbar">
        <Brand />
        <button type="button" className="create-back" onClick={() => navigateTo("/resumes")}>
          <ArrowLeft size={15} />返回全部简历
        </button>
      </header>
      <div className="create-body">
        <section className="create-panel">
          <h1>{mode === "template" ? "创建简历" : "导入简历"}</h1>
          <p className="create-subtitle">
            {mode === "template" ? "选择模板并命名，下一步直接编辑内容。" : "上传文件并确认名称，内容将在下一步解析。"}
          </p>
          <div className="create-tabs" role="tablist" aria-label="创建方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "template"}
              className={mode === "template" ? "is-active" : ""}
              onClick={() => {
                setMode("template");
                setError(null);
              }}
            >
              <LayoutTemplate size={15} />使用模板
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "import"}
              className={mode === "import" ? "is-active" : ""}
              onClick={() => {
                setMode("import");
                setError(null);
              }}
            >
              <Upload size={15} />导入文件
            </button>
          </div>

          {mode === "template" ? (
            <>
              <label className="create-field">
                <span>简历名称</span>
                <input
                  value={title}
                  maxLength={255}
                  placeholder="例如：2026 产品经理简历"
                  aria-label="简历名称"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="create-field">
                <span>选择模板</span>
                {templatesError && <FeedbackNotice kind="error">{templatesError}</FeedbackNotice>}
                {templatesLoading ? (
                  <PageLoading label="正在加载简历模板…" scope="panel" />
                ) : <div className="create-template-grid" role="listbox" aria-label="选择模板">
                  {templates.map((template) => {
                    const active = selected?.id === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`create-template-card${active ? " is-active" : ""}`}
                        onClick={() => {
                          setSelected(template);
                          setError(null);
                        }}
                      >
                        <span className="create-template-thumb" aria-hidden="true">
                          <ResumePreview data={template.data} style={template.style} />
                        </span>
                        <span className="create-template-meta">
                          <strong>{template.name}</strong>
                          <small>{active ? "已选择" : "选择模板"}</small>
                        </span>
                        {active && (
                          <span className="create-template-check" aria-hidden="true">
                            <Check size={13} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>}
              </div>
              {error && <FeedbackNotice kind="error">{error}</FeedbackNotice>}
              <Button
                className="create-submit"
                disabled={submitting}
                onClick={() => void submitCreate()}
              >
                {submitting ? "正在创建…" : "创建并进入编辑器"}
                <ArrowRight size={15} />
              </Button>
            </>
          ) : (
            <>
              <div className="create-field">
                <span>简历文件</span>
                <FileUpload
                  accept=".md,.docx,.pdf,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  inputLabel="选择 Markdown、DOCX 或 PDF 文件"
                  supportingText="支持 Markdown、DOCX、PDF，最大 10 MB"
                  disabled={submitting}
                  file={file}
                  onFileSelect={(selectedFile) => pickFile(selectedFile ?? null)}
                />
                {file && (
                  <div className="create-file-chip">
                    <span className="create-file-badge">{file.name.split(".").pop()?.toUpperCase()}</span>
                    <span className="create-file-meta">
                      <strong>{file.name}</strong>
                      <small>{formatImportFileSize(file.size)} · 已准备</small>
                    </span>
                    <button type="button" aria-label="移除文件" onClick={() => pickFile(null)}>
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
              <label className="create-field">
                <span>简历名称</span>
                <input
                  value={title}
                  maxLength={255}
                  placeholder="例如：张三｜产品经理"
                  aria-label="简历名称"
                  onChange={(event) => {
                    setTitleTouched(true);
                    setTitle(event.target.value);
                  }}
                />
                <small>已根据文件名自动填写，可修改。</small>
              </label>
              {error && <FeedbackNotice kind="error">{error}</FeedbackNotice>}
              <Button
                className="create-submit"
                icon={<FileUp size={15} />}
                disabled={submitting}
                onClick={() => void submitImport()}
              >
                {submitting ? "正在导入…" : "导入并开始解析"}
              </Button>
            </>
          )}
        </section>

        <aside className="create-preview">
          <div className="create-preview-head">
            <span>预览</span>
            {previewTemplate && (
              <span className={`create-preview-chip${mode === "import" ? " is-outline" : ""}`}>
                {mode === "template" ? previewTemplate.name : "内容可编辑"}
              </span>
            )}
          </div>
          <div className="create-preview-paper">
            {previewTemplate ? (
              <ResumePreview data={previewTemplate.data} style={previewTemplate.style} mode="full" />
            ) : (
              <div className="create-preview-empty">模板加载后可预览版式。</div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
