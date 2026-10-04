import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError, type InterviewSessionDetail } from "@/api/client";
import { t, useLocale } from "@/i18n";
import { Dialog as V3Dialog } from "@/v3/primitives";
import { formatMonthDay } from "./applicationDetailModel";
import { requestErrorMessage } from "./CareerDetailViews";
import "./stageDetailPage.css";

type Source = "text" | "images" | "dataset";
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function importError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INTERVIEW_QUESTIONS_NOT_FOUND: t("没有识别到题目，请检查内容后重试。"),
      INTERVIEW_IMPORT_MODEL_NOT_CONFIGURED: t("识别模型还没有配置，请联系管理员。"),
      INTERVIEW_IMPORT_TEXT_TOO_LONG: t("内容超过 20,000 字，请分批导入。"),
      INTERVIEW_IMPORT_IMAGE_TOO_LARGE: t("每张截图不能超过 5MB。"),
      INTERVIEW_IMPORT_IMAGE_INVALID: t("截图无法识别，请上传 png、jpg 或 webp 图片。"),
      INTERVIEW_IMPORT_IMAGE_COUNT: t("一次最多上传 5 张截图。"),
      INTERVIEW_IMPORT_DATASET_NOT_READY: t("这份文件还没有解析完成，请稍后再试。"),
      INTERVIEW_IMPORT_TIMEOUT: t("识别超时，请稍后重试。"),
    };
    if (messages[error.message]) return messages[error.message];
  }
  return requestErrorMessage(error);
}

/** 05.N21 · 导入笔试题: three sources → numbered preview → save as the session's questions. */
export function WrittenImportDialog({ detail, onClose, onChanged, onNotice }: {
  detail: InterviewSessionDetail;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onNotice: (notice: string) => void;
}) {
  useLocale();
  const { session, application } = detail;
  const [source, setSource] = useState<Source>("text");
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }> | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [preview, setPreview] = useState<{ questions: Array<{ no: number; text: string }>; markdown: string } | null>(null);
  const [busy, setBusy] = useState<"extract" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (source !== "dataset" || datasets) return;
    let live = true;
    void api.listDatasets().then((result) => {
      if (!live) return;
      setDatasets(result.datasets
        .filter((item) => (item.asset_kind ?? "document") === "document" && item.parse_status === "succeeded")
        .map((item) => ({ id: item.id, name: item.file_name })));
    }).catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, [source, datasets]);

  const ready = source === "text" ? text.trim().length > 0 : source === "images" ? images.length > 0 : Boolean(datasetId);
  const extract = async () => {
    setBusy("extract");
    setError(null);
    try {
      const result = await api.extractWrittenQuestions(session.id,
        source === "text" ? { kind: "text", text } : source === "images" ? { kind: "images", files: images } : { kind: "dataset", datasetId });
      setPreview(result);
    } catch (caught) {
      setError(importError(caught));
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!preview) return;
    setBusy("save");
    try {
      await api.updateInterviewSession(session.id, { questions_markdown: preview.markdown, base_lock_version: session.lock_version });
      onClose();
      await onChanged();
      onNotice(t("已导入 {value0} 道题。", { value0: preview.questions.length }));
    } catch (caught) {
      setError(requestErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };
  const pickImages = (files: FileList | null) => {
    const picked = Array.from(files ?? []);
    if (picked.length > MAX_IMAGES) { setError(t("一次最多上传 5 张截图。")); return; }
    if (picked.some((file) => file.size > MAX_IMAGE_BYTES)) { setError(t("每张截图不能超过 5MB。")); return; }
    setError(null);
    setPreview(null);
    setImages(picked);
  };
  const tabs: Array<{ key: Source; label: string; icon: string }> = [
    { key: "text", label: t("粘贴文本"), icon: "≡" },
    { key: "images", label: t("上传截图"), icon: "▣" },
    { key: "dataset", label: t("资料库文档"), icon: "⇪" },
  ];

  return (
    <V3Dialog width={880} label={t("导入笔试题")} onClose={() => { if (!busy) onClose(); }} className="sd-dialog wi-dialog">
      <header><h2>{t("导入笔试题")}</h2><p>{[application.company_name_snapshot, application.job_title_snapshot, session.stage_label, formatMonthDay(session.start_at)].join(" · ")}</p></header>
      <div className="wi-body">
        <aside className="wi-summary">
          <small>{t("导入后")}</small>
          <ul>
            <li><strong>{t("题目列表")}</strong><span>{t("按题号拆分，保存为这一场的题目")}</span></li>
            <li><strong>{t("作答记录")}</strong><span>{t("逐题记录作答结果与思路")}</span></li>
            <li><strong>{t("截图不保存")}</strong><span>{t("截图只用于这一次识别，识别后即丢弃")}</span></li>
          </ul>
          {session.questions_markdown?.trim() && <p className="wi-warning">{t("确认导入会替换这一场现有的题目。")}</p>}
        </aside>
        <div className="wi-main">
          <h3>{t("导入方式")}</h3>
          <div className="wi-tabs" role="tablist" aria-label={t("导入方式")}>
            {tabs.map((tab) => (
              <button key={tab.key} type="button" role="tab" aria-selected={source === tab.key} disabled={Boolean(busy)}
                onClick={() => { setSource(tab.key); setPreview(null); setError(null); }}>
                <span aria-hidden="true">{tab.icon}</span>{tab.label}
              </button>
            ))}
          </div>
          {source === "text" && (
            <label className="sd-field">{t("题目内容")}
              <textarea aria-label={t("题目内容")} value={text} maxLength={20_000} placeholder={t("把笔试题目粘贴到这里，一道题一段或带题号都可以")}
                onChange={(event) => { setText(event.target.value); setPreview(null); }} />
            </label>
          )}
          {source === "images" && (
            <div className="wi-images">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label={t("选择截图")} onChange={(event) => pickImages(event.target.files)} />
              <button type="button" className="sd-outline-button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>{images.length ? t("重新选择截图") : t("选择截图")}</button>
              <small>{images.length ? images.map((file) => file.name).join("、") : t("最多 5 张，按顺序识别，每张不超过 5MB")}</small>
            </div>
          )}
          {source === "dataset" && (
            <label className="sd-field">{t("资料库文档")}
              <select aria-label={t("资料库文档")} value={datasetId} disabled={!datasets} onChange={(event) => { setDatasetId(event.target.value); setPreview(null); }}>
                <option value="">{datasets ? datasets.length ? t("选择一份已解析的 PDF 或 Word 文档") : t("资料库还没有可用的文档") : t("正在加载…")}</option>
                {datasets?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
          {error && <p className="wi-error" role="alert">{error}</p>}
          <h3>{t("识别结果")}{preview && <small>{t("识别到 {value0} 题", { value0: preview.questions.length })}</small>}</h3>
          {preview
            ? <ol className="wi-preview">{preview.questions.map((item) => <li key={item.no}><small>{String(item.no).padStart(2, "0")}</small><span>{item.text}</span></li>)}</ol>
            : <p className="sd-muted">{busy === "extract" ? t("正在识别…") : t("点击「识别题目」后在这里预览，确认无误再导入")}</p>}
        </div>
      </div>
      <footer>
        <button type="button" className="v3-btn" disabled={Boolean(busy)} onClick={onClose}>{t("取消")}</button>
        {preview
          ? <button type="button" className="v3-btn v3-btn-dark" disabled={Boolean(busy)} onClick={() => void save()}>{busy === "save" ? t("保存中…") : t("导入 {value0} 题", { value0: preview.questions.length })}</button>
          : <button type="button" className="v3-btn v3-btn-dark" disabled={!ready || Boolean(busy)} onClick={() => void extract()}>{busy === "extract" ? t("正在识别…") : t("识别题目")}</button>}
      </footer>
    </V3Dialog>
  );
}
