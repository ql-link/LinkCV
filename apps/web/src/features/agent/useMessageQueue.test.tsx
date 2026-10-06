import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { installMessageQueueEnvironment } from "../../test/messageQueueEnvironment";
import { changeQueue, enqueueMessage, freezeItem, queueKey, readQueue } from "./messageQueue";
import { useMessageQueue } from "./useMessageQueue";

beforeEach(() => { vi.restoreAllMocks(); installMessageQueueEnvironment(); });

describe("消息队列推进与恢复", () => {
  const options = { userId: "1", sessionId: "session", running: false, runId: null, blocked: false };
  it("首次发送固定文档提示，重试沿用原正文、哈希和标识", async () => {
    const prepareRequest = vi.fn((request: { content: string }) => ({ ...request, content: `${request.content}\n文档要求` }));
    const send = vi.fn().mockRejectedValue(new Error("network disconnected"));
    const { result } = renderHook(() => useMessageQueue({ ...options, prepareRequest, send }));
    await act(async () => { await enqueueMessage("1", "session", { content: "生成文档" }, { startIfEmpty: true }); });
    await waitFor(() => expect(result.current.queue.items[0]?.state).toBe("uncertain"));
    const original = send.mock.calls[0][0];
    expect(original.request.content).toBe("生成文档\n文档要求");
    await act(async () => { await result.current.retryOriginal(original.itemId); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(prepareRequest).toHaveBeenCalledOnce();
    expect(send.mock.calls[1][0]).toMatchObject({ request: original.request, submissionKey: original.submissionKey, submittedRequestHash: original.submittedRequestHash });
  });
  it("等待其他标签页的运行结束时，采用用户重新调整后的队首", async () => {
    const key = queueKey("1", "session");
    await changeQueue(key, (queue) => { queue.dispatch = { ownerId: "other-tab", submissionKey: "previous" }; });
    const receipt = vi.spyOn(api, "getAgentSubmission").mockImplementation(async (_session, key) => ({
      run_id: "run", submission_key: key, state: "applied", run_status: "running",
    }));
    let finish!: () => void;
    const send = vi.fn((_item: import("./messageQueue").QueueItem) => new Promise<void>((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useMessageQueue({ ...options, send }));
    await act(async () => {
      await enqueueMessage("1", "session", { content: "A" });
      await enqueueMessage("1", "session", { content: "B" });
      await result.current.resume();
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => { await result.current.move(result.current.queue.items[0].itemId, 1); });
    receipt.mockImplementation(async (_session, key) => ({ run_id: "run", submission_key: key, state: "applied", run_status: "succeeded" }));
    await act(async () => { await result.current.recover(); });
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
    await changeQueue(queueKey("1", "session"), (value) => { freezeItem(value.items[0]); });
    const key = (await readQueue(queueKey("1", "session"))).items[0].submissionKey;
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
    vi.mocked(api.getAgentSubmission).mockResolvedValue({ run_id: "retried", submission_key: key!, state: "applied", run_status: "succeeded" });
    await act(async () => { await result.current.retryOriginal(result.current.queue.items[0].itemId); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].submissionKey).toBe(key);
    expect(send.mock.calls[0][0].request.content).toBe("A");
  });

  it("插入已接受但未确认生效时运行结束，保留原提交并显示结果待核实", async () => {
    await enqueueMessage("1", "session", { content: "A" });
    await changeQueue(queueKey("1", "session"), (value) => {
      Object.assign(value.items[0], { mode: "steer", targetRunId: "run" });
      freezeItem(value.items[0]);
    });
    const key = (await readQueue(queueKey("1", "session"))).items[0].submissionKey!;
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
    await waitFor(() => expect(result.current.queue.items).toHaveLength(2));
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
      run_id: "run", submission_key: key, state: "applied", run_status: "succeeded",
    }));
    await act(async () => { finish(); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0].request.content).toBe("B");
    first.unmount(); second.unmount();
  });

  it("刷新后保留已经接受的运行占用，查询失败或仍在运行均不启动后续消息", async () => {
    const key = queueKey("1", "session");
    await enqueueMessage("1", "session", { content: "后续消息" });
    await changeQueue(key, (value) => {
      value.paused = true;
      value.dispatch = { ownerId: "closed-tab", submissionKey: "original-submission", runId: "run" };
    });
    const receipt = vi.spyOn(api, "getAgentSubmission").mockRejectedValue(new Error("offline"));
    const send = vi.fn(() => new Promise<void>(() => undefined));
    const { result } = renderHook(() => useMessageQueue({ ...options, send }));
    await waitFor(() => expect(result.current.queue.pauseReason).toBe("发送结果待核实"));
    await act(async () => { await result.current.resume(); });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.queue.dispatch?.ownerId).toBe("closed-tab");
    receipt.mockResolvedValue({ run_id: "run", submission_key: "original-submission", state: "applied", run_status: "running" });
    await act(async () => { await result.current.recover(); });
    expect(send).not.toHaveBeenCalled();
    receipt.mockResolvedValue({ run_id: "run", submission_key: "original-submission", state: "applied", run_status: "cancelled" });
    await act(async () => { await result.current.recover(); });
    expect(result.current.queue.dispatch).toBeUndefined();
    expect(result.current.queue.paused).toBe(true);
    expect(send).not.toHaveBeenCalled();
    await act(async () => { await result.current.resume(); });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
  });

  it("请求返回后回执查询 404 仍保留冻结提交和运行占用，不允许按新消息重发", async () => {
    vi.spyOn(api, "getAgentSubmission").mockRejectedValue(new ApiRequestError(404, "AGENT_SUBMISSION_NOT_FOUND"));
    const send = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMessageQueue({ ...options, send }));
    await act(async () => { await enqueueMessage("1", "session", { content: "原消息" }); });
    await waitFor(() => expect(result.current.queue.items[0]?.state).toBe("uncertain"));
    expect(result.current.queue.items[0].retrySafe).toBe(false);
    expect(result.current.queue.dispatch?.submissionKey).toBe(result.current.queue.items[0].submissionKey);
    await act(async () => { await result.current.resume(); });
    expect(send).toHaveBeenCalledOnce();
  });

  it("没有 BroadcastChannel 时读取轮询不会阻止运行回执的定时恢复", async () => {
    await changeQueue(queueKey("1", "session"), (value) => {
      value.dispatch = { ownerId: "closed-tab", submissionKey: "original-submission", runId: "run" };
    });
    const receipt = vi.spyOn(api, "getAgentSubmission").mockResolvedValue({
      run_id: "run", submission_key: "original-submission", state: "applied", run_status: "running",
    });
    const { result, unmount } = renderHook(() => useMessageQueue({ ...options, send: vi.fn() }));
    await waitFor(() => expect(receipt).toHaveBeenCalledOnce());
    receipt.mockResolvedValue({ run_id: "run", submission_key: "original-submission", state: "applied", run_status: "succeeded" });
    // The 2s storage refresh must not keep restarting the 3s receipt timer.
    await waitFor(() => expect(result.current.queue.dispatch).toBeUndefined(), { timeout: 4500 });
    expect(receipt).toHaveBeenCalledTimes(2);
    expect(result.current.queue.paused).toBe(true);
    unmount();
  });

  it("旧发送者迟到的错误不能释放或覆盖另一标签页认领的原提交", async () => {
    let rejectOld!: (reason: unknown) => void;
    const oldSend = vi.fn((_item: import("./messageQueue").QueueItem) => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
    const first = renderHook(() => useMessageQueue({ ...options, send: oldSend }));
    await act(async () => { await enqueueMessage("1", "session", { content: "原消息" }); });
    await waitFor(() => expect(oldSend).toHaveBeenCalledOnce());
    const original = oldSend.mock.calls[0][0] as import("./messageQueue").QueueItem;
    await act(async () => { await changeQueue(queueKey("1", "session"), (value) => {
      value.items[0].state = "uncertain"; value.paused = true;
    }); });
    vi.spyOn(api, "getAgentSubmission").mockRejectedValue(new Error("offline"));
    const retrySend = vi.fn((_item: import("./messageQueue").QueueItem) => new Promise<void>(() => undefined));
    const second = renderHook(() => useMessageQueue({ ...options, send: retrySend }));
    await waitFor(() => expect(second.result.current.queue.items[0]?.state).toBe("uncertain"));
    await act(async () => { await second.result.current.retryOriginal(original.itemId); });
    await waitFor(() => expect(retrySend).toHaveBeenCalledOnce());
    const claimed = (await readQueue(queueKey("1", "session"))).dispatch;
    expect(retrySend.mock.calls[0][0].submissionKey).toBe(original.submissionKey);
    await act(async () => { rejectOld(new ApiRequestError(409, "AGENT_CONTEXT_STALE")); });
    await waitFor(async () => expect((await readQueue(queueKey("1", "session"))).dispatch).toEqual(claimed));
    expect((await readQueue(queueKey("1", "session"))).items[0].state).toBe("submitting");
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
    await waitFor(async () => expect((await readQueue(queueKey("1", "session"))).paused).toBe(true));
    expect(send).not.toHaveBeenCalled();
  });
});
