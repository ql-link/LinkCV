import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { AgentMessageRequest } from "../../api/client";

export type QueueDraft = Omit<AgentMessageRequest, "idempotency_key">;
export type QueueItem = {
  itemId: string;
  version: number;
  request: QueueDraft;
  mode: "follow_up" | "steer";
  state: "queued" | "submitting" | "waiting_insert" | "blocked" | "uncertain";
  targetRunId?: string;
  submissionKey?: string;
  submittedRequestHash?: string;
  error?: string;
  retrySafe?: boolean;
};
export type MessageQueue = {
  schemaVersion: 1;
  revision: number;
  paused: boolean;
  pauseReason: string | null;
  items: QueueItem[];
  // Kept after acceptance removes the item, until the server confirms the run ended.
  dispatch?: { ownerId: string; submissionKey: string; runId?: string };
};
export const QUEUE_CHANGE_EVENT = "agent-message-queue-change";
const PREFIX = "linkresume:agent-queue:v1:";
const DATABASE = "linkresume-agent-queues";
const STORE = "queues";
const observedKeys = new Set<string>();
const freshKeys = new Set<string>();
export function enterQueue(key: string) {
  const fresh = freshKeys.delete(key);
  observedKeys.add(key);
  return fresh;
}
export function leaveQueue(key: string) { observedKeys.delete(key); }
export const emptyQueue = (): MessageQueue => ({ schemaVersion: 1, revision: 0, paused: false, pauseReason: null, items: [] });
export const queueKey = (userId: string, sessionId: string) => `${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`;
export const queueSupported = () => typeof globalThis.indexedDB?.open === "function" && typeof globalThis.crypto?.getRandomValues === "function";

/** getRandomValues remains available on HTTP; randomUUID does not. */
export function queueId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateQueue(value: MessageQueue): MessageQueue {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || typeof value.paused !== "boolean"
      || !Array.isArray(value.items) || value.items.length > 20 || value.items.some((item) => (
        !item || typeof item.itemId !== "string" || !Number.isSafeInteger(item.version)
        || !["follow_up", "steer"].includes(item.mode)
        || !["queued", "submitting", "waiting_insert", "blocked", "uncertain"].includes(item.state)
        || !item.request || typeof item.request.content !== "string" || item.request.content.length > 32768
        || (item.request.contexts != null && (!Array.isArray(item.request.contexts) || item.request.contexts.length > 10))
      )) || (value.dispatch && (typeof value.dispatch.ownerId !== "string" || typeof value.dispatch.submissionKey !== "string"))) {
    throw new Error("本机队列格式异常，原内容已保留，请先导出或清理浏览器中的该会话队列。");
  }
  return value;
}

let connection: { factory: IDBFactory; promise: Promise<IDBDatabase> } | undefined;
function openDatabase() {
  if (!queueSupported()) return Promise.reject(new Error("本机队列存储不可用，请检查浏览器的站点存储设置。输入内容已保留。"));
  if (connection?.factory === indexedDB) return connection.promise;
  void connection?.promise.then((db) => db.close(), () => undefined);
  const entry = { factory: indexedDB, promise: new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); if (connection === entry) connection = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("本机队列存储打开失败，输入内容已保留。"));
  }) };
  connection = entry;
  void entry.promise.catch(() => { if (connection === entry) connection = undefined; });
  return entry.promise;
}

function notifyQueue(key: string) {
  window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT, { detail: key }));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(QUEUE_CHANGE_EVENT);
      channel.postMessage(key);
      channel.close();
    } catch { /* Notifications must not turn a committed save into an apparent failure. */ }
  }
}

export function subscribeQueue(key: string, refresh: () => void) {
  const local = (event: Event) => { if ((event as CustomEvent).detail === key) refresh(); };
  window.addEventListener(QUEUE_CHANGE_EVENT, local);
  let channel: BroadcastChannel | null = null;
  try { if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(QUEUE_CHANGE_EVENT); } catch { /* Use polling if the browser blocks channels. */ }
  if (channel) channel.onmessage = (event) => { if (event.data === key) refresh(); };
  // Notification availability does not determine correctness: all writes use DB transactions.
  const timer = channel ? undefined : window.setInterval(refresh, 2000);
  return () => {
    window.removeEventListener(QUEUE_CHANGE_EVENT, local);
    channel?.close();
    if (timer !== undefined) window.clearInterval(timer);
  };
}

async function transactQueue(key: string, change?: (queue: MessageQueue) => void): Promise<MessageQueue> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let result: MessageQueue;
    let failure: unknown;
    let migratedRaw: string | null = null;
    let changed = false;
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        result = request.result == null ? emptyQueue() : validateQueue(request.result);
        if (request.result == null) {
          migratedRaw = localStorage.getItem(key);
          if (migratedRaw != null) {
            try { result = validateQueue(JSON.parse(migratedRaw)); }
            catch { throw new Error("本机队列格式异常，原内容已保留，请先导出或清理浏览器中的该会话队列。"); }
            result.paused = true; result.pauseReason = "恢复队列后请主动继续";
            const submitted = result.items.find((item) => item.mode === "follow_up" && item.submissionKey
              && ["submitting", "uncertain"].includes(item.state));
            if (submitted) result.dispatch = { ownerId: queueId(), submissionKey: submitted.submissionKey! };
            changed = true;
          }
        }
        if (change) {
          // Async work here could let IndexedDB commit before the mutation completes.
          const returned = change(result) as unknown;
          if (returned && typeof (returned as Promise<unknown>).then === "function") throw new Error("队列事务不能执行异步操作。");
          changed = true;
        }
        if (changed) { result.revision += 1; store.put(validateQueue(result), key); }
      } catch (reason) { failure = reason; transaction.abort(); }
    };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("本机保存失败，输入内容已保留。"));
    transaction.oncomplete = () => {
      // Only remove the legacy copy after the new store has committed successfully.
      if (migratedRaw != null) {
        try { if (localStorage.getItem(key) === migratedRaw) localStorage.removeItem(key); } catch { /* The committed DB copy is authoritative. */ }
      }
      if (changed) notifyQueue(key);
      resolve(result);
    };
  });
}

export const readQueue = (key: string) => transactQueue(key);
export const changeQueue = (key: string, change: (queue: MessageQueue) => void) => transactQueue(key, change);

export async function enqueueMessage(userId: string, sessionId: string, request: QueueDraft,
                                     options: { startIfEmpty?: boolean } = {}) {
  if (!request.content.trim() || request.content.length > 32768 || (request.contexts?.length ?? 0) > 10) {
    throw new Error("消息或引用超出允许范围，输入内容已保留。");
  }
  const key = queueKey(userId, sessionId);
  if (!observedKeys.has(key)) freshKeys.add(key);
  const result = await changeQueue(key, (queue) => {
    if (queue.items.length >= 20) throw new Error("队列最多保存 20 条消息，请先处理已有消息。");
    if (!queue.items.length && !queue.dispatch && options.startIfEmpty) { queue.paused = false; queue.pauseReason = null; }
    queue.items.push({ itemId: queueId(), version: 1, request: structuredClone(request), mode: "follow_up", state: "queued" });
  });
  return result;
}

export function freezeItem(item: QueueItem) {
  item.submissionKey ??= `${item.mode === "steer" ? "steer" : "queued"}_${item.itemId}_${item.version}`;
  const payload = submissionPayload(item);
  const hash = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(payload))));
  if (item.submittedRequestHash && item.submittedRequestHash !== hash) {
    throw new Error("原提交内容发生变化，消息已保留，请先核实发送结果。");
  }
  item.submittedRequestHash = hash;
  item.state = "submitting";
  return payload;
}

export function submissionPayload(item: QueueItem): AgentMessageRequest {
  return { ...item.request, idempotency_key: item.submissionKey!,
    ...(item.request.contexts ? { contexts: item.request.contexts.map(({ type, id, presentation, version_id, version }) => ({
      type, id, ...(presentation ? { presentation } : {}), ...(version_id ? { version_id } : {}), ...(version ? { version } : {}),
    })) } : {}) };
}

export async function clearMessageQueues(userId: string, sessionId?: string) {
  const prefix = `${PREFIX}${encodeURIComponent(userId)}:`;
  const legacyKeys = sessionId ? [queueKey(userId, sessionId)] : Array.from({ length: localStorage.length },
    (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  const db = await openDatabase();
  const keys = new Set(legacyKeys);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const request = transaction.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const key = String(cursor.key);
      if (sessionId ? key === queueKey(userId, sessionId) : key.startsWith(prefix)) { keys.add(key); cursor.delete(); }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("本机消息清理失败"));
  });
  for (const key of keys) { localStorage.removeItem(key); freshKeys.delete(key); notifyQueue(key); }
}
