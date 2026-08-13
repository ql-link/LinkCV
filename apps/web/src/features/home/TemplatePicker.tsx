import { Check, Eye, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type ResumeTemplate } from "../../api/client";
import { Button } from "@/components/ui";
import { ResumePreview } from "../preview/ResumePreview";

export function TemplatePicker({
  selectedTemplateId,
  initialTemplateId,
  onSelect,
}: {
  selectedTemplateId: string | null;
  initialTemplateId?: string | null;
  onSelect: (template: ResumeTemplate) => void;
}) {
  const [templates, setTemplates] = useState<ResumeTemplate[]>([]);
  const [preview, setPreview] = useState<ResumeTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.listResumeTemplates().then(
      ({ templates: next }) => {
        if (cancelled) return;
        setTemplates(next);
        const initial = initialTemplateId
          ? next.find((template) => template.id === initialTemplateId)
          : undefined;
        if (initial) onSelect(initial);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setError("模板暂时无法加载，请稍后重试。");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [initialTemplateId, onSelect]);

  if (loading) return <div className="template-picker-state">正在加载模板…</div>;
  if (error) return <div className="template-picker-state error">{error}</div>;
  if (!templates.length) return <div className="template-picker-state">当前没有可用模板。</div>;

  return (
    <>
      <section className="template-picker-grid" aria-label="选择简历模板">
        {templates.map((template) => {
          const selected = selectedTemplateId === template.id;
          return (
            <article
              key={template.id}
              className={`template-picker-card${selected ? " selected" : ""}`}
            >
              <button type="button" className="template-picker-select" onClick={() => onSelect(template)}>
                <ResumePreview data={template.data} style={template.style} />
                <span className="template-picker-meta">
                  <strong>{template.name}</strong>
                  <small>{template.description ?? "适用于通用简历场景"}</small>
                </span>
                {selected && <span className="template-selected-mark"><Check size={14} />已选择</span>}
              </button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Eye size={14} />}
                onClick={() => setPreview(template)}
              >
                完整预览
              </Button>
            </article>
          );
        })}
      </section>
      {preview && (
        <div className="template-preview-backdrop" role="presentation" onMouseDown={() => setPreview(null)}>
          <section
            className="template-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${preview.name}完整预览`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div><strong>{preview.name}</strong><p>{preview.description}</p></div>
              <button type="button" aria-label="关闭预览" onClick={() => setPreview(null)}><X size={18} /></button>
            </header>
            <ResumePreview data={preview.data} style={preview.style} mode="full" />
          </section>
        </div>
      )}
    </>
  );
}
