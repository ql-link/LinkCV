export const MAX_RESUME_IMAGE_BYTES = 10 * 1024 * 1024;
export const RESUME_IMAGE_TOO_LARGE_MESSAGE = "图片不能超过 10MB";
export const RESUME_IMAGE_FORMAT_MESSAGE = "仅支持 PNG 或 JPEG 图片";
export const RESUME_IMAGE_ACCEPT = "image/png,image/jpeg";

const supportedResumeImageTypes = new Set(["image/png", "image/jpeg"]);

export function validateResumeImageFile(file: File): string | null {
  if (!supportedResumeImageTypes.has(file.type)) return RESUME_IMAGE_FORMAT_MESSAGE;
  if (file.size > MAX_RESUME_IMAGE_BYTES) return RESUME_IMAGE_TOO_LARGE_MESSAGE;
  return null;
}

export function resumeImageContractErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case "RESUME_PDF_ASSETS_TOO_LARGE":
      return "简历中引用的图片总大小不能超过 10MB";
    case "RESUME_PDF_ASSET_TOO_LARGE":
      return RESUME_IMAGE_TOO_LARGE_MESSAGE;
    case "RESUME_PDF_IMAGE_UNSUPPORTED":
      return RESUME_IMAGE_FORMAT_MESSAGE;
    case "RESUME_PDF_IMAGE_UNAVAILABLE":
    case "RESUME_PDF_ASSET_READ_FAILED":
      return "简历中的图片暂时无法读取，请重新上传后再试";
    default:
      return null;
  }
}
