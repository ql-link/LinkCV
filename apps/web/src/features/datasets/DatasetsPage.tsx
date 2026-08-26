import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Database, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";

import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
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

export const MAX_DATASET_BYTES = 10 * 1024 * 1024;
export const MAX_DATASET_BATCH_FILES = 10;
export const DATASET_UPLOAD_CONCURRENCY = 3;
const SUPPORTED_DATASET_EXTENSIONS = ["docx", "pdf", "md", "txt"];

type Notice = { kind: "success" | "error"; message: string } | null;
type DatasetVisualStatus = "processing" | "succeeded" | "failed";
type UploadItemStatus = "ready" | "uploading" | "failed";
type UploadItem = {
  id: string;
  file: File;
  status: UploadItemStatus;
  error: string | null;
  retryable: boolean;
};
type DatasetAction = { kind: "rename" | "retry" | "delete"; id: string } | null;

const FAILURE_REASON_LABELS: Record<NonNullable<DatasetRecord["failure_reason"]>, string> = {
  format_unsupported: "文件格式不受支持，请重新选择文件。",
  content_invalid: "文件内容无效，请检查后重新上传。",
  size_exceeded: "文件内容超出解析限制，请缩小文件后重试。",
  service_unavailable: "解析服务暂不可用，请稍后重试。",
  timeout: "解析超时，请稍后重试。",
  quota_exceeded: "当前资料数量已达上限。",
  internal_error: "解析失败，请稍后重试。",
};

export function datasetFormatError(file: File): string | null {
  if (file.size === 0) return "文件为空，请重新选择。";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_DATASET_EXTENSIONS.includes(extension)) {
    return "仅支持 DOCX、PDF、Markdown 和 TXT 文件。";
  }
  if (file.size > MAX_DATASET_BYTES) {
    return "文件过大，最大支持 10 MB。";
  }
  return null;
}

export function datasetUploadErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiRequestError)) return fallback;

  switch (error.message) {
    case "INVALID_DATASET_FILENAME":
      return "文件名无效，请重命名后再上传。";
    case "UNSUPPORTED_DATASET_FORMAT":
      return "仅支持 DOCX、PDF、Markdown 和 TXT 文件。";
    case "EMPTY_DATASET_FILE":
      return "文件为空，请重新选择。";
    case "DATASET_TOO_LARGE":
      return "文件过大，最大支持 10 MB。";
    case "DATASET_UPLOAD_FAILED":
      return "上传失败，请稍后重试。";
    case "DATASET_RECORD_FAILED":
      return "资料保存失败，请稍后重试。";
    case "DATASET_QUEUE_UNAVAILABLE":
      return "资料已保存，但解析服务暂不可用，已标记为解析失败。";
    default:
      if (error.status === 401) return "登录状态已失效，请重新登录。";
      return error.status >= 500 ? "服务暂时不可用，请稍后重试。" : fallback;
  }
}

function datasetActionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiRequestError)) return fallback;
  switch (error.message) {
    case "INVALID_DATASET_NAME":
      return "资料名称不能为空，不能包含路径符号或控制字符。";
    case "DATASET_NOT_FOUND":
      return "这份资料不存在或你无权操作。";
    case "DATASET_IN_PROGRESS":
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
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  return "processing";
}

function datasetStatusLabel(status: DatasetVisualStatus) {
  if (status === "succeeded") return "解析完成";
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
  return (
    <span className={`dataset-status is-${status}`} title={reason ?? undefined}>
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
  onFilesSelect,
}: {
  disabled: boolean;
  onFilesSelect: (files: File[]) => void;
}) {
  return (
    <FileUpload
      accept=".docx,.pdf,.md,.txt,application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      inputLabel="选择资料文件"
      supportingText="支持 DOCX、PDF、Markdown 和 TXT；一次最多 10 个，每个不超过 10 MB"
      disabled={disabled}
      multiple
      onFilesSelect={onFilesSelect}
    />
  );
}

export function DatasetsPage() {
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const uploadItemSequence = useRef(0);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [fading, setFading] = useState(false);
  const [previewDataset, setPreviewDataset] = useState<DatasetRecord | null>(null);
  const [menuDatasetId, setMenuDatasetId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DatasetRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetRecord | null>(null);
  const [busyAction, setBusyAction] = useState<DatasetAction>(null);

  useEffect(() => {
    if (!notice) return;
    setFading(false);
    const fadeTimer = window.setTimeout(() => setFading(true), 3000);
    const removeTimer = window.setTimeout(() => setNotice(null), 3300);
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
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.listDatasets();
        if (!cancelled) {
          setDatasets(data.datasets);
          setLoadFailed(false);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasActiveParsing = datasets.some((dataset) => datasetVisualStatus(dataset) === "processing");

  useEffect(() => {
    if (!hasActiveParsing) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void api.listDatasets().then((data) => {
        if (!cancelled) setDatasets(data.datasets);
      }).catch(() => undefined);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveParsing]);

  const refresh = async () => {
    const data = await api.listDatasets();
    setDatasets(data.datasets);
    setLoadFailed(false);
  };

  const openUploadDialog = () => {
    setDialogOpen(true);
    setNotice(null);
  };

  const closeUploadDialog = () => {
    if (uploading) return;
    setDialogOpen(false);
    setUploadItems([]);
  };

  const appendFiles = (files: File[]) => {
    if (files.length === 0) return;
    const available = MAX_DATASET_BATCH_FILES - uploadItems.length;
    if (available <= 0) {
      setNotice({ kind: "error", message: `一次最多选择 ${MAX_DATASET_BATCH_FILES} 个文件。` });
      return;
    }
    const selected = files.slice(0, available);
    const nextItems = selected.map((file) => {
      const error = datasetFormatError(file);
      return {
        id: `dataset-upload-${uploadItemSequence.current++}`,
        file,
        status: error ? "failed" as const : "ready" as const,
        error,
        retryable: false,
      };
    });
    setUploadItems((items) => [...items, ...nextItems]);
    if (files.length > available) {
      setNotice({ kind: "error", message: `一次最多选择 ${MAX_DATASET_BATCH_FILES} 个文件，已保留前 ${MAX_DATASET_BATCH_FILES} 个。` });
    } else {
      setNotice(null);
    }
  };

  const removeUploadItem = (id: string) => {
    if (uploading) return;
    setUploadItems((items) => items.filter((item) => item.id !== id));
  };

  const retryUploadItem = (id: string) => {
    if (uploading) return;
    setUploadItems((items) => items.map((item) => item.id === id
      ? { ...item, status: "ready", error: null, retryable: false }
      : item));
  };

  const confirmUpload = async () => {
    if (uploading) return;
    const itemsToUpload = uploadItems.filter((item) => item.status === "ready" && !item.error);
    if (itemsToUpload.length === 0) {
      setNotice({ kind: "error", message: "请先选择至少一个符合要求的文件。" });
      return;
    }

    setUploading(true);
    setNotice(null);
    const itemIds = new Set(itemsToUpload.map((item) => item.id));
    setUploadItems((items) => items.map((item) => itemIds.has(item.id) ? { ...item, status: "uploading" } : item));

    const successfulIds = new Set<string>();
    const savedParseFailureIds = new Set<string>();
    const failedMessages = new Map<string, string>();
    let nextIndex = 0;
    const uploadOne = async (item: UploadItem) => {
      try {
        await api.uploadDataset(item.file);
        successfulIds.add(item.id);
      } catch (error) {
        if (error instanceof ApiRequestError && error.message === "DATASET_QUEUE_UNAVAILABLE") {
          savedParseFailureIds.add(item.id);
          return;
        }
        failedMessages.set(item.id, datasetUploadErrorMessage(error, "上传失败，请稍后重试。"));
      }
    };
    const worker = async () => {
      while (nextIndex < itemsToUpload.length) {
        const item = itemsToUpload[nextIndex];
        nextIndex += 1;
        if (item) await uploadOne(item);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(DATASET_UPLOAD_CONCURRENCY, itemsToUpload.length) }, () => worker()),
    );

    // Upload errors can still mean that the server saved a failed parse record.
    // Always read the authoritative list after the batch instead of inserting rows locally.
    await refresh().catch(() => undefined);

    setUploadItems((items) => items
      .filter((item) => !successfulIds.has(item.id) && !savedParseFailureIds.has(item.id))
      .map((item) => failedMessages.has(item.id)
        ? {
            ...item,
            status: "failed" as const,
            error: failedMessages.get(item.id) ?? "上传失败，请稍后重试。",
            retryable: true,
          }
        : item.status === "uploading" ? { ...item, status: "ready" as const } : item));
    setUploading(false);

    const remainingFailures = uploadItems.filter((item) => (
      !successfulIds.has(item.id) && !savedParseFailureIds.has(item.id)
    )).length;
    if (remainingFailures === 0) {
      setDialogOpen(false);
      setUploadItems([]);
      if (savedParseFailureIds.size > 0) {
        setNotice({
          kind: "error",
          message: `${savedParseFailureIds.size} 份资料已保存但解析提交失败，请在列表中重新解析。`,
        });
      } else {
        setNotice({ kind: "success", message: `已上传 ${successfulIds.size} 份资料，正在后台解析。` });
      }
    } else {
      const acceptedCount = successfulIds.size + savedParseFailureIds.size;
      setNotice({ kind: "error", message: acceptedCount > 0
        ? `${acceptedCount} 份资料已保存，${remainingFailures} 份需要处理。`
        : "没有资料上传成功，请检查失败项后重试。" });
    }
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
      setDatasets((items) => items.map((item) => item.id === updated.id ? updated : item));
      setNotice({ kind: "success", message: "已重新提交解析。" });
    } catch (error) {
      await refresh().catch(() => undefined);
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
  const uploadableCount = uploadItems.filter((item) => item.status === "ready" && !item.error).length;
  const uploadBusyLabel = uploadItems.length > 0
    ? `正在上传（${uploadItems.filter((item) => item.status === "uploading").length}/${uploadItems.filter((item) => item.status === "uploading" || item.status === "ready").length}）`
    : "正在上传…";

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
              <Button variant="secondary" onClick={() => window.location.reload()}>重新加载</Button>
            </section>
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
            <button className="dataset-dialog-close" type="button" aria-label="关闭上传窗口" onClick={closeUploadDialog}><X size={18} /></button>
            <h2 id="dataset-upload-title">上传资料</h2>
            <p>一次选择多个文件，逐项校验并提交解析。</p>

            <DatasetDropzone disabled={uploading} onFilesSelect={appendFiles} />

            {uploadItems.length > 0 && (
              <div className="dataset-pending-block" aria-label="待上传的文件">
                <p className="dataset-pending-label">待上传文件（{uploadItems.length}/{MAX_DATASET_BATCH_FILES}）</p>
                <div className="dataset-upload-queue">
                  {uploadItems.map((item) => (
                    <div key={item.id} className={`dataset-pending-row is-${item.status}`}>
                      <span className="dataset-meta">
                        <strong className="dataset-name" title={item.file.name}>{item.file.name}</strong>
                        <small className="dataset-sub">
                          <span>{formatFileSize(item.file.size)}</span>
                          <span>{item.status === "uploading" ? "正在提交…" : item.status === "failed" ? item.error : "等待上传"}</span>
                        </small>
                      </span>
                      <span className="dataset-pending-actions">
                        {item.retryable && (
                          <button type="button" className="dataset-text-btn" disabled={uploading} onClick={() => retryUploadItem(item.id)} aria-label={`重试上传 ${item.file.name}`}>重试上传</button>
                        )}
                        <button type="button" className="dataset-text-btn" disabled={uploading} onClick={() => removeUploadItem(item.id)} aria-label={`移除 ${item.file.name}`}>移除</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="dataset-dialog-hint">资料进入列表后只展示正在解析、解析完成或解析失败状态。</p>

            <footer className="dataset-dialog-actions">
              <Button variant="ghost" disabled={uploading} onClick={closeUploadDialog}>取消</Button>
              <Button disabled={uploading || uploadableCount === 0} onClick={() => void confirmUpload()} aria-busy={uploading}>
                {uploading ? uploadBusyLabel : "上传资料"}
              </Button>
            </footer>
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
          <FeedbackNotice kind={notice.kind}>{notice.message}</FeedbackNotice>
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
