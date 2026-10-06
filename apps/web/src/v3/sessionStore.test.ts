import { afterEach, expect, it, vi } from "vitest";
import { api, type AgentSession } from "../api/client";
import { resetSessionStores, useSessionStore } from "./sessionStore";
import { useResumeStore } from "../store/resumeStore";
import { enqueueMessage, queueKey, readQueue } from "../features/agent/messageQueue";
import { installMessageQueueEnvironment } from "../test/messageQueueEnvironment";

afterEach(() => vi.restoreAllMocks());

it("删除 V3 对话只清理该对话队列，失败时保留消息", async () => {
  installMessageQueueEnvironment();
  const originalUser = useResumeStore.getState().user;
  useResumeStore.setState({ user: { id: "queue-owner", email: "queue@example.test", nickname: "测试", is_admin: false } });
  try {
    await enqueueMessage("queue-owner", "deleted", { content: "待发送" });
    await enqueueMessage("queue-owner", "kept", { content: "保留" });
    const remove = vi.spyOn(api, "deleteAgentSession").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    await expect(useSessionStore.getState().destroy("deleted")).rejects.toThrow("offline");
    expect((await readQueue(queueKey("queue-owner", "deleted"))).items).toHaveLength(1);
    await useSessionStore.getState().destroy("deleted");
    expect(remove).toHaveBeenCalledTimes(2);
    expect((await readQueue(queueKey("queue-owner", "deleted"))).items).toHaveLength(0);
    expect((await readQueue(queueKey("queue-owner", "kept"))).items).toHaveLength(1);
  } finally { useResumeStore.setState({ user: originalUser }); vi.unstubAllGlobals(); }
});

it("已确认没有最近对话时，后台刷新不会闪回读取中", async () => {
  useSessionStore.setState({ sessions: [], status: "ready", error: null });
  let finish!: (value: Awaited<ReturnType<typeof api.listAgentSessions>>) => void;
  vi.spyOn(api, "listAgentSessions").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const request = useSessionStore.getState().load(true);
  expect(useSessionStore.getState().status).toBe("ready");
  finish({ sessions: [] });
  await request;
  expect(useSessionStore.getState().status).toBe("ready");
});


it("账号切换清空对话，并丢弃旧账号迟到的列表", async () => {
  resetSessionStores();
  let finish!: (value: Awaited<ReturnType<typeof api.listAgentSessions>>) => void;
  const old = { id: "old-user-session", title: "旧账号对话", updated_at: "2026-10-01T00:00:00Z" } as AgentSession;
  const current = { id: "new-user-session", title: "新账号对话", updated_at: "2026-10-02T00:00:00Z" } as AgentSession;
  vi.spyOn(api, "listAgentSessions").mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ sessions: [current] });
  const pending = useSessionStore.getState().load(true);
  resetSessionStores();
  expect(useSessionStore.getState().sessions).toEqual([]);
  await useSessionStore.getState().load(true);
  finish({ sessions: [old] });
  await pending;
  expect(useSessionStore.getState().sessions).toEqual([current]);
});

it("切换账号重置分组收起状态，旧账号迟到的 Pin 响应不会插入新账号列表", async () => {
  resetSessionStores();
  const old = { id: "old-pin-session", title: "旧账号测试", pinned: true } as AgentSession;
  let finish!: (value: Awaited<ReturnType<typeof api.updateAgentSession>>) => void;
  vi.spyOn(api, "updateAgentSession").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  useSessionStore.getState().toggleGroup("pin");
  useSessionStore.getState().toggleGroup("recent");
  const pending = useSessionStore.getState().setPinned(old.id, true);
  resetSessionStores();
  finish({ session: old });
  await pending;
  expect(useSessionStore.getState().sessions).toEqual([]);
  expect(useSessionStore.getState().collapsedGroups).toEqual({ pin: false, recent: false });
});
