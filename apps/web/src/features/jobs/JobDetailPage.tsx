import { useEffect, useState } from "react";
import { Archive, ArrowLeft, ExternalLink, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { api, ApiRequestError, type JobDescriptionRecord } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Brand, Button } from "../../components/ds";
import { jobEditPath, navigateTo } from "../../routing";
import "./jobs.css";

export function JobDetailPage({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDescriptionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getJobDescription(jobId)
      .then(({ job_description }) => {
        if (!cancelled) setJob(job_description);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(detailErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const changeArchived = async () => {
    if (!job || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = job.archived_at
        ? await api.restoreJobDescription(job.id, job.lock_version)
        : await api.archiveJobDescription(job.id, job.lock_version);
      setJob(result.job_description);
    } catch (actionError) {
      setError(detailErrorMessage(actionError));
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

  if (loading) return <div className="app-loading">正在加载岗位…</div>;
  if (!job) {
    return <main className="route-error-page"><h1>无法打开这条 JD</h1><p>{error}</p><Button onClick={() => navigateTo("/jobs", { replace: true })}>返回 JD 中心</Button></main>;
  }

  const companyFacts = compact([
    job.company_legal_name,
    job.company_industry,
    job.company_size,
    job.company_financing_stage,
  ]);
  const workFacts = compact([
    job.work_city,
    job.work_address,
    workModeLabel(job.work_mode),
    job.work_schedule,
  ]);

  return (
    <main className="job-page-shell">
      <header className="job-page-header">
        <Brand />
        <Button variant="secondary" size="sm" icon={<ArrowLeft size={15} />} onClick={() => navigateTo("/jobs")}>返回列表</Button>
      </header>

      <article className="job-detail">
        <header className="job-detail-hero">
          <div>
            <p className="job-eyebrow">{job.archived_at ? "已归档" : "活动岗位"}</p>
            <h1>{job.job_title}</h1>
            <p>{job.company_name}</p>
            <div className="job-tag-row">
              {job.salary_text && <span>{job.salary_text}</span>}
              {workFacts.map((fact) => <span key={fact}>{fact}</span>)}
              {job.employment_type && <span>{employmentLabel(job.employment_type)}</span>}
            </div>
          </div>
          <div className="job-detail-actions">
            <Button variant="secondary" icon={job.archived_at ? <RotateCcw size={15} /> : <Archive size={15} />} disabled={busy} onClick={() => void changeArchived()}>
              {job.archived_at ? "恢复" : "归档"}
            </Button>
            <Button variant="secondary" icon={<Pencil size={15} />} disabled={busy} onClick={() => navigateTo(jobEditPath(job.id))}>编辑</Button>
            <Button variant="danger" icon={<Trash2 size={15} />} disabled={busy} onClick={() => setDeleteOpen(true)}>删除</Button>
          </div>
        </header>

        {error && <div className="job-error" role="alert">{error}</div>}

        <section className="job-detail-section">
          <h2>职位描述</h2>
          <div className="job-markdown">{job.description}</div>
          {job.skills.length > 0 && <div className="job-skill-row">{job.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>}
        </section>

        <div className="job-detail-columns">
          <section className="job-detail-section">
            <h2>岗位要求</h2>
            <DetailRow label="学历" value={job.education_requirement} />
            <DetailRow label="经验" value={job.experience_requirement} />
            <DetailRow label="工作安排" value={job.work_schedule} />
            <DetailRow label="工作地点" value={workFacts.join(" · ") || null} />
            <DetailRow label="结构化薪资" value={structuredSalary(job)} />
          </section>
          <section className="job-detail-section">
            <h2>公司与招聘者</h2>
            <DetailRow label="公司" value={companyFacts.join(" · ") || job.company_name} />
            <DetailRow label="招聘者" value={compact([job.recruiter_name, job.recruiter_title]).join(" · ") || null} />
            {job.company_description && <p className="job-long-copy">{job.company_description}</p>}
          </section>
        </div>

        <section className="job-detail-section job-source-panel">
          <h2>来源信息（只读）</h2>
          <DetailRow label="来源类型" value={job.source_type} />
          <DetailRow label="来源标识" value={compact([job.source_site, job.source_job_id]).join(":") || null} />
          <DetailRow label="导入时间" value={job.imported_at ? formatTime(job.imported_at) : null} />
          {job.source_url && <a href={job.source_url} target="_blank" rel="noreferrer">打开来源链接 <ExternalLink size={14} /></a>}
        </section>

        {job.notes && <section className="job-detail-section"><h2>个人备注</h2><p className="job-long-copy">{job.notes}</p></section>}
      </article>

      {deleteOpen && (
        <ConfirmDialog
          kind="delete"
          title={`永久删除「${job.job_title}」？`}
          description="删除后无法恢复，并会释放该来源，之后再次写入会创建新的 JD。"
          confirmLabel="永久删除"
          busyLabel="正在删除…"
          busy={busy}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={deleteJob}
        />
      )}
    </main>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return <div className="job-detail-row"><span>{label}</span><strong>{value || "未填写"}</strong></div>;
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function employmentLabel(value: string): string {
  return { full_time: "全职", part_time: "兼职", internship: "实习", contract: "合同", temporary: "临时" }[value] ?? value;
}

function workModeLabel(value: string | null): string | null {
  if (!value) return null;
  return { onsite: "现场", hybrid: "混合", remote: "远程" }[value] ?? value;
}

function structuredSalary(job: JobDescriptionRecord): string | null {
  if (!job.salary_min && !job.salary_max) return null;
  const range = [job.salary_min, job.salary_max].filter(Boolean).join(" – ");
  const months = job.salary_months_per_year ? ` · ${job.salary_months_per_year} 薪` : "";
  return `${range} ${job.salary_currency ?? ""}/${job.salary_period ?? ""}${months}`.trim();
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function detailErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.message === "JD_NOT_FOUND") return "岗位不存在，或当前账号没有访问权限。";
    if (error.message === "JD_EDIT_CONFLICT") return "岗位状态已经变化，请重新打开后再操作。";
    if (error.status === 401) return "登录状态已失效，请重新登录。";
  }
  return "岗位服务暂时不可用，请稍后重试。";
}
