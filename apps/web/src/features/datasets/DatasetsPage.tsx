import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Database, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";

import { api, ApiRequestError, type DatasetLimits, type DatasetRecord } from "../../api/client";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ExpandableSearch,
  FeedbackNotice,
  FileUpload,
  PageLoading,
} from "@/components/ui";
import { DatasetPreviewDialog } from "./DatasetPreviewDialog";
import {
  datasetFormatError,
  datasetUploadErrorMessage,
  DEFAULT_DATASET_LIMITS,
  formatDatasetFileSize,
  normalizeDatasetLimits,
} from "./datasetUploadValidation";
import { useDatasetUploads, type DatasetUploadFailure } from "./useDatasetUploads";

export const MAX_DATASET_BYTES = DEFAULT_DATASET_LIMITS.max_file_bytes;
export const MAX_DATASET_BATCH_FILES = DEFAULT_DATASET_LIMITS.max_files_per_batch;
export const DATASET_UPLOAD_CONCURRENCY = 3;

type Notice = { kind: "success" | "error"; message: string } | null;
type DatasetVisualStatus = "queued" | "processing" | "succeeded" | "failed";
type DatasetAction = { kind: "rename" | "retry" | "delete"; id: string } | null;

function formatUploadFailureNotice(failures: DatasetUploadFailure[], limitMessage?: string | null) {
  const trimTerminalPunctuation = (value: string) => value.replace(/[。；，、\s]+$/u, "");
  const details = failures
    .map(({ fileName, reason }) => `${fileName}：${trimTerminalPunctuation(reason)}`)
    .join("；");
  const prefix = failures.length === 1 ? "文件上传失败：" : "部分文件上传失败：";
  const limitSuffix = limitMessage ? `；${trimTerminalPunctuation(limitMessage)}` : "";
  return `${prefix}${details}${limitSuffix}`;
}

const FAILURE_REASON_LABELS: Record<NonNullable<DatasetRecord["failure_reason"]>, string> = {
  format_unsupported: "文件格式不受支持，请重新选择文件。",
  content_invalid: "文件内容无效，请检查后重新上传。",
  size_exceeded: "文件内容超出解析限制，请缩小文件后重试。",
  service_unavailable: "解析服务暂不可用，请稍后重试。",
  timeout: "解析超时，请稍后重试。",
  quota_exceeded: "当前资料数量已达上限。",
  internal_error: "解析失败，请稍后重试。",
};

export { datasetFormatError, datasetUploadErrorMessage } from "./datasetUploadValidation";

function datasetActionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiRequestError)) return fallback;
  switch (error.message) {
    case "INVALID_DATASET_NAME":
      return "资料名称不能为空，不能包含路径符号或控制字符。";
    case "DATASET_NOT_FOUND":
      return "这份资料不存在或你无权操作。";
    case "DATASET_IN_PROGRESS":
    case "DATASET_BUSY":
      return "资料正在解析，处理完成后再删除。";
    case "DATASET_NOT_RETRYABLE":
      return "只有解析失败的资料可以重新解析。";
    case "DATASET_SOURCE_UNAVAILABLE":
      return "原始文件已不可用，请重新上传资料。";
    case "DATASET_QUEUE_UNAVAILABLE":
      return "解析服务暂不可用，资料已保留为解析失败。";
    case "ASSET_DELETE_FAILED":
      return "资料清理失败，请稍后重试。";
    default:
      if (error.status === 401) return "登录状态已失效，请重新登录。";
      return error.status >= 500 ? "服务暂时不可用，请稍后重试。" : fallback;
  }
}

function formatFileSize(bytes: number) {
  return formatDatasetFileSize(bytes);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

export function datasetDisplayName(dataset: Pick<DatasetRecord, "file_name" | "file_format">) {
  const suffix = `.${dataset.file_format}`;
  return dataset.file_name.toLowerCase().endsWith(suffix.toLowerCase())
    ? dataset.file_name.slice(0, -suffix.length)
    : dataset.file_name;
}

function datasetVisualStatus(dataset: DatasetRecord): DatasetVisualStatus {
  if (dataset.parse_status === "succeeded") return "succeeded";
  if (dataset.parse_status === "failed" || dataset.upload_status === "failed") return "failed";
  if (dataset.parse_status === "processing") return "processing";
  return "queued";
}

function datasetStatusLabel(status: DatasetVisualStatus) {
  if (status === "queued") return "等待解析";
  if (status === "succeeded") return "可用";
  if (status === "failed") return "解析失败";
  return "正在解析";
}

function datasetStatusReason(dataset: DatasetRecord) {
  if (!dataset.failure_reason) return null;
  return FAILURE_REASON_LABELS[dataset.failure_reason] ?? FAILURE_REASON_LABELS.internal_error;
}

function DatasetStatus({ dataset }: { dataset: DatasetRecord }) {
  const status = datasetVisualStatus(dataset);
  const reason = status === "failed" ? datasetStatusReason(dataset) : null;
  const styleStatus = status === "queued" ? "processing" : status;
  return (
    <span
      className={`dataset-status is-${styleStatus}`}
      data-status={status}
      title={reason ?? undefined}
    >
      <span className="dataset-status-mark" aria-hidden="true" />
      {datasetStatusLabel(status)}
    </span>
  );
}

function DatasetRow({
  dataset,
  menuOpen,
  busy,
  onPreview,
  onToggleMenu,
  onRename,
  onRetry,
  onDelete,
}: {
  dataset: DatasetRecord;
  menuOpen: boolean;
  busy: boolean;
  onPreview: (dataset: DatasetRecord, trigger: HTMLElement) => void;
  onToggleMenu: (id: string) => void;
  onRename: (dataset: DatasetRecord) => void;
  onRetry: (dataset: DatasetRecord) => void;
  onDelete: (dataset: DatasetRecord) => void;
}) {
  const displayName = datasetDisplayName(dataset);
  const canPreview = datasetVisualStatus(dataset) === "succeeded";
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!canPreview || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onPreview(dataset, event.currentTarget);
  };

  return (
    <article
      className={`dataset-row${canPreview ? " is-clickable" : ""}`}
      role={canPreview ? "button" : undefined}
      tabIndex={canPreview ? 0 : undefined}
      aria-label={canPreview ? `打开「${displayName}」解析预览` : undefined}
      onClick={canPreview ? (event) => onPreview(dataset, event.currentTarget) : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="dataset-cell dataset-cell-name">
        <strong className="dataset-name" title={displayName}>{displayName}</strong>
      </div>
      <div className="dataset-cell dataset-cell-time">{formatDateTime(dataset.created_at)}</div>
      <div className="dataset-cell dataset-cell-size">{formatFileSize(dataset.file_size)}</div>
      <div className="dataset-cell dataset-cell-status"><DatasetStatus dataset={dataset} /></div>
      <div
        className="dataset-row-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="dataset-menu-trigger"
          aria-label={`打开「${displayName}」操作菜单`}
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={() => onToggleMenu(dataset.id)}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div
            className="dataset-action-menu"
            role="menu"
            aria-label={`${displayName} 操作`}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => onRename(dataset)}>
              <Pencil size={15} aria-hidden="true" />重命名
            </button>
            {datasetVisualStatus(dataset) === "failed" && (
              <button type="button" role="menuitem" onClick={() => onRetry(dataset)}>
                <RotateCcw size={15} aria-hidden="true" />重新解析
              </button>
            )}
            <button type="button" role="menuitem" className="is-danger" onClick={() => onDelete(dataset)}>
              <Trash2 size={15} aria-hidden="true" />删除
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function DatasetDropzone({
  disabled,
  uploading,
  limits,
  onFilesSelect,
}: {
  disabled: boolean;
  uploading: boolean;
  limits: DatasetLimits;
  onFilesSelect: (files: File[]) => void;
}) {
  const accept = limits.allowed_extensions.join(",");
  return (
    <FileUpload
      className="dataset-file-upload"
      accept={`${accept},application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document`}
      inputLabel="选择资料文件"
      supportingText={uploading
        ? "正在上传…"
        : `支持 PDF、DOCX、Markdown、TXT · 单个不超过 ${formatFileSize(limits.max_file_bytes)}`}
      disabled={disabled}
      multiple
      onFilesSelect={onFilesSelect}
    />
  );
}

const ACCEPTED_SYNC_FAILURE = "资料已接受，但列表同步失败";

function upsertDataset(items: DatasetRecord[], dataset: DatasetRecord): DatasetRecord[] {
  const index = items.findIndex((item) => item.id === dataset.id);
  if (index < 0) return [dataset, ...items];
  return items.map((item) => item.id === dataset.id ? dataset : item);
}

function mergeDatasetResponse(
  datasets: DatasetRecord[],
  locallyAccepted: Map<string, DatasetRecord>,
): DatasetRecord[] {
  const serverIds = new Set(datasets.map((dataset) => dataset.id));
  for (const id of serverIds) locallyAccepted.delete(id);
  const missingAccepted = Array.from(locallyAccepted.values());
  return missingAccepted.length > 0 ? [...missingAccepted, ...datasets] : datasets;
}

export function DatasetsPage() {
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const locallyAccepted = useRef(new Map<string, DatasetRecord>());
  const pageMounted = useRef(true);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [limits, setLimits] = useState<DatasetLimits>(DEFAULT_DATASET_LIMITS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const [previewDataset, setPreviewDataset] = useState<DatasetRecord | null>(null);
  const [menuDatasetId, setMenuDatasetId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DatasetRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetRecord | null>(null);
  const [busyAction, setBusyAction] = useState<DatasetAction>(null);

  const refreshDatasets = useCallback(async (options: { initial?: boolean; accepted?: boolean } = {}) => {
    const { initial = false, accepted = false } = options;
    try {
      const data = await api.listDatasets();
      if (!pageMounted.current) return false;
      const nextLimits = normalizeDatasetLimits(data.limits);
      setLimits(nextLimits);
      setDatasets(mergeDatasetResponse(data.datasets, locallyAccepted.current));
      setLoadFailed(false);
      setSyncFailure(null);
      return true;
    } catch {
      if (!pageMounted.current) return false;
      if (initial) setLoadFailed(true);
      else setSyncFailure(accepted ? ACCEPTED_SYNC_FAILURE : "资料列表同步失败，请稍后重试。");
      return false;
    } finally {
      if (initial && pageMounted.current) setLoading(false);
    }
  }, []);

  const {
    uploading,
    uploadFiles,
  } = useDatasetUploads({
    limits,
    concurrency: DATASET_UPLOAD_CONCURRENCY,
    onAccepted: (dataset) => {
      if (!pageMounted.current) return;
      locallyAccepted.current.set(dataset.id, dataset);
      setDatasets((current) => upsertDataset(current, dataset));
      setLoadFailed(false);
    },
    onLimitExceeded: (message) => {
      setNotice(message ? { kind: "error", message } : null);
    },
  });

  useEffect(() => {
    if (!notice) return;
    setFading(false);
    const visibleDuration = notice.kind === "error" ? 5000 : 3000;
    const fadeTimer = window.setTimeout(() => setFading(true), visibleDuration);
    const removeTimer = window.setTimeout(() => setNotice(null), visibleDuration + 300);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [notice]);

  useEffect(() => {
    if (menuDatasetId === null) return;
    const closeMenu = () => setMenuDatasetId(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [menuDatasetId]);

  useEffect(() => {
    pageMounted.current = true;
    void refreshDatasets({ initial: true });
    return () => {
      pageMounted.current = false;
    };
  }, []);

  const hasActiveParsing = datasets.some((dataset) => {
    const status = datasetVisualStatus(dataset);
    return status === "queued" || status === "processing";
  });

  useEffect(() => {
    if (!hasActiveParsing) return;
    let cancelled = false;
    let timer: number | undefined;
    let delay = 2000;
    let requestInFlight = false;

    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    const schedule = (wait: number) => {
      if (cancelled || document.visibilityState === "hidden") return;
      clearTimer();
      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, wait);
    };
    const poll = async () => {
      if (cancelled || requestInFlight || document.visibilityState === "hidden") return;
      requestInFlight = true;
      const refreshed = await refreshDatasets();
      requestInFlight = false;
      if (cancelled) return;
      if (refreshed) delay = 2000;
      else delay = Math.min(delay * 2, 30000);
      schedule(delay);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
      } else if (!requestInFlight) {
        schedule(0);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    schedule(delay);
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasActiveParsing]);

  const openUploadDialog = () => {
    setDialogOpen(true);
    setNotice(null);
  };

  const closeUploadDialog = () => {
    if (uploading) return;
    setDialogOpen(false);
  };

  const appendFiles = (files: File[]) => {
    if (files.length === 0 || uploading) return;
    setNotice(null);
    void (async () => {
      const result = await uploadFiles(files);
      if (!pageMounted.current) return;

      if (result.attemptedCount > 0) {
        await refreshDatasets({ accepted: result.acceptedCount > 0 });
      }

      setDialogOpen(false);
      if (result.failures.length > 0) {
        setNotice({
          kind: "error",
          message: formatUploadFailureNotice(result.failures, result.limitMessage),
        });
      } else if (result.deferredCount > 0) {
        setNotice({
          kind: "error",
          message: `资料已保存，但解析提交失败（${result.deferredCount} 份），请在列表中重新解析。`,
        });
      } else if (result.acceptedCount > 0) {
        setNotice({
          kind: "success",
          message: result.limitMessage
            ? `已上传 ${result.acceptedCount} 份资料，${result.limitMessage}`
            : `已上传 ${result.acceptedCount} 份资料，正在后台解析。`,
        });
      } else if (result.limitMessage) {
        setNotice({ kind: "error", message: result.limitMessage });
      }
    })();
  };

  const openPreview = (dataset: DatasetRecord, trigger: HTMLElement) => {
    if (menuDatasetId !== null) {
      setMenuDatasetId(null);
      return;
    }
    previewTriggerRef.current = trigger;
    setPreviewDataset(dataset);
  };

  const closePreview = () => setPreviewDataset(null);

  const startRename = (dataset: DatasetRecord) => {
    setMenuDatasetId(null);
    setRenameTarget(dataset);
    setRenameValue(datasetDisplayName(dataset));
    setRenameError(null);
  };

  const submitRename = async () => {
    if (!renameTarget || busyAction) return;
    const value = renameValue.trim();
    if (!value) {
      setRenameError("请输入资料名称。");
      return;
    }
    setBusyAction({ kind: "rename", id: renameTarget.id });
    setRenameError(null);
    try {
      const updated = await api.renameDataset(renameTarget.id, value);
      if (locallyAccepted.current.has(updated.id)) locallyAccepted.current.set(updated.id, updated);
      setDatasets((items) => items.map((item) => item.id === updated.id ? updated : item));
      setRenameTarget(null);
      setNotice({ kind: "success", message: "资料名称已更新。" });
    } catch (error) {
      setRenameError(datasetActionErrorMessage(error, "重命名失败，请稍后重试。"));
    } finally {
      setBusyAction(null);
    }
  };

  const startRetry = async (dataset: DatasetRecord) => {
    setMenuDatasetId(null);
    setBusyAction({ kind: "retry", id: dataset.id });
    setNotice(null);
    try {
      const updated = await api.retryDataset(dataset.id);
      if (locallyAccepted.current.has(updated.id)) locallyAccepted.current.set(updated.id, updated);
      setDatasets((items) => items.map((item) => item.id === updated.id ? updated : item));
      setNotice({ kind: "success", message: "已重新提交解析。" });
    } catch (error) {
      await refreshDatasets();
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, "重新解析失败，请稍后重试。") });
    } finally {
      setBusyAction(null);
    }
  };

  const startDelete = (dataset: DatasetRecord) => {
    setMenuDatasetId(null);
    setDeleteTarget(dataset);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || busyAction) return;
    setBusyAction({ kind: "delete", id: deleteTarget.id });
    try {
      await api.deleteDataset(deleteTarget.id);
      locallyAccepted.current.delete(deleteTarget.id);
      setDatasets((items) => items.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      setNotice({ kind: "success", message: `已删除「${datasetDisplayName(deleteTarget)}」。` });
    } catch (error) {
      setDeleteTarget(null);
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, "删除失败，请稍后重试。") });
    } finally {
      setBusyAction(null);
    }
  };

  const keyword = query.trim().toLocaleLowerCase();
  const filteredDatasets = useMemo(() => {
    if (!keyword) return datasets;
    return datasets.filter((dataset) => datasetDisplayName(dataset).toLocaleLowerCase().includes(keyword));
  }, [datasets, keyword]);
  return (
    <main className="dashboard-content datasets-page">
      <WorkspacePageHero
        icon={<Database />}
        tone="success"
        title="资料库"
        description={datasets.length > 0 ? `${datasets.length} 份资料 · 按最近上传排列` : "把履历、项目记录和参考资料集中在这里，写简历时随时调用。"}
        actions={(
          <>
            <ExpandableSearch
              label="搜索资料"
              name="dataset-search"
              value={query}
              onValueChange={setQuery}
              placeholder="搜索资料…"
              className="datasets-hero-search"
            />
            <Button variant="outline" icon={<Plus size={15} />} onClick={openUploadDialog}>上传资料</Button>
          </>
        )}
      />

      {loading ? (
        <PageLoading label="正在加载资料…" />
      ) : (
        <div className="datasets-body">
          {loadFailed && (
            <section className="dashboard-empty-state">
              <Database size={48} strokeWidth={1.2} />
              <h2>资料加载失败</h2>
              <p>请稍后重试。</p>
              <Button variant="secondary" onClick={() => void refreshDatasets({ initial: true })}>重新加载</Button>
            </section>
          )}

          {syncFailure && (
            <div className="datasets-toast dataset-sync-toast">
              <FeedbackNotice kind="error">
                <span>{syncFailure}</span>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => void refreshDatasets({ accepted: syncFailure === ACCEPTED_SYNC_FAILURE })}
                >
                  重新刷新
                </Button>
              </FeedbackNotice>
            </div>
          )}

          {!loadFailed && datasets.length === 0 && (
            <section className="datasets-empty">
              <h2>还没有资料</h2>
              <p>建议先上传一份与你当前求职方向相关的资料，<br />后续写简历时可以快速检索和引用。</p>
              <Button icon={<Plus size={15} />} onClick={openUploadDialog}>上传第一份资料</Button>
            </section>
          )}

          {!loadFailed && datasets.length > 0 && (
            <section className="dataset-list-card" aria-label="资料列表">
              <div className="dataset-list-header" aria-hidden="true">
                <span>资料名称</span>
                <span>上传时间</span>
                <span>大小</span>
                <span>解析状态</span>
                <span />
              </div>
              {filteredDatasets.length === 0 ? (
                <p className="dataset-list-empty">没有匹配的资料。</p>
              ) : (
                filteredDatasets.map((dataset) => (
                  <DatasetRow
                    key={dataset.id}
                    dataset={dataset}
                    menuOpen={menuDatasetId === dataset.id}
                    busy={busyAction?.id === dataset.id}
                    onPreview={openPreview}
                    onToggleMenu={(id) => setMenuDatasetId((current) => current === id ? null : id)}
                    onRename={startRename}
                    onRetry={(item) => void startRetry(item)}
                    onDelete={startDelete}
                  />
                ))
              )}
            </section>
          )}
        </div>
      )}

      {dialogOpen && (
        <div className="dataset-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeUploadDialog();
        }}>
          <section className="dataset-dialog" role="dialog" aria-modal="true" aria-labelledby="dataset-upload-title">
            <button className="dataset-dialog-close" type="button" aria-label="关闭上传窗口" disabled={uploading} onClick={closeUploadDialog}><X size={18} /></button>
            <h2 id="dataset-upload-title">上传资料</h2>
            <p>选择文件后会立即上传并进入资料列表。</p>

            <DatasetDropzone disabled={uploading} uploading={uploading} limits={limits} onFilesSelect={appendFiles} />
          </section>
        </div>
      )}

      {renameTarget && (
        <Dialog open onOpenChange={(open) => {
          if (!open && !busyAction) setRenameTarget(null);
        }}>
          <DialogContent className="dataset-action-dialog">
            <DialogHeader>
              <DialogTitle>重命名资料</DialogTitle>
              <DialogDescription>只修改资料显示名称，不改变文件格式或已保存的内容。</DialogDescription>
            </DialogHeader>
            <label className="dataset-rename-field">
              <span>资料名称</span>
              <input
                autoFocus
                value={renameValue}
                maxLength={255}
                aria-label="资料名称"
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  setRenameError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitRename();
                  }
                }}
              />
              {renameError && <small role="alert">{renameError}</small>}
            </label>
            <DialogFooter>
              <Button variant="secondary" disabled={busyAction?.kind === "rename"} onClick={() => setRenameTarget(null)}>取消</Button>
              <Button disabled={busyAction?.kind === "rename"} onClick={() => void submitRename()}>
                {busyAction?.kind === "rename" ? "正在保存…" : "保存名称"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <ConfirmDialog
          kind="delete"
          title={`永久删除「${datasetDisplayName(deleteTarget)}」？`}
          description="删除后将移除源文件、解析结果和资料记录，且无法恢复。"
          confirmLabel="永久删除"
          busyLabel="正在删除…"
          busy={busyAction?.kind === "delete"}
          onCancel={() => {
            if (!busyAction) setDeleteTarget(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {notice && (
        <div className={`datasets-toast${fading ? " is-fading" : ""}`}>
          <FeedbackNotice kind={notice.kind}>
            <span className="dataset-notice-message" title={notice.message}>{notice.message}</span>
          </FeedbackNotice>
        </div>
      )}

      {previewDataset && (
        <DatasetPreviewDialog
          dataset={previewDataset}
          returnFocusTo={previewTriggerRef.current}
          onClose={closePreview}
        />
      )}
    </main>
  );
}
