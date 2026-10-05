import { webcrypto } from "node:crypto";
import { IDBObjectStore } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMessageQueueEnvironment } from "../../test/messageQueueEnvironment";
import { changeQueue, clearMessageQueues, emptyQueue, enqueueMessage, freezeItem, queueKey, queueSupported, readQueue } from "./messageQueue";

beforeEach(() => { vi.restoreAllMocks(); installMessageQueueEnvironment(); });

describe("本机消息队列", () => {
  it("HTTP 缺少 Web Locks、randomUUID 和 SubtleCrypto 时仍能保存并冻结提交", async () => {
    expect(navigator.locks).toBeUndefined();
    expect(crypto.randomUUID).toBeUndefined();
    expect(crypto.subtle).toBeUndefined();
    expect(queueSupported()).toBe(true);
    const queue = await enqueueMessage("1", "a", { content: "A", contexts: [{ type: "resume", id: "test-resume" }] });
    expect(queue.items[0].itemId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    const payload = freezeItem(queue.items[0]);
    const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
    expect(queue.items[0].submittedRequestHash).toBe(Buffer.from(digest).toString("hex"));
  });

  it("按账号和会话隔离，清理同时删除新存储和旧存储", async () => {
    await enqueueMessage("1", "a", { content: "A" });
    await enqueueMessage("1", "b", { content: "B" });
    await enqueueMessage("2", "a", { content: "C" });
    localStorage.setItem(queueKey("1", "legacy"), JSON.stringify(emptyQueue()));
    await clearMessageQueues("1", "a");
    expect((await readQueue(queueKey("1", "a"))).items).toEqual([]);
    expect((await readQueue(queueKey("1", "b"))).items[0].request.content).toBe("B");
    await clearMessageQueues("1");
    expect((await readQueue(queueKey("1", "b"))).items).toEqual([]);
    expect(localStorage.getItem(queueKey("1", "legacy"))).toBeNull();
    expect((await readQueue(queueKey("2", "a"))).items[0].request.content).toBe("C");
  });

  it("事务内冻结，两个竞争发送者只能取到一条，重复恢复保留同一标识", async () => {
    await enqueueMessage("1", "a", { content: "A" });
    const submitted: string[] = [];
    await Promise.all([0, 1].map(() => changeQueue(queueKey("1", "a"), (queue) => {
      const item = queue.items[0];
      if (item.state !== "queued") return;
      submitted.push(freezeItem(item).idempotency_key);
    })));
    expect(submitted).toHaveLength(1);
    const frozen = (await readQueue(queueKey("1", "a"))).items[0];
    expect(frozen.submittedRequestHash).toHaveLength(64);
    expect(freezeItem(frozen).idempotency_key).toBe(submitted[0]);
    frozen.request.content = "更改已冻结正文";
    expect(() => freezeItem(frozen)).toThrow("原提交内容发生变化");
  });

  it("事务写入失败不修改原队列，损坏的旧格式不被覆盖", async () => {
    const key = queueKey("1", "a");
    await enqueueMessage("1", "a", { content: "A" });
    const initial = await readQueue(key);
    const write = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await expect(enqueueMessage("1", "a", { content: "B" })).rejects.toThrow("quota");
    expect(await readQueue(key)).toEqual(initial);
    write.mockRestore();
    const damaged = queueKey("1", "damaged");
    localStorage.setItem(damaged, '{"schemaVersion":9}');
    await expect(enqueueMessage("1", "damaged", { content: "C" })).rejects.toThrow("格式异常");
    expect(localStorage.getItem(damaged)).toBe('{"schemaVersion":9}');
  });

  it("旧队列只迁移一次并暂停，冻结提交的正文、标识和哈希保持不变", async () => {
    const legacy = emptyQueue();
    legacy.items.push({ itemId: "legacy", version: 1, request: { content: "旧消息" }, mode: "follow_up", state: "queued" });
    freezeItem(legacy.items[0]);
    const key = queueKey("1", "legacy");
    const raw = JSON.stringify(legacy);
    localStorage.setItem(key, raw);
    const write = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new Error("quota"); });
    await expect(readQueue(key)).rejects.toThrow("quota");
    expect(localStorage.getItem(key)).toBe(raw);
    write.mockRestore();
    const [first, second] = await Promise.all([readQueue(key), readQueue(key)]);
    expect(first).toEqual(second);
    expect(first.paused).toBe(true);
    expect(first.items).toEqual(legacy.items);
    expect(first.dispatch?.submissionKey).toBe(legacy.items[0].submissionKey);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("只保存输入和引用，并发写入限制为 20 条", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => enqueueMessage("1", "a", { content: `消息${i}` })));
    await expect(enqueueMessage("1", "a", { content: "满了" })).rejects.toThrow("20 条");
    expect((await readQueue(queueKey("1", "a"))).items).toHaveLength(20);
  });
});
