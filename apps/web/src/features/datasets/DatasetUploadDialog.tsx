import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type { DatasetLimits, DatasetRecord } from "../../api/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  FileUpload,
} from "@/components/ui";
import { formatDatasetFileSize } from "./datasetUploadValidation";
import { DatasetUploadConflictDialog, type DatasetConflict } from "./DatasetUploadConflictDialog";
import {
  useDatasetUploads,
  type DatasetUploadBatchResult,
} from "./useDatasetUploads";

export function DatasetUploadDialog({
  concurrency,
  folderId,
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
  const initialUploadStarted = useRef(false);
  const {
    uploading,
    uploadFiles,
  } = useDatasetUploads({
    limits,
    concurrency,
    folderId,
    onConflict: (file, error, targetFolderId) => new Promise((resolve) => {
      setConflicts((current) => [...current, {
        id: crypto.randomUUID(),
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
    void submitFiles(initialFiles);
  }, [initialFiles, submitFiles]);

  return (
    <>
      <Dialog open onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}>
        <DialogContent className="dataset-upload-dialog [&>[data-slot=dialog-close]]:hidden" aria-describedby={undefined}>
          <DialogHeader className="dataset-upload-dialog-header">
            <DialogTitle className="dataset-upload-dialog-title">上传资料</DialogTitle>
            <button
              type="button"
              className="dataset-dialog-close"
              aria-label="关闭上传窗口"
              disabled={busy}
              onClick={() => {
                if (!busy) onClose();
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </DialogHeader>

          <FileUpload
            className="dataset-file-upload"
            accept={`${limits.allowed_extensions.join(",")},application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document`}
            inputLabel="选择资料文件"
            supportingText={busy
              ? "正在上传…"
              : `支持 PDF、DOCX、Markdown、TXT · 单个不超过 ${formatDatasetFileSize(limits.max_file_bytes)}`}
            disabled={busy}
            multiple
            onFilesSelect={(files) => { void submitFiles(files); }}
          />
        </DialogContent>
      </Dialog>

      {conflicts[0] && (
        <DatasetUploadConflictDialog
          key={conflicts[0].id}
          conflict={conflicts[0]}
          onDone={() => setConflicts((current) => current.slice(1))}
        />
      )}
    </>
  );
}
