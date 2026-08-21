import { FormEvent, useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  api,
  ApiRequestError,
  type JobDescriptionCreatePayload,
  type JobDescriptionRecord,
  type JobDuplicateDetails,
  type JobEmploymentType,
  type JobSalaryPeriod,
  type JobWorkMode,
} from "../../api/client";
import { Button, PageLoading } from "@/components/ui";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { jobDetailPath, navigateTo } from "../../routing";
import { JobDuplicateDialog } from "./JobDuplicateDialog";
import "./jobs.css";

type JobFormState = {
  job_title: string;
  company_name: string;
  employment_type: JobEmploymentType | "";
  description: string;
  skills: string;
  education_requirement: string;
  experience_requirement: string;
  work_schedule: string;
  work_city: string;
  work_address: string;
  work_mode: JobWorkMode | "";
  salary_text: string;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  salary_period: JobSalaryPeriod | "";
  salary_months_per_year: string;
  company_legal_name: string;
  company_industry: string;
  company_size: string;
  company_financing_stage: string;
  company_description: string;
  recruiter_name: string;
  recruiter_title: string;
  source_url: string;
  notes: string;
};

const emptyForm: JobFormState = {
  job_title: "",
  company_name: "",
  employment_type: "",
  description: "",
  skills: "",
  education_requirement: "",
  experience_requirement: "",
  work_schedule: "",
  work_city: "",
  work_address: "",
  work_mode: "",
  salary_text: "",
  salary_min: "",
  salary_max: "",
  salary_currency: "",
  salary_period: "",
  salary_months_per_year: "",
  company_legal_name: "",
  company_industry: "",
  company_size: "",
  company_financing_stage: "",
  company_description: "",
  recruiter_name: "",
  recruiter_title: "",
  source_url: "",
  notes: "",
};

export function JobFormPage({ mode, jobId }: { mode: "create" | "edit"; jobId?: string }) {
  const [form, setForm] = useState<JobFormState>(emptyForm);
  const [record, setRecord] = useState<JobDescriptionRecord | null>(null);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<JobDuplicateDetails["duplicate"] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<JobDescriptionCreatePayload | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !jobId) return;
    let cancelled = false;
    void api.getJobDescription(jobId)
      .then(({ job_description }) => {
        if (cancelled) return;
        setRecord(job_description);
        setForm(formFromRecord(job_description));
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(jobErrorMessage(loadError, "无法加载岗位，请稍后重试。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, mode]);

  const setField = <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const payload = createPayload(form);
        setPendingPayload(payload);
        const { job_description } = await api.createJobDescription(payload);
        navigateTo(jobDetailPath(job_description.id), { replace: true });
      } else if (jobId && record) {
        const {
          source_url: _sourceUrl,
          source_type: _sourceType,
          duplicate_resolution: _duplicateResolution,
          ...fields
        } = createPayload(form);
        void _sourceUrl;
        void _sourceType;
        void _duplicateResolution;
        const { job_description } = await api.updateJobDescription(jobId, {
          ...fields,
          base_lock_version: record.lock_version,
        });
        navigateTo(jobDetailPath(job_description.id), { replace: true });
      }
    } catch (submitError) {
      const duplicateDetails = duplicateFromError(submitError);
      if (duplicateDetails && mode === "create") {
        setDuplicate(duplicateDetails);
      } else {
        setError(jobErrorMessage(submitError, "保存岗位失败，请稍后重试。"));
      }
    } finally {
      setSaving(false);
    }
  };

  const resolveDuplicate = async (action: "restore" | "update" | "cancel") => {
    if (action === "cancel") {
      setDuplicate(null);
      return;
    }
    if (!duplicate || !pendingPayload || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { job_description } = await api.createJobDescription({
        ...pendingPayload,
        duplicate_resolution: {
          action,
          job_description_id: duplicate.existing.id,
          base_lock_version: duplicate.existing.lock_version,
        },
      });
      navigateTo(jobDetailPath(job_description.id), { replace: true });
    } catch (resolveError) {
      setDuplicate(null);
      setError(jobErrorMessage(resolveError, "重复岗位状态已经变化，请刷新后重试。"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <main className="dashboard-content job-page-shell"><PageLoading label="正在加载岗位信息…" /></main>;
  }
  if (mode === "edit" && !record) {
    return (
      <main className="dashboard-content job-page-shell">
        <section className="job-workspace-state">
          <h1>无法打开这条 JD</h1>
          <p>{error ?? "岗位不存在，或当前账号没有访问权限。"}</p>
          <Button onClick={() => navigateTo("/jobs", { replace: true })}>返回 JD 中心</Button>
        </section>
      </main>
    );
  }

  const cancelTarget = jobId ? jobDetailPath(jobId) : "/jobs";
  const requiredFilled = [form.job_title, form.company_name, form.description].filter((value) => value.trim()).length;

  return (
    <main className="dashboard-content job-page-shell">
      <form className="job-form" onSubmit={submit}>
        <WorkspacePageHero
          eyebrow="JD 管理"
          title={mode === "create" ? "新建 JD" : "编辑 JD"}
          description="先录入岗位核心信息，保存后再补充公司与来源。"
          actions={(
            <>
              <Button variant="ghost" onClick={() => navigateTo(cancelTarget)}>取消</Button>
              <Button type="submit" disabled={saving}>{saving ? "正在保存…" : mode === "create" ? "创建 JD" : "保存 JD"}</Button>
            </>
          )}
        />

        {error && <div className="job-error" role="alert">{error}</div>}

        <div className="job-form-layout">
          <div className="job-form-main">
            <section className="job-form-card">
              <header className="job-form-section-head">
                <p className="job-form-kicker">第一层 · 必填</p>
                <h2>核心信息</h2>
              </header>
              <div className="job-form-grid">
                <JobInput label="职位名称" required value={form.job_title} maxLength={200} placeholder="例如：高级产品经理" onChange={(value) => setField("job_title", value)} />
                <JobInput label="公司名称" required value={form.company_name} maxLength={200} placeholder="请输入公司名称" onChange={(value) => setField("company_name", value)} />
                <JobTextarea className="job-field-wide" label="职位描述" required value={form.description} placeholder="简要说明岗位职责与工作内容" onChange={(value) => setField("description", value)} />
                <JobInput className="job-field-wide" label="技能" hint="使用逗号或换行分隔，保存时自动去空去重。" value={form.skills} onChange={(value) => setField("skills", value)} />
              </div>

              <header className="job-form-section-head">
                <p className="job-form-kicker">第二层 · 用于匹配判断</p>
                <h2>岗位判断</h2>
              </header>
              <div className="job-form-grid is-three">
                <JobInput label="工作城市" value={form.work_city} placeholder="工作城市" onChange={(value) => setField("work_city", value)} />
                <JobInput label="薪资范围" placeholder="例如：25-40K、面议" value={form.salary_text} onChange={(value) => setField("salary_text", value)} />
                <JobSelect label="用工类型" value={form.employment_type} onChange={(value) => setField("employment_type", value as JobFormState["employment_type"])} options={[
                  ["", "未填写"], ["full_time", "全职"], ["part_time", "兼职"], ["internship", "实习"], ["contract", "合同"], ["temporary", "临时"],
                ]} />
                <JobInput label="学历要求" value={form.education_requirement} placeholder="学历要求" onChange={(value) => setField("education_requirement", value)} />
                <JobInput label="经验要求" value={form.experience_requirement} placeholder="经验要求" onChange={(value) => setField("experience_requirement", value)} />
                <JobSelect label="工作方式" value={form.work_mode} onChange={(value) => setField("work_mode", value as JobFormState["work_mode"])} options={[
                  ["", "未填写"], ["onsite", "现场"], ["hybrid", "混合"], ["remote", "远程"],
                ]} />
              </div>
            </section>
          </div>

          <aside className="job-form-rail">
            <section className="job-form-card">
              <h2 className="job-form-rail-title">补充信息</h2>
              <p className="job-form-rail-note">低频字段默认收起，避免工作台被表单细节占满。</p>

              <details className="job-rail-section">
                <summary><span><strong>薪资明细</strong><small>结构化薪资，用于排序与筛选</small></span></summary>
                <div className="job-rail-body">
                  <JobInput label="最低薪资" inputMode="decimal" value={form.salary_min} onChange={(value) => setField("salary_min", value)} />
                  <JobInput label="最高薪资" inputMode="decimal" value={form.salary_max} onChange={(value) => setField("salary_max", value)} />
                  <JobInput label="币种" placeholder="CNY" maxLength={3} value={form.salary_currency} onChange={(value) => setField("salary_currency", value)} />
                  <JobSelect label="计薪周期" value={form.salary_period} onChange={(value) => setField("salary_period", value as JobFormState["salary_period"])} options={[
                    ["", "未填写"], ["hour", "小时"], ["day", "天"], ["month", "月"], ["year", "年"],
                  ]} />
                  <JobInput label="每年薪资月数" type="number" min={1} max={65535} value={form.salary_months_per_year} onChange={(value) => setField("salary_months_per_year", value)} />
                </div>
              </details>

              <details className="job-rail-section">
                <summary><span><strong>公司快照</strong><small>行业、规模、招聘者</small></span></summary>
                <div className="job-rail-body">
                  <JobInput label="公司工商全称" value={form.company_legal_name} onChange={(value) => setField("company_legal_name", value)} />
                  <JobInput label="行业" value={form.company_industry} onChange={(value) => setField("company_industry", value)} />
                  <JobInput label="公司规模" value={form.company_size} onChange={(value) => setField("company_size", value)} />
                  <JobInput label="融资阶段" value={form.company_financing_stage} onChange={(value) => setField("company_financing_stage", value)} />
                  <JobTextarea label="公司简介" value={form.company_description} onChange={(value) => setField("company_description", value)} />
                  <JobInput label="招聘者姓名" value={form.recruiter_name} onChange={(value) => setField("recruiter_name", value)} />
                  <JobInput label="招聘者职位" value={form.recruiter_title} onChange={(value) => setField("recruiter_title", value)} />
                </div>
              </details>

              <details className="job-rail-section" open={mode === "edit"}>
                <summary><span><strong>来源信息</strong><small>{mode === "create" ? "链接可选" : "创建后只读"}</small></span></summary>
                <div className="job-rail-body">
                  {mode === "create" ? (
                    <JobInput label="来源链接（可选）" type="url" value={form.source_url} onChange={(value) => setField("source_url", value)} />
                  ) : (
                    <div className="job-readonly-source">
                      <span>来源信息（只读）</span>
                      <strong>{record?.source_site ?? "手工创建，无来源"}</strong>
                      {record?.source_url && <a href={record.source_url} target="_blank" rel="noreferrer">{record.source_url}</a>}
                    </div>
                  )}
                  <JobInput label="详细地址" value={form.work_address} onChange={(value) => setField("work_address", value)} />
                  <JobInput label="工作安排" hint="例如：双休、弹性打卡" value={form.work_schedule} onChange={(value) => setField("work_schedule", value)} />
                </div>
              </details>

              <details className="job-rail-section">
                <summary><span><strong>个人备注</strong><small>{form.notes.trim() ? "已填写" : "暂未填写"}</small></span></summary>
                <div className="job-rail-body">
                  <JobTextarea label="个人备注" value={form.notes} onChange={(value) => setField("notes", value)} />
                </div>
              </details>
            </section>

            <section className="job-check-card">
              <p className="job-form-kicker">保存前检查</p>
              <div className="job-check-body">
                <div>
                  <strong>{requiredFilled === 3 ? "核心信息已完整" : "等待填写核心信息"}</strong>
                  <span>必填字段 {requiredFilled}/3</span>
                </div>
                <Check size={18} aria-hidden="true" />
              </div>
            </section>

            <section className="job-form-card job-layer-note">
              <p className="job-form-kicker">字段层级说明</p>
              <p>第一层：岗位身份与描述<br />第二层：匹配判断<br />第三层：来源、快照与备注</p>
            </section>
          </aside>
        </div>
      </form>

      {duplicate && <JobDuplicateDialog details={duplicate} busy={saving} onAction={resolveDuplicate} />}
    </main>
  );
}

function JobInput({ label, hint, className = "", onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { label: string; hint?: string; onChange: (value: string) => void }) {
  return <label className={`job-field ${className}`.trim()}><JobFieldLabel label={label} required={props.required} /><input {...props} aria-label={props["aria-label"] ?? label} onChange={(event) => onChange(event.target.value)} />{hint && <small>{hint}</small>}</label>;
}

function JobTextarea({ label, className = "", value, required, placeholder, onChange }: { label: string; className?: string; value: string; required?: boolean; placeholder?: string; onChange: (value: string) => void }) {
  return <label className={`job-field ${className}`.trim()}><JobFieldLabel label={label} required={required} /><textarea aria-label={label} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function JobFieldLabel({ label, required }: { label: string; required?: boolean }) {
  return <span className="job-field-label">{label}{required && <em aria-hidden="true">*</em>}</span>;
}

function JobSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <label className="job-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function createPayload(form: JobFormState): JobDescriptionCreatePayload {
  return {
    job_title: form.job_title,
    company_name: form.company_name,
    employment_type: form.employment_type || null,
    description: form.description,
    skills: form.skills.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean),
    education_requirement: nullable(form.education_requirement),
    experience_requirement: nullable(form.experience_requirement),
    work_schedule: nullable(form.work_schedule),
    work_city: nullable(form.work_city),
    work_address: nullable(form.work_address),
    work_mode: form.work_mode || null,
    salary_text: nullable(form.salary_text),
    salary_min: nullable(form.salary_min),
    salary_max: nullable(form.salary_max),
    salary_currency: nullable(form.salary_currency),
    salary_period: form.salary_period || null,
    salary_months_per_year: form.salary_months_per_year ? Number(form.salary_months_per_year) : null,
    company_legal_name: nullable(form.company_legal_name),
    company_industry: nullable(form.company_industry),
    company_size: nullable(form.company_size),
    company_financing_stage: nullable(form.company_financing_stage),
    company_description: nullable(form.company_description),
    recruiter_name: nullable(form.recruiter_name),
    recruiter_title: nullable(form.recruiter_title),
    notes: nullable(form.notes),
    source_type: "manual",
    source_url: nullable(form.source_url),
  };
}

function formFromRecord(record: JobDescriptionRecord): JobFormState {
  return {
    ...emptyForm,
    ...record,
    employment_type: record.employment_type ?? "",
    skills: record.skills.join(", "),
    work_mode: record.work_mode ?? "",
    salary_min: record.salary_min ?? "",
    salary_max: record.salary_max ?? "",
    salary_currency: record.salary_currency ?? "",
    salary_period: record.salary_period ?? "",
    salary_months_per_year: record.salary_months_per_year?.toString() ?? "",
    source_url: record.source_url ?? "",
    education_requirement: record.education_requirement ?? "",
    experience_requirement: record.experience_requirement ?? "",
    work_schedule: record.work_schedule ?? "",
    work_city: record.work_city ?? "",
    work_address: record.work_address ?? "",
    salary_text: record.salary_text ?? "",
    company_legal_name: record.company_legal_name ?? "",
    company_industry: record.company_industry ?? "",
    company_size: record.company_size ?? "",
    company_financing_stage: record.company_financing_stage ?? "",
    company_description: record.company_description ?? "",
    recruiter_name: record.recruiter_name ?? "",
    recruiter_title: record.recruiter_title ?? "",
    notes: record.notes ?? "",
  };
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

function duplicateFromError(error: unknown): JobDuplicateDetails["duplicate"] | null {
  if (!(error instanceof ApiRequestError) || error.message !== "JD_SOURCE_DUPLICATE") return null;
  const duplicate = error.payload?.duplicate;
  if (!duplicate || typeof duplicate !== "object") return null;
  return duplicate as JobDuplicateDetails["duplicate"];
}

function jobErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  if (error.message === "INVALID_JOB_DESCRIPTION") return "请检查必填字段、薪资组合和字段长度。";
  if (error.message === "INVALID_JOB_SOURCE") return "来源链接无法识别，请检查后重试。";
  if (error.message === "JD_EDIT_CONFLICT") return "岗位已经被修改，请重新打开后再保存。";
  if (error.message === "JD_NOT_FOUND") return "岗位不存在，或当前账号没有访问权限。";
  if (error.status === 401) return "登录状态已失效，请重新登录。";
  return fallback;
}
