import { Image as ImageIcon } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiRequestError, type JobDescriptionCreatePayload, type JobDescriptionDraft, type JobDuplicateDetails } from "../../api/client";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FileUpload, Input, Label, Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui";
import { SelectValue } from "@/components/ui/select";
import { jobDetailPath, navigateTo } from "../../routing";
import { JobDuplicateDialog } from "./JobDuplicateDialog";
import { duplicateFromJobError, emptyJobForm, jobFormErrorMessage, jobFormFromDraft, jobFormMissingFields, jobPayloadFromForm, type JobFormState } from "./jobFormModel";
import "./jobs.css";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
type ImportTab = "manual" | "text" | "image";

export function JobSmartImportDialog({ onClose, onParsed, unified = false }: {
  onClose: () => void;
  onParsed?: (draft: JobDescriptionDraft, warnings: string[]) => void;
  unified?: boolean;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<ImportTab>("text");
  const [form, setForm] = useState<JobFormState>(emptyJobForm);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<JobDuplicateDetails["duplicate"] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<JobDescriptionCreatePayload | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const previewUrl = useMemo(() => image ? URL.createObjectURL(image) : "", [image]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => requestRef.current?.abort(), []);

  const close = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    onClose();
  };

  const setField = <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setError("仅支持 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("图片不能超过 10 MiB。");
      return;
    }
    setImage(file);
    setActiveTab("image");
    setError("");
  };

  const selectTab = (tab: ImportTab) => {
    if (busy) return;
    setActiveTab(tab);
    setError("");
  };

  const parseImport = async () => {
    const normalizedText = text.trim();
    const inputType = activeTab === "image" ? "image" : "text";
    if (activeTab === "image" && !image) return setError("请上传岗位截图。");
    if (activeTab === "text" && !normalizedText) return setError("请输入岗位文字。");
    if (activeTab === "text" && normalizedText.length > 60_000) return setError("岗位文字不能超过 60000 个字符。");
    setBusy(true);
    setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const result = await api.parseJobDescriptionDraft(activeTab === "image"
        ? { image: image as File, signal: controller.signal }
        : { text: normalizedText, signal: controller.signal });
      if (!controller.signal.aborted && requestRef.current === controller) {
        if (unified) {
          setForm(jobFormFromDraft(result.draft));
          setWarnings(result.warnings);
          setActiveTab("manual");
        } else {
          onParsed?.(result.draft, result.warnings);
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(importErrorMessage(caught, inputType));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  };

  const createJob = async () => {
    const missing = jobFormMissingFields(form);
    if (missing.length > 0) return setError(`请先填写${missing.join("、")}`);
    setBusy(true);
    setError("");
    const payload = jobPayloadFromForm(form);
    setPendingPayload(payload);
    try {
      const { job_description } = await api.createJobDescription(payload);
      navigateTo(jobDetailPath(job_description.id), { replace: true });
    } catch (caught) {
      const duplicateDetails = duplicateFromJobError(caught);
      if (duplicateDetails) setDuplicate(duplicateDetails);
      else setError(jobFormErrorMessage(caught, "保存岗位失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  };

  const resolveDuplicate = async (action: "update" | "cancel") => {
    if (action === "cancel") return setDuplicate(null);
    if (!duplicate || !pendingPayload || busy) return;
    setBusy(true);
    setError("");
    try {
      const { job_description } = await api.createJobDescription({
        ...pendingPayload,
        duplicate_resolution: { action, job_description_id: duplicate.existing.id, base_lock_version: duplicate.existing.lock_version },
      });
      navigateTo(jobDetailPath(job_description.id), { replace: true });
    } catch (caught) {
      setDuplicate(null);
      setError(jobFormErrorMessage(caught, "重复岗位内容已经变化，请刷新后重试。"));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void (activeTab === "manual" ? createJob() : parseImport());
  };

  const title = unified ? "导入岗位" : "智能填写岗位信息";
  const description = unified ? "粘贴招聘信息或上传岗位截图，确认后创建一条求职记录。" : "提供招聘内容，生成一份可继续修改的岗位草稿。";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="job-smart-import-dialog" onPaste={(event) => {
        if (busy || activeTab === "manual") return;
        const pastedImage = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
        if (pastedImage) { event.preventDefault(); chooseImage(pastedImage); }
      }}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="job-smart-title">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="job-smart-tabs" role="tablist" aria-label="岗位导入方式">
            <ImportTabButton tab="manual" activeTab={activeTab} busy={busy} onSelect={selectTab}>手工填写</ImportTabButton>
            <ImportTabButton tab="text" activeTab={activeTab} busy={busy} onSelect={selectTab}>粘贴岗位文字</ImportTabButton>
            <ImportTabButton tab="image" activeTab={activeTab} busy={busy} onSelect={selectTab}>上传岗位截图</ImportTabButton>
          </div>
          <div className="job-smart-import-body">
            {activeTab === "manual" && <div id="job-smart-panel-manual" className="job-smart-panel job-smart-manual-panel" role="tabpanel" aria-labelledby="job-smart-tab-manual">
              {warnings.length > 0 && <p className="job-smart-warning" role="status">{warnings.join(" ")}</p>}
              <div className="job-smart-manual-sections">
                <section className="job-smart-manual-section">
                  <div className="job-smart-manual-section-heading">
                    <p>必填 2 项</p>
                    <h3 id="job-smart-manual-basic-title">基本信息</h3>
                  </div>
                  <div className="job-smart-manual-grid">
                    <CompactInput label="职位名称" hint="使用招聘信息中的正式岗位名称" required value={form.job_title} maxLength={200} onChange={(value) => setField("job_title", value)} />
                    <CompactInput label="公司名称" hint="填写公司或组织名称" required value={form.company_name} maxLength={200} onChange={(value) => setField("company_name", value)} />
                    <CompactTextarea className="is-wide" label="职位描述" hint="填写岗位职责、工作内容和任职要求（可选）" value={form.description} onChange={(value) => setField("description", value)} />
                  </div>
                </section>

                <section className="job-smart-manual-section">
                  <div className="job-smart-manual-section-heading">
                    <p>用于后续匹配与分析</p>
                    <h3 id="job-smart-manual-requirements-title">任职要求</h3>
                  </div>
                  <div className="job-smart-manual-grid">
                    <CompactInput label="技能" hint="使用逗号或换行分隔，例如：Java、SQL" value={form.skills} onChange={(value) => setField("skills", value)} />
                    <CompactSelect label="用工类型" value={form.employment_type} onChange={(value) => setField("employment_type", value as JobFormState["employment_type"])} options={[
                      ["full_time", "全职"], ["part_time", "兼职"], ["internship", "实习"], ["contract", "合同"], ["temporary", "临时"],
                    ]} />
                    <CompactInput label="学历要求" hint="例如：本科及以上" value={form.education_requirement} onChange={(value) => setField("education_requirement", value)} />
                    <CompactInput label="经验要求" hint="例如：3-5年" value={form.experience_requirement} onChange={(value) => setField("experience_requirement", value)} />
                  </div>
                </section>

                <section className="job-smart-manual-section">
                  <div className="job-smart-manual-section-heading">
                    <h3 id="job-smart-manual-work-salary-title">工作与薪酬</h3>
                  </div>
                  <div className="job-smart-manual-grid">
                    <CompactInput label="薪资范围" hint="例如：25-40K，或填写面议" value={form.salary_text} onChange={(value) => setField("salary_text", value)} />
                    <CompactInput label="详细地址" hint="填写办公地点或详细地址" value={form.work_address} onChange={(value) => setField("work_address", value)} />
                    <CompactSelect label="工作方式" value={form.work_mode} onChange={(value) => setField("work_mode", value as JobFormState["work_mode"])} options={[
                      ["onsite", "现场"], ["hybrid", "混合"], ["remote", "远程"],
                    ]} />
                    <CompactInput label="工作安排" hint="例如：双休、弹性打卡" value={form.work_schedule} onChange={(value) => setField("work_schedule", value)} />
                    <CompactInput className="is-wide" label="工作城市" hint="填写工作所在城市" value={form.work_city} onChange={(value) => setField("work_city", value)} />
                  </div>
                </section>

                <section className="job-smart-manual-section">
                  <div className="job-smart-manual-section-heading">
                    <h3 id="job-smart-manual-company-contact-title">公司与联系人</h3>
                  </div>
                  <div className="job-smart-manual-grid">
                    <CompactInput label="行业" hint="例如：互联网、金融" value={form.company_industry} onChange={(value) => setField("company_industry", value)} />
                    <CompactInput label="公司规模" hint="例如：100-499人" value={form.company_size} onChange={(value) => setField("company_size", value)} />
                    <CompactInput label="融资阶段" hint="例如：A轮、上市公司" value={form.company_financing_stage} onChange={(value) => setField("company_financing_stage", value)} />
                    <CompactInput label="招聘者姓名" hint="填写联系人姓名" value={form.recruiter_name} onChange={(value) => setField("recruiter_name", value)} />
                    <CompactInput label="招聘者职位" hint="填写联系人职位" value={form.recruiter_title} onChange={(value) => setField("recruiter_title", value)} />
                  </div>
                </section>

                <section className="job-smart-manual-section">
                  <div className="job-smart-manual-section-heading">
                    <h3 id="job-smart-manual-source-notes-title">来源与备注</h3>
                  </div>
                  <div className="job-smart-manual-grid">
                    <CompactInput label="来源链接（可选）" hint="粘贴岗位原始链接" type="url" value={form.source_url} onChange={(value) => setField("source_url", value)} />
                    <CompactTextarea className="is-wide" label="个人备注" hint="填写你对这个岗位的补充备注" value={form.notes} onChange={(value) => setField("notes", value)} />
                  </div>
                </section>
              </div>
            </div>}
            {activeTab === "text" && <div id="job-smart-panel-text" className="job-smart-panel" role="tabpanel" aria-labelledby="job-smart-tab-text">
              <label className="job-smart-text-field" htmlFor="job-smart-job-info">
                <textarea id="job-smart-job-info" aria-label="岗位文字" name="job-source-text" autoComplete="off" value={text} disabled={busy} maxLength={60_001} placeholder="粘贴职位名称、岗位职责、任职要求、薪资和公司信息…" onChange={(event) => { setText(event.target.value); setError(""); }} />
                <small>{text.length.toLocaleString("zh-CN")} / 60,000</small>
              </label>
              <p className="job-smart-hint">系统只提取岗位核心信息，创建后仍可在求职记录中修改。</p>
            </div>}
            {activeTab === "image" && <div id="job-smart-panel-image" className="job-smart-panel" role="tabpanel" aria-labelledby="job-smart-tab-image">
              {image ? <div className="job-smart-image-preview">
                <img src={previewUrl} alt="待识别岗位截图预览" width="116" height="96" />
                <div><ImageIcon aria-hidden="true" /><span><strong>{image.name}</strong><small>{formatBytes(image.size)}</small></span></div>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setImage(null); setError(""); }}>移除图片</Button>
              </div> : <FileUpload className="job-smart-image-upload" accept="image/png,image/jpeg,image/webp" inputLabel="选择岗位截图" supportingText="点击此区域上传岗位截图；支持 PNG、JPEG 或 WebP，最大 10 MiB；也支持拖放、直接粘贴截图。" browseLabel="" disabled={busy} onFileSelect={chooseImage} />}
            </div>}
            {error && <p className="job-smart-error" role="alert">{error}</p>}
          </div>
          <DialogFooter className="job-smart-footer">
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>取消</Button>
            <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? (activeTab === "manual" ? "正在创建…" : "正在识别…") : activeTab === "manual" ? "创建岗位" : unified ? "确认导入" : "开始识别"}</Button>
          </DialogFooter>
        </form>
        {duplicate && <JobDuplicateDialog details={duplicate} busy={busy} onAction={resolveDuplicate} />}
      </DialogContent>
    </Dialog>
  );
}

function ImportTabButton({ tab, activeTab, busy, onSelect, children }: { tab: ImportTab; activeTab: ImportTab; busy: boolean; onSelect: (tab: ImportTab) => void; children: React.ReactNode }) {
  return <button id={`job-smart-tab-${tab}`} type="button" role="tab" aria-selected={activeTab === tab} aria-controls={`job-smart-panel-${tab}`} className="job-smart-tab" disabled={busy} onClick={() => onSelect(tab)}>{children}</button>;
}

function CompactInput({ label, hint, className = "", required, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { label: string; hint?: string; className?: string; onChange: (value: string) => void }) {
  const id = `job-import-${label}`;
  return <div className={`job-smart-manual-field ${className}`.trim()}><Label htmlFor={id}>{label}{required && <em aria-hidden="true">*</em>}</Label><Input {...props} id={id} required={required} aria-label={label} autoComplete="off" placeholder={props.placeholder ?? hint} onChange={(event) => onChange(event.target.value)} /></div>;
}

function CompactTextarea({ label, hint, className = "", required, value, placeholder, onChange }: { label: string; hint?: string; className?: string; required?: boolean; value: string; placeholder?: string; onChange: (value: string) => void }) {
  const id = `job-import-${label}`;
  return <div className={`job-smart-manual-field ${className}`.trim()}><Label htmlFor={id}>{label}{required && <em aria-hidden="true">*</em>}</Label><textarea id={id} required={required} aria-label={label} value={value} placeholder={placeholder ?? hint} onChange={(event) => onChange(event.target.value)} /></div>;
}

const emptyCompactSelectValue = "__empty_job_import_select__";

function CompactSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  const id = `job-import-${label}`;
  return (
    <div className="job-smart-manual-field">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || emptyCompactSelectValue} onValueChange={(nextValue) => onChange(nextValue === emptyCompactSelectValue ? "" : nextValue)}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder="未填写" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={emptyCompactSelectValue}>未填写</SelectItem>
          {options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function importErrorMessage(error: unknown, inputType: "text" | "image"): string {
  if (!(error instanceof ApiRequestError)) return "暂时无法识别，请稍后重试。";
  if (error.message === "JD_IMPORT_MODEL_NOT_CONFIGURED") return `${inputType === "image" ? "图片" : "文字"}解析模型尚未配置，请联系管理员或改为填写。`;
  if (error.message === "JD_IMPORT_PARSE_TIMEOUT") return "识别超时，请重试或改为填写。";
  if (error.message === "JD_IMPORT_IMAGE_TOO_LARGE") return "图片不能超过 10 MiB。";
  if (error.message === "JD_IMPORT_IMAGE_UNSUPPORTED") return "仅支持 PNG、JPEG 或 WebP 图片。";
  if (error.message === "JD_IMPORT_IMAGE_INVALID") return "无法读取这张图片，请更换后重试。";
  if (error.message === "JD_IMPORT_TEXT_TOO_LARGE") return "岗位文字不能超过 60000 个字符。";
  if (error.message === "JD_IMPORT_PARSE_FAILED") return `未能从${inputType === "image" ? "图片" : "文字"}中识别出有效岗位信息，请重试或改为填写。`;
  return "暂时无法识别，请稍后重试。";
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
