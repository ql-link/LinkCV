import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "@/i18n";
import { MotionPresence } from "@/components/ui/motion";
import { api, ApiRequestError, type InterviewSessionDetail, type InterviewSessionRecord, type InterviewTranscriptionRecord } from "@/api/client";
import { Icon } from "@/v3/Icon";
import { Dialog as V3Dialog, Menu, type MenuItem } from "@/v3/primitives";
import { navigateTo } from "@/routing";
import {
  AddInterviewContentDialog,
  DeleteInterviewTextConfirmDialog,
  EditInterviewScheduleDialog,
  InterviewAnswerPlanSection,
  requestErrorMessage,
} from "./CareerDetailViews";
import { PrepChecklistCard } from "./PrepChecklistCard";
import { effectiveSessionStatus, formatClock, formatMonthDay } from "./applicationDetailModel";
import { WrittenImportDialog } from "./WrittenImportDialog";
import { dimensionLabel, isReportV2, reviewScore100, verdictLabel } from "./reviewReport";
import "./stageDetailPage.css";

/**
 * 04.C01 · C03 stage detail: one interview, HR conversation or written test,
 * its transcript or questions, preparation, AI analysis and review notes.
 */

type Tone = "blue" | "green" | "orange" | "gray" | "red";
const TRANSCRIPT_VISIBLE = 8;

function range(session: InterviewSessionRecord): string {
  const sameDay = new Date(session.start_at).toDateString() === new Date(session.end_at).toDateString();
  return sameDay
    ? `${formatMonthDay(session.start_at)} ${formatClock(session.start_at)}–${formatClock(session.end_at)}`
    : `${formatMonthDay(session.start_at)} ${formatClock(session.start_at)} – ${formatMonthDay(session.end_at)} ${formatClock(session.end_at)}`;
}

function modeText(session: InterviewSessionRecord): string {
  if (session.mode === "video") return session.meeting_url?.includes("feishu") ? t("飞书视频") : t("视频面试");
  if (session.mode === "onsite") return session.location ? t("现场 · {value0}", { value0: session.location }) : t("现场");
  if (session.mode === "phone") return t("电话");
  return t("其他方式");
}

function stamp(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function sessionStatus(detail: InterviewSessionDetail, now: Date): { label: string; tone: Tone } {
  const { session, application } = detail;
  const status = effectiveSessionStatus(session, now);
  if (status === "cancelled") return { label: t("已取消"), tone: "gray" };
  if (session.round_result === "passed") return { label: t("已通过"), tone: "green" };
  if (session.round_result === "rejected") return { label: t("未通过"), tone: "red" };
  if (status === "scheduled") return { label: t("已安排"), tone: "blue" };
  return application.status === "active"
    ? { label: t("等待结果"), tone: "orange" }
    : { label: t("已结束"), tone: "gray" };
}

/** Transcript lines read as "speaker: words"; anything else stays a plain paragraph. */
function transcriptLines(markdown: string): Array<{ speaker: string | null; text: string }> {
  return markdown.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^(面试官|HR|我|候选人|Interviewer|Me)\s*[:：]\s*(.+)$/i);
    return match ? { speaker: match[1], text: match[2] } : { speaker: null, text: line };
  });
}

/** Written-test questions are the numbered or bulleted lines of the record. */
function questionLines(markdown: string): string[] {
  return markdown.split("\n")
    .map((line) => line.trim().match(/^(?:\d+[.)、]|[-*])\s+(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line));
}

function transcriptionError(code: string | null): string {
  const messages: Record<string, string> = {
    INTERVIEW_TRANSCRIPTION_NOT_CONFIGURED: t("语音识别还没有配置，请联系管理员。"),
    INTERVIEW_TRANSCRIPTION_STORAGE_UNAVAILABLE: t("录音暂时无法交给语音识别服务，请稍后重试。"),
    INTERVIEW_TRANSCRIPTION_FORMAT_UNSUPPORTED: t("录音格式无法识别，请换成 mp3 或 m4a 后重新上传。"),
    INTERVIEW_TRANSCRIPTION_DOWNLOAD_FAILED: t("语音识别服务没能读取录音，请稍后重试。"),
    INTERVIEW_TRANSCRIPTION_AUDIO_TOO_LONG: t("录音太长，暂不支持转写。"),
    INTERVIEW_TRANSCRIPTION_EMPTY: t("录音里没有识别到有效的语音。"),
    INTERVIEW_TRANSCRIPTION_TIMEOUT: t("转写超时，请重试。"),
  };
  return (code && messages[code]) || t("转写失败，请重试。");
}

function Chip({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`sd-chip is-${tone}`}>{label}</span>;
}

export function StageDetailPage({
  detail,
  onBack,
  onChanged,
  onSaved,
  onNotice,
}: {
  detail: InterviewSessionDetail;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onSaved?: (application: InterviewSessionDetail["application"], session?: InterviewSessionDetail["session"]) => void;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const { session, application, assets } = detail;
  const [now] = useState(() => new Date());
  const [contentDialog, setContentDialog] = useState<"audio" | "library" | "text" | null>(null);
  const [editTextOpen, setEditTextOpen] = useState(false);
  const [deleteTextOpen, setDeleteTextOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  const isWritten = session.stage_type === "other";
  const recordKind = isWritten ? "笔试" : "面试";
  const archived = application.archived_at !== null;
  const status = sessionStatus(detail, now);
  // The label follows time, but an elapsed booking can still be moved or prepared for.
  const scheduled = session.status === "scheduled";
  const text = session.questions_markdown?.trim() ?? "";
  const audio = assets.find((asset) => asset.asset_type === "audio");
  const report = session.review_report;
  const reportV2 = isReportV2(report) ? report : null;
  const reportV1 = report && !isReportV2(report) ? report : null;
  const generating = session.review_status === "generating";
  const transcription: InterviewTranscriptionRecord | undefined = audio
    ? session.transcriptions?.find((item) => item.dataset_id === audio.id)
    : undefined;
  const transcribing = transcription?.status === "queued" || transcription?.status === "running";
  const noteCount = session.review_question_notes?.length ?? 0;
  // Transcription and review generation finish in the background; refresh while they run.
  useEffect(() => {
    if (!transcribing && !generating) return;
    const timer = window.setInterval(() => { void onChanged(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [transcribing, generating, onChanged]);
  const retryTranscription = async () => {
    if (!audio) return;
    setTranscriptionBusy(true);
    try { await api.retryInterviewTranscription(session.id, audio.id); await onChanged(); }
    catch (error) { onNotice(requestErrorMessage(error)); }
    finally { setTranscriptionBusy(false); }
  };
  const applyTranscription = async () => {
    if (!audio) return;
    setTranscriptionBusy(true);
    try { await api.applyInterviewTranscription(session.id, audio.id, session.lock_version); await onChanged(); onNotice(t("已用转写结果替换文字稿。")); }
    catch (error) { onNotice(requestErrorMessage(error)); }
    finally { setTranscriptionBusy(false); }
  };
  const lines = transcriptLines(text);
  const questions = isWritten ? questionLines(text) : [];
  const visibleLines = expanded ? lines : lines.slice(0, TRANSCRIPT_VISIBLE);
  const meta = isWritten
    ? [session.schedule_kind === "open_window" ? t("截止 {value0}", { value0: `${formatMonthDay(session.end_at)} ${formatClock(session.end_at)}` }) : range(session), modeText(session)]
    : [range(session), modeText(session), session.interviewer_name ? t("面试官 {value0}", { value0: session.interviewer_name }) : null];
  const reportPath = `/career/reviews?session=${encodeURIComponent(session.id)}&application=${encodeURIComponent(application.id)}`;
  const menuItems: MenuItem[] = [
    ...(isWritten && scheduled ? [{ label: t("修改安排"), onSelect: () => setScheduleOpen(true) }] : []),
    ...(text ? [{ label: t("编辑文字记录"), onSelect: () => setEditTextOpen(true) }, { label: t("删除文字记录"), danger: true, onSelect: () => setDeleteTextOpen(true) }] : []),
    { label: t("从资料库添加"), onSelect: () => setContentDialog("library") },
  ];

  return (
    <div className="sd-page">
      <header className="sd-header">
        <div className="sd-header-copy">
          <nav className="sd-breadcrumb" aria-label={t("面包屑")}>
            <button type="button" onClick={onBack} aria-label={t("返回求职进度")}>{`← ${application.job_title_snapshot} · ${application.company_name_snapshot}`}</button>
            <span aria-hidden="true">/</span>
            <span>{t("阶段记录")}</span>
          </nav>
          <div className="sd-title-row"><h1>{session.stage_label}</h1><Chip {...status} /></div>
          <p className="sd-meta">{meta.filter(Boolean).join(" · ")}</p>
        </div>
        <div className="sd-header-actions">
          {isWritten
            ? !archived && <button type="button" className="sd-outline-button" onClick={() => setImportOpen(true)}>{t("导入题目")}</button>
            : !archived && scheduled && <button type="button" className="sd-outline-button" onClick={() => setScheduleOpen(true)}>{t("编辑本轮")}</button>}
          {!archived && <button type="button" ref={menuRef} className="sd-outline-button sd-more" aria-label={t("更多操作")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>···</button>}
          <Menu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
        </div>
      </header>

      <div className="sd-lower">
        <main className="sd-main">
          <section className="sd-card" aria-labelledby="sd-record-title">
            <header>
              <h2 id="sd-record-title">{isWritten ? t("笔试题目") : t("面试文字稿")}</h2>
              {isWritten && questions.length > 0 && <Chip label={t("{value0} 题", { value0: questions.length })} tone="gray" />}
              {!isWritten && audio && <small>{session.transcript_source === "transcription" ? t("{value0} · 自动转写", { value0: audio.original_file_name }) : audio.original_file_name}</small>}
              {!isWritten && (audio || text) && !archived && <button type="button" className="sd-outline-button" onClick={() => setContentDialog("audio")}>{t("替换")}</button>}
            </header>
            {!text && !audio ? (
              <div className="sd-empty">
                <span className="sd-empty-plus" aria-hidden="true"><Icon name="plus" size={14} /></span>
                <strong>{isWritten ? t("导入笔试题目，按题记录作答情况") : t("上传录音或文字稿，统一整理为文字稿")}</strong>
                <small>{isWritten ? t("可以粘贴题目文本、上传截图，或从资料库选择 PDF / Word 文档") : t("支持 mp3 / m4a 录音或 txt / docx 文本，录音会自动转写")}</small>
                {!archived && <div>
                  {isWritten
                    ? <button type="button" className="sd-primary-button" onClick={() => setImportOpen(true)}>{t("导入题目")}</button>
                    : <><button type="button" className="sd-primary-button" onClick={() => setContentDialog("audio")}>{t("上传录音")}</button><button type="button" className="sd-outline-button" onClick={() => setContentDialog("text")}>{t("粘贴文本")}</button><button type="button" className="sd-outline-button" onClick={() => setContentDialog("library")}>{t("导入文件")}</button></>}
                </div>}
              </div>
            ) : (
              <>
                {audio && <AudioBar asset={audio} onNotice={onNotice} />}
                {!isWritten && transcription && transcribing && <p className="sd-transcription" role="status">{t("正在转写录音，完成后会自动显示文字稿…")}</p>}
                {!isWritten && transcription?.status === "failed" && <p className="sd-transcription is-red" role="alert">{transcriptionError(transcription.error_code)}{!archived && <button type="button" className="sd-link-button" disabled={transcriptionBusy} onClick={() => void retryTranscription()}>{t("重新转写")}</button>}</p>}
                {!isWritten && transcription?.status === "succeeded" && transcription.pending_replace && <p className="sd-transcription" role="status">{t("录音转写已完成，当前保留的是你之前的文字稿。")}{!archived && <button type="button" className="sd-link-button" disabled={transcriptionBusy} onClick={() => void applyTranscription()}>{t("用转写结果替换")}</button>}</p>}
                {!isWritten && audio && !transcription && !text && !archived && <p className="sd-transcription" role="status">{t("这段录音还没有转写。")}<button type="button" className="sd-link-button" disabled={transcriptionBusy} onClick={() => void retryTranscription()}>{t("开始转写")}</button></p>}
                {isWritten && questions.length > 0 ? (
                  <ol className="sd-questions">{questions.map((question, index) => <li key={`${index}-${question}`}><small>{String(index + 1).padStart(2, "0")}</small><span>{question}</span></li>)}</ol>
                ) : text ? (
                  <>
                    <ol className="sd-transcript">{visibleLines.map((line, index) => (
                      <li key={index} className={line.speaker && /^(我|me|候选人)$/i.test(line.speaker) ? "is-me" : ""}>
                        {line.speaker && <span className="sd-speaker">{line.speaker}</span>}
                        <p>{line.text}</p>
                      </li>
                    ))}</ol>
                    {lines.length > TRANSCRIPT_VISIBLE && <button type="button" className="sd-link-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? t("收起") : t("展开全部（共 {value0} 段）↓", { value0: lines.length })}</button>}
                  </>
                ) : <p className="sd-muted">{t("录音已上传，转写完成后显示在这里。")}</p>}
              </>
            )}
          </section>

          {isWritten && session.schedule_kind === "open_window" && (
            <section className="sd-card sd-plan" aria-label={t("作答计划")}>
              <InterviewAnswerPlanSection session={session} canEdit={!archived && scheduled} onChanged={onChanged} />
            </section>
          )}
          {/* Written-test notes live in the 复盘笔记 card, the same field as an interview review. */}
          {!isWritten && (scheduled || session.prep_items.length > 0 || session.preparation_note) && (
              <>
                <PrepChecklistCard detail={detail} readOnly={archived || !scheduled} onChanged={() => void onChanged()} onNotice={onNotice} fallbackError={requestErrorMessage} />
                {session.preparation_note && <section className="sd-card" aria-label={t("准备提醒")}><header><h2>{t("准备提醒")}</h2></header><p className="sd-note">{session.preparation_note}</p></section>}
              </>
            )}
        </main>

        <aside className="sd-side">
          <section className="sd-side-card" aria-label={t("AI 分析报告")}>
            <header><h2>{t("AI 分析报告")}</h2>{report && <small>{formatMonthDay(report.generated_at)} {formatClock(report.generated_at)}</small>}</header>
            {reportV2 ? (
              <>
                <div className="sd-verdict"><Chip label={verdictLabel(reportV2.verdict.level).label} tone={verdictLabel(reportV2.verdict.level).tone} /><strong>{reviewScore100(reportV2) ?? "—"}<small> / 100</small></strong></div>
                <strong className="sd-report-summary">{reportV2.headline}</strong>
                <dl className="sd-bars">{reportV2.dimensions.map((item, index) => (
                  <div key={item.key}><dt>{dimensionLabel(item.key)}</dt><dd><span className={`sd-bar ${["is-green", "is-blue", "is-orange", "is-green", "is-blue"][index]}`}>{Array.from({ length: 5 }, (_, dot) => <i key={dot} className={item.score != null && dot < item.score ? "is-on" : ""} />)}</span><small>{item.assessed ? `${item.score} / 5` : t("未评估")}</small></dd></div>
                ))}</dl>
                {session.review_stale && <p className="sd-muted">{t("文字记录已修改，可以重新生成报告")}</p>}
                {generating && <p className="sd-muted">{t("正在后台重新生成…")}</p>}
                <button type="button" className="sd-outline-button" onClick={() => navigateTo(reportPath)}>{t("查看完整报告 →")}</button>
              </>
            ) : reportV1 ? (
              <>
                <strong className="sd-report-summary">{reportV1.summary}</strong>
                <dl className="sd-bars">{([
                  [t("项目表达"), reportV1.project_expression.score, "is-green"],
                  [t("系统设计"), reportV1.system_design.score, "is-blue"],
                  [t("沟通表达"), reportV1.communication.score, "is-orange"],
                ] as const).map(([label, score, tone]) => (
                  <div key={label}><dt>{label}</dt><dd><span className={`sd-bar ${tone}`}>{Array.from({ length: 5 }, (_, index) => <i key={index} className={score != null && index < Math.round(score / 2) ? "is-on" : ""} />)}</span><small>{score == null ? "—" : `${Math.round(score / 2)} / 5`}</small></dd></div>
                ))}</dl>
                {session.review_stale && <p className="sd-muted">{t("文字记录已修改，可以重新生成报告")}</p>}
                <button type="button" className="sd-outline-button" onClick={() => navigateTo(reportPath)}>{t("查看完整报告 →")}</button>
              </>
            ) : (
              <>
                <Chip label={generating ? t("正在生成") : session.review_status === "failed" ? t("生成失败") : t("待生成")} tone={session.review_status === "failed" ? "red" : "gray"} />
                <p className="sd-muted">{text ? t("结合文字稿、投递简历、岗位要求和资料库内容，逐题打分并给出改进建议") : t("添加文字稿后，AI 会按问题拆分回答并给出改进建议")}</p>
                <button type="button" className="sd-primary-button" disabled={!text || generating || archived} onClick={() => setAnalysisOpen(true)}>{generating ? t("正在生成…") : t("AI 复盘")}</button>
              </>
            )}
          </section>

          <section className="sd-side-card" aria-label={t("复盘笔记")}>
            <header><h2>{t("复盘笔记")}</h2></header>
            {noteCount > 0 && <p className="sd-muted">{t("逐题笔记 {value0} 条，在完整报告的题目里查看", { value0: noteCount })}</p>}
            {session.review_summary?.trim() || session.improvement_markdown?.trim()
              ? <p className="sd-note is-clamped">{session.review_summary?.trim() || session.improvement_markdown}</p>
              : <p className="sd-muted">{t("按题记下回答与改进点，下一轮前回看")}</p>}
            {!archived && <button type="button" className="sd-outline-button" onClick={() => setNotesOpen(true)}>{session.review_summary?.trim() || session.improvement_markdown?.trim() ? t("继续写复盘 →") : t("写复盘")}</button>}
          </section>

          <section className="sd-side-card" aria-label={isWritten ? t("本场信息") : t("本轮信息")}>
            <header><h2>{isWritten ? t("本场信息") : t("本轮信息")}</h2></header>
            <dl className="sd-info">
              <div><dt>{t("时间")}</dt><dd>{range(session)}</dd></div>
              <div><dt>{t("方式")}</dt><dd>{modeText(session)}</dd></div>
              {!isWritten && <div><dt>{t("面试官")}</dt><dd>{[session.interviewer_name, session.interviewer_title].filter(Boolean).join(" · ") || "—"}</dd></div>}
              {isWritten && questions.length > 0 && <div><dt>{t("题量")}</dt><dd>{t("{value0} 题", { value0: questions.length })}</dd></div>}
              <div><dt>{t("结果")}</dt><dd className={`is-${status.tone}`}>{status.label}</dd></div>
            </dl>
          </section>
        </aside>
      </div>

      <MotionPresence>{contentDialog && <AddInterviewContentDialog session={session} recordKind={recordKind} initialMode={contentDialog} onClose={() => setContentDialog(null)} onChanged={() => void onChanged()} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{editTextOpen && <AddInterviewContentDialog session={session} recordKind={recordKind} mode="edit" initialText={text} onClose={() => setEditTextOpen(false)} onChanged={() => void onChanged()} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{deleteTextOpen && <DeleteInterviewTextConfirmDialog session={session} recordKind={recordKind} onClose={() => setDeleteTextOpen(false)} onDeleted={() => void onChanged()} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{scheduleOpen && <EditInterviewScheduleDialog onSaved={onSaved} session={session} recordKind={recordKind} onClose={() => setScheduleOpen(false)} onChanged={onChanged} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{importOpen && <WrittenImportDialog detail={detail} onClose={() => setImportOpen(false)} onChanged={onChanged} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{notesOpen && <ReviewNotesDialog session={session} onClose={() => setNotesOpen(false)} onChanged={onChanged} onNotice={onNotice} />}</MotionPresence>
      <MotionPresence>{analysisOpen && <AiReviewDialog detail={detail} audioName={audio?.original_file_name ?? null} onClose={() => setAnalysisOpen(false)} onDone={() => navigateTo(reportPath)} onChanged={onChanged} onNotice={onNotice} />}</MotionPresence>
    </div>
  );
}

function AudioBar({ asset, onNotice }: { asset: InterviewSessionDetail["assets"][number]; onNotice: (notice: string) => void }) {
  useLocale();
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const total = (asset.duration_ms ?? 0) / 1000;
  const toggle = async () => {
    if (audioRef.current) {
      if (audioRef.current.paused) void audioRef.current.play().catch(() => onNotice(t("录音暂时无法播放，请稍后重试。")));
      else audioRef.current.pause();
      return;
    }
    try { setUrl(URL.createObjectURL(await api.downloadInterviewAsset(asset.id))); }
    catch { onNotice(t("录音加载失败，请稍后重试。")); }
  };
  return (
    <div className="sd-audio" aria-label={t("面试录音播放器")}>
      <button type="button" className="sd-play" aria-label={playing ? t("暂停录音") : t("播放录音")} onClick={() => void toggle()}><Icon name={playing ? "stop" : "play"} size={13} /></button>
      <small>{stamp(playhead)}</small>
      <span className="sd-wave" aria-hidden="true">{Array.from({ length: 48 }, (_, index) => <i key={index} className={total && index / 48 < playhead / total ? "is-played" : ""} style={{ height: `${6 + ((index * 7) % 13)}px` }} />)}</span>
      <small>{total ? stamp(total) : "—"}</small>
      {url && <audio ref={audioRef} autoPlay src={url} onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => onNotice(t("录音暂时无法播放。"))} />}
    </div>
  );
}

function ReviewNotesDialog({ session, onClose, onChanged, onNotice }: {
  session: InterviewSessionRecord;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const [summary, setSummary] = useState(session.review_summary ?? "");
  const [improvement, setImprovement] = useState(session.improvement_markdown ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.updateInterviewSession(session.id, { review_summary: summary.trim() || null, improvement_markdown: improvement.trim() || null, base_lock_version: session.lock_version });
      onClose();
      await onChanged();
    } catch (error) {
      onNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <V3Dialog width={640} label={t("复盘笔记")} onClose={() => { if (!busy) onClose(); }} className="sd-dialog">
      <header><h2>{t("复盘笔记")}</h2><p>{session.stage_label}</p></header>
      <label className="sd-field">{t("这一轮的复盘")}<textarea aria-label={t("这一轮的复盘")} value={summary} maxLength={100_000} placeholder={t("哪些问题答得好，哪里卡住了")} onChange={(event) => setSummary(event.target.value)} /></label>
      <label className="sd-field">{t("下次怎么答")}<textarea aria-label={t("下次怎么答")} value={improvement} maxLength={100_000} placeholder={t("先一句结论，再讲动机和自己负责的部分")} onChange={(event) => setImprovement(event.target.value)} /></label>
      <footer><button type="button" className="v3-btn" disabled={busy} onClick={onClose}>{t("取消")}</button><button type="button" className="v3-btn v3-btn-dark" disabled={busy} onClick={() => void save()}>{busy ? t("保存中…") : t("保存")}</button></footer>
    </V3Dialog>
  );
}

/** 05.N22 · AI 复盘: show what the analysis is based on, then start it. */
function AiReviewDialog({ detail, audioName, onClose, onDone, onChanged, onNotice }: {
  detail: InterviewSessionDetail;
  audioName: string | null;
  onClose: () => void;
  onDone: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const { session, application } = detail;
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const sources = [
    { badge: "PDF", name: application.resume_title_snapshot ?? t("投递简历"), meta: t("投递简历"), ready: Boolean(application.resume_title_snapshot) },
    { badge: audioName ? (audioName.split(".").pop() ?? "").toUpperCase().slice(0, 4) : "TXT", name: audioName ?? t("面试文字稿"), meta: audioName ? t("录音 · 已转写") : t("文字记录"), ready: Boolean(session.questions_markdown?.trim()) },
    { badge: "INFO", name: session.stage_label, meta: [range(session), session.interviewer_name].filter(Boolean).join(" · "), ready: true },
    { badge: "MD", name: t("{value0}_岗位JD.md", { value0: application.company_name_snapshot }), meta: t("岗位要求"), ready: Boolean(application.job_description_id) },
    { badge: "LIB", name: t("资料库"), meta: t("按题自动召回相关资料作为佐证"), ready: true },
  ];
  const start = async () => {
    setBusy(true);
    try {
      await api.generateInterviewReview(session.id, { request_id: requestId, base_lock_version: session.lock_version });
      onNotice(t("已开始生成 AI 复盘，通常需要 1–3 分钟。"));
      await onChanged();
      onClose();
      onDone();
    } catch (error) {
      onNotice(error instanceof ApiRequestError && error.message === "LLM_MODEL_NOT_CONFIGURED"
        ? t("请先配置模拟面试的 AI 模型，再生成复盘。")
        : t("复盘生成失败，原记录和已有报告已保留。"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <V3Dialog width={560} label={t("AI 复盘")} onClose={() => { if (!busy) onClose(); }} className="sd-dialog">
      <header><h2>{t("AI 复盘")}</h2><p>{[application.company_name_snapshot, application.job_title_snapshot, session.stage_label, formatMonthDay(session.start_at)].join(" · ")}</p></header>
      <h3>{t("分析依据")}</h3>
      <ul className="sd-sources">{sources.map((source) => (
        <li key={source.badge + source.name}>
          <span className="sd-file-badge" aria-hidden="true">{source.badge}</span>
          <div><strong>{source.name}</strong><small>{source.meta}</small></div>
          <Chip label={source.ready ? t("已就绪") : t("未提供")} tone={source.ready ? "green" : "gray"} />
        </li>
      ))}</ul>
      <footer><button type="button" className="v3-btn" disabled={busy} onClick={onClose}>{t("取消")}</button><button type="button" className="v3-btn v3-btn-dark" disabled={busy || !session.questions_markdown?.trim()} onClick={() => void start()}>{busy ? t("正在分析…") : t("开始分析")}</button></footer>
    </V3Dialog>
  );
}
