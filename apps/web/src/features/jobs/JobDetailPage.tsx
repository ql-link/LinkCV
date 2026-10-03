import { t, useLocale } from "@/i18n";
import { MotionPresence, MotionSurface } from "@/components/ui/motion";
import { SkeletonCards, SkeletonHead } from "@/v3/skeletons";
import { useEffect, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { Icon } from "@/v3/Icon";
import { Dialog, Popover, Select, PageEyebrow } from "@/v3/primitives";
import { InAppNotFound } from "../not-found/NotFoundPage";
import { JobMatchBody, useJobMatch } from "./JobMatchCard";
import matchDots from "./assets/match-dots.svg";
import matchArrow from "./assets/match-arrow.svg";
import descriptionDots from "./assets/description-dots.svg";
import deleteDots from "./assets/delete-dots.svg";
import { api, ApiRequestError, type JobApplicationSummary, type JobDescriptionRecord, type ResumeSummary } from "../../api/client";
import { Button, FeedbackNotice, PageLoading } from "@/components/ui";
import { careerApplicationPath, editorPath, navigateTo, startCareerApplicationPath } from "../../routing";
import { jobFormFromRecord, jobPayloadFromForm, type JobFormState } from "./jobFormModel";
import { activeApplicationForJob, applicationsForJob, listAllJobApplications } from "./jobApplications";
import "./jobs.css";
import "./JobDetailV3.css";

export function JobDetailPage({ jobId }: { jobId: string }) {
  useLocale();
  const fromApplicationId = new URLSearchParams(window.location.search).get("fromApplication");
  const backPath = fromApplicationId ? careerApplicationPath(fromApplicationId) : "/career/applications";
  const [job, setJob] = useState<JobDescriptionRecord | null>(null);
  const [applications, setApplications] = useState<JobApplicationSummary[]>([]);
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [editingField, setEditingField] = useState<EditableTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setEditingField(null);
    void api.getJobDescription(jobId).then(({ job_description }) => {
      if (cancelled) return;
      setJob(job_description);
    }).catch((loadError: unknown) => {
      if (!cancelled) { setError(detailErrorMessage(loadError)); setNotFound(loadError instanceof ApiRequestError && loadError.message === "JD_NOT_FOUND"); setJob(null); }
    }).finally(() => {
      if (!cancelled) setLoading(false);
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

  const saveFields = async (changes: Partial<JobFormState>) => {
    if (!job || busy) return;
    const nextForm = { ...jobFormFromRecord(job), ...changes } as JobFormState;
    if (!nextForm.job_title.trim() || !nextForm.company_name.trim()) {
      setError(t("该字段为必填项，不能保存空内容。"));
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
      setError(detailErrorMessage(actionError, t("保存岗位失败，请稍后重试。")));
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
      navigateTo("/career/applications", { replace: true });
    } catch (actionError) {
      setError(detailErrorMessage(actionError));
      setDeleteOpen(false);
      setBusy(false);
    }
  };

  if (loading) return <main className="dashboard-content job-page-shell"><div className="jd-v3"><SkeletonHead actions={2} /><SkeletonCards cards={[160, 260, 180]} label={t("正在加载岗位详情…")} /></div></main>;
  if (notFound) return <InAppNotFound />;
  if (!job) return <main className="dashboard-content job-page-shell"><section className="job-workspace-state"><h1>{t("无法打开这个岗位")}</h1><p>{error}</p><Button onClick={() => navigateTo(backPath, { replace: true })}>{t("返回求职记录")}</Button></section></main>;

  const jobApplications = applicationsForJob(applications, job.id);
  const activeApplication = activeApplicationForJob(applications, job.id);

  return (
    <main className="v3 jd-v3">
      {error && <FeedbackNotice kind="error" placement="floating" onDismiss={() => setError(null)}>{error}</FeedbackNotice>}
      <JobDocument job={job} application={activeApplication ?? jobApplications[0]} backPath={backPath} editingField={editingField} busy={busy} onEdit={setEditingField} onSave={saveField} onSaveFields={saveFields}
        onApplicationChange={(updated) => setApplications((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item))}
        onError={setError}
        actions={<>
          <button className="v3-btn v3-btn-ghost jd-delete" type="button" disabled={busy} onClick={() => setDeleteOpen(true)}><Icon name="trash" size={13} />{t("删除")}</button>
          {applicationsLoaded && (activeApplication ? <button className="v3-btn v3-btn-dark" type="button" onClick={() => navigateTo(careerApplicationPath(activeApplication.id))}>{t("查看求职进程")}</button> : !jobApplications.length ? <button className="v3-btn v3-btn-dark" type="button" onClick={() => navigateTo(startCareerApplicationPath(job.id))}>{t("开始求职")}</button> : null)}
        </>}
      />
      <MotionPresence>{deleteOpen && <JobDeleteDialog job={job} busy={busy} onCancel={() => setDeleteOpen(false)} onConfirm={deleteJob} />}</MotionPresence>
    </main>
  );
}

type EditableTarget = keyof JobFormState | "structured_salary";
type StructuredSalaryDraft = Pick<JobFormState, "salary_text" | "salary_min" | "salary_max" | "salary_currency" | "salary_period" | "salary_months_per_year">;

const descriptionMarkdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
const defaultText = descriptionMarkdown.renderer.rules.text;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 高亮词来自匹配分析结果：只标记岗位描述原文里确实出现的词，缺失词优先于已覆盖词。
descriptionMarkdown.renderer.rules.text = (tokens, index, options, env, self) => {
  const highlights = env?.highlights as { covered: string[]; missing: string[] } | undefined;
  const words = highlights ? [...new Set([...highlights.missing, ...highlights.covered].filter(Boolean))] : [];
  if (!words.length) return defaultText ? defaultText(tokens, index, options, env, self) : descriptionMarkdown.utils.escapeHtml(tokens[index].content);
  const missing = new Set(highlights!.missing.map((word) => word.toLowerCase()));
  const pattern = new RegExp(`(${words.sort((left, right) => right.length - left.length).map(escapeRegExp).join("|")})`, "gi");
  return tokens[index].content.split(pattern).map((part, position) => {
    const escaped = descriptionMarkdown.utils.escapeHtml(part);
    if (position % 2 === 0) return escaped;
    return missing.has(part.toLowerCase()) ? `<span class="jd-keyword-missing">${escaped}</span>` : `<strong>${escaped}</strong>`;
  }).join("");
};

function JobDocument({ job, application, backPath, actions, editingField, busy, onEdit, onSave, onSaveFields, onApplicationChange, onError }: {
  job: JobDescriptionRecord; application?: JobApplicationSummary; backPath: string; actions: React.ReactNode; editingField: EditableTarget | null; busy: boolean;
  onEdit: (field: EditableTarget | null) => void; onSave: (field: keyof JobFormState, value: string) => Promise<void>; onSaveFields: (changes: Partial<JobFormState>) => Promise<void>;
  onApplicationChange: (application: Partial<JobApplicationSummary> & { id: string }) => void; onError: (message: string) => void;
}) {
  useLocale();
  const hasResume = Boolean(application?.resume_id);
  const hasDescription = Boolean(job.description.trim());
  const showMatch = hasResume && hasDescription;
  const matchState = useJobMatch(job.id, application?.resume_id, showMatch);
  const highlights = showMatch && matchState.match?.status === "ready" && !matchState.analyzing ? matchState.match.highlights : undefined;
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeSaving, setResumeSaving] = useState(false);
  const resumeTrigger = useRef<HTMLButtonElement>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const editable = (field: keyof JobFormState, label: string, value: string | null | undefined, options?: Array<[string, string]>, multiline = false, content?: React.ReactNode) => (
    <InlineEditableField field={field} label={label} value={value ?? ""} options={options} multiline={multiline} content={content} active={editingField === field} disabled={busy} onEdit={onEdit} onSave={onSave} />
  );
  const selectResume = async () => {
    if (!application) { navigateTo(startCareerApplicationPath(job.id)); return; }
    setResumeOpen(true); setResumeLoading(true);
    try { setResumes((await api.listResumes()).resumes); } catch { onError(t("简历列表加载失败，请稍后重试。")); setResumeOpen(false); } finally { setResumeLoading(false); }
  };
  const linkResume = async (resume: ResumeSummary) => {
    if (!application || resumeSaving) return;
    setResumeSaving(true);
    try {
      const result = await api.updateJobApplication(application.id, { resume_id: resume.id, base_lock_version: application.lock_version });
      onApplicationChange({ ...result.application, resume_title_snapshot: resume.title }); setResumeOpen(false);
    } catch (error) { onError(detailErrorMessage(error, t("关联简历失败，请稍后重试。"))); } finally { setResumeSaving(false); }
  };
  return <article>
    <header className="jd-header">
      <PageEyebrow className="jd-eyebrow" segments={[{ label: "JOBS", href: backPath, onClick: () => navigateTo(backPath), ariaLabel: t("返回求职记录") }, job.company_name, t("岗位详情")]} />
      <div className="jd-source"><Icon name={job.source_type === "external_import" ? "puzzle" : "doc"} size={12} /><span>{job.source_type === "external_import" ? t("插件导入") : job.source_type === "manual" ? t("手工创建") : t("智能导入")}{job.source_site ? ' · ' + job.source_site : ''}{t(" · 更新于 ")}{formatTime(job.updated_at)}</span>{job.source_url && <a href={job.source_url} target="_blank" rel="noreferrer">{t("打开来源")}</a>}</div>
      <div className="jd-title-row"><InlineEditableField field="job_title" label={t("职位名称")} value={job.job_title} heading active={editingField === "job_title"} disabled={busy} onEdit={onEdit} onSave={onSave} />{application?.status === "active" && <span className="jd-stage-label">{application.current_stage?.stage_label || application.current_stage_label || t("待投递")}</span>}</div>
      <div className="jd-actions">{actions}</div>
      <div className="jd-summary"><StructuredSalaryEditor job={job} active={editingField === "structured_salary"} disabled={busy} onEdit={onEdit} onSave={onSaveFields} /><div className="jd-facts">{editable("work_city", t("工作地点"), job.work_city)}<span>·</span>{editable("employment_type", t("求职分类"), job.employment_type, employmentOptions)}<span>·</span>{editable("education_requirement", t("学历要求"), job.education_requirement)}<span>·</span>{editable("experience_requirement", t("经验要求"), job.experience_requirement)}<span>·</span>{editable("work_mode", t("工作方式"), job.work_mode, workModeOptions)}</div></div>
    </header>
    <div className="jd-columns">
      <div className="jd-left">
        <section className={'jd-card jd-match' + (hasResume && !hasDescription ? ' is-unavailable' : '')} aria-label={t("简历匹配度")}>
          {hasResume ? <JobMatchBody state={matchState} resumeTitle={application?.resume_title_snapshot || t("关联简历")} hasDescription={hasDescription} onOptimize={() => { if (application?.resume_id) navigateTo(editorPath(application.resume_id)); }} />
          : <>
            <MatchEmptyArt /><div className="jd-match-copy is-empty"><h2>{t("还没有关联简历")}</h2><p>{t("选一份简历后，会对照 JD 算出匹配度，并告诉你还缺哪些经历。")}</p></div>
            <button ref={resumeTrigger} className="v3-btn v3-btn-ghost jd-match-action" type="button" onClick={() => void selectResume()}><Icon name="doc" size={13} />{t("选择关联简历")}</button>
            <Popover anchorRef={resumeTrigger} open={resumeOpen} onClose={() => { if (!resumeSaving) setResumeOpen(false); }} label={t("选择关联简历")} className="jd-resume-picker" matchWidth>{resumeLoading ? <p>{t("正在加载简历…")}</p> : resumes.length ? resumes.map((resume) => <button type="button" key={resume.id} disabled={resumeSaving} onClick={() => void linkResume(resume)}><Icon name="doc" size={14} />{resume.title}</button>) : <p>{t("还没有简历，")}<a href="/resumes">{t("去创建简历")}</a></p>}</Popover>
          </>}
        </section>
        <section className="jd-card jd-notes"><div className="jd-note-label"><span>{t("个人备注")}</span>{editingField === "notes" ? <small>{t("Shift + Enter 换行 · Esc 取消")}</small> : <button type="button" aria-label={t("编辑备注")} disabled={busy} onClick={() => onEdit("notes")}><Icon name="edit" size={13} /></button>}</div>{editable("notes", t("个人备注"), job.notes, undefined, true)}</section>
      </div>
      <div className="jd-right">
        <section className={'jd-card jd-description' + (!hasDescription && editingField !== "description" ? ' is-empty' : '')}>
          <div className="jd-card-heading"><span className="jd-card-icon"><Icon name="doc" size={14} /></span><h2>{t("岗位描述")}</h2>{highlights && <div className="jd-legend"><span><i />{t("已覆盖")}</span><span><i />{t("待补充")}</span></div>}</div>
          {hasDescription || editingField === "description" ? <>
            <div className="jd-description-body">{editable("description", t("职位描述"), job.description, undefined, true, <span className="jd-markdown" dangerouslySetInnerHTML={{ __html: descriptionMarkdown.render(job.description, { highlights }) }} />)}{editingField === "description" && <span className="jd-markdown-help">{t("支持 Markdown，## 开头是小标题")}</span>}</div>
            <div className="jd-skills"><p className="jd-muted">{t("核心技能")}</p>{editable("skills", t("核心技能"), job.skills.join(", "), undefined, false, <span className="jd-tags">{job.skills.length ? job.skills.map((skill) => <span className="jd-tag" key={skill}>{skill}</span>) : t("未填写")}</span>)}</div>
            <div className="jd-work"><div><p className="jd-muted">{t("工作安排")}</p>{editable("work_schedule", t("工作安排"), job.work_schedule)}</div><div><p className="jd-muted">{t("详细地址")}</p>{editable("work_address", t("详细地址"), job.work_address)}</div></div>
          </> : <><DescriptionEmptyArt /><h3>{t("岗位描述暂未记录")}</h3><p className="jd-empty-description">{t("点这里粘贴招聘网站上的岗位文字。有了岗位描述才能计算简历匹配度。")}</p><button className="v3-btn v3-btn-ghost" type="button" onClick={() => onEdit("description")}><Icon name="text" size={13} />{t("粘贴岗位文字")}</button></>}
        </section>
        <section className="jd-card jd-company">
          <div className="jd-company-header"><div className="jd-logo-editor"><button className="jd-logo" type="button" aria-label={t("编辑公司 Logo URL")} onClick={() => onEdit(editingField === "logo_url" ? null : "logo_url")}>{job.logo_url && !logoFailed ? <img src={job.logo_url} alt={job.company_name} onError={() => setLogoFailed(true)} /> : [...job.company_name][0]}</button>{editingField === "logo_url" && <div className="jd-logo-input">{editable("logo_url", t("公司 Logo URL"), job.logo_url)}</div>}</div><div className="jd-company-names">{editable("company_name", t("公司名称"), job.company_name)}{editable("company_legal_name", t("公司全称"), job.company_legal_name)}</div></div>
          <div className="jd-company-facts"><div><p className="jd-muted">{t("行业")}</p>{editable("company_industry", t("行业"), job.company_industry)}</div><div><p className="jd-muted">{t("规模")}</p>{editable("company_size", t("公司规模"), job.company_size)}</div><div><p className="jd-muted">{t("融资阶段")}</p>{editable("company_financing_stage", t("融资阶段"), job.company_financing_stage)}</div><div><p className="jd-muted">{t("招聘者")}</p><div className="jd-recruiter">{editable("recruiter_name", t("招聘者姓名"), job.recruiter_name)}<span>·</span>{editable("recruiter_title", t("招聘者职位"), job.recruiter_title)}</div></div></div>
          <div className="jd-company-description">{editable("company_description", t("公司简介"), job.company_description, undefined, true)}</div>
        </section>
      </div>
    </div>
  </article>;
}

function MatchEmptyArt() {
  useLocale();
  return <div className="jd-match-stage jd-match-empty-art" aria-hidden="true"><img className="jd-dots" src={matchDots} alt="" /><span className="jd-empty-slot"><Icon name="plus" size={20} /></span><span className="jd-empty-paper"><i /><i /><i /><i /><i /><i /><i /><b>JD</b></span><img className="jd-empty-arrow" src={matchArrow} alt="" /></div>;
}
function DescriptionEmptyArt() {
  useLocale();
  return <div className="jd-description-art" aria-hidden="true"><img src={descriptionDots} alt="" /><span className="jd-description-paper"><i /><i /><i /><i /></span><span className="jd-paste-badge"><Icon name="text" size={18} /></span></div>;
}
function JobDeleteDialog({ job, busy, onCancel, onConfirm }: { job: JobDescriptionRecord; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  useLocale();
  return <Dialog width={420} label={t("永久删除这个岗位？")} className="jd-delete-dialog" onClose={onCancel} closable={!busy}><div role="alertdialog" aria-label={t("永久删除这个岗位？")} aria-describedby="jd-delete-impact"><div className="jd-delete-art" aria-hidden="true"><img src={deleteDots} alt="" /><span className="jd-delete-paper"><i /><i /><i /><i /></span><span className="jd-delete-badge"><Icon name="trash" size={14} /></span></div><h2>{t("永久删除这个岗位？")}</h2><p className="jd-delete-sub">{job.job_title} · {job.company_name}{t(" · 删除后无法恢复")}</p><div className="jd-delete-impact" id="jd-delete-impact"><p><Icon name="brief" size={14} />{t("求职进程、阶段和复盘会一起删除")}</p><p><Icon name="cal" size={14} />{t("这个岗位的面试排期会一起删除")}</p><p><Icon name="folder" size={14} />{t("关联资料的原文件仍保留在资料库")}</p></div><div className="jd-delete-buttons"><button className="v3-btn v3-btn-ghost" type="button" disabled={busy} onClick={onCancel}>{t("取消")}</button><button className="v3-btn v3-btn-danger" type="button" disabled={busy} onClick={onConfirm}>{busy ? t("正在删除…") : t("永久删除")}</button></div></div></Dialog>;
}

const employmentOptions: Array<[string, string]> = [["internship", "实习"], ["campus", "校招"], ["full_time", "正式"]];
const workModeOptions: Array<[string, string]> = [["onsite", "现场"], ["hybrid", "混合"], ["remote", "远程"]];
const salaryPeriodOptions: Array<[string, string]> = [["hour", "小时"], ["day", "天"], ["month", "月"], ["year", "年"]];
const emptyInlineSelectValue = "__empty_inline_select__";

function InlineEditableField({ field, label, value, options, multiline = false, heading = false, content, active, disabled, onEdit, onSave }: { field: keyof JobFormState; label: string; value: string; options?: Array<[string, string]>; multiline?: boolean; heading?: boolean; content?: React.ReactNode; active: boolean; disabled: boolean; onEdit: (field: keyof JobFormState | null) => void; onSave: (field: keyof JobFormState, value: string) => Promise<void> }) {
  useLocale();
  const [draft, setDraft] = useState(value);
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const blurTimerRef = useRef<number | null>(null);
  const displayValue = (options?.find(([optionValue]) => optionValue === value)?.[1] ?? value) || t("未填写");

  useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
  }, []);

  useEffect(() => {
    if (!active) {
      setDraft(value);
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
        if (nextTarget instanceof Element && nextTarget.closest(".v3-select-menu")) return;
        if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = window.setTimeout(() => {
          blurTimerRef.current = null;
          const focusedElement = document.activeElement;
          const menuOpen = document.querySelector('.v3-select-menu');
          if ((focusedElement && container.contains(focusedElement)) || menuOpen) return;
          dismissOnBlur();
        }, 0);
      } : undefined}
    >
      {active ? (
        options ? (
          <Select label={label} className="job-quick-edit-select-trigger" value={draft || emptyInlineSelectValue} disabled={disabled}
            options={[[emptyInlineSelectValue, t("未填写")], ...options].map(([value, label]) => ({ value, label }))}
            onChange={(nextValue) => { const nextDraft = nextValue === emptyInlineSelectValue ? "" : nextValue; setDraft(nextDraft); void onSave(field, nextDraft); }} />
        ) : multiline ? (
          <>
            <span className="job-quick-edit-multiline-mirror" aria-hidden="true">{draft || t("未填写")}</span>
            <textarea ref={controlRef as React.RefObject<HTMLTextAreaElement>} rows={1} name={String(field)} autoComplete="off" aria-label={label} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={dismissOnBlur} />
          </>
        ) : (
          <input ref={controlRef as React.RefObject<HTMLInputElement>} name={String(field)} autoComplete="off" aria-label={label} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={dismissOnBlur} />
        )
      ) : (
        heading ? (
          <h1 className="job-quick-edit-heading">
            <button type="button" className="job-quick-edit-display" aria-label={t("编辑{value0}", { value0: label })} disabled={disabled} onClick={beginEditing}>
              <span className="job-quick-edit-value">{content ?? displayValue}</span><Icon name="edit" size={13} className="jd-edit-icon" />
            </button>
          </h1>
        ) : (
          <button type="button" className="job-quick-edit-display" aria-label={t("编辑{value0}", { value0: label })} disabled={disabled} onClick={beginEditing}>
            <span className="job-quick-edit-value">{content ?? displayValue}</span><Icon name="edit" size={13} className="jd-edit-icon" />
          </button>
        )
      )}
      {active && field !== "notes" && <small className="jd-edit-hint">{options ? t("选中即保存") : field === "skills" ? t("用逗号分隔 · Enter 保存 · Esc 取消") : multiline ? t("Enter 保存 · Shift + Enter 换行 · Esc 取消") : field === "job_title" || field === "company_name" ? t("必填 · Enter 保存 · Esc 取消") : t("Enter 保存 · Esc 取消")}</small>}
    </div>
  );
}

function StructuredSalaryEditor({ job, active, disabled, onEdit, onSave }: { job: JobDescriptionRecord; active: boolean; disabled: boolean; onEdit: (field: EditableTarget | null) => void; onSave: (changes: Partial<JobFormState>) => Promise<void> }) {
  useLocale();
  const current = structuredSalaryDraft(job);
  const [draft, setDraft] = useState<StructuredSalaryDraft>(current);
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
        if (nextTarget === document.body) { if (active) dismiss(); return; }
        if (nextTarget instanceof Element && nextTarget.closest(".v3-select-menu")) return;
        if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = window.setTimeout(() => {
          blurTimerRef.current = null;
          const focusedElement = document.activeElement;
          const menuOpen = document.querySelector('.v3-select-menu');
          if ((focusedElement && container.contains(focusedElement)) || menuOpen) return;
          if (active) dismiss();
        }, 0);
      }}
    >
      <div>
        {active ? <input className="jd-salary-raw" aria-label={t("薪资")} value={draft.salary_text} onChange={(event) => setField("salary_text", event.target.value)} onKeyDown={onKeyDown} disabled={disabled} /> : <button
          type="button"
          className="job-quick-edit-display job-structured-salary-trigger"
          aria-label={t("编辑结构化薪资")}
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
          <span className="job-quick-edit-value">{job.salary_text || t("未填写")}</span><Icon name="edit" size={13} className="jd-edit-icon" />
        </button>}
        <MotionPresence>{active && (
          <MotionSurface as="div" variant="popover"
            className="job-structured-salary-controls"
            role="dialog"
            aria-label={t("编辑结构化薪资")}
          >
            <div className="jd-salary-caption"><strong>{t("结构化薪资")}</strong><span>{t("用于筛选和排序，可以不填")}</span></div>
            <SalaryControl label={t("最低")}><input ref={firstInputRef} name="salary_min" autoComplete="off" aria-label={t("最低薪资")} inputMode="decimal" value={draft.salary_min} disabled={disabled} onChange={(event) => setField("salary_min", event.target.value)} onKeyDown={onKeyDown} /></SalaryControl>
            <SalaryControl label={t("最高")}><input name="salary_max" autoComplete="off" aria-label={t("最高薪资")} inputMode="decimal" value={draft.salary_max} disabled={disabled} onChange={(event) => setField("salary_max", event.target.value)} onKeyDown={onKeyDown} /></SalaryControl>
            <SalaryControl label={t("币种")}><input name="salary_currency" autoComplete="off" aria-label={t("币种")} maxLength={3} value={draft.salary_currency} disabled={disabled} onChange={(event) => setField("salary_currency", event.target.value.toUpperCase())} onKeyDown={onKeyDown} /></SalaryControl>
            <SalaryControl label={t("计薪周期")}>
              <Select label={t("计薪周期")} className="job-structured-salary-period-trigger" value={draft.salary_period || emptySalaryPeriodValue} disabled={disabled}
                options={[[emptySalaryPeriodValue, t("未填写")], ...salaryPeriodOptions].map(([value, label]) => ({ value, label }))}
                onChange={(value) => setField("salary_period", value === emptySalaryPeriodValue ? "" : value)} />
            </SalaryControl>
            <SalaryControl label={t("年薪月数")}><input name="salary_months_per_year" autoComplete="off" aria-label={t("年薪月数")} type="number" min={1} max={65535} value={draft.salary_months_per_year} disabled={disabled} onChange={(event) => setField("salary_months_per_year", event.target.value)} onKeyDown={onKeyDown} /></SalaryControl>
            <div className="jd-salary-help"><span>{t("页头只显示原文，结构化数字不会改写原文")}</span><span>{t("Enter 保存 · Esc 取消")}</span></div>
          </MotionSurface>
        )}</MotionPresence>
      </div>
    </div>
  );
}

const emptySalaryPeriodValue = "__empty_salary_period__";

function SalaryControl({ label, children }: { label: string; children: React.ReactNode }) {
  useLocale(); return <div className="job-structured-salary-control"><span>{label}</span>{children}</div>; }
function structuredSalaryDraft(job: JobDescriptionRecord): StructuredSalaryDraft { return { salary_text: job.salary_text ?? "", salary_min: job.salary_min ?? "", salary_max: job.salary_max ?? "", salary_currency: job.salary_currency ?? "", salary_period: job.salary_period ?? "", salary_months_per_year: job.salary_months_per_year?.toString() ?? "" }; }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0"); }

function detailErrorMessage(error: unknown, fallback = t("岗位服务暂时不可用，请稍后重试。")): string { if (error instanceof ApiRequestError) { if (error.message === "JD_NOT_FOUND") return t("岗位不存在，或当前账号没有访问权限。"); if (error.message === "JD_EDIT_CONFLICT") return t("岗位内容已经变化，请重新打开后再保存。"); if (error.message === "INVALID_JOB_DESCRIPTION") return t("请检查必填字段、薪资组合和字段长度。"); if (error.status === 401) return t("登录状态已失效，请重新登录。"); } return fallback; }
