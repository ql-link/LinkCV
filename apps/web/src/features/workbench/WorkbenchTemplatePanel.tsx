import { Check, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, type ResumeTemplate } from "../../api/client";
import { resumePresentationTemplateKey } from "../../api/resumeContract";
import { Button, PageLoading } from "@/components/ui";
import { ResumePreview } from "../preview/ResumePreview";

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
  }, [failed, loading, templates]);

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
      <header className="workbench-template-panel-head">
        <span>
          <h2 id="workbench-template-title">简历模板</h2>
          <small>点击模板即可应用到当前简历</small>
        </span>
        <button
          type="button"
          className="workbench-drawer-done"
          onClick={onClose}
          aria-label="关闭简历模板面板"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </header>

      <div className="workbench-template-panel-body" ref={bodyRef}>
        {loading ? <PageLoading label="正在加载简历模板…" scope="panel" /> : null}

        {!loading && failed ? (
          <div className="workbench-template-state" role="alert">
            <strong>模板暂时无法加载</strong>
            <p>请检查网络后重试，当前简历不会受到影响。</p>
            <Button
              icon={<RefreshCw aria-hidden="true" size={15} />}
              onClick={() => void loadTemplates()}
              size="sm"
              variant="outline"
            >
              重新加载
            </Button>
          </div>
        ) : null}

        {!loading && !failed && templates.length === 0 ? (
          <div className="workbench-template-state">
            <strong>当前没有可用模板</strong>
            <p>模板启用后会显示在这里。</p>
          </div>
        ) : null}

        {!loading && !failed && templates.length > 0 ? (
          <ul className="workbench-template-grid" aria-label="可用简历模板">
            {templates.map((template) => {
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
                        <Check size={13} />
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
          </ul>
        ) : null}
      </div>
    </div>
  );
}
