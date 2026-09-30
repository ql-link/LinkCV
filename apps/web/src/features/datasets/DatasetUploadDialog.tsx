import { MotionPresence } from "@/components/ui/motion";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DatasetLimits, DatasetRecord } from "../../api/client";
import { Icon } from "../../v3/Icon";
import { Dialog, DialogFooter } from "../../v3/primitives";
import { UploadArt } from "./components/DatasetArt";
import { formatDatasetFileSize } from "./datasetUploadValidation";
import { DatasetUploadConflictDialog, type DatasetConflict } from "./DatasetUploadConflictDialog";
import {
  useDatasetUploads,
  type DatasetUploadBatchResult,
} from "./useDatasetUploads";

// 06.1a 上传资料（560 宽）：虚线拖放区 → 「上传到」当前文件夹 → 底部「未选择文件 / 取消 / 上传」。
// 先选择（或拖入）文件，再点「上传」提交；从页面直接拖入的文件（initialFiles）会立即上传。
export function DatasetUploadDialog({
  concurrency,
  folderId,
  folderName,
  initialFiles,
  limits,
  onAccepted,
  onComplete,
  onLimitExceeded,
  onUploadingChange,
  onClose,
  retryKeys,
}: {
  concurrency: number;
  folderId: string;
  folderName?: string;
  initialFiles: File[];
  limits: DatasetLimits;
  onAccepted: (dataset: DatasetRecord) => void;
  onComplete: (result: DatasetUploadBatchResult) => Promise<void>;
  onLimitExceeded: (message: string) => void;
  onUploadingChange: (uploading: boolean) => void;
  onClose: () => void;
  retryKeys: Map<string, string>;
}) {
  const [conflicts, setConflicts] = useState<DatasetConflict[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialUploadStarted = useRef(false);
  const { uploading, uploadFiles } = useDatasetUploads({
    limits,
    concurrency,
    folderId,
    onConflict: (file, error, targetFolderId) => new Promise((resolve) => {
      setConflicts((current) => [...current, {
        id: typeof crypto !== "undefined" && crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        file,
        folderId: targetFolderId,
        candidates: (error.payload?.candidates ?? []) as DatasetConflict["candidates"],
        suggestedName: String(error.payload?.suggested_name ?? file.name),
        resolve,
      }]);
    }),
    onAccepted,
    onLimitExceeded,
    retryKeys,
  });
  const busy = submitting || uploading;

  const submitFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setSubmitting(true);
    onUploadingChange(true);
    try {
      await onComplete(await uploadFiles(files));
    } finally {
      setSubmitting(false);
      onUploadingChange(false);
    }
  }, [busy, onComplete, onUploadingChange, uploadFiles]);

  useEffect(() => {
    if (initialUploadStarted.current || initialFiles.length === 0) return;
    initialUploadStarted.current = true;
    setPicked(initialFiles);
    void submitFiles(initialFiles);
  }, [initialFiles, submitFiles]);

  // 自绘关闭按钮时 Dialog 不处理 Esc，这里补上：上传中不允许关闭
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && conflicts.length === 0) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, conflicts.length, onClose]);

  const pick = (files: File[]) => {
    if (busy || files.length === 0) return;
    setPicked(files);
  };

  const totalBytes = picked.reduce((sum, file) => sum + file.size, 0);
  const summary = busy
    ? "正在上传…"
    : picked.length === 0
      ? "未选择文件"
      : picked.length === 1
        ? `${picked[0].name} · ${formatDatasetFileSize(totalBytes)}`
        : `已选择 ${picked.length} 个文件 · ${formatDatasetFileSize(totalBytes)}`;
  const mediaLimit = formatDatasetFileSize(limits.max_media_file_bytes ?? 500 * 1024 * 1024);
  const accept = `${limits.allowed_extensions.join(",")},${(limits.media_allowed_extensions ?? []).join(",")},application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*,video/mp4,video/webm,video/quicktime`;

  return (
    <>
      <Dialog width={560} label="上传资料" onClose={() => { if (!busy) onClose(); }} className="ds-dialog" closable={false}>
        <button type="button" className="v3-dialog-close" aria-label="关闭上传窗口" disabled={busy} onClick={() => { if (!busy) onClose(); }}>
          <Icon name="x" size={16} />
        </button>
        <div className="v3-dialog-body">
          <h2 className="v3-dialog-title">上传资料</h2>
          <p className="v3-dialog-sub">简历附件、证书、作品集、岗位 JD 和面试录音都可以放在这里。</p>
          <button
            type="button"
            className={`ds-upload-drop${dragOver ? " is-over" : ""}`}
            data-autofocus
            disabled={busy}
            aria-describedby="ds-upload-hint"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOver(false);
              pick(Array.from(event.dataTransfer?.files ?? []));
            }}
          >
            <UploadArt />
            <span className="ds-upload-drop-title">{busy ? "正在上传…" : "拖入资料文件，或点击选择"}</span>
            <span className="ds-upload-drop-hint" id="ds-upload-hint">
              PDF、DOCX、Markdown、TXT 最大 {formatDatasetFileSize(limits.max_file_bytes)}；音视频最大 {mediaLimit}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple
            accept={accept}
            aria-label="选择资料文件"
            disabled={busy}
            onChange={(event) => {
              pick(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <div className="ds-target">
            <div className="ds-target-copy">
              <strong>上传到</strong>
              <small>当前文件夹，之后可以移动到别的文件夹</small>
            </div>
            <span className="ds-target-folder"><Icon name="folder" size={14} /><span>{folderName ?? "当前文件夹"}</span></span>
          </div>
        </div>
        <DialogFooter left={<span title={summary}>{summary}</span>}>
          <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 80 }} disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="v3-btn v3-btn-dark" style={{ width: 88 }} disabled={busy || picked.length === 0} onClick={() => void submitFiles(picked)}>
            {busy ? "上传中…" : "上传"}
          </button>
        </DialogFooter>
      </Dialog>

      <MotionPresence>{conflicts[0] && (
        <DatasetUploadConflictDialog
          key={conflicts[0].id}
          conflict={conflicts[0]}
          onDone={() => setConflicts((current) => current.slice(1))}
        />
      )}</MotionPresence>
    </>
  );
}
