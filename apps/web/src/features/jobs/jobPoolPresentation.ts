import { ApiRequestError, type PoolJob } from "../../api/client";

export function poolRecruitment(job: PoolJob) {
  if (job.employment_type === "internship") return "实习";
  return job.recruitment_channel === "campus" ? "校招" : job.recruitment_channel === "experienced" ? "社招" : "招聘类型未标明";
}

export function poolType(job: PoolJob) {
  const channel = job.recruitment_channel === "campus" ? "校招" : job.recruitment_channel === "experienced" ? "社招" : "招聘渠道未标明";
  const employment = ({ internship: "实习", full_time: "全职", part_time: "兼职", contract: "合同制", unknown: "用工形式未标明" } as const)[job.employment_type];
  return `${channel} · ${employment}`;
}

export const syncLabels: Record<string, string> = {
  idle: "待同步", queued: "排队中", running: "同步中", complete: "正常", partial: "部分完成",
  failed: "同步失败", anomalous: "岗位数量异常，待确认", cancelled: "已取消", succeeded: "正常",
};

export function poolError(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.message : error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const messages: Record<string, string> = {
    COMPANY_CONFLICT: "公司资料已被更新，请刷新后重新编辑。",
    COMPANY_INVALID: "请检查别名和图标地址，图标需使用 HTTPS 图片地址。",
    COMPANY_LOGO_URL_REJECTED: "这个地址不能使用，请填写公网可访问的 HTTPS 图片地址。",
    COMPANY_LOGO_FETCH_FAILED: "图片下载失败，请确认地址可以直接打开，或改为上传图片。",
    COMPANY_LOGO_INVALID: "无法识别这张图片，请使用 PNG、JPG、WebP、GIF 或 ICO。",
    COMPANY_LOGO_TOO_LARGE: "图片超过 2MB，请压缩后再试。",
    COMPANY_LOGO_RATE_LIMITED: "操作太频繁，请稍后再试。",
    COMPANY_LOGO_SAVE_FAILED: "图片暂时无法保存，请稍后再试。",
    COMPANY_ALIAS_TAKEN: "这个名称已经能匹配到其他公司，不能重复归入。",
    UNMATCHED_NAME_NOT_FOUND: "这个名称已被处理，请刷新列表。",
    COMPANY_LOGO_FINGERPRINT_NOT_FOUND: "这张图片已不存在，请刷新列表。",
    COMPANY_NOT_FOUND: "未找到该公司，请刷新列表。",
    JOB_POOL_CLOSED: "该岗位已下线，无法新加入求职进程。",
    JOB_POOL_NOT_FOUND: "未找到该岗位。",
    JOB_POOL_INVALID_QUERY: "关键词需要包含 2～100 个字符。",
    JOB_POOL_INVALID_CURSOR: "筛选条件已变化，请重新搜索。",
    JOB_SOURCE_CONFLICT: "来源已被更新，请刷新后重试。",
    JOB_SOURCE_SYNC_DISABLED: "同步开关尚未开启，请先配置 Worker。",
    JOB_POOL_SYNC_DISABLED: "同步开关尚未开启，请先配置 Worker。",
    JOB_SOURCE_DISABLED: "请先启用该来源。",
    JOB_SOURCE_ADAPTER_PENDING: "该官网尚未完成适配。",
    JOB_SOURCE_STALE_GENERATION: "此同步结果已过期，请刷新后重试。",
    JOB_SYNC_STALE: "此同步结果已过期，请刷新后重试。",
    JOB_SYNC_NOT_REVIEWABLE: "当前结果不需要或不能人工确认。",
    JOB_SOURCE_NOT_REVIEWABLE: "当前结果不需要或不能人工确认。",
    JOB_POOL_SOURCE_CONFLICT: "同一官网岗位已关联其他共享岗位，请打开现有求职记录。",
  };
  return messages[code] ?? "操作未完成，请重试。";
}

export function poolDate(value: string | null): string {
  if (!value) return "尚无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚无记录";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day = date.toDateString() === now.toDateString() ? "今天" : date.toDateString() === yesterday.toDateString() ? "昨天" : date.toLocaleDateString("zh-CN");
  return `${day} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

const DAY = 86_400_000;

/** List time: 今天 / N 天前 / N 周前, then a plain month-day. */
export function poolRelative(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const start = (time: Date) => new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(date)) / DAY);
  if (days <= 0) return "今天";
  if (days < 7) return `${days} 天前`;
  if (days < 28) return `${Math.floor(days / 7)} 周前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** Collection time in the detail action bar: 今天 10:30 收录 / 10月8日 收录. */
export function poolCollected(value: string | null): string {
  if (!value) return "收录时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "收录时间未知";
  if (date.toDateString() === new Date().toDateString()) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })} 收录`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 收录`;
}
