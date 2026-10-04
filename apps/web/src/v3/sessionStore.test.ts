import { afterEach, expect, it, vi } from "vitest";
import { api, type AgentSession } from "../api/client";
import { resetSessionStores, useSessionStore } from "./sessionStore";

afterEach(() => vi.restoreAllMocks());

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
