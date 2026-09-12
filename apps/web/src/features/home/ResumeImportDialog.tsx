import { useEffect, useState } from "react";
import { FileText, FileUp, X } from "lucide-react";
import { api, type ResumeTemplate } from "../../api/client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  FeedbackNotice,
  FileUpload,
  TextField,
} from "@/components/ui";
import {
  formatImportFileSize,
  importErrorMessage,
  resumeTitleFromFilename,
  validateImportTitle,
} from "@/lib/resumeImport";
import { useResumeStore } from "../../store/resumeStore";
import { selectImportTemplate } from "./importTemplate";

type ResumeImportDialogProps = {
  onClose: () => void;
  onAccepted: (filename: string) => void;
};

export function ResumeImportDialog({ onClose, onAccepted }: ResumeImportDialogProps) {
  const importResume = useResumeStore((state) => state.importResume);
  const [importTemplate, setImportTemplate] = useState<ResumeTemplate | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError("导入所需的默认版式暂时无法加载，请稍后重试。");
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

  const submit = async () => {
    if (submitting) return;
    if (!file) {
      setError("请先选择需要导入的文件。");
      return;
    }
    const titleError = validateImportTitle(title, file.name);
    if (titleError) {
      setError(titleError);
      return;
    }
    if (!importTemplate) {
      setError("导入所需的默认版式暂时不可用，请稍后重试。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await importResume(file, importTemplate.id, title);
      onAccepted(title.trim());
      onClose();
    } catch (reason) {
      setError(importErrorMessage(reason));
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <AlertDialogContent
        className="home-import-dialog"
        overlayClassName="bg-[var(--scrim)]"
        aria-label="导入简历"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>导入简历</AlertDialogTitle>
          <AlertDialogDescription className="home-import-description">选择已有文件并确认名称，系统会在当前简历列表中开始解析。</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="home-import-fields">
          <div className="home-import-file-field">
            <span className="home-import-field-label">简历文件</span>
            <FileUpload
              name="resume-file"
              accept=".md,.docx,.pdf,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              inputLabel="选择 Markdown、DOCX 或 PDF 文件"
              supportingText="支持 Markdown、DOCX、PDF，最大 10 MB"
              disabled={submitting}
              file={file}
              onFileSelect={(selected) => pickFile(selected ?? null)}
            />
            {file && (
              <div className="home-import-file-summary">
                <span className="home-import-file-type" aria-hidden="true"><FileText /></span>
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatImportFileSize(file.size)} · 已准备</small>
                </span>
                <button type="button" aria-label="移除文件" disabled={submitting} onClick={() => pickFile(null)}>
                  <X />
                </button>
              </div>
            )}
          </div>

          <TextField
            label="简历名称"
            hint="默认使用所选文件名（不含扩展名），可修改。"
            name="resume-title"
            autoComplete="off"
            value={title}
            maxLength={255}
            placeholder="例如：张三｜产品经理…"
            disabled={submitting}
            onChange={(event) => {
              setTitleTouched(true);
              setTitle(event.target.value);
              setError(null);
            }}
          />
        </div>

        {error && <FeedbackNotice kind="error">{error}</FeedbackNotice>}

        <AlertDialogFooter className="home-import-actions">
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <Button
            variant="accent"
            icon={<FileUp />}
            disabled={submitting || loadingTemplate}
            onClick={() => void submit()}
          >
            {submitting ? "正在导入…" : loadingTemplate ? "正在准备…" : "导入并开始解析"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
