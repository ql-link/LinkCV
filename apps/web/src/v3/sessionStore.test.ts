import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useSessionStore } from "./sessionStore";

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
