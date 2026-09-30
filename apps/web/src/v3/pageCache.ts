// 页面数据的短时缓存，做法与 TanStack Query / SWR 的默认行为一致（stale-while-revalidate）：
// · 回到看过的页面：先直接显示上一次的数据（不画骨架），同时在后台静默拉一次最新数据，到了原地替换；
// · 去重：同一份数据 PAGE_CACHE_DEDUPE_MS（10 秒）内已经读过就不再请求，来回快速切页不会反复打接口；
//   几乎不变的数据（如简历模板）传 PAGE_CACHE_STATIC_MS（5 分钟）；
// · 窗口重新回到前台（从别的窗口 / 应用切回来）：通知当前页面在后台刷新一次，5 秒内最多一次；
// · 后台刷新失败时保留已显示的数据，只有从来没读到过才显示失败状态。
// 缓存按当前登录用户隔离：resumeStore 在登录用户变化时调用 setPageCacheUser，用户一变就整体清空；
// 只放在内存里，刷新浏览器即失效。
import { useEffect, useRef } from "react";

export const PAGE_CACHE_DEDUPE_MS = 10_000;
export const PAGE_CACHE_STATIC_MS = 5 * 60_000;
const FOCUS_THROTTLE_MS = 5_000;
const REVALIDATE_EVENT = "linkresume:page-cache-revalidate";

type Entry = { value: unknown; at: number };

const entries = new Map<string, Entry>();
let cacheUserId: string | null = null;

export function setPageCacheUser(userId: string | null) {
  if (userId === cacheUserId) return;
  cacheUserId = userId;
  entries.clear();
}

/** fresh = 距上次成功读取不到 freshMs，此时不需要再请求 */
export function readPageCache<T>(key: string, freshMs = PAGE_CACHE_DEDUPE_MS): { value: T; fresh: boolean } | null {
  if (cacheUserId === null) return null;
  const entry = entries.get(key);
  if (!entry) return null;
  return { value: entry.value as T, fresh: Date.now() - entry.at < freshMs };
}

/** 从接口拿到新数据后调用：内容和时间戳一起更新 */
export function writePageCache<T>(key: string, value: T) {
  if (cacheUserId === null) return;
  entries.set(key, { value, at: Date.now() });
}

/** 本地改了数据（上传、改名、删除等）：只更新内容，不刷新时间戳，不影响下一次后台刷新 */
export function updatePageCache<T>(key: string, value: T) {
  if (cacheUserId === null) return;
  const entry = entries.get(key);
  entries.set(key, { value, at: entry?.at ?? 0 });
}

export function clearPageCache() {
  entries.clear();
}

// 窗口回到前台：广播一次「请后台刷新」，由当前挂载的页面各自处理（5 秒内最多一次）
let lastFocusRevalidate = 0;
if (typeof document !== "undefined" && typeof window !== "undefined") {
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastFocusRevalidate < FOCUS_THROTTLE_MS) return;
    lastFocusRevalidate = now;
    window.dispatchEvent(new Event(REVALIDATE_EVENT));
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

/** 页面挂载期间，窗口回到前台时在后台刷新一次（回调里应以 background 方式请求，不画骨架） */
export function useRevalidateOnFocus(revalidate: () => void) {
  const callback = useRef(revalidate);
  callback.current = revalidate;
  useEffect(() => {
    const handler = () => callback.current();
    window.addEventListener(REVALIDATE_EVENT, handler);
    return () => window.removeEventListener(REVALIDATE_EVENT, handler);
  }, []);
}

/** 测试用：模拟一次「窗口回到前台」 */
export function triggerPageCacheRevalidate() {
  lastFocusRevalidate = 0;
  window.dispatchEvent(new Event(REVALIDATE_EVENT));
}
