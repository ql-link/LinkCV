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
};
export const QUEUE_CHANGE_EVENT = "agent-message-queue-change";
const PREFIX = "linkresume:agent-queue:v1:";
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
export const queueSupported = () => Boolean(globalThis.navigator?.locks?.request);

export function readQueue(key: string): MessageQueue {
  const raw = localStorage.getItem(key);
  if (raw == null) return emptyQueue();
  const value = JSON.parse(raw) as MessageQueue;
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || typeof value.paused !== "boolean"
      || !Array.isArray(value.items) || value.items.length > 20 || value.items.some((item) => (
        typeof item.itemId !== "string" || !Number.isSafeInteger(item.version)
        || !["follow_up", "steer"].includes(item.mode)
        || !["queued", "submitting", "waiting_insert", "blocked", "uncertain"].includes(item.state)
        || !item.request || typeof item.request.content !== "string" || item.request.content.length > 32768
        || (item.request.contexts?.length ?? 0) > 10
      ))) throw new Error("本机队列格式异常，原内容已保留，请先导出或清理浏览器中的该会话队列。");
  return value;
}

export async function changeQueue(key: string, change: (queue: MessageQueue) => void | Promise<void>): Promise<MessageQueue> {
  if (!queueSupported()) throw new Error("当前浏览器暂不支持消息队列，请升级浏览器后重试。输入内容已保留。");
  return navigator.locks.request(key, async () => {
    const queue = readQueue(key);
    await change(queue);
    queue.revision += 1;
    localStorage.setItem(key, JSON.stringify(queue));
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT, { detail: key }));
    return queue;
  });
}

export async function enqueueMessage(userId: string, sessionId: string, request: QueueDraft,
                                     options: { startIfEmpty?: boolean } = {}) {
  if (!request.content.trim() || request.content.length > 32768 || (request.contexts?.length ?? 0) > 10) {
    throw new Error("消息或引用超出允许范围，输入内容已保留。");
  }
  const key = queueKey(userId, sessionId);
  if (!observedKeys.has(key)) freshKeys.add(key);
  const result = await changeQueue(key, (queue) => {
    if (queue.items.length >= 20) throw new Error("队列最多保存 20 条消息，请先处理已有消息。");
    if (!queue.items.length && options.startIfEmpty) { queue.paused = false; queue.pauseReason = null; }
    queue.items.push({ itemId: crypto.randomUUID(), version: 1, request: structuredClone(request), mode: "follow_up", state: "queued" });
  });
  return result;
}

export async function freezeItem(item: QueueItem) {
  item.submissionKey ??= `${item.mode === "steer" ? "steer" : "queued"}_${item.itemId}_${item.version}`;
  const payload = submissionPayload(item);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  const keys = sessionId ? [queueKey(userId, sessionId)] : Array.from({ length: localStorage.length },
    (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  for (const key of keys) {
    const remove = () => {
      localStorage.removeItem(key);
      window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT, { detail: key }));
    };
    if (queueSupported()) await navigator.locks.request(key, remove);
    else remove();
  }
}
