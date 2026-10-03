import { t, useLocale, weekdayName, weekdays } from "@/i18n";
import { MotionPresence } from "@/components/ui/motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiRequestError, type JobApplicationSummary, type InterviewSessionSummary, type InterviewSessionDetail, type ResumeSummary } from "@/api/client";
import { Icon } from "@/v3/Icon";
import { BeTag, Dialog, Menu, Popover, PageEyebrow, type EyebrowSegment } from "@/v3/primitives";
import { Bar, MiniResume, Paper } from "@/v3/art";
import { careerApplicationPath, editorPath, jobDetailPath, navigateTo } from "@/routing";
import { projectApplicationProgress } from "./applicationProgress";
import { formatOfferDate, offerDeadline } from "./offerDates";
import playerArt from "./v3-assets/player.svg";
import "./careerDetailsV3.css";

const date = (value: string | null | undefined) => value ? new Date(value) : null;
const shortDate = (value: string | null | undefined) => { const d = date(value); return d ? `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "—"; };
const time = (value: string | null | undefined) => { const d=date(value); return d ? `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` : "—"; };
const stamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;
const text = (snapshot: Record<string, unknown>, ...keys: string[]) => keys.map(k => snapshot[k]).find(v=>typeof v === "string" && v) as string | undefined;
const reviewLabel = (session: InterviewSessionSummary) => session.review_stale ? t("记录已修改，待重新生成")
  : session.review_status === "generating" ? t("正在生成…")
  : session.review_report ? session.review_report.overall_score != null ? t("复盘 {value0}", { value0: session.review_report.overall_score }) : t("已复盘")
  : session.review_status === "failed" ? t("生成失败") : t("待复盘");

export function CareerDetailHeader({ eyebrow, title, subtitle, actions, badge = false, accessibleTitle }: { eyebrow: EyebrowSegment[]; title: ReactNode; subtitle: ReactNode; actions?: ReactNode; badge?: boolean; accessibleTitle?: string }) {
  useLocale();
  return <header className="cd3-head"><PageEyebrow className="cd3-eyebrow" segments={eyebrow} /><h1 aria-label={accessibleTitle}>{title}{badge && <BeTag />}</h1><p>{subtitle}</p><div className="cd3-head-actions">{actions}</div></header>;
}

export function ApplicationV3Content({ application, sessions, currentSession, primaryLabel, onPrimary, onBack, onTerminate, onDelete, onNotice, onChanged }: {
  application: JobApplicationSummary; sessions: InterviewSessionSummary[]; currentSession?: InterviewSessionSummary; primaryLabel: string; onPrimary: () => void; onBack: () => void; onTerminate?: () => void; onDelete?: () => void; onNotice: (message: string) => void; onChanged: () => void | Promise<void>;
}) {
  useLocale();
  const p = projectApplicationProgress(application);
  const [menuOpen,setMenuOpen]=useState(false);
  const menuRef=useRef<HTMLButtonElement>(null);
  const [audioTitle,setAudioTitle]=useState<string | null>(null);
  const [resumes,setResumes]=useState<ResumeSummary[]>([]);
  const [resumeOpen,setResumeOpen]=useState(false);
  const [resumeBusy,setResumeBusy]=useState(false);
  const resumeRef=useRef<HTMLButtonElement>(null);
  const selectResume=async()=>{setResumeOpen(true);setResumeBusy(true);try{setResumes((await api.listResumes()).resumes);}catch{setResumeOpen(false);onNotice(t("简历列表加载失败，请稍后重试。"));}finally{setResumeBusy(false);}};
  const linkResume=async(resume:ResumeSummary)=>{if(resumeBusy)return;setResumeBusy(true);try{await api.updateJobApplication(application.id,{resume_id:resume.id,base_lock_version:application.lock_version});setResumeOpen(false);await onChanged();}catch{onNotice(t("关联简历失败，请稍后重试。"));}finally{setResumeBusy(false);}};
  const lastRecorded=sessions.find(s=>s.status==="completed");
  useEffect(()=>{let live=true;setAudioTitle(null);if(lastRecorded)void api.getInterviewSession(lastRecorded.id).then(r=>{if(live)setAudioTitle(r.assets.find(a=>a.asset_type==="audio")?.original_file_name??null);}).catch(()=>{});return ()=>{live=false};},[lastRecorded?.id]);
  const waiting=(p.isWaiting || currentSession?.status==="completed") && p.columnKey!=="offer" && p.columnKey!=="ended";
  const ended=p.columnKey==="ended";
  const offer=p.columnKey==="offer";
  const replyDeadline=offerDeadline(application.offer_reply_due_on,new Date());
  const d=offer ? replyDeadline?.date ?? new Date() : date(currentSession?.start_at ?? application.updated_at) ?? new Date();
  const waitDays=currentSession?Math.max(0,Math.floor((Date.now()-new Date(currentSession.end_at).getTime())/86400000)):0;
  const minutesToStart=currentSession?Math.max(0,Math.floor((new Date(currentSession.start_at).getTime()-Date.now())/60000)):0;
  const heroMeta=ended?`${currentSession?.stage_label??p.stageLabel}${application.status==="rejected"?t("未通过"):t("已结束")} · ${shortDate(application.updated_at)}`:offer?replyDeadline?t("Offer · {value0} 截止回复", { value0: formatOfferDate(application.offer_reply_due_on) }):t("回复截止待填写"):waiting?t("{value0}已结束 · 等待 {value1} 天", { value0: p.stageLabel, value1: waitDays }):currentSession?`${sameDay(currentSession.start_at)?t("今天"):shortDate(currentSession.start_at)} ${time(currentSession.start_at)}${minutesToStart?t(" · 还有 {value0} 小时 {value1} 分", { value0: Math.floor(minutesToStart/60), value1: minutesToStart%60 }):""}`:p.statusLabel;
  const steps=application.stages ?? [];
  const timeline=[...steps].sort((a,b)=>b.sequence_no-a.sequence_no).map(stage=>{
    const s=sessions.find(s=>s.application_stage_id===stage.id || (!s.application_stage_id && s.stage_label===stage.stage_label));
    return {id:stage.id,label:stage.stage_type==="screening"?t("简历筛选"):stage.stage_label,at:s?.start_at??stage.entered_at,session:s,state:s?.status==="cancelled"?"cancelled":stage.stage_status==="completed"||s?.status==="completed"?"done":"current",meta:s ? s.status==="completed" ? `${s.round_result==="passed"?t("已通过"):t("已完成")} · ${reviewLabel(s)}` : t("{value0} · 待面试", { value0: s.mode==="video"?t("视频面试"):s.mode==="onsite"?t("现场面试"):t("待面试") }) : stage.stage_status==="completed"?t("已通过"):t("等待通知")};
  });
  if(!timeline.length) sessions.forEach(s=>timeline.push({id:s.id,label:offer&&s.stage_type==="offer"?t("已收到 Offer"):s.stage_label,at:s.start_at,session:s,state:s.status==="completed"?"done":"current",meta:s.status==="completed"?`${t("已完成")} · ${reviewLabel(s)}`:t("待面试")}));
  if(!timeline.length && !p.isPending) timeline.push({id:"current",label:p.stageLabel,at:application.updated_at,session:undefined,state:ended?"ended":"current",meta:p.statusLabel});
  timeline.push({id:"applied",label:application.applied_at?t("投递"):t("岗位已导入"),at:application.applied_at??application.created_at,session:undefined,state:"past",meta:application.applied_at?t("已投递"):t("待投递")});
  const elapsed=Math.max(1,Math.ceil((Date.now()-new Date(application.applied_at??application.created_at).getTime())/86400000));
  const snapshot=application.job_snapshot;
  const openJob=()=>application.job_description_id ? navigateTo(jobDetailPath(application.job_description_id,application.id)) : onNotice(t("原岗位资料已不可用。"));
  const subtitle=[snapshot.employment_type==="full_time"?t("正式"):snapshot.employment_type==="campus"?t("校招"):snapshot.employment_type==="internship"?t("实习"):null,text(snapshot,"work_city","city","location"),text(snapshot,"salary_text","salary")].filter(Boolean).join(" · ") || t("岗位信息待补充");
  const heroTitle=offer?t("收到 Offer"):ended?application.status==="rejected"?t("这次没有通过"):t("这次求职已结束"):waiting?t("等待面试结果"):p.isPending?t("准备投递"):currentSession?.stage_label??p.stageLabel;
  const preparationLabel=currentSession?.status==="scheduled"&&!waiting&&!ended&&!offer
    ? (currentSession.prep_total??0)>0 ? `${t("准备清单")} ${currentSession.prep_done??0}/${currentSession.prep_total}` : t("未生成准备清单")
    : null;
  const heroSub=offer?[application.offer_salary?`${application.offer_salary} ${application.offer_salary_currency??"CNY"}`:null,application.offer_base_location,formatOfferDate(application.offer_received_on)?t("{value0} 收到",{value0:formatOfferDate(application.offer_received_on)}):null,formatOfferDate(application.offer_start_on)?t("预计 {value0} 入职",{value0:formatOfferDate(application.offer_start_on)}):t("入职时间待定")].filter(Boolean).join(" · "):ended?t("复盘会帮你整理这几轮暴露的问题，下一次面试前看看。"):waiting?t("通常 3–5 个工作日内会收到通知。有新进展时在这里添加下一轮。"):currentSession?[currentSession.mode==="video"?t("视频面试"):currentSession.mode==="onsite"?t("现场面试"):t("电话面试"),currentSession.interviewer_name?t("面试官 {value0} {value1}", { value0: currentSession.interviewer_title??"", value1: currentSession.interviewer_name }):null,t("约 {value0} 分钟", { value0: Math.round((new Date(currentSession.end_at).getTime()-d.getTime())/60000) })].filter(Boolean).join(" · "):p.isPending?t("关联一份简历后投递，之后每一轮面试都记在这里。"):t("收到通知后，可以安排时间或添加下一阶段。");
  const emptyResources=p.isPending && !application.resume_id && !lastRecorded;
  const resourceCount=Number(Boolean(application.job_description_id))+Number(Boolean(application.resume_id))+Number(Boolean(lastRecorded));
  return <div className="cd3-page">
    <CareerDetailHeader eyebrow={[{ label: "JOBS", onClick: onBack, ariaLabel: t("返回岗位看板") }, application.company_name_snapshot, t("第 {value0} 天", { value0: elapsed })]} title={application.job_title_snapshot} accessibleTitle={`${application.company_name_snapshot}，${application.job_title_snapshot}`} subtitle={subtitle} actions={<><button onClick={openJob}>{t("岗位详情")}</button><button ref={menuRef} onClick={()=>setMenuOpen(!menuOpen)}>{t("编辑")}</button><Menu anchorRef={menuRef} open={menuOpen} onClose={()=>setMenuOpen(false)} items={[{label:t("编辑岗位"),onSelect:openJob},...(onTerminate?[{label:t("终止求职"),onSelect:onTerminate,danger:true}]:[]),...(onDelete?[{label:t("删除岗位"),onSelect:onDelete,danger:true}]:[])]}/></>} />
    <section className={`cd3-current ${ended?"is-ended":offer?"is-offer":p.isPending?"is-pending":""}`} aria-label={t("当前阶段")}>
      <div className="cd3-stage-art"><div className="cd3-date-tile"><small>{offer&&!replyDeadline?"—":<>{d.getMonth()+1}{t(" 月 · 周")}{t("日一二三四五六")[d.getDay()]}</>}</small><strong>{offer&&!replyDeadline?"—":waiting?"…":d.getDate()}</strong><span>{waiting?t("等待中"):offer?replyDeadline?t("截止"):t("待填写"):currentSession?time(currentSession.start_at):time(application.updated_at)}</span></div>{!waiting&&!offer&&!ended&&!p.isPending&&<span className="cd3-date-badge"><Icon name="play" size={16}/></span>}</div>
      <div className="cd3-current-copy"><small>{ended?t("已结束"):t("当前阶段")} · {heroMeta}</small><h2>{heroTitle}</h2><p>{heroSub}</p><footer><div className="cd3-step-lines" aria-hidden="true">{Array.from({length:6},(_,i)=><i key={i} className={i===Math.min(5,timeline.length-1)?"is-current":""}/>)}</div><span>{t("第 ")}{offer?6:timeline.length} / {Math.max(6,timeline.length)}{t(" 步")}{!p.isPending&&(ended||offer||preparationLabel)&&` · ${ended?t("已结束"):offer?replyDeadline?.label??t("回复截止待填写"):preparationLabel}`}</span><button className="v3-btn v3-btn-dark is-sm" onClick={onPrimary}>{p.isPending?t("添加求职阶段"):waiting?t("添加下一轮"):primaryLabel}<Icon name="arrow" size={12}/></button></footer></div>
    </section>
    <section className="cd3-timeline"><header><h2>{t("求职进度")}</h2><span>{timeline.length}{t(" 条记录")}</span></header><ol aria-label={t("当前阶段：{value0}", { value0: p.stageLabel })}>{timeline.map(row=><li key={row.id} className={`is-${row.state}`}><i aria-hidden="true"/><time>{shortDate(row.at)}</time><strong>{row.label}</strong><span>{row.session ? row.meta : row.id === "applied" && Boolean(application.applied_at) ? [text(snapshot,"source_platform"),application.job_title_snapshot,application.company_name_snapshot].filter(Boolean).join(" · ") : ""}</span>{row.session?<button onClick={()=>navigateTo(row.session!.status === "completed" ? `/career/reviews?session=${encodeURIComponent(row.session!.id)}&application=${encodeURIComponent(application.id)}` : careerApplicationPath(application.id,row.session!.id))}>{row.session.status==="completed"?t("查看复盘"):sameDay(row.at)?t("今天"):t("查看安排")}</button>:<small>{row.meta}</small>}</li>)}</ol></section>
    <section className="cd3-resources"><header><h2>{t("关联资料")}</h2>{!emptyResources&&<span>{resourceCount}{t(" 个")}</span>}</header>{emptyResources?<div className="cd3-resource-empty"><div className="cd3-resource-empty-art"><span className="cd3-resource-slot"><Icon name="plus" size={20}/></span><i/><Paper x={140} y={30} w={76} h={104} r={5}><Bar x={9} y={11} w={40} h={6} color="var(--v3-txt)"/>{[23,33,43,57,67,77].map((y,i)=><Bar key={y} x={9} y={y} w={i%3===2?36:56} h={4}/>)}<span className="cd3-resource-jd">JD</span></Paper></div><div className="cd3-resource-empty-copy"><h2>{t("还没有关联简历和资料")}</h2><p>{t("关联投递用的简历和岗位 JD 后，AI 准备面试时会用到它们。")}</p><div><button ref={resumeRef} className="v3-btn" onClick={()=>void selectResume()}><Icon name="doc" size={13}/>{t("关联简历")}</button><button className="v3-btn v3-btn-text" onClick={()=>navigateTo("/datasets")}>{t("从资料库选择")}</button></div></div><Popover anchorRef={resumeRef} open={resumeOpen} onClose={()=>{if(!resumeBusy)setResumeOpen(false);}} label={t("选择关联简历")} className="cd3-resume-picker">{resumeBusy?<p>{t("正在加载…")}</p>:resumes.length?resumes.map(resume=><button key={resume.id} onClick={()=>void linkResume(resume)}><Icon name="doc" size={14}/>{resume.title}</button>):<p>{t("还没有简历，")}<a href="/resumes">{t("去创建简历")}</a></p>}</Popover></div>:<div className="cd3-resource-grid">
      {application.job_description_id&&<button className="cd3-file" onClick={openJob}><div className="cd3-file-art"><Paper x={96} y={16} w={68} h={88} r={6}><Bar x={9} y={11} w={30} h={4} color="var(--v3-txt)"/>{[23,32,41,50,59].map(y=><Bar key={y} x={9} y={y} w={48} h={3}/>)}</Paper><span className="cd3-md">MD</span></div><strong>{t("岗位 JD · ")}{application.company_name_snapshot}_{application.job_title_snapshot}.md</strong><small>{t("岗位资料 · ")}{shortDate(application.created_at)}</small></button>}
      {application.resume_id&&<button className="cd3-file" onClick={()=>navigateTo(editorPath(application.resume_id!))}><div className="cd3-file-art"><MiniResume x={96} y={14} w={68} h={98}/></div><strong>{application.resume_title_snapshot??t("投递简历")}</strong><small>{t("简历 · ")}{shortDate(application.updated_at)}</small></button>}
      {lastRecorded&&<button className="cd3-file" onClick={()=>navigateTo(`/career/reviews?session=${encodeURIComponent(lastRecorded.id)}&application=${encodeURIComponent(application.id)}`)}><div className="cd3-file-art"><img src={playerArt} alt="" /></div><strong>{audioTitle??t("{value0} · 面试记录", { value0: lastRecorded.stage_label })}</strong><small>{t("录音与记录 · ")}{shortDate(lastRecorded.start_at)}</small></button>}
    </div>}</section>
  </div>;
}
function sameDay(value:string){return new Date(value).toDateString()===new Date().toDateString();}

export function ReviewV3Content({ detail, onBack, onUpload, onText, onNotice, recordContent, onChanged }: {
  detail: InterviewSessionDetail; onBack: () => void; onUpload: () => void; onText: () => void;
  onNotice: (message: string) => void; recordContent: ReactNode; onChanged?: () => void | Promise<void>;
}) {
  useLocale();
  const [session, setSession] = useState(detail.session);
  const [busy, setBusy] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [targets, setTargets] = useState<InterviewSessionSummary[]>([]);
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const attempt = useRef<{ id: string; version: number } | null>(null);
  const activeId = useRef(detail.session.id);
  activeId.current = detail.session.id;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSession(detail.session); }, [detail.session]);
  useEffect(() => { attempt.current = null; setBusy(false); setSelected(0); setTargets([]); setTargetId(""); setAudioUrl(null); setPlayhead(0); setDuration(0); }, [detail.session.id]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const generating = session.review_status === "generating";
  const report = session.review_report;
  const hasText = Boolean(session.questions_markdown?.trim());
  const audio = detail.assets.find(item => item.asset_type === "audio");
  const tooLong = (session.questions_markdown?.trim().length ?? 0) > 50_000;
  const canGenerate = hasText && !tooLong && !detail.application.archived_at;
  const [now, setNow] = useState(Date.now());
  const interrupted = generating && Boolean(session.review_started_at) && now - Date.parse(session.review_started_at!) >= 180_000;
  useEffect(() => {
    if (!generating) return;
    let live = true;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void api.getInterviewSession(session.id).then(result => { if (live) setSession(result.session); }).catch(() => {});
    }, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [session.id, generating]);
  const generate = async () => {
    if (busy || !canGenerate || (generating && !interrupted)) return;
    const id = session.id;
    const request = attempt.current ?? { id: crypto.randomUUID(), version: session.lock_version };
    attempt.current = request;
    setBusy(true);
    try {
      const result = await api.generateInterviewReview(id, { request_id: request.id, base_lock_version: request.version });
      if (!mounted.current || activeId.current !== id) return;
      setSession(result.session);
      if (result.session.review_status !== "generating") attempt.current = null;
      if (result.session.review_status === "failed") onNotice(t("复盘生成失败，原记录和已有报告已保留。"));
      await onChanged?.();
    } catch (error) {
      if (!mounted.current || activeId.current !== id) return;
      const latest = await api.getInterviewSession(id).catch(() => null);
      if (!mounted.current || activeId.current !== id) return;
      if (latest) { setSession(latest.session); if (latest.session.review_request_id === request.id && latest.session.review_status !== "generating") attempt.current = null; }
      // Unknown transport results keep the original request so retry cannot create a second generation.
      if (error instanceof ApiRequestError && [400, 401, 404, 409].includes(error.status)) attempt.current = null;
      onNotice(error instanceof ApiRequestError && error.message === "LLM_MODEL_NOT_CONFIGURED"
        ? t("请先配置模拟面试的 AI 模型，再生成复盘。") : t("复盘生成失败，原记录和已有报告已保留。"));
    } finally { if (mounted.current && activeId.current === id) setBusy(false); }
  };
  const loadTargets = async () => {
    setSaving(true);
    try {
      const id = session.id;
      const result = await api.listInterviewSessions({ application_id: detail.application.id, status: "scheduled" });
      if (!mounted.current || activeId.current !== id) return;
      setTargets(result.items.filter(item => item.id !== session.id));
      setTargetId("");
      if (!result.items.length) onNotice(t("请先为这个岗位安排下一轮面试。"));
    } catch { onNotice(t("准备清单加载失败，请稍后重试。")); }
    finally { setSaving(false); }
  };
  const question = report?.questions[selected];
  const savePreparation = async () => {
    if (!targetId || !question || saving) return;
    setSaving(true);
    try {
      const target = (await api.getInterviewSession(targetId)).session;
      const title = question.question.slice(0, 80);
      if (target.status !== "scheduled") throw new Error("target changed");
      if (target.prep_items.some(item => item.title === title)) { onNotice(t("这个问题已在准备清单中。")); return; }
      if (target.prep_items.length >= 12) { onNotice(t("准备清单已满，请先整理已有事项。")); return; }
      const note = [target.preparation_note, `## ${session.stage_label} · Q${selected + 1}\n${question.question}\n\n${question.suggested_answer || question.improvement || ""}`].filter(Boolean).join("\n\n");
      if (note.length > 100_000) throw new Error("preparation note full");
      await api.updateInterviewSession(targetId, { preparation_note: note, base_lock_version: target.lock_version, prep_items: [...target.prep_items,
        { id: crypto.randomUUID(), title, category: "technical", reason: (question.improvement || question.suggested_answer || question.evidence).slice(0, 200), done: false }] });
      onNotice(t("已保存到下一轮准备清单。"));
      setTargetId("");
    } catch { onNotice(t("准备清单保存失败，请刷新后重试。")); }
    finally { setSaving(false); }
  };
  const play = async () => {
    if (!audio) return;
    if (audioRef.current) {
      if (audioRef.current.paused) void audioRef.current.play().catch(() => onNotice(t("录音暂时无法播放，请稍后重试。")));
      else audioRef.current.pause();
      return;
    }
    try { const blob = await api.downloadInterviewAsset(audio.id); if (mounted.current && activeId.current === session.id) setAudioUrl(URL.createObjectURL(blob)); }
    catch { onNotice(t("录音加载失败，请稍后重试。")); }
  };
  const title = t("{value0}复盘", { value0: session.stage_label });
  const subtitle = generating ? t("正在生成文字复盘，可以稍后回来查看。") : report?.summary || session.review_summary || t("保存文字记录后生成 AI 复盘；录音转写后续提供。");
  return <div className={`cd3-page cd3-review is-${generating || busy ? "generating" : report ? "ready" : "empty"}`}>
    <CareerDetailHeader eyebrow={[{ label: "REVIEWS", onClick: onBack, ariaLabel: t("返回复盘列表") }, detail.application.company_name_snapshot, detail.application.job_title_snapshot, shortDate(session.start_at)]}
      title={title} subtitle={subtitle} actions={<><button onClick={() => setTextOpen(true)}>{t("文字记录")}</button><button disabled={!canGenerate || busy || (generating && !interrupted)} onClick={() => void generate()}>{busy || (generating && !interrupted) ? t("正在生成…") : report ? t("重新生成") : t("生成复盘")}</button></>} />
    {tooLong && <p role="alert">{t("文字复盘最多支持 50,000 字符，请精简记录后生成。")}</p>}
    {session.review_stale && <p role="status">{t("文字记录已修改，以下是旧报告，请重新生成。")}</p>}
    {session.review_status === "failed" && <p role="alert">{t("复盘生成失败，原记录和已有报告已保留。")}</p>}
    {interrupted && <p role="status">{t("上次生成已中断，可以重新生成。")}</p>}
    {(busy || (generating && !interrupted)) && <p role="status">{t("正在生成文字复盘，可以稍后回来查看。")}</p>}
    {!hasText && <section className="cd3-empty"><div className="cd3-empty-copy"><h2>{t("添加面试文字记录")}</h2><p>{t("保存文字记录后生成 AI 复盘；录音转写后续提供。")}</p><button className="v3-btn v3-btn-dark" onClick={onText}>{t("粘贴文字记录")}</button><button className="v3-btn v3-btn-text" onClick={onUpload}>{t("上传录音")}</button></div></section>}
    {audio && <section className="cd3-recording" aria-label={t("面试录音播放器")}><div className="cd3-wave-stage"><button className="cd3-play" aria-label={playing ? t("暂停录音") : t("播放录音")} onClick={() => void play()}><Icon name={playing ? "stop" : "play"} size={14}/></button><input type="range" aria-label={t("录音播放进度")} min={0} max={duration || (audio.duration_ms || 0) / 1000} value={playhead} disabled={!duration} onChange={event => { const value = Number(event.target.value); setPlayhead(value); if (audioRef.current) audioRef.current.currentTime = value; }}/></div><footer><strong>{audio.original_file_name}</strong><small>{stamp(playhead)} / {duration || audio.duration_ms ? stamp(duration || audio.duration_ms! / 1000) : "—"}</small></footer>
      {audioUrl && <audio ref={audioRef} autoPlay src={audioUrl} onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={event => setPlayhead(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => onNotice(t("录音暂时无法播放。"))}/>}</section>}
    {report && <><section className="cd3-recording" aria-label={t("复盘评分")}><footer><div className="cd3-scores">{([
      [t("项目表达"), report.project_expression], [t("系统设计"), report.system_design], [t("沟通"), report.communication],
    ] as const).map(([label, rating]) => <div key={label} title={rating.reason}><small>{label}</small><strong>{rating.score ?? "—"}</strong><p>{rating.reason}</p>{rating.evidence && <blockquote>{rating.evidence}</blockquote>}</div>)}</div><strong>{t("综合")}: {report.overall_score ?? "—"}</strong></footer></section>
      <div className="cd3-feedback-grid">{(["strength", "improvement"] as const).map(kind => <section key={kind} className={`cd3-feedback ${kind === "strength" ? "good" : "improve"}`}><header><h2>{kind === "strength" ? t("做得好") : t("可以更好")}</h2><small>{report.questions.filter(item => item[kind]).length}{t(" 条")}</small></header>{report.questions.map((item, index) => item[kind] && <button key={index} onClick={() => setSelected(index)}><span>{item[kind]}</span><small>Q{index + 1}</small></button>)}</section>)}</div>
      {question && <><nav aria-label={t("复盘问题")} className="cd3-review-questions">{report.questions.map((item, index) => <button key={index} aria-pressed={selected === index} onClick={() => setSelected(index)}>Q{index + 1} · {item.question}</button>)}</nav><section className="cd3-answer"><small>{t("AI 建议的回答 · Q")}{selected + 1}</small><h2>{question.question}</h2><blockquote>{question.evidence}</blockquote><p>{question.answer}</p><p>{question.suggested_answer}</p></section><section className="cd3-next"><small>{t("下一步")}</small><button disabled={saving || session.review_stale || Boolean(detail.application.archived_at)} onClick={() => void loadTargets()}>{t("加入下一轮准备清单")}<Icon name="arrow" size={12}/></button>{targets.length > 0 && <div><select aria-label={t("选择下一轮面试")} value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">{t("选择下一轮面试")}</option>{targets.map(item => <option key={item.id} value={item.id}>{item.stage_label} · {shortDate(item.start_at)}</option>)}</select><button disabled={!targetId || saving} onClick={() => void savePreparation()}>{t("保存到准备清单")}</button></div>}<button onClick={() => navigateTo(`/assistant?prompt=${encodeURIComponent(`${t("请围绕以下问题帮我练习面试回答：")}\n${question.question}\n${question.suggested_answer || ""}`)}`)}>{t("模拟下一轮")}<Icon name="arrow" size={12}/></button></section></>}
    </>}
    <MotionPresence>{textOpen && <Dialog width={720} label={t("文字记录与素材")} onClose={() => setTextOpen(false)}><div className="cd3-record-dialog"><h2>{t("文字记录与素材")}</h2>{recordContent}</div></Dialog>}</MotionPresence>
  </div>;
}
