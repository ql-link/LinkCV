import { webcrypto } from "node:crypto";
import { vi } from "vitest";

/** Serialize callbacks like the browser API, including concurrent test mounts. */
export function installMessageQueueEnvironment() {
  const tails = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: vi.fn((key: string, callback: () => unknown) => {
      const result = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(callback);
      tails.set(key, result);
      return result;
    }),
  } });
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
}
