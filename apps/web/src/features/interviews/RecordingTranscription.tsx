import { useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import { api, ApiRequestError, type InterviewSessionRecord, type InterviewTranscriptionTask } from "@/api/client";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui";
import { t, useLocale } from "@/i18n";

const active = (task: InterviewTranscriptionTask | null) => Boolean(task && ["queued", "submitting", "transcribing"].includes(task.status));

export function transcriptionError(code: string | null): string {
  const messages: Record<string, string> = {
    INTERVIEW_TRANSCRIPTION_MODEL_UNAVAILABLE: t("录音转写暂不可用，请联系管理员配置文件识别模型。"),
    INTERVIEW_TRANSCRIPTION_MEDIA_UNAVAILABLE: t("录音转写暂不可用，请联系管理员配置音频下载地址。"),
    INTERVIEW_TRANSCRIPTION_BUSY: t("已有录音正在转写，请完成或取消后再试。"),
    INTERVIEW_TRANSCRIPTION_SUBMIT_UNCERTAIN: t("提交结果无法确认，重试可能再次计费。"),
    INTERVIEW_TRANSCRIPTION_NO_SPEECH: t("没有识别到有效语音，请检查原录音。"),
    INTERVIEW_TRANSCRIPTION_EXPIRED: t("转写等待已超时，可以重新发起。"),
    INTERVIEW_TRANSCRIPTION_CONFIG_CHANGED: t("识别模型配置已改变，请重新发起转写。"),
    INTERVIEW_EDIT_CONFLICT: t("这条面试已在其他页面更新，请刷新后再试。"),
    INTERVIEW_INVALID_TRANSITION: t("当前求职进度不允许执行这个操作。"),
  };
  return code && messages[code] ? messages[code] : t("转写暂时失败，原录音和文字记录已保留。请稍后重试。");
}

function TranscriptionDraft({ session, task, onClose, onChanged }: {
  session: InterviewSessionRecord; task: InterviewTranscriptionTask; onClose: () => void; onChanged: () => void;
}) {
  const [text, setText] = useState(task.text ?? "");
  // Freeze the text/version the user reviewed; a later refresh must not overwrite it silently.
  const [original] = useState(session.questions_markdown ?? "");
  const [version] = useState(session.lock_version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const merged = [original.trim(), text.trim()].filter(Boolean).join("\n\n");
  const tooLong = merged.length > 500000;
  const save = async () => {
    if (!text.trim() || tooLong || busy) return;
    setBusy(true); setError(null);
    try {
      await api.updateInterviewSession(session.id, { base_lock_version: version, questions_markdown: merged });
      onChanged(); onClose();
    } catch (caught) {
      setError(transcriptionError(caught instanceof ApiRequestError ? caught.message : null));
    } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="career-content-dialog">
      <DialogHeader><DialogTitle>{t("校对转写文字")}</DialogTitle><DialogDescription>{t("检查识别稿，确认后追加到本场面试的文字记录。原有文字会保留。")}</DialogDescription></DialogHeader>
      <section className="career-content-text-method">
        <textarea aria-label={t("转写文字")} value={text} onChange={(event) => setText(event.target.value)} />
        {tooLong && <p role="alert">{t("追加后超过 500,000 字符，请整理后再保存。全文已保留。")}</p>}
        {error && <p role="alert">{error}</p>}
      </section>
      <DialogFooter className="career-content-dialog-footer">
        <Button variant="outline" disabled={busy} onClick={onClose}>{t("取消")}</Button>
        <Button disabled={busy || !text.trim() || tooLong} onClick={() => void save()}>{busy ? t("保存中…") : t("确认加入文字记录")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function RecordingTranscription({ session, datasetId, readOnly, onChanged }: {
  session: InterviewSessionRecord; datasetId: string; readOnly: boolean; onChanged: () => void;
}) {
  useLocale();
  const [task, setTask] = useState<InterviewTranscriptionTask | null>(null);
  const [capability, setCapability] = useState<{ available: boolean; error_code: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    let stopped = false;
    setLoaded(false);
    const load = async () => {
      try {
        const [current, configured] = await Promise.all([
          api.getInterviewTranscription(session.id, datasetId), api.interviewTranscriptionCapability(session.id),
        ]);
        if (!stopped) { setTask(current.task); setCapability(configured); setError(null); setLoaded(true); }
      } catch { if (!stopped) setError(t("转写状态加载失败，请重试。")); }
    };
    void load();
    return () => { stopped = true; };
  }, [session.id, datasetId, reload]);
  useEffect(() => {
    if (!active(task)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.getInterviewTranscription(session.id, datasetId);
        if (!stopped) { setTask(result.task); setError(null); }
        if (!stopped && active(result.task)) timer = setTimeout(() => void poll(), 3000);
      } catch {
        if (!stopped) { setError(t("查询暂时失败，后台转写仍会继续。")); timer = setTimeout(() => void poll(), 5000); }
      }
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [session.id, datasetId, task?.id, task?.status]);
  const start = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await api.createInterviewTranscription(session.id, datasetId, requestId.current);
      setTask(result.task); requestId.current = null;
    } catch (caught) { setError(transcriptionError(caught instanceof ApiRequestError ? caught.message : null)); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!task || busy) return;
    setBusy(true); setError(null);
    try { setTask((await api.cancelInterviewTranscription(session.id, datasetId, task.id)).task); }
    catch (caught) { setError(transcriptionError(caught instanceof ApiRequestError ? caught.message : null)); }
    finally { setBusy(false); }
  };
  return <section className="career-recording-transcription" aria-label={t("录音转写")}>
    <div className="career-recording-transcription-actions">
      {active(task) ? <><span role="status"><LoaderCircle aria-hidden="true" />{task?.status === "queued" ? t("等待转写") : task?.status === "submitting" ? t("正在提交") : t("正在转写")}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}>{t("取消转写")}</Button></>
        : task?.status === "ready" ? <Button size="sm" variant="outline" icon={<FileText />} disabled={readOnly} onClick={() => setShowDraft(true)}>{t("校对转写文字")}</Button>
        : <Button size="sm" variant="outline" icon={<FileText />} disabled={busy || readOnly || !loaded || !capability?.available} onClick={() => void start()}>{busy ? t("正在提交") : task ? t("重新转写") : t("转成文字")}</Button>}
      {!loaded && error && <Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>{t("重试")}</Button>}
    </div>
    {active(task) && <p>{t("离开页面不影响后台转写；取消后，模型已处理的部分仍可能计费。")}</p>}
    {task?.status === "ready" && <p>{t("识别稿已保存，校对确认后才会加入文字记录。")}</p>}
    {task?.status === "cancelled" && <p>{t("转写已取消，原录音和文字记录已保留。")}</p>}
    {task?.status === "failed" && <p role="alert">{transcriptionError(task.error_code)}</p>}
    {!active(task) && task?.status !== "ready" && capability && !capability.available && <p>{transcriptionError(capability.error_code)}</p>}
    {error && <p role="alert">{error}</p>}
    {showDraft && task?.status === "ready" && <TranscriptionDraft session={session} task={task} onClose={() => setShowDraft(false)} onChanged={onChanged} />}
  </section>;
}
