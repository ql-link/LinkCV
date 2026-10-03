import { t, useLocale } from "@/i18n";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import type { ResumeTemplate } from "../../api/client";
import { Icon } from "../../v3/Icon";
import { Dialog } from "../../v3/primitives";
import { ResumePreview } from "../preview/ResumePreview";
import { getWheelZoomScale } from "../workbench/workbenchZoom";
import { formatTemplateUses } from "./templateUses";
import { SlideSwap } from "../../v3/SlideSwap";

// 缩放倍数相对「A4 宽 420」这一档（Figma 03.1a 里标 100%），范围 50%–200%，每档 10%
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

// 03.1a 模板预览（Figma 520:286，760×900）：标题 + 标签与使用次数 + 点阵舞台里的 A4 + 左右切换 + 缩放条 + 底部「第 n / N 套」
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
  useLocale();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const [zoom, setZoom] = useState(1);

  // 每次重新打开预览时回到 100%；在弹窗内切换模板时保留当前缩放
  useEffect(() => {
    if (template && !wasOpenRef.current) setZoom(1);
    wasOpenRef.current = template !== null;
  }, [template]);

  // 只有按住 Ctrl / Command 滚动才缩放，普通滚动留给纸面上下滚动
  const handleWheel = useCallback((event: WheelEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
    event.preventDefault();
    setZoom((current) => getWheelZoomScale(current, event, { minScale: MIN_ZOOM, maxScale: MAX_ZOOM, step: ZOOM_STEP }) ?? current);
  }, []);

  // wheel 需要 passive: false 才能 preventDefault，所以用原生监听
  const setScrollNode = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current?.removeEventListener("wheel", handleWheel);
    scrollRef.current = node;
    node?.addEventListener("wheel", handleWheel, { passive: false });
  }, [handleWheel]);

  const changeZoom = (direction: -1 | 1) => {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + direction * ZOOM_STEP).toFixed(2)))));
  };

  const index = template ? templates.findIndex((candidate) => candidate.id === template.id) : -1;
  const hasNeighbors = index >= 0 && templates.length > 1;
  const previousTemplate = hasNeighbors ? templates[(index - 1 + templates.length) % templates.length] : null;
  const nextTemplate = hasNeighbors ? templates[(index + 1) % templates.length] : null;

  // 记下切换方向：下一套向左翻（新模板从右侧进来），上一套向右翻
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1);
  const changeTemplate = useCallback((direction: -1 | 1) => {
    if (index < 0 || templates.length <= 1) return;
    setSlideDirection(direction);
    onTemplateChange(templates[(index + direction + templates.length) % templates.length]);
  }, [index, onTemplateChange, templates]);

  // 方向键循环切换（循环：第一套往左到最后一套）
  useEffect(() => {
    if (!template) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); changeTemplate(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); changeTemplate(1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [changeTemplate, template]);

  if (!template) return null;

  const actionLabel = typeof primaryActionLabel === "function" ? primaryActionLabel(template) : primaryActionLabel;
  const actionDisabled = Boolean(isPrimaryActionDisabled?.(template));
  const tags = [...(template.style_categories ?? []), ...(template.use_cases ?? [])];

  return (
    <Dialog width={760} label={template.name} onClose={onClose} className="tpl-preview-dialog">
      <div className="tpl-preview-head">
        <SlideSwap itemKey={template.id} direction={slideDirection} distance={16} className="tpl-preview-head-swap">
          <h2 className="v3-dialog-title">{template.name}</h2>
        <div className="tpl-preview-meta">
          {tags.map((tag) => <span key={tag} className="v3-chip">{t(tag)}</span>)}
          {typeof template.use_count === "number" && <span className="tpl-preview-uses">{formatTemplateUses(template.use_count)}{t(" 使用")}</span>}
        </div>
        </SlideSwap>
      </div>

      <div className="tpl-preview-stage v3-stage has-dots">
        <div ref={setScrollNode} className="tpl-preview-scroll" style={{ "--tpl-zoom": zoom } as CSSProperties}>
          <SlideSwap itemKey={template.id} direction={slideDirection} distance={72} className="tpl-preview-slide">
            <div className="tpl-preview-paper">
              <ResumePreview data={template.data} style={template.style} layoutPlan={template.layout_plan} mode="full" />
            </div>
          </SlideSwap>
        </div>

        <button
          type="button"
          className="tpl-preview-nav is-prev"
          aria-label={previousTemplate ? t("上一个模板：{value0}", { value0: previousTemplate.name }) : t("没有上一个模板")}
          disabled={!previousTemplate}
          onClick={() => changeTemplate(-1)}
        >
          <Icon name="chevl" size={14} />
        </button>
        <button
          type="button"
          className="tpl-preview-nav is-next"
          aria-label={nextTemplate ? t("下一个模板：{value0}", { value0: nextTemplate.name }) : t("没有下一个模板")}
          disabled={!nextTemplate}
          onClick={() => changeTemplate(1)}
        >
          <Icon name="chev" size={14} />
        </button>

        <div className="tpl-preview-zoom" role="group" aria-label={t("模板预览缩放")}>
          <button type="button" aria-label={t("缩小模板")} disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(-1)}>−</button>
          <output aria-live="polite" aria-label={t("模板预览缩放比例")}>{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label={t("放大模板")} disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(1)}>+</button>
        </div>
      </div>

      <div className="v3-dialog-foot tpl-preview-foot">
        <div className="v3-dialog-foot-left">
          {index >= 0 && <span className="tpl-preview-count">{t("第 ")}{index + 1} / {templates.length}{t(" 套")}</span>}
        </div>
        <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 80 }} onClick={onClose}>{t("取消")}</button>
        <button
          type="button"
          className="v3-btn v3-btn-dark"
          style={{ width: 100 }}
          disabled={actionDisabled}
          onClick={() => onPrimaryAction(template)}
        >
          {actionLabel}
        </button>
      </div>
    </Dialog>
  );
}
