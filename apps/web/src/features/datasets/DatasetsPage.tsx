import { t, useLocale, getLocale } from "@/i18n";
import { MotionPresence, useContentMotion } from "@/components/ui/motion";
import { Reveal, SkeletonRows, Sk } from "@/v3/skeletons";
import { readPageCache, updatePageCache, useRevalidateOnFocus, writePageCache } from "@/v3/pageCache";
import { LoadingText } from "@/components/ui/page-loading";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  api,
  ApiRequestError,
  type DatasetFolder,
  type DatasetLimits,
  type DatasetRecord,
} from "../../api/client";
import { datasetsPath, navigateTo } from "../../routing";
import { Icon } from "../../v3/Icon";
import { ConfirmDialog, Dialog, DialogFooter, Menu, SearchBox, type MenuItem, PageEyebrow } from "../../v3/primitives";
import { DeleteDatasetArt, EmptyLibraryArt, FormatSquare, LoadFailedArt, datasetFormatTone } from "./components/DatasetArt";
import { CreateFolderCard, FolderCard, relativeUploadDay } from "./components/FolderCard";
import {
  datasetUploadErrorMessage,
  DEFAULT_DATASET_LIMITS,
  formatDatasetFileSize,
  normalizeDatasetLimits,
} from "./datasetUploadValidation";
import type { DatasetUploadBatchResult, DatasetUploadFailure } from "./useDatasetUploads";
import "../../v3/v3.css";
import "./datasets.css";

const DatasetPreviewDialog = lazy(() => import("./DatasetPreviewDialog").then((module) => ({ default: module.DatasetPreviewDialog })));
const DatasetUploadDialog = lazy(() => import("./DatasetUploadDialog").then((module) => ({ default: module.DatasetUploadDialog })));
const MoveToFolderDialog = lazy(() => import("./components/MoveToFolderDialog").then((module) => ({ default: module.MoveToFolderDialog })));
const ManageAssociationDialog = lazy(() => import("./components/ManageAssociationDialog").then((module) => ({ default: module.ManageAssociationDialog })));

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
  const prefix = failures.length === 1 ? t("文件上传失败：") : t("部分文件上传失败：");
  const limitSuffix = limitMessage ? `；${trimTerminalPunctuation(limitMessage)}` : "";
  return `${prefix}${details}${limitSuffix}`;
}

const FAILURE_REASON_LABELS: Record<NonNullable<DatasetRecord["failure_reason"]>, string> = {
  get format_unsupported() { return t("文件格式不受支持，请重新选择文件。"); },
  get content_invalid() { return t("文件内容无效，请检查后重新上传。"); },
  get size_exceeded() { return t("文件内容超出解析限制，请缩小文件后重试。"); },
  get service_unavailable() { return t("解析服务暂不可用，请稍后重试。"); },
  get timeout() { return t("解析超时，请稍后重试。"); },
  get quota_exceeded() { return t("当前资料数量已达上限。"); },
  get internal_error() { return t("解析失败，请稍后重试。"); },
};

export { datasetFormatError, datasetUploadErrorMessage } from "./datasetUploadValidation";

function datasetActionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiRequestError)) return fallback;
  switch (error.message) {
    case "INVALID_DATASET_NAME":
      return t("资料名称不能为空，不能包含路径符号或控制字符。");
    case "DATASET_NOT_FOUND":
      return t("这份资料不存在或你无权操作。");
    case "FOLDER_NOT_FOUND":
      return t("文件夹不存在或已被删除，请重新选择。");
    case "FOLDER_DELETE_CONFIRMATION_REQUIRED":
      return t("文件夹内包含资料，请确认后再删除。");
    case "DATASET_IN_PROGRESS":
    case "DATASET_BUSY":
      return t("资料正在解析，处理完成后再删除。");
    case "DATASET_NOT_RETRYABLE":
      return t("只有解析失败的资料可以重新解析。");
    case "DATASET_SOURCE_UNAVAILABLE":
      return t("原始文件已不可用，请重新上传资料。");
    case "DATASET_QUEUE_UNAVAILABLE":
      return t("解析服务暂不可用，资料已保留为解析失败。");
    case "ASSET_DELETE_FAILED":
      return t("资料清理失败，请稍后重试。");
    default:
      if (error.status === 401) return t("登录状态已失效，请重新登录。");
      return error.status >= 500 ? t("服务暂时不可用，请稍后重试。") : fallback;
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
  if (failures.length === 0) return t("已删除 {value0} 份资料。", { value0: successCount });
  if (successCount === 0) return t("所选 {value0} 份资料删除失败：{value1}", { value0: totalCount, value1: details });
  return t("已删除 {value0} 份资料，{value1} 份删除失败：{value2}", { value0: successCount, value1: failures.length, value2: details });
}

function formatFileSize(bytes: number) {
  return formatDatasetFileSize(bytes);
}

export function datasetDisplayName(dataset: Pick<DatasetRecord, "file_name" | "file_format">) {
  const suffix = `.${dataset.file_format}`;
  return dataset.file_name.toLowerCase().endsWith(suffix.toLowerCase())
    ? dataset.file_name.slice(0, -suffix.length)
    : dataset.file_name;
}

export function isMediaDataset(dataset: Pick<DatasetRecord, "asset_kind">): boolean {
  return dataset.asset_kind === "audio" || dataset.asset_kind === "video";
}

function datasetVisualStatus(dataset: DatasetRecord): DatasetVisualStatus {
  if (dataset.parse_status === "succeeded") return "succeeded";
  if (dataset.parse_status === "failed" || dataset.upload_status === "failed") return "failed";
  if (dataset.parse_status === "processing") return "processing";
  return "queued";
}

function datasetStatusLabel(status: DatasetVisualStatus) {
  if (status === "queued") return t("等待解析");
  if (status === "succeeded") return t("可用");
  if (status === "failed") return t("解析失败");
  return t("正在解析");
}

export function datasetAssetKindLabel(dataset: Pick<DatasetRecord, "asset_kind">): string | null {
  if (dataset.asset_kind === "audio") return t("音频");
  if (dataset.asset_kind === "video") return t("视频");
  return null;
}

function datasetStatusReason(dataset: DatasetRecord) {
  if (!dataset.failure_reason) return null;
  return FAILURE_REASON_LABELS[dataset.failure_reason] ?? FAILURE_REASON_LABELS.internal_error;
}

// 资料行副标题：可用时写格式名（音视频提示点击下载），解析中 / 失败写状态
const FORMAT_NAMES: Record<string, string> = { md: "Markdown", pdf: "PDF", docx: "Word", get txt() { return t("纯文本"); } };

function datasetRowMeta(dataset: DatasetRecord): { text: string; tone?: "processing" | "failed"; status: DatasetVisualStatus } {
  const status = datasetVisualStatus(dataset);
  if (isMediaDataset(dataset)) {
    const kind = datasetAssetKindLabel(dataset) ?? t("媒体");
    if (dataset.upload_status === "failed") return { text: t("上传失败"), tone: "failed", status: "failed" };
    if (dataset.upload_status === "uploading") return { text: t("正在上传…"), tone: "processing", status: "processing" };
    return { text: t("{value0} · 点击下载", { value0: kind }), status: "succeeded" };
  }
  if (status === "queued") return { text: datasetStatusLabel(status), tone: "processing", status };
  if (status === "processing") return { text: t("正在解析…"), tone: "processing", status };
  if (status === "failed") {
    const reason = datasetStatusReason(dataset)?.replace(/[。，].*$/u, "");
    return { text: reason ? t("解析失败 · {value0}", { value0: reason }) : t("解析失败"), tone: "failed", status };
  }
  return { text: FORMAT_NAMES[dataset.file_format.toLowerCase()] ?? dataset.file_format.toUpperCase(), status };
}

// 列表日期：本年写 MM-DD，跨年写完整日期
function formatListDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return date.getFullYear() === new Date().getFullYear() ? day : `${date.getFullYear()}-${day}`;
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
  useLocale();
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={checkboxRef}
      className="ds-check"
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

// 06.2 资料行（54 高）：格式方块 / 名称 + 副标题 / 关联 / 大小 / 上传日期（失败时为「重试」）/ 行尾 ⋯
function DatasetRow({
  dataset,
  batchMode,
  selected,
  selectionDisabled,
  menuOpen,
  busy,
  onOpen,
  onToggleSelection,
  onToggleMenu,
  onCloseMenu,
  onRename,
  onMove,
  onAssociate,
  onRetry,
  onDelete,
}: {
  dataset: DatasetRecord;
  batchMode: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  menuOpen: boolean;
  busy: boolean;
  onOpen: (dataset: DatasetRecord, trigger: HTMLElement) => void;
  onToggleSelection: (id: string, checked: boolean) => void;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
  onRename: (dataset: DatasetRecord) => void;
  onMove: (dataset: DatasetRecord) => void;
  onAssociate: (dataset: DatasetRecord) => void;
  onRetry: (dataset: DatasetRecord) => void;
  onDelete: (dataset: DatasetRecord) => void;
}) {
  useLocale();
  const moreRef = useRef<HTMLButtonElement>(null);
  const displayName = datasetDisplayName(dataset);
  const media = isMediaDataset(dataset);
  const meta = datasetRowMeta(dataset);
  const available = meta.status === "succeeded";
  // 文档解析完成后点一行打开预览；音视频上传完成后点一行直接下载
  const isInteractive = available && !batchMode;
  const canAssociate = dataset.upload_status === "succeeded";
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isInteractive || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onOpen(dataset, event.currentTarget);
  };
  const items: MenuItem[] = [
    { label: media ? t("下载文件") : t("查看文件"), icon: media ? "dl" : "eye", disabled: !available, onSelect: () => onOpen(dataset, moreRef.current ?? document.body) },
    { label: t("重命名"), icon: "edit", onSelect: () => onRename(dataset) },
    { label: t("移动到文件夹"), icon: "folder", onSelect: () => onMove(dataset) },
    { label: t("管理关联"), icon: "cal", disabled: !canAssociate, title: canAssociate ? undefined : t("上传完成后才能关联面试"), onSelect: () => onAssociate(dataset) },
    ...(meta.status === "failed" && !media ? [{ label: t("重新解析"), icon: "refresh", onSelect: () => onRetry(dataset) } satisfies MenuItem] : []),
    { kind: "separator" },
    { label: t("删除资料"), icon: "trash", danger: true, onSelect: () => onDelete(dataset) },
  ];

  return (
    <article
      className={`ds-row ds-cols${isInteractive ? " is-clickable" : ""}${menuOpen ? " is-active" : ""}`}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? (media ? t("下载「{value0}」", { value0: displayName }) : t("打开「{value0}」解析预览", { value0: displayName })) : undefined}
      onClick={isInteractive ? (event) => onOpen(dataset, event.currentTarget) : undefined}
      onKeyDown={handleKeyDown}
    >
      <FormatSquare dataset={dataset} />
      <div className="ds-row-name">
        <strong title={dataset.file_name}>{displayName}</strong>
        <small className={meta.tone ? `is-${meta.tone}` : undefined} data-status={meta.status === "succeeded" ? undefined : datasetVisualStatus(dataset)} title={meta.tone === "failed" ? datasetStatusReason(dataset) ?? undefined : undefined}>
          {meta.text}
        </small>
      </div>
      <div className="ds-row-link">
        {dataset.interview_label && (
          <>
            <Icon name="cal" size={13} />
            <span title={t("面试 · {value0}", { value0: dataset.interview_label })}>{t("面试 · ")}{dataset.interview_label}</span>
          </>
        )}
      </div>
      <div className="is-right v3-num">{formatFileSize(dataset.file_size)}</div>
      <div className="is-right" onClick={(event) => event.stopPropagation()}>
        {meta.status === "failed" && !media ? (
          <button type="button" className="ds-row-retry" disabled={busy || batchMode} onClick={() => onRetry(dataset)}>{t("重试")}</button>
        ) : (
          <span className="v3-num">{formatListDate(dataset.created_at)}</span>
        )}
      </div>
      <div
        className="ds-row-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {batchMode ? (
          <div className="ds-row-check">
            <DatasetSelectionCheckbox
              checked={selected}
              disabled={selectionDisabled}
              label={t("选择「{value0}」", { value0: displayName })}
              onChange={(checked) => onToggleSelection(dataset.id, checked)}
            />
          </div>
        ) : (
          <>
            <button
              ref={moreRef}
              type="button"
              className="ds-row-more"
              aria-label={t("打开「{value0}」操作菜单", { value0: displayName })}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => onToggleMenu(dataset.id)}
            >
              <Icon name="more" size={14} />
            </button>
            <Menu anchorRef={moreRef} open={menuOpen} onClose={onCloseMenu} placement="bottom-end" width={176} label={t("{value0} 操作", { value0: displayName })} items={items} />
          </>
        )}
      </div>
    </article>
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

const DATASETS_CACHE_KEY = "datasets";
type DatasetsSnapshot = { datasets: DatasetRecord[]; limits: DatasetLimits; folders: DatasetFolder[]; totalCount: number; uncategorizedCount: number };

export function DatasetsPage({
  initialFolderId,
  embedded = false,
}: {
  initialFolderId?: string;
  embedded?: boolean;
} = {}) {
  useLocale();
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const [previewDataset, setPreviewDataset] = useState<DatasetRecord | null>(null);
  const locallyAccepted = useRef(new Map<string, DatasetRecord>());
  const uploadRetryKeys = useRef(new Map<string, string>());
  const pageMounted = useRef(true);
  const initialRequest = useRef(0);
  // 回到资料库时先用上一次的快照直接显示，不画骨架；快照超过 5 分钟再在后台静默刷新
  const [cachedSnapshot] = useState(() => readPageCache<DatasetsSnapshot>(DATASETS_CACHE_KEY));
  const [datasets, setDatasets] = useState<DatasetRecord[]>(() => cachedSnapshot?.value.datasets ?? []);
  const [limits, setLimits] = useState<DatasetLimits>(() => cachedSnapshot?.value.limits ?? DEFAULT_DATASET_LIMITS);
  const [loading, setLoading] = useState(() => !cachedSnapshot);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialUploadFiles, setInitialUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  const [menuDatasetId, setMenuDatasetId] = useState<string | null>(null);
  const [associationTarget, setAssociationTarget] = useState<DatasetRecord | null>(null);
  const [renameTarget, setRenameTarget] = useState<DatasetRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetRecord | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<DatasetRecord[] | null>(null);
  const [busyAction, setBusyAction] = useState<DatasetAction>(null);

  const [folders, setFolders] = useState<DatasetFolder[]>(() => cachedSnapshot?.value.folders ?? []);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(() => initialFolderId || "all");
  const [totalCount, setTotalCount] = useState(() => cachedSnapshot?.value.totalCount ?? 0);
  const [uncategorizedCount, setUncategorizedCount] = useState(() => cachedSnapshot?.value.uncategorizedCount ?? 0);
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
    if (!trimmed) return t("文件夹名称不能为空");
    if (trimmed.includes("/") || trimmed.includes("\\")) return t("文件夹名称不能包含斜杠符号");
    if (trimmed.length > 64) return t("文件夹名称不能超过 64 个字符");
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
      setNotice({ kind: "success", message: t("文件夹「{value0}」已创建。", { value0: newFolderName.trim() }) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "FOLDER_NAME_DUPLICATE") {
        setCreateFolderError(t("已存在同名文件夹，请使用其他名称"));
      } else if (msg === "FOLDER_LIMIT_EXCEEDED") {
        setCreateFolderError(t("最多创建 50 个文件夹"));
      } else {
        setCreateFolderError(t("创建失败，请检查名称后重试"));
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
      setNotice({ kind: "success", message: t("文件夹名称已更新。") });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "FOLDER_NAME_DUPLICATE") {
        setRenameFolderError(t("已存在同名文件夹，请使用其他名称"));
      } else {
        setRenameFolderError(t("重命名失败，请重试"));
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
      setNotice({ kind: "success", message: t("文件夹及其中的资料已删除。") });
    } catch (error) {
      setDeleteFolderTarget(null);
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, t("删除失败，请稍后重试。")) });
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
      setNotice({ kind: "success", message: t("资料分类已更新。") });
    } catch (error) {
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, t("移动分类失败，请稍后重试。")) });
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
      setNotice({ kind: "success", message: t("已成功移动 {value0} 份资料。", { value0: ids.length }) });
    } catch (error) {
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, t("批量移动失败，请稍后重试。")) });
    } finally {
      setBatchMoveOpen(false);
    }
  };

  const refreshDatasets = useCallback(async (options: { accepted?: boolean } = {}) => {
    const { accepted = false } = options;
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
      setSyncFailure(accepted ? ACCEPTED_SYNC_FAILURE : t("资料列表同步失败，请稍后重试。"));
      return false;
    }
  }, []);

  const loadInitialData = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const request = ++initialRequest.current;
    if (!background) setLoading(true);
    setLoadFailed(false);
    try {
      // Counts, folder names and cards are one snapshot, not separate empty states.
      const [data, folderData] = await Promise.all([api.listDatasets(), api.listDatasetFolders()]);
      if (!pageMounted.current || request !== initialRequest.current) return;
      setLimits(normalizeDatasetLimits(data.limits));
      setDatasets(mergeDatasetResponse(data.datasets, locallyAccepted.current));
      setFolders(folderData.folders);
      setTotalCount(folderData.total_count);
      setUncategorizedCount(folderData.uncategorized_count);
      writePageCache<DatasetsSnapshot>(DATASETS_CACHE_KEY, { datasets: mergeDatasetResponse(data.datasets, locallyAccepted.current), limits: normalizeDatasetLimits(data.limits), folders: folderData.folders, totalCount: folderData.total_count, uncategorizedCount: folderData.uncategorized_count });
      setSyncFailure(null);
    } catch {
      // 后台刷新失败时保留已显示的快照
      if (!background && pageMounted.current && request === initialRequest.current) setLoadFailed(true);
    } finally {
      if (pageMounted.current && request === initialRequest.current) setLoading(false);
    }
  }, []);

  // 页面上的资料 / 文件夹一有变化（首次读取、上传、改名、删除、移动）就更新快照，下次进入直接显示最新状态
  useEffect(() => {
    if (loading || loadFailed) return;
    updatePageCache<DatasetsSnapshot>(DATASETS_CACHE_KEY, { datasets, limits, folders, totalCount, uncategorizedCount });
  }, [datasets, folders, limits, loadFailed, loading, totalCount, uncategorizedCount]);

  const canUploadHere = selectedFolderId !== "all" && selectedFolderId !== "uncategorized";
  const effectiveUploadFolderId = canUploadHere
    ? selectedFolderId
    : null;

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
    const cached = readPageCache<DatasetsSnapshot>(DATASETS_CACHE_KEY);
    if (!cached?.fresh) void loadInitialData({ background: Boolean(cached) });
    return () => {
      pageMounted.current = false;
      initialRequest.current += 1;
    };
  }, [loadInitialData]);
  useRevalidateOnFocus(() => { if (!loading) void loadInitialData({ background: true }); });

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

  const closeMenu = useCallback(() => setMenuDatasetId(null), []);

  const handleSelectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    if (!embedded) navigateTo(datasetsPath(folderId));
  };

  const handleBackToAll = () => {
    setBatchMode(false);
    setSelectedDatasetIds(new Set());
    setSelectedFolderId("all");
    if (!embedded) navigateTo(datasetsPath("all"));
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
    setInitialUploadFiles([]);
    setDialogOpen(true);
    setNotice(null);
  };

  const closeUploadDialog = () => {
    if (uploading) return;
    setDialogOpen(false);
    setInitialUploadFiles([]);
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
      if (!canUploadHere || !effectiveUploadFolderId) {
        setNotice({ kind: "error", message: t("请先进入文件夹再上传资料。") });
        return;
      }
      setNotice(null);
      setInitialUploadFiles(files);
      setDialogOpen(true);
    }
  };

  const handleUploadAccepted = (dataset: DatasetRecord) => {
    if (!pageMounted.current) return;
    locallyAccepted.current.set(dataset.id, dataset);
    setDatasets((current) => upsertDataset(current, dataset));
    setLoadFailed(false);
  };

  const handleUploadComplete = async (result: DatasetUploadBatchResult) => {
    if (!pageMounted.current) return;

    if (result.attemptedCount > 0) {
      await Promise.all([
        refreshDatasets({ accepted: result.acceptedCount > 0 }),
        refreshFolders(),
      ]);
    }

    setDialogOpen(false);
    setInitialUploadFiles([]);
    if (result.failures.length > 0) {
      setNotice({
        kind: "error",
        message: formatUploadFailureNotice(result.failures, result.limitMessage),
      });
    } else if (result.deferredCount > 0) {
      setNotice({
        kind: "error",
        message: t("资料已保存，但解析提交失败（{value0} 份），请在列表中重新解析。", { value0: result.deferredCount }),
      });
    } else if (result.acceptedCount > 0) {
      setNotice({
        kind: "success",
        message: result.limitMessage
          ? t("已上传 {value0} 份资料，{value1}", { value0: result.acceptedCount, value1: result.limitMessage })
          : t("已上传 {value0} 份资料，正在后台解析。", { value0: result.acceptedCount }),
      });
    } else if (result.limitMessage) {
      setNotice({ kind: "error", message: result.limitMessage });
    }
  };

  // 点一行：文档打开预览，音视频直接下载。菜单开着时先只关菜单（fromMenu 表示从菜单项进入，直接执行）
  const openDataset = (dataset: DatasetRecord, trigger: HTMLElement, fromMenu = false) => {
    if (!fromMenu && menuDatasetId !== null) {
      setMenuDatasetId(null);
      return;
    }
    if (isMediaDataset(dataset)) {
      void downloadDataset(dataset);
      return;
    }
    previewTriggerRef.current = trigger;
    setPreviewDataset(dataset);
  };

  const startAssociation = (dataset: DatasetRecord) => {
    setMenuDatasetId(null);
    setPreviewDataset(null);
    setAssociationTarget(dataset);
  };

  const handleAssociationSaved = async (message: string) => {
    setAssociationTarget(null);
    await refreshDatasets();
    setNotice({ kind: "success", message });
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
      setRenameError(t("请输入资料名称。"));
      return;
    }
    setBusyAction({ kind: "rename", id: renameTarget.id });
    setRenameError(null);
    try {
      const updated = await api.renameDataset(renameTarget.id, value);
      if (locallyAccepted.current.has(updated.id)) locallyAccepted.current.set(updated.id, updated);
      setDatasets((items) => items.map((item) => item.id === updated.id ? updated : item));
      setRenameTarget(null);
      setNotice({ kind: "success", message: t("资料名称已更新。") });
    } catch (error) {
      setRenameError(datasetActionErrorMessage(error, t("重命名失败，请稍后重试。")));
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
      setNotice({ kind: "success", message: t("已重新提交解析。") });
    } catch (error) {
      await refreshDatasets();
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, t("重新解析失败，请稍后重试。")) });
    } finally {
      setBusyAction(null);
    }
  };

  const downloadDataset = async (dataset: DatasetRecord) => {
    setMenuDatasetId(null);
    try {
      const blob = await api.downloadDatasetSource(dataset.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = dataset.file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSyncFailure(datasetUploadErrorMessage(error, t("下载失败，请稍后重试。")));
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
      setNotice({ kind: "success", message: t("已删除「{value0}」。", { value0: datasetDisplayName(deleteTarget) }) });
    } catch (error) {
      setDeleteTarget(null);
      setNotice({ kind: "error", message: datasetActionErrorMessage(error, t("删除失败，请稍后重试。")) });
    } finally {
      setBusyAction(null);
    }
  };

  const keyword = query.trim().toLocaleLowerCase();
  const filteredDatasets = useMemo(() => {
    return datasets.filter((dataset) => {
      if (selectedFolderId === "all" || selectedFolderId === "uncategorized") {
        return false;
      } else if (dataset.folder_id !== selectedFolderId) {
        return false;
      }
      if (!keyword) return true;
      return datasetDisplayName(dataset).toLocaleLowerCase().includes(keyword);
    });
  }, [datasets, keyword, selectedFolderId]);
  // 进入 / 退出文件夹、搜索结果变化时，主体区浮上淡入（不重新挂载，滚动位置和选中状态保留）
  const bodyMotionRef = useContentMotion<HTMLDivElement>(loading ? "" : `${selectedFolderId}|${filteredDatasets.map((item) => item.id).join(",")}`, { initial: false });

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
          reason: datasetActionErrorMessage(error, t("删除失败，请稍后重试。")),
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

  const currentFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const currentFolderName = currentFolder?.name ?? t("文件夹");

  // 首页「最近上传」与文件夹卡片缩略纸张：前端按上传时间倒序排，不需要新接口
  const datasetsByRecent = useMemo(
    () => [...datasets].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [datasets],
  );
  const recentByFolder = useMemo(() => {
    const map = new Map<string, DatasetRecord[]>();
    for (const dataset of datasetsByRecent) {
      if (!dataset.folder_id) continue;
      const list = map.get(dataset.folder_id) ?? [];
      list.push(dataset);
      map.set(dataset.folder_id, list);
    }
    return map;
  }, [datasetsByRecent]);
  // 文件夹「按最近更新」：取文件夹更新时间与最近一份资料上传时间中较晚的一个
  const sortedFolders = useMemo(() => {
    const stamp = (folder: DatasetFolder) => Math.max(
      new Date(folder.updated_at).getTime() || 0,
      new Date(recentByFolder.get(folder.id)?.[0]?.created_at ?? 0).getTime() || 0,
    );
    return [...folders]
      .filter((folder) => !keyword || folder.name.toLocaleLowerCase().includes(keyword))
      .sort((a, b) => stamp(b) - stamp(a));
  }, [folders, keyword, recentByFolder]);
  const recentUploads = useMemo(
    () => datasetsByRecent
      .filter((dataset) => !keyword || datasetDisplayName(dataset).toLocaleLowerCase().includes(keyword))
      .slice(0, 3),
    [datasetsByRecent, keyword],
  );
  const folderLinkedCount = filteredDatasets.filter((dataset) => dataset.interview_session_id || dataset.interview_label).length;
  const folderDatasetCount = datasets.filter((dataset) => dataset.folder_id === selectedFolderId).length;
  const libraryCount = Math.max(totalCount, datasets.length);
  const mediaLimit = formatDatasetFileSize(limits.max_media_file_bytes ?? 500 * 1024 * 1024);

  const openCreateFolder = () => {
    setNewFolderName("");
    setCreateFolderError(null);
    setCreateFolderDialogOpen(true);
  };

  const RootTag = embedded ? "section" : "div";

  return (
    <RootTag
      className={`v3 ds-root${embedded ? " is-embedded" : ""}`}
      aria-label={embedded ? t("资料库") : undefined}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {pageDragOver && (
        <div className="ds-drag-overlay" aria-hidden="true">
          <div>
            <Icon name="upload" size={28} />
            <strong>{t("释放鼠标立即上传")}</strong>
            <span>{t("将直接上传至「")}{currentFolderName}」</span>
          </div>
        </div>
      )}

      <div className="ds-page">
        {selectedFolderId === "all" ? (
          <header className="ds-head">
            <PageEyebrow className="ds-eyebrow" segments={["DATASETS", <Reveal inline loading={loading} placeholder={<LoadingText width={36} />}>{t("{value0} 份", { value0: libraryCount })}</Reveal>]} />
            <h1 className="ds-title">{t("资料库")}</h1>
            <p className="ds-sub">
              <Reveal inline loading={loading} placeholder={<LoadingText width={230} />}>{loadFailed ? null : libraryCount > 0 || folders.length > 0
                ? <span className="v3-num">{libraryCount}{t(" 份资料 · ")}{folders.length}{t(" 个文件夹")}</span>
                : t("把履历、项目记录和参考资料集中在这里，写简历时随时调用。")}</Reveal>
            </p>
            <div className="ds-actions">
              <SearchBox value={query} onChange={setQuery} placeholder={t("搜索资料…")} label={t("搜索资料")} />
              <button type="button" className="v3-btn v3-btn-dark" style={{ width: 120 }} disabled={batchMode} onClick={openCreateFolder}>{t("新建文件夹")}</button>
            </div>
            <div className="ds-divider" />
          </header>
        ) : (
          <header className="ds-head has-crumb">
            <nav aria-label={t("资料库路径")}>
              <PageEyebrow className="ds-eyebrow" segments={[{ label: "DATASETS", onClick: handleBackToAll, ariaLabel: t("返回全部资料") }, <span aria-current="page"><Reveal inline loading={loading} placeholder={<LoadingText />}>{currentFolderName}</Reveal></span>]} />
            </nav>
            <h1 className="ds-title" title={loading ? undefined : currentFolderName}><Reveal inline loading={loading} placeholder={<LoadingText width={180} />}>{currentFolderName}</Reveal></h1>
            <p className="ds-sub">
              <Reveal inline loading={loading} placeholder={<LoadingText width={160} />}>{!loadFailed && <>{t("共 ")}<span className="v3-num">{folderDatasetCount}</span>{t(" 份资料")}{folderLinkedCount > 0 && <> · <span className="v3-num">{folderLinkedCount}</span>{t("份已关联面试")}</>}</>}</Reveal>
            </p>
            <div className="ds-actions is-folder">
              <SearchBox value={query} onChange={setQuery} placeholder={t("搜索资料…")} label={t("搜索资料")} />
              <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 92 }} disabled={batchDeleteBusy} onClick={toggleBatchMode}>
                {batchMode ? t("取消操作") : t("批量操作")}
              </button>
              <button type="button" className="v3-btn v3-btn-dark" style={{ width: 108 }} disabled={batchMode} onClick={openUploadDialog}>{t("上传资料")}</button>
            </div>
            <div className="ds-divider" />
          </header>
        )}

        <Reveal
          loading={loading}
          className="ds-body-slot"
          placeholder={(
            <div className="ds-loading">
              <div className="v3-sk-folders" aria-hidden="true">{[0, 1, 2].map((index) => <Sk key={index} h={172} r={12} />)}</div>
              <SkeletonRows rows={4} header={false} label={t("正在加载资料…")} />
            </div>
          )}
        >{loadFailed ? (
          <section className="v3-empty is-error ds-error" aria-labelledby="ds-error-title">
            <div className="v3-stage has-dots"><LoadFailedArt /></div>
            <h3 id="ds-error-title">{t("资料加载失败")}</h3>
            <p>{t("请稍后重试。资料和文件夹都还在，刷新一下试试。")}</p>
            <div className="v3-empty-actions">
              <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 96 }} onClick={() => void loadInitialData()}>
                <Icon name="refresh" size={13} />{t("重新加载")}</button>
            </div>
          </section>
        ) : (
          <div ref={bodyMotionRef} className="ds-body">
            {selectedFolderId === "all" ? (
              folders.length === 0 && datasets.length === 0 ? (
                <section className="v3-empty ds-empty" aria-labelledby="ds-empty-title">
                  <div className="v3-stage has-dots"><EmptyLibraryArt /></div>
                  <h3 id="ds-empty-title">{t("还没有文件夹")}</h3>
                  <p>{t("建议先新建文件夹分类整理，后续写简历时可以快速检索和引用相关资料。")}</p>
                </section>
              ) : (
                <>
                  <div className="ds-section-head"><strong>{t("文件夹")}</strong><span>{t("按最近更新")}</span></div>
                  <div className="ds-folder-grid" aria-label={t("资料与文件夹列表")}>
                    {sortedFolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        recent={recentByFolder.get(folder.id) ?? []}
                        onClick={() => handleSelectFolder(folder.id)}
                        onRename={(f) => {
                          setRenameFolderTarget(f);
                          setRenameFolderName(f.name);
                          setRenameFolderError(null);
                        }}
                        onDelete={(f) => setDeleteFolderTarget(f)}
                      />
                    ))}
                    <CreateFolderCard disabled={batchMode} onClick={openCreateFolder} />
                  </div>
                  {recentUploads.length > 0 && (
                    <>
                      <h2 className="ds-recent-head">{t("最近上传")}</h2>
                      <div className="ds-recent" role="list" aria-label={t("最近上传")}>
                        {recentUploads.map((dataset) => {
                          const folderName = folders.find((folder) => folder.id === dataset.folder_id)?.name ?? t("未分类");
                          const available = isMediaDataset(dataset)
                            ? dataset.upload_status === "succeeded"
                            : datasetVisualStatus(dataset) === "succeeded";
                          return (
                            <button
                              key={dataset.id}
                              type="button"
                              role="listitem"
                              className="ds-recent-row"
                              aria-label={t("{value0}，位于「{value1}」", { value0: dataset.file_name, value1: folderName })}
                              onClick={(event) => {
                                if (available) openDataset(dataset, event.currentTarget, true);
                                else if (dataset.folder_id) handleSelectFolder(dataset.folder_id);
                              }}
                            >
                              <FormatSquare dataset={dataset} tinted={false} />
                              <span className="ds-recent-name">
                                <strong title={dataset.file_name}>{dataset.file_name}</strong>
                                <span className="ds-folder-chip"><Icon name="folder" size={13} /><span>{folderName}</span></span>
                              </span>
                              <span className="ds-recent-time">{relativeUploadDay(dataset.created_at, true)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <p className="ds-foot-note">{t("写简历或和 AI 助手对话时，可以通过「添加资料」选择要引用的文件。")}</p>
                </>
              )
            ) : folderDatasetCount === 0 ? (
              <section className="v3-empty ds-empty" aria-labelledby="ds-empty-title">
                <div className="v3-stage has-dots"><EmptyLibraryArt /></div>
                <h3 id="ds-empty-title">{t("还没有资料")}</h3>
                <p>{t("建议先上传一份与当前分类相关的资料，后续写简历时可以快速检索和引用。")}</p>
              </section>
            ) : (
              <section className="ds-table" aria-label={t("文件夹内部资料列表")}>
                <div className="ds-table-head ds-cols" role="presentation">
                  <span className="is-name">{t("名称")}</span>
                  <span>{t("关联")}</span>
                  <span className="is-right">{t("大小")}</span>
                  <span className="is-right">{t("上传日期")}</span>
                  {batchMode ? (
                    <span className="is-check">
                      <DatasetSelectionCheckbox
                        checked={allFilteredSelected}
                        disabled={filteredDatasets.length === 0 || batchDeleteBusy}
                        indeterminate={someFilteredSelected && !allFilteredSelected}
                        label={t("全选当前列表")}
                        onChange={toggleAllFilteredDatasets}
                      />
                    </span>
                  ) : <span />}
                </div>
                {filteredDatasets.length === 0 ? (
                  <p className="ds-no-match">{t("没有匹配的资料。")}</p>
                ) : (
                  <div className="ds-rows">
                    {filteredDatasets.map((dataset) => (
                      <DatasetRow
                        key={dataset.id}
                        dataset={dataset}
                        batchMode={batchMode}
                        selected={selectedDatasetIds.has(dataset.id)}
                        selectionDisabled={batchDeleteBusy}
                        menuOpen={menuDatasetId === dataset.id}
                        busy={busyAction?.id === dataset.id}
                        onOpen={(item, trigger) => openDataset(item, trigger, trigger.tagName === "BUTTON")}
                        onToggleSelection={toggleDatasetSelection}
                        onToggleMenu={(id) => setMenuDatasetId((current) => current === id ? null : id)}
                        onCloseMenu={closeMenu}
                        onRename={startRename}
                        onMove={(item) => { setMenuDatasetId(null); setMoveTarget(item); }}
                        onAssociate={startAssociation}
                        onRetry={(item) => void startRetry(item)}
                        onDelete={startDelete}
                      />
                    ))}
                  </div>
                )}
                <button type="button" className="ds-dropzone" disabled={batchMode} onClick={openUploadDialog}>
                  <strong><Icon name="upload" size={16} />{t("拖入文件，或点击上传到「")}{currentFolderName}」</strong>
                  <small>{t("PDF、DOCX、Markdown、TXT 最大 ")}{formatDatasetFileSize(limits.max_file_bytes)}{t("；音视频最大 ")}{mediaLimit}</small>
                </button>
              </section>
            )}
          </div>
        )}</Reveal>
      </div>

      {uploading && !dialogOpen && (
        <div className="ds-uploading" role="status" aria-live="polite">
          <span className="ds-spinner" aria-hidden="true" />{t("正在上传资料至「")}{effectiveUploadFolderId ? folders.find((f) => f.id === effectiveUploadFolderId)?.name ?? t("当前文件夹") : t("未分类")}」…
        </div>
      )}

      <MotionPresence>{dialogOpen && effectiveUploadFolderId && (
        <Suspense fallback={null}>
          <DatasetUploadDialog
            concurrency={DATASET_UPLOAD_CONCURRENCY}
            folderId={effectiveUploadFolderId}
            folderName={folders.find((f) => f.id === effectiveUploadFolderId)?.name}
            initialFiles={initialUploadFiles}
            limits={limits}
            onAccepted={handleUploadAccepted}
            onComplete={handleUploadComplete}
            onLimitExceeded={(message) => setNotice({ kind: "error", message })}
            onUploadingChange={setUploading}
            onClose={closeUploadDialog}
            retryKeys={uploadRetryKeys.current}
          />
        </Suspense>
      )}</MotionPresence>

      <MotionPresence>{renameTarget && (
        <NameDialog
          title={t("重命名资料")}
          description={t("只修改资料显示名称，不改变文件格式或已保存的内容。")}
          label={t("资料名称")}
          value={renameValue}
          maxLength={255}
          error={renameError}
          busy={busyAction?.kind === "rename"}
          confirmLabel={t("保存名称")}
          busyLabel={t("正在保存…")}
          onChange={(value) => { setRenameValue(value); setRenameError(null); }}
          onCancel={() => { if (!busyAction) setRenameTarget(null); }}
          onSubmit={() => void submitRename()}
        />
      )}</MotionPresence>

      <MotionPresence>{deleteTarget && (
        <ConfirmDialog
          title={t("永久删除「{value0}」？", { value0: datasetDisplayName(deleteTarget) })}
          description={t("删除后将移除源文件、解析结果和资料记录，且无法恢复。")}
          art={<DeleteDatasetArt tag={datasetFormatTone(deleteTarget).label} color={datasetFormatTone(deleteTarget).color} />}
          confirmLabel={t("永久删除")}
          busyLabel={t("正在删除…")}
          busy={busyAction?.kind === "delete"}
          onCancel={() => { if (!busyAction) setDeleteTarget(null); }}
          onConfirm={() => void confirmDelete()}
        />
      )}</MotionPresence>

      <MotionPresence>{bulkDeleteTarget && (
        <ConfirmDialog
          title={t("永久删除所选资料（{value0} 份）？", { value0: bulkDeleteTarget.length })}
          description={t("将删除所选 {value0} 份资料，移除源文件、解析结果和资料记录，且无法恢复。", { value0: bulkDeleteTarget.length })}
          art={<DeleteDatasetArt tag={String(bulkDeleteTarget.length)} color="var(--v3-sub)" />}
          confirmLabel={t("永久删除所选")}
          busyLabel={t("正在删除…")}
          busy={batchDeleteBusy}
          onCancel={() => { if (!batchDeleteBusy) setBulkDeleteTarget(null); }}
          onConfirm={() => void confirmBulkDelete()}
        />
      )}</MotionPresence>

      <MotionPresence>{createFolderDialogOpen && (
        <NameDialog
          title={t("新建文件夹")}
          description={t("创建分类文件夹，整理和归类求职资料。")}
          label={t("文件夹名称")}
          value={newFolderName}
          maxLength={64}
          placeholder={t("例如：核心项目、工作复盘、资格证书")}
          error={createFolderError}
          busy={creatingFolder}
          confirmLabel={t("创建文件夹")}
          busyLabel={t("正在创建…")}
          onChange={(value) => { setNewFolderName(value); setCreateFolderError(null); }}
          onCancel={() => { if (!creatingFolder) setCreateFolderDialogOpen(false); }}
          onSubmit={() => void handleCreateFolder()}
        />
      )}</MotionPresence>

      <MotionPresence>{renameFolderTarget && (
        <NameDialog
          title={t("重命名文件夹")}
          description={t("修改文件夹名称，内部资料归属将自动同步。")}
          label={t("文件夹名称")}
          value={renameFolderName}
          maxLength={64}
          error={renameFolderError}
          busy={renamingFolder}
          confirmLabel={t("保存")}
          busyLabel={t("正在保存…")}
          onChange={(value) => { setRenameFolderName(value); setRenameFolderError(null); }}
          onCancel={() => { if (!renamingFolder) setRenameFolderTarget(null); }}
          onSubmit={() => void handleRenameFolder()}
        />
      )}</MotionPresence>

      <MotionPresence>{deleteFolderTarget && (
        <ConfirmDialog
          title={t("确认删除文件夹「{value0}」？", { value0: deleteFolderTarget.name })}
          description={t("将永久删除该文件夹及其中的 {value0} 份资料，包括源文件和解析结果，删除后无法恢复。", { value0: deleteFolderTarget.dataset_count })}
          art={<DeleteDatasetArt tag="DIR" color="var(--v3-sub)" />}
          confirmLabel={t("确认删除")}
          busyLabel={t("正在删除…")}
          busy={deletingFolder}
          onConfirm={() => void handleDeleteFolder()}
          onCancel={() => { if (!deletingFolder) setDeleteFolderTarget(null); }}
        />
      )}</MotionPresence>

      <Suspense fallback={null}>
        <MotionPresence>{moveTarget && (
          <MoveToFolderDialog
            open
            onOpenChange={(open) => { if (!open) setMoveTarget(null); }}
            folders={folders}
            currentFolderId={moveTarget.folder_id ?? null}
            itemCount={1}
            singleItemName={datasetDisplayName(moveTarget)}
            singleItemFormat={datasetFormatTone(moveTarget).label}
            onMove={confirmSingleMove}
          />
        )}</MotionPresence>

        <MotionPresence>{batchMoveOpen && (
          <MoveToFolderDialog
            open
            onOpenChange={setBatchMoveOpen}
            folders={folders}
            currentFolderId={canUploadHere ? selectedFolderId : null}
            itemCount={selectedDatasetCount}
            onMove={confirmBatchMove}
          />
        )}</MotionPresence>

        <MotionPresence>{associationTarget && (
          <ManageAssociationDialog
            dataset={associationTarget}
            displayName={associationTarget.file_name}
            onClose={() => setAssociationTarget(null)}
            onSaved={handleAssociationSaved}
          />
        )}</MotionPresence>

        <MotionPresence>{previewDataset && (
          <DatasetPreviewDialog
            dataset={previewDataset}
            returnFocusTo={previewTriggerRef.current}
            onClose={() => setPreviewDataset(null)}
            onManageAssociation={previewDataset.upload_status === "succeeded" ? startAssociation : undefined}
          />
        )}</MotionPresence>
      </Suspense>

      {syncFailure ? (
        <NoticeToast
          kind="error"
          message={syncFailure}
          onDismiss={() => setSyncFailure(null)}
          action={(
            <button type="button" className="v3-link" onClick={() => void refreshDatasets({ accepted: syncFailure === ACCEPTED_SYNC_FAILURE })}>{t("重新刷新")}</button>
          )}
        />
      ) : notice ? (
        <NoticeToast kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />
      ) : null}

      {batchMode && (
        <div className="v3 ds-batch-bar" role="region" aria-label={t("批量操作栏")}>
          <label>
            <DatasetSelectionCheckbox
              checked={allFilteredSelected}
              disabled={filteredDatasets.length === 0 || batchDeleteBusy}
              indeterminate={someFilteredSelected && !allFilteredSelected}
              label={t("全选当前筛选结果")}
              onChange={toggleAllFilteredDatasets}
            />{t("全选")}</label>
          <span className="ds-batch-bar-count">{t("已选 ")}<strong>{selectedDatasetCount}</strong>{t(" 项")}</span>
          <span className="ds-batch-bar-sep" aria-hidden="true" />
          <button
            type="button"
            className="v3-btn v3-btn-ghost"
            disabled={selectedDatasetCount === 0 || batchDeleteBusy}
            aria-label={t("移动到文件夹（已选择 {value0} 份）", { value0: selectedDatasetCount })}
            onClick={() => setBatchMoveOpen(true)}
          >
            <Icon name="folder" size={13} />{t("移动到文件夹")}</button>
          <button
            type="button"
            className="v3-btn v3-btn-danger"
            disabled={selectedDatasetCount === 0 || batchDeleteBusy}
            aria-label={t("删除资料（已选择 {value0} 份）", { value0: selectedDatasetCount })}
            onClick={startBulkDelete}
          >
            <Icon name="trash" size={13} />{t("删除")}</button>
          <span className="ds-batch-bar-sep" aria-hidden="true" />
          <button type="button" className="v3-icon-btn" aria-label={t("取消选择")} title={t("取消选择并退出批量")} onClick={toggleBatchMode}>
            <Icon name="x" size={15} />
          </button>
        </div>
      )}
    </RootTag>
  );
}

// 单输入框弹窗：重命名资料 / 新建文件夹 / 重命名文件夹（440 宽，标签在上，Enter 提交）
function NameDialog({
  title,
  description,
  label,
  value,
  maxLength,
  placeholder,
  error,
  busy,
  confirmLabel,
  busyLabel,
  onChange,
  onCancel,
  onSubmit,
}: {
  title: string;
  description: string;
  label: string;
  value: string;
  maxLength: number;
  placeholder?: string;
  error: string | null;
  busy: boolean;
  confirmLabel: string;
  busyLabel: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  useLocale();
  return (
    <Dialog width={440} label={title} className="ds-dialog" closable={!busy} onClose={onCancel}>
      <div className="v3-dialog-body">
        <h2 className="v3-dialog-title">{title}</h2>
        <p className="v3-dialog-sub">{description}</p>
        <label className="v3-field ds-field">
          <span className="v3-field-label">{label}</span>
          <input
            className="v3-input"
            data-autofocus
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            disabled={busy}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          {error && <small className="v3-field-error" role="alert">{error}</small>}
        </label>
      </div>
      <DialogFooter>
        <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 80 }} disabled={busy} onClick={onCancel}>{t("取消")}</button>
        <button type="button" className="v3-btn v3-btn-dark" disabled={busy} onClick={onSubmit}>{busy ? busyLabel : confirmLabel}</button>
      </DialogFooter>
    </Dialog>
  );
}

// 页面顶部的浮动提示：3 秒后自动消失；错误用 role=alert
function NoticeToast({
  kind,
  message,
  onDismiss,
  action,
}: {
  kind: "success" | "error";
  message: string;
  onDismiss: () => void;
  action?: React.ReactNode;
}) {
  useLocale();
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return (
    <div className="v3 v3-toast ds-toast" role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}>
      <Icon name={kind === "success" ? "check" : "alert"} size={16} style={{ color: kind === "error" ? "var(--v3-rd)" : "var(--v3-gn)", flex: "0 0 auto", marginTop: 2 }} />
      <span className="dataset-notice-message" title={message}>{message}</span>
      {action && <span className="ds-toast-action">{action}</span>}
    </div>
  );
}
