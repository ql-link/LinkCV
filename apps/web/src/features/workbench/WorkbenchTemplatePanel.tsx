import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { api, type ResumeTemplate } from "../../api/client";
import { resumePresentationTemplateKey } from "../../api/resumeContract";
import { PageLoading } from "@/components/ui";
import { Icon } from "../../v3/Icon";
import { ResumePreview } from "../preview/ResumePreview";
import { V3TemplateFilter } from "../templates/TemplateFilterPopover";
import { WorkbenchPanelHeader } from "./WorkbenchPanelHeader";

export function WorkbenchTemplatePanel({
  currentTemplateKey,
  disabled = false,
  onApply,
  onClose,
}: {
  currentTemplateKey: string;
  disabled?: boolean;
  onApply: (template: ResumeTemplate) => Promise<void>;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedUseCases, setSelectedUseCases] = useState<string[]>([]);
  const shouldReduceMotion = useReducedMotion();
  const filteredTemplates = useMemo(() => templates.filter((template) =>
    (selectedStyles.length === 0 || selectedStyles.some((style) => template.style_categories?.includes(style)))
    && (selectedUseCases.length === 0 || selectedUseCases.some((useCase) => template.use_cases?.includes(useCase))),
  ), [templates, selectedStyles, selectedUseCases]);
  const filterKey = `${selectedStyles.slice().sort().join(",")}|${selectedUseCases.slice().sort().join(",")}`;
  const applyFilters = (styles: string[], useCases: string[]) => {
    setSelectedStyles(styles);
    setSelectedUseCases(useCases);
  };
  const bodyRef = useRef<HTMLDivElement>(null);
  const selectedCardRef = useRef<HTMLButtonElement>(null);
  const centeredOnOpenRef = useRef(false);

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

  useLayoutEffect(() => {
    if (loading || failed || centeredOnOpenRef.current) return;
    const body = bodyRef.current;
    const selectedCard = selectedCardRef.current;
    if (!body || !selectedCard) return;
    const bodyRect = body.getBoundingClientRect();
    const cardRect = selectedCard.getBoundingClientRect();
    body.scrollTop = Math.max(0,
      body.scrollTop + cardRect.top - bodyRect.top - (body.clientHeight - cardRect.height) / 2,
    );
    centeredOnOpenRef.current = true;
  }, [failed, loading, filteredTemplates]);

  const applyTemplate = async (template: ResumeTemplate) => {
    if (disabled || applyingId || resumePresentationTemplateKey(template.style) === currentTemplateKey) return;
    setApplyingId(template.id);
    try {
      await onApply(template);
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="workbench-template-panel">
      <WorkbenchPanelHeader
        titleId="workbench-template-title"
        title="简历模板"
        subtitle="点击模板即可应用到当前简历"
        closeLabel="关闭简历模板面板"
        onClose={onClose}
      />

      {!loading && !failed && templates.length > 0 ? (
        <div className="workbench-template-filters">
          <span aria-live="polite">{filteredTemplates.length} 套模板</span>
          <V3TemplateFilter styles={selectedStyles} useCases={selectedUseCases} onChange={applyFilters} />
        </div>
      ) : null}

      <div className={`workbench-template-panel-body${!loading && !failed && templates.length > 0 ? " is-filterable" : ""}`} ref={bodyRef}>
        {loading ? <PageLoading label="正在加载简历模板…" scope="panel" /> : null}

        {!loading && failed ? (
          <div className="workbench-template-state" role="alert">
            <strong>模板暂时无法加载</strong>
            <p>请检查网络后重试，当前简历不会受到影响。</p>
            <button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={() => void loadTemplates()}>
              <Icon name="refresh" size={13} />
              重新加载
            </button>
          </div>
        ) : null}

        {!loading && !failed && templates.length === 0 ? (
          <div className="workbench-template-state">
            <strong>当前没有可用模板</strong>
            <p>模板启用后会显示在这里。</p>
          </div>
        ) : null}

        {!loading && !failed && templates.length > 0 ? (
          <AnimatePresence initial={false} mode="wait">
          {filteredTemplates.length > 0 ? (
          <motion.ul
            key={filterKey}
            className="workbench-template-grid"
            aria-label="可用简历模板"
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, pointerEvents: "none" }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: "easeOut" }}
          >
            {filteredTemplates.map((template) => {
              const selected = resumePresentationTemplateKey(template.style) === currentTemplateKey;
              const busy = applyingId === template.id;
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    ref={selected ? selectedCardRef : null}
                    className={`workbench-template-card${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    aria-label={selected ? `${template.name}（当前模板）` : `应用模板：${template.name}`}
                    disabled={disabled || applyingId !== null}
                    onClick={() => void applyTemplate(template)}
                  >
                    <span className="workbench-template-card-preview" aria-hidden="true">
                      <ResumePreview
                        data={template.data}
                        style={template.style}
                        layoutPlan={template.layout_plan}
                      />
                    </span>
                    <span className="workbench-template-card-name">{template.name}</span>
                    {selected ? (
                      <span className="workbench-template-card-badge" aria-hidden="true">
                        <Icon name="check" size={12} strokeWidth={2.2} />
                      </span>
                    ) : null}
                    {busy ? (
                      <span className="workbench-template-card-busy" aria-hidden="true">
                        <LoaderCircle className="workbench-save-spinner" size={18} />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </motion.ul>
          ) : (
            <motion.div
              key={filterKey}
              className="workbench-template-state workbench-template-filter-empty"
              initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, pointerEvents: "none" }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: "easeOut" }}
            >
              <strong>没有符合条件的模板</strong>
              <p>试试减少一个筛选条件。</p>
              <button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={() => applyFilters([], [])}>清除筛选</button>
            </motion.div>
          )}
          </AnimatePresence>
        ) : null}
      </div>
    </div>
  );
}
