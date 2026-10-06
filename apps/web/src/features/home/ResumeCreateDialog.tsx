import { t, useLocale } from "@/i18n";
import { MotionPresence } from "@/components/ui/motion";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { api, ApiRequestError, type ResumeTemplate } from "../../api/client";
import { editorPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { Icon } from "../../v3/Icon";
import { Dialog, Toast } from "../../v3/primitives";
import { ResumePreview } from "../preview/ResumePreview";
import { SlideSwap } from "../../v3/SlideSwap";
import { useStableCallback } from "./useStableCallback";
import "./home-v3.css";

type ResumeCreateDialogProps = {
  onClose: () => void;
  // 从模板页等入口带过来的默认模板
  initialTemplateId?: string | null;
};

function createErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return t("创建简历失败，请稍后重试。");
  if (error.message === "INVALID_RESUME_TITLE") return t("请输入 1–255 个字符的简历名称。");
  if (error.message === "RESUME_TITLE_CONFLICT") return t("该名称已经存在，请换一个名称。");
  if (error.message === "RESUME_LIMIT_REACHED") return t("简历数量已达上限，请先清理已有简历。");
  if (error.message === "TEMPLATE_INACTIVE") return t("所选模板已不可用，请重新选择。");
  return t("创建简历失败，请稍后重试。");
}

// 02.1a 新建简历（760 宽，布局同「简历模板」预览弹窗）：大预览 + 左右箭头滑动切换 → 简历名称 → 创建并进入编辑器
export function ResumeCreateDialog({ onClose, initialTemplateId = null }: ResumeCreateDialogProps) {
  useLocale();
  const createResume = useResumeStore((state) => state.createResume);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; key: number } | null>(null);

  const close = useStableCallback(onClose);
  const fail = (message: string) => setError({ message, key: Date.now() });

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const result = await api.listResumeTemplates();
      setTemplates(result.templates);
      const initialIndex = initialTemplateId ? result.templates.findIndex((template) => template.id === initialTemplateId) : -1;
      setSelectedIndex(Math.max(0, initialIndex));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [initialTemplateId]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const selectedTemplate = templates[selectedIndex] ?? null;

  // 记下切换方向：下一套向左翻（新模板从右侧进来），和「简历模板」预览弹窗一致
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1);
  const moveSelection = (direction: -1 | 1) => {
    if (templates.length < 2) return;
    setSlideDirection(direction);
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
      fail(t("请输入简历名称。"));
      titleInputRef.current?.focus();
      return;
    }
    if (!selectedTemplate) {
      fail(t("请先选择一套简历模板。"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resumeId = await createResume(normalizedTitle, selectedTemplate.id);
      navigateTo(editorPath(resumeId));
    } catch (reason) {
      fail(createErrorMessage(reason));
      setSubmitting(false);
      titleInputRef.current?.focus();
    }
  };

  const navDisabled = submitting || templates.length < 2;

  return (
    // 布局参照「简历模板」预览弹窗：顶部标题 + 当前模板名，中间整块点阵舞台放大预览，左右箭头切换（带滑动过渡），下面填名称
    <Dialog width={760} label={t("新建简历")} onClose={close} closable={!submitting} className="hv3-create is-preview">
      <form
        className="hv3-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="hv3-create-head">
          <h2 className="v3-dialog-title">{t("新建简历")}</h2>
          <div className="hv3-create-head-meta">
            {selectedTemplate ? (
              <SlideSwap itemKey={selectedTemplate.id} direction={slideDirection} distance={16} className="hv3-create-head-swap">
                <p className="v3-dialog-sub">
                  <strong className="hv3-create-name">{selectedTemplate.name}</strong>
                  {[...(selectedTemplate.style_categories ?? []), ...(selectedTemplate.use_cases ?? [])].slice(0, 3).map((tag) => <span key={tag} className="v3-chip">{tag}</span>)}
                </p>
              </SlideSwap>
            ) : <p className="v3-dialog-sub">{t("选一套模板，再起个名字，创建后直接进入编辑器。")}</p>}
          </div>
        </div>

        <div className="v3-stage has-dots hv3-create-stage" aria-labelledby="hv3-create-template-title">
          <span id="hv3-create-template-title" className="visually-hidden">{t("选择模板")}</span>
          {loading && <div className="hv3-create-state" role="status">{t("正在加载简历模板…")}</div>}
          {!loading && loadFailed && (
            <div className="hv3-create-state" role="alert">
              <p>{t("模板暂时无法加载，请检查网络后重试。")}</p>
              <button type="button" className="v3-btn v3-btn-ghost" onClick={() => void loadTemplates()}>
                <Icon name="refresh" size={13} />{t("重新加载")}</button>
            </div>
          )}
          {!loading && !loadFailed && templates.length === 0 && (
            <div className="hv3-create-state" role="status">{t("当前没有可用模板，暂时无法新建简历。")}</div>
          )}
          {!loading && !loadFailed && selectedTemplate && (
            <>
              <div
                ref={carouselRef}
                className="hv3-create-carousel"
                role="listbox"
                aria-label={t("选择简历模板")}
                aria-activedescendant={`hv3-create-template-${selectedTemplate.id}`}
                tabIndex={submitting ? -1 : 0}
                onKeyDown={handleTemplateKeyDown}
              >
                <SlideSwap itemKey={selectedTemplate.id} direction={slideDirection} distance={72} className="hv3-create-slide">
                  <div
                    id={`hv3-create-template-${selectedTemplate.id}`}
                    className="hv3-create-card"
                    role="option"
                    aria-selected="true"
                    aria-label={t("{value0}，已选择", { value0: selectedTemplate.name })}
                  >
                    <span className="hv3-create-paper" aria-hidden="true">
                      <ResumePreview data={selectedTemplate.data} style={selectedTemplate.style} layoutPlan={selectedTemplate.layout_plan} />
                    </span>
                  </div>
                </SlideSwap>
              </div>
              <button type="button" className="hv3-create-nav is-prev" aria-label={t("上一个模板")} disabled={navDisabled} onClick={() => { moveSelection(-1); carouselRef.current?.focus({ preventScroll: true }); }}>
                <Icon name="chevl" size={14} />
              </button>
              <button type="button" className="hv3-create-nav is-next" aria-label={t("下一个模板")} disabled={navDisabled} onClick={() => { moveSelection(1); carouselRef.current?.focus({ preventScroll: true }); }}>
                <Icon name="chev" size={14} />
              </button>
            </>
          )}
        </div>

        <div className="hv3-create-name-field">
          <div className="hv3-step-head">
            <h3><label htmlFor="new-resume-title">{t("简历名称")}</label></h3>
            <span className="hv3-step-aside">{t("只给自己看，方便在列表里区分")}</span>
          </div>
          <input
            ref={titleInputRef}
            id="new-resume-title"
            className="v3-input hv3-create-input"
            name="resume-title"
            autoComplete="off"
            maxLength={255}
            placeholder={t("例如：后端工程师 · 字节跳动")}
            value={title}
            disabled={submitting}
            data-autofocus
            aria-invalid={error ? "true" : undefined}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError(null);
            }}
          />
        </div>

        <div className="v3-dialog-foot hv3-foot">
          <div className="v3-dialog-foot-left">
            {templates.length > 0 && (
              <output className="hv3-create-count" aria-live="polite" aria-label={t("当前模板位置")}>{t("第 ")}{selectedIndex + 1} / {templates.length}{t(" 套")}</output>
            )}
            <span className="hv3-foot-note">{t("模板之后可以在编辑器里随时切换")}</span>
          </div>
          <button type="button" className="v3-btn v3-btn-ghost hv3-foot-cancel" disabled={submitting} onClick={onClose}>{t("取消")}</button>
          <button type="submit" className="v3-btn v3-btn-dark hv3-create-submit" disabled={submitting || loading || loadFailed || !selectedTemplate}>
            {submitting ? t("正在创建…") : t("创建并进入编辑器")}
          </button>
        </div>
      </form>
      <MotionPresence>{error && <Toast key={error.key} kind="error" title={error.message} onDismiss={() => setError(null)} />}</MotionPresence>
    </Dialog>
  );
}
