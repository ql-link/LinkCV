import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  api,
  ApiRequestError,
  type AdminResumeTemplate,
} from "../../api/client";
import { FileUpload, PageLoading } from "@/components/ui";
import { ResumePreview } from "../preview/ResumePreview";
import { TemplateStyleClassifier } from "./TemplateStyleClassifier";

function compareTemplateOrder(left: AdminResumeTemplate, right: AdminResumeTemplate) {
  return left.sort_order - right.sort_order
    || left.id.length - right.id.length
    || left.id.localeCompare(right.id);
}

function parseSortOrder(raw: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= 1000000 ? value : null;
}

function hasChangedSortOrder(raw: string, current: number) {
  const value = parseSortOrder(raw);
  return value !== null && value !== current;
}

export function AdminTemplatePanel({ notify }: { notify: (message: string) => void }) {
  const [templates, setTemplates] = useState<AdminResumeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sortInputs, setSortInputs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AdminResumeTemplate | null>(null);
  const [view, setView] = useState<"manage" | "classify">("manage");

  const load = async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const result = await api.listAdminResumeTemplates();
      setTemplates(result.templates);
      setSortInputs(Object.fromEntries(result.templates.map((template) => [template.id, String(template.sort_order)])));
    } catch (error) {
      setLoadFailed(true);
      const code = error instanceof ApiRequestError ? error.message : "TEMPLATE_LIST_FAILED";
      notify(`模板读取失败：${code}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const upload = async (file: File) => {
    setBusyId("upload");
    try {
      await api.importAdminResumeTemplate(file);
      await load();
      notify("模板已导入，默认保持停用");
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.message : "TEMPLATE_IMPORT_FAILED";
      notify(`模板导入失败：${code}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (template: AdminResumeTemplate) => {
    setBusyId(template.id);
    try {
      const result = await api.updateAdminResumeTemplateStatus(template.id, !template.active);
      setTemplates((items) => items.map((item) => item.id === template.id ? result.template : item));
      notify(result.template.active ? "模板已启用" : "模板已停用");
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.message : "TEMPLATE_STATUS_FAILED";
      notify(`状态更新失败：${code}`);
    } finally {
      setBusyId(null);
    }
  };

  const saveSortOrder = async (template: AdminResumeTemplate) => {
    const raw = sortInputs[template.id] ?? String(template.sort_order);
    const sortOrder = parseSortOrder(raw);
    if (sortOrder === null || sortOrder === template.sort_order) return;
    setBusyId(template.id);
    try {
      const result = await api.updateAdminResumeTemplateSortOrder(template.id, sortOrder);
      setTemplates((items) => items.map((item) => item.id === template.id ? result.template : item).sort(compareTemplateOrder));
      setSortInputs((current) => ({ ...current, [template.id]: String(result.template.sort_order) }));
      notify("展示顺序已保存");
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.message : "TEMPLATE_SORT_ORDER_FAILED";
      notify(`排序保存失败：${code}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <header className="admin-page-heading">
        <div>
          <span>RESUME TEMPLATES</span>
          <h1>简历模板</h1>
          <p>上传严格 JSON 模板包，预览确认后再向用户启用。展示顺序数字越小越靠前，相同数字按模板 ID 排序。</p>
        </div>
      </header>

      <div className="admin-template-tabs" role="group" aria-label="模板管理视图">
        <button type="button" aria-pressed={view === "manage"} onClick={() => setView("manage")}>模板管理</button>
        <button type="button" aria-pressed={view === "classify"} onClick={() => setView("classify")}>模板分类</button>
      </div>

      {view === "classify" ? (
        loading ? <PageLoading label="正在读取模板…" scope="panel" /> : loadFailed ? (
          <div className="admin-surface template-classifier-load-error" role="alert">
            <p>模板读取失败，请检查连接后重试。</p>
            <button className="admin-secondary-button" type="button" onClick={() => void load()}>重新加载</button>
          </div>
        ) : <TemplateStyleClassifier templates={templates} onTemplateChange={(updated) => setTemplates((items) => items.map((item) => item.id === updated.id ? updated : item))} />
      ) : (
      <>
      <div className="admin-template-import">
        <FileUpload
          accept="application/json,.json"
          inputLabel="选择 JSON 模板包"
          supportingText="支持 JSON 模板包，选择后立即校验并导入"
          disabled={busyId !== null}
          browseLabel={busyId === "upload" ? "正在导入…" : "浏览文件"}
          onFileSelect={(file) => {
            if (file) void upload(file);
          }}
        />
      </div>

      <div className="admin-surface admin-template-list">
        {loading ? <PageLoading label="正在读取模板…" scope="panel" /> : templates.map((template) => (
          <article key={template.id} className="admin-template-row">
            {template.valid && template.data && template.style ? (
              <button
                className="admin-template-thumbnail"
                type="button"
                aria-label={`查看${template.name}完整预览`}
                onClick={() => setPreview(template)}
              >
                <span aria-hidden="true">
                  <ResumePreview data={template.data} style={template.style} layoutPlan={template.layout_plan} />
                </span>
              </button>
            ) : (
              <div className="admin-template-thumbnail admin-template-thumbnail-unavailable" role="img" aria-label={`${template.name}无法预览`}>
                无法预览
              </div>
            )}
            <div className="admin-template-details">
              <strong>{template.name}</strong>
              <small>{template.key} · ID {template.id}</small>
              <p>{template.description || "无说明"}</p>
            </div>
            <div className="admin-template-status">
              <span className={template.valid ? "is-valid" : "is-invalid"}>
                {template.valid ? "结构有效" : `结构无效：${template.validation_error || "未知错误"}`}
              </span>
              <span>{template.active ? "已启用" : "已停用"}</span>
            </div>
            <form className="admin-template-sort" onSubmit={(event) => { event.preventDefault(); void saveSortOrder(template); }}>
              <label htmlFor={`template-sort-${template.id}`}>展示顺序</label>
              <div>
                <input
                  id={`template-sort-${template.id}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="1000000"
                  step="1"
                  value={sortInputs[template.id] ?? String(template.sort_order)}
                  disabled={busyId !== null}
                  onChange={(event) => setSortInputs((current) => ({ ...current, [template.id]: event.target.value }))}
                  aria-label={`${template.name}的展示顺序`}
                />
                <button
                  type="submit"
                  className="admin-secondary-button"
                  disabled={busyId !== null || !hasChangedSortOrder(sortInputs[template.id] ?? String(template.sort_order), template.sort_order)}
                >
                  {busyId === template.id ? "保存中…" : "保存"}
                </button>
              </div>
            </form>
            <div className="admin-template-actions">
              <button
                type="button"
                className="admin-secondary-button"
                disabled={!template.valid}
                onClick={() => setPreview(template)}
              >
                预览
              </button>
              <button
                type="button"
                className="admin-primary-button"
                disabled={busyId !== null || (!template.active && !template.valid)}
                onClick={() => void toggle(template)}
              >
                {busyId === template.id ? "处理中…" : template.active ? "停用" : "启用"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {preview?.data && preview.style && (
        <div className="template-preview-backdrop" role="dialog" aria-modal="true" aria-label={`预览 ${preview.name}`}>
          <div className="template-preview-dialog">
            <button type="button" aria-label="关闭预览" onClick={() => setPreview(null)}><X size={18} /></button>
            <ResumePreview data={preview.data} style={preview.style} layoutPlan={preview.layout_plan} mode="full" />
          </div>
        </div>
      )}
      </>
      )}
    </section>
  );
}
