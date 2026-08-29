import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Download,
  ExternalLink,
  FileText,
  Import,
  Mic,
  Trash2,
  Video,
} from "lucide-react";
import {
  ApiRequestError,
  api,
  type ApplicationStageType,
  type InterviewAssetRecord,
  type InterviewSessionDetail,
  type InterviewSessionRecord,
  type InterviewSessionSummary,
  type JobApplicationRecord,
  type JobApplicationSummary,
} from "@/api/client";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PageLoading,
} from "@/components/ui";
import { careerApplicationPath, navigateTo } from "../../routing";
import {
  applicationStatusLabel,
  formatApplicationListDateTime,
  interviewRoundLabel,
} from "./ApplicationsBoard";

type ApplicationStageSource = Pick<
  JobApplicationRecord,
  | "id"
  | "current_stage_type"
  | "current_round_no"
  | "current_stage_label"
  | "stage_state"
  | "status"
  | "offer_status"
  | "archived_at"
  | "lock_version"
>;

type JourneyStage = {
  key: string;
  label: string;
  meta: string;
  state: "done" | "current" | "pending" | "cancelled";
};

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INTERVIEW_EDIT_CONFLICT: "这条面试已在其他页面更新，请刷新后再试。",
      INTERVIEW_INVALID_TRANSITION: "当前求职进度不允许执行这个操作。",
      INVALID_INTERVIEW_TIME: "面试开始时间需要落在整点或半点。",
      INTERVIEW_ASSET_TOO_LARGE: "素材超过 500 MiB，请压缩后重试。",
      UNSUPPORTED_INTERVIEW_ASSET: "暂不支持这种素材格式。",
      INTERVIEW_APPLICATION_NOT_EMPTY: "请先清理该求职进程下的面试记录。",
      INTERVIEW_SESSION_NOT_EMPTY: "请先删除这场面试关联的素材。",
    };
    return messages[error.message] ?? `操作失败：${error.message}`;
  }
  return "操作失败，请稍后重试。";
}

function formatFullDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatFullDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatFullDate(value)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatUpdatedDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay(date, now)) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return `昨天 ${time}`;
  return formatFullDateTime(value);
}

function snapshotText(snapshot: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function snapshotList(snapshot: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = snapshot[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
    if (typeof value === "string" && value.trim()) {
      return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function employmentTypeLabel(value: unknown): string | null {
  const labels: Record<string, string> = {
    full_time: "全职",
    part_time: "兼职",
    internship: "实习",
    contract: "合同",
    temporary: "临时",
  };
  return typeof value === "string" ? labels[value] ?? value : null;
}

function workModeLabel(value: unknown): string | null {
  const labels: Record<string, string> = {
    onsite: "现场",
    hybrid: "混合",
    remote: "远程",
  };
  return typeof value === "string" ? labels[value] ?? value : null;
}

function applicationStageStatusLabel(application: ApplicationStageSource): string {
  if (application.archived_at) return "已归档";
  if (application.status === "rejected") return "未通过";
  if (application.status === "withdrawn") return "已主动结束";
  if (application.status === "closed") {
    return application.offer_status === "accepted" ? "已接受 Offer" : "已结束";
  }
  return application.stage_state === "awaiting_schedule"
    ? "等待安排"
    : application.stage_state === "awaiting_result"
      ? "等待结果"
      : application.stage_state === "negotiating"
        ? "Offer 沟通中"
        : "进行中";
}

function applicationStatusTone(application: ApplicationStageSource): string {
  if (application.archived_at || application.status !== "active") return "is-ended";
  if (application.stage_state === "awaiting_result") return "is-warning";
  if (application.stage_state === "negotiating") return "is-offer";
  return "is-active";
}

function sessionStatusLabel(session: Pick<InterviewSessionRecord, "status" | "start_at" | "end_at">): string {
  if (session.status === "completed") return "已完成";
  if (session.status === "cancelled") return "已取消";
  const now = Date.now();
  if (new Date(session.start_at).getTime() <= now && new Date(session.end_at).getTime() > now) return "进行中";
  return "待进行";
}

function sessionStatusTone(session: Pick<InterviewSessionRecord, "status" | "start_at" | "end_at">): string {
  return session.status === "completed"
    ? "is-completed"
    : session.status === "cancelled"
      ? "is-cancelled"
      : "is-scheduled";
}

function sessionModeLabel(mode: InterviewSessionRecord["mode"]): string {
  return mode === "video"
    ? "线上"
    : mode === "onsite"
      ? "现场"
      : mode === "phone"
        ? "电话"
        : "其他方式";
}

function applicationStageMatchesSession(
  application: ApplicationStageSource,
  session: Pick<InterviewSessionRecord, "stage_type" | "round_no" | "stage_label">,
): boolean {
  if (application.current_stage_type !== session.stage_type) return false;
  if (application.current_stage_type === "interview") {
    return application.current_round_no === session.round_no;
  }
  return application.current_stage_label === session.stage_label;
}

function buildJourneyStages(
  application: JobApplicationSummary,
  sessions: InterviewSessionSummary[],
): JourneyStage[] {
  const stages: JourneyStage[] = [
    {
      key: "imported",
      label: "岗位已导入",
      meta: formatFullDate(application.created_at),
      state: "done",
    },
  ];
  if (application.applied_at) {
    stages.push({
      key: "applied",
      label: "已投递",
      meta: formatFullDate(application.applied_at),
      state: "done",
    });
  }
  const sortedSessions = [...sessions]
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
  const currentSessionIds = new Set<string>();
  sortedSessions.forEach((session) => {
    const isCurrent = applicationStageMatchesSession(application, session);
    if (isCurrent) currentSessionIds.add(session.id);
    stages.push({
      key: `session:${session.id}`,
      label: session.stage_label,
      meta: sessionStatusLabel(session),
      state: session.status === "cancelled" ? "cancelled" : isCurrent ? "current" : session.status === "completed" ? "done" : "pending",
    });
  });
  if (
    !currentSessionIds.size
    && application.current_stage_type !== "screening"
    && application.current_stage_label.trim()
  ) {
    stages.push({
      key: `stage:${application.current_stage_type}:${application.current_round_no ?? "none"}`,
      label: application.current_stage_label,
      meta: applicationStageStatusLabel(application),
      state: "current",
    });
  } else if (
    application.current_stage_type === "screening"
    && !stages.some((stage) => stage.label === application.current_stage_label)
  ) {
    stages.push({
      key: "screening",
      label: application.current_stage_label,
      meta: applicationStageStatusLabel(application),
      state: "current",
    });
  }
  if (application.status !== "active") {
    const current = stages.find((stage) => stage.state === "current");
    if (current) current.state = "cancelled";
  }
  return stages;
}

function JourneyProgress({ application, sessions }: { application: JobApplicationSummary; sessions: InterviewSessionSummary[] }) {
  const stages = buildJourneyStages(application, sessions);
  return (
    <ol className="career-journey-progress" aria-label={`当前阶段：${application.current_stage_label}`}>
      {stages.map((stage, index) => (
        <li key={stage.key} className={stage.state === "current" ? "is-current" : stage.state === "done" ? "is-done" : stage.state === "cancelled" ? "is-cancelled" : "is-pending"}>
          {index > 0 && <span className="career-journey-connector" aria-hidden="true" />}
          <span className="career-journey-node" aria-hidden="true">{stage.state === "done" ? <Check /> : stage.state === "cancelled" ? "!" : ""}</span>
          <strong>{stage.label}</strong>
          <small>{stage.meta}</small>
        </li>
      ))}
    </ol>
  );
}

function OverviewLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
    </a>
  );
}

function JobSummaryCard({ application }: { application: JobApplicationSummary }) {
  const snapshot = application.job_snapshot ?? {};
  const skills = snapshotList(snapshot, "skills", "core_skills");
  const salary = snapshotText(snapshot, "salary_text", "salary") ?? "—";
  const city = snapshotText(snapshot, "work_city", "city", "location") ?? "—";
  const employment = employmentTypeLabel(snapshot.employment_type) ?? "—";
  const workMode = workModeLabel(snapshot.work_mode);
  const description = snapshotText(snapshot, "description", "job_description") ?? "岗位描述暂未记录。";
  const requirements = snapshotText(snapshot, "requirements", "education_requirement", "experience_requirement");
  const sourceHref = application.job_description_id
    ? `/career/jobs/${encodeURIComponent(application.job_description_id)}`
    : null;
  return (
    <section className="career-detail-card career-job-summary-card">
      <header className="career-detail-card-header">
        <h2>岗位详情</h2>
        {sourceHref && <OverviewLink href={sourceHref}>查看完整岗位 <ChevronRight aria-hidden="true" /></OverviewLink>}
      </header>
      <div className="career-job-identity">
        <span>{application.company_name_snapshot}</span>
        <strong>{application.job_title_snapshot}</strong>
      </div>
      <div className="career-job-facts">
        <Fact label="薪资" value={salary} />
        <Fact label="工作地点" value={city} />
        <Fact label="岗位性质" value={[employment, workMode].filter(Boolean).join(" · ") || "—"} />
      </div>
      <div className="career-job-copy">
        <h3>职位描述</h3>
        <p>{description}</p>
      </div>
      <div className="career-job-copy">
        <h3>核心技能</h3>
        {skills.length ? <div className="career-job-tags">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : <p>暂未记录</p>}
      </div>
      <div className="career-job-copy">
        <h3>岗位要求</h3>
        <p>{requirements ?? "暂未记录"}</p>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong title={value}>{value}</strong></div>;
}

function ApplicationInfoCard({ application }: { application: JobApplicationSummary }) {
  return (
    <section className="career-detail-card career-application-info-card">
      <h2>求职信息</h2>
      <dl>
        <div><dt>当前阶段</dt><dd>{application.current_stage_label}</dd></div>
        <div><dt>当前状态</dt><dd>{applicationStageStatusLabel(application)}</dd></div>
        <div><dt>{application.applied_at ? "投递时间" : "导入时间"}</dt><dd>{formatFullDate(application.applied_at ?? application.created_at)}</dd></div>
        <div><dt>关联简历</dt><dd>{application.resume_title_snapshot ?? "暂未选择简历版本"}</dd></div>
        <div><dt>最近更新</dt><dd>{formatUpdatedDateTime(application.updated_at)}</dd></div>
        <div><dt>个人备注</dt><dd>{application.notes ?? "暂未填写"}</dd></div>
      </dl>
    </section>
  );
}

function InterviewRoundCard({ session, onOpen }: { session: InterviewSessionSummary; onOpen: () => void }) {
  const hasQuestions = Boolean(session.questions_markdown?.trim());
  const hasReview = Boolean(session.review_summary?.trim());
  const hasImprovement = Boolean(session.improvement_markdown?.trim());
  const status = sessionStatusLabel(session);
  return (
    <article className="career-interview-round-card">
      <header>
        <div>
          <h3>{session.stage_label}</h3>
          <p>{formatApplicationListDateTime(session.start_at)} · {sessionModeLabel(session.mode)}</p>
        </div>
        <span className={`career-session-status ${sessionStatusTone(session)}`}>面试 · {status}</span>
      </header>
      <dl>
        <div><dt>面试内容</dt><dd>{hasQuestions ? "已补充文字记录" : session.status === "completed" ? "尚未添加内容" : "面试结束后可上传录音"}</dd></div>
        <div><dt>面试评价</dt><dd>{hasReview ? "已填写评价" : session.status === "completed" ? "尚未填写评价" : "面试结束后填写评价"}</dd></div>
        <div><dt>面试复盘</dt><dd>{hasImprovement || hasReview ? "已补充复盘" : session.status === "completed" ? "尚未开始复盘" : "面试结束后开始复盘"}</dd></div>
      </dl>
      <button type="button" className="career-round-open" onClick={onOpen}>查看面试记录 <ChevronRight aria-hidden="true" /></button>
    </article>
  );
}

function stageTargetsForApplication(application: ApplicationStageSource): Array<{
  value: string;
  label: string;
  stageType: ApplicationStageType;
  roundNo: number | null;
  stageLabel: string;
}> {
  if (application.status !== "active" || application.archived_at || application.stage_state !== "awaiting_result") return [];
  const options: Array<{
    value: string;
    label: string;
    stageType: ApplicationStageType;
    roundNo: number | null;
    stageLabel: string;
  }> = [];
  if (application.current_stage_type === "screening") {
    options.push({ value: "interview:1", label: "进入一面", stageType: "interview", roundNo: 1, stageLabel: "一面" });
  }
  if (application.current_stage_type === "interview") {
    const nextRound = (application.current_round_no ?? 0) + 1;
    options.push({ value: `interview:${nextRound}`, label: `进入${interviewRoundLabel(nextRound)}`, stageType: "interview", roundNo: nextRound, stageLabel: interviewRoundLabel(nextRound) });
    options.push({ value: "hr", label: "进入 HR 面", stageType: "hr", roundNo: null, stageLabel: "HR 面" });
  }
  if (application.current_stage_type === "hr") {
    options.push({ value: "offer", label: "进入 Offer 沟通", stageType: "offer", roundNo: null, stageLabel: "Offer" });
  }
  return options;
}

function AddNextStageDialog({
  application,
  onClose,
  onChanged,
  onNotice,
}: {
  application: ApplicationStageSource;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const options = useMemo(() => stageTargetsForApplication(application), [application]);
  const [targetValue, setTargetValue] = useState(options[0]?.value ?? "");
  const selected = options.find((option) => option.value === targetValue) ?? options[0];
  const [stageLabel, setStageLabel] = useState(selected?.stageLabel ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTargetValue(options[0]?.value ?? "");
    setStageLabel(options[0]?.stageLabel ?? "");
  }, [options]);
  useEffect(() => {
    if (selected) setStageLabel(selected.stageLabel);
  }, [selected?.value]);
  const save = async () => {
    if (!selected || !stageLabel.trim()) return;
    setBusy(true);
    try {
      await api.advanceJobApplication(application.id, {
        target_stage_type: selected.stageType,
        target_round_no: selected.roundNo,
        target_stage_label: stageLabel.trim(),
        base_lock_version: application.lock_version,
      });
      onClose();
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-stage-dialog">
        <DialogHeader>
          <DialogTitle>添加下一阶段</DialogTitle>
          <DialogDescription>只添加已经发生或已经确认的阶段；名称按公司实际通知填写。</DialogDescription>
        </DialogHeader>
        {options.length ? (
          <div className="career-stage-dialog-form">
            <label>阶段类型<select value={targetValue} onChange={(event) => { setTargetValue(event.target.value); const next = options.find((item) => item.value === event.target.value); if (next) setStageLabel(next.stageLabel); }}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>展示名称<input value={stageLabel} maxLength={100} onChange={(event) => setStageLabel(event.target.value)} /></label>
          </div>
        ) : <p className="career-stage-dialog-empty">当前阶段还不能推进，请先完成或补充本阶段结果。</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!selected || !stageLabel.trim() || busy} onClick={() => void save()}>{busy ? "保存中…" : "保存阶段"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApplicationDetailView({
  application,
  sessions,
  onBack,
  onCreateInterview,
  onChanged,
  onNotice,
}: {
  application: JobApplicationSummary | null;
  sessions: InterviewSessionSummary[];
  onBack: () => void;
  onCreateInterview: (applicationId: string) => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!application) {
    return (
      <section className="career-detail-not-found">
        <BriefcaseBusiness aria-hidden="true" />
        <h1>无法打开这条求职进程</h1>
        <p>记录不存在、已被删除，或当前账号没有访问权限。</p>
        <Button variant="outline" onClick={onBack}>返回求职记录</Button>
      </section>
    );
  }
  const applicationSessions = sessions
    .filter((session) => session.application_id === application.id)
    .sort((left, right) => new Date(right.start_at).getTime() - new Date(left.start_at).getTime());
  const active = application.status === "active" && application.archived_at === null;
  const canSchedule = active && application.stage_state === "awaiting_schedule" && application.current_stage_type !== "offer";
  const canAdvance = active && application.stage_state === "awaiting_result";
  const canMarkApplied = active && !application.applied_at && application.current_stage_type === "screening";
  const markApplied = async () => {
    setBusy(true);
    try {
      await api.updateJobApplication(application.id, {
        applied_at: new Date().toISOString(),
        base_lock_version: application.lock_version,
      });
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const stageAction = canSchedule
    ? <Button onClick={() => onCreateInterview(application.id)}>安排当前阶段</Button>
    : canAdvance
      ? <Button onClick={() => setStageDialogOpen(true)}>添加下一阶段</Button>
      : null;
  const offerAction = active && application.current_stage_type === "offer" ? (
    <section className="career-offer-actions" aria-label="Offer 结果处理">
      <div><strong>Offer 进度</strong><span>当前：{application.offer_status === "none" ? "尚未收到 Offer" : application.offer_status === "oc_received" ? "已收到 OC" : "已收到书面 Offer"}</span></div>
      {application.offer_status === "none" && <Button size="sm" onClick={() => void recordOffer(application, "oc_received", onChanged, onNotice)}>收到 OC</Button>}
      {application.offer_status !== "written_offer_received" && <Button size="sm" variant="outline" onClick={() => void recordOffer(application, "written_offer_received", onChanged, onNotice)}>收到书面 Offer</Button>}
      {application.offer_status === "written_offer_received" && <><Button size="sm" onClick={() => void closeOffer(application, "accepted", onChanged, onNotice)}>接受 Offer</Button><Button size="sm" variant="outline" onClick={() => void closeOffer(application, "declined", onChanged, onNotice)}>婉拒 Offer</Button></>}
    </section>
  ) : null;
  return (
    <div className="career-application-detail-page">
      <header className="career-record-hero">
        <div className="career-record-identity">
          <button type="button" className="career-record-back" onClick={onBack}><ChevronLeft aria-hidden="true" />返回求职记录</button>
          <div className="career-record-title-row">
            <h1>{application.company_name_snapshot}</h1>
            <span className="career-record-divider" aria-hidden="true" />
            <h1>{application.job_title_snapshot}</h1>
            <span className={`career-application-status ${applicationStatusTone(application)}`}>{applicationStageStatusLabel(application)}</span>
          </div>
          <p>导入于 {formatFullDate(application.created_at)} · {application.applied_at ? `已投递于 ${formatFullDate(application.applied_at)}` : "尚未关联投递简历"} · 最近更新 {formatUpdatedDateTime(application.updated_at)}</p>
        </div>
        <div className="career-record-actions">
          {application.job_description_id && <OverviewLink className="career-record-secondary-action" href={`/career/jobs/${encodeURIComponent(application.job_description_id)}`}>查看岗位详情</OverviewLink>}
          {canMarkApplied && <Button disabled={busy} onClick={() => void markApplied()}>标记已投递</Button>}
          {stageAction}
        </div>
      </header>
      <div className="career-detail-body">
        <div className="career-detail-main-column">
          <section className="career-detail-card career-progress-card">
            <h2>求职进度</h2>
            <JourneyProgress application={application} sessions={applicationSessions} />
            <p className="career-progress-helper">阶段名称和结果只显示当前求职进程与已加载的面试记录。</p>
          </section>
          <section className="career-interview-rounds">
            <header><h2>面试记录</h2>{applicationSessions.length > 0 && <span>名称按公司实际流程填写</span>}</header>
            {applicationSessions.length ? (
              <div className="career-interview-round-list">
                {applicationSessions.map((session) => <InterviewRoundCard key={session.id} session={session} onOpen={() => navigateTo(careerApplicationPath(application.id, session.id))} />)}
              </div>
            ) : (
              <div className="career-interview-empty"><strong>暂无面试记录</strong><p>{canSchedule ? "安排面试后，记录每一轮面试与复盘内容。" : "公司确认面试后，再添加面试阶段并安排时间。"}</p></div>
            )}
          </section>
          {offerAction}
        </div>
        <aside className="career-detail-side-column">
          <JobSummaryCard application={application} />
          <ApplicationInfoCard application={application} />
        </aside>
      </div>
      {stageDialogOpen && <AddNextStageDialog application={application} onClose={() => setStageDialogOpen(false)} onChanged={onChanged} onNotice={onNotice} />}
    </div>
  );
}

function recordOffer(application: JobApplicationSummary, action: "oc_received" | "written_offer_received", onChanged: () => void, onNotice: (notice: string) => void) {
  return api.recordJobApplicationOffer(application.id, action, application.lock_version).then(onChanged).catch((error) => onNotice(requestErrorMessage(error)));
}

function closeOffer(application: JobApplicationSummary, action: "accepted" | "declined", onChanged: () => void, onNotice: (notice: string) => void) {
  return api.closeJobApplication(application.id, { status: "closed", offer_status: action, base_lock_version: application.lock_version }).then(onChanged).catch((error) => onNotice(requestErrorMessage(error)));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function SessionAssetList({
  assets,
  onChanged,
  onNotice,
}: {
  assets: InterviewAssetRecord[];
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const play = async (asset: InterviewAssetRecord) => {
    setBusyAssetId(asset.id);
    try {
      const blob = await api.downloadInterviewAsset(asset.id);
      const url = URL.createObjectURL(blob);
      setAudioUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusyAssetId(null);
    }
  };
  const download = async (asset: InterviewAssetRecord) => {
    setBusyAssetId(asset.id);
    try {
      const blob = await api.downloadInterviewAsset(asset.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = asset.original_file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusyAssetId(null);
    }
  };
  const remove = async (asset: InterviewAssetRecord) => {
    setBusyAssetId(asset.id);
    try {
      await api.deleteInterviewAsset(asset.id);
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusyAssetId(null);
    }
  };
  return (
    <>
      {assets.length ? <div className="career-session-assets">{assets.map((asset) => <article key={asset.id}>
        <span className="career-session-asset-icon"><FileText aria-hidden="true" /></span>
        <div><strong title={asset.original_file_name}>{asset.original_file_name}</strong><small>{formatDuration(asset.duration_ms) ?? formatBytes(asset.file_size)} · {asset.source_type === "recorded" ? "现场录制" : "文件上传"}</small></div>
        {asset.asset_type === "audio" && <Button size="sm" variant="outline" disabled={busyAssetId === asset.id} onClick={() => void play(asset)}>{busyAssetId === asset.id ? "加载中…" : "播放录音"}</Button>}
        <button type="button" aria-label={`下载 ${asset.original_file_name}`} disabled={busyAssetId === asset.id} onClick={() => void download(asset)}><Download aria-hidden="true" /></button>
        <button type="button" aria-label={`删除 ${asset.original_file_name}`} disabled={busyAssetId === asset.id} onClick={() => void remove(asset)}><Trash2 aria-hidden="true" /></button>
      </article>)}</div> : <div className="career-session-empty-content"><strong>尚未添加面试内容</strong><p>可上传音频文件，或粘贴面试文字记录。</p></div>}
      {audioUrl && <audio className="career-session-audio-player" controls autoPlay src={audioUrl} aria-label="面试录音播放器" />}
    </>
  );
}

function LiveSessionRecorder({ sessionId, onChanged, onNotice }: { sessionId: string; onChanged: () => void; onNotice: (notice: string) => void }) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const [recording, setRecording] = useState(false);
  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  const upload = async (file: File, duration: number) => {
    try {
      await api.uploadInterviewAsset(sessionId, file, "recorded", duration);
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    }
  };
  const toggle = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onNotice("当前浏览器不支持现场录音，请使用文件上传。 ");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = typeof MediaRecorder.isTypeSupported === "function"
        ? ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate))
        : undefined;
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File(chunksRef.current, `interview-${Date.now()}.${extension}`, { type });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setRecording(false);
        void upload(file, Date.now() - startedAtRef.current);
      };
      recorder.start(1_000);
      setRecording(true);
    } catch {
      onNotice("无法访问麦克风，请检查浏览器权限或改用文件上传。 ");
    }
  };
  return <button type="button" className={`career-session-recorder${recording ? " is-recording" : ""}`} onClick={() => void toggle()}><Mic aria-hidden="true" /><span>{recording ? "停止并上传" : "开始录音"}<small>{recording ? "正在采集麦克风音频" : "需要授予麦克风权限"}</small></span></button>;
}

function AddInterviewContentDialog({
  session,
  onClose,
  onChanged,
  onNotice,
}: {
  session: InterviewSessionRecord;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (notice: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!file && !text.trim()) return;
    setBusy(true);
    try {
      if (file) await api.uploadInterviewAsset(session.id, file, "uploaded");
      if (text.trim()) await api.updateInterviewSession(session.id, { questions_markdown: text.trim(), base_lock_version: session.lock_version });
      onClose();
      onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-content-dialog">
        <DialogHeader><DialogTitle>添加面试内容</DialogTitle><DialogDescription>可上传音频文件，或粘贴文字记录，任选一种即可。</DialogDescription></DialogHeader>
        <section className="career-content-upload-method">
          <h3>上传音频文件</h3>
          <div className="career-content-dropzone" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
            <Import aria-hidden="true" />
            <strong>{file ? file.name : "拖放音频文件到此处"}</strong>
            <span>{file ? `${formatBytes(file.size)} · 已选择` : "或从电脑中选择文件"}</span>
            <Button type="button" variant="outline" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}>选择文件</Button>
          </div>
          <input ref={inputRef} className="visually-hidden" type="file" accept="audio/*,video/*,.pdf,.docx,.txt,.md" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </section>
        <div className="career-content-or"><span>或</span></div>
        <section className="career-content-text-method">
          <h3>粘贴文字记录</h3>
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="粘贴面试过程、逐字稿或整理后的文字记录…" />
        </section>
        <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy || (!file && !text.trim())} onClick={() => void save()}>{busy ? "保存中…" : "保存内容"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteInterviewDialog({
  session,
  questions,
  review,
  improvement,
  onClose,
  onCompleted,
  onNotice,
}: {
  session: InterviewSessionRecord;
  questions: string;
  review: string;
  improvement: string;
  onClose: () => void;
  onCompleted: () => void;
  onNotice: (notice: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const complete = async () => {
    setBusy(true);
    try {
      await api.completeInterviewSession(session.id, {
        questions_markdown: questions.trim() || null,
        review_summary: review.trim() || null,
        improvement_markdown: improvement.trim() || null,
        base_lock_version: session.lock_version,
      });
      onClose();
      onCompleted();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="career-complete-dialog">
        <DialogHeader><DialogTitle>完成{session.stage_label}</DialogTitle><DialogDescription>完成后可以继续添加录音、面试评价和复盘。</DialogDescription></DialogHeader>
        <div className="career-complete-summary"><strong>{session.stage_label}</strong><span>{formatFullDateTime(session.start_at)} · {sessionModeLabel(session.mode)}</span></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy} onClick={() => void complete()}>{busy ? "处理中…" : "完成本轮面试"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InterviewSessionDetailView({
  detail,
  detailLoading,
  onBack,
  onChanged,
  onNotice,
}: {
  detail: InterviewSessionDetail | null;
  detailLoading: boolean;
  onBack: () => void;
  onChanged: (preferredId?: string | null) => void;
  onNotice: (notice: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [questions, setQuestions] = useState("");
  const [review, setReview] = useState("");
  const [improvement, setImprovement] = useState("");
  const [showContentDialog, setShowContentDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [pendingLifecycle, setPendingLifecycle] = useState<"cancel" | "archive" | "restore" | "delete-session" | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  useEffect(() => {
    if (!detail) return;
    setQuestions(detail.session.questions_markdown ?? "");
    setReview(detail.session.review_summary ?? "");
    setImprovement(detail.session.improvement_markdown ?? "");
    setEditing(false);
  }, [detail?.session.id, detail?.session.lock_version]);
  if (!detail) return <section className="career-session-detail-loading">{detailLoading ? <PageLoading label="正在加载面试记录…" scope="panel" /> : <p>暂时无法读取这条面试记录。</p>}</section>;
  const { session, application, assets } = detail;
  const isArchived = application.archived_at !== null;
  const saveEdits = async () => {
    try {
      await api.updateInterviewSession(session.id, {
        questions_markdown: questions.trim() || null,
        review_summary: review.trim() || null,
        improvement_markdown: improvement.trim() || null,
        base_lock_version: session.lock_version,
      });
      setEditing(false);
      onChanged(session.id);
    } catch (error) {
      onNotice(requestErrorMessage(error));
    }
  };
  const runLifecycle = async () => {
    if (!pendingLifecycle) return;
    setLifecycleBusy(true);
    try {
      if (pendingLifecycle === "cancel") {
        await api.cancelInterviewSession(session.id, { base_lock_version: session.lock_version });
        setPendingLifecycle(null);
        onChanged(session.id);
      } else if (pendingLifecycle === "archive") {
        await api.archiveJobApplication(application.id, application.lock_version);
        setPendingLifecycle(null);
        onChanged(session.id);
      } else if (pendingLifecycle === "restore") {
        await api.restoreJobApplication(application.id, application.lock_version);
        setPendingLifecycle(null);
        onChanged(session.id);
      } else {
        await api.deleteInterviewSession(session.id);
        setPendingLifecycle(null);
        onChanged(null);
        onBack();
      }
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setLifecycleBusy(false);
    }
  };
  const lifecycleDialog = pendingLifecycle ? {
    kind: pendingLifecycle === "delete-session" ? "delete" as const : "warning" as const,
    title: pendingLifecycle === "cancel" ? "取消这场面试？" : pendingLifecycle === "archive" ? "归档这条求职进程？" : pendingLifecycle === "restore" ? "恢复这条求职进程？" : "永久删除这场面试记录？",
    description: pendingLifecycle === "cancel" ? "该场次会保留在记录复盘中，并从当前排期退出；求职进程回到待安排状态。" : pendingLifecycle === "archive" ? "归档后会从默认求职进程和排期中隐藏，历史面试与复盘仍会保留。" : pendingLifecycle === "restore" ? "恢复后，这条仍在进行的求职进程会重新进入默认求职进程列表。" : "删除后不可恢复。若存在关联素材，系统会拒绝删除并保留原记录。",
    confirmLabel: pendingLifecycle === "cancel" ? "确认取消" : pendingLifecycle === "archive" ? "确认归档" : pendingLifecycle === "restore" ? "确认恢复" : "永久删除",
  } : null;
  return (
    <div className="career-session-detail-page">
      <header className="career-record-hero career-session-record-hero">
        <div className="career-record-identity">
          <button type="button" className="career-record-back" onClick={onBack}><ChevronLeft aria-hidden="true" />返回求职记录</button>
          <div className="career-record-title-row">
            <h1>{session.stage_label}</h1>
            <span className="career-record-divider" aria-hidden="true" />
            <h1>面试记录</h1>
            <span className={`career-session-status career-session-hero-status ${sessionStatusTone(session)}`}>{sessionStatusLabel(session)}</span>
          </div>
          <p>{application.company_name_snapshot} · {application.job_title_snapshot} · {formatFullDateTime(session.start_at)} · {sessionModeLabel(session.mode)}</p>
        </div>
        <div className="career-record-actions">
          {!isArchived && <Button variant="outline" onClick={() => setEditing((value) => !value)}>{editing ? "取消编辑" : "编辑记录"}</Button>}
          {!isArchived && session.status === "scheduled" && <Button onClick={() => setShowCompleteDialog(true)}>完成本轮面试</Button>}
          {!isArchived && session.status === "scheduled" && <Button variant="outline" onClick={() => setPendingLifecycle("cancel")}>取消面试</Button>}
          <Button variant="outline" onClick={() => setPendingLifecycle(isArchived ? "restore" : "archive")}>{isArchived ? "恢复进程" : "归档进程"}</Button>
          <Button variant="ghost" onClick={() => setPendingLifecycle("delete-session")}>删除记录</Button>
        </div>
      </header>
      <div className="career-session-detail-body">
        <section className="career-session-record-content">
          <header className="career-session-content-header"><h2>面试概况</h2><span>最后更新：{formatUpdatedDateTime(session.updated_at)}</span></header>
          <div className="career-session-overview">
            <div><span>面试轮次</span><strong>{session.stage_label}</strong></div>
            <div><span>面试时间</span><strong>{formatFullDateTime(session.start_at)}</strong></div>
            <div><span>面试方式</span><strong>{sessionModeLabel(session.mode)}{session.location ? ` · ${session.location}` : ""}</strong></div>
          </div>
          {session.meeting_url && <a className="career-session-meeting-link" href={session.meeting_url} target="_blank" rel="noreferrer"><Video aria-hidden="true" />打开会议链接 <ExternalLink aria-hidden="true" /></a>}
          <section className="career-session-content-section">
            <header><h2>面试内容</h2><Button size="sm" onClick={() => setShowContentDialog(true)}>添加面试内容</Button></header>
            <SessionAssetList assets={assets} onChanged={() => onChanged(session.id)} onNotice={onNotice} />
            {questions.trim() && <div className="career-session-transcript"><h3>文字记录</h3><p>{questions}</p></div>}
            <LiveSessionRecorder sessionId={session.id} onChanged={() => onChanged(session.id)} onNotice={onNotice} />
          </section>
          <section className="career-session-review-section">
            <header><h2><CircleCheck aria-hidden="true" />面试评价与复盘</h2></header>
            {editing ? <div className="career-session-edit-fields"><label>题目记录<textarea value={questions} onChange={(event) => setQuestions(event.target.value)} /></label><label>复盘总结<textarea value={review} onChange={(event) => setReview(event.target.value)} /></label><label>需要改进<textarea value={improvement} onChange={(event) => setImprovement(event.target.value)} /></label><Button onClick={() => void saveEdits()}>保存记录</Button></div> : <div className="career-session-review-grid"><div><span>面试评价</span><p>{review || "尚未填写评价"}</p></div><div><span>面试复盘</span><p>{improvement || "尚未开始复盘"}</p></div></div>}
          </section>
          {!isArchived && application.status === "active" && application.stage_state === "awaiting_result" && <section className="career-session-stage-action"><div><strong>本轮面试已完成</strong><span>确认结果后再进入下一阶段，求职进度会随之更新。</span></div><Button onClick={() => setStageDialogOpen(true)}>添加下一阶段</Button><Button variant="outline" onClick={() => void closeApplicationAsRejected(application, onChanged, onNotice)}>未通过</Button></section>}
        </section>
      </div>
      {showContentDialog && <AddInterviewContentDialog session={session} onClose={() => setShowContentDialog(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}
      {showCompleteDialog && <CompleteInterviewDialog session={session} questions={questions} review={review} improvement={improvement} onClose={() => setShowCompleteDialog(false)} onCompleted={() => onChanged(session.id)} onNotice={onNotice} />}
      {stageDialogOpen && <AddNextStageDialog application={application} onClose={() => setStageDialogOpen(false)} onChanged={() => onChanged(session.id)} onNotice={onNotice} />}
      {lifecycleDialog && <ConfirmDialog kind={lifecycleDialog.kind} title={lifecycleDialog.title} description={lifecycleDialog.description} confirmLabel={lifecycleDialog.confirmLabel} busyLabel="正在处理…" busy={lifecycleBusy} onCancel={() => setPendingLifecycle(null)} onConfirm={() => void runLifecycle()} />}
    </div>
  );
}

function closeApplicationAsRejected(application: JobApplicationRecord, onChanged: () => void, onNotice: (notice: string) => void) {
  return api.closeJobApplication(application.id, { status: "rejected", base_lock_version: application.lock_version }).then(onChanged).catch((error) => onNotice(requestErrorMessage(error)));
}
