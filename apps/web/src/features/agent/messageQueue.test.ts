import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMessageQueueEnvironment } from "../../test/messageQueueEnvironment";
import { changeQueue, clearMessageQueues, enqueueMessage, freezeItem, queueKey, readQueue } from "./messageQueue";

beforeEach(installMessageQueueEnvironment);

describe("本机消息队列", () => {
  it("按账号和会话隔离，退出账号只清理本人的消息", async () => {
    await enqueueMessage("1", "a", { content: "A" });
    await enqueueMessage("1", "b", { content: "B" });
    await enqueueMessage("2", "a", { content: "C" });
    await clearMessageQueues("1", "a");
    expect(readQueue(queueKey("1", "a")).items).toEqual([]);
    expect(readQueue(queueKey("1", "b")).items[0].request.content).toBe("B");
    await clearMessageQueues("1");
    expect(readQueue(queueKey("2", "a")).items[0].request.content).toBe("C");
  });

  it("锁内冻结，两个竞争发送者只能取到一条，重复恢复保留同一标识", async () => {
    await enqueueMessage("1", "a", { content: "A" });
    const submitted: string[] = [];
    await Promise.all([0, 1].map(() => changeQueue(queueKey("1", "a"), async (queue) => {
      const item = queue.items[0];
      if (item.state !== "queued") return;
      const payload = await freezeItem(item);
      submitted.push(payload.idempotency_key);
    })));
    expect(submitted).toHaveLength(1);
    const frozen = readQueue(queueKey("1", "a")).items[0];
    expect(frozen.submittedRequestHash).toHaveLength(64);
    expect((await freezeItem(frozen)).idempotency_key).toBe(submitted[0]);
    frozen.request.content = "更改已冻结正文";
    await expect(freezeItem(frozen)).rejects.toThrow("原提交内容发生变化");
  });

  it("写入失败不修改原队列，损坏格式不被覆盖", async () => {
    const key = queueKey("1", "a");
    await enqueueMessage("1", "a", { content: "A" });
    const initial = localStorage.getItem(key);
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await expect(enqueueMessage("1", "a", { content: "B" })).rejects.toThrow("quota");
    expect(localStorage.getItem(key)).toBe(initial);
    write.mockRestore();
    localStorage.setItem(key, '{"schemaVersion":9}');
    await expect(enqueueMessage("1", "a", { content: "C" })).rejects.toThrow("格式异常");
    expect(localStorage.getItem(key)).toBe('{"schemaVersion":9}');
  });

  it("只保存输入和引用，限制为 20 条", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => enqueueMessage("1", "a", { content: `消息${i}` })));
    await expect(enqueueMessage("1", "a", { content: "满了" })).rejects.toThrow("20 条");
    expect(readQueue(queueKey("1", "a")).items).toHaveLength(20);
  });
});
