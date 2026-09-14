import { describe, expect, it, vi } from "vitest";

import {
  AUTHENTICATED_IDLE_PRELOAD_PATHS,
  scheduleAuthenticatedWorkspacePreload,
  WORKSPACE_IDLE_PRELOAD_TIMEOUT_MS,
} from "./workspacePageLoaders";

describe("authenticated workspace idle preload", () => {
  it("在浏览器空闲时预加载模板和资料库", () => {
    const preload = vi.fn();
    let idleCallback: IdleRequestCallback | undefined;
    const cancelIdleCallback = vi.fn();
    const target = {
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      requestIdleCallback: vi.fn((callback: IdleRequestCallback, options?: IdleRequestOptions) => {
        idleCallback = callback;
        expect(options?.timeout).toBe(WORKSPACE_IDLE_PRELOAD_TIMEOUT_MS);
        return 17;
      }),
      cancelIdleCallback,
    } as unknown as Window;

    const cancel = scheduleAuthenticatedWorkspacePreload({ target, preload });
    expect(preload).not.toHaveBeenCalled();

    idleCallback?.({ didTimeout: false, timeRemaining: () => 8 });
    expect(preload.mock.calls.map(([path]) => path)).toEqual(AUTHENTICATED_IDLE_PRELOAD_PATHS);

    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(17);
  });

  it("不支持 idle callback 时延迟预加载，并可在卸载时取消", () => {
    vi.useFakeTimers();
    const preload = vi.fn();
    const cancel = scheduleAuthenticatedWorkspacePreload({ preload });

    vi.advanceTimersByTime(WORKSPACE_IDLE_PRELOAD_TIMEOUT_MS - 1);
    expect(preload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(preload.mock.calls.map(([path]) => path)).toEqual(AUTHENTICATED_IDLE_PRELOAD_PATHS);

    cancel();
    vi.useRealTimers();
  });
});
