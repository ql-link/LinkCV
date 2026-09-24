import { useEffect, useMemo, useState } from "react";

import { api, ApiRequestError, type AdminResumeTemplate } from "../../api/client";
import { ResumePreview } from "../preview/ResumePreview";

const styles = ["简约", "经典", "现代", "创意"] as const;
const useCaseOptions = ["实习", "校招", "社招"] as const;
type Style = typeof styles[number];
type UseCase = typeof useCaseOptions[number];
type ReviewStatus = "pending" | "classified" | "unsure";

export function buildClassificationExport(templates: AdminResumeTemplate[]) {
  return {
    schema_version: "template-classification.v3",
    style_categories: [...styles],
    use_case_options: [...useCaseOptions],
    templates: templates.map((template) => ({
      key: template.key,
      name: template.name,
      style_categories: template.style_categories,
      use_cases: template.use_cases,
      style_review_status: template.style_review_status,
      use_case_review_status: template.use_cases.length > 0 ? "classified" : "pending",
    })),
  };
}

export function TemplateStyleClassifier({
  templates,
  onTemplateChange,
}: {
  templates: AdminResumeTemplate[];
  onTemplateChange: (template: AdminResumeTemplate) => void;
}) {
  const available = useMemo(
    () => templates.filter((template) => template.active && template.valid && template.data && template.style),
    [templates],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selected = available.find((template) => template.key === selectedKey) ?? available[0] ?? null;
  const isComplete = (template: AdminResumeTemplate) => template.style_review_status === "classified" && template.use_cases.length > 0;
  const completed = available.filter(isComplete).length;
  const styled = available.filter((template) => template.style_review_status === "classified").length;
  const scened = available.filter((template) => template.use_cases.length > 0).length;
  const unsure = available.filter((template) => template.style_review_status === "unsure").length;
  const visible = available.filter((template) => {
    if (onlyPending && isComplete(template)) return false;
    const search = query.trim().toLocaleLowerCase();
    return !search || `${template.name} ${template.key} ${template.description ?? ""}`.toLocaleLowerCase().includes(search);
  });

  useEffect(() => {
    if (selectedKey && available.some((template) => template.key === selectedKey)) return;
    setSelectedKey(available.find((template) => !isComplete(template))?.key ?? available[0]?.key ?? null);
  }, [available, selectedKey]);

  const save = async (styleCategories: Style[], useCases: UseCase[], status: ReviewStatus) => {
    if (!selected || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.updateAdminResumeTemplateClassification(selected.id, {
        style_categories: styles.filter((style) => styleCategories.includes(style)),
        use_cases: useCaseOptions.filter((useCase) => useCases.includes(useCase)),
        style_review_status: status,
      });
      onTemplateChange(result.template);
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.message : "TEMPLATE_CLASSIFICATION_FAILED";
      setSaveError(`分类保存失败：${code}。当前选择未生效，请重试。`);
    } finally {
      setSaving(false);
    }
  };

  const toggleStyle = (style: Style) => {
    if (!selected) return;
    const next = selected.style_categories.includes(style)
      ? selected.style_categories.filter((item) => item !== style)
      : [...selected.style_categories, style];
    void save(next as Style[], selected.use_cases as UseCase[], next.length > 0 ? "classified" : "pending");
  };

  const toggleUseCase = (useCase: UseCase) => {
    if (!selected) return;
    const next = selected.use_cases.includes(useCase)
      ? selected.use_cases.filter((item) => item !== useCase)
      : [...selected.use_cases, useCase];
    void save(selected.style_categories as Style[], next as UseCase[], selected.style_review_status);
  };

  const nextPending = () => {
    if (!selected || available.length === 0) return;
    const start = available.findIndex((template) => template.key === selected.key);
    for (let offset = 1; offset <= available.length; offset += 1) {
      const candidate = available[(start + offset) % available.length];
      if (!isComplete(candidate)) {
        setSelectedKey(candidate.key);
        return;
      }
    }
  };

  const exportAssignments = () => {
    const payload = buildClassificationExport(available);
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "template-classification.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <section className="template-classifier" aria-label="模板分类">
      <div className="template-classifier-intro admin-surface">
        <div>
          <h2>逐套查看，标注风格与适用场景</h2>
          <p>分类保存在数据库；用户模板库下次加载时读取最新标签。风格与适用场景均可多选。</p>
        </div>
        <div className="template-classifier-progress" aria-live="polite">
          <strong>{completed} / {available.length}</strong>
          <span>两项均已标注 · 风格 {styled} 套 · 场景 {scened} 套 · {unsure} 套风格待讨论</span>
        </div>
        <button className="admin-primary-button" type="button" disabled={available.length === 0} onClick={exportAssignments}>导出分类结果</button>
      </div>
      {saveError && <p className="template-classifier-warning" role="alert">{saveError}</p>}
      {available.length === 0 ? (
        <p className="admin-surface">当前没有可分类的已启用、结构有效模板。</p>
      ) : (
        <div className="template-classifier-layout">
          <aside className="template-classifier-sidebar admin-surface" aria-label="模板清单">
            <label htmlFor="template-classifier-search">搜索模板</label>
            <input id="template-classifier-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称或 key" />
            <label className="template-classifier-pending"><input type="checkbox" checked={onlyPending} onChange={(event) => setOnlyPending(event.target.checked)} />只看未完成</label>
            <div className="template-classifier-items">
              {visible.map((template) => (
                <button
                  key={template.key}
                  className={`template-classifier-item${selected?.key === template.key ? " is-selected" : ""}`}
                  type="button"
                  aria-current={selected?.key === template.key ? "true" : undefined}
                  onClick={() => setSelectedKey(template.key)}
                >
                  <span>{template.name}<small>{template.key}</small></span>
                  <em><span>风格：{template.style_review_status === "unsure" ? "待讨论" : template.style_categories.join("、") || "未分类"}</span><span>场景：{template.use_cases.join("、") || "未选择"}</span></em>
                </button>
              ))}
              {visible.length === 0 && <p>没有符合条件的模板。</p>}
            </div>
          </aside>
          {selected && (
            <div className="template-classifier-detail admin-surface">
              <header>
                <div><span>正在分类</span><h3>{selected.name}</h3><p>{selected.description || "无模板说明"}</p></div>
                <button className="admin-secondary-button" type="button" onClick={nextPending} disabled={completed === available.length}>下一个未完成</button>
              </header>
              <div className="template-classifier-preview" aria-label={`${selected.name}预览`}>
                {selected.data && selected.style && <ResumePreview data={selected.data} style={selected.style} layoutPlan={selected.layout_plan} mode="full" />}
              </div>
              <fieldset className="template-classifier-choices" disabled={saving}>
                <legend>选择风格（可多选）</legend>
                <p>简约：少装饰；经典：传统排版；现代：色块、卡片或分栏；创意：视觉结构更突出。再次点击可取消；“待讨论”与风格互斥。</p>
                <div>
                  {styles.map((style) => <button key={style} type="button" className={selected.style_categories.includes(style) ? "is-selected" : ""} aria-pressed={selected.style_categories.includes(style)} onClick={() => toggleStyle(style)}>{style}</button>)}
                  <button type="button" className={selected.style_review_status === "unsure" ? "is-selected" : ""} aria-pressed={selected.style_review_status === "unsure"} onClick={() => void save([], selected.use_cases as UseCase[], selected.style_review_status === "unsure" ? "pending" : "unsure")}>待讨论</button>
                </div>
              </fieldset>
              <fieldset className="template-classifier-choices" disabled={saving}>
                <legend>适用场景（可多选）</legend>
                <p>通用模板可选择多个场景；无法判断时可暂时留空。</p>
                <div>
                  {useCaseOptions.map((useCase) => <button key={useCase} type="button" className={selected.use_cases.includes(useCase) ? "is-selected" : ""} aria-pressed={selected.use_cases.includes(useCase)} onClick={() => toggleUseCase(useCase)}>{useCase}</button>)}
                </div>
              </fieldset>
              {saving && <p role="status">正在保存分类…</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
