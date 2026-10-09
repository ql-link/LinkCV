import { useEffect, useState } from "react";
import { api, ApiRequestError, type AccountDeletionReceipt } from "../../api/client";
import { V3Shell } from "../../v3/Shell";
import { t, useLocale } from "../../i18n";

const RECEIPT_KEY = "linkresume.account-deletion-receipt";
let memoryReceipt: AccountDeletionReceipt | null = null;
export function saveDeletionReceipt(receipt: AccountDeletionReceipt) {
  memoryReceipt = receipt;
  try { sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(receipt)); } catch { /* memory retains the receipt for this tab */ }
}
function readReceipt(): AccountDeletionReceipt | null {
  if (memoryReceipt) return memoryReceipt;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(RECEIPT_KEY) ?? "null");
    if (value && typeof value === "object" && "job_id" in value && "receipt_token" in value && typeof value.job_id === "string" && typeof value.receipt_token === "string") return value as AccountDeletionReceipt;
  } catch { /* no usable receipt */ }
  return null;
}
export function AccountDeletionPage() {
  useLocale();
  const [receipt] = useState(readReceipt);
  const [status, setStatus] = useState("pending");
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!receipt) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.accountDeletionStatus(receipt);
        if (!active) return;
        setStatus(result.status); setFailed(false);
        if (result.status !== "completed" && result.status !== "needs_attention") timer = setTimeout(() => void poll(), 5000);
      } catch (error) { if (active) { if (error instanceof ApiRequestError && error.status === 404) { setExpired(true); } else { setFailed(true); timer = setTimeout(() => void poll(), 15000); } } }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [receipt]);
  return <V3Shell active="none" bare><main className="auth-col" role="status">
    <h1>{t("账号注销进度")}</h1>
    {!receipt ? <p>{t("此浏览器没有注销回执，无法查询进度。")}</p> : <>
      <p>{t("账号已停用，登录和公开分享已经失效。")}</p>
      {expired ? <p>{t("注销回执已失效，无法继续查询。")}</p> : <p>{(status === "completed" ? t("个人数据已清理完成。") : status === "needs_attention" ? t("清理需要人工处理，请提供下方任务编号联系支持。") : status === "retry_wait" ? t("清理暂时失败，后台会继续重试。") : t("正在清理个人数据，可以关闭此页面。"))}</p>}
      {failed && <p role="alert">{t("暂时无法查询进度，正在重试。")}</p>}
      <p>{t("任务编号")}: {receipt.job_id}</p>
    </>}
    <a className="v3-link" href="/">{t("返回首页")}</a>
  </main></V3Shell>;
}
