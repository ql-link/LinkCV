import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_CACHE_DEDUPE_MS, PAGE_CACHE_STATIC_MS, readPageCache, setPageCacheUser, triggerPageCacheRevalidate, updatePageCache, useRevalidateOnFocus, writePageCache } from "./pageCache";
import { renderHook } from "@testing-library/react";

afterEach(() => {
  vi.useRealTimers();
  setPageCacheUser(null);
});

describe("pageCache", () => {
  it("未登录时不读也不写", () => {
    setPageCacheUser(null);
    writePageCache("k", 1);
    expect(readPageCache("k")).toBeNull();
  });

  it("10 秒内算刚读过（不再请求），之后仍可读、但需要后台刷新；静态数据可放宽到 5 分钟", () => {
    vi.useFakeTimers();
    setPageCacheUser("u1");
    writePageCache("k", { n: 1 });
    expect(readPageCache("k")).toEqual({ value: { n: 1 }, fresh: true });
    vi.advanceTimersByTime(PAGE_CACHE_DEDUPE_MS + 1);
    expect(readPageCache("k")).toEqual({ value: { n: 1 }, fresh: false });
    expect(readPageCache("k", PAGE_CACHE_STATIC_MS)?.fresh).toBe(true);
  });

  it("本地改动只更新内容，不把数据当成刚从服务器读过", () => {
    vi.useFakeTimers();
    setPageCacheUser("u1");
    writePageCache("k", 1);
    vi.advanceTimersByTime(PAGE_CACHE_DEDUPE_MS + 1);
    updatePageCache("k", 2);
    expect(readPageCache("k")).toEqual({ value: 2, fresh: false });
  });

  it("窗口回到前台时通知挂载中的页面后台刷新", () => {
    const revalidate = vi.fn();
    renderHook(() => useRevalidateOnFocus(revalidate));
    triggerPageCacheRevalidate();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("换账号或退出登录时清空，看不到上一个账号的数据", () => {
    setPageCacheUser("u1");
    writePageCache("k", "u1 的数据");
    setPageCacheUser("u2");
    expect(readPageCache("k")).toBeNull();
    writePageCache("k", "u2 的数据");
    setPageCacheUser(null);
    setPageCacheUser("u2");
    expect(readPageCache("k")).toBeNull();
  });
});
