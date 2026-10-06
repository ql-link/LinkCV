import { create } from "zustand";
import { api, type AgentSession } from "../api/client";
import { clearMessageQueues } from "../features/agent/messageQueue";
import { useResumeStore } from "../store/resumeStore";

// 侧栏「最近对话」和首页对话共用的会话列表。
// 侧栏在所有工作区页面都显示，所以会话列表不能只存在 AssistantPage 里。
type SessionState = {
  sessions: AgentSession[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  // 正在生成回答的会话：删除入口要置灰（与 AssistantPage 原有规则一致）
  runningIds: string[];
  collapsedGroups: { pin: boolean; recent: boolean };
  toggleGroup: (group: "pin" | "recent") => void;
  setPinned: (sessionId: string, pinned: boolean) => Promise<AgentSession>;
  load: (force?: boolean) => Promise<void>;
  upsert: (session: AgentSession) => void;
  promote: (session: AgentSession) => void;
  remove: (sessionId: string) => void;
  rename: (sessionId: string, title: string) => Promise<AgentSession>;
  destroy: (sessionId: string) => Promise<void>;
  setRunning: (sessionId: string, running: boolean) => void;
};

export function sortSessions(items: AgentSession[]) {
  return [...items].sort((left, right) => {
    const pinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
    if (pinned !== 0) return pinned;
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

let inflight: Promise<void> | null = null;
let scopeRevision = 0;

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  status: "idle",
  error: null,
  runningIds: [],
  collapsedGroups: { pin: false, recent: false },
  toggleGroup: (group) => set((state) => ({ collapsedGroups: { ...state.collapsedGroups, [group]: !state.collapsedGroups[group] } })),
  setPinned: async (sessionId, pinned) => {
    const scope = scopeRevision;
    const { session } = await api.updateAgentSession(sessionId, { pinned });
    if (scope === scopeRevision) get().upsert(session);
    return session;
  },
  load: async (force = false) => {
    if (inflight) return inflight;
    if (!force && get().status === "ready") return;
    set({ status: get().status === "ready" || get().sessions.length ? "ready" : "loading", error: null });
    const scope = scopeRevision;
    inflight = api.listAgentSessions()
      .then(({ sessions }) => { if (scope === scopeRevision) set({ sessions: sortSessions(sessions), status: "ready" }); })
      .catch(() => { if (scope === scopeRevision) set({ status: "error", error: "对话列表暂时无法读取" }); })
      .finally(() => { if (scope === scopeRevision) inflight = null; });
    return inflight;
  },
  upsert: (session) => set((state) => ({
    sessions: sortSessions([session, ...state.sessions.filter((item) => item.id !== session.id)]),
  })),
  promote: (session) => set((state) => ({
    sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)],
  })),
  remove: (sessionId) => set((state) => ({ sessions: state.sessions.filter((item) => item.id !== sessionId) })),
  rename: async (sessionId, title) => {
    const scope = scopeRevision;
    const { session } = await api.updateAgentSession(sessionId, { title });
    if (scope === scopeRevision) get().upsert(session);
    return session;
  },
  destroy: async (sessionId) => {
    const scope = scopeRevision;
    const userId = useResumeStore.getState().user?.id;
    await api.deleteAgentSession(sessionId);
    if (scope === scopeRevision) get().remove(sessionId);
    if (userId) await clearMessageQueues(userId, sessionId);
  },
  setRunning: (sessionId, running) => set((state) => ({
    runningIds: running
      ? Array.from(new Set([...state.runningIds, sessionId]))
      : state.runningIds.filter((id) => id !== sessionId),
  })),
}));

// 当前正在查看的会话（首页对话里选中的那条），侧栏据此高亮
export const useActiveSessionStore = create<{ activeId: string | null; setActive: (id: string | null) => void }>((set) => ({
  activeId: null,
  setActive: (activeId) => set({ activeId }),
}));


/** Invalidate pending reads together with personal state on account changes. */
export function resetSessionStores() {
  scopeRevision += 1;
  inflight = null;
  useSessionStore.setState({ sessions: [], status: "idle", error: null, runningIds: [], collapsedGroups: { pin: false, recent: false } });
  useActiveSessionStore.setState({ activeId: null });
}
