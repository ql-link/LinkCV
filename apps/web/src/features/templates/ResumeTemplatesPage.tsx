import { Eye, LayoutTemplate, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import { api, ApiRequestError, type ResumeTemplate } from "../../api/client";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { ResumePreview } from "../preview/ResumePreview";
import { TemplatePreviewDialog } from "./TemplatePreviewDialog";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageLoading,
  buttonVariants,
} from "@/components/ui";

function followAppLink(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  navigateTo(path);
}

function createErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "创建简历失败，请稍后重试。";
  if (error.message === "INVALID_RESUME_TITLE") return "请输入 1–255 个字符的简历名称。";
  if (error.message === "RESUME_TITLE_CONFLICT") return "该名称已经存在，请换一个名称。";
  if (error.message === "RESUME_LIMIT_REACHED") return "简历数量已达上限，请先清理已有简历。";
  if (error.message === "TEMPLATE_INACTIVE") return "所选模板已不可用，请重新选择。";
  return "创建简历失败，请稍后重试。";
}

export function ResumeTemplatesPage() {
  const createResume = useResumeStore((state) => state.createResume);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<ResumeTemplate | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const result = await api.listResumeTemplates();
      setTemplates(result.templates);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const closeCreateDialog = () => {
    if (submitting) return;
    setSelectedTemplate(null);
    setTitle("");
    setCreateError(null);
  };

  const openCreateDialog = (template: ResumeTemplate) => {
    setPreviewTemplate(null);
    setSelectedTemplate(template);
    setTitle("");
    setCreateError(null);
  };

  const openPreviewDialog = (template: ResumeTemplate) => {
    setPreviewTemplate(template);
  };

  const submitCreate = async () => {
    if (!selectedTemplate || submitting) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setCreateError("请输入简历名称。");
      queueMicrotask(() => titleInputRef.current?.focus());
      return;
    }

    setSubmitting(true);
    setCreateError(null);
    try {
      const resumeId = await createResume(normalizedTitle, selectedTemplate.id);
      navigateTo(editorPath(resumeId));
    } catch (error) {
      setCreateError(createErrorMessage(error));
      queueMicrotask(() => titleInputRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="dashboard-content template-library-content">
      <WorkspacePageHero
        eyebrow="创建起点"
        title="简历模板"
        description="浏览当前可用版式，选择后填写简历名称并进入编辑器。"
      />

      {loading ? (
        <PageLoading label="正在加载简历模板…" />
      ) : (
        <section className="template-library-body" aria-label="可用简历模板">
          {failed && (
            <div className="template-library-state" role="alert">
              <span className="template-library-state-icon" aria-hidden="true"><RefreshCw size={20} /></span>
              <h2>模板暂时无法加载</h2>
              <p>请检查网络后重试，已有简历不会受到影响。</p>
              <Button variant="outline" icon={<RefreshCw size={15} aria-hidden="true" />} onClick={() => void loadTemplates()}>
                重新加载
              </Button>
            </div>
          )}

        {!failed && templates.length === 0 && (
          <div className="template-library-state">
            <span className="template-library-state-icon" aria-hidden="true"><LayoutTemplate size={20} /></span>
            <h2>当前没有可用模板</h2>
            <p>模板启用后会显示在这里，你仍可以从已有简历继续编辑。</p>
            <a
              className={buttonVariants({ variant: "outline" })}
              href="/resumes"
              onClick={(event) => followAppLink(event, "/resumes")}
            >
              返回全部简历
            </a>
          </div>
        )}

        {!failed && templates.length > 0 && (
          <div className="template-library-grid">
            {templates.map((template) => (
              <article className="template-library-card" key={template.id}>
                <button
                  className="template-library-preview-trigger"
                  type="button"
                  aria-label={`查看模板：${template.name}`}
                  aria-haspopup="dialog"
                  onClick={() => openPreviewDialog(template)}
                />
                <div className="template-library-preview" aria-hidden="true">
                  <ResumePreview data={template.data} style={template.style} />
                  <span className="template-library-preview-affordance">
                    <span className="template-library-preview-label">
                      <Eye size={16} aria-hidden="true" />
                      查看模板
                    </span>
                  </span>
                </div>
                <div className="template-library-card-copy">
                  <div>
                    <h2>{template.name}</h2>
                    <p>{template.description || "可直接创建并在编辑器中调整内容与样式。"}</p>
                  </div>
                  <Button
                    className="template-library-action"
                    variant="accent"
                    aria-haspopup="dialog"
                    onClick={() => openCreateDialog(template)}
                  >
                    创建简历
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
        </section>
      )}

      <TemplatePreviewDialog
        templates={templates}
        template={previewTemplate}
        primaryActionLabel="创建简历"
        onTemplateChange={setPreviewTemplate}
        onPrimaryAction={openCreateDialog}
        onClose={() => setPreviewTemplate(null)}
      />

      <Dialog open={selectedTemplate !== null} onOpenChange={(open) => !open && closeCreateDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建简历</DialogTitle>
            <DialogDescription>
              基于“{selectedTemplate?.name}”创建简历，输入一个便于识别的名称。
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="template-resume-title">简历名称</Label>
              <Input
                ref={titleInputRef}
                id="template-resume-title"
                name="resume-title"
                autoComplete="off"
                maxLength={255}
                placeholder="例如：2026 产品经理简历"
                value={title}
                aria-invalid={createError ? "true" : undefined}
                aria-describedby={createError ? "template-resume-title-error" : undefined}
                disabled={submitting}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (createError) setCreateError(null);
                }}
              />
              {createError && (
                <p id="template-resume-title-error" className="text-sm text-destructive" role="alert">
                  {createError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={submitting} onClick={closeCreateDialog}>
                取消
              </Button>
              <Button type="submit" variant="accent" disabled={submitting}>
                {submitting ? "正在创建…" : "确认创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
