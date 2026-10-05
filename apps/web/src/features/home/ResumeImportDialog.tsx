import { t, useLocale } from "@/i18n";
import { MotionPresence } from "@/components/ui/motion";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, type ResumeTemplate } from "../../api/client";
import {
  formatImportFileSize,
  importErrorMessage,
  resumeTitleFromFilename,
  validateImportTitle,
} from "@/lib/resumeImport";
import { useResumeStore } from "../../store/resumeStore";
import { Dialog, Toast } from "../../v3/primitives";
import { formatTag, ImportArt } from "./homeArt";
import { selectImportTemplate } from "./importTemplate";
import { useStableCallback } from "./useStableCallback";
import "./home-v3.css";

type ResumeImportDialogProps = {
  onClose: () => void;
  onAccepted: (filename: string) => void;
};

const ACCEPT = ".md,.docx,.pdf,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// 02.1b 导入简历（560 宽）：未选文件时是虚线拖入区；选好文件后换成单文件插图 + 文件卡；提交中文件卡下方出现进度
export function ResumeImportDialog({ onClose, onAccepted }: ResumeImportDialogProps) {
  useLocale();
  const importResume = useResumeStore((state) => state.importResume);
  const inputRef = useRef<HTMLInputElement>(null);
  const [importTemplate, setImportTemplate] = useState<ResumeTemplate | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<{ message: string; key: number } | null>(null);

  const close = useStableCallback(onClose);
  const fail = (message: string) => setError({ message, key: Date.now() });

  useEffect(() => {
    let cancelled = false;
    void api.listResumeTemplates().then(
      ({ templates }) => {
        if (cancelled) return;
        setImportTemplate(selectImportTemplate(templates));
        setLoadingTemplate(false);
      },
      () => {
        if (cancelled) return;
        fail(t("导入所需的默认版式暂时无法加载，请稍后重试。"));
        setLoadingTemplate(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const pickFile = (nextFile: File | null) => {
    setFile(nextFile);
    setError(null);
    if (!nextFile) {
      if (!titleTouched) setTitle("");
      return;
    }
    if (!titleTouched) setTitle(resumeTitleFromFilename(nextFile.name));
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (submitting) return;
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) pickFile(dropped);
  };

  const submit = async () => {
    if (submitting) return;
    if (!file) {
      fail(t("请先选择需要导入的文件。"));
      return;
    }
    const titleError = validateImportTitle(title, file.name);
    if (titleError) {
      fail(titleError);
      return;
    }
    if (!importTemplate) {
      fail(t("导入所需的默认版式暂时不可用，请稍后重试。"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await importResume(file, importTemplate.id, title);
      onAccepted(title.trim());
      onClose();
    } catch (reason) {
      fail(importErrorMessage(reason));
      setSubmitting(false);
    }
  };

  const format = file ? formatTag(file.name) : null;

  return (
    <Dialog width={560} label={t("导入简历")} onClose={close} closable={!submitting} className="hv3-import">
      <div className="v3-dialog-body">
        <h2 className="v3-dialog-title">{t("导入简历")}</h2>
        <p className="v3-dialog-sub">{t("AI 会把文件拆成可编辑的模块，之后可以随时修改。")}</p>

        {!file ? (
          <div
            className={`hv3-dropzone${dragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!submitting) setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={onDrop}
          >
            <span className="hv3-dropzone-art" aria-hidden="true"><ImportArt /></span>
            <strong>{t("拖入简历文件，或点击选择")}</strong>
            <small>{t("支持 Markdown、DOCX、PDF，最大 10 MB")}</small>
            <input
              ref={inputRef}
              className="hv3-dropzone-input"
              type="file"
              name="resume-file"
              accept={ACCEPT}
              aria-label={t("选择 Markdown、DOCX 或 PDF 文件")}
              disabled={submitting}
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={(event) => pickFile(event.currentTarget.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <>
            <div className="v3-stage has-dots hv3-import-stage"><ImportArt single filename={file.name} /></div>
            <div className={`hv3-file${submitting ? " is-busy" : ""}`}>
              <div className="hv3-file-row">
                <span className="hv3-file-type v3-num" style={{ color: format?.color, background: format?.color === "var(--v3-or)" ? "var(--v3-or-soft)" : format?.color === "var(--v3-bl)" ? "var(--v3-bl-soft)" : "var(--v3-field)" }}>
                  {format?.tag}
                </span>
                <span className="hv3-file-copy">
                  <strong title={file.name}>{file.name}</strong>
                  <small className="v3-num">{formatImportFileSize(file.size)}</small>
                </span>
                <button type="button" className="v3-link" aria-label={t("移除文件")} disabled={submitting} onClick={() => pickFile(null)}>{t("移除文件")}</button>
              </div>
              {submitting && (
                <div className="hv3-file-progress">
                  <span className="hv3-file-progress-copy">{t("正在导入… 上传完成后自动开始解析")}</span>
                  <span className="hv3-file-bar" role="progressbar" aria-label={t("{value0} 正在导入", { value0: file.name })} aria-valuetext={t("正在上传，暂时无法估算完成时间")}><span /></span>
                </div>
              )}
            </div>
          </>
        )}

        <label className="v3-field hv3-import-field">
          <span className="v3-field-label">{t("简历名称")}</span>
          <input
            className="v3-input is-filled"
            name="resume-title"
            autoComplete="off"
            aria-label={t("简历名称")}
            value={title}
            maxLength={255}
            placeholder={t("例如：张三｜产品经理")}
            disabled={submitting}
            onChange={(event) => {
              setTitleTouched(true);
              setTitle(event.target.value);
              setError(null);
            }}
          />
        </label>
      </div>

      <div className="v3-dialog-foot hv3-foot">
        <div className="v3-dialog-foot-left">
          <span className="hv3-foot-note">{file ? t("默认使用文件名（不含扩展名），可修改") : t("未选择文件")}</span>
        </div>
        <button type="button" className="v3-btn v3-btn-ghost hv3-foot-cancel" disabled={submitting} onClick={onClose}>{t("取消")}</button>
        <button
          type="button"
          className="v3-btn v3-btn-dark hv3-import-submit"
          disabled={submitting || loadingTemplate || !file}
          onClick={() => void submit()}
        >
          {submitting ? t("正在导入…") : loadingTemplate ? t("正在准备…") : t("导入并开始解析")}
        </button>
      </div>
      <MotionPresence>{error && <Toast key={error.key} kind="error" title={error.message} onDismiss={() => setError(null)} />}</MotionPresence>
    </Dialog>
  );
}
