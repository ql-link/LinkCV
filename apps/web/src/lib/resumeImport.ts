import { ApiRequestError } from "@/api/client";

export function importErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "导入请求失败，请检查网络后重试。";
  const messages: Record<string, string> = {
    RESUME_LIMIT_REACHED: "每个账号最多保存 10 份简历，请先删除一份后再导入。",
    TEMPLATE_INACTIVE: "导入所需的默认版式暂时不可用，请稍后重试。",
    EMPTY_IMPORT_FILE: "文件为空，请重新选择。",
    IMPORT_FILE_TOO_LARGE: "文件过大，最大支持 10 MB。",
    UNSUPPORTED_IMPORT_FORMAT: "仅支持 Markdown、DOCX 和 PDF 文件。",
    INVALID_IMPORT_FILENAME: "文件名无效，请重新选择。",
    IMPORT_CONTENT_INVALID: "文件内容无法读取，请重新选择。",
    STRUCTURING_INPUT_TOO_LARGE: "转换后的简历内容过长，暂时无法结构化。",
    IMPORT_RATE_LIMITED: "导入请求过于频繁，请稍后重试。",
    IMPORT_ALREADY_PROCESSING: "这份简历正在导入，请等待当前请求完成。",
    IDEMPOTENCY_KEY_REUSED: "本次导入标识已被使用，请重新选择文件后再试。",
    IMPORT_IDEMPOTENCY_UNAVAILABLE: "导入保护服务暂时不可用，请稍后重试。",
    IMPORT_ACCEPTANCE_IN_PROGRESS: "导入正在受理，请稍后刷新查看。",
    IMPORT_PREVIOUSLY_FAILED: "这次导入已经失败，请删除失败记录后重新上传。",
    RESUME_SOURCE_UPLOAD_FAILED: "源文件上传失败，请稍后重试。",
    RESUME_IMPORT_QUEUE_UNAVAILABLE: "解析队列暂时不可用，失败记录已保留。",
    DOCUMENT_CONVERSION_UNAVAILABLE: "文档解析服务暂时不可用，请稍后重试。",
    DOCUMENT_CONVERSION_TIMEOUT: "文档解析超时，请稍后重新导入。",
    DOCUMENT_CONVERSION_FAILED: "文档解析失败，请检查文件内容后重试。",
    STRUCTURING_MODEL_UNAVAILABLE: "内容结构化模型未配置或凭据不可用，请联系管理员配置后重试。",
    STRUCTURING_MODEL_FAILED: "内容结构化失败，请稍后重试。",
    RESUME_STRUCTURE_INVALID: "文件已解析，但生成的简历结构无效，请检查内容后重试。",
    IMPORT_CREATE_FAILED: "正式简历创建失败，请稍后重试。",
    IMPORT_DEADLINE_EXCEEDED: "导入处理超时，请稍后重新导入。",
  };
  return messages[error.message] ?? `导入失败（${error.message}），请稍后重试。`;
}

export function formatImportFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function resumeTitleFromFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

export function buildNamedImportFile(file: File, title: string) {
  const extension = file.name.match(/\.[^.]+$/)?.[0] ?? "";
  const normalizedTitle = title.trim();
  return new File([file], `${normalizedTitle}${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

export function validateImportTitle(title: string, filename: string) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return "请输入简历名称。";
  if (/[\\/]/.test(normalizedTitle) || Array.from(normalizedTitle).some((character) => character.charCodeAt(0) < 32)) {
    return "简历名称不能包含路径符号或控制字符。";
  }
  const extensionLength = filename.match(/\.[^.]+$/)?.[0].length ?? 0;
  if (normalizedTitle.length + extensionLength > 255) return "简历名称过长，请缩短后重试。";
  return null;
}
