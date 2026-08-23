import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, ExternalLink, MapPin, Trash2, WalletCards } from "lucide-react";
import { api, ApiRequestError, type JobDescriptionRecord } from "../../api/client";
import { Button, ConfirmDialog, PageLoading } from "@/components/ui";
import { navigateTo } from "../../routing";
import { jobFormFromRecord, jobPayloadFromForm, type JobFormState } from "./jobFormModel";
import "./jobs.css";

export function JobDetailPage({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDescriptionRecord | null>(null);
  const [editingField, setEditingField] = useState<keyof JobFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getJobDescription(jobId).then(({ job_description }) => {
      if (cancelled) return;
      setJob(job_description);
    }).catch((loadError: unknown) => {
      if (!cancelled) setError(detailErrorMessage(loadError));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [jobId]);

  const saveField = async (field: keyof JobFormState, value: string) => {
    if (!job || busy) return;
    if (["job_title", "company_name", "description"].includes(field) && !value.trim()) {
      setError("该字段为必填项，不能保存空内容。");
      return;
    }
    const nextForm = { ...jobFormFromRecord(job), [field]: value } as JobFormState;
    setBusy(true);
    setError(null);
    try {
      const { source_url: _sourceUrl, source_type: _sourceType, duplicate_resolution: _duplicateResolution, ...fields } = jobPayloadFromForm(nextForm);
      void _sourceUrl; void _sourceType; void _duplicateResolution;
      const { job_description } = await api.updateJobDescription(job.id, { ...fields, base_lock_version: job.lock_version });
      setJob(job_description);
      setEditingField(null);
    } catch (actionError) {
      setError(detailErrorMessage(actionError, "保存岗位失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  };

  const deleteJob = async () => {
    if (!job || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteJobDescription(job.id);
      navigateTo("/jobs", { replace: true });
    } catch (actionError) {
      setError(detailErrorMessage(actionError));
      setDeleteOpen(false);
      setBusy(false);
    }
  };

  if (loading) return <main className="dashboard-content job-page-shell"><PageLoading label="正在加载岗位详情…" /></main>;
  if (!job) return <main className="dashboard-content job-page-shell"><section className="job-workspace-state"><h1>无法打开这条 JD</h1><p>{error}</p><Button onClick={() => navigateTo("/jobs", { replace: true })}>返回 JD 中心</Button></section></main>;

  return (
    <main className="dashboard-content job-page-shell">
      <article className="job-detail">
        <div className="job-detail-topbar">
          <div className="job-detail-heading">
            <h1 className="job-detail-page-title">JD 详情</h1>
            <a className="job-back-link" href="/jobs" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigateTo("/jobs"); }}><ArrowLeft size={14} />返回 JD 中心</a>
          </div>
          <div className="job-detail-actions">
            <Button variant="ghost" icon={<Trash2 size={15} />} disabled={busy} onClick={() => setDeleteOpen(true)}>删除</Button>
          </div>
        </div>
        {error && <div className="job-error job-detail-error" role="alert">{error}</div>}
        <JobDocument job={job} editingField={editingField} busy={busy} onEdit={setEditingField} onSave={saveField} />
      </article>
      {deleteOpen && <ConfirmDialog kind="delete" title={`永久删除「${job.job_title}」？`} description="删除后无法恢复，并会释放该来源，之后再次写入会创建新的 JD。" confirmLabel="永久删除" busyLabel="正在删除…" busy={busy} onCancel={() => setDeleteOpen(false)} onConfirm={deleteJob} />}
    </main>
  );
}

function JobDocument({ job, editingField, busy, onEdit, onSave }: { job: JobDescriptionRecord; editingField: keyof JobFormState | null; busy: boolean; onEdit: (field: keyof JobFormState | null) => void; onSave: (field: keyof JobFormState, value: string) => Promise<void> }) {
  const editable = (field: keyof JobFormState, label: string, value: string | null | undefined, options?: Array<[string, string]>) => (
    <InlineEditableField field={field} label={label} value={value ?? ""} options={options} active={editingField === field} disabled={busy} onEdit={onEdit} onSave={onSave} />
  );
  return (
    <section className="job-document">
      <header className="job-document-hero">
        <div className="job-document-title">
          {editable("company_name", "公司名称", job.company_name)}
          <div className="job-document-title-main"><InlineEditableField field="job_title" label="职位名称" value={job.job_title} heading active={editingField === "job_title"} disabled={busy} onEdit={onEdit} onSave={onSave} /></div>
        </div>
        <div className="job-document-highlights" aria-label="岗位摘要">
          <Fact icon={<WalletCards size={17} />} label="薪资" emphasis>{editable("salary_text", "薪资", job.salary_text, undefined)}</Fact>
          <Fact icon={<MapPin size={17} />} label="工作地点">{editable("work_city", "工作地点", job.work_city)}</Fact>
          <Fact icon={<BriefcaseBusiness size={17} />} label="用工类型">{editable("employment_type", "用工类型", job.employment_type, employmentOptions)}</Fact>
        </div>
        <div className="job-document-intro">
          <section className="job-document-intro-section">
            <h3>职位描述</h3>
            <InlineEditableField field="description" label="职位描述" value={job.description} multiline active={editingField === "description"} disabled={busy} onEdit={onEdit} onSave={onSave} />
          </section>
          <section className="job-document-intro-section">
            <h3>核心技能</h3>
            {editable("skills", "核心技能", job.skills.join(", "))}
          </section>
        </div>
      </header>
      <div className="job-document-body">
        <DocumentSection title="岗位要求"><dl className="job-document-grid"><EditableDefinition label="学历要求">{editable("education_requirement", "学历要求", job.education_requirement)}</EditableDefinition><EditableDefinition label="经验要求">{editable("experience_requirement", "经验要求", job.experience_requirement)}</EditableDefinition><EditableDefinition label="工作方式">{editable("work_mode", "工作方式", job.work_mode, workModeOptions)}</EditableDefinition><EditableDefinition label="工作安排">{editable("work_schedule", "工作安排", job.work_schedule)}</EditableDefinition><EditableDefinition label="详细地址">{editable("work_address", "详细地址", job.work_address)}</EditableDefinition><Definition label="结构化薪资" value={structuredSalary(job)} /></dl></DocumentSection>
        <DocumentSection title="公司与招聘者"><dl className="job-document-grid"><EditableDefinition label="公司全称">{editable("company_legal_name", "公司全称", job.company_legal_name)}</EditableDefinition><EditableDefinition label="行业">{editable("company_industry", "行业", job.company_industry)}</EditableDefinition><EditableDefinition label="公司规模">{editable("company_size", "公司规模", job.company_size)}</EditableDefinition><EditableDefinition label="融资阶段">{editable("company_financing_stage", "融资阶段", job.company_financing_stage)}</EditableDefinition><EditableDefinition label="招聘者姓名">{editable("recruiter_name", "招聘者姓名", job.recruiter_name)}</EditableDefinition><EditableDefinition label="招聘者职位">{editable("recruiter_title", "招聘者职位", job.recruiter_title)}</EditableDefinition><EditableDefinition label="公司简介" wide>{<InlineEditableField field="company_description" label="公司简介" value={job.company_description ?? ""} multiline active={editingField === "company_description"} disabled={busy} onEdit={onEdit} onSave={onSave} />}</EditableDefinition></dl></DocumentSection>
        <DocumentSection title="来源与备注"><dl className="job-document-grid"><Definition label="来源" value={job.source_site ?? "手工创建"} /><Definition label="来源类型" value={job.source_type} /><Definition label="更新时间" value={formatTime(job.updated_at)} />{job.imported_at && <Definition label="导入时间" value={formatTime(job.imported_at)} />}<EditableDefinition label="个人备注" wide>{<InlineEditableField field="notes" label="个人备注" value={job.notes ?? ""} multiline active={editingField === "notes"} disabled={busy} onEdit={onEdit} onSave={onSave} />}</EditableDefinition></dl>{job.source_url && <a className="job-source-link" href={job.source_url} target="_blank" rel="noreferrer">打开来源岗位 <ExternalLink size={13} /></a>}</DocumentSection>
      </div>
    </section>
  );
}

const employmentOptions: Array<[string, string]> = [["full_time", "全职"], ["part_time", "兼职"], ["internship", "实习"], ["contract", "合同"], ["temporary", "临时"]];
const workModeOptions: Array<[string, string]> = [["onsite", "现场"], ["hybrid", "混合"], ["remote", "远程"]];

function InlineEditableField({ field, label, value, options, multiline = false, heading = false, active, disabled, onEdit, onSave }: { field: keyof JobFormState; label: string; value: string; options?: Array<[string, string]>; multiline?: boolean; heading?: boolean; active: boolean; disabled: boolean; onEdit: (field: keyof JobFormState | null) => void; onSave: (field: keyof JobFormState, value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const displayValue = (options?.find(([optionValue]) => optionValue === value)?.[1] ?? value) || "未填写";

  useEffect(() => {
    if (!active) {
      setDraft(value);
      return;
    }
    const control = controlRef.current;
    control?.focus();
    if (control && "setSelectionRange" in control) control.setSelectionRange(control.value.length, control.value.length);
  }, [active, value]);

  const finish = () => void onSave(field, draft);
  const dismissOnBlur = () => {
    setDraft(value);
    onEdit(null);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      onEdit(null);
      return;
    }
    if (event.key === "Enter" && !(multiline && event.shiftKey)) {
      event.preventDefault();
      finish();
    }
  };

  return (
    <div className={`job-quick-edit${active ? " is-editing" : ""}`}>
      {active ? (
        options ? (
          <select ref={controlRef as React.RefObject<HTMLSelectElement>} name={String(field)} autoComplete="off" aria-label={label} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={dismissOnBlur}>
            <option value="">未填写</option>
            {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
          </select>
        ) : multiline ? (
          <textarea ref={controlRef as React.RefObject<HTMLTextAreaElement>} name={String(field)} autoComplete="off" aria-label={label} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={dismissOnBlur} />
        ) : (
          <input ref={controlRef as React.RefObject<HTMLInputElement>} name={String(field)} autoComplete="off" aria-label={label} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={dismissOnBlur} />
        )
      ) : (
        heading ? (
          <h2 className="job-quick-edit-heading">
            <button type="button" className="job-quick-edit-display" aria-label={`编辑${label}`} disabled={disabled} onClick={() => { setDraft(value); onEdit(field); }}>
              <span className="job-quick-edit-value">{displayValue}</span>
            </button>
          </h2>
        ) : (
          <button type="button" className="job-quick-edit-display" aria-label={`编辑${label}`} disabled={disabled} onClick={() => { setDraft(value); onEdit(field); }}>
            <span className="job-quick-edit-value">{displayValue}</span>
          </button>
        )
      )}
    </div>
  );
}

function Fact({ icon, label, emphasis = false, children }: { icon: React.ReactNode; label: string; emphasis?: boolean; children: React.ReactNode }) { return <div className={`job-document-fact${emphasis ? " is-emphasis" : ""}`}><span>{icon}</span><div><small>{label}</small>{children}</div></div>; }
function DocumentSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="job-document-section"><h3>{title}</h3>{children}</section>; }
function Definition({ label, value }: { label: string; value: string | null | undefined }) { return <div className="job-document-definition"><dt>{label}</dt><dd>{value || "未填写"}</dd></div>; }
function EditableDefinition({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <div className={`job-document-definition${wide ? " is-wide" : ""}`}><dt>{label}</dt><dd>{children}</dd></div>; }
function structuredSalary(job: JobDescriptionRecord): string | null { if (!job.salary_min && !job.salary_max) return null; const range = [job.salary_min, job.salary_max].filter(Boolean).join(" – "); const months = job.salary_months_per_year ? ` · ${job.salary_months_per_year} 薪` : ""; return `${range} ${job.salary_currency ?? ""}/${job.salary_period ?? ""}${months}`.trim(); }
function formatTime(value: string): string { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function detailErrorMessage(error: unknown, fallback = "岗位服务暂时不可用，请稍后重试。"): string { if (error instanceof ApiRequestError) { if (error.message === "JD_NOT_FOUND") return "岗位不存在，或当前账号没有访问权限。"; if (error.message === "JD_EDIT_CONFLICT") return "岗位内容已经变化，请重新打开后再保存。"; if (error.message === "INVALID_JOB_DESCRIPTION") return "请检查必填字段、薪资组合和字段长度。"; if (error.status === 401) return "登录状态已失效，请重新登录。"; } return fallback; }
