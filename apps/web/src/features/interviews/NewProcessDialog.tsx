import { t, useLocale } from "@/i18n";
import { useContentMotion } from "@/components/ui/motion";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, type ApplicationStageType, type InterviewSessionDetail, type JobApplicationRecord, type JobApplicationSummary, type JobDescriptionSummary } from "@/api/client";
import { Icon, type V3IconName } from "@/v3/Icon";
import { DateTimeField, Dialog, DialogFooter, formatDateTimeLabel, Popover, Segmented } from "@/v3/primitives";
import { careerApplicationPath, navigateTo } from "../../routing";
import "./new-process.css";

const stages: Array<{ value: ApplicationStageType; label: string; icon: V3IconName }> = [
  { value: "assessment", get label() { return t("测评"); }, icon: "text" }, { value: "written_test", get label() { return t("笔试"); }, icon: "edit" },
  { value: "ai_interview", get label() { return t("AI 面试"); }, icon: "spark" }, { value: "interview", get label() { return t("面试"); }, icon: "user" },
];
const modes = [{ value: "video", get label() { return t("视频"); } }, { value: "onsite", get label() { return t("现场"); } }, { value: "phone", get label() { return t("电话"); } }] as const;
function Segments<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void; disabled?: T }) {
  useLocale();
  return <Segmented label={label} value={value} options={options.map((option) => ({ ...option, disabled: disabled === option.value }))} onChange={onChange} />;
}
function Field({ label, optional, children }: { label: string; optional?: string; children: React.ReactNode }) {
  useLocale();
  return <div className="np-field"><div className="np-label"><span>{label.replace(" *", "")}{label.endsWith(" *") && <em>*</em>}</span>{optional && <small>{optional}</small>}</div>{children}</div>;
}
const pad = (value: number) => String(value).padStart(2, "0");
function shortTime(date: Date) { return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; }
export function NewProcessDialog({ applications, timezone, initialStartAt, initialEndAt, onClose, onCreated }: {
  applications: JobApplicationSummary[]; timezone: string; initialStartAt?: string | null; initialEndAt?: string | null;
  onClose: () => void; onCreated: (sessionId: string, info: { company: string; stage: string; startAt: string }) => void;
}) {
  useLocale();
  const [source, setSource] = useState<"new" | "existing">("new");
  const [jobs, setJobs] = useState<JobDescriptionSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobId, setJobId] = useState("");
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const jobAnchor = useRef<HTMLButtonElement>(null);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [stageType, setStageType] = useState<ApplicationStageType>("interview");
  const [round, setRound] = useState("1");
  const [customRound, setCustomRound] = useState("4");
  const [customLabel, setCustomLabel] = useState("");
  const [appliedAt, setAppliedAt] = useState<Date | null>(null);
  const [scheduleKind, setScheduleKind] = useState<"fixed_slot" | "open_window">("fixed_slot");
  const [startAt, setStartAt] = useState<Date | null>(() => initialStartAt ? new Date(initialStartAt) : null);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [opensAt, setOpensAt] = useState<Date | null>(null);
  const [duration, setDuration] = useState(() => initialStartAt && initialEndAt ? Math.max(15, Math.round((+new Date(initialEndAt) - +new Date(initialStartAt)) / 60000)) : 60);
  const [mode, setMode] = useState<"video" | "onsite" | "phone">("video");
  const [meeting, setMeeting] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [planDraftAt, setPlanDraftAt] = useState<Date | null>(null);
  const [planDraftDuration, setPlanDraftDuration] = useState(60);
  const planAnchor = useRef<HTMLButtonElement>(null);
  const [planAt, setPlanAt] = useState<Date | null>(null);
  const [planDuration, setPlanDuration] = useState(60);
  const [busy, setBusy] = useState(false);
  const fieldsMotionRef = useContentMotion<HTMLDivElement>(`${source}:${stageType}:${scheduleKind}:${mode}`);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [jobResultUnknown, setJobResultUnknown] = useState(false);
  const mounted = useRef(true);
  const loadRequest = useRef(0);
  // 保存每一步的返回值，后续失败时只重试尚未完成的步骤。
  const saved = useRef<{ jobId?: string; applicationId?: string; application?: JobApplicationRecord; staged?: JobApplicationRecord; session?: InterviewSessionDetail; stagePayload?: Parameters<typeof api.addJobApplicationStage>[1]; sessionPayload?: Parameters<typeof api.createInterviewSession>[1]; planNeedsRefresh?: boolean }>({});
  const ids = useRef({ stage: crypto.randomUUID(), session: crypto.randomUUID() });
  const loadJobs = useCallback(async () => {
    const request = ++loadRequest.current; setJobsLoading(true);
    try {
      const items: JobDescriptionSummary[] = []; let cursor: string | undefined;
      do { const result = await api.listJobDescriptions({ limit: 100, ...(cursor ? { cursor } : {}) }); items.push(...result.items); cursor = result.next_cursor ?? undefined; } while (cursor);
      if (mounted.current && request === loadRequest.current) setJobs(items);
    } catch { if (mounted.current && request === loadRequest.current) setError(t("岗位库加载失败，请重新打开岗位选择后重试。")); }
    finally { if (mounted.current && request === loadRequest.current) setJobsLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void loadJobs(); return () => { mounted.current = false; ++loadRequest.current; }; }, [loadJobs]);
  const availableJobs = jobs.filter((job) => !applications.some((application) => application.job_description_id === job.id && (application.applied_at || application.current_stage_type !== "screening" || application.status !== "active" || application.archived_at || application.lifecycle_status === "terminated")));
  const selectedJob = jobs.find((job) => job.id === jobId);
  const companyLabel = source === "existing" ? selectedJob?.company_name ?? t("选择公司") : company || t("公司");
  const roleLabel = source === "existing" ? selectedJob?.job_title ?? t("选择岗位") : role || t("职位");
  const stageLabel = stageType === "interview" ? (round === "custom" ? customLabel.trim() || t("{value0}面", { value0: customRound }) : ["", t("一面"), t("二面"), t("三面")][Number(round)]) : stages.find((stage) => stage.value === stageType)!.label;
  const changeStage = (value: ApplicationStageType) => { setStageType(value); setScheduleKind(value === "assessment" ? "open_window" : "fixed_slot"); };
  const kindLabel = stageType === "interview" ? t("面试") : stages.find((stage) => stage.value === stageType)!.label;
  const isWindow = scheduleKind === "open_window";
  const partial = progress > 0 && Boolean(error);
  const scheduleFailed = partial && progress === 2;
  const frozenStage = busy || progress > 1 || Boolean(saved.current.stagePayload);
  const frozenSchedule = busy || progress > 2 || Boolean(saved.current.sessionPayload);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || jobResultUnknown && source === "new") return;
    setError("");
    if (source === "new" && (!company.trim() || !role.trim()) || source === "existing" && !selectedJob) { setError(t("请填写公司和职位，或从岗位库选择岗位。")); return; }
    const opening = saved.current.sessionPayload ? new Date(saved.current.sessionPayload.start_at) : opensAt ?? new Date();
    if (!isWindow && (!startAt || !Number.isFinite(+startAt) || !Number.isInteger(duration) || duration < 1)) { setError(t("请选择开始时间并填写有效时长。")); return; }
    if (isWindow && (!deadline || !Number.isFinite(+deadline) || !Number.isFinite(+opening) || deadline <= opening)) { setError(t("截止时间必须晚于开放时间。")); return; }
    if (planAt && isWindow && (!Number.isFinite(+planAt) || !Number.isInteger(planDuration) || planDuration < 1 || planAt < opening || +planAt + planDuration * 60000 > +deadline!)) { setError(t("作答计划须完整落在开放时间与截止时间之间。")); return; }
    if (stageType === "interview" && round === "custom" && (!Number.isInteger(Number(customRound)) || Number(customRound) < 1)) { setError(t("请填写有效的面试轮次。")); return; }
    submitting.current = true; setBusy(true);
    let step: "job" | "application" | "stage" | "session" | "plan" = "application";
    try {
      const record = saved.current;
      if (!record.jobId) {
        if (source === "existing") { record.jobId = jobId; record.applicationId = applications.find((application) => application.job_description_id === jobId)?.id; }
        else { step = "job"; const result = await api.createJobDescription({ company_name: company.trim(), job_title: role.trim(), description: description.trim(), source_type: "manual" }); record.jobId = result.job_description.id; record.applicationId = result.application?.id; }
        setProgress(1);
      }
      step = "application";
      if (!record.application) { const result = record.applicationId ? await api.getJobApplication(record.applicationId) : await api.createJobApplication({ job_description_id: record.jobId }); record.application = result.application; record.applicationId = result.application.id; }
      step = "stage";
      if (!record.staged) {
        record.stagePayload ??= { client_request_id: ids.current.stage, stage_type: stageType, stage_label: stageLabel, interview_round_no: stageType === "interview" ? Number(round === "custom" ? customRound : round) : null, applied_at: appliedAt?.toISOString() ?? null, base_lock_version: record.application.lock_version };
        const result = await api.addJobApplicationStage(record.application.id, record.stagePayload);
        record.staged = result.application; setProgress(2);
      }
      step = "session";
      if (!record.session) {
        const common = { client_request_id: ids.current.session, application_stage_id: record.staged.current_stage?.id, stage_type: stageType === "interview" ? "interview" as const : "other" as const, round_no: stageType === "interview" ? Number(round === "custom" ? customRound : round) : null, stage_label: stageLabel, schedule_kind: scheduleKind, timezone, mode: isWindow ? "video" as const : mode, meeting_url: isWindow || mode !== "onsite" ? meeting.trim() || null : null, location: !isWindow && mode === "onsite" ? meeting.trim() || null : null };
        record.sessionPayload ??= scheduleKind === "open_window" ? { ...common, start_at: opening.toISOString(), end_at: deadline!.toISOString() } : { ...common, start_at: startAt!.toISOString(), duration_minutes: duration };
        record.session = await api.createInterviewSession(record.staged.id, record.sessionPayload); setProgress(3);
      }
      step = "plan";
      if (isWindow && (planAt || record.planNeedsRefresh)) {
        // 乐观锁更新的响应未知时先读回；计划已经保存就不再次更新。
        if (record.planNeedsRefresh) { record.session = await api.getInterviewSession(record.session.session.id); record.planNeedsRefresh = false; }
        const existing = record.session.session;
        if (!planAt && existing.answer_plan_start_at) {
          record.session = await api.updateInterviewAnswerPlan(existing.id, { base_lock_version: existing.lock_version, answer_plan_start_at: null, answer_plan_end_at: null });
        } else if (planAt && (!existing.answer_plan_start_at || +new Date(existing.answer_plan_start_at) !== +planAt || !existing.answer_plan_end_at || +new Date(existing.answer_plan_end_at) !== +planAt + planDuration * 60000)) {
          record.session = await api.updateInterviewAnswerPlan(existing.id, { base_lock_version: existing.lock_version, answer_plan_start_at: planAt.toISOString(), duration_minutes: planDuration });
        }
      }
      onCreated(record.session.session.id, { company: companyLabel, stage: stageLabel, startAt: record.session.session.start_at });
    } catch (cause) {
      if (step === "job" && !saved.current.jobId && !(cause instanceof ApiRequestError && cause.status >= 400 && cause.status < 500)) {
        setJobResultUnknown(true);
        setError(t("岗位创建结果暂时无法确认。为避免重复创建，请先从岗位库确认并选择已创建的岗位。"));
        return;
      }
      if (step === "plan") saved.current.planNeedsRefresh = true;
      // 明确拒绝的请求可以修改；响应丢失时保持原始 payload 和幂等键，以安全确认结果。
      if (cause instanceof ApiRequestError && [400, 422, 409].includes(cause.status) && cause.message !== "INTERVIEW_EDIT_CONFLICT") {
        if (!saved.current.staged) saved.current.stagePayload = undefined;
        if (!saved.current.session) saved.current.sessionPayload = undefined;
      }
      setError(cause instanceof ApiRequestError ? cause.message === "INTERVIEW_EDIT_CONFLICT" ? t("记录已变化，请打开求职记录确认后继续。") : t("保存失败，请检查所填信息后重试。") : cause instanceof Error ? cause.message : t("保存失败，请稍后重试。"));
    } finally { submitting.current = false; setBusy(false); }
  };
const scheduleSummary = isWindow ? deadline ? t("截止前完成 · ") + (opensAt ? shortTime(opensAt) : t("现在")) + t(" 至 ") + shortTime(deadline) : t("选择截止时间") : startAt ? formatDateTimeLabel(startAt) + " · " + duration + t(" 分钟 · ") + modes.find((item) => item.value === mode)?.label : t("选择开始时间");
  const previousStages = stageType === "interview" && Number(round === "custom" ? customRound : round) > 1 ? t("投递和") + (Number(round) === 2 ? t("一面") : t("之前轮次")) + t("不补") : t("投递不补");
  const summary = [
    { title: t("岗位"), text: partial ? t("已建好") : companyLabel + " · " + roleLabel + (source === "existing" ? t("（已在岗位库）") : ""), icon: "brief" as V3IconName },
    { title: t("求职流程"), text: progress >= 2 && partial ? t("已建好，停在「") + stageLabel + "」" : t("停在「") + stageLabel + "」，" + previousStages, icon: "brief" as V3IconName },
    { title: t("这一场") + kindLabel, text: scheduleFailed ? t("没有保存上，点「重试」只会重新保存这一项") : scheduleSummary, icon: "cal" as V3IconName },
  ];
  const openRecord = () => { if (saved.current.applicationId) { onClose(); navigateTo(careerApplicationPath(saved.current.applicationId)); } };
  const recoverJob = () => { setSource("existing"); setJobPickerOpen(true); void loadJobs(); };
  const closePlan = () => setPlanOpen(false);
  return <Dialog width={720} label={t("新建求职流程")} className={"new-process-dialog" + (source === "existing" ? " np-existing" : "") + (scheduleFailed ? " np-partial" : "")} onClose={onClose} closable={!busy}>
    <header className="np-header"><h2 className="v3-dialog-title">{t("新建求职流程")}</h2><p>{t("收到笔试或面试通知，但岗位还没记录？岗位、当前阶段和这一场安排在这里一次建好。")}</p></header>
    <form onSubmit={(event) => void submit(event)}>
      <div className="np-body">
        <aside className={"np-summary" + (stageType !== "interview" ? " is-early-stage" : "")}>
          <div className="np-invite"><b>{kindLabel === t("面试") ? t("面试邀请") : kindLabel + t("通知")}</b><strong>{companyLabel} · {stageType === "written_test" ? t("在线笔试") : stageLabel}</strong><span>{isWindow ? deadline ? shortTime(deadline).slice(0, 5) + t(" 截止") : t("待安排") : startAt ? shortTime(startAt) : t("待安排")}</span><i /></div>
          <div className="np-invite-drop" />
          <div className="np-steps"><span>{t("投递")}</span><span className={stageType !== "interview" ? "is-current" : ""}>{stageType === "interview" ? t("一面") : kindLabel}</span><span className={stageType === "interview" ? "is-current" : "is-upcoming"}>{stageType === "interview" ? stageLabel : t("面试")}</span></div><div className="np-skip">{t("不用补")}</div>
          <div className="np-summary-content"><p>{partial ? t("已经完成的部分") : t("点「创建」后会建好")}</p>{summary.map((item, index) => <div className={"np-summary-row" + (partial && progress > index ? " is-saved" : "") + (scheduleFailed && index === 2 ? " is-failed" : "")} key={item.title}><i><Icon name={partial && progress > index ? "check" : scheduleFailed && index === 2 ? "refresh" : item.icon} size={14} /></i><div><strong>{item.title}</strong><p>{item.text}</p></div></div>)}</div>
          <p className="np-summary-hint">{partial ? t("也可以先关掉，之后在求职记录详情里安排这一场。") : isWindow ? t("截止前完成的") + kindLabel + t("会出现在周视图顶部「作答时段」，可以再定一个自己的作答计划。") : t("创建后卡片出现在看板「") + (stageType === "interview" || stageType === "ai_interview" ? t("面试中") : kindLabel) + t("」列，之后的轮次照常添加。")}</p>
        </aside>
        <div ref={fieldsMotionRef} className="np-main">
          <fieldset disabled={busy || progress > 0} className="np-job">
            <div className="np-section-title"><h3>{t("岗位")}</h3>{progress ? <span className="np-tag">{t("已创建")}</span> : <Segments label={t("岗位来源")} value={source} options={[{ value: "new", label: t("新岗位") }, { value: "existing", label: t("从岗位库选") }]} onChange={setSource} disabled={jobResultUnknown ? "new" : undefined} />}</div>
            {source === "new" ? <>
              <div className="np-grid"><Field label={t("公司 *")}><input aria-label={t("公司")} maxLength={200} value={company} onChange={(event) => setCompany(event.target.value)} /></Field><Field label={t("职位 *")}><input aria-label={t("职位")} maxLength={200} value={role} onChange={(event) => setRole(event.target.value)} /></Field></div>
              <button className="np-description-toggle" type="button" onClick={() => setShowDescription((current) => !current)}><Icon name="plus" size={12} />{t("粘贴岗位描述 ")}<small>{t("可选，之后在岗位详情也能补")}</small></button>
              {showDescription && <textarea aria-label={t("岗位描述")} value={description} onChange={(event) => setDescription(event.target.value)} />}
            </> : <button type="button" ref={jobAnchor} className="np-job-card" aria-label={t("已有岗位")} aria-haspopup="listbox" aria-expanded={jobPickerOpen} onClick={() => { setJobPickerOpen(true); void loadJobs(); }}>{selectedJob ? <><i>{selectedJob.logo_url ? <img src={selectedJob.logo_url} alt="" /> : selectedJob.company_name?.slice(0, 1)}</i><span><strong>{selectedJob.job_title}</strong><small>{[selectedJob.company_name, selectedJob.work_city, t("岗位库里，还没有进度")].filter(Boolean).join(" · ")}</small></span><b>{t("更换")}</b></> : <span className="np-job-placeholder">{jobsLoading ? t("正在加载岗位…") : t("从岗位库选择岗位")}</span>}<Icon name="chev" size={12} /></button>}
          </fieldset>
          <Popover anchorRef={jobAnchor} open={jobPickerOpen} onClose={() => setJobPickerOpen(false)} role="listbox" label={t("选择已有岗位")} matchWidth className="np-job-options">{availableJobs.map((job) => <button type="button" role="option" aria-selected={jobId === job.id} className="v3-menu-item" key={job.id} onClick={() => { setJobId(job.id); setJobPickerOpen(false); }}><span>{job.company_name} · {job.job_title}</span>{jobId === job.id && <Icon name="check" size={13} />}</button>)}{!availableJobs.length && <p>{jobsLoading ? t("正在加载岗位…") : t("没有可用岗位")}</p>}</Popover>
          <fieldset disabled={frozenStage} className="np-stage"><h3>{t("现在进行到哪一步")}</h3>
            <div className="np-stage-options" role="group" aria-label={t("当前阶段")}>{stages.map((stage) => <button type="button" key={stage.value} aria-pressed={stageType === stage.value} onClick={() => changeStage(stage.value)}><Icon name={stage.icon} size={16} /><span>{stage.label}</span>{stageType === stage.value && <i><Icon name="check" size={9} /></i>}</button>)}</div>
            <div className={"np-grid" + (stageType !== "interview" ? " is-single" : "")}>{stageType === "interview" && <Field label={t("轮次")}><Segments label={t("面试轮次")} value={round} options={[{ value: "1", label: t("一面") }, { value: "2", label: t("二面") }, { value: "3", label: t("三面") }, { value: "custom", label: t("自定义") }]} onChange={setRound} /></Field>}<Field label={t("投递时间")} optional={t("不记得可以留空")}><DateTimeField label={t("投递时间")} value={appliedAt} onChange={setAppliedAt} withTime={false} placeholder={t("选择日期")} /></Field></div>
            {stageType === "interview" && round === "custom" && <div className="np-grid np-custom"><Field label={t("面试轮次")}><input type="number" min={1} aria-label={t("自定义轮次")} value={customRound} onChange={(event) => setCustomRound(event.target.value)} /></Field><Field label={t("展示名称")}><input aria-label={t("自定义阶段名称")} placeholder={t("例如：交叉面")} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} /></Field></div>}
          </fieldset>
          <fieldset disabled={frozenSchedule} className={"np-schedule" + (isWindow || scheduleFailed ? " has-status" : "")}>
            <div className="np-section-title"><h3>{t("这一场安排")}</h3>{scheduleFailed ? <span className="np-tag is-warning">{t("未保存")}</span> : (stageType === "written_test" || stageType === "ai_interview") && <Segments label={t("时间安排")} value={scheduleKind} options={[{ value: "fixed_slot", label: t("按时参加") }, { value: "open_window", label: t("截止前完成") }]} onChange={setScheduleKind} />}</div>
            {!isWindow ? <div className="np-grid"><Field label={t("开始时间 *")}><DateTimeField label={t("开始时间")} value={startAt} onChange={setStartAt} /></Field><Field label={t("时长")}><div className="np-duration"><Icon name="clock" size={14} /><input type="number" aria-label={t("时长")} min={1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><span>{t("分钟")}</span></div></Field></div> : <div className="np-grid"><Field label={t("截止时间 *")}><DateTimeField label={t("截止时间")} value={deadline} onChange={setDeadline} /></Field><Field label={t("开放时间")} optional={t("不填从现在开始")}><DateTimeField label={t("开放时间")} value={opensAt} onChange={setOpensAt} placeholder={t("现在")} /></Field></div>}
          </fieldset>
          <div className="np-grid np-mode">
            {isWindow ? <fieldset disabled={busy}><Field label={t("我的作答计划")} optional={t("可选")}><button ref={planAnchor} type="button" className="np-plan-field" aria-label={t("我的作答计划")} aria-haspopup="dialog" aria-expanded={planOpen} onClick={() => { setPlanDraftAt(planAt); setPlanDraftDuration(planDuration); setPlanOpen(true); }}><Icon name="clock" size={14} /><span className={planAt ? "" : "is-placeholder"}>{planAt ? formatDateTimeLabel(planAt) + " · " + planDuration + t(" 分钟") : t("选一段时间")}</span></button></Field></fieldset> : <fieldset disabled={frozenSchedule}><Field label={t("方式")}><Segments label={t("面试方式")} value={mode} options={modes} onChange={setMode} /></Field></fieldset>}
            <fieldset disabled={frozenSchedule}><Field label={isWindow ? kindLabel + t("链接") : mode === "onsite" ? t("地点") : t("链接")} optional={t("可选")}><div className="np-meeting"><Icon name="link" size={14} /><input aria-label={isWindow ? kindLabel + t("链接") : mode === "onsite" ? t("地点") : t("链接")} value={meeting} onChange={(event) => setMeeting(event.target.value)} placeholder={isWindow ? t("粘贴") + kindLabel + t("链接") : mode === "onsite" ? t("填写面试地点") : t("粘贴会议链接")} /></div></Field></fieldset>
          </div>
          <Popover anchorRef={planAnchor} open={planOpen} onClose={closePlan} label={t("设置作答计划")} className="np-plan-popover"><Field label={t("计划作答时间")}><DateTimeField label={t("计划作答时间")} value={planDraftAt} onChange={setPlanDraftAt} min={opensAt ?? undefined} /></Field><Field label={t("时长（分钟）")}><input type="number" aria-label={t("计划时长")} min={1} value={planDraftDuration} onChange={(event) => setPlanDraftDuration(Number(event.target.value))} /></Field><div className="np-plan-actions"><button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={() => { setPlanAt(null); setPlanOpen(false); }}>{t("清除")}</button><button type="button" className="v3-btn v3-btn-dark is-sm" disabled={!planDraftAt || !Number.isInteger(planDraftDuration) || planDraftDuration < 1} onClick={() => { setPlanAt(planDraftAt); setPlanDuration(planDraftDuration); setPlanOpen(false); }}>{t("保存计划")}</button></div></Popover>
          {error && <div className={"np-error" + (scheduleFailed ? " is-visually-hidden" : "")} role="alert">{progress === 2 ? t("岗位和流程已创建，再次提交只重试排期。") : progress === 3 ? t("排期已创建，再次提交只重试作答计划。") : progress === 1 ? t("岗位已创建，再次提交会继续创建当前阶段。") : ""}{error}{jobResultUnknown && <button type="button" onClick={recoverJob}>{t("从岗位库确认")}</button>}</div>}
        </div>
      </div>
      <DialogFooter left={partial && saved.current.applicationId ? <button type="button" className="np-open-record" onClick={openRecord}>{t("打开求职记录")}<Icon name="arrow" size={12} /></button> : t("会同时创建") + (source === "new" ? t("岗位、") : "") + t("求职流程和这一场") + kindLabel}><button type="button" className="v3-btn v3-btn-ghost" disabled={busy} onClick={onClose}>{partial ? t("稍后再说") : t("取消")}</button><button type="submit" className="v3-btn v3-btn-dark" disabled={busy || jobResultUnknown && (source === "new" || !jobId)}>{busy ? t("正在保存…") : scheduleFailed ? t("重试保存排期") : progress === 3 && error ? t("重试保存计划") : progress && error ? t("重试保存") : t("创建求职流程")}</button></DialogFooter>
    </form>
  </Dialog>;
}
