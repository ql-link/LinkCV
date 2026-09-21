import { ApiRequestError, type DatasetLimits } from "../../api/client";

export const DEFAULT_DATASET_LIMITS: DatasetLimits = {
  max_file_bytes: 10 * 1024 * 1024,
  max_files_per_batch: 10,
  allowed_extensions: [".pdf", ".docx", ".md", ".txt"],
  max_media_file_bytes: 500 * 1024 * 1024,
  media_allowed_extensions: [".webm", ".m4a", ".mp3", ".wav", ".ogg", ".mp4", ".mov"],
};

export function normalizeDatasetLimits(limits?: Partial<DatasetLimits> | null): DatasetLimits {
  const maxFileBytes = Number(limits?.max_file_bytes);
  const maxFilesPerBatch = Number(limits?.max_files_per_batch);
  const allowedExtensions = Array.isArray(limits?.allowed_extensions)
    ? limits.allowed_extensions.filter((extension): extension is string => typeof extension === "string")
    : [];
  const maxMediaFileBytes = Number(limits?.max_media_file_bytes);
  const mediaAllowedExtensions = Array.isArray(limits?.media_allowed_extensions)
    ? limits.media_allowed_extensions.filter((extension): extension is string => typeof extension === "string")
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
    max_media_file_bytes: Number.isFinite(maxMediaFileBytes) && maxMediaFileBytes > 0
      ? maxMediaFileBytes
      : DEFAULT_DATASET_LIMITS.max_media_file_bytes,
    media_allowed_extensions: mediaAllowedExtensions.length > 0
      ? mediaAllowedExtensions.map((extension) => extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`)
      : DEFAULT_DATASET_LIMITS.media_allowed_extensions,
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

function fileExtension(file: File): string {
  return file.name.includes(".")
    ? `.${file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()}`
    : "";
}

export function isMediaDatasetFile(file: File | { name: string }, limits: DatasetLimits = DEFAULT_DATASET_LIMITS): boolean {
  const extension = file.name.includes(".")
    ? `.${file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()}`
    : "";
  const normalized = normalizeDatasetLimits(limits);
  return (normalized.media_allowed_extensions ?? []).some(
    (allowed) => allowed.toLowerCase() === extension,
  );
}

export function datasetFormatError(
  file: File,
  rawLimits: DatasetLimits = DEFAULT_DATASET_LIMITS,
): string | null {
  const limits = normalizeDatasetLimits(rawLimits);
  if (file.size === 0) return "文件为空，请重新选择。";
  const extension = fileExtension(file);
  const isMedia = (limits.media_allowed_extensions ?? []).some(
    (allowed) => allowed.toLowerCase() === extension,
  );
  const isDocument = limits.allowed_extensions.some(
    (allowed) => allowed.toLowerCase() === extension,
  );
  if (!isMedia && !isDocument) {
    return "仅支持 DOCX、PDF、Markdown、TXT 和常见音视频文件。";
  }
  if (isMedia) {
    const mediaLimit = limits.max_media_file_bytes ?? DEFAULT_DATASET_LIMITS.max_media_file_bytes!;
    if (file.size > mediaLimit) {
      return `音视频文件过大，最大支持 ${formatDatasetFileSize(mediaLimit)}。`;
    }
    return null;
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
    case "DATASET_FOLDER_REQUIRED":
      return "请先进入文件夹再上传资料。";
    case "FOLDER_NOT_FOUND":
      return "目标文件夹已不存在或不可访问，请重新选择文件夹。";
    case "INVALID_DATASET_FILENAME":
      return "文件名无效，请重命名后再上传。";
    case "UNSUPPORTED_DATASET_FILE":
    case "UNSUPPORTED_DATASET_FORMAT":
      return "仅支持 DOCX、PDF、Markdown、TXT 和常见音视频文件。";
    case "DATASET_FILE_EXTENSION_MISMATCH":
      return "文件内容与扩展名不匹配，请检查后重试。";
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
    case "DATASET_MEDIA_COUNT_LIMIT_REACHED":
      return "音视频资料数量已达上限。";
    case "DATASET_MEDIA_STORAGE_LIMIT_REACHED":
      return "音视频资料容量已达上限。";
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
