import { useContentMotion } from "@/components/ui/motion";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, type ApplicationStageType, type InterviewSessionDetail, type JobApplicationRecord, type JobApplicationSummary, type JobDescriptionSummary } from "@/api/client";
import { Icon, type V3IconName } from "@/v3/Icon";
import { DateTimeField, Dialog, DialogFooter, formatDateTimeLabel, Popover, Segmented } from "@/v3/primitives";
import { careerApplicationPath, navigateTo } from "../../routing";
import "./new-process.css";

const stages: Array<{ value: ApplicationStageType; label: string; icon: V3IconName }> = [
  { value: "assessment", label: "测评", icon: "text" }, { value: "written_test", label: "笔试", icon: "edit" },
  { value: "ai_interview", label: "AI 面试", icon: "spark" }, { value: "interview", label: "面试", icon: "user" },
];
const modes = [{ value: "video", label: "视频" }, { value: "onsite", label: "现场" }, { value: "phone", label: "电话" }] as const;
function Segments<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void; disabled?: T }) {
  return <Segmented label={label} value={value} options={options.map((option) => ({ ...option, disabled: disabled === option.value }))} onChange={onChange} />;
}
function Field({ label, optional, children }: { label: string; optional?: string; children: React.ReactNode }) {
  return <div className="np-field"><div className="np-label"><span>{label.replace(" *", "")}{label.endsWith(" *") && <em>*</em>}</span>{optional && <small>{optional}</small>}</div>{children}</div>;
}
const pad = (value: number) => String(value).padStart(2, "0");
function shortTime(date: Date) { return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; }
export function NewProcessDialog({ applications, timezone, initialStartAt, initialEndAt, onClose, onCreated }: {
  applications: JobApplicationSummary[]; timezone: string; initialStartAt?: string | null; initialEndAt?: string | null;
  onClose: () => void; onCreated: (sessionId: string, info: { company: string; stage: string; startAt: string }) => void;
}) {
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
    } catch { if (mounted.current && request === loadRequest.current) setError("岗位库加载失败，请重新打开岗位选择后重试。"); }
    finally { if (mounted.current && request === loadRequest.current) setJobsLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void loadJobs(); return () => { mounted.current = false; ++loadRequest.current; }; }, [loadJobs]);
  const availableJobs = jobs.filter((job) => !applications.some((application) => application.job_description_id === job.id && (application.applied_at || application.current_stage_type !== "screening" || application.status !== "active" || application.archived_at || application.lifecycle_status === "terminated")));
  const selectedJob = jobs.find((job) => job.id === jobId);
  const companyLabel = source === "existing" ? selectedJob?.company_name ?? "选择公司" : company || "公司";
  const roleLabel = source === "existing" ? selectedJob?.job_title ?? "选择岗位" : role || "职位";
  const stageLabel = stageType === "interview" ? (round === "custom" ? customLabel.trim() || `${customRound}面` : ["", "一面", "二面", "三面"][Number(round)]) : stages.find((stage) => stage.value === stageType)!.label;
  const changeStage = (value: ApplicationStageType) => { setStageType(value); setScheduleKind(value === "assessment" ? "open_window" : "fixed_slot"); };
  const kindLabel = stageType === "interview" ? "面试" : stages.find((stage) => stage.value === stageType)!.label;
  const isWindow = scheduleKind === "open_window";
  const partial = progress > 0 && Boolean(error);
  const scheduleFailed = partial && progress === 2;
  const frozenStage = busy || progress > 1 || Boolean(saved.current.stagePayload);
  const frozenSchedule = busy || progress > 2 || Boolean(saved.current.sessionPayload);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || jobResultUnknown && source === "new") return;
    setError("");
    if (source === "new" && (!company.trim() || !role.trim()) || source === "existing" && !selectedJob) { setError("请填写公司和职位，或从岗位库选择岗位。"); return; }
    const opening = saved.current.sessionPayload ? new Date(saved.current.sessionPayload.start_at) : opensAt ?? new Date();
    if (!isWindow && (!startAt || !Number.isFinite(+startAt) || !Number.isInteger(duration) || duration < 1)) { setError("请选择开始时间并填写有效时长。"); return; }
    if (isWindow && (!deadline || !Number.isFinite(+deadline) || !Number.isFinite(+opening) || deadline <= opening)) { setError("截止时间必须晚于开放时间。"); return; }
    if (planAt && isWindow && (!Number.isFinite(+planAt) || !Number.isInteger(planDuration) || planDuration < 1 || planAt < opening || +planAt + planDuration * 60000 > +deadline!)) { setError("作答计划须完整落在开放时间与截止时间之间。"); return; }
    if (stageType === "interview" && round === "custom" && (!Number.isInteger(Number(customRound)) || Number(customRound) < 1)) { setError("请填写有效的面试轮次。"); return; }
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
        setError("岗位创建结果暂时无法确认。为避免重复创建，请先从岗位库确认并选择已创建的岗位。");
        return;
      }
      if (step === "plan") saved.current.planNeedsRefresh = true;
      // 明确拒绝的请求可以修改；响应丢失时保持原始 payload 和幂等键，以安全确认结果。
      if (cause instanceof ApiRequestError && [400, 422, 409].includes(cause.status) && cause.message !== "INTERVIEW_EDIT_CONFLICT") {
        if (!saved.current.staged) saved.current.stagePayload = undefined;
        if (!saved.current.session) saved.current.sessionPayload = undefined;
      }
      setError(cause instanceof ApiRequestError ? cause.message === "INTERVIEW_EDIT_CONFLICT" ? "记录已变化，请打开求职记录确认后继续。" : "保存失败，请检查所填信息后重试。" : cause instanceof Error ? cause.message : "保存失败，请稍后重试。");
    } finally { submitting.current = false; setBusy(false); }
  };
const scheduleSummary = isWindow ? deadline ? "截止前完成 · " + (opensAt ? shortTime(opensAt) : "现在") + " 至 " + shortTime(deadline) : "选择截止时间" : startAt ? formatDateTimeLabel(startAt) + " · " + duration + " 分钟 · " + modes.find((item) => item.value === mode)?.label : "选择开始时间";
  const previousStages = stageType === "interview" && Number(round === "custom" ? customRound : round) > 1 ? "投递和" + (Number(round) === 2 ? "一面" : "之前轮次") + "不补" : "投递不补";
  const summary = [
    { title: "岗位", text: partial ? "已建好" : companyLabel + " · " + roleLabel + (source === "existing" ? "（已在岗位库）" : ""), icon: "brief" as V3IconName },
    { title: "求职流程", text: progress >= 2 && partial ? "已建好，停在「" + stageLabel + "」" : "停在「" + stageLabel + "」，" + previousStages, icon: "brief" as V3IconName },
    { title: "这一场" + kindLabel, text: scheduleFailed ? "没有保存上，点「重试」只会重新保存这一项" : scheduleSummary, icon: "cal" as V3IconName },
  ];
  const openRecord = () => { if (saved.current.applicationId) { onClose(); navigateTo(careerApplicationPath(saved.current.applicationId)); } };
  const recoverJob = () => { setSource("existing"); setJobPickerOpen(true); void loadJobs(); };
  const closePlan = () => setPlanOpen(false);
  return <Dialog width={720} label="新建求职流程" className={"new-process-dialog" + (source === "existing" ? " np-existing" : "") + (scheduleFailed ? " np-partial" : "")} onClose={onClose} closable={!busy}>
    <header className="np-header"><h2 className="v3-dialog-title">新建求职流程</h2><p>收到笔试或面试通知，但岗位还没记录？岗位、当前阶段和这一场安排在这里一次建好。</p></header>
    <form onSubmit={(event) => void submit(event)}>
      <div className="np-body">
        <aside className={"np-summary" + (stageType !== "interview" ? " is-early-stage" : "")}>
          <div className="np-invite"><b>{kindLabel === "面试" ? "面试邀请" : kindLabel + "通知"}</b><strong>{companyLabel} · {stageType === "written_test" ? "在线笔试" : stageLabel}</strong><span>{isWindow ? deadline ? shortTime(deadline).slice(0, 5) + " 截止" : "待安排" : startAt ? shortTime(startAt) : "待安排"}</span><i /></div>
          <div className="np-invite-drop" />
          <div className="np-steps"><span>投递</span><span className={stageType !== "interview" ? "is-current" : ""}>{stageType === "interview" ? "一面" : kindLabel}</span><span className={stageType === "interview" ? "is-current" : "is-upcoming"}>{stageType === "interview" ? stageLabel : "面试"}</span></div><div className="np-skip">不用补</div>
          <div className="np-summary-content"><p>{partial ? "已经完成的部分" : "点「创建」后会建好"}</p>{summary.map((item, index) => <div className={"np-summary-row" + (partial && progress > index ? " is-saved" : "") + (scheduleFailed && index === 2 ? " is-failed" : "")} key={item.title}><i><Icon name={partial && progress > index ? "check" : scheduleFailed && index === 2 ? "refresh" : item.icon} size={14} /></i><div><strong>{item.title}</strong><p>{item.text}</p></div></div>)}</div>
          <p className="np-summary-hint">{partial ? "也可以先关掉，之后在求职记录详情里安排这一场。" : isWindow ? "截止前完成的" + kindLabel + "会出现在周视图顶部「作答时段」，可以再定一个自己的作答计划。" : "创建后卡片出现在看板「" + (stageType === "interview" || stageType === "ai_interview" ? "面试中" : kindLabel) + "」列，之后的轮次照常添加。"}</p>
        </aside>
        <div ref={fieldsMotionRef} className="np-main">
          <fieldset disabled={busy || progress > 0} className="np-job">
            <div className="np-section-title"><h3>岗位</h3>{progress ? <span className="np-tag">已创建</span> : <Segments label="岗位来源" value={source} options={[{ value: "new", label: "新岗位" }, { value: "existing", label: "从岗位库选" }]} onChange={setSource} disabled={jobResultUnknown ? "new" : undefined} />}</div>
            {source === "new" ? <>
              <div className="np-grid"><Field label="公司 *"><input aria-label="公司" maxLength={200} value={company} onChange={(event) => setCompany(event.target.value)} /></Field><Field label="职位 *"><input aria-label="职位" maxLength={200} value={role} onChange={(event) => setRole(event.target.value)} /></Field></div>
              <button className="np-description-toggle" type="button" onClick={() => setShowDescription((current) => !current)}><Icon name="plus" size={12} />粘贴岗位描述 <small>可选，之后在岗位详情也能补</small></button>
              {showDescription && <textarea aria-label="岗位描述" value={description} onChange={(event) => setDescription(event.target.value)} />}
            </> : <button type="button" ref={jobAnchor} className="np-job-card" aria-label="已有岗位" aria-haspopup="listbox" aria-expanded={jobPickerOpen} onClick={() => { setJobPickerOpen(true); void loadJobs(); }}>{selectedJob ? <><i>{selectedJob.logo_url ? <img src={selectedJob.logo_url} alt="" /> : selectedJob.company_name?.slice(0, 1)}</i><span><strong>{selectedJob.job_title}</strong><small>{[selectedJob.company_name, selectedJob.work_city, "岗位库里，还没有进度"].filter(Boolean).join(" · ")}</small></span><b>更换</b></> : <span className="np-job-placeholder">{jobsLoading ? "正在加载岗位…" : "从岗位库选择岗位"}</span>}<Icon name="chev" size={12} /></button>}
          </fieldset>
          <Popover anchorRef={jobAnchor} open={jobPickerOpen} onClose={() => setJobPickerOpen(false)} role="listbox" label="选择已有岗位" matchWidth className="np-job-options">{availableJobs.map((job) => <button type="button" role="option" aria-selected={jobId === job.id} className="v3-menu-item" key={job.id} onClick={() => { setJobId(job.id); setJobPickerOpen(false); }}><span>{job.company_name} · {job.job_title}</span>{jobId === job.id && <Icon name="check" size={13} />}</button>)}{!availableJobs.length && <p>{jobsLoading ? "正在加载岗位…" : "没有可用岗位"}</p>}</Popover>
          <fieldset disabled={frozenStage} className="np-stage"><h3>现在进行到哪一步</h3>
            <div className="np-stage-options" role="group" aria-label="当前阶段">{stages.map((stage) => <button type="button" key={stage.value} aria-pressed={stageType === stage.value} onClick={() => changeStage(stage.value)}><Icon name={stage.icon} size={16} /><span>{stage.label}</span>{stageType === stage.value && <i><Icon name="check" size={9} /></i>}</button>)}</div>
            <div className={"np-grid" + (stageType !== "interview" ? " is-single" : "")}>{stageType === "interview" && <Field label="轮次"><Segments label="面试轮次" value={round} options={[{ value: "1", label: "一面" }, { value: "2", label: "二面" }, { value: "3", label: "三面" }, { value: "custom", label: "自定义" }]} onChange={setRound} /></Field>}<Field label="投递时间" optional="不记得可以留空"><DateTimeField label="投递时间" value={appliedAt} onChange={setAppliedAt} withTime={false} placeholder="选择日期" /></Field></div>
            {stageType === "interview" && round === "custom" && <div className="np-grid np-custom"><Field label="面试轮次"><input type="number" min={1} aria-label="自定义轮次" value={customRound} onChange={(event) => setCustomRound(event.target.value)} /></Field><Field label="展示名称"><input aria-label="自定义阶段名称" placeholder="例如：交叉面" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} /></Field></div>}
          </fieldset>
          <fieldset disabled={frozenSchedule} className={"np-schedule" + (isWindow || scheduleFailed ? " has-status" : "")}>
            <div className="np-section-title"><h3>这一场安排</h3>{scheduleFailed ? <span className="np-tag is-warning">未保存</span> : stageType === "written_test" && <Segments label="时间安排" value={scheduleKind} options={[{ value: "fixed_slot", label: "按时参加" }, { value: "open_window", label: "截止前完成" }]} onChange={setScheduleKind} />}</div>
            {!isWindow ? <div className="np-grid"><Field label="开始时间 *"><DateTimeField label="开始时间" value={startAt} onChange={setStartAt} /></Field><Field label="时长"><div className="np-duration"><Icon name="clock" size={14} /><input type="number" aria-label="时长" min={1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><span>分钟</span></div></Field></div> : <div className="np-grid"><Field label="截止时间 *"><DateTimeField label="截止时间" value={deadline} onChange={setDeadline} /></Field><Field label="开放时间" optional="不填从现在开始"><DateTimeField label="开放时间" value={opensAt} onChange={setOpensAt} placeholder="现在" /></Field></div>}
          </fieldset>
          <div className="np-grid np-mode">
            {isWindow ? <fieldset disabled={busy}><Field label="我的作答计划" optional="可选"><button ref={planAnchor} type="button" className="np-plan-field" aria-label="我的作答计划" aria-haspopup="dialog" aria-expanded={planOpen} onClick={() => { setPlanDraftAt(planAt); setPlanDraftDuration(planDuration); setPlanOpen(true); }}><Icon name="clock" size={14} /><span className={planAt ? "" : "is-placeholder"}>{planAt ? formatDateTimeLabel(planAt) + " · " + planDuration + " 分钟" : "选一段时间"}</span></button></Field></fieldset> : <fieldset disabled={frozenSchedule}><Field label="方式"><Segments label="面试方式" value={mode} options={modes} onChange={setMode} /></Field></fieldset>}
            <fieldset disabled={frozenSchedule}><Field label={isWindow ? kindLabel + "链接" : mode === "onsite" ? "地点" : "链接"} optional="可选"><div className="np-meeting"><Icon name="link" size={14} /><input aria-label={isWindow ? kindLabel + "链接" : mode === "onsite" ? "地点" : "链接"} value={meeting} onChange={(event) => setMeeting(event.target.value)} placeholder={isWindow ? "粘贴" + kindLabel + "链接" : mode === "onsite" ? "填写面试地点" : "粘贴会议链接"} /></div></Field></fieldset>
          </div>
          <Popover anchorRef={planAnchor} open={planOpen} onClose={closePlan} label="设置作答计划" className="np-plan-popover"><Field label="计划作答时间"><DateTimeField label="计划作答时间" value={planDraftAt} onChange={setPlanDraftAt} min={opensAt ?? undefined} /></Field><Field label="时长（分钟）"><input type="number" aria-label="计划时长" min={1} value={planDraftDuration} onChange={(event) => setPlanDraftDuration(Number(event.target.value))} /></Field><div className="np-plan-actions"><button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={() => { setPlanAt(null); setPlanOpen(false); }}>清除</button><button type="button" className="v3-btn v3-btn-dark is-sm" disabled={!planDraftAt || !Number.isInteger(planDraftDuration) || planDraftDuration < 1} onClick={() => { setPlanAt(planDraftAt); setPlanDuration(planDraftDuration); setPlanOpen(false); }}>保存计划</button></div></Popover>
          {error && <div className={"np-error" + (scheduleFailed ? " is-visually-hidden" : "")} role="alert">{progress === 2 ? "岗位和流程已创建，再次提交只重试排期。" : progress === 3 ? "排期已创建，再次提交只重试作答计划。" : progress === 1 ? "岗位已创建，再次提交会继续创建当前阶段。" : ""}{error}{jobResultUnknown && <button type="button" onClick={recoverJob}>从岗位库确认</button>}</div>}
        </div>
      </div>
      <DialogFooter left={partial && saved.current.applicationId ? <button type="button" className="np-open-record" onClick={openRecord}>打开求职记录<Icon name="arrow" size={12} /></button> : "会同时创建" + (source === "new" ? "岗位、" : "") + "求职流程和这一场" + kindLabel}><button type="button" className="v3-btn v3-btn-ghost" disabled={busy} onClick={onClose}>{partial ? "稍后再说" : "取消"}</button><button type="submit" className="v3-btn v3-btn-dark" disabled={busy || jobResultUnknown && (source === "new" || !jobId)}>{busy ? "正在保存…" : scheduleFailed ? "重试保存排期" : progress === 3 && error ? "重试保存计划" : progress && error ? "重试保存" : "创建求职流程"}</button></DialogFooter>
    </form>
  </Dialog>;
}
