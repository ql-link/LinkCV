import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  CheckSquare,
  ChevronLeft,
  Database,
  FolderOpen,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  api,
  ApiRequestError,
  type DatasetFolder,
  type DatasetLimits,
  type DatasetRecord,
} from "../../api/client";
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
  Input,
  Label,
  PageLoading,
} from "@/components/ui";
import { DatasetPreviewDialog } from "./DatasetPreviewDialog";
import { DatasetUploadConflictDialog, type DatasetConflict } from "./DatasetUploadConflictDialog";
import { CreateFolderCard, FolderCard } from "./components/FolderCard";
import { FileCard } from "./components/FileCard";
import { MoveToFolderDialog } from "./components/MoveToFolderDialog";
import { datasetsPath, navigateTo } from "../../routing";
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
type DatasetAction = { kind: "rename" | "retry" | "delete" | "bulk-delete"; id: string } | null;

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
    case "FOLDER_NOT_FOUND":
      return "文件夹不存在或已被删除，请重新选择。";
    case "FOLDER_DELETE_CONFIRMATION_REQUIRED":
      return "文件夹内包含资料，请确认后再删除。";
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

type DatasetDeleteFailure = { dataset: DatasetRecord; reason: string };

function formatBulkDeleteNotice(
  successCount: number,
  failures: DatasetDeleteFailure[],
  totalCount: number,
) {
  const trimTerminalPunctuation = (value: string) => value.replace(/[。；，、\s]+$/u, "");
  const details = failures
    .map(({ dataset, reason }) => `${datasetDisplayName(dataset)}：${trimTerminalPunctuation(reason)}`)
    .join("；");
  if (failures.length === 0) return `已删除 ${successCount} 份资料。`;
  if (successCount === 0) return `所选 ${totalCount} 份资料删除失败：${details}`;
  return `已删除 ${successCount} 份资料，${failures.length} 份删除失败：${details}`;
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

export function DatasetSelectionCheckbox({
  checked,
  disabled,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={checkboxRef}
      className="dataset-selection-checkbox"
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

function DatasetRow({
  dataset,
  batchMode,
  selected,
  selectionDisabled,
  menuOpen,
  busy,
  onPreview,
  onToggleSelection,
  onToggleMenu,
  onRename,
  onMove,
  onRetry,
  onDelete,
}: {
  dataset: DatasetRecord;
  batchMode: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  menuOpen: boolean;
  busy: boolean;
  onPreview: (dataset: DatasetRecord, trigger: HTMLElement) => void;
  onToggleSelection: (id: string, checked: boolean) => void;
  onToggleMenu: (id: string) => void;
  onRename: (dataset: DatasetRecord) => void;
  onMove: (dataset: DatasetRecord) => void;
  onRetry: (dataset: DatasetRecord) => void;
  onDelete: (dataset: DatasetRecord) => void;
}) {
  const displayName = datasetDisplayName(dataset);
  const canPreview = datasetVisualStatus(dataset) === "succeeded";
  const isInteractive = canPreview && !batchMode;
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isInteractive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onPreview(dataset, event.currentTarget);
  };

  return (
    <article
      className={`dataset-row${isInteractive ? " is-clickable" : ""}`}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `打开「${displayName}」解析预览` : undefined}
      onClick={isInteractive ? (event) => onPreview(dataset, event.currentTarget) : undefined}
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
        {batchMode ? (
          <div className="dataset-selection-cell dataset-row-selection">
            <DatasetSelectionCheckbox
              checked={selected}
              disabled={selectionDisabled}
              label={`选择「${displayName}」`}
              onChange={(checked) => onToggleSelection(dataset.id, checked)}
            />
          </div>
        ) : (
          <>
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
                <button type="button" role="menuitem" onClick={() => onMove(dataset)}>
                  <FolderInput size={15} aria-hidden="true" />移动到文件夹
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
          </>
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

export function DatasetsPage({ initialFolderId }: { initialFolderId?: string } = {}) {
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const [previewDataset, setPreviewDataset] = useState<DatasetRecord | null>(null);
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
  const [conflicts,setConflicts] = useState<DatasetConflict[]>([]);
  const [pendingReplacementIds,setPendingReplacementIds] = useState<Set<string>>(new Set());
  const [menuDatasetId, setMenuDatasetId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DatasetRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetRecord | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<DatasetRecord[] | null>(null);
  const [busyAction, setBusyAction] = useState<DatasetAction>(null);
  const [fading, setFading] = useState(false);

  const [folders, setFolders] = useState<DatasetFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(() => initialFolderId || "all");
  const [totalCount, setTotalCount] = useState(0);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [moveTarget, setMoveTarget] = useState<DatasetRecord | null>(null);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);

  // 上传与页面拖拽状态
  const [pageDragOver, setPageDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // 文件夹弹窗状态
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [renameFolderTarget, setRenameFolderTarget] = useState<DatasetFolder | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renameFolderError, setRenameFolderError] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState(false);

  const [deleteFolderTarget, setDeleteFolderTarget] = useState<DatasetFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);

  const refreshFolders = useCallback(async () => {
    try {
      const data = await api.listDatasetFolders();
      if (!pageMounted.current) return;
      setFolders(data.folders);
      setTotalCount(data.total_count);
      setUncategorizedCount(data.uncategorized_count);
    } catch {
      // non-blocking
    }
  }, []);

  const validateFolderName = (name: string): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return "文件夹名称不能为空";
    if (trimmed.includes("/") || trimmed.includes("\\")) return "文件夹名称不能包含斜杠符号";
    if (trimmed.length > 64) return "文件夹名称不能超过 64 个字符";
    return null;
  };

  const handleCreateFolder = async () => {
    const error = validateFolderName(newFolderName);
    if (error) {
      setCreateFolderError(error);
      return;
    }
    setCreatingFolder(true);
    setCreateFolderError(null);
    try {
      await api.createDatasetFolder(newFolderName.trim());
      await refreshFolders();
      setCreateFolderDialogOpen(false);
      setNewFolderName("");
      setNotice({ kind: "success", message: `文件夹「${newFolderName.trim()}」已创建。` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "FOLDER_NAME_DUPLICATE") {
        setCreateFolderError("已存在同名文件夹，请使用其他名称");
      } else if (msg === "FOLDER_LIMIT_EXCEEDED") {
        setCreateFolderError("最多创建 50 个文件夹");
      } else {
        setCreateFolderError("创建失败，请检查名称后重试");
      }
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameFolderTarget) return;
    const error = validateFolderName(renameFolderName);
    if (error) {
      setRenameFolderError(error);
      return;
    }
    setRenamingFolder(true);
    setRenameFolderError(null);
    try {
      await api.renameDatasetFolder(renameFolderTarget.id, renameFolderName.trim());
      await refreshFolders();
      setRenameFolderTarget(null);
      setNotice({ kind: "success", message: "文件夹名称已更新。" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "FOLDER_NAME_DUPLICATE") {
        setRenameFolderError("已存在同名文件夹，请使用其他名称");
      } else {
        setRenameFolderError("重命名失败，请重试");
      }
    } finally {
      setRenamingFolder(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    setDeletingFolder(true);
    try {
      await api.deleteDatasetFolder(deleteFolderTarget.id);
      if (selectedFolderId === deleteFolderTarget.id) {
        setSelectedFolderId("all");
        navigateTo(datasetsPath("all"), { replace: true });
      }
      await refreshFolders();
      await refreshDatasets();
      setDeleteFolderTarget(null);
      setNotice({ kind: "success", message: "文件夹及其中的资料已删除。" });
    } catch (error) {
      setDeleteFolderTarget(null);
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, "删除失败，请稍后重试。") });
    } finally {
      setDeletingFolder(false);
    }
  };

  const confirmSingleMove = async (targetFolderId: string) => {
    if (!moveTarget) return;
    try {
      const updated = await api.moveDataset(moveTarget.id, targetFolderId);
      setDatasets((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      await refreshFolders();
      setNotice({ kind: "success", message: "资料分类已更新。" });
    } catch (error) {
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, "移动分类失败，请稍后重试。") });
    } finally {
      setMoveTarget(null);
    }
  };

  const confirmBatchMove = async (targetFolderId: string) => {
    if (selectedDatasetIds.size === 0) return;
    const ids = Array.from(selectedDatasetIds);
    try {
      await api.batchMoveDatasets(ids, targetFolderId);
      setDatasets((items) =>
        items.map((item) =>
          selectedDatasetIds.has(item.id) ? { ...item, folder_id: targetFolderId } : item,
        ),
      );
      await refreshFolders();
      setSelectedDatasetIds(new Set());
      setBatchMode(false);
      setNotice({ kind: "success", message: `已成功移动 ${ids.length} 份资料。` });
    } catch (error) {
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, "批量移动失败，请稍后重试。") });
    } finally {
      setBatchMoveOpen(false);
    }
  };

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

  useEffect(()=>{
    const start=(event:Event)=>setPendingReplacementIds(ids=>new Set([...ids,(event as CustomEvent<string>).detail]));
    const refresh=()=>{void refreshDatasets().then(ok=>{if(ok)setPendingReplacementIds(new Set());});};
    window.addEventListener("dataset-replacement-start",start);window.addEventListener("dataset-replacement-refresh",refresh);
    return()=>{window.removeEventListener("dataset-replacement-start",start);window.removeEventListener("dataset-replacement-refresh",refresh);};
  },[refreshDatasets]);
  useEffect(()=>{if(!datasets.some(d=>d.replacement?.status==="pending"))return;const timer=setInterval(()=>void refreshDatasets(),2000);return()=>clearInterval(timer);},[datasets,refreshDatasets]);

  const canUploadHere = selectedFolderId !== "all" && selectedFolderId !== "uncategorized";
  const effectiveUploadFolderId = canUploadHere
    ? selectedFolderId
    : null;

  const {
    uploading,
    uploadFiles,
  } = useDatasetUploads({
    limits,
    concurrency: DATASET_UPLOAD_CONCURRENCY,
    folderId: effectiveUploadFolderId,
    onConflict: (file,error,folderId) => new Promise(resolve=>{setConflicts(current=>[...current,{id:crypto.randomUUID(),file,folderId,candidates:(error.payload?.candidates??[]) as DatasetConflict["candidates"],suggestedName:String(error.payload?.suggested_name??file.name),resolve}]);}),
    onAccepted: (dataset) => {
      if (!pageMounted.current) return;
      setPendingReplacementIds(ids=>{const next=new Set(ids);next.delete(dataset.id);return next;});
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
    const closeMenu = () => {
      setMenuDatasetId(null);
    };
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [menuDatasetId]);

  useEffect(() => {
    pageMounted.current = true;
    void Promise.all([
      refreshDatasets({ initial: true }),
      refreshFolders(),
    ]);
    return () => {
      pageMounted.current = false;
    };
  }, [refreshDatasets, refreshFolders]);

  useEffect(() => {
    const nextFolderId = initialFolderId || "all";
    setSelectedFolderId((current) => (current === nextFolderId ? current : nextFolderId));
  }, [initialFolderId]);

  useEffect(() => {
    const syncRouteFromState = () => {
      const url = new URL(window.location.href);
      if (url.pathname === "/datasets") {
        const queryFolderId = url.searchParams.get("folder") || "all";
        setSelectedFolderId((current) => (current === queryFolderId ? current : queryFolderId));
      }
    };
    window.addEventListener("popstate", syncRouteFromState);
    return () => window.removeEventListener("popstate", syncRouteFromState);
  }, []);

  const handleSelectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    navigateTo(datasetsPath(folderId));
  };

  const handleBackToAll = () => {
    setBatchMode(false);
    setSelectedDatasetIds(new Set());
    setSelectedFolderId("all");
    navigateTo(datasetsPath("all"));
  };

  useEffect(() => {
    const existingIds = new Set(datasets.map((dataset) => dataset.id));
    setSelectedDatasetIds((current) => {
      const next = new Set(Array.from(current).filter((id) => existingIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [datasets]);

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
      if (refreshed) await refreshFolders();
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
    if (!canUploadHere) return;
    setDialogOpen(true);
    setNotice(null);
  };

  const closeUploadDialog = () => {
    if (uploading) return;
    setDialogOpen(false);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (canUploadHere && e.dataTransfer?.types?.includes("Files")) {
      setPageDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setPageDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setPageDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) {
      appendFiles(files);
    }
  };

  const appendFiles = (files: File[]) => {
    if (files.length === 0 || uploading) return;
    if (!canUploadHere || !effectiveUploadFolderId) {
      setNotice({ kind: "error", message: "请先进入文件夹再上传资料。" });
      return;
    }
    setNotice(null);
    void (async () => {
      const result = await uploadFiles(files);
      if (!pageMounted.current) return;

      if (result.attemptedCount > 0) {
        await Promise.all([
          refreshDatasets({ accepted: result.acceptedCount > 0 }),
          refreshFolders(),
        ]);
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
      void refreshFolders();
      setSelectedDatasetIds((ids) => {
        if (!ids.has(deleteTarget.id)) return ids;
        const next = new Set(ids);
        next.delete(deleteTarget.id);
        return next;
      });
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
    return datasets.map(dataset=>pendingReplacementIds.has(dataset.id)?{...dataset,replacement:{id:"",status:"pending" as const,upload_status:"uploading",parse_status:null,failure_code:null,retryable:false,current_revision:dataset.content_revision??"0"}}:dataset).filter((dataset) => {
      if (selectedFolderId === "all" || selectedFolderId === "uncategorized") {
        return false;
      } else if (dataset.folder_id !== selectedFolderId) {
        return false;
      }
      if (!keyword) return true;
      return datasetDisplayName(dataset).toLocaleLowerCase().includes(keyword);
    });
  }, [datasets, keyword, selectedFolderId, pendingReplacementIds]);

  const selectedDatasetCount = selectedDatasetIds.size;
  const filteredDatasetIds = filteredDatasets.map((dataset) => dataset.id);
  const allFilteredSelected = filteredDatasetIds.length > 0
    && filteredDatasetIds.every((id) => selectedDatasetIds.has(id));
  const someFilteredSelected = filteredDatasetIds.some((id) => selectedDatasetIds.has(id));
  const batchDeleteBusy = busyAction?.kind === "bulk-delete";

  const toggleBatchMode = () => {
    if (batchDeleteBusy) return;
    setMenuDatasetId(null);
    if (batchMode) {
      setBatchMode(false);
      setSelectedDatasetIds(new Set());
      return;
    }
    setSelectedDatasetIds(new Set());
    setBatchMode(true);
  };

  const toggleDatasetSelection = (id: string, checked: boolean) => {
    if (batchDeleteBusy) return;
    setSelectedDatasetIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllFilteredDatasets = (checked: boolean) => {
    if (batchDeleteBusy) return;
    setSelectedDatasetIds((current) => {
      const next = new Set(current);
      for (const id of filteredDatasetIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const startBulkDelete = () => {
    if (!batchMode || batchDeleteBusy || selectedDatasetCount === 0) return;
    const targets = datasets.filter((dataset) => selectedDatasetIds.has(dataset.id));
    if (targets.length === 0) {
      setSelectedDatasetIds(new Set());
      return;
    }
    setMenuDatasetId(null);
    setBulkDeleteTarget(targets);
  };

  const confirmBulkDelete = async () => {
    if (!bulkDeleteTarget || bulkDeleteTarget.length === 0 || busyAction) return;
    const targets = bulkDeleteTarget;
    const succeededIds = new Set<string>();
    const failures: DatasetDeleteFailure[] = [];
    setBusyAction({ kind: "bulk-delete", id: "bulk" });

    for (const target of targets) {
      try {
        await api.deleteDataset(target.id);
        succeededIds.add(target.id);
        locallyAccepted.current.delete(target.id);
      } catch (error) {
        failures.push({
          dataset: target,
          reason: datasetActionErrorMessage(error, "删除失败，请稍后重试。"),
        });
      }
    }

    if (succeededIds.size > 0) {
      setDatasets((items) => items.filter((item) => !succeededIds.has(item.id)));
      void refreshFolders();
      setSelectedDatasetIds((current) => {
        const next = new Set(current);
        for (const id of succeededIds) next.delete(id);
        return next;
      });
    }
    setBulkDeleteTarget(null);
    setBatchMode(false);
    setSelectedDatasetIds(new Set());
    setNotice({
      kind: failures.length > 0 ? "error" : "success",
      message: formatBulkDeleteNotice(succeededIds.size, failures, targets.length),
    });
    setBusyAction(null);
  };

  return (
    <main
      className="dashboard-content datasets-page"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {pageDragOver && (
        <div className="dataset-page-drag-overlay" aria-hidden="true">
          <div className="dataset-page-drag-content">
            <div className="dataset-page-drag-icon">
              <Upload size={32} />
            </div>
            <h3>释放鼠标立即上传</h3>
            <p>
              将直接上传至「
              {selectedFolderId !== "all" && selectedFolderId !== "uncategorized"
                ? folders.find((f) => f.id === selectedFolderId)?.name ?? "当前分类"
                : "未分类"}
              」
            </p>
          </div>
        </div>
      )}

      {uploading && (
        <div className="dataset-uploading-banner" role="status" aria-live="polite">
          <div className="dataset-uploading-spinner" aria-hidden="true" />
          <span>
            正在上传资料至「
            {effectiveUploadFolderId
              ? folders.find((f) => f.id === effectiveUploadFolderId)?.name ?? "当前分类"
              : "未分类"}
            」…
          </span>
        </div>
      )}
      {selectedFolderId !== "all" && (
        <nav className="dataset-folder-breadcrumb" aria-label="资料库路径">
          <button type="button" className="dataset-folder-back" onClick={handleBackToAll}>
            <ChevronLeft aria-hidden="true" />返回全部资料
          </button>
          <span aria-hidden="true">/</span>
          <span aria-current="page">
            {folders.find((folder) => folder.id === selectedFolderId)?.name ?? "文件夹"}
          </span>
        </nav>
      )}
      <WorkspacePageHero
        layout="module"
        icon={selectedFolderId === "all" ? <FolderOpen /> : undefined}
        tone="success"
        title={
          selectedFolderId === "all"
            ? "资料库"
            : folders.find((f) => f.id === selectedFolderId)?.name ?? "文件夹"
        }
        description={
          selectedFolderId === "all"
            ? datasets.length > 0
              ? `${datasets.length} 份资料 · 按最近上传排列`
              : "把履历、项目记录和参考资料集中在这里，写简历时随时调用。"
            : `共 ${filteredDatasets.length} 份资料`
        }
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
            {selectedFolderId === "all" && <Button
              className="datasets-hero-primary-action"
              variant="outline"
              icon={<FolderPlus size={15} />}
              disabled={batchMode}
              onClick={() => {
                setNewFolderName("");
                setCreateFolderError(null);
                setCreateFolderDialogOpen(true);
              }}
            >
              新建文件夹
            </Button>}
            {canUploadHere && <Button
              className="datasets-hero-primary-action"
              variant="outline"
              icon={<Plus size={15} />}
              disabled={batchMode}
              onClick={openUploadDialog}
            >
              上传资料
            </Button>}
            {selectedFolderId !== "all" && (
              <Button
                className="datasets-hero-batch-action"
                variant="outline"
                icon={batchMode ? <X size={15} /> : <CheckSquare size={15} />}
                disabled={batchDeleteBusy}
                onClick={toggleBatchMode}
              >
                {batchMode ? "取消操作" : "批量操作"}
              </Button>
            )}
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
            <FeedbackNotice
              kind="error"
              placement="floating"
              action={(
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => void refreshDatasets({ accepted: syncFailure === ACCEPTED_SYNC_FAILURE })}
                >
                  重新刷新
                </Button>
              )}
            >
              <span>{syncFailure}</span>
            </FeedbackNotice>
          )}

          {!loadFailed && (
            <>
              {selectedFolderId === "all" ? (
                <>
                  {/* 统一网格：分类文件夹与资料同级展示 */}
                  {datasets.length === 0 && folders.length === 0 ? (
                    <section className="datasets-empty">
                      <h2>还没有文件夹</h2>
                      <p>建议先新建文件夹分类整理，<br />后续写简历时可以快速检索和引用相关资料。</p>
                      <Button
                        icon={<FolderPlus size={15} />}
                        onClick={() => {
                          setNewFolderName("");
                          setCreateFolderError(null);
                          setCreateFolderDialogOpen(true);
                        }}
                      >
                        新建文件夹
                      </Button>
                    </section>
                  ) : (
                    <>
                      {/* 批量操作控制条（仅在批量模式下显示） */}


                      <div className="dataset-unified-grid" aria-label="资料与文件夹列表">
                        {folders.map((folder) => (
                          <FolderCard
                            key={folder.id}
                            folder={folder}
                            onClick={() => handleSelectFolder(folder.id)}
                            onRename={(f) => {
                              setRenameFolderTarget(f);
                              setRenameFolderName(f.name);
                              setRenameFolderError(null);
                            }}
                            onDelete={(f) => setDeleteFolderTarget(f)}
                          />
                        ))}
                        <CreateFolderCard
                          onClick={() => {
                            setNewFolderName("");
                            setCreateFolderError(null);
                            setCreateFolderDialogOpen(true);
                          }}
                        />
                        {filteredDatasets.map((dataset) => (
                          <FileCard
                            key={dataset.id}
                            dataset={dataset}
                            batchMode={batchMode}
                            selected={selectedDatasetIds.has(dataset.id)}
                            selectionDisabled={batchDeleteBusy}
                            menuOpen={menuDatasetId === dataset.id}
                            busy={busyAction?.id === dataset.id}
                            displayName={datasetDisplayName(dataset)}
                            isInteractive={datasetVisualStatus(dataset) === "succeeded" && !batchMode}
                            statusLabel={datasetStatusLabel(datasetVisualStatus(dataset))}
                            statusKind={datasetVisualStatus(dataset)}
                            statusReason={datasetStatusReason(dataset)}
                            onPreview={openPreview}
                            onToggleSelection={toggleDatasetSelection}
                            onToggleMenu={(id) => setMenuDatasetId((current) => current === id ? null : id)}
                            onRename={startRename}
                            onMove={(item) => setMoveTarget(item)}
                            onRetry={(item) => void startRetry(item)}
                            onDelete={startDelete}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* 文件夹内页视图 */
                <div className="dataset-folder-view">


                  {filteredDatasets.length === 0 ? (
                    query ? (
                      <p className="dataset-list-empty py-12 text-center text-muted-foreground text-sm">
                        没有匹配的资料。
                      </p>
                    ) : (
                      <section className="datasets-empty">
                        <h2>还没有资料</h2>
                        <p>
                          建议先上传一份与当前分类相关的资料，<br />
                          后续写简历时可以快速检索和引用。
                        </p>
                        <Button icon={<Plus size={15} />} onClick={openUploadDialog}>
                          上传第一份资料
                        </Button>
                      </section>
                    )
                  ) : (
                    <div className="dataset-unified-grid" aria-label="文件夹内部资料列表">
                      {filteredDatasets.map((dataset) => (
                        <FileCard
                          key={dataset.id}
                          dataset={dataset}
                          batchMode={batchMode}
                          selected={selectedDatasetIds.has(dataset.id)}
                          selectionDisabled={batchDeleteBusy}
                          menuOpen={menuDatasetId === dataset.id}
                          busy={busyAction?.id === dataset.id}
                          displayName={datasetDisplayName(dataset)}
                          isInteractive={datasetVisualStatus(dataset) === "succeeded" && !batchMode}
                          statusLabel={datasetStatusLabel(datasetVisualStatus(dataset))}
                          statusKind={datasetVisualStatus(dataset)}
                          statusReason={datasetStatusReason(dataset)}
                          onPreview={openPreview}
                          onToggleSelection={toggleDatasetSelection}
                          onToggleMenu={(id) => setMenuDatasetId((current) => current === id ? null : id)}
                          onRename={startRename}
                          onMove={(item) => setMoveTarget(item)}
                          onRetry={(item) => void startRetry(item)}
                          onDelete={startDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {dialogOpen && (
        <Dialog open onOpenChange={(open) => {
          if (!open && !uploading) setDialogOpen(false);
        }}>
          <DialogContent className="dataset-upload-dialog [&>[data-slot=dialog-close]]:hidden" aria-describedby={undefined}>
            <DialogHeader className="dataset-upload-dialog-header">
              <DialogTitle className="dataset-upload-dialog-title">上传资料</DialogTitle>
              <button
                type="button"
                className="dataset-dialog-close"
                aria-label="关闭上传窗口"
                disabled={uploading}
                onClick={() => {
                  if (!uploading) setDialogOpen(false);
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </DialogHeader>

            <DatasetDropzone disabled={uploading || !effectiveUploadFolderId} uploading={uploading} limits={limits} onFilesSelect={appendFiles} />
          </DialogContent>
        </Dialog>
      )}

      {renameTarget && (
        <Dialog open onOpenChange={(open) => {
          if (!open && !busyAction) setRenameTarget(null);
        }}>
          <DialogContent className="dataset-action-dialog">
            <DialogHeader>
              <DialogTitle className="text-foreground text-lg font-semibold">重命名资料</DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">只修改资料显示名称，不改变文件格式或已保存的内容。</DialogDescription>
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

      {bulkDeleteTarget && (
        <ConfirmDialog
          kind="delete"
          title={`永久删除所选资料（${bulkDeleteTarget.length} 份）？`}
          description={`将删除所选 ${bulkDeleteTarget.length} 份资料，移除源文件、解析结果和资料记录，且无法恢复。`}
          confirmLabel="永久删除所选"
          busyLabel="正在删除…"
          busy={batchDeleteBusy}
          onCancel={() => {
            if (!batchDeleteBusy) setBulkDeleteTarget(null);
          }}
          onConfirm={() => void confirmBulkDelete()}
        />
      )}

      {/* 新建文件夹对话框 */}
      {createFolderDialogOpen && (
        <Dialog
          open
          onOpenChange={(open) => !open && !creatingFolder && setCreateFolderDialogOpen(false)}
        >
          <DialogContent className="dataset-action-dialog sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground text-lg font-semibold">新建文件夹</DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">创建分类文件夹，整理和归类求职资料。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-3">
              <Label htmlFor="create-folder-input" className="text-foreground text-xs font-semibold">文件夹名称</Label>
              <Input
                id="create-folder-input"
                autoFocus
                value={newFolderName}
                maxLength={64}
                placeholder="例如：核心项目、工作复盘、资格证书"
                aria-label="文件夹名称"
                className="text-foreground bg-surface placeholder:text-muted-foreground"
                onChange={(e) => {
                  setNewFolderName(e.target.value);
                  setCreateFolderError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreateFolder();
                  }
                }}
              />
              {createFolderError && (
                <small className="text-xs text-destructive" role="alert">
                  {createFolderError}
                </small>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={creatingFolder}
                onClick={() => setCreateFolderDialogOpen(false)}
              >
                取消
              </Button>
              <Button disabled={creatingFolder} onClick={() => void handleCreateFolder()}>
                {creatingFolder ? "正在创建…" : "创建文件夹"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 重命名文件夹对话框 */}
      {renameFolderTarget && (
        <Dialog
          open
          onOpenChange={(open) => !open && !renamingFolder && setRenameFolderTarget(null)}
        >
          <DialogContent className="dataset-action-dialog sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground text-lg font-semibold">重命名文件夹</DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">修改文件夹名称，内部资料归属将自动同步。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-3">
              <Label htmlFor="rename-folder-input" className="text-foreground text-xs font-semibold">文件夹名称</Label>
              <Input
                id="rename-folder-input"
                autoFocus
                value={renameFolderName}
                maxLength={64}
                aria-label="文件夹名称"
                className="text-foreground bg-surface placeholder:text-muted-foreground"
                onChange={(e) => {
                  setRenameFolderName(e.target.value);
                  setRenameFolderError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleRenameFolder();
                  }
                }}
              />
              {renameFolderError && (
                <small className="text-xs text-destructive" role="alert">
                  {renameFolderError}
                </small>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={renamingFolder}
                onClick={() => setRenameFolderTarget(null)}
              >
                取消
              </Button>
              <Button disabled={renamingFolder} onClick={() => void handleRenameFolder()}>
                {renamingFolder ? "正在保存…" : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 删除文件夹确认对话框 */}
      {deleteFolderTarget && (
        <ConfirmDialog
          kind="delete"
          title={`确认删除文件夹「${deleteFolderTarget.name}」？`}
          description={`将永久删除该文件夹及其中的 ${deleteFolderTarget.dataset_count} 份资料，包括源文件和解析结果，删除后无法恢复。`}
          confirmLabel="确认删除"
          busyLabel="正在删除…"
          busy={deletingFolder}
          onConfirm={() => void handleDeleteFolder()}
          onCancel={() => {
            if (!deletingFolder) setDeleteFolderTarget(null);
          }}
        />
      )}

      {moveTarget && (
        <MoveToFolderDialog
          open
          onOpenChange={(open) => {
            if (!open) setMoveTarget(null);
          }}
          folders={folders}
          currentFolderId={moveTarget.folder_id ?? null}
          itemCount={1}
          singleItemName={datasetDisplayName(moveTarget)}
          onMove={confirmSingleMove}
        />
      )}

      {batchMoveOpen && (
        <MoveToFolderDialog
          open
          onOpenChange={setBatchMoveOpen}
          folders={folders}
          currentFolderId={
            selectedFolderId !== "all" && selectedFolderId !== "uncategorized"
              ? selectedFolderId
              : null
          }
          itemCount={selectedDatasetCount}
          onMove={confirmBatchMove}
        />
      )}

      {notice && !syncFailure && (
        <FeedbackNotice className={fading ? "is-fading" : undefined} kind={notice.kind} placement="floating">
          <span className="dataset-notice-message" title={notice.message}>{notice.message}</span>
        </FeedbackNotice>
      )}

      {conflicts[0] && <DatasetUploadConflictDialog key={conflicts[0].id} conflict={conflicts[0]} onDone={()=>setConflicts(current=>current.slice(1))}/>}


      {batchMode && (
        <div
          className="datasets-floating-bar is-active"
          role="region"
          aria-label="批量操作栏"
        >
          <div className="datasets-floating-bar-inner">
            <label className="dataset-floating-select-all">
              <DatasetSelectionCheckbox
                checked={allFilteredSelected}
                disabled={filteredDatasets.length === 0 || batchDeleteBusy}
                indeterminate={someFilteredSelected && !allFilteredSelected}
                label="全选当前筛选结果"
                onChange={toggleAllFilteredDatasets}
              />
              全选
            </label>
            <span className="datasets-floating-bar-count">
              已选 <strong>{selectedDatasetCount}</strong> 项
            </span>
            <span className="datasets-floating-bar-divider" aria-hidden="true" />
            <div className="datasets-floating-bar-actions">
              <Button
                variant="ghost"
                size="sm"
                className="datasets-floating-action-btn"
                icon={<FolderInput size={14} />}
                disabled={selectedDatasetCount === 0 || batchDeleteBusy}
                aria-label={`移动到文件夹（已选择 ${selectedDatasetCount} 份）`}
                onClick={() => setBatchMoveOpen(true)}
              >
                移动到文件夹
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="datasets-floating-action-btn is-danger"
                icon={<Trash2 size={14} />}
                disabled={selectedDatasetCount === 0 || batchDeleteBusy}
                aria-label={`删除资料（已选择 ${selectedDatasetCount} 份）`}
                onClick={startBulkDelete}
              >
                删除
              </Button>
            </div>
            <span className="datasets-floating-bar-divider" aria-hidden="true" />
            <button
              type="button"
              className="datasets-floating-bar-close"
              aria-label="取消选择"
              title="取消选择并退出批量"
              onClick={toggleBatchMode}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {previewDataset && <DatasetPreviewDialog dataset={previewDataset} returnFocusTo={previewTriggerRef.current} onClose={() => setPreviewDataset(null)} />}
    </main>
  );
}
