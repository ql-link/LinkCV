import { Eye, LayoutTemplate, Minus, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import { api, ApiRequestError, type ResumeTemplate } from "../../api/client";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { ResumePreview } from "../preview/ResumePreview";
import { getWheelZoomScale } from "../workbench/workbenchZoom";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
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

function initialTemplatePreviewScale() {
  if (typeof window === "undefined") return 0.72;
  if (window.innerWidth <= 420) return 0.39;
  if (window.innerWidth <= 640) return 0.54;
  return 0.72;
}

export function ResumeTemplatesPage() {
  const createResume = useResumeStore((state) => state.createResume);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<ResumeTemplate | null>(null);
  const [previewScale, setPreviewScale] = useState(0.72);
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

  const handlePreviewWheel = useCallback((event: WheelEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;

    event.preventDefault();
    setPreviewScale((currentScale) => (
      getWheelZoomScale(currentScale, event, {
        minScale: 0.3,
        maxScale: 1.2,
        step: 0.08,
      }) ?? currentScale
    ));
  }, []);

  const changePreviewScale = (direction: -1 | 1) => {
    setPreviewScale((currentScale) => Math.min(
      1.2,
      Math.max(0.3, Number((currentScale + direction * 0.08).toFixed(2))),
    ));
  };

  const setPreviewStage = useCallback((stage: HTMLDivElement | null) => {
    previewStageRef.current?.removeEventListener("wheel", handlePreviewWheel);
    previewStageRef.current = stage;
    stage?.addEventListener("wheel", handlePreviewWheel, { passive: false });
  }, [handlePreviewWheel]);

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
    setPreviewScale(initialTemplatePreviewScale());
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

      <Dialog
        open={previewTemplate !== null}
        onOpenChange={(open) => !open && setPreviewTemplate(null)}
      >
        <DialogContent className="template-preview-dialog">
          <header className="template-preview-dialog-header">
            <span>模板预览</span>
            <span className="template-preview-dialog-divider" aria-hidden="true">/</span>
            <DialogTitle>{previewTemplate?.name}</DialogTitle>
          </header>
          <DialogDescription className="sr-only">
            完整预览所选简历模板，可按住 Ctrl 或 Command 并滚动鼠标滚轮进行缩放。
          </DialogDescription>
          <div className="template-preview-dialog-main">
            <aside className="template-preview-tools" aria-label="模板预览工具">
              <span className="template-preview-tools-label">缩放</span>
              <output
                className="template-preview-zoom-indicator"
                aria-live="polite"
                aria-label="模板预览缩放比例"
              >
                {Math.round(previewScale * 100)}%
              </output>
              <IconButton
                className="template-preview-tool-button"
                disabled={previewScale >= 1.2}
                label="放大模板"
                type="button"
                variant="circular"
                onClick={() => changePreviewScale(1)}
              >
                <Plus size={20} aria-hidden="true" />
              </IconButton>
              <IconButton
                className="template-preview-tool-button"
                disabled={previewScale <= 0.3}
                label="缩小模板"
                type="button"
                variant="circular"
                onClick={() => changePreviewScale(-1)}
              >
                <Minus size={20} aria-hidden="true" />
              </IconButton>
            </aside>
            <div
              ref={setPreviewStage}
              className="template-preview-dialog-stage"
              style={{ "--template-preview-scale": previewScale } as React.CSSProperties}
            >
              {previewTemplate && (
                <ResumePreview
                  data={previewTemplate.data}
                  style={previewTemplate.style}
                  mode="full"
                />
              )}
            </div>
          </div>
          <DialogFooter className="template-preview-dialog-footer">
            <DialogClose asChild>
              <Button type="button" variant="secondary">关闭</Button>
            </DialogClose>
            <Button
              type="button"
              variant="accent"
              onClick={() => previewTemplate && openCreateDialog(previewTemplate)}
            >
              创建简历
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
