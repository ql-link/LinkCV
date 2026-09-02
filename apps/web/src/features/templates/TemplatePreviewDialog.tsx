import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import type { ResumeTemplate } from "../../api/client";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  IconButton,
} from "@/components/ui";
import { ResumePreview } from "../preview/ResumePreview";
import { getWheelZoomScale } from "../workbench/workbenchZoom";

function initialTemplatePreviewScale() {
  if (typeof window === "undefined") return 0.72;
  if (window.innerWidth <= 420) return 0.39;
  if (window.innerWidth <= 640) return 0.54;
  return 0.72;
}

export function TemplatePreviewDialog({
  templates,
  template,
  primaryActionLabel,
  isPrimaryActionDisabled,
  onTemplateChange,
  onPrimaryAction,
  onClose,
}: {
  templates: ResumeTemplate[];
  template: ResumeTemplate | null;
  primaryActionLabel: string | ((template: ResumeTemplate) => string);
  isPrimaryActionDisabled?: (template: ResumeTemplate) => boolean;
  onTemplateChange: (template: ResumeTemplate) => void;
  onPrimaryAction: (template: ResumeTemplate) => void;
  onClose: () => void;
}) {
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const [previewScale, setPreviewScale] = useState(0.72);

  useEffect(() => {
    if (template && !wasOpenRef.current) setPreviewScale(initialTemplatePreviewScale());
    wasOpenRef.current = template !== null;
  }, [template]);

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

  const setPreviewStage = useCallback((stage: HTMLDivElement | null) => {
    previewStageRef.current?.removeEventListener("wheel", handlePreviewWheel);
    previewStageRef.current = stage;
    stage?.addEventListener("wheel", handlePreviewWheel, { passive: false });
  }, [handlePreviewWheel]);

  useEffect(() => () => {
    previewStageRef.current?.removeEventListener("wheel", handlePreviewWheel);
  }, [handlePreviewWheel]);

  const changePreviewScale = (direction: -1 | 1) => {
    setPreviewScale((currentScale) => Math.min(
      1.2,
      Math.max(0.3, Number((currentScale + direction * 0.08).toFixed(2))),
    ));
  };

  const previewTemplateIndex = template
    ? templates.findIndex((candidate) => candidate.id === template.id)
    : -1;
  const hasPreviewNeighbors = previewTemplateIndex >= 0 && templates.length > 1;
  const previousTemplate = hasPreviewNeighbors
    ? templates[(previewTemplateIndex - 1 + templates.length) % templates.length]
    : null;
  const nextTemplate = hasPreviewNeighbors
    ? templates[(previewTemplateIndex + 1) % templates.length]
    : null;

  const changePreviewTemplate = (direction: -1 | 1) => {
    if (previewTemplateIndex < 0 || templates.length <= 1) return;
    const nextIndex = (previewTemplateIndex + direction + templates.length) % templates.length;
    onTemplateChange(templates[nextIndex]);
  };

  const actionLabel = template
    ? typeof primaryActionLabel === "function" ? primaryActionLabel(template) : primaryActionLabel
    : typeof primaryActionLabel === "string" ? primaryActionLabel : "确认";
  const actionDisabled = !template || Boolean(template && isPrimaryActionDisabled?.(template));

  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="template-preview-dialog"
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            changePreviewTemplate(-1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            changePreviewTemplate(1);
          }
        }}
      >
        <header className="template-preview-dialog-header">
          <span>模板预览</span>
          <span className="template-preview-dialog-divider" aria-hidden="true">/</span>
          <DialogTitle>{template?.name}</DialogTitle>
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
            style={{ "--template-preview-scale": previewScale } as CSSProperties}
          >
            <div className="template-preview-carousel">
              {previousTemplate && (
                <button
                  className="template-preview-neighbor template-preview-neighbor-previous"
                  type="button"
                  aria-label={`预览上一个模板：${previousTemplate.name}`}
                  onClick={() => changePreviewTemplate(-1)}
                >
                  <span aria-hidden="true">
                    <ResumePreview data={previousTemplate.data} style={previousTemplate.style} layoutPlan={previousTemplate.layout_plan} />
                  </span>
                </button>
              )}

              <div className="template-preview-current" key={template?.id}>
                {template && <ResumePreview data={template.data} style={template.style} layoutPlan={template.layout_plan} mode="full" />}
              </div>

              {nextTemplate && (
                <button
                  className="template-preview-neighbor template-preview-neighbor-next"
                  type="button"
                  aria-label={`预览下一个模板：${nextTemplate.name}`}
                  onClick={() => changePreviewTemplate(1)}
                >
                  <span aria-hidden="true">
                    <ResumePreview data={nextTemplate.data} style={nextTemplate.style} layoutPlan={nextTemplate.layout_plan} />
                  </span>
                </button>
              )}

              <button
                className="template-preview-navigation template-preview-navigation-previous"
                type="button"
                aria-label={previousTemplate ? `上一个模板：${previousTemplate.name}` : "没有上一个模板"}
                disabled={!previousTemplate}
                onClick={() => changePreviewTemplate(-1)}
              >
                <span className="template-preview-navigation-icon" aria-hidden="true">
                  <ChevronLeft size={28} />
                </span>
                <span>上一个模板</span>
              </button>

              <button
                className="template-preview-navigation template-preview-navigation-next"
                type="button"
                aria-label={nextTemplate ? `下一个模板：${nextTemplate.name}` : "没有下一个模板"}
                disabled={!nextTemplate}
                onClick={() => changePreviewTemplate(1)}
              >
                <span className="template-preview-navigation-icon" aria-hidden="true">
                  <ChevronRight size={28} />
                </span>
                <span>下一个模板</span>
              </button>
            </div>
          </div>
        </div>
        <DialogFooter className="template-preview-dialog-footer">
          <DialogClose asChild>
            <Button type="button" variant="secondary">关闭</Button>
          </DialogClose>
          <Button
            type="button"
            variant="accent"
            disabled={actionDisabled}
            onClick={() => template && onPrimaryAction(template)}
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
