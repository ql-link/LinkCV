import { Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { api, ApiRequestError, type ResumeTemplate } from "../../api/client";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FeedbackNotice,
  IconButton,
  Input,
  Label,
  PageLoading,
} from "@/components/ui";
import { ResumePreview } from "../preview/ResumePreview";
import "./resume-create-dialog.css";

type ResumeCreateDialogProps = {
  onClose: () => void;
};

function createErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "创建简历失败，请稍后重试。";
  if (error.message === "INVALID_RESUME_TITLE") return "请输入 1–255 个字符的简历名称。";
  if (error.message === "RESUME_TITLE_CONFLICT") return "该名称已经存在，请换一个名称。";
  if (error.message === "RESUME_LIMIT_REACHED") return "简历数量已达上限，请先清理已有简历。";
  if (error.message === "TEMPLATE_INACTIVE") return "所选模板已不可用，请重新选择。";
  return "创建简历失败，请稍后重试。";
}

type VisibleTemplate = {
  position: "previous" | "current" | "next";
  template: ResumeTemplate;
};

function visibleTemplates(templates: ResumeTemplate[], selectedIndex: number): VisibleTemplate[] {
  if (templates.length === 0) return [];
  if (templates.length === 1) return [{ position: "current", template: templates[0] }];
  if (templates.length === 2) {
    const otherIndex = selectedIndex === 0 ? 1 : 0;
    return [
      { position: "previous", template: templates[otherIndex] },
      { position: "current", template: templates[selectedIndex] },
    ];
  }
  return [
    { position: "previous", template: templates[(selectedIndex - 1 + templates.length) % templates.length] },
    { position: "current", template: templates[selectedIndex] },
    { position: "next", template: templates[(selectedIndex + 1) % templates.length] },
  ];
}

export function ResumeCreateDialog({ onClose }: ResumeCreateDialogProps) {
  const createResume = useResumeStore((state) => state.createResume);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const result = await api.listResumeTemplates();
      setTemplates(result.templates);
      setSelectedIndex(0);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const selectedTemplate = templates[selectedIndex] ?? null;
  const displayedTemplates = useMemo(
    () => visibleTemplates(templates, selectedIndex),
    [selectedIndex, templates],
  );

  const selectTemplate = (templateId: string) => {
    const nextIndex = templates.findIndex((template) => template.id === templateId);
    if (nextIndex < 0) return;
    setSelectedIndex(nextIndex);
    setError(null);
  };

  const moveSelection = (direction: -1 | 1) => {
    if (templates.length < 2) return;
    setSelectedIndex((current) => (current + direction + templates.length) % templates.length);
    setError(null);
  };

  const handleTemplateKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(1);
    }
  };

  const submit = async () => {
    if (submitting) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("请输入简历名称。");
      titleInputRef.current?.focus();
      return;
    }
    if (!selectedTemplate) {
      setError("请先选择一套简历模板。");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const resumeId = await createResume(normalizedTitle, selectedTemplate.id);
      navigateTo(editorPath(resumeId));
    } catch (reason) {
      setError(createErrorMessage(reason));
      setSubmitting(false);
      titleInputRef.current?.focus();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent
        className="resume-create-dialog"
        aria-label="新建简历"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleInputRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => submitting && event.preventDefault()}
        onPointerDownOutside={(event) => submitting && event.preventDefault()}
      >
        <DialogHeader className="resume-create-header">
          <DialogTitle>新建简历</DialogTitle>
          <DialogDescription>命名并选择一个起点，创建后直接进入编辑器。</DialogDescription>
        </DialogHeader>

        <form
          className="resume-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="resume-create-name-field">
            <Label htmlFor="new-resume-title">简历名称</Label>
            <Input
              ref={titleInputRef}
              id="new-resume-title"
              name="resume-title"
              autoComplete="off"
              maxLength={255}
              placeholder="例如：2026 产品经理简历"
              value={title}
              disabled={submitting}
              aria-invalid={error ? "true" : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                if (error) setError(null);
              }}
            />
          </div>

          <section className="resume-create-template-section" aria-labelledby="resume-create-template-title">
            <h3 id="resume-create-template-title">选择模板</h3>

            {loading && <PageLoading label="正在加载简历模板…" scope="panel" />}

            {!loading && loadFailed && (
              <div className="resume-create-template-state" role="alert">
                <p>模板暂时无法加载，请检查网络后重试。</p>
                <Button
                  type="button"
                  variant="outline"
                  icon={<RefreshCw aria-hidden="true" />}
                  onClick={() => void loadTemplates()}
                >
                  重新加载
                </Button>
              </div>
            )}

            {!loading && !loadFailed && templates.length === 0 && (
              <div className="resume-create-template-state" role="status">
                <p>当前没有可用模板，暂时无法新建简历。</p>
              </div>
            )}

            {!loading && !loadFailed && templates.length > 0 && (
              <>
                <div
                  ref={carouselRef}
                  className={`resume-create-carousel is-count-${displayedTemplates.length}`}
                  role="listbox"
                  aria-label="选择简历模板"
                  aria-activedescendant={`resume-create-template-${selectedTemplate?.id}`}
                  tabIndex={submitting ? -1 : 0}
                  onKeyDown={handleTemplateKeyDown}
                >
                  {displayedTemplates.map(({ position, template }) => {
                    const selected = position === "current";
                    return (
                      <button
                        id={`resume-create-template-${template.id}`}
                        key={template.id}
                        className={`resume-create-template-card is-${position}${selected ? " is-selected" : ""}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={`${template.name}${selected ? "，已选择" : ""}`}
                        tabIndex={-1}
                        disabled={submitting}
                        onClick={() => {
                          selectTemplate(template.id);
                          carouselRef.current?.focus({ preventScroll: true });
                        }}
                      >
                        <span className="resume-create-template-preview" aria-hidden="true">
                          <ResumePreview data={template.data} style={template.style} layoutPlan={template.layout_plan} />
                        </span>
                        <strong>{template.name}</strong>
                        {selected && (
                          <span className="resume-create-template-check" aria-hidden="true">
                            <Check />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="resume-create-pagination" aria-label="模板分页">
                  <IconButton
                    type="button"
                    variant="circular"
                    label="上一个模板"
                    disabled={submitting || templates.length < 2}
                    onClick={() => moveSelection(-1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </IconButton>
                  <output aria-live="polite" aria-label="当前模板位置">
                    {selectedIndex + 1} / {templates.length}
                  </output>
                  <IconButton
                    type="button"
                    variant="circular"
                    label="下一个模板"
                    disabled={submitting || templates.length < 2}
                    onClick={() => moveSelection(1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </IconButton>
                </div>
              </>
            )}
          </section>

          {error && <FeedbackNotice kind="error">{error}</FeedbackNotice>}

          <DialogFooter className="resume-create-actions">
            <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant="accent"
              disabled={submitting || loading || loadFailed || !selectedTemplate}
            >
              {submitting ? "正在创建…" : "创建并进入编辑器"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
