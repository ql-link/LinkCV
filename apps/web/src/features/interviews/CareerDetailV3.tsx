import { t, useLocale, weekdayName, weekdays } from "@/i18n";
import { MotionPresence, useContentMotion } from "@/components/ui/motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type JobApplicationSummary, type InterviewSessionSummary, type InterviewSessionDetail, type ResumeSummary } from "@/api/client";
import { Icon } from "@/v3/Icon";
import { BeTag, Dialog, Menu, Popover, PageEyebrow, type EyebrowSegment } from "@/v3/primitives";
import { Bar, MiniResume, Paper } from "@/v3/art";
import { careerApplicationPath, editorPath, jobDetailPath, navigateTo } from "@/routing";
import { projectApplicationProgress } from "./applicationProgress";
import { REVIEW_WAVEFORM } from "./reviewWaveform";
import playerArt from "./v3-assets/player.svg";
import errorCloud from "./v3-assets/review-error-cloud.svg";
import "./careerDetailsV3.css";

const date = (value: string | null | undefined) => value ? new Date(value) : null;
const shortDate = (value: string | null | undefined) => { const d = date(value); return d ? `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "—"; };
const time = (value: string | null | undefined) => { const d=date(value); return d ? `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` : "—"; };
const stamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;
const text = (snapshot: Record<string, unknown>, ...keys: string[]) => keys.map(k => snapshot[k]).find(v=>typeof v === "string" && v) as string | undefined;

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
  // Offer reply deadlines are sample UI until the backend supplies this field.
  const offerReplyExample="2026-10-15T10:00:00+08:00";
  const d=date(offer ? offerReplyExample : currentSession?.start_at ?? application.updated_at) ?? new Date();
  const waitDays=currentSession?Math.max(0,Math.floor((Date.now()-new Date(currentSession.end_at).getTime())/86400000)):0;
  const minutesToStart=currentSession?Math.max(0,Math.floor((new Date(currentSession.start_at).getTime()-Date.now())/60000)):0;
  const heroMeta=ended?`${currentSession?.stage_label??p.stageLabel}${application.status==="rejected"?t("未通过"):t("已结束")} · ${shortDate(application.updated_at)}`:offer?t("Offer · {value0} 前回复", { value0: shortDate(offerReplyExample) }):waiting?t("{value0}已结束 · 等待 {value1} 天", { value0: p.stageLabel, value1: waitDays }):currentSession?`${sameDay(currentSession.start_at)?t("今天"):shortDate(currentSession.start_at)} ${time(currentSession.start_at)}${minutesToStart?t(" · 还有 {value0} 小时 {value1} 分", { value0: Math.floor(minutesToStart/60), value1: minutesToStart%60 }):""}`:p.statusLabel;
  const steps=application.stages ?? [];
  const timeline=[...steps].sort((a,b)=>b.sequence_no-a.sequence_no).map(stage=>{
    const s=sessions.find(s=>s.application_stage_id===stage.id || (!s.application_stage_id && s.stage_label===stage.stage_label));
    return {id:stage.id,label:stage.stage_type==="screening"?t("简历筛选"):stage.stage_label,at:s?.start_at??stage.entered_at,session:s,state:s?.status==="cancelled"?"cancelled":stage.stage_status==="completed"||s?.status==="completed"?"done":"current",meta:s ? s.status==="completed" ? `${s.round_result==="passed"?t("已通过"):t("已完成")} · ${s.review_summary?t("复盘 8.2"):t("待复盘")}` : t("{value0} · 待面试", { value0: s.mode==="video"?t("视频面试"):s.mode==="onsite"?t("现场面试"):t("待面试") }) : stage.stage_status==="completed"?t("已通过"):t("等待通知")};
  });
  if(!timeline.length) sessions.forEach(s=>timeline.push({id:s.id,label:offer&&s.stage_type==="offer"?t("已收到 Offer"):s.stage_label,at:s.start_at,session:s,state:s.status==="completed"?"done":"current",meta:s.status==="completed"?t("已完成 · 待复盘"):t("待面试")}));
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
  const heroSub=offer?[application.offer_salary?`${application.offer_salary} ${application.offer_salary_currency??"CNY"}`:null,application.offer_base_location,t("入职时间待定")].filter(Boolean).join(" · "):ended?t("复盘会帮你整理这几轮暴露的问题，下一次面试前看看。"):waiting?t("通常 3–5 个工作日内会收到通知。有新进展时在这里添加下一轮。"):currentSession?[currentSession.mode==="video"?t("视频面试"):currentSession.mode==="onsite"?t("现场面试"):t("电话面试"),currentSession.interviewer_name?t("面试官 {value0} {value1}", { value0: currentSession.interviewer_title??"", value1: currentSession.interviewer_name }):null,t("约 {value0} 分钟", { value0: Math.round((new Date(currentSession.end_at).getTime()-d.getTime())/60000) })].filter(Boolean).join(" · "):p.isPending?t("关联一份简历后投递，之后每一轮面试都记在这里。"):t("收到通知后，可以安排时间或添加下一阶段。");
  const emptyResources=p.isPending && !application.resume_id && !lastRecorded;
  const resourceCount=Number(Boolean(application.job_description_id))+Number(Boolean(application.resume_id))+Number(Boolean(lastRecorded));
  return <div className="cd3-page">
    <CareerDetailHeader eyebrow={[{ label: "JOBS", onClick: onBack, ariaLabel: t("返回岗位看板") }, application.company_name_snapshot, t("第 {value0} 天", { value0: elapsed })]} title={application.job_title_snapshot} accessibleTitle={`${application.company_name_snapshot}，${application.job_title_snapshot}`} subtitle={subtitle} actions={<><button onClick={openJob}>{t("岗位详情")}</button><button ref={menuRef} onClick={()=>setMenuOpen(!menuOpen)}>{t("编辑")}</button><Menu anchorRef={menuRef} open={menuOpen} onClose={()=>setMenuOpen(false)} items={[{label:t("编辑岗位"),onSelect:openJob},...(onTerminate?[{label:t("终止求职"),onSelect:onTerminate,danger:true}]:[]),...(onDelete?[{label:t("删除岗位"),onSelect:onDelete,danger:true}]:[])]}/></>} />
    <section className={`cd3-current ${ended?"is-ended":offer?"is-offer":p.isPending?"is-pending":""}`} aria-label={t("当前阶段")}>
      <div className="cd3-stage-art"><div className="cd3-date-tile"><small>{d.getMonth()+1}{t(" 月 · 周")}{t("日一二三四五六")[d.getDay()]}</small><strong>{waiting?"…":d.getDate()}</strong><span>{waiting?t("等待中"):offer?t("截止"):currentSession?time(currentSession.start_at):time(application.updated_at)}</span></div>{!waiting&&!offer&&!ended&&!p.isPending&&<span className="cd3-date-badge"><Icon name="play" size={16}/></span>}</div>
      <div className="cd3-current-copy"><small>{ended?t("已结束"):t("当前阶段")} · {heroMeta}{offer&&<BeTag/>}</small><h2>{heroTitle}</h2><p>{heroSub}</p><footer><div className="cd3-step-lines" aria-hidden="true">{Array.from({length:6},(_,i)=><i key={i} className={i===Math.min(5,timeline.length-1)?"is-current":""}/>)}</div><span>{t("第 ")}{offer?6:timeline.length} / {Math.max(6,timeline.length)}{t(" 步")}{!p.isPending&&(ended||offer||preparationLabel)&&` · ${ended?t("已结束"):offer?t("还有 16 天回复"):preparationLabel}`}</span><button className="v3-btn v3-btn-dark is-sm" onClick={onPrimary}>{p.isPending?t("添加求职阶段"):waiting?t("添加下一轮"):primaryLabel}<Icon name="arrow" size={12}/></button></footer></div>
    </section>
    <section className="cd3-timeline"><header><h2>{t("求职进度")}</h2><span>{timeline.length}{t(" 条记录")}</span></header><ol aria-label={t("当前阶段：{value0}", { value0: p.stageLabel })}>{timeline.map(row=><li key={row.id} className={`is-${row.state}`}><i aria-hidden="true"/><time>{shortDate(row.at)}</time><strong>{row.label}</strong><span>{row.session ? row.meta : row.id === "applied" && Boolean(application.applied_at) ? [text(snapshot,"source_platform"),application.job_title_snapshot,application.company_name_snapshot].filter(Boolean).join(" · ") : ""}{row.session?.review_summary&&<BeTag/>}</span>{row.session?<button onClick={()=>navigateTo(row.session!.status === "completed" ? `/career/reviews?session=${encodeURIComponent(row.session!.id)}&application=${encodeURIComponent(application.id)}` : careerApplicationPath(application.id,row.session!.id))}>{row.session.status==="completed"?row.session.review_summary?t("查看复盘"):t("上传录音"):sameDay(row.at)?t("今天"):t("查看安排")}</button>:<small>{row.meta}</small>}</li>)}</ol></section>
    <section className="cd3-resources"><header><h2>{t("关联资料")}</h2>{!emptyResources&&<span>{resourceCount}{t(" 个")}</span>}</header>{emptyResources?<div className="cd3-resource-empty"><div className="cd3-resource-empty-art"><span className="cd3-resource-slot"><Icon name="plus" size={20}/></span><i/><Paper x={140} y={30} w={76} h={104} r={5}><Bar x={9} y={11} w={40} h={6} color="var(--v3-txt)"/>{[23,33,43,57,67,77].map((y,i)=><Bar key={y} x={9} y={y} w={i%3===2?36:56} h={4}/>)}<span className="cd3-resource-jd">JD</span></Paper></div><div className="cd3-resource-empty-copy"><h2>{t("还没有关联简历和资料")}</h2><p>{t("关联投递用的简历、岗位 JD 和面试录音后，AI 准备面试和复盘时会直接用到它们。")}</p><div><button ref={resumeRef} className="v3-btn" onClick={()=>void selectResume()}><Icon name="doc" size={13}/>{t("关联简历")}</button><button className="v3-btn v3-btn-text" onClick={()=>navigateTo("/datasets")}>{t("从资料库选择")}</button></div></div><Popover anchorRef={resumeRef} open={resumeOpen} onClose={()=>{if(!resumeBusy)setResumeOpen(false);}} label={t("选择关联简历")} className="cd3-resume-picker">{resumeBusy?<p>{t("正在加载…")}</p>:resumes.length?resumes.map(resume=><button key={resume.id} onClick={()=>void linkResume(resume)}><Icon name="doc" size={14}/>{resume.title}</button>):<p>{t("还没有简历，")}<a href="/resumes">{t("去创建简历")}</a></p>}</Popover></div>:<div className="cd3-resource-grid">
      {application.job_description_id&&<button className="cd3-file" onClick={openJob}><div className="cd3-file-art"><Paper x={96} y={16} w={68} h={88} r={6}><Bar x={9} y={11} w={30} h={4} color="var(--v3-txt)"/>{[23,32,41,50,59].map(y=><Bar key={y} x={9} y={y} w={48} h={3}/>)}</Paper><span className="cd3-md">MD</span></div><strong>{t("岗位 JD · ")}{application.company_name_snapshot}_{application.job_title_snapshot}.md</strong><small>{t("岗位资料 · ")}{shortDate(application.created_at)}</small></button>}
      {application.resume_id&&<button className="cd3-file" onClick={()=>navigateTo(editorPath(application.resume_id!))}><div className="cd3-file-art"><MiniResume x={96} y={14} w={68} h={98}/></div><strong>{application.resume_title_snapshot??t("投递简历")}</strong><small>{t("简历 · ")}{shortDate(application.updated_at)}</small></button>}
      {lastRecorded&&<button className="cd3-file" onClick={()=>navigateTo(`/career/reviews?session=${encodeURIComponent(lastRecorded.id)}&application=${encodeURIComponent(application.id)}`)}><div className="cd3-file-art"><img src={playerArt} alt="" /></div><strong>{audioTitle??t("{value0} · 面试记录", { value0: lastRecorded.stage_label })}</strong><small>{t("录音与记录 · ")}{shortDate(lastRecorded.start_at)}</small></button>}
    </div>}</section>
  </div>;
}
function sameDay(value:string){return new Date(value).toDateString()===new Date().toDateString();}

const QUESTIONS = [{n:1,time:760,get label() { return t("用「时间轮 + 分片」讲清延迟队列重构"); },kind:"good"},{n:2,time:1085,get label() { return t("主动对比 Kafka 延迟消息方案"); },kind:"good"},{n:3,time:1470,get label() { return t("分片再均衡时的一致性，回答犹豫"); },kind:"improve"},{n:5,time:2268,get label() { return t("跨团队协作例子缺少结果数据"); },kind:"improve"},{n:0,time:0,get label() { return t("自我介绍超时约 1 分钟"); },kind:"improve"}] as const;
export function ReviewV3Content({detail,onBack,onUpload,onText,onNotice,recordContent}: {detail:InterviewSessionDetail;onBack:()=>void;onUpload:()=>void;onText:()=>void;onNotice:(message:string)=>void;recordContent:ReactNode}) {
  useLocale();
  const {session,application,assets}=detail;
  const audioAsset=assets.find(a=>a.asset_type==="audio");
  const hasContent=Boolean(audioAsset || session.questions_markdown?.trim());
  const hasReview=Boolean(session.review_summary?.trim());
  const [state,setState]=useState<"empty"|"ready"|"generating"|"failed">(hasContent||hasReview?"ready":"empty");
  const [textOpen,setTextOpen]=useState(false);
  const [selectedQuestion,setSelectedQuestion]=useState(3);
  const answerMotionRef=useContentMotion<HTMLElement>(String(selectedQuestion));
  const [playhead,setPlayhead]=useState(760);
  const [playing,setPlaying]=useState(false);
  const [audioUrl,setAudioUrl]=useState<string|null>(null);
  const audioRef=useRef<HTMLAudioElement>(null);
  const duration=(audioAsset?.duration_ms??2652000)/1000;
  const previousContent=useRef({id:session.id,hasContent});
  useEffect(()=>{const previous=previousContent.current;setState(hasReview?"ready":hasContent?previous.id===session.id&&!previous.hasContent?"generating":"ready":"empty");previousContent.current={id:session.id,hasContent};},[session.id,hasContent,hasReview]);
  useEffect(()=>()=>{if(audioUrl)URL.revokeObjectURL(audioUrl);},[audioUrl]);
  useEffect(()=>{if(state!=="generating")return;const timer=window.setTimeout(()=>setState(navigator.onLine ? "ready" : "failed"),1600);return()=>window.clearTimeout(timer);},[state]);
  const play=async()=>{
    if(!audioAsset){onNotice(t("这条记录还没有可播放的录音，可以上传录音。"));return;}
    if(audioRef.current){if(audioRef.current.paused)void audioRef.current.play().catch(()=>onNotice(t("录音暂时无法播放，请稍后重试。")));else audioRef.current.pause();return;}
    try{const blob=await api.downloadInterviewAsset(audioAsset.id);setAudioUrl(URL.createObjectURL(blob));setPlayhead(0);}catch{onNotice(t("录音加载失败，请稍后重试。"));}
  };
  const seek=(seconds:number,n=selectedQuestion)=>{setSelectedQuestion(n);setPlayhead(Math.min(seconds,duration));if(audioRef.current)audioRef.current.currentTime=Math.min(seconds,duration);};
  const regenerate=()=>setState("generating");
  const [preparedAnswers,setPreparedAnswers]=useState<Array<{questionNumber:number;question:string;answer:string}>>([]);
  const [preparingQuestion,setPreparingQuestion]=useState<number|null>(null);
  const prepareTimer=useRef<number|null>(null);
  const questionNumber=selectedQuestion||3;
  const suggestedQuestion=questionNumber===3?t("分片再均衡时，如何保证任务不丢不重？"):t("如何把回答说得更清楚、更具体？");
  const suggestedAnswer=questionNumber===3?t("先冻结源分片写入，双写迁移并用版本号去重；校验一致后再切换路由，旧分片保留一个周期用于回滚。"):t("先说明问题背景和自己的职责，再描述方案选择、实施过程和可以验证的结果。");
  const answerPrepared=preparedAnswers.some(item=>item.questionNumber===questionNumber);
  useEffect(()=>{setPreparedAnswers([]);setPreparingQuestion(null);return()=>{if(prepareTimer.current!==null)window.clearTimeout(prepareTimer.current);};},[session.id]);
  const prepareAnswer=()=>{
    if(preparingQuestion!==null||answerPrepared)return;
    const item={questionNumber,question:suggestedQuestion,answer:suggestedAnswer};
    setPreparingQuestion(questionNumber);
    prepareTimer.current=window.setTimeout(()=>{
      setPreparedAnswers(items=>[...items,item]);setPreparingQuestion(null);prepareTimer.current=null;
      onNotice(t("已在本次页面会话中模拟整理 Q{value0} 的回答。准备清单需后端支持，刷新后不保留。", { value0: item.questionNumber }));
    },600);
  };

  const title=session.stage_label.includes("·")?session.stage_label.split("·").map(part=>part.trim()).join(t("复盘 · ")):t("{value0}复盘", { value0: session.stage_label });
  const subtitle=state==="empty"?t("面试已结束。上传录音或粘贴文字记录，AI 会生成复盘。"):state==="generating"?t("正在生成复盘，通常需要 1–2 分钟，可以先离开这个页面。"):state==="failed"?t("录音已保存，但这次没能生成复盘。"):session.review_summary||t("综合 8.2 分。项目讲得清楚，追问分片一致性时略显犹豫。");
  return <div className={`cd3-page cd3-review is-${state}`}>
    <CareerDetailHeader eyebrow={[{ label: "REVIEWS", onClick: onBack, ariaLabel: t("返回复盘列表") }, application.company_name_snapshot, application.job_title_snapshot, `${shortDate(session.start_at)} ${time(session.start_at)}`]} title={title} subtitle={subtitle} badge actions={state!=="empty"&&state!=="generating"&&<>{state === "ready" && <button onClick={()=>setTextOpen(true)}>{t("文字记录")}</button>}<button onClick={regenerate}>{t("重新生成")}</button></>}/>
    {state==="empty"?<div className="cd3-empty"><div className="cd3-empty-art"><div className="cd3-empty-record"><span className="cd3-empty-play"><Icon name="play" size={14}/></span><div className="cd3-mini-wave">{Array.from({length:50},(_,i)=><i key={i}/>)}</div></div><span className="cd3-upload-badge"><Icon name="upload" size={20}/></span></div><div className="cd3-empty-copy"><h2>{t("上传这场面试的录音")}</h2><p>{t("支持常见音频格式，也可以直接粘贴文字记录。AI 会按问题切分，标出做得好和可以更好的地方。")}</p><div><button className="v3-btn v3-btn-dark" onClick={onUpload}>{t("上传录音")}</button><button className="v3-btn v3-btn-text" onClick={onText}>{t("粘贴文字记录")}</button></div></div></div>:<>
      <section className="cd3-recording" aria-label={t("面试录音播放器")}><div className="cd3-wave-stage"><button aria-label={playing?t("暂停录音"):t("播放录音")} className="cd3-play" onClick={()=>void play()}><Icon name={playing?"stop":"play"} size={14}/></button><div className="cd3-wave" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();seek(((e.clientX-r.left)/r.width)*duration);}}>{REVIEW_WAVEFORM.map((h,i)=><i key={i} style={{height:h,background:i/170<=playhead/duration?"var(--v3-txt)":"var(--v3-sk2)"}}/>)}</div><input className="cd3-seek" type="range" aria-label={t("录音播放进度")} min={0} max={duration} value={playhead} onChange={e=>seek(Number(e.target.value))}/>{state!=="generating"&&[1,2,3,4,5,6].map((n,i)=><button key={n} className={`cd3-q q-${n}`} style={{left:`${35+i*12}%`}} onClick={()=>seek([760,1085,1470,1880,2268,2530][i],n)}>Q{n}</button>)}</div>
      {audioUrl&&<audio ref={audioRef} autoPlay src={audioUrl} onTimeUpdate={e=>setPlayhead(e.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>onNotice(t("录音暂时无法播放。"))} onEnded={()=>setPlaying(false)}/>}
      <footer><div className="cd3-record-name"><strong>{audioAsset?.original_file_name??t("文字记录")}</strong><small>{state==="generating"?t("{value0} · 正在识别问题…", { value0: stamp(duration) }):t("{value0} / {value1} · 已标记 6 个问题", { value0: stamp(playhead), value1: stamp(duration) })}</small></div>{state==="generating"?<><div className="cd3-review-progress" role="progressbar" aria-label={t("复盘生成进度")} aria-valuenow={60} aria-valuemin={0} aria-valuemax={100}><i/></div><span className="cd3-analyzing">{t("分析中 · 60%")}</span></>:<><div className="cd3-scores">{[[t("项目表达"),9],[t("系统设计"),7],[t("沟通"),8]].map(([label,value])=><div key={label}><small>{label}</small><strong className={value===7?"is-orange":""}>{value}</strong></div>)}</div><BeTag/><button className="v3-btn v3-btn-dark is-sm" onClick={()=>navigateTo(`/assistant?prompt=${encodeURIComponent(t("请围绕{value0}帮我模拟下一轮面试", { value0: session.stage_label }))}`)}>{t("模拟下一轮")}<Icon name="arrow" size={12}/></button></>}</footer></section>
      {state==="failed"?<div className="cd3-empty cd3-error"><div className="cd3-error-art"><img src={errorCloud} alt=""/></div><div className="cd3-empty-copy"><h2>{t("复盘没能生成")}</h2><p>{t("可能是录音太短或识别不清。录音已经保存，可以重新生成，或者改为粘贴文字记录。")}</p><div><button className="v3-btn" onClick={regenerate}><Icon name="refresh" size={13}/>{t("重新生成")}</button><button className="v3-btn v3-btn-text" onClick={onText}>{t("粘贴文字记录")}</button></div></div></div>:<><div className="cd3-feedback-grid">{(["good","improve"] as const).map(kind=><section key={kind} className={`cd3-feedback ${kind}`}><header><span><Icon name={kind==="good"?"check":"spark"} size={14}/></span><h2>{kind==="good"?t("做得好"):t("可以更好")}</h2>{state!=="generating"&&<small>{kind==="good"?2:3}{t(" 条")}</small>}</header>{state==="generating"?<div className="cd3-skeleton">{[210,170,190].map(width=><span key={width}><i style={{width}}/><i/></span>)}</div>:QUESTIONS.filter(q=>q.kind===kind).map(q=><button key={q.n} onClick={()=>seek(q.time,q.n)}><span>{q.label}</span><small>{q.n?`Q${q.n} · ${stamp(q.time)}`:t("开场")}</small></button>)}</section>)}</div>{state==="ready"&&<><section ref={answerMotionRef} className="cd3-answer"><small>{t("AI 建议的回答 · Q")}{selectedQuestion||3}</small><h2>{suggestedQuestion}</h2><p>{suggestedAnswer}</p></section><section className="cd3-next"><small>{t("下一步")}</small><button onClick={prepareAnswer} disabled={preparingQuestion!==null||answerPrepared} aria-busy={preparingQuestion===questionNumber} title={answerPrepared?t("本次页面会话中的示例状态，刷新后不保留"):undefined}>{t("把 Q")}{questionNumber}{t(" 的回答整理进「")}{application.company_name_snapshot}{t("下一轮」准备清单")}<span>{answerPrepared?t("已整理"):preparingQuestion===questionNumber?t("整理中…"):t("开始")} <Icon name={answerPrepared?"check":"arrow"} size={12}/></span></button><button onClick={()=>navigateTo(`/assistant?prompt=${encodeURIComponent(t("请模拟一轮系统设计追问"))}`)}>{t("在首页对话里模拟一轮系统设计追问")}<span>{t("开始 ")}<Icon name="arrow" size={12}/></span></button></section></>}</>}
    </>}
    <MotionPresence>{textOpen&&<Dialog width={720} label={t("文字记录与素材")} onClose={()=>setTextOpen(false)}><div className="cd3-record-dialog"><h2>{t("文字记录与素材")}</h2>{recordContent}</div></Dialog>}</MotionPresence>
  </div>;
}
