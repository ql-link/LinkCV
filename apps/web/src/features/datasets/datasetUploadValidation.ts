import { ApiRequestError, type DatasetLimits } from "../../api/client";

export const DEFAULT_DATASET_LIMITS: DatasetLimits = {
  max_file_bytes: 10 * 1024 * 1024,
  max_files_per_batch: 10,
  allowed_extensions: [".pdf", ".docx", ".md", ".txt"],
};

export function normalizeDatasetLimits(limits?: Partial<DatasetLimits> | null): DatasetLimits {
  const maxFileBytes = Number(limits?.max_file_bytes);
  const maxFilesPerBatch = Number(limits?.max_files_per_batch);
  const allowedExtensions = Array.isArray(limits?.allowed_extensions)
    ? limits.allowed_extensions.filter((extension): extension is string => typeof extension === "string")
    : [];

  return {
    max_file_bytes: Number.isFinite(maxFileBytes) && maxFileBytes > 0
      ? maxFileBytes
      : DEFAULT_DATASET_LIMITS.max_file_bytes,
    max_files_per_batch: Number.isFinite(maxFilesPerBatch) && maxFilesPerBatch > 0
      ? Math.floor(maxFilesPerBatch)
      : DEFAULT_DATASET_LIMITS.max_files_per_batch,
    allowed_extensions: allowedExtensions.length > 0
      ? allowedExtensions.map((extension) => extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`)
      : DEFAULT_DATASET_LIMITS.allowed_extensions,
  };
}

export function formatDatasetFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatUnit(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${formatUnit(bytes / 1024 / 1024)} MB`;
  return `${formatUnit(bytes / 1024 / 1024 / 1024)} GB`;
}

function formatUnit(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function supportedExtension(file: File, limits: DatasetLimits): boolean {
  const extension = file.name.includes(".")
    ? `.${file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()}`
    : "";
  return limits.allowed_extensions.some((allowed) => allowed.toLowerCase() === extension);
}

export function datasetFormatError(
  file: File,
  rawLimits: DatasetLimits = DEFAULT_DATASET_LIMITS,
): string | null {
  const limits = normalizeDatasetLimits(rawLimits);
  if (file.size === 0) return "文件为空，请重新选择。";
  if (!supportedExtension(file, limits)) {
    return "仅支持 DOCX、PDF、Markdown 和 TXT 文件。";
  }
  if (file.size > limits.max_file_bytes) {
    return `文件过大，最大支持 ${formatDatasetFileSize(limits.max_file_bytes)}。`;
  }
  return null;
}

export function datasetUploadErrorMessage(
  error: unknown,
  fallback: string,
  rawLimits: DatasetLimits = DEFAULT_DATASET_LIMITS,
): string {
  if (!(error instanceof ApiRequestError)) return fallback;

  switch (error.message) {
    case "INVALID_IDEMPOTENCY_KEY":
      return "上传请求无效，请重试。";
    case "INVALID_DATASET_FILENAME":
      return "文件名无效，请重命名后再上传。";
    case "UNSUPPORTED_DATASET_FILE":
    case "UNSUPPORTED_DATASET_FORMAT":
      return "仅支持 DOCX、PDF、Markdown 和 TXT 文件。";
    case "EMPTY_DATASET_FILE":
      return "文件为空，请重新选择。";
    case "DATASET_FILE_TOO_LARGE":
    case "DATASET_TOO_LARGE":
      return `文件过大，最大支持 ${formatDatasetFileSize(normalizeDatasetLimits(rawLimits).max_file_bytes)}，请缩小文件后重试。`;
    case "DATASET_UPLOAD_FAILED":
      return "上传失败，请稍后重试。";
    case "DATASET_STORAGE_UNAVAILABLE":
      return "文件存储暂不可用，请稍后重试。";
    case "DATASET_RECORD_FAILED":
      return "资料保存失败，请稍后重试。";
    case "DATASET_COUNT_LIMIT_REACHED":
      return "当前资料数量已达上限。";
    case "DATASET_STORAGE_LIMIT_REACHED":
      return "当前资料容量已达上限。";
    case "DATASET_UPLOAD_RATE_LIMITED":
      return "上传过于频繁，请稍后重试。";
    case "DATASET_ADMISSION_UNAVAILABLE":
      return "上传准入暂不可用，请稍后重试。";
    case "IDEMPOTENCY_KEY_REUSED":
      return "本次上传请求已用于其他文件，请重新选择后上传。";
    case "DATASET_UPLOAD_PREVIOUSLY_FAILED":
      return "上次上传已明确失败，请重新发起上传。";
    default:
      if (error.status === 401) return "登录状态已失效，请重新登录。";
      return error.status >= 500 ? "服务暂时不可用，请稍后重试。" : fallback;
  }
}
