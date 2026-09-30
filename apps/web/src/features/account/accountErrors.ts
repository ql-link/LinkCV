import { ApiRequestError } from "../../api/client";

export const MAX_NICKNAME_LENGTH = 50;

// 账号页各接口的错误码 → 用户可读文案
export function accountErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.message === "INVALID_NICKNAME") return `昵称不能为空，且不能超过 ${MAX_NICKNAME_LENGTH} 个字符。`;
    if (error.message === "INVALID_IMAGE") return "请选择有效的图片文件。";
    if (error.message === "IMAGE_TOO_LARGE") return "头像图片不能超过 10MB。";
    if (error.status === 401) return "登录状态已失效，请重新登录。";
    if (error.status >= 500) return "服务暂时不可用，请稍后重试。";
  }
  return fallback;
}
