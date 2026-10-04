import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError, type AgentStreamEvent, type AgentSubmissionReceipt } from "../../api/client";
import { changeQueue, emptyQueue, freezeItem, queueKey, queueSupported, readQueue, QUEUE_CHANGE_EVENT,
  enterQueue, leaveQueue, submissionPayload, type MessageQueue, type QueueDraft, type QueueItem } from "./messageQueue";

type Options = {
  userId: string | null;
  sessionId: string | null;
  running: boolean;
  runId: string | null;
  blocked: boolean;
  visible?: boolean;
  prepareRequest?: (request: QueueDraft) => QueueDraft;
  send: (item: QueueItem) => Promise<void>;
};

export function useMessageQueue(options: Options) {
  const key = options.userId && options.sessionId ? queueKey(options.userId, options.sessionId) : null;
  const [queue, setQueue] = useState<MessageQueue>(emptyQueue);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingPause = useRef<{ paused: boolean; reason: string | null } | null>(null);
  const current = useRef(options);
  current.current = options;
  const keyRef = useRef(key);
  keyRef.current = key;
  const mounted = useRef(false);
  const sending = useRef<QueueItem | null>(null);
  const ordinaryWorking = useRef(false);
  const steeringWorking = useRef(false);
  const [processing, setProcessing] = useState(false);

  const mutate = useCallback(async (change: (value: MessageQueue) => void | Promise<void>, targetKey = key) => {
    if (!targetKey) throw new Error("请先登录并打开会话，输入内容已保留。");
    try {
      const next = await changeQueue(targetKey, change);
      if (keyRef.current === targetKey && mounted.current) { setQueue(next); setError(null); }
      return next;
    } catch (reason) {
      if (keyRef.current === targetKey && mounted.current) setError(reason instanceof Error ? reason.message : "本机保存失败，输入内容已保留。");
      throw reason;
    }
  }, [key]);
  const pause = useCallback((reason: string) => mutate((value) => {
    value.paused = true; value.pauseReason = reason;
  }).catch(() => undefined), [mutate]);

  const applyReceipt = useCallback(async (item: QueueItem, receipt: AgentSubmissionReceipt, targetKey: string) => {
    await mutate((value) => {
      const stored = value.items.find((entry) => entry.itemId === item.itemId && entry.submissionKey === item.submissionKey);
      if (!stored) return;
      if (receipt.state === "applied") {
        value.items = value.items.filter((entry) => entry !== stored);
      } else if (receipt.state === "accepted" && receipt.run_status && receipt.run_status !== "running") {
        stored.state = "uncertain";
        value.paused = true; value.pauseReason = "运行已结束，插入结果待核实";
      } else if (["waiting", "accepted"].includes(receipt.state)) {
        stored.state = "waiting_insert";
      } else if (receipt.state === "not_applied") {
        if (receipt.error) {
          stored.state = "blocked"; stored.error = "插入未通过校验，请调整消息和引用后重试。";
          stored.retrySafe = true;
        } else {
          stored.state = "queued"; stored.mode = "follow_up"; stored.targetRunId = undefined;
          stored.submissionKey = undefined; stored.submittedRequestHash = undefined; stored.version += 1;
        }
        value.paused = true; value.pauseReason = "插入未生效，消息已保留";
      } else {
        stored.state = "uncertain"; value.paused = true; value.pauseReason = "发送结果待核实";
      }
    }, targetKey);
  }, [mutate]);

  const recover = useCallback(async () => {
    if (!key) return;
    let snapshot: MessageQueue;
    try { snapshot = readQueue(key); } catch { return; }
    for (const item of snapshot.items) {
      if (!item.submissionKey || !["submitting", "waiting_insert", "uncertain"].includes(item.state)) continue;
      try {
        const receipt = item.mode === "steer" && item.targetRunId
          ? await api.getAgentSteering(item.targetRunId, item.submissionKey)
          : await api.getAgentSubmission(options.sessionId!, item.submissionKey);
        await applyReceipt(item, receipt, key);
      } catch (reason) {
        await mutate((value) => {
          const stored = value.items.find((entry) => entry.itemId === item.itemId);
          if (stored) { stored.state = "uncertain"; stored.error = "发送结果待核实，请稍后再次核实。"; }
          value.paused = true; value.pauseReason = "发送结果待核实";
        }, key).catch(() => undefined);
      }
    }
  }, [key, options.sessionId, applyReceipt, mutate]);

  useEffect(() => {
    mounted.current = true;
    setEditingId(null);
    editingPause.current = null;
    setQueue(emptyQueue());
    setError(null);
    if (!key || !queueSupported()) return () => { mounted.current = false; };
    const fresh = enterQueue(key);
    const refresh = () => {
      try { setQueue(readQueue(key)); } catch (reason) { setError((reason as Error).message); }
    };
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) refresh(); };
    const local = (event: Event) => { if ((event as CustomEvent).detail === key) refresh(); };
    window.addEventListener("storage", storage);
    window.addEventListener(QUEUE_CHANGE_EVENT, local);
    void mutate((value) => {
      if (value.items.length && !fresh) {
        value.paused = true; value.pauseReason = "恢复队列后请主动继续";
        for (const item of value.items) if (["submitting", "waiting_insert"].includes(item.state)) item.state = "uncertain";
      }
    }).then(recover).catch(() => undefined);
    const leave = () => { void pause("页面已离开，队列暂停"); };
    const visibility = () => { if (document.visibilityState !== "visible") leave(); };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      leaveQueue(key);
      window.removeEventListener("storage", storage);
      window.removeEventListener(QUEUE_CHANGE_EVENT, local);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visibility);
      void pause("页面已离开，队列暂停");
    };
  }, [key]);

  useEffect(() => {
    if (options.blocked) void pause("请先回答问题，再主动继续队列");
    if (options.visible === false) void pause("页面已离开，队列暂停");
  }, [options.blocked, options.visible, pause]);

  useEffect(() => {
    if (!key || error || queue.paused || editingId || options.blocked
        || options.visible === false || document.visibilityState !== "visible") return;
    const worker = options.running ? steeringWorking : ordinaryWorking;
    if (worker.current) return;
    const candidate = options.running
      ? queue.items.find((item) => item.mode === "steer" && item.state === "queued")
      : queue.items[0];
    if (!candidate || candidate.state !== "queued") return;
    if (options.running && (!options.runId || queue.items.some((item) => item.mode === "steer" && ["submitting", "waiting_insert", "uncertain"].includes(item.state)))) return;
    worker.current = true;
    setProcessing(true);
    const send = options.send;
    const dispatch = async () => {
      let claimed: QueueItem | null = null;
      await mutate(async (value) => {
        if (!mounted.current || keyRef.current !== key || document.visibilityState !== "visible"
            || value.paused || current.current.visible === false || current.current.blocked
            || options.running !== current.current.running) return;
        const first = current.current.running
          ? value.items.find((entry) => entry.mode === "steer" && entry.state === "queued")
          : value.items[0];
        if (first?.itemId !== candidate.itemId) return;
        const item = value.items.find((entry) => entry.itemId === candidate.itemId);
        if (!item || item.state !== "queued") return;
        if (current.current.running && value.items.some((entry) => entry !== item && entry.mode === "steer"
            && ["submitting", "waiting_insert", "uncertain"].includes(entry.state))) return;
        if (!current.current.running) { item.mode = "follow_up"; item.targetRunId = undefined; }
        if (item.mode === "steer") {
          item.targetRunId = current.current.runId!;
          if (item.request.contexts?.some((ref) => ref.type === "resume")) item.request.replace_inherited_resume = true;
        }
        if (!item.submissionKey && current.current.prepareRequest) {
          item.request = structuredClone(current.current.prepareRequest(item.request));
        }
        await freezeItem(item);
        claimed = structuredClone(item);
      }, key);
      const item = claimed as QueueItem | null;
      if (!item) return;
      sending.current = item;
      try {
        if (!mounted.current || keyRef.current !== key || document.visibilityState !== "visible"
            || current.current.visible === false || current.current.blocked || readQueue(key).paused) {
          throw new ApiRequestError(409, "AGENT_QUEUE_PAUSED");
        }
        if (item.mode === "steer") {
          const receipt = await api.steerAgentRun(item.targetRunId!, submissionPayload(item));
          await applyReceipt(item, receipt, key);
        } else {
          await send(item);
          if (readQueue(key).items.some((entry) => entry.submissionKey === item.submissionKey)) {
            try { await applyReceipt(item, await api.getAgentSubmission(options.sessionId!, item.submissionKey!), key); }
            catch {
              await mutate((value) => {
                const stored = value.items.find((entry) => entry.submissionKey === item.submissionKey);
                if (stored) stored.state = "uncertain";
                value.paused = true; value.pauseReason = "发送结果待核实";
              }, key);
            }
          }
        }
      } catch (reason) {
        if (item.mode === "steer" && reason instanceof ApiRequestError && reason.message === "AGENT_STEER_TARGET_FINISHED") {
          try { await applyReceipt(item, await api.getAgentSteering(item.targetRunId!, item.submissionKey!), key); return; }
          catch { /* Keep the original frozen input if lookup also fails. */ }
        }
        const known = reason instanceof ApiRequestError && ((reason.status >= 400 && reason.status < 500) || reason.message === "AGENT_NOT_READY")
          && !["AGENT_SUBMISSION_CONFLICT", "AGENT_STEER_TARGET_FINISHED"].includes(reason.message);
        await mutate((value) => {
          const stored = value.items.find((entry) => entry.itemId === item.itemId);
          if (stored) {
            stored.state = known ? "blocked" : "uncertain";
            stored.retrySafe = known;
            stored.error = known ? "请求未被接受，请调整内容或引用后重试。" : "发送结果待核实。";
          }
          value.paused = true; value.pauseReason = known ? "消息发送受阻" : "发送结果待核实";
        }, key);
      } finally { sending.current = null; }
    };
    // An ordinary dispatch owns this lock until its stream ends, so a second
    // tab cannot start the next run after the first item leaves the queue.
    // Steering uses its own worker and can enter while that stream is open.
    const operation = options.running ? dispatch() : navigator.locks.request(`${key}:dispatch`, dispatch);
    void operation.catch(() => undefined).finally(() => { worker.current = false; setProcessing((value) => !value); });
  }, [key, queue, options.running, options.runId, options.blocked, options.visible, editingId, error, processing, mutate, applyReceipt]);

  useEffect(() => {
    if (!queue.items.some((item) => item.state === "waiting_insert")) return;
    const timer = window.setInterval(() => { void recover(); }, 3000);
    return () => window.clearInterval(timer);
  }, [queue.items, recover]);

  const onEvent = (event: AgentStreamEvent) => {
    if (!key) return;
    if (["run.failed", "run.cancelled", "clarification.requested"].includes(event.type)) {
      void pause(event.type === "clarification.requested" ? "请先回答问题，再主动继续队列" : "本轮已停止，队列暂停");
    }
    if (event.type === "run.started") {
      const submitted = sending.current;
      if (submitted?.mode === "follow_up") void mutate((value) => {
        value.items = value.items.filter((item) => item.submissionKey !== submitted.submissionKey);
      }).catch(() => undefined);
    }
    if (event.type === "user.message.applied") void mutate((value) => {
      value.items = value.items.filter((item) => item.submissionKey !== event.submissionKey);
    }).catch(() => undefined);
    if (event.type === "user.message.rejected") void recover();
  };
  return {
    queue, error, editingId, supported: queueSupported(), pause, onEvent, recover,
    resume: () => mutate((value) => {
      if (current.current.blocked || value.items.some((item) => item.state !== "queued")) throw new Error("请先处理问题或核实受阻消息。");
      value.paused = false; value.pauseReason = null;
    }).catch(() => undefined),
    beginEdit: async (itemId: string) => {
      let item: QueueItem | undefined;
      await mutate((value) => {
        item = value.items.find((entry) => entry.itemId === itemId);
        if (!item || item.state !== "queued" || item.submissionKey) throw new Error("已提交的消息不能编辑。");
        editingPause.current ??= { paused: value.paused, reason: value.pauseReason };
        value.paused = true; value.pauseReason = "正在编辑排队消息";
      });
      setEditingId(itemId);
      return structuredClone(item!.request);
    },
    saveEdit: async (request: QueueDraft) => {
      await mutate((value) => {
        const item = value.items.find((entry) => entry.itemId === editingId);
        if (!item || item.state !== "queued" || item.submissionKey) throw new Error("该消息已经开始发送。");
        item.request = structuredClone(request); item.version += 1;
        if (value.pauseReason === "正在编辑排队消息" && editingPause.current) {
          value.paused = editingPause.current.paused; value.pauseReason = editingPause.current.reason;
        }
      });
      editingPause.current = null;
      setEditingId(null);
    },
    cancelEdit: async () => {
      await mutate((value) => {
        if (value.pauseReason === "正在编辑排队消息" && editingPause.current) {
          value.paused = editingPause.current.paused; value.pauseReason = editingPause.current.reason;
        }
      }).catch(() => undefined);
      editingPause.current = null;
      setEditingId(null);
    },
    move: (itemId: string, direction: number) => mutate((value) => {
      const index = value.items.findIndex((item) => item.itemId === itemId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= value.items.length
          || value.items[index].submissionKey || value.items[target].submissionKey) return;
      [value.items[index], value.items[target]] = [value.items[target], value.items[index]];
    }).catch(() => undefined),
    remove: (itemId: string) => mutate((value) => {
      value.items = value.items.filter((item) => item.itemId !== itemId
        || (Boolean(item.submissionKey) && !(item.state === "blocked" && item.retrySafe)));
    }).catch(() => undefined),
    steer: async (itemId: string) => {
      try {
        const capabilities = await api.getAgentReadiness();
        if (!capabilities.steering) { setError("插入暂不可用，消息保留在普通队列中。"); return; }
      } catch { setError("插入暂不可用，消息保留在普通队列中。"); return; }
      return mutate((value) => {
      const item = value.items.find((entry) => entry.itemId === itemId);
      if (!item || item.submissionKey || current.current.blocked || !current.current.runId) return;
      item.mode = "steer"; item.targetRunId = current.current.runId;
      // Converted inputs are admitted in the order of the conversion actions.
      const position = value.items.filter((entry) => entry.mode === "steer" && entry !== item).length;
      value.items = value.items.filter((entry) => entry !== item);
      value.items.splice(position, 0, item);
      if (!value.items.some((entry) => ["uncertain", "blocked"].includes(entry.state))) {
        value.paused = false; value.pauseReason = null;
      }
      }).catch(() => undefined);
    },
    unblock: (itemId: string) => mutate((value) => {
      const item = value.items.find((entry) => entry.itemId === itemId);
      if (item?.state === "blocked" && item.retrySafe) {
        item.state = "queued"; item.error = undefined; item.submissionKey = undefined;
        item.submittedRequestHash = undefined; item.version += 1;
      }
    }).catch(() => undefined),
    retryOriginal: (itemId: string) => mutate((value) => {
      const item = value.items.find((entry) => entry.itemId === itemId);
      if (item?.state !== "uncertain" || item.mode !== "follow_up" || !item.submissionKey) return;
      item.state = "queued"; item.error = undefined;
      value.paused = false; value.pauseReason = null;
    }).catch(() => undefined),
  };
}
