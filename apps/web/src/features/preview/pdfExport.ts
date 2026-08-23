import { ApiRequestError, api, type ResumePdfDownload } from "../../api/client";

export type ResumePdfExportSnapshot = {
  activeResumeId: string | null;
  lockVersion: number;
  saveStatus: "idle" | "saving" | "saved" | "error";
};

export class ResumePdfExportError extends Error {
  constructor(readonly code: "RESUME_NOT_READY" | "RESUME_SAVE_FAILED" | "RESUME_EXPORT_CANCELLED") {
    super(code);
    this.name = "ResumePdfExportError";
  }
}

export type ResumePdfExportOptions = {
  resumeId: string;
  title: string;
  saveCurrentResume: () => Promise<void>;
  getSnapshot: () => ResumePdfExportSnapshot;
  signal?: AbortSignal;
  downloadResumePdf?: (
    resumeId: string,
    lockVersion: number,
    signal?: AbortSignal,
  ) => Promise<ResumePdfDownload>;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new ResumePdfExportError("RESUME_EXPORT_CANCELLED");
}

function normalizeFilename(value: string): string {
  const normalized = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");
  return (normalized || "resume").slice(0, 180);
}

export function resumePdfFilename(headerFilename: string | null, title: string): string {
  const candidate = normalizeFilename(headerFilename || title);
  return candidate.toLowerCase().endsWith(".pdf") ? candidate : `${candidate}.pdf`;
}

export function isResumePdfExportCancelled(error: unknown): boolean {
  return error instanceof ResumePdfExportError
    ? error.code === "RESUME_EXPORT_CANCELLED"
    : error instanceof DOMException && error.name === "AbortError";
}

export function resumePdfExportErrorMessage(error: unknown): string {
  if (isResumePdfExportCancelled(error)) return "";
  if (error instanceof ResumePdfExportError) {
    if (error.code === "RESUME_SAVE_FAILED") return "简历保存失败，请修正后重试";
    return "简历暂时无法导出，请稍后重试";
  }
  if (error instanceof ApiRequestError) {
    switch (error.message) {
      case "RESUME_PDF_SNAPSHOT_STALE":
        return "简历内容已变化，请重新导出";
      case "RESUME_PDF_PAGE_TOO_TALL":
        return "简历内容过长，请调整内容后重试";
      case "RESUME_PDF_ASSETS_TOO_LARGE":
      case "RESUME_PDF_ASSET_TOO_LARGE":
      case "RESUME_PDF_ASSET_READ_FAILED":
      case "RESUME_PDF_IMAGE_UNAVAILABLE":
      case "RESUME_PDF_IMAGE_UNSUPPORTED":
        return "PDF 生成失败，请检查简历中的图片后重试";
      case "RESUME_PDF_BUSY":
      case "RESUME_PDF_RENDERER_UNAVAILABLE":
      case "RESUME_PDF_RENDER_FAILED":
      case "RESUME_PDF_TIMEOUT":
        return "PDF 服务暂时不可用，请稍后重试";
      default:
        break;
    }
    if (error.status === 409) return "简历内容已变化，请重新导出";
  }
  return "PDF 生成失败，请稍后重试";
}

export function downloadPdfBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function exportResumePdf({
  resumeId,
  title,
  saveCurrentResume,
  getSnapshot,
  signal,
  downloadResumePdf = api.downloadResumePdf,
}: ResumePdfExportOptions): Promise<void> {
  throwIfAborted(signal);
  await saveCurrentResume();
  throwIfAborted(signal);

  const snapshot = getSnapshot();
  if (snapshot.activeResumeId !== resumeId || !snapshot.lockVersion) {
    throw new ResumePdfExportError("RESUME_NOT_READY");
  }
  if (snapshot.saveStatus === "saving" || snapshot.saveStatus === "error") {
    throw new ResumePdfExportError("RESUME_SAVE_FAILED");
  }

  const result = await downloadResumePdf(resumeId, snapshot.lockVersion, signal);
  throwIfAborted(signal);
  downloadPdfBlob(result.blob, resumePdfFilename(result.filename, title));
}
