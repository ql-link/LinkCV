import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { installMessageQueueEnvironment } from "../../test/messageQueueEnvironment";
import { changeQueue, enqueueMessage, freezeItem, queueKey, readQueue } from "./messageQueue";
import { useMessageQueue } from "./useMessageQueue";

beforeEach(() => { vi.restoreAllMocks(); installMessageQueueEnvironment(); });

describe("消息队列推进与恢复", () => {
  const options = { userId: "1", sessionId: "session", running: false, runId: null, blocked: false };
  it("等待其他标签页释放发送锁时，采用用户重新调整后的队首", async () => {
    let release!: () => void;
    const held = navigator.locks.request(`${queueKey("1", "session")}:dispatch`, () => new Promise<void>((resolve) => { release = resolve; }));
    await waitFor(() => expect(release).toBeDefined());
    let finish!: () => void;
    const send = vi.fn((_item: import("./messageQueue").QueueItem) => new Promise<void>((resolve) => { finish = resolve; }));
    vi.spyOn(api, "getAgentSubmission").mockImplementation(async (_session, key) => ({ run_id: "run", submission_key: key, state: "applied" }));
    const { result, unmount } = renderHook(() => useMessageQueue({ ...options, send }));
    await act(async () => {
      await result.current.pause("暂时暂停");
      await enqueueMessage("1", "session", { content: "A" });
      await enqueueMessage("1", "session", { content: "B" });
      await result.current.resume();
    });
    await waitFor(() => expect(navigator.locks.request).toHaveBeenCalledWith(`${queueKey("1", "session")}:dispatch`, expect.any(Function)));
    await act(async () => { await result.current.move(result.current.queue.items[0].itemId, 1); });
    await act(async () => { release(); await held; });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].request.content).toBe("B");
    unmount();
    await act(async () => { finish(); });
  });
  it("编辑保持位置，取消保持原消息，上下移动改变发送顺序", async () => {
    const send = vi.fn();
    const { result } = renderHook(() => useMessageQueue({ ...options, running: true, send }));
    await act(async () => {
      await enqueueMessage("1", "session", { content: "A" });
      await enqueueMessage("1", "session", { content: "B" });
    });
    const id = result.current.queue.items[0].itemId;
    await act(async () => { await result.current.beginEdit(id); });
    await act(async () => { await result.current.saveEdit({ content: "A修改" }); });
    expect(result.current.queue.items.map((item) => item.request.content)).toEqual(["A修改", "B"]);
    await act(async () => { await result.current.move(id, 1); });
    expect(result.current.queue.items.map((item) => item.request.content)).toEqual(["B", "A修改"]);
    await act(async () => { await result.current.beginEdit(id); await result.current.cancelEdit(); });
    expect(result.current.queue.items[1].request.content).toBe("A修改");
    expect(send).not.toHaveBeenCalled();
  });

  it("恢复先暂停，主动继续才发送；失败暂停后续队列", async () => {
    await enqueueMessage("1", "session", { content: "A" });
    await enqueueMessage("1", "session", { content: "B" });
    await changeQueue(queueKey("1", "session"), (value) => { value.paused = true; });
    const send = vi.fn().mockRejectedValue(new ApiRequestError(409, "AGENT_CONTEXT_STALE"));
    const { result } = renderHook(() => useMessageQueue({ ...options, send }));
    await waitFor(() => expect(result.current.queue.items).toHaveLength(2));
    expect(send).not.toHaveBeenCalled();
    await act(async () => { await result.current.resume(); });
    await waitFor(() => expect(result.current.queue.items[0].state).toBe("blocked"));
    expect(result.current.queue.paused).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.queue.items[1].state).toBe("queued");
  });

  it("结果未知只查询原提交，查询失败不自动重发", async () => {
    await enqueueMessage("1", "session", { content: "A" });
    await changeQueue(queueKey("1", "session"), async (value) => { await freezeItem(value.items[0]); });
    const key = readQueue(queueKey("1", "session")).items[0].submissionKey;
    vi.spyOn(api, "getAgentSubmission").mockRejectedValue(new ApiRequestError(404, "AGENT_SUBMISSION_NOT_FOUND"));
    const send = vi.fn();
    const { result } = renderHook(() => useMessageQueue({ ...options, send }));
    await waitFor(() => expect(result.current.queue.items[0]?.state).toBe("uncertain"));
    await act(async () => { await result.current.resume(); });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.queue.items[0].submissionKey).toBe(key);
    send.mockImplementation(async (item) => {
      result.current.onEvent({ type: "run.started", runId: "retried", submissionKey: item.submissionKey });
    });
    vi.mocked(api.getAgentSubmission).mockResolvedValue({ run_id: "retried", submission_key: key!, state: "applied" });
    await act(async () => { await result.current.retryOriginal(result.current.queue.items[0].itemId); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].submissionKey).toBe(key);
    expect(send.mock.calls[0][0].request.content).toBe("A");
  });

  it("插入已接受但未确认生效时运行结束，保留原提交并显示结果待核实", async () => {
    await enqueueMessage("1", "session", { content: "A" });
    await changeQueue(queueKey("1", "session"), async (value) => {
      Object.assign(value.items[0], { mode: "steer", targetRunId: "run" });
      await freezeItem(value.items[0]);
    });
    const key = readQueue(queueKey("1", "session")).items[0].submissionKey!;
    vi.spyOn(api, "getAgentSteering").mockResolvedValue({ run_id: "run", submission_key: key, state: "accepted", run_status: "failed" });
    const send = vi.fn();
    const steer = vi.spyOn(api, "steerAgentRun");
    const { result } = renderHook(() => useMessageQueue({ ...options, send }));
    await waitFor(() => expect(result.current.queue.items[0]?.state).toBe("uncertain"));
    expect(result.current.queue.pauseReason).toBe("运行已结束，插入结果待核实");
    expect(result.current.queue.items[0].submissionKey).toBe(key);
    await act(async () => { await result.current.resume(); });
    expect(send).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
  });

  it("普通回复流未结束时仍可插入，多个插入按转换顺序逐条接收", async () => {
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const steer = vi.spyOn(api, "steerAgentRun").mockImplementation(async (_run, body) => ({
      run_id: "run", submission_key: body.idempotency_key, state: "waiting",
    }));
    vi.spyOn(api, "getAgentReadiness").mockResolvedValue({ ready: true, steering: true });
    const { result, rerender } = renderHook(({ running }) => useMessageQueue({ ...options, running,
      runId: running ? "run" : null, send }), { initialProps: { running: false } });
    await act(async () => { await enqueueMessage("1", "session", { content: "A" }); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.onEvent({ type: "run.started", runId: "run" }); });
    rerender({ running: true });
    await act(async () => {
      await enqueueMessage("1", "session", { content: "B" });
      await enqueueMessage("1", "session", { content: "C" });
    });
    const [b, c] = result.current.queue.items;
    await act(async () => { await result.current.steer(c.itemId); await result.current.steer(b.itemId); });
    await waitFor(() => expect(steer).toHaveBeenCalledTimes(1));
    expect(steer.mock.calls[0][1].content).toBe("C");
    expect(result.current.queue.items.map((item) => item.request.content)).toEqual(["C", "B"]);
    await act(async () => { result.current.onEvent({ type: "user.message.applied", runId: "run",
      submissionKey: steer.mock.calls[0][1].idempotency_key, userSequenceNo: 3 }); });
    await waitFor(() => expect(steer).toHaveBeenCalledTimes(2));
    expect(steer.mock.calls[1][1].content).toBe("B");
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });

  it("两个标签页在上一条运行结束前不会竞争启动下一条普通消息", async () => {
    let finish!: () => void;
    const send = vi.fn((_item: import("./messageQueue").QueueItem) => send.mock.calls.length === 1
      ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
    const first = renderHook(() => useMessageQueue({ ...options, send }));
    const second = renderHook(() => useMessageQueue({ ...options, send }));
    await act(async () => { await enqueueMessage("1", "session", { content: "A" }); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await act(async () => {
      await changeQueue(queueKey("1", "session"), (queue) => { queue.items.shift(); });
      await enqueueMessage("1", "session", { content: "B" });
    });
    expect(send).toHaveBeenCalledTimes(1);
    vi.spyOn(api, "getAgentSubmission").mockImplementation(async (_session, key) => ({
      run_id: "run", submission_key: key, state: "applied",
    }));
    await act(async () => { finish(); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0].request.content).toBe("B");
    first.unmount(); second.unmount();
  });

  it("离开暂停，事件接收后删除发送项；澄清不自动继续", async () => {
    const send = vi.fn();
    const { result, rerender, unmount } = renderHook(({ blocked }) => useMessageQueue({ ...options, running: true, blocked, send }), { initialProps: { blocked: false } });
    await act(async () => { await enqueueMessage("1", "session", { content: "A" }); });
    rerender({ blocked: true });
    await waitFor(() => expect(result.current.queue.paused).toBe(true));
    rerender({ blocked: false });
    expect(result.current.queue.paused).toBe(true);
    unmount();
    await waitFor(() => expect(readQueue(queueKey("1", "session")).paused).toBe(true));
    expect(send).not.toHaveBeenCalled();
  });
});
