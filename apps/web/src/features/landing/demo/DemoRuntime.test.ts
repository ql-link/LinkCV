import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { api, type AgentStreamEvent } from "@/api/client";
import { installDemoRuntime } from "./DemoRuntime";

vi.mock("@/store/resumeStore", () => ({ useResumeStore: { setState: vi.fn() } }));
vi.mock("@/features/mock-interview/mockInterviewApi", () => ({ useDemoMockInterviewApi: vi.fn(), resetMockInterviewStore: vi.fn() }));

beforeAll(() => { document.documentElement.dataset.landingDemo = "true"; installDemoRuntime(); });
afterEach(() => vi.useRealTimers());

describe("offline showcase behavior", () => {
  it("refuses to install outside the isolated demo document", () => {
    delete document.documentElement.dataset.landingDemo;
    const fetch = window.fetch;
    const me = api.me;
    try {
      expect(() => installDemoRuntime()).toThrow("isolated landing demo document");
      expect(window.fetch).toBe(fetch);
      expect(api.me).toBe(me);
    } finally {
      document.documentElement.dataset.landingDemo = "true";
    }
  });
  it("switches independent fictional histories and persists rename / pin / delete", async () => {
    const { sessions } = await api.listAgentSessions();
    expect(sessions).toHaveLength(4);
    const first = await api.getAgentSession(sessions[0].id);
    const second = await api.getAgentSession(sessions[1].id);
    expect(first.session.messages[0].content).not.toEqual(second.session.messages[0].content);
    const { session } = await api.createAgentSession("测试会话");
    await api.updateAgentSession(session.id, { title: "已重命名", pinned: true });
    expect((await api.getAgentSession(session.id)).session).toMatchObject({ title: "已重命名", pinned: true });
    await api.deleteAgentSession(session.id);
    expect((await api.listAgentSessions()).sessions.some(item => item.id === session.id)).toBe(false);
  });
  it("streams, stores both turns, and applies an actual local resume change", async () => {
    vi.useFakeTimers();
    const { session } = await api.createAgentSession();
    const events: AgentStreamEvent[] = [];
    const running = api.streamAgentMessage(session.id, { content: "帮我优化项目经历", idempotency_key: "test-completed" }, new AbortController().signal, event => events.push(event));
    await vi.runAllTimersAsync(); await running;
    expect(events[0].type).toBe("run.started");
    expect(events.filter(event => event.type === "assistant.delta").length).toBeGreaterThan(2);
    expect(events[events.length - 1]?.type).toBe("run.completed");
    expect((await api.getAgentSession(session.id)).session.messages.map(item => item.role)).toEqual(["user", "assistant"]);
    const { proposals } = await api.listAgentProposals(null, session.id);
    const before = JSON.stringify((await api.getResume(proposals[0].resume_id)).resume.data);
    const applied = await api.confirmAgentProposal(proposals[0].id);
    expect(JSON.stringify(applied.resume.data)).not.toEqual(before);
    expect(JSON.stringify(applied.resume.data)).toContain("围绕审批配置中的高频问题");
  });
  it("stops mid-stream without a completed event and retains the partial reply", async () => {
    vi.useFakeTimers();
    const { session } = await api.createAgentSession();
    const events: AgentStreamEvent[] = []; const controller = new AbortController();
    const running = api.streamAgentMessage(session.id, { content: "模拟面试", idempotency_key: "test-cancelled" }, controller.signal, event => events.push(event));
    await vi.advanceTimersByTimeAsync(900); controller.abort(); await running;
    expect(events.some(event => event.type === "run.cancelled")).toBe(true);
    expect(events.some(event => event.type === "run.completed")).toBe(false);
    const { session: stored } = await api.getAgentSession(session.id);
    expect(stored.messages).toHaveLength(2);
    expect(stored.messages[1].content.length).toBeGreaterThan(0);
  });
  it("blocks unimplemented API requests and keeps fake data isolated from consumers", async () => {
    expect((await window.fetch("/api/private-write", { method: "POST" })).status).toBe(501);
    const { resumes } = await api.listResumes(); const title = resumes[0].title;
    resumes[0].title = "consumer mutation";
    expect((await api.listResumes()).resumes[0].title).toBe(title);
  });
});
