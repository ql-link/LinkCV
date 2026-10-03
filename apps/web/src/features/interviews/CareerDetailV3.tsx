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
import "./reviewReport.css";
import { ReviewReportV2Body } from "./ReviewReportV2";
import { isReportV2, reviewGrade, reviewScore100 } from "./reviewReport";

const date = (value: string | null | undefined) => value ? new Date(value) : null;
const shortDate = (value: string | null | undefined) => { const d = date(value); return d ? `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "—"; };
const time = (value: string | null | undefined) => { const d=date(value); return d ? `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` : "—"; };
const stamp = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2,"0")}:${Math.floor(seconds % 60).toString().padStart(2,"0")}`;
const text = (snapshot: Record<string, unknown>, ...keys: string[]) => keys.map(k => snapshot[k]).find(v=>typeof v === "string" && v) as string | undefined;

export function CareerDetailHeader({ eyebrow, title, subtitle, actions, badge = false, accessibleTitle }: { eyebrow: EyebrowSegment[]; title: ReactNode; subtitle: ReactNode; actions?: ReactNode; badge?: boolean; accessibleTitle?: string }) {
  useLocale();
  return <header className="cd3-head"><PageEyebrow className="cd3-eyebrow" segments={eyebrow} /><h1 aria-label={accessibleTitle}>{title}{badge && <BeTag />}</h1><p>{subtitle}</p><div className="cd3-head-actions">{actions}</div></header>;
}

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
  const interrupted = generating && Boolean(session.review_started_at) && now - Date.parse(session.review_started_at!) >= 20 * 60_000;
  useEffect(() => {
    if (!generating) return;
    let live = true;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void api.getInterviewSession(session.id).then(result => {
        if (!live) return;
        setSession(result.session);
        if (result.session.review_status !== "generating") {
          if (attempt.current?.id === result.session.review_request_id) attempt.current = null;
          if (result.session.review_status === "failed") onNotice(t("复盘生成失败，原记录和已有报告已保留。"));
          void onChanged?.();
        }
      }).catch(() => {});
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
      if (result.session.review_status !== "generating") await onChanged?.();
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
        { id: crypto.randomUUID(), title, category: "technical", reason: (question.improvement || question.suggested_answer || ("evidence" in question ? question.evidence : question.question)).slice(0, 200), done: false }] });
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
  const title = t("{value0} · AI 分析报告", { value0: session.stage_label });
  const prepActions = question ? <><button type="button" className="rp-outline-button" disabled={saving || session.review_stale || Boolean(detail.application.archived_at)} onClick={() => void loadTargets()}>{t("加入下一轮准备清单")}<Icon name="arrow" size={12}/></button>{targets.length > 0 && <div><select aria-label={t("选择下一轮面试")} value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">{t("选择下一轮面试")}</option>{targets.map(item => <option key={item.id} value={item.id}>{item.stage_label} · {shortDate(item.start_at)}</option>)}</select><button type="button" className="rp-primary-button" disabled={!targetId || saving} onClick={() => void savePreparation()}>{t("保存到准备清单")}</button></div>}<button type="button" className="rp-outline-button" onClick={() => navigateTo(`/assistant?prompt=${encodeURIComponent(`${t("请围绕以下问题帮我练习面试回答：")}\n${question.question}\n${question.suggested_answer || ""}`)}`)}>{t("模拟下一轮")}<Icon name="arrow" size={12}/></button></> : null;
  const overall = reviewScore100(report);
  const level = reviewGrade(overall);
  const reportV2 = isReportV2(report) ? report : null;
  const reportV1 = report && !isReportV2(report) ? report : null;
  const strengths = reportV1?.questions.filter(item => item.strength).length ?? 0;
  const improvements = reportV1?.questions.filter(item => item.improvement) ?? [];
  const basis = [reportV2 ? reportV2.basis.resume_title : detail.application.resume_title_snapshot, audio ? t("{value0} 分钟录音转写", { value0: Math.max(1, Math.round((audio.duration_ms ?? 0) / 60_000)) }) : hasText ? t("文字记录") : null].filter(Boolean).join(" + ");
  return <div className={`rp-page cd3-review is-${generating || busy ? "generating" : report ? "ready" : "empty"}`}>
    <header className="rp-header">
      <div className="rp-header-copy">
        <nav className="rp-breadcrumb" aria-label={t("面包屑")}><button type="button" onClick={onBack} aria-label={t("返回复盘列表")}>{`← ${detail.application.company_name_snapshot} · ${detail.application.job_title_snapshot}`}</button><span aria-hidden="true">/</span><span>{session.stage_label}</span></nav>
        <h1>{title}</h1>
        <p className="rp-meta">{report && <span className="rp-chip is-gray">{session.stage_label}</span>}<span>{report ? [basis ? t("基于 {value0}", { value0: basis }) : null, `${shortDate(report.generated_at)} ${time(report.generated_at)}`].filter(Boolean).join(" · ") : `${shortDate(session.start_at)} ${time(session.start_at)}`}</span></p>
      </div>
      <div className="rp-header-actions"><button type="button" className="rp-outline-button" onClick={() => setTextOpen(true)}>{t("文字记录")}</button><button type="button" className="rp-primary-button" disabled={!canGenerate || busy || (generating && !interrupted)} onClick={() => void generate()}>{busy || (generating && !interrupted) ? t("正在生成…") : report ? t("重新生成") : t("生成复盘")}</button></div>
    </header>
    {tooLong && <p className="rp-banner is-red" role="alert">{t("文字复盘最多支持 50,000 字符，请精简记录后生成。")}</p>}
    {session.review_stale && <p className="rp-banner" role="status">{t("文字记录已修改，以下是旧报告，请重新生成。")}</p>}
    {session.review_status === "failed" && <p className="rp-banner is-red" role="alert">{t("复盘生成失败，原记录和已有报告已保留。")}</p>}
    {interrupted && <p className="rp-banner" role="status">{t("上次生成已中断，可以重新生成。")}</p>}
    {(busy || (generating && !interrupted)) && <p className="rp-banner" role="status">{t("正在后台生成 AI 复盘，通常需要 1–3 分钟，可以离开页面稍后回来查看。")}</p>}
    {reportV1 && <p className="rp-banner" role="status">{t("这是旧版报告，重新生成后可查看结果判断、五维雷达和逐题得分。")}</p>}
    {!hasText && <section className="rp-empty"><h2>{t("添加面试文字记录")}</h2><p>{session.review_summary || t("保存文字记录或上传录音后生成 AI 复盘，录音会自动转写为文字稿。")}</p><div><button type="button" className="rp-primary-button" onClick={onText}>{t("粘贴文字记录")}</button><button type="button" className="rp-outline-button" onClick={onUpload}>{t("上传录音")}</button></div></section>}
    {audio && <section className="rp-audio" aria-label={t("面试录音播放器")}><button type="button" className="rp-play" aria-label={playing ? t("暂停录音") : t("播放录音")} onClick={() => void play()}><Icon name={playing ? "stop" : "play"} size={13}/></button><strong>{audio.original_file_name}</strong><input type="range" aria-label={t("录音播放进度")} min={0} max={duration || (audio.duration_ms || 0) / 1000} value={playhead} disabled={!duration} onChange={event => { const value = Number(event.target.value); setPlayhead(value); if (audioRef.current) audioRef.current.currentTime = value; }}/><small>{stamp(playhead)} / {duration || audio.duration_ms ? stamp(duration || audio.duration_ms! / 1000) : "—"}</small>
      {audioUrl && <audio ref={audioRef} autoPlay src={audioUrl} onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={event => setPlayhead(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => onNotice(t("录音暂时无法播放。"))}/>}</section>}
    {reportV2 && <ReviewReportV2Body session={session} report={reportV2} selected={selected} onSelect={setSelected} archived={Boolean(detail.application.archived_at)}
      onNotesChanged={notes => setSession(current => ({ ...current, review_question_notes: notes }))}
      questionActions={question && <footer className="cd3-next">{prepActions}</footer>} />}
    {reportV1 && <>
      <section className="rp-scores" aria-label={t("复盘评分")}>
        <div className="rp-hero">
          <div className="rp-total"><small>{t("总分")}{level && <span className={`rp-level is-${level.tone}`}>{level.label}</span>}</small><strong>{overall ?? "—"}</strong><span>/ 100</span></div>
          <div className="rp-hero-copy"><h2>{reportV1.summary}</h2><p>{[t("识别问题 {value0} 题", { value0: reportV1.questions.length }), t("表现较好 {value0} 题", { value0: strengths }), t("待提升 {value0} 题", { value0: improvements.length })].join(" · ")}</p></div>
        </div>
        <h2 className="rp-section-title">{t("能力维度")}<small>{t("0–10 分 · 依据本轮文字记录")}</small></h2>
        <ul className="rp-dimensions">{([[t("项目表达"), reportV1.project_expression], [t("系统设计"), reportV1.system_design], [t("沟通表达"), reportV1.communication]] as const).map(([label, rating]) => (
          <li key={label}>
            <header><strong>{label}</strong><span className="rp-track" aria-hidden="true"><i className={rating.score != null && rating.score < 6 ? "is-low" : ""} style={{ width: `${(rating.score ?? 0) * 10}%` }} /></span><small>{rating.score ?? "—"} / 10</small></header>
            <p>{rating.reason}</p>
            {rating.evidence && <blockquote>{rating.evidence}</blockquote>}
          </li>
        ))}</ul>
      </section>
      {reportV1.questions.length > 0 && <section className="rp-questions" aria-labelledby="rp-questions-title">
        <h2 className="rp-section-title" id="rp-questions-title">{t("逐题表现")}<small>{t("点击题目查看完整回答与分析")}</small></h2>
        <nav aria-label={t("复盘问题")}><ol>{reportV1.questions.map((item, index) => <li key={index}><button type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}><small>Q{index + 1}</small><span>{item.question}</span>{item.improvement ? <em className="rp-chip is-orange">{t("待提升")}</em> : item.strength ? <em className="rp-chip is-green">{t("表现较好")}</em> : null}</button></li>)}</ol></nav>
        {question && <section className="rp-answer" aria-label={t("AI 建议的回答 · Q{value0}", { value0: selected + 1 })}>
          <small>{t("AI 建议的回答 · Q")}{selected + 1}</small>
          <h3>{question.question}</h3>
          {question.answer && <><h4>{t("我的回答")}</h4><p>{question.answer}</p></>}
          {"evidence" in question && <blockquote>{question.evidence}</blockquote>}
          {question.strength && <><h4>{t("做得好的地方")}</h4><p>{question.strength}</p></>}
          {question.improvement && <><h4>{t("可以更好")}</h4><p>{question.improvement}</p></>}
          {question.suggested_answer && <><h4>{t("下次怎么答")}</h4><p>{question.suggested_answer}</p></>}
          <footer className="cd3-next">{prepActions}</footer>
        </section>}
      </section>}
      {improvements.length > 0 && <section className="rp-suggestions" aria-labelledby="rp-suggestions-title">
        <h2 className="rp-section-title" id="rp-suggestions-title">{t("改进建议")}<small>{t("{value0} 条", { value0: improvements.length })}</small></h2>
        <ul>{reportV1.questions.map((item, index) => item.improvement && <li key={index}><header><span className={`rp-chip ${index === 0 ? "is-red" : "is-orange"}`}>{index === 0 ? t("重要") : t("建议")}</span><strong>{item.improvement}</strong></header>{item.suggested_answer && <p>{item.suggested_answer}</p>}<footer>{t("来源")}<button type="button" className="rp-chip is-blue" onClick={() => setSelected(index)}>Q{index + 1}</button></footer></li>)}</ul>
      </section>}
    </>}
    {!report && hasText && session.review_summary && <p className="rp-banner">{session.review_summary}</p>}
    <MotionPresence>{textOpen && <Dialog width={720} label={t("文字记录与素材")} onClose={() => setTextOpen(false)}><div className="cd3-record-dialog"><h2>{t("文字记录与素材")}</h2>{recordContent}</div></Dialog>}</MotionPresence>
  </div>;
}
