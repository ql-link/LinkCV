import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, ExternalLink, MapPin, Trash2, WalletCards } from "lucide-react";
import { api, ApiRequestError, type JobDescriptionRecord } from "../../api/client";
import { Button, ConfirmDialog, PageLoading } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { navigateTo } from "../../routing";
import { jobFormFromRecord, jobPayloadFromForm, type JobFormState } from "./jobFormModel";
import "./jobs.css";

export function JobDetailPage({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDescriptionRecord | null>(null);
  const [editingField, setEditingField] = useState<EditableTarget | null>(null);
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

  const saveFields = async (changes: Partial<JobFormState>) => {
    if (!job || busy) return;
    const nextForm = { ...jobFormFromRecord(job), ...changes } as JobFormState;
    if (!nextForm.job_title.trim() || !nextForm.company_name.trim() || !nextForm.description.trim()) {
      setError("该字段为必填项，不能保存空内容。");
      return;
    }
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

  const saveField = (field: keyof JobFormState, value: string) => saveFields({ [field]: value });

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
        <JobDocument job={job} editingField={editingField} busy={busy} onEdit={setEditingField} onSave={saveField} onSaveFields={saveFields} />
      </article>
      {deleteOpen && <ConfirmDialog kind="delete" title={`永久删除「${job.job_title}」？`} description="删除后无法恢复，并会释放该来源，之后再次写入会创建新的 JD。" confirmLabel="永久删除" busyLabel="正在删除…" busy={busy} onCancel={() => setDeleteOpen(false)} onConfirm={deleteJob} />}
    </main>
  );
}

type EditableTarget = keyof JobFormState | "structured_salary";

type StructuredSalaryDraft = Pick<JobFormState, "salary_min" | "salary_max" | "salary_currency" | "salary_period" | "salary_months_per_year">;

function JobDocument({ job, editingField, busy, onEdit, onSave, onSaveFields }: { job: JobDescriptionRecord; editingField: EditableTarget | null; busy: boolean; onEdit: (field: EditableTarget | null) => void; onSave: (field: keyof JobFormState, value: string) => Promise<void>; onSaveFields: (changes: Partial<JobFormState>) => Promise<void> }) {
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
        <DocumentSection title="岗位要求"><dl className="job-document-grid"><EditableDefinition label="学历要求">{editable("education_requirement", "学历要求", job.education_requirement)}</EditableDefinition><EditableDefinition label="经验要求">{editable("experience_requirement", "经验要求", job.experience_requirement)}</EditableDefinition><EditableDefinition label="工作方式">{editable("work_mode", "工作方式", job.work_mode, workModeOptions)}</EditableDefinition><EditableDefinition label="工作安排">{editable("work_schedule", "工作安排", job.work_schedule)}</EditableDefinition><EditableDefinition label="详细地址">{editable("work_address", "详细地址", job.work_address)}</EditableDefinition><StructuredSalaryEditor job={job} active={editingField === "structured_salary"} disabled={busy} onEdit={onEdit} onSave={onSaveFields} /></dl></DocumentSection>
        <DocumentSection title="公司与招聘者"><dl className="job-document-grid"><EditableDefinition label="公司全称">{editable("company_legal_name", "公司全称", job.company_legal_name)}</EditableDefinition><EditableDefinition label="行业">{editable("company_industry", "行业", job.company_industry)}</EditableDefinition><EditableDefinition label="公司规模">{editable("company_size", "公司规模", job.company_size)}</EditableDefinition><EditableDefinition label="融资阶段">{editable("company_financing_stage", "融资阶段", job.company_financing_stage)}</EditableDefinition><EditableDefinition label="招聘者姓名">{editable("recruiter_name", "招聘者姓名", job.recruiter_name)}</EditableDefinition><EditableDefinition label="招聘者职位">{editable("recruiter_title", "招聘者职位", job.recruiter_title)}</EditableDefinition><EditableDefinition label="公司简介" wide>{<InlineEditableField field="company_description" label="公司简介" value={job.company_description ?? ""} multiline active={editingField === "company_description"} disabled={busy} onEdit={onEdit} onSave={onSave} />}</EditableDefinition></dl></DocumentSection>
        <DocumentSection title="来源与备注"><dl className="job-document-grid"><Definition label="来源" value={job.source_site ?? "手工创建"} /><Definition label="来源类型" value={job.source_type} /><Definition label="更新时间" value={formatTime(job.updated_at)} />{job.imported_at && <Definition label="导入时间" value={formatTime(job.imported_at)} />}<EditableDefinition label="个人备注" wide>{<InlineEditableField field="notes" label="个人备注" value={job.notes ?? ""} multiline active={editingField === "notes"} disabled={busy} onEdit={onEdit} onSave={onSave} />}</EditableDefinition></dl>{job.source_url && <a className="job-source-link" href={job.source_url} target="_blank" rel="noreferrer">打开来源岗位 <ExternalLink size={13} /></a>}</DocumentSection>
      </div>
    </section>
  );
}

const employmentOptions: Array<[string, string]> = [["full_time", "全职"], ["part_time", "兼职"], ["internship", "实习"], ["contract", "合同"], ["temporary", "临时"]];
const workModeOptions: Array<[string, string]> = [["onsite", "现场"], ["hybrid", "混合"], ["remote", "远程"]];
const salaryPeriodOptions: Array<[string, string]> = [["hour", "小时"], ["day", "天"], ["month", "月"], ["year", "年"]];
const emptyInlineSelectValue = "__empty_inline_select__";

function InlineEditableField({ field, label, value, options, multiline = false, heading = false, active, disabled, onEdit, onSave }: { field: keyof JobFormState; label: string; value: string; options?: Array<[string, string]>; multiline?: boolean; heading?: boolean; active: boolean; disabled: boolean; onEdit: (field: keyof JobFormState | null) => void; onSave: (field: keyof JobFormState, value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [selectOpen, setSelectOpen] = useState(false);
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const blurTimerRef = useRef<number | null>(null);
  const displayValue = (options?.find(([optionValue]) => optionValue === value)?.[1] ?? value) || "未填写";

  useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
  }, []);

  useEffect(() => {
    if (!active) {
      setDraft(value);
      setSelectOpen(false);
      return;
    }
    const control = controlRef.current;
    control?.focus({ preventScroll: true });
    if (control && "setSelectionRange" in control) control.setSelectionRange(control.value.length, control.value.length);
  }, [active, value]);

  const finish = () => void onSave(field, draft);
  const beginEditing = () => {
    setDraft(value);
    onEdit(field);
  };
  const dismissOnBlur = () => {
    setDraft(value);
    onEdit(null);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
    <div
      className={`job-quick-edit${multiline ? " is-multiline" : ""}${active ? " is-editing" : ""}`}
      onBlurCapture={options && active ? (event) => {
        const container = event.currentTarget;
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && container.contains(nextTarget)) return;
        if (nextTarget instanceof Element && nextTarget.closest("[data-job-inline-select-content]")) return;
        if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = window.setTimeout(() => {
          blurTimerRef.current = null;
          const focusedElement = document.activeElement;
          const menuOpen = document.querySelector('[data-job-inline-select-content][data-state="open"]');
          if ((focusedElement && container.contains(focusedElement)) || menuOpen) return;
          dismissOnBlur();
        }, 0);
      } : undefined}
    >
      {active ? (
        options ? (
          <Select
            name={String(field)}
            value={draft || emptyInlineSelectValue}
            open={selectOpen}
            disabled={disabled}
            onOpenChange={setSelectOpen}
            onValueChange={(nextValue) => {
              const nextDraft = nextValue === emptyInlineSelectValue ? "" : nextValue;
              setDraft(nextDraft);
              void onSave(field, nextDraft);
            }}
          >
            <SelectTrigger aria-label={label} className="job-quick-edit-select-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="job-quick-edit-select-content" data-job-inline-select-content>
              <SelectItem value={emptyInlineSelectValue}>未填写</SelectItem>
              {options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : multiline ? (
          <>
            <span className="job-quick-edit-multiline-mirror" aria-hidden="true">{draft || "未填写"}</span>
            <textarea ref={controlRef as React.RefObject<HTMLTextAreaElement>} rows={1} name={String(field)} autoComplete="off" aria-label={label} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={dismissOnBlur} />
          </>
        ) : (
          <input ref={controlRef as React.RefObject<HTMLInputElement>} name={String(field)} autoComplete="off" aria-label={label} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={dismissOnBlur} />
        )
      ) : (
        heading ? (
          <h2 className="job-quick-edit-heading">
            <button type="button" className="job-quick-edit-display" aria-label={`编辑${label}`} disabled={disabled} onClick={beginEditing}>
              <span className="job-quick-edit-value">{displayValue}</span>
            </button>
          </h2>
        ) : (
          <button type="button" className="job-quick-edit-display" aria-label={`编辑${label}`} disabled={disabled} onClick={beginEditing}>
            <span className="job-quick-edit-value">{displayValue}</span>
          </button>
        )
      )}
    </div>
  );
}

function StructuredSalaryEditor({ job, active, disabled, onEdit, onSave }: { job: JobDescriptionRecord; active: boolean; disabled: boolean; onEdit: (field: EditableTarget | null) => void; onSave: (changes: Partial<JobFormState>) => Promise<void> }) {
  const current = structuredSalaryDraft(job);
  const [draft, setDraft] = useState<StructuredSalaryDraft>(current);
  const [periodOpen, setPeriodOpen] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
  }, []);

  useEffect(() => {
    if (!active) {
      setDraft(current);
      return;
    }
    setDraft(current);
    firstInputRef.current?.focus({ preventScroll: true });
    firstInputRef.current?.setSelectionRange(current.salary_min.length, current.salary_min.length);
  }, [active, job.salary_min, job.salary_max, job.salary_currency, job.salary_period, job.salary_months_per_year]);

  const setField = (field: keyof StructuredSalaryDraft, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }) as StructuredSalaryDraft);
  };
  const dismiss = () => {
    setPeriodOpen(false);
    setDraft(current);
    onEdit(null);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void onSave(draft);
    }
  };

  return (
    <div
      className={`job-document-definition job-structured-salary${active ? " is-editing" : ""}`}
      onBlurCapture={(event) => {
        const container = event.currentTarget;
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
        if (nextTarget instanceof Element && nextTarget.closest("[data-job-salary-period-content]")) return;
        if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = window.setTimeout(() => {
          blurTimerRef.current = null;
          const focusedElement = document.activeElement;
          const menuOpen = document.querySelector('[data-job-salary-period-content][data-state="open"]');
          if ((focusedElement && container.contains(focusedElement)) || menuOpen) return;
          if (active) dismiss();
        }, 0);
      }}
    >
      <dt>结构化薪资</dt>
      <dd>
        <button
          type="button"
          className="job-quick-edit-display job-structured-salary-trigger"
          aria-label="编辑结构化薪资"
          aria-expanded={active}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => {
            if (active) {
              dismiss();
              return;
            }
            setDraft(current);
            onEdit("structured_salary");
          }}
        >
          <span className="job-quick-edit-value">{structuredSalarySummary(job)}</span>
        </button>
        {active && (
          <div
            className="job-structured-salary-controls"
            role="dialog"
            aria-label="编辑结构化薪资"
          >
            <SalaryControl label="最低薪资"><input ref={firstInputRef} name="salary_min" autoComplete="off" aria-label="最低薪资" inputMode="decimal" value={draft.salary_min} disabled={disabled} onChange={(event) => setField("salary_min", event.target.value)} onKeyDown={onKeyDown} /></SalaryControl>
            <SalaryControl label="最高薪资"><input name="salary_max" autoComplete="off" aria-label="最高薪资" inputMode="decimal" value={draft.salary_max} disabled={disabled} onChange={(event) => setField("salary_max", event.target.value)} onKeyDown={onKeyDown} /></SalaryControl>
            <SalaryControl label="币种"><input name="salary_currency" autoComplete="off" aria-label="币种" maxLength={3} value={draft.salary_currency} disabled={disabled} onChange={(event) => setField("salary_currency", event.target.value.toUpperCase())} onKeyDown={onKeyDown} /></SalaryControl>
            <SalaryControl label="计薪周期">
              <Select
                name="salary_period"
                value={draft.salary_period || emptySalaryPeriodValue}
                open={periodOpen}
                disabled={disabled}
                onOpenChange={setPeriodOpen}
                onValueChange={(value) => setField("salary_period", value === emptySalaryPeriodValue ? "" : value)}
              >
                <SelectTrigger aria-label="计薪周期" className="job-structured-salary-period-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="job-structured-salary-period-content" data-job-salary-period-content>
                  <SelectItem value={emptySalaryPeriodValue}>未填写</SelectItem>
                  {salaryPeriodOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </SalaryControl>
            <SalaryControl label="年薪月数"><input name="salary_months_per_year" autoComplete="off" aria-label="年薪月数" type="number" min={1} max={65535} value={draft.salary_months_per_year} disabled={disabled} onChange={(event) => setField("salary_months_per_year", event.target.value)} onKeyDown={onKeyDown} /></SalaryControl>
          </div>
        )}
      </dd>
    </div>
  );
}

const emptySalaryPeriodValue = "__empty_salary_period__";

function SalaryControl({ label, children }: { label: string; children: React.ReactNode }) { return <div className="job-structured-salary-control"><span>{label}</span>{children}</div>; }
function structuredSalaryDraft(job: JobDescriptionRecord): StructuredSalaryDraft { return { salary_min: job.salary_min ?? "", salary_max: job.salary_max ?? "", salary_currency: job.salary_currency ?? "", salary_period: job.salary_period ?? "", salary_months_per_year: job.salary_months_per_year?.toString() ?? "" }; }
function salaryPeriodLabel(period: JobFormState["salary_period"] | null | undefined): string { return salaryPeriodOptions.find(([value]) => value === period)?.[1] ?? ""; }
function structuredSalarySummary(job: JobDescriptionRecord): string { const range = [job.salary_min, job.salary_max].filter(Boolean).join(" – "); const context = [job.salary_currency, salaryPeriodLabel(job.salary_period)].filter(Boolean).join("/"); const months = job.salary_months_per_year ? `${job.salary_months_per_year} 薪` : ""; return [range, context, months].filter(Boolean).join(" · ") || "未填写"; }

function Fact({ icon, label, emphasis = false, children }: { icon: React.ReactNode; label: string; emphasis?: boolean; children: React.ReactNode }) { return <div className={`job-document-fact${emphasis ? " is-emphasis" : ""}`}><span>{icon}</span><div><small>{label}</small>{children}</div></div>; }
function DocumentSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="job-document-section"><h3>{title}</h3>{children}</section>; }
function Definition({ label, value }: { label: string; value: string | null | undefined }) { return <div className="job-document-definition"><dt>{label}</dt><dd>{value || "未填写"}</dd></div>; }
function EditableDefinition({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <div className={`job-document-definition${wide ? " is-wide" : ""}`}><dt>{label}</dt><dd>{children}</dd></div>; }
function formatTime(value: string): string { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function detailErrorMessage(error: unknown, fallback = "岗位服务暂时不可用，请稍后重试。"): string { if (error instanceof ApiRequestError) { if (error.message === "JD_NOT_FOUND") return "岗位不存在，或当前账号没有访问权限。"; if (error.message === "JD_EDIT_CONFLICT") return "岗位内容已经变化，请重新打开后再保存。"; if (error.message === "INVALID_JOB_DESCRIPTION") return "请检查必填字段、薪资组合和字段长度。"; if (error.status === 401) return "登录状态已失效，请重新登录。"; } return fallback; }
