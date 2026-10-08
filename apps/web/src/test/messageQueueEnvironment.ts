import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";

/** Reproduce an HTTP origin: no Web Locks, randomUUID or SubtleCrypto. */
export function installMessageQueueEnvironment(options: { secureCrypto?: boolean } = {}) {
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("crypto", options.secureCrypto ? webcrypto : { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  localStorage.clear();
}
