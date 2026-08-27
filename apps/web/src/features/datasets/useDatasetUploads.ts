import { useCallback, useEffect, useRef, useState } from "react";

import {
  api,
  ApiRequestError,
  type DatasetLimits,
  type DatasetRecord,
} from "../../api/client";
import {
  datasetFormatError,
  DEFAULT_DATASET_LIMITS,
  datasetUploadErrorMessage,
  normalizeDatasetLimits,
} from "./datasetUploadValidation";

export type DatasetUploadItemStatus = "selected" | "validating" | "uploading" | "failed";

export type DatasetUploadItem = {
  id: string;
  file: File;
  idempotencyKey: string;
  status: DatasetUploadItemStatus;
  checked: boolean;
  error: string | null;
  retryable: boolean;
  /** Explicit server rejection requires a fresh key; ambiguous failures reuse this key. */
  retryWithNewKey: boolean;
};

export type DatasetUploadFailure = {
  fileName: string;
  reason: string;
};

export type DatasetUploadBatchResult = {
  attemptedCount: number;
  acceptedCount: number;
  failedCount: number;
  remainingCount: number;
  remainingFailedCount: number;
  remainingUncheckedCount: number;
  /** Compatibility signal for the retired queue-error response contract. */
  deferredCount: number;
  failures: DatasetUploadFailure[];
  limitMessage: string | null;
};

function remainingUploadCounts(items: DatasetUploadItem[]) {
  return {
    remainingCount: items.length,
    remainingFailedCount: items.filter((item) => item.status === "failed").length,
    remainingUncheckedCount: items.filter((item) => item.status === "selected" && !item.checked).length,
  };
}

function collectUploadFailures(items: DatasetUploadItem[]): DatasetUploadFailure[] {
  return items
    .filter((item) => item.status === "failed" && item.error)
    .map((item) => ({ fileName: item.file.name, reason: item.error ?? "上传失败，请稍后重试。" }));
}

function emptyBatchResult(overrides: Partial<DatasetUploadBatchResult> = {}): DatasetUploadBatchResult {
  return {
    attemptedCount: 0,
    acceptedCount: 0,
    failedCount: 0,
    remainingCount: 0,
    remainingFailedCount: 0,
    remainingUncheckedCount: 0,
    deferredCount: 0,
    failures: [],
    limitMessage: null,
    ...overrides,
  };
}

function datasetUploadFileIdentity(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`;
}

type UseDatasetUploadsOptions = {
  limits?: DatasetLimits;
  concurrency?: number;
  onAccepted?: (dataset: DatasetRecord) => void;
  onLimitExceeded?: (message: string) => void;
};

type DatasetUploadStateUpdater =
  | DatasetUploadItem[]
  | ((items: DatasetUploadItem[]) => DatasetUploadItem[]);

type PreparedUpload = {
  items: DatasetUploadItem[];
  failures: DatasetUploadFailure[];
  limitMessage: string | null;
};

const EXPLICIT_UPLOAD_FAILURE_CODES = new Set([
  "INVALID_IDEMPOTENCY_KEY",
  "INVALID_DATASET_FILENAME",
  "UNSUPPORTED_DATASET_FILE",
  "UNSUPPORTED_DATASET_FORMAT",
  "EMPTY_DATASET_FILE",
  "DATASET_FILE_TOO_LARGE",
  "DATASET_TOO_LARGE",
  "DATASET_UPLOAD_FAILED",
  "DATASET_STORAGE_UNAVAILABLE",
  "DATASET_COUNT_LIMIT_REACHED",
  "DATASET_STORAGE_LIMIT_REACHED",
  "DATASET_UPLOAD_RATE_LIMITED",
  "DATASET_ADMISSION_UNAVAILABLE",
  "IDEMPOTENCY_KEY_REUSED",
  "DATASET_UPLOAD_PREVIOUSLY_FAILED",
]);

/**
 * A concrete API rejection is safe to retry with a new request identity. An
 * unknown 5xx or a network error may have happened after the server accepted
 * the request, so it must retain the old idempotency key.
 */
export function datasetUploadFailureUsesNewKey(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  return EXPLICIT_UPLOAD_FAILURE_CODES.has(error.message)
    || (error.status >= 400 && error.status < 500);
}

function createDatasetIdempotencyKey(): string {
  const secureCrypto = globalThis.crypto;
  const randomUUID = secureCrypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return randomUUID.call(secureCrypto);
  }
  if (typeof secureCrypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    secureCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return uuidFromHex(Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
  }

  // The idempotency key is a collision-resistant request identity, not a
  // credential. Some embedded browsers do not expose Web Crypto even on
  // localhost, so combine time, a page-local sequence and 48 random bits.
  const timestamp = Date.now().toString(16).padStart(12, "0").slice(-12);
  const sequence = (fallbackSequence++ >>> 0).toString(16).padStart(8, "0");
  const random = Math.floor(Math.random() * 0x1000000000000)
    .toString(16)
    .padStart(12, "0");
  const chars = Array.from(`${timestamp}${sequence}${random}`);
  chars[12] = "4";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return uuidFromHex(chars.join(""));
}

let fallbackSequence = 0;

function uuidFromHex(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function updateItem(
  items: DatasetUploadItem[],
  id: string,
  patch: Partial<DatasetUploadItem>,
): DatasetUploadItem[] {
  return items.map((item) => item.id === id ? { ...item, ...patch } : item);
}

function formatBatchLimitMessage(limit: number, retained = false): string {
  return retained
    ? `一次最多选择 ${limit} 个文件，已保留前 ${limit} 个。`
    : `一次最多选择 ${limit} 个文件。`;
}

export function useDatasetUploads({
  limits = DEFAULT_DATASET_LIMITS,
  concurrency = 3,
  onAccepted,
  onLimitExceeded,
}: UseDatasetUploadsOptions = {}) {
  const [items, setItems] = useState<DatasetUploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const itemSequence = useRef(0);
  const itemsRef = useRef<DatasetUploadItem[]>([]);
  const limitsRef = useRef<DatasetLimits>(normalizeDatasetLimits(limits));
  const concurrencyRef = useRef(3);
  const onAcceptedRef = useRef(onAccepted);
  const onLimitExceededRef = useRef(onLimitExceeded);
  const uploadingRef = useRef(false);
  const mountedRef = useRef(true);
  const ambiguousRetryKeysRef = useRef(new Map<string, string>());

  limitsRef.current = normalizeDatasetLimits(limits);
  concurrencyRef.current = Number.isFinite(concurrency) && concurrency > 0
    ? Math.floor(concurrency)
    : 3;
  onAcceptedRef.current = onAccepted;
  onLimitExceededRef.current = onLimitExceeded;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadingRef.current = false;
    };
  }, []);

  const commitItems = useCallback((updater: DatasetUploadStateUpdater) => {
    const nextItems = typeof updater === "function"
      ? updater(itemsRef.current)
      : updater;
    itemsRef.current = nextItems;
    if (mountedRef.current) setItems(nextItems);
    return nextItems;
  }, []);

  // The first list response can arrive after a user has already opened the
  // dialog. Reconcile any optimistic fallback selection with the authoritative
  // server batch limit and re-run size/extension validation under that limit.
  useEffect(() => {
    const limit = limitsRef.current.max_files_per_batch;
    if (itemsRef.current.length <= limit) return;
    commitItems((current) => current.slice(0, limit).map((item) => {
      if (item.status !== "selected") return item;
      const error = datasetFormatError(item.file, limitsRef.current);
      return error
        ? { ...item, status: "failed", checked: false, error, retryable: false, retryWithNewKey: false }
        : item;
    }));
    onLimitExceededRef.current?.(formatBatchLimitMessage(limit, true));
  }, [
    commitItems,
    limits.max_file_bytes,
    limits.max_files_per_batch,
    limits.allowed_extensions.join("|"),
  ]);

  const prepareUpload = useCallback((files: File[]): PreparedUpload => {
    if (files.length === 0) return { items: [], failures: [], limitMessage: null };
    const limit = limitsRef.current.max_files_per_batch;
    const available = Math.max(0, limit - itemsRef.current.length);
    if (available === 0) {
      return { items: [], failures: [], limitMessage: formatBatchLimitMessage(limit) };
    }

    const selectedFiles = files.slice(0, available);
    const items: DatasetUploadItem[] = [];
    const failures: DatasetUploadFailure[] = [];
    for (const file of selectedFiles) {
      const error = datasetFormatError(file, limitsRef.current);
      if (error) {
        failures.push({ fileName: file.name, reason: error });
        continue;
      }

      try {
        const identity = datasetUploadFileIdentity(file);
        const idempotencyKey = ambiguousRetryKeysRef.current.get(identity) ?? createDatasetIdempotencyKey();
        items.push({
          id: `dataset-upload-${itemSequence.current++}`,
          file,
          idempotencyKey,
          status: "selected",
          checked: true,
          error: null,
          retryable: false,
          retryWithNewKey: false,
        });
      } catch {
        failures.push({ fileName: file.name, reason: "无法创建上传请求，请刷新页面后重试。" });
      }
    }

    return {
      items,
      failures,
      limitMessage: files.length > available ? formatBatchLimitMessage(limit, true) : null,
    };
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const prepared = prepareUpload(files);
    if (prepared.items.length > 0) commitItems([...itemsRef.current, ...prepared.items]);
    if (prepared.limitMessage) onLimitExceededRef.current?.(prepared.limitMessage);
    if (prepared.failures.length > 0 && prepared.items.length === 0) {
      onLimitExceededRef.current?.(prepared.failures[0]?.reason ?? "上传失败，请稍后重试。");
    }
    return prepared;
  }, [commitItems, prepareUpload]);

  const removeItem = useCallback((id: string) => {
    if (uploadingRef.current) return;
    commitItems((current) => current.filter((item) => item.id !== id));
  }, [commitItems]);

  const toggleItemSelection = useCallback((id: string) => {
    if (uploadingRef.current) return;
    const current = itemsRef.current.find((item) => item.id === id);
    if (!current || current.status !== "selected") return;
    commitItems((previous) => updateItem(previous, id, { checked: !current.checked }));
  }, [commitItems]);

  const retryItem = useCallback((id: string) => {
    if (uploadingRef.current) return;
    const current = itemsRef.current.find((item) => item.id === id);
    if (!current || current.status !== "failed") return;
    commitItems((previous) => previous.map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        idempotencyKey: item.retryWithNewKey ? createDatasetIdempotencyKey() : item.idempotencyKey,
        status: "selected",
        checked: true,
        error: null,
        retryable: false,
        retryWithNewKey: false,
      };
    }));
  }, [commitItems]);

  const clearItems = useCallback(() => {
    if (uploadingRef.current) return;
    commitItems([]);
  }, [commitItems]);

  const uploadSelected = useCallback(async (): Promise<DatasetUploadBatchResult> => {
    if (uploadingRef.current) {
      return emptyBatchResult({
        ...remainingUploadCounts(itemsRef.current),
        failures: collectUploadFailures(itemsRef.current),
      });
    }

    const selected = itemsRef.current.filter((item) => item.status === "selected" && item.checked);
    if (selected.length === 0) {
      const failures = collectUploadFailures(itemsRef.current);
      return emptyBatchResult({
        ...remainingUploadCounts(itemsRef.current),
        failedCount: failures.length,
        failures,
      });
    }

    uploadingRef.current = true;
    if (mountedRef.current) setUploading(true);
    const selectedIds = new Set(selected.map((item) => item.id));
    commitItems((current) => current.map((item) => selectedIds.has(item.id)
      ? { ...item, status: "validating", error: null, retryable: false }
      : item));

    let nextIndex = 0;
    let acceptedCount = 0;
    let failedCount = 0;
    let deferredCount = 0;
    const deferredFailures: DatasetUploadFailure[] = [];

    const uploadOne = async (item: DatasetUploadItem) => {
      const validationError = datasetFormatError(item.file, limitsRef.current);
      if (validationError) {
        failedCount += 1;
        ambiguousRetryKeysRef.current.delete(datasetUploadFileIdentity(item.file));
        commitItems((current) => updateItem(current, item.id, {
          status: "failed",
          checked: false,
          error: validationError,
          retryable: false,
          retryWithNewKey: false,
        }));
        return;
      }

      commitItems((current) => updateItem(current, item.id, {
        status: "uploading",
        error: null,
        retryable: false,
      }));

      try {
        const dataset = await api.uploadDataset(item.file, item.idempotencyKey);
        if (dataset.upload_status !== "succeeded") {
          failedCount += 1;
          ambiguousRetryKeysRef.current.set(datasetUploadFileIdentity(item.file), item.idempotencyKey);
          commitItems((current) => updateItem(current, item.id, {
            status: "failed",
            checked: false,
            error: "服务端仍在确认上传结果，请稍后重试。",
            retryable: true,
            retryWithNewKey: false,
          }));
          return;
        }
        acceptedCount += 1;
        ambiguousRetryKeysRef.current.delete(datasetUploadFileIdentity(item.file));
        // The response is authoritative. Upsert before the batch-wide list
        // refresh so an accepted row remains visible even if that refresh fails.
        onAcceptedRef.current?.(dataset);
        commitItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      } catch (error) {
        // DATASET_QUEUE_UNAVAILABLE was used by the previous backend contract
        // after persisting a record. Treat it as accepted for compatibility;
        // current backends return the queued record directly instead.
        if (error instanceof ApiRequestError && error.message === "DATASET_QUEUE_UNAVAILABLE") {
          acceptedCount += 1;
          deferredCount += 1;
          deferredFailures.push({
            fileName: item.file.name,
            reason: "资料已保存，但解析提交失败，请在列表中重新解析。",
          });
          ambiguousRetryKeysRef.current.delete(datasetUploadFileIdentity(item.file));
          commitItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
          return;
        }

        failedCount += 1;
        const retryWithNewKey = datasetUploadFailureUsesNewKey(error);
        if (retryWithNewKey) {
          ambiguousRetryKeysRef.current.delete(datasetUploadFileIdentity(item.file));
        } else {
          ambiguousRetryKeysRef.current.set(datasetUploadFileIdentity(item.file), item.idempotencyKey);
        }
        commitItems((current) => updateItem(current, item.id, {
          status: "failed",
          checked: false,
          error: datasetUploadErrorMessage(
            error,
            "上传失败，请稍后重试。",
            limitsRef.current,
          ),
          retryable: true,
          retryWithNewKey,
        }));
      }
    };

    const worker = async () => {
      while (nextIndex < selected.length) {
        const item = selected[nextIndex];
        nextIndex += 1;
        if (item) await uploadOne(item);
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrencyRef.current, selected.length) }, () => worker()),
      );
    } finally {
      uploadingRef.current = false;
      if (mountedRef.current) setUploading(false);
    }

    const failures = [...collectUploadFailures(itemsRef.current), ...deferredFailures];
    return {
      attemptedCount: selected.length,
      acceptedCount,
      failedCount,
      ...remainingUploadCounts(itemsRef.current),
      deferredCount,
      failures,
      limitMessage: null,
    };
  }, [commitItems]);

  const uploadFiles = useCallback(async (files: File[]): Promise<DatasetUploadBatchResult> => {
    if (files.length === 0 || uploadingRef.current) return emptyBatchResult();

    const prepared = prepareUpload(files);
    if (prepared.items.length > 0) commitItems([...itemsRef.current, ...prepared.items]);

    let result = emptyBatchResult({
      attemptedCount: prepared.items.length,
      failedCount: prepared.failures.length,
      failures: prepared.failures,
      limitMessage: prepared.limitMessage,
    });

    try {
      if (prepared.items.length > 0) {
        const uploaded = await uploadSelected();
        result = {
          ...uploaded,
          attemptedCount: prepared.items.length + prepared.failures.length,
          failedCount: uploaded.failedCount + prepared.failures.length,
          failures: [...prepared.failures, ...uploaded.failures],
          limitMessage: prepared.limitMessage,
        };
      }
    } finally {
      // Failed files are intentionally not retained as local candidates. The
      // caller reports their names and reasons and the user can select them
      // again to start a new upload lifecycle.
      if (!uploadingRef.current) commitItems([]);
    }

    return {
      ...result,
      remainingCount: 0,
      remainingFailedCount: 0,
      remainingUncheckedCount: 0,
    };
  }, [commitItems, prepareUpload, uploadSelected]);

  return {
    items,
    uploading,
    addFiles,
    removeItem,
    retryItem,
    toggleItemSelection,
    clearItems,
    uploadSelected,
    uploadFiles,
  };
}
