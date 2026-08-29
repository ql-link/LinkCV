import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, ExternalLink, MapPin, Trash2, WalletCards } from "lucide-react";
import { api, ApiRequestError, type JobApplicationSummary, type JobDescriptionRecord } from "../../api/client";
import { Button, ConfirmDialog, PageLoading } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { careerApplicationPath, navigateTo, startCareerApplicationPath } from "../../routing";
import { jobFormFromRecord, jobPayloadFromForm, type JobFormState } from "./jobFormModel";
import { activeApplicationForJob, applicationOutcome, applicationsForJob, listAllJobApplications } from "./jobApplications";
import "./jobs.css";

import { JobFormPage } from "./JobFormPage";
import { FilePenLine, Pencil } from "lucide-react";

export function JobDetailPage({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDescriptionRecord | null>(null);
  const [applications, setApplications] = useState<JobApplicationSummary[]>([]);
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJob = async () => {
    try {
      const { job_description } = await api.getJobDescription(jobId);
      setJob(job_description);
    } catch (loadError) {
      setError(detailErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetchJob().then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    void listAllJobApplications()
      .then((result) => {
        if (!cancelled) {
          setApplications(result);
          setApplicationsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApplications([]);
          setApplicationsLoaded(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const deleteJob = async () => {
    if (!job || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteJobDescription(job.id);
      navigateTo("/career/jobs", { replace: true });
    } catch (actionError) {
      setError(detailErrorMessage(actionError));
      setDeleteOpen(false);
      setBusy(false);
    }
  };

  if (isEditing) {
    return <JobFormPage mode="edit" jobId={jobId} onClose={() => {
      setIsEditing(false);
      setLoading(true);
      void fetchJob();
    }} />;
  }

  if (loading) return <main className="dashboard-content job-page-shell"><PageLoading label="正在加载岗位详情…" /></main>;
  if (!job) return <main className="dashboard-content job-page-shell"><section className="job-workspace-state"><h1>无法打开这个岗位</h1><p>{error}</p><Button onClick={() => navigateTo("/career/jobs", { replace: true })}>返回岗位库</Button></section></main>;

  const jobApplications = applicationsForJob(applications, job.id);
  const activeApplication = activeApplicationForJob(applications, job.id);

  return (
    <main className="dashboard-content job-page-shell">
      <article className="job-detail">
        <div className="job-detail-topbar">
          <div className="job-detail-heading">
            <h1 className="job-detail-page-title">岗位详情</h1>
            <a className="job-back-link" href="/career/jobs" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigateTo("/career/jobs"); }}><ArrowLeft size={14} />返回岗位库</a>
          </div>
          <div className="job-detail-actions">
            <Button variant="outline" icon={<Pencil size={15} />} disabled={busy} onClick={() => setIsEditing(true)}>编辑</Button>
            <Button variant="ghost" icon={<Trash2 size={15} />} disabled={busy} onClick={() => setDeleteOpen(true)}>删除</Button>
          </div>
        </div>
        {error && <div className="job-error job-detail-error" role="alert">{error}</div>}
        
        {!activeApplication && applicationsLoaded && (
          <div className="job-start-cta">
            <Button size="lg" onClick={() => navigateTo(startCareerApplicationPath(job.id))}>
              {jobApplications.length ? "再次开始求职" : "开始求职"}
            </Button>
          </div>
        )}

        <JobDocumentReadonly job={job} />

        <section className="job-document-section job-career-section">
          <header>
            <div><p className="job-eyebrow">求职进程</p><h2>这个岗位的求职记录</h2></div>
            {activeApplication && (
              <Button onClick={() => navigateTo(careerApplicationPath(activeApplication.id))}>查看当前求职进程</Button>
            )}
          </header>
          {!applicationsLoaded ? (
            <div className="job-career-empty"><p>暂时无法读取求职进程。为避免重复创建，请稍后刷新再试。</p></div>
          ) : jobApplications.length ? (
            <div className="job-application-history">
              {jobApplications.map((application) => (
                <article key={application.id}>
                  <div><strong>{application.current_stage_label}</strong><span>{applicationOutcome(application)} · {formatTime(application.created_at)}</span></div>
                  <span className={`job-status-badge${application.status !== "active" || application.archived_at ? " is-archived" : ""}`}>{applicationOutcome(application)}</span>
                  <Button size="sm" variant="outline" onClick={() => navigateTo(careerApplicationPath(application.id))}>查看进程</Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="job-career-empty"><p>这个岗位还没有求职进程。开始后会保存当前岗位与简历版本快照，并进入筛选阶段。</p></div>
          )}
        </section>
      </article>
      {deleteOpen && <ConfirmDialog kind="delete" title={`永久删除「${job.job_title}」？`} description="删除后无法恢复，并会释放该来源，之后再次写入会创建新的岗位。" confirmLabel="永久删除" busyLabel="正在删除…" busy={busy} onCancel={() => setDeleteOpen(false)} onConfirm={deleteJob} />}
    </main>
  );
}

function JobDocumentReadonly({ job }: { job: JobDescriptionRecord }) {
  return (
    <section className="job-document-readonly">
      <header className="job-document-hero">
        <div className="job-document-title">
          <h2 style={{ fontSize: "var(--text-xl)", fontWeight: "bold", color: "var(--ui-text-primary)" }}>{job.company_name}</h2>
          <h1 style={{ fontSize: "var(--text-xl)", fontWeight: "bold", color: "var(--ui-text-primary)", marginTop: "4px" }}>{job.job_title}</h1>
        </div>
      </header>
      <div className="job-document-layout">
        <div className="job-document-main">
          <DocumentSection title="职位描述">
            <div className="job-document-text" style={{ whiteSpace: "pre-wrap", color: "var(--ui-text-primary)" }}>{job.description}</div>
          </DocumentSection>
          {job.skills && job.skills.length > 0 && (
            <DocumentSection title="核心技能">
              <div style={{ color: "var(--ui-text-primary)" }}>{job.skills.join(", ")}</div>
            </DocumentSection>
          )}
          {job.company_description && (
            <DocumentSection title="公司简介">
              <div className="job-document-text" style={{ whiteSpace: "pre-wrap", color: "var(--ui-text-primary)" }}>{job.company_description}</div>
            </DocumentSection>
          )}
        </div>
        <aside className="job-document-rail">
          <DocumentSection title="岗位要求">
            <dl className="job-document-grid">
              <Definition label="薪资" value={structuredSalarySummary(job)} />
              <Definition label="工作地点" value={job.work_city} />
              <Definition label="详细地址" value={job.work_address} />
              <Definition label="用工类型" value={employmentOptions.find(o => o[0] === job.employment_type)?.[1]} />
              <Definition label="学历要求" value={job.education_requirement} />
              <Definition label="经验要求" value={job.experience_requirement} />
              <Definition label="工作方式" value={workModeOptions.find(o => o[0] === job.work_mode)?.[1]} />
              <Definition label="工作安排" value={job.work_schedule} />
            </dl>
          </DocumentSection>
          <DocumentSection title="公司与招聘者">
            <dl className="job-document-grid">
              <Definition label="公司全称" value={job.company_legal_name} />
              <Definition label="行业" value={job.company_industry} />
              <Definition label="公司规模" value={job.company_size} />
              <Definition label="融资阶段" value={job.company_financing_stage} />
              <Definition label="招聘者姓名" value={job.recruiter_name} />
              <Definition label="招聘者职位" value={job.recruiter_title} />
            </dl>
          </DocumentSection>
          <DocumentSection title="来源与备注">
            <dl className="job-document-grid">
              <Definition label="来源" value={job.source_site ?? "手工创建"} />
              <Definition label="更新时间" value={formatTime(job.updated_at)} />
              {job.imported_at && <Definition label="导入时间" value={formatTime(job.imported_at)} />}
            </dl>
            {job.notes && (
              <div style={{ marginTop: "12px" }}>
                <div style={{ color: "var(--ui-text-tertiary)", fontSize: "12px", marginBottom: "4px" }}>个人备注</div>
                <div style={{ whiteSpace: "pre-wrap", color: "var(--ui-text-primary)" }}>{job.notes}</div>
              </div>
            )}
            {job.source_url && (
              <a className="job-source-link" href={job.source_url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "12px" }}>
                打开来源岗位 <ExternalLink size={13} />
              </a>
            )}
          </DocumentSection>
        </aside>
      </div>
    </section>
  );
}

const employmentOptions: Array<[string, string]> = [["full_time", "全职"], ["part_time", "兼职"], ["internship", "实习"], ["contract", "合同"], ["temporary", "临时"]];
const workModeOptions: Array<[string, string]> = [["onsite", "现场"], ["hybrid", "混合"], ["remote", "远程"]];
const salaryPeriodOptions: Array<[string, string]> = [["hour", "小时"], ["day", "天"], ["month", "月"], ["year", "年"]];

function salaryPeriodLabel(period: JobFormState["salary_period"] | null | undefined): string { return salaryPeriodOptions.find(([value]) => value === period)?.[1] ?? ""; }
function structuredSalarySummary(job: JobDescriptionRecord): string { const range = [job.salary_min, job.salary_max].filter(Boolean).join(" – "); const context = [job.salary_currency, salaryPeriodLabel(job.salary_period)].filter(Boolean).join("/"); const months = job.salary_months_per_year ? `${job.salary_months_per_year} 薪` : ""; return [range, context, months].filter(Boolean).join(" · ") || job.salary_text || "未填写"; }

function DocumentSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="job-document-section"><h3>{title}</h3>{children}</section>; }
function Definition({ label, value }: { label: string; value: string | null | undefined }) { return <div className="job-document-definition"><dt style={{ color: "var(--ui-text-tertiary)" }}>{label}</dt><dd style={{ color: "var(--ui-text-primary)" }}>{value || "未填写"}</dd></div>; }
function formatTime(value: string): string { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function detailErrorMessage(error: unknown, fallback = "岗位服务暂时不可用，请稍后重试。"): string { if (error instanceof ApiRequestError) { if (error.message === "JD_NOT_FOUND") return "岗位不存在，或当前账号没有访问权限。"; if (error.message === "JD_EDIT_CONFLICT") return "岗位内容已经变化，请重新打开后再保存。"; if (error.message === "INVALID_JOB_DESCRIPTION") return "请检查必填字段、薪资组合和字段长度。"; if (error.status === 401) return "登录状态已失效，请重新登录。"; } return fallback; }
