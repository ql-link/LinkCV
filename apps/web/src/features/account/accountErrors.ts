import { t, getLocale } from "@/i18n";
import { ApiRequestError } from "../../api/client";

export const MAX_NICKNAME_LENGTH = 50;

// 账号页各接口的错误码 → 用户可读文案
export function accountErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INVALID_CONTACT_EMAIL: t("请输入有效的邮箱地址。"),
      INVALID_CURRENT_PASSWORD: t("当前密码不正确。"),
      WEAK_PASSWORD: t("新密码至少 8 位，且须包含字母和数字。"),
      PASSWORD_MISMATCH: t("两次输入的新密码不一致。"),
      PASSWORD_UNCHANGED: t("新密码不能与当前密码相同。"),
      ACCOUNT_RATE_LIMITED: t("操作过于频繁，请稍后重试。"),
      ACCOUNT_DELETION_DISABLED: t("当前暂未开放账号注销。"),
      ACCOUNT_BUSY: t("还有任务正在处理，请等任务完成后再注销。"),
      ACCOUNT_DELETION_FORBIDDEN: t("管理员账号不能在此注销。"),
      ACCOUNT_SHARED_RESOURCE_OWNER: t("账号负责公共资源，请联系管理员处理后再注销。"),
      ACCOUNT_CONFIRMATION_EXPIRED: t("身份确认已过期，请刷新二维码。"),
      ACCOUNT_CONFIRMATION_INVALID: t("身份确认已失效，请重新确认。"),
      ACCOUNT_CONFIRMATION_UNAVAILABLE: t("身份确认已取消或已使用，请刷新二维码。"),
      WECHAT_IDENTITY_MISMATCH: t("请使用当前账号的微信确认。"),
    };
    if (messages[error.message]) return messages[error.message];
    if (error.message === "INVALID_NICKNAME") return t("昵称不能为空，且不能超过 {value0} 个字符。", { value0: MAX_NICKNAME_LENGTH });
    if (error.message === "INVALID_IMAGE") return t("请选择有效的图片文件。");
    if (error.message === "IMAGE_TOO_LARGE") return t("头像图片不能超过 10MB。");
    if (error.status === 401) return t("登录状态已失效，请重新登录。");
    if (error.status >= 500) return t("服务暂时不可用，请稍后重试。");
  }
  return fallback;
}
