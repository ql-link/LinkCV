import { useEffect, useState } from "react";
import { FileUp, X } from "lucide-react";
import {
  api,
  ApiRequestError,
  type AdminResumeTemplate,
} from "../../api/client";
import { ResumePreview } from "../preview/ResumePreview";

export function AdminTemplatePanel({ notify }: { notify: (message: string) => void }) {
  const [templates, setTemplates] = useState<AdminResumeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdminResumeTemplate | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.listAdminResumeTemplates();
      setTemplates(result.templates);
    } catch (error) {
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

  return (
    <section>
      <header className="admin-page-heading">
        <div>
          <span>RESUME TEMPLATES</span>
          <h1>简历模板</h1>
          <p>上传严格 JSON 模板包，预览确认后再向用户启用。</p>
        </div>
        <label className="admin-primary-button admin-template-upload">
          <FileUp size={16} />
          {busyId === "upload" ? "正在导入…" : "导入模板包"}
          <input
            type="file"
            accept="application/json,.json"
            disabled={busyId !== null}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      </header>

      <div className="admin-surface admin-template-list">
        {loading ? <p>正在读取模板…</p> : templates.map((template) => (
          <article key={template.id} className="admin-template-row">
            <div>
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
            <ResumePreview data={preview.data} style={preview.style} mode="full" />
          </div>
        </div>
      )}
    </section>
  );
}
