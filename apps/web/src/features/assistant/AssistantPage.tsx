import {
  ArrowUp,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Database,
  FileText,
  Menu,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Square,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  AgentMarkdown,
  agentErrorMessage,
  clarificationAllowsCustom,
  clarificationAnswerText,
  pendingClarificationMessage,
  type ClarificationAnswer,
} from "../agent/AgentPanel";
import {
  AgentClarification,
  AgentContextRef,
  AgentContextSnapshot,
  AgentContextType,
  AgentModelSummary,
  AgentMessage,
  AgentProposal,
  AgentSession,
  AgentStreamEvent,
  ApiRequestError,
  api,
} from "../../api/client";
import { Button, ConfirmDialog } from "@/components/ui";
import { assistantPath, navigateTo } from "../../routing";
import assistantFeather from "./assistant-assets/assistant-feather.png";
import "./assistant.css";

const NEW_CONVERSATION_KEY = "__assistant_new__";
const CONTEXT_TYPES: Array<{ type: AgentContextType; label: string; icon: typeof FileText }> = [
  { type: "resume", label: "当前简历", icon: FileText },
  { type: "resume_version", label: "简历版本", icon: FileText },
  { type: "dataset", label: "资料", icon: Database },
  { type: "job", label: "岗位", icon: BriefcaseBusiness },
  { type: "application", label: "求职进程", icon: Target },
  { type: "interview", label: "面试记录", icon: CalendarDays },
];

const PHASE_LABELS: Record<string, string> = {
  loading_context: "正在读取所选资料…",
  comparing_context: "正在分析简历与岗位要求…",
  drafting: "正在整理建议…",
};

const MESSAGE_FOLLOW_THRESHOLD = 96;

type LocalMessage = AgentMessage & {
  temporary?: boolean;
  status?: "streaming" | "stopped" | "failed";
};

type MentionContextType = Extract<AgentContextType, "dataset" | "resume">;

type ContextMention = {
  start: number;
  end: number;
  query: string;
  token: string;
  types: MentionContextType[];
};

function contextMentionAt(value: string, caret: number): ContextMention | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(^|[\s，。！？；：,.!?;:（(])@([^\s@]*)$/.exec(beforeCaret);
  if (!match) return null;
  const token = match[2] ?? "";
  const start = match.index + (match[1]?.length ?? 0);
  return { start, end: caret, query: token, token, types: ["resume", "dataset"] };
}

type ComposerSegment =
  | { kind: "text"; text: string; key: string }
  | { kind: "context"; context: AgentContextSnapshot; key: string };

function composerSegments(draft: string, contexts: AgentContextSnapshot[]): ComposerSegment[] {
  const segments: ComposerSegment[] = [];
  const missing = contexts.filter((context) => !draft.includes(`@${context.label}`));
  missing.forEach((context) => segments.push({ kind: "context", context, key: `orphan:${contextKey(context)}` }));
  if (missing.length > 0 && draft) segments.push({ kind: "text", text: " ", key: "orphan-space" });

  let cursor = 0;
  let segmentIndex = 0;
  while (cursor < draft.length) {
    const next = contexts
      .map((context) => ({ context, index: draft.indexOf(`@${context.label}`, cursor) }))
      .filter(({ index }) => index >= 0)
      .sort((left, right) => left.index - right.index)[0];
    if (!next) {
      segments.push({ kind: "text", text: draft.slice(cursor), key: `text:${segmentIndex}` });
      break;
    }
    if (next.index > cursor) {
      segments.push({ kind: "text", text: draft.slice(cursor, next.index), key: `text:${segmentIndex}` });
    }
    segments.push({ kind: "context", context: next.context, key: `context:${segmentIndex}:${contextKey(next.context)}` });
    cursor = next.index + next.context.label.length + 1;
    segmentIndex += 1;
  }
  return segments;
}

function composerNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.contextValue) return node.dataset.contextValue;
  if (node.tagName === "BR") return "\n";
  const content = Array.from(node.childNodes).map(composerNodeText).join("");
  return ["DIV", "P"].includes(node.tagName) ? `\n${content}` : content;
}

function composerValue(element: HTMLElement) {
  return Array.from(element.childNodes).map(composerNodeText).join("").replace(/^\n/, "");
}

function composerCaretOffset(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !element.contains(selection.anchorNode)) {
    return composerValue(element).length;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  const holder = document.createElement("div");
  holder.append(range.cloneContents());
  return composerValue(holder).length;
}

function placeComposerCaret(element: HTMLElement, targetOffset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  let consumed = 0;
  let placed = false;
  const range = document.createRange();
  const visit = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (placed) return;
      if (child.nodeType === Node.TEXT_NODE) {
        const length = child.textContent?.length ?? 0;
        if (targetOffset <= consumed + length) {
          range.setStart(child, Math.max(0, targetOffset - consumed));
          placed = true;
          return;
        }
        consumed += length;
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      if (child.dataset.contextValue) {
        const length = child.dataset.contextValue.length;
        if (targetOffset <= consumed + length) {
          range.setStartAfter(child);
          placed = true;
          return;
        }
        consumed += length;
        continue;
      }
      if (child.tagName === "BR") {
        consumed += 1;
        continue;
      }
      visit(child);
    }
  };
  visit(element);
  if (!placed) range.selectNodeContents(element), range.collapse(false);
  else range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

type ConversationState = {
  session: AgentSession;
  messages: LocalMessage[];
  proposals: AgentProposal[];
  contexts: AgentContextSnapshot[];
  draft: string;
  running: boolean;
  cancelling: boolean;
  stage: "idle" | "submitting" | "thinking" | "streaming" | "stopped" | "failed";
  runId: string | null;
  phase: string;
  referencedContextCount: number;
  startedAt: number | null;
  detailsOpen: boolean;
  error: string | null;
  busyProposalId: string | null;
  invalidContextIds: string[];
  clarificationAnswers: Record<string, ClarificationAnswer>;
  clarificationAttempted: boolean;
  clarificationCollapsed: boolean;
};

function blankSession(): AgentSession {
  const timestamp = new Date().toISOString();
  return {
    id: NEW_CONVERSATION_KEY,
    resume_id: null,
    title: "新对话",
    pinned: false,
    status: "active",
    last_message_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    messages: [],
  };
}

function blankConversation(): ConversationState {
  return {
    session: blankSession(),
    messages: [],
    proposals: [],
    contexts: [],
    draft: "",
    running: false,
    cancelling: false,
    stage: "idle",
    runId: null,
    phase: "正在准备…",
    referencedContextCount: 0,
    startedAt: null,
    detailsOpen: false,
    error: null,
    busyProposalId: null,
    invalidContextIds: [],
    clarificationAnswers: {},
    clarificationAttempted: false,
    clarificationCollapsed: false,
  };
}

function sortSessions(items: AgentSession[]) {
  return [...items].sort((left, right) => {
    const pinnedDifference = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
    if (pinnedDifference !== 0) return pinnedDifference;
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

function contextKey(context: Pick<AgentContextRef, "type" | "id">) {
  return `${context.type}:${context.id}`;
}

function withoutContextToken(draft: string, context: AgentContextSnapshot) {
  const token = `@${context.label}`;
  const index = draft.indexOf(token);
  if (index < 0) return draft;
  const end = index + token.length;
  const removeEnd = draft[end] === " " ? end + 1 : end;
  return `${draft.slice(0, index)}${draft.slice(removeEnd)}`;
}

function contextLabel(type: AgentContextType) {
  return CONTEXT_TYPES.find((item) => item.type === type)?.label ?? "资料";
}

function ContextSourceIcon({ type, size }: { type: AgentContextType; size: number }) {
  const Icon = type === "dataset" ? Database : FileText;
  return <Icon size={size} aria-hidden="true" />;
}

function proposalResumeLabel(state: ConversationState, resumeId: string) {
  const referenced = [
    ...state.contexts,
    ...state.messages.flatMap((message) => message.contexts ?? []),
  ].find((context) => (
    context.type === "resume" || context.type === "resume_version"
  ) && (context.resume_id ?? context.id) === resumeId);
  return referenced?.label ?? `简历 #${resumeId}`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatConversationDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeContextItems(payload: unknown, type: AgentContextType): AgentContextSnapshot[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const rawContexts = record.contexts;
  if (Array.isArray(rawContexts)) {
    const first = rawContexts[0];
    if (first && typeof first === "object" && Array.isArray((first as Record<string, unknown>).items)) {
      return (rawContexts as Array<Record<string, unknown>>)
        .flatMap((group) => Array.isArray(group.items) ? group.items : [])
        .map((item) => normalizeContext(item, type))
        .filter((item): item is AgentContextSnapshot => item !== null);
    }
    return rawContexts
      .map((item) => normalizeContext(item, type))
      .filter((item): item is AgentContextSnapshot => item !== null);
  }
  if (Array.isArray(record.items)) {
    return record.items
      .map((item) => normalizeContext(item, type))
      .filter((item): item is AgentContextSnapshot => item !== null);
  }
  if (Array.isArray(record.groups)) {
    return (record.groups as Array<Record<string, unknown>>)
      .flatMap((group) => Array.isArray(group.items) ? group.items : [])
      .map((item) => normalizeContext(item, type))
      .filter((item): item is AgentContextSnapshot => item !== null);
  }
  return [];
}

function normalizeContext(value: unknown, fallbackType: AgentContextType): AgentContextSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const type = typeof item.type === "string" ? item.type : fallbackType;
  if (!CONTEXT_TYPES.some((entry) => entry.type === type)) return null;
  const id = item.id ?? item.object_id ?? item.resume_id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const label = item.label ?? item.title ?? item.name ?? item.job_title ?? "未命名资料";
  return {
    type: type as AgentContextType,
    id: String(id),
    version_id: typeof item.version_id === "string" ? item.version_id : null,
    version: typeof item.version === "string" ? item.version : null,
    resume_id: typeof item.resume_id === "string" ? item.resume_id : null,
    label: String(label),
    description: typeof item.description === "string" ? item.description : null,
    updated_at: typeof item.updated_at === "string" ? item.updated_at : null,
  };
}

function resumeIdForContext(context: AgentContextRef) {
  if (context.type === "resume" || context.type === "resume_version") return context.id;
  return null;
}

function safeAgentError(error: unknown) {
  const code = error instanceof ApiRequestError ? error.message : "";
  if (code === "AGENT_RUN_IN_PROGRESS") return null;
  const messages: Record<string, string> = {
    AGENT_CONTEXT_NOT_FOUND: "所选资料已不可用，请重新选择。",
    AGENT_CONTEXT_STALE: "所选资料已发生变化，请刷新选择后重试。",
    AGENT_CONTEXT_READ_FAILED: "所选资料暂时无法读取，请稍后重试。",
    AGENT_SESSION_RESUME_MISMATCH: "这个会话已经绑定另一份简历，请新建对话后继续。",
    AGENT_SESSION_NOT_FOUND: "对话不存在或已无法访问。",
    AGENT_UNAVAILABLE: "智能助手暂时不可用，草稿和已选资料不会丢失。",
    AGENT_MODEL_UNAVAILABLE: "当前模型暂时不可用，请稍后重试。",
    AGENT_STREAM_INCOMPLETE: "智能助手连接意外中断，请稍后重试。",
    RESUME_EDIT_CONFLICT: "简历已发生新的修改，这份提案没有应用。",
    TARGET_STALE: "提案定位内容已发生变化，请重新定位后再试。",
    AGENT_PROPOSAL_EXPIRED: "这份提案已过期，请重新生成建议。",
    AGENT_PROPOSAL_NOT_PENDING: "这份提案已经处理过，不能重复应用。",
    RESUME_VERSION_LIMIT_REACHED: "简历版本数量已达上限，提案没有应用。",
  };
  return messages[code] ?? agentErrorMessage(error);
}

function isConflictError(error: unknown) {
  return error instanceof ApiRequestError && [
    "RESUME_EDIT_CONFLICT",
    "TARGET_STALE",
    "AGENT_PROPOSAL_EXPIRED",
    "AGENT_PROPOSAL_NOT_PENDING",
  ].includes(error.message);
}

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.().replace(/-/g, "")
    ?? `${Date.now().toString(36)}_assistant`;
}

function messageText(message: LocalMessage) {
  return message.content || (message.message_type === "clarification" ? "需要你补充一些信息。" : "");
}

function mergeSessionMessages(persisted: AgentMessage[], current: LocalMessage[]) {
  const persistedAssistant = persisted.some((message) => message.role === "assistant");
  if (persistedAssistant) return persisted;
  const partialAssistant = current.filter((message) => message.role === "assistant" && message.temporary);
  return partialAssistant.length > 0 ? [...persisted, ...partialAssistant] : persisted;
}

function conversationHeading(state: ConversationState, hasClarification: boolean) {
  if (hasClarification) return ["还需要确认一点", "补充关键信息后，我会继续完成这次任务。"] as const;
  if (state.proposals.some((proposal) => proposal.status === "applied")) return ["修改已完成", "已按你确认的提案更新简历，变更内容在右侧可查看。"] as const;
  if (state.proposals.some((proposal) => proposal.status === "pending")) return ["修改提案待确认", "确认前不会写入简历，你可以先检查每一处改动。"] as const;
  if (state.stage === "stopped") return ["生成已停止", "已保留当前内容，你可以继续上次的要求。"] as const;
  if (state.stage === "failed") return ["本次生成未完成", "已保留当前内容和问题草稿，可以稍后重试。"] as const;
  if (state.stage === "streaming") return ["正在生成回答", "内容会逐步出现，你可以随时停止。"] as const;
  if (state.running && state.phase.includes("读取")) return ["提交并读取资料", "已提交问题，正在读取本轮选择的资料并建立回答上下文。"] as const;
  if (state.running) return ["正在召回相关资料", "AI 正在根据当前问题检索资料，右上角会同步展示本轮命中的相关文件。"] as const;
  return null;
}

type AssistantPageProps = {
  sessionId?: string;
};

export function AssistantPage({ sessionId }: AssistantPageProps = {}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [conversationStates, setConversationStates] = useState<Record<string, ConversationState>>(() => ({
    [NEW_CONVERSATION_KEY]: blankConversation(),
  }));
  const [activeKey, setActiveKey] = useState(NEW_CONVERSATION_KEY);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [runtimeModel, setRuntimeModel] = useState<AgentModelSummary | null>(null);
  const [runtimeModelLoading, setRuntimeModelLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextType, setContextType] = useState<AgentContextType>("resume");
  const [contextOptions, setContextOptions] = useState<AgentContextSnapshot[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextSearch, setContextSearch] = useState("");
  const [contextDrafts, setContextDrafts] = useState<AgentContextSnapshot[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [clarificationPage, setClarificationPage] = useState(0);
  const [resumeMismatch, setResumeMismatch] = useState<AgentContextSnapshot | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingDeleteSession, setPendingDeleteSession] = useState<AgentSession | null>(null);
  const [sessionActionBusyId, setSessionActionBusyId] = useState<string | null>(null);
  const [recallDrawerOpen, setRecallDrawerOpen] = useState(false);
  const [recallReferencesOpen, setRecallReferencesOpen] = useState(false);
  const [recallModificationsOpen, setRecallModificationsOpen] = useState(false);
  const [contextMention, setContextMention] = useState<ContextMention | null>(null);
  const [mentionOptions, setMentionOptions] = useState<AgentContextSnapshot[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [composerView, setComposerView] = useState(() => ({
    revision: 0,
    draft: "",
    contexts: [] as AgentContextSnapshot[],
    invalidContextIds: [] as string[],
  }));
  const streamRequestRef = useRef(0);
  const mentionRequestRef = useRef(0);
  const activeKeyRef = useRef(activeKey);
  const conversationStatesRef = useRef(conversationStates);
  const abortRef = useRef<AbortController | null>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const contextCloseButtonRef = useRef<HTMLButtonElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const pendingComposerCaretRef = useRef<number | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const followMessagesRef = useRef(true);
  const isComposingRef = useRef(false);
  activeKeyRef.current = activeKey;
  conversationStatesRef.current = conversationStates;

  const current = conversationStates[activeKey] ?? conversationStates[NEW_CONVERSATION_KEY] ?? blankConversation();
  const pendingClarification = pendingClarificationMessage(current.messages);
  const isEmptyConversation = current.messages.length === 0 && !current.running;
  const conversationStateHeading = conversationHeading(current, Boolean(pendingClarification));
  const clarificationQuestions = pendingClarification?.clarification?.questions ?? [];
  const clarificationQuestion = clarificationQuestions[Math.min(clarificationPage, Math.max(0, clarificationQuestions.length - 1))];
  const latestUserMessage = [...current.messages].reverse().find((message) => message.role === "user");
  const latestTurnContexts = latestUserMessage?.contexts ?? (current.running ? current.contexts : []);
  const latestUserCreatedAt = latestUserMessage ? new Date(latestUserMessage.created_at).getTime() : Number.NaN;
  const latestTurnProposal = [...current.proposals]
    .filter((proposal) => {
      if (!latestUserMessage || Number.isNaN(latestUserCreatedAt)) return true;
      const proposalCreatedAt = new Date(proposal.created_at).getTime();
      return Number.isNaN(proposalCreatedAt) || proposalCreatedAt >= latestUserCreatedAt;
    })
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] ?? null;

  const refreshComposerView = useCallback((draft: string, contexts: AgentContextSnapshot[], invalidContextIds: string[]) => {
    setComposerView((view) => ({
      revision: view.revision + 1,
      draft,
      contexts,
      invalidContextIds,
    }));
  }, []);

  useEffect(() => {
    refreshComposerView(current.draft, current.contexts, current.invalidContextIds);
  }, [activeKey, current.running, current.cancelling]);

  useLayoutEffect(() => {
    const caret = pendingComposerCaretRef.current;
    if (caret === null || !inputRef.current) return;
    pendingComposerCaretRef.current = null;
    placeComposerCaret(inputRef.current, caret);
    inputRef.current.focus();
  }, [activeKey, current.contexts, current.draft]);

  const updateConversation = useCallback((key: string, update: Partial<ConversationState> | ((state: ConversationState) => Partial<ConversationState>)) => {
    setConversationStates((states) => {
      const existing = states[key] ?? blankConversation();
      const patch = typeof update === "function" ? update(existing) : update;
      return { ...states, [key]: { ...existing, ...patch } };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.listAgentSessions()
      .then(({ sessions: nextSessions }) => {
        if (cancelled) return;
        setSessions(nextSessions);
        setConversationStates((states) => {
          const next = { ...states };
          for (const session of nextSessions) {
            next[session.id] = next[session.id] ?? {
              ...blankConversation(),
              session,
              messages: session.messages ?? [],
            };
          }
          return next;
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setSessionsError(safeAgentError(error));
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sessionMenuId) return undefined;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".assistant-session-actions")) return;
      setSessionMenuId(null);
    };
    const closeMenuWithKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSessionMenuId(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, [sessionMenuId]);

  useEffect(() => {
    let cancelled = false;
    void api.getAgentModel()
      .then(({ model }) => {
        if (!cancelled) setRuntimeModel(model);
      })
      .catch(() => {
        if (!cancelled) setRuntimeModel(null);
      })
      .finally(() => {
        if (!cancelled) setRuntimeModelLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!current.running) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeKey, current.running]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuOpen(false);
        window.setTimeout(() => mobileMenuButtonRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => () => {
    const key = activeKeyRef.current;
    const runId = conversationStatesRef.current[key]?.runId;
    streamRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (runId) void api.cancelAgentRun(runId).catch(() => undefined);
  }, []);

  useEffect(() => {
    const element = messageViewportRef.current;
    if (!element || !followMessagesRef.current) return;
    if (typeof element.scrollTo === "function") {
      try {
        element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      } catch {
        element.scrollTop = element.scrollHeight;
      }
    } else {
      element.scrollTop = element.scrollHeight;
    }
  }, [current.messages, current.stage]);

  useEffect(() => {
    setClarificationPage(0);
  }, [pendingClarification?.created_at, pendingClarification?.sequence_no]);

  useEffect(() => {
    setContextMention(null);
  }, [activeKey]);

  useEffect(() => {
    const requestNumber = mentionRequestRef.current + 1;
    mentionRequestRef.current = requestNumber;
    if (!contextMention) {
      setMentionOptions([]);
      setMentionLoading(false);
      setMentionError(null);
      return undefined;
    }
    setMentionLoading(true);
    setMentionError(null);
    const timeout = window.setTimeout(() => {
      void Promise.all(contextMention.types.map(async (type) => {
        const result = await api.listAgentContexts({
          type,
          search: contextMention.query,
          prefix: true,
          limit: 4,
        });
        return normalizeContextItems(result, type);
      })).then((groups) => {
        if (mentionRequestRef.current !== requestNumber) return;
        setMentionOptions(groups.flat());
        setMentionActiveIndex(0);
      }).catch((error) => {
        if (mentionRequestRef.current !== requestNumber) return;
        setMentionOptions([]);
        setMentionError(safeAgentError(error));
      }).finally(() => {
        if (mentionRequestRef.current === requestNumber) setMentionLoading(false);
      });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [contextMention]);

  useEffect(() => {
    if (!contextMention) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (inputRef.current?.contains(target) || mentionMenuRef.current?.contains(target)) return;
      setContextMention(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [contextMention]);

  useEffect(() => {
    if (!contextMention || mentionOptions.length === 0) return;
    const activeOption = mentionMenuRef.current
      ?.querySelector(`#assistant-context-mention-option-${mentionActiveIndex}`);
    activeOption?.scrollIntoView?.({ block: "nearest" });
  }, [contextMention, mentionActiveIndex, mentionOptions.length]);

  useEffect(() => {
    if (!contextPickerOpen && !modelMenuOpen) return undefined;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (contextPickerOpen) {
        setContextPickerOpen(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        setModelMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextPickerOpen, modelMenuOpen]);

  useEffect(() => {
    if (!modelMenuOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (modelSelectorRef.current?.contains(event.target as Node)) return;
      setModelMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [modelMenuOpen]);

  const handleMessageViewportScroll = () => {
    const element = messageViewportRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    followMessagesRef.current = distanceFromBottom <= MESSAGE_FOLLOW_THRESHOLD;
  };

  const elapsedSeconds = current.startedAt ? Math.max(0, Math.floor((clock - current.startedAt) / 1_000)) : 0;
  const detailsReady = current.running && current.stage !== "streaming" && elapsedSeconds >= 8;
  const runtimeModelLabel = runtimeModel?.name ?? (runtimeModelLoading ? "正在读取模型" : "模型不可用");

  const cancelCurrentRun = useCallback(async (key = activeKeyRef.current) => {
    const state = conversationStates[key];
    if (!state?.running) return;
    streamRequestRef.current += 1;
    const runId = state.runId;
    abortRef.current?.abort();
    abortRef.current = null;
    updateConversation(key, (latest) => ({
      running: false,
      cancelling: Boolean(runId),
      stage: "stopped",
      runId: null,
      startedAt: null,
      error: null,
      draft: latest.draft || [...latest.messages].reverse().find((message) => message.role === "user" && message.temporary)?.content || latest.draft,
      messages: latest.messages.map((message, index, messages) => (
        index === messages.length - 1 && message.role === "assistant" && message.temporary
          ? { ...message, status: "stopped" as const }
          : message
      )),
    }));
    if (runId) await api.cancelAgentRun(runId).catch(() => undefined);
    updateConversation(key, { cancelling: false });
  }, [conversationStates, updateConversation]);

  const selectSession = async (sessionIdToSelect: string) => {
    if (sessionIdToSelect === activeKeyRef.current) {
      setMobileMenuOpen(false);
      return;
    }
    const previousKey = activeKeyRef.current;
    activeKeyRef.current = sessionIdToSelect;
    await cancelCurrentRun(previousKey);
    setActiveKey(sessionIdToSelect);
    navigateTo(assistantPath(sessionIdToSelect));
    setMobileMenuOpen(false);
    setResumeMismatch(null);
    updateConversation(sessionIdToSelect, { error: null });
    try {
      const detail = await api.getAgentSession(sessionIdToSelect);
      const proposalResult = detail.session.resume_id
        ? await api.listAgentProposals(detail.session.resume_id, sessionIdToSelect)
        : { proposals: [] };
      updateConversation(sessionIdToSelect, {
        session: detail.session,
        messages: detail.session.messages ?? [],
        proposals: proposalResult.proposals,
        contexts: [],
        invalidContextIds: [],
        clarificationAnswers: {},
        clarificationAttempted: false,
        error: null,
      });
      setSessions((items) => [detail.session, ...items.filter((item) => item.id !== detail.session.id)]);
    } catch (error) {
      updateConversation(sessionIdToSelect, { error: safeAgentError(error) });
    }
  };

  const createNewConversation = async () => {
    if (activeKeyRef.current === NEW_CONVERSATION_KEY) {
      setMobileMenuOpen(false);
      navigateTo(assistantPath());
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    const previousKey = activeKeyRef.current;
    activeKeyRef.current = NEW_CONVERSATION_KEY;
    await cancelCurrentRun(previousKey);
    setActiveKey(NEW_CONVERSATION_KEY);
    navigateTo(assistantPath());
    setResumeMismatch(null);
    setMobileMenuOpen(false);
    updateConversation(NEW_CONVERSATION_KEY, {
      ...blankConversation(),
      session: blankSession(),
    });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    const routeSessionId = sessionId ?? NEW_CONVERSATION_KEY;
    if (routeSessionId === activeKeyRef.current) return;
    if (routeSessionId === NEW_CONVERSATION_KEY) {
      void createNewConversation();
      return;
    }
    void selectSession(routeSessionId);
  }, [sessionId]);

  const loadContexts = async (type: AgentContextType, search = contextSearch) => {
    setContextType(type);
    setContextLoading(true);
    setContextError(null);
    try {
      const result = await api.listAgentContexts({ type, search, limit: 30 });
      setContextOptions(normalizeContextItems(result, type));
    } catch (error) {
      setContextOptions([]);
      setContextError(safeAgentError(error));
    } finally {
      setContextLoading(false);
    }
  };

  const openContextPicker = () => {
    setContextDrafts(current.contexts);
    setContextPickerOpen(true);
    void loadContexts(contextType);
    window.setTimeout(() => contextCloseButtonRef.current?.focus(), 0);
  };

  const closeContextPicker = () => {
    setContextPickerOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const toggleContextDraft = (context: AgentContextSnapshot) => {
    const boundResumeId = current.session.resume_id;
    const contextResumeId = resumeIdForContext(context);
    if (boundResumeId && contextResumeId && boundResumeId !== contextResumeId) {
      setResumeMismatch(context);
      closeContextPicker();
      updateConversation(activeKey, { error: "这个会话已经绑定另一份简历，请新建对话后继续。" });
      return;
    }
    setContextDrafts((items) => {
      if (items.some((item) => contextKey(item) === contextKey(context))) {
        return items.filter((item) => contextKey(item) !== contextKey(context));
      }
      return [...items.filter((item) => item.type !== context.type), context];
    });
    setResumeMismatch(null);
  };

  const confirmContextDrafts = () => {
    refreshComposerView(current.draft, contextDrafts.slice(0, 10), current.invalidContextIds);
    updateConversation(activeKey, (state) => ({
      contexts: contextDrafts.slice(0, 10),
      invalidContextIds: state.invalidContextIds.filter((id) => contextDrafts.some((context) => contextKey(context) === id)),
      error: null,
    }));
    closeContextPicker();
  };

  const removeContext = (context: AgentContextRef) => {
    const contexts = current.contexts.filter((item) => contextKey(item) !== contextKey(context));
    const invalidContextIds = current.invalidContextIds.filter((id) => id !== contextKey(context));
    const draft = withoutContextToken(current.draft, context as AgentContextSnapshot);
    refreshComposerView(draft, contexts, invalidContextIds);
    updateConversation(activeKey, { contexts, invalidContextIds, draft });
  };

  const selectMentionContext = (context: AgentContextSnapshot) => {
    if (!contextMention) return;
    const boundResumeId = current.session.resume_id;
    const contextResumeId = resumeIdForContext(context);
    if (boundResumeId && contextResumeId && boundResumeId !== contextResumeId) {
      setResumeMismatch(context);
      setContextMention(null);
      updateConversation(activeKey, { error: "这个会话已经绑定另一份简历，请新建对话后继续。" });
      return;
    }
    const nextCaret = contextMention.start + context.label.length + 2;
    const contexts = [...current.contexts.filter((item) => item.type !== context.type), context].slice(0, 10);
    const invalidContextIds = current.invalidContextIds.filter((id) => contexts.some((item) => contextKey(item) === id));
    const draft = `${current.draft.slice(0, contextMention.start)}@${context.label} ${current.draft.slice(contextMention.end)}`;
    pendingComposerCaretRef.current = nextCaret;
    refreshComposerView(draft, contexts, invalidContextIds);
    updateConversation(activeKey, { contexts, invalidContextIds, draft, error: null });
    setResumeMismatch(null);
    setContextMention(null);
    window.setTimeout(() => {
      if (!inputRef.current) return;
      placeComposerCaret(inputRef.current, nextCaret);
      inputRef.current.focus();
    }, 0);
  };

  const handleEvent = (key: string, requestNumber: number, event: AgentStreamEvent) => {
    if (streamRequestRef.current !== requestNumber || activeKeyRef.current !== key) return;
    if (event.type === "run.started") {
      updateConversation(key, { runId: event.runId, stage: "thinking" });
      return;
    }
    if (event.type === "run.phase") {
      const phase = typeof event.phase === "string" ? event.phase : "";
      updateConversation(key, {
        phase: PHASE_LABELS[phase] ?? "AI 正在处理…",
        referencedContextCount: typeof event.referencedContextCount === "number"
          ? event.referencedContextCount
          : undefined,
      });
      return;
    }
    if (event.type === "assistant.delta") {
      updateConversation(key, (state) => {
        const messages = [...state.messages];
        const last = messages[messages.length - 1];
        if (last?.role === "assistant" && last.temporary && last.message_type === "clarification") {
          return {};
        }
        if (last?.role === "assistant" && last.temporary) {
          messages[messages.length - 1] = { ...last, content: last.content + event.delta, status: "streaming" };
        } else {
          messages.push({
            sequence_no: -1,
            role: "assistant",
            content: event.delta,
            created_at: new Date().toISOString(),
            temporary: true,
            status: "streaming",
          });
        }
        return { messages, stage: "streaming", error: null };
      });
      return;
    }
    if (event.type === "clarification.requested") {
      updateConversation(key, (state) => ({
        messages: [
          ...state.messages.filter((message) => !(message.role === "assistant" && message.temporary)),
          {
            sequence_no: -1,
            role: "assistant",
            message_type: "clarification",
            clarification: event.clarification,
            content: "",
            created_at: new Date().toISOString(),
            temporary: true,
          },
        ],
        stage: "thinking",
        error: null,
        clarificationAnswers: {},
        clarificationAttempted: false,
        clarificationCollapsed: false,
      }));
      return;
    }
    if (event.type === "proposal.created") {
      updateConversation(key, (state) => ({
        proposals: [event.proposal, ...state.proposals.filter((item) => item.id !== event.proposal.id)],
      }));
      return;
    }
    if (event.type === "run.failed") {
      updateConversation(key, (state) => ({
        error: safeAgentError(new ApiRequestError(502, event.error)),
        stage: "failed",
        messages: state.messages.map((message, index, messages) => (
          index === messages.length - 1 && message.role === "assistant" && message.temporary
            ? { ...message, status: "failed" as const }
            : message
        )),
      }));
      return;
    }
    if (event.type === "run.cancelled") {
      updateConversation(key, (state) => ({
        running: false,
        stage: "stopped",
        runId: null,
        startedAt: null,
        messages: state.messages.map((message, index, messages) => (
          index === messages.length - 1 && message.role === "assistant" && message.temporary
            ? { ...message, status: "stopped" as const }
            : message
        )),
      }));
    }
  };

  const ensureSession = async (state: ConversationState) => {
    if (state.session.id !== NEW_CONVERSATION_KEY) return state.session;
    const requestedResumeId = state.contexts.map(resumeIdForContext).find((value): value is string => Boolean(value));
    const result = await api.createAgentSession(requestedResumeId ?? null);
    const newState = { ...state, session: result.session };
    setConversationStates((states) => {
      const next = { ...states, [result.session.id]: newState };
      delete next[NEW_CONVERSATION_KEY];
      return next;
    });
    activeKeyRef.current = result.session.id;
    setSessions((items) => [result.session, ...items.filter((item) => item.id !== result.session.id)]);
    setActiveKey(result.session.id);
    navigateTo(assistantPath(result.session.id), { replace: true });
    return result.session;
  };

  const runMessage = async (content: string, replyToSequenceNo?: number) => {
    const trimmed = content.trim();
    const key = activeKeyRef.current;
    const state = conversationStates[key] ?? blankConversation();
    const statePendingClarification = pendingClarificationMessage(state.messages);
    if (!trimmed || state.running || state.cancelling || (statePendingClarification && replyToSequenceNo === undefined)) return;
    const boundResumeId = state.session.resume_id;
    const requestedResumeId = state.contexts.map(resumeIdForContext).find((value): value is string => Boolean(value));
    if (boundResumeId && requestedResumeId && boundResumeId !== requestedResumeId) {
      updateConversation(key, { error: "这个会话已经绑定另一份简历，请新建对话后继续。" });
      return;
    }

    let session: AgentSession;
    try {
      session = await ensureSession(state);
    } catch (error) {
      updateConversation(key, { error: safeAgentError(error) });
      return;
    }
    const requestKey = session.id;
    const requestNumber = streamRequestRef.current + 1;
    streamRequestRef.current = requestNumber;
    const controller = new AbortController();
    abortRef.current = controller;
    const sentContexts = state.contexts;
    const requestContexts: AgentContextRef[] = sentContexts.map(({ type, id, version_id: versionId, version }) => ({
      type,
      id,
      ...(versionId ? { version_id: versionId } : {}),
      ...(version ? { version } : {}),
    }));
    const existingState = conversationStates[requestKey] ?? state;
    let reusedTemporaryPrompt = false;
    const existingMessages = existingState.messages.filter((message) => {
      const matchesTemporaryPrompt = message.role === "user" && message.temporary && message.content.trim() === trimmed;
      if (!matchesTemporaryPrompt) return true;
      if (reusedTemporaryPrompt) return false;
      reusedTemporaryPrompt = true;
      return true;
    });
    updateConversation(requestKey, {
      draft: "",
      error: null,
      running: true,
      cancelling: false,
      stage: "submitting",
      runId: null,
      phase: sentContexts.length > 0 ? "正在读取所选资料…" : "正在准备…",
      referencedContextCount: sentContexts.length,
      startedAt: Date.now(),
      detailsOpen: false,
      messages: reusedTemporaryPrompt
        ? existingMessages
        : [...existingMessages, {
          sequence_no: -2,
          role: "user",
          content: trimmed,
          contexts: sentContexts,
          created_at: new Date().toISOString(),
          temporary: true,
        }],
    });
    try {
      await api.streamAgentMessage(
        session.id,
        {
          content: trimmed,
          idempotency_key: idempotencyKey(),
          ...(replyToSequenceNo !== undefined ? { reply_to_sequence_no: replyToSequenceNo } : {}),
          ...(requestContexts.length > 0 ? { contexts: requestContexts } : {}),
        },
        controller.signal,
        (event) => handleEvent(requestKey, requestNumber, event),
      );
      if (streamRequestRef.current !== requestNumber) return;
      const detail = await api.getAgentSession(session.id);
      const proposalResult = detail.session.resume_id
        ? await api.listAgentProposals(detail.session.resume_id, session.id).catch(() => ({ proposals: [] }))
        : { proposals: [] };
      if (streamRequestRef.current !== requestNumber) return;
      updateConversation(requestKey, (latest) => {
        const messages = mergeSessionMessages(detail.session.messages, latest.messages);
        const runCompleted = latest.stage !== "failed" && latest.stage !== "stopped";
        return {
          ...(runCompleted ? {
            stage: "idle" as const,
          } : {
            stage: latest.stage,
            draft: latest.draft || trimmed,
          }),
          session: detail.session,
          messages,
          proposals: proposalResult.proposals.length > 0 ? proposalResult.proposals : latest.proposals,
          running: false,
          runId: null,
          startedAt: null,
        };
      });
      setSessions((items) => items.map((item) => item.id === detail.session.id ? detail.session : item));
    } catch (error) {
      if (controller.signal.aborted || streamRequestRef.current !== requestNumber) return;
      const code = error instanceof ApiRequestError ? error.message : "";
      const invalid = code === "AGENT_CONTEXT_NOT_FOUND" || code === "AGENT_CONTEXT_STALE";
      const runStillStopping = code === "AGENT_RUN_IN_PROGRESS";
      updateConversation(requestKey, (latest) => ({
        error: runStillStopping ? null : safeAgentError(error),
        stage: runStillStopping ? "stopped" : "failed",
        running: false,
        cancelling: false,
        runId: null,
        startedAt: null,
        draft: latest.draft || trimmed,
        invalidContextIds: invalid
          ? latest.contexts.map(contextKey)
          : latest.invalidContextIds,
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (streamRequestRef.current === requestNumber) {
        updateConversation(requestKey, { running: false, runId: null, startedAt: null });
      }
    }
  };

  const submitMessage = () => {
    if (current.running || current.cancelling || !current.draft.trim()) return;
    setContextMention(null);
    void runMessage(current.draft);
  };

  const submitClarification = () => {
    if (!pendingClarification?.clarification || current.running) return;
    updateConversation(activeKey, { clarificationAttempted: true });
    const answers = current.clarificationAnswers;
    const complete = pendingClarification.clarification.questions.every((question) => {
      const answer = answers[question.id];
      const allowCustom = clarificationAllowsCustom(pendingClarification.clarification!, question);
      return Boolean(answer?.optionId && (answer.optionId !== "__other__" || (allowCustom && answer.other.trim())));
    });
    if (!complete) {
      const missingIndex = pendingClarification.clarification.questions.findIndex((question) => {
        const answer = answers[question.id];
        const allowCustom = clarificationAllowsCustom(pendingClarification.clarification!, question);
        return !answer?.optionId || (answer.optionId === "__other__" && allowCustom && !answer.other.trim());
      });
      if (missingIndex >= 0) setClarificationPage(missingIndex);
      return;
    }
    void runMessage(
      clarificationAnswerText(pendingClarification.clarification, answers),
      pendingClarification.sequence_no,
    );
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || isComposingRef.current) return;
    if (contextMention) {
      if (event.key === "Escape") {
        event.preventDefault();
        setContextMention(null);
        return;
      }
      if (!mentionLoading && !mentionError && mentionOptions.length > 0 && event.key === "ArrowDown") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index + 1) % mentionOptions.length);
        return;
      }
      if (!mentionLoading && !mentionError && mentionOptions.length > 0 && event.key === "ArrowUp") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (!mentionLoading && !mentionError && mentionOptions.length > 0 && event.key === "Tab") {
        event.preventDefault();
        selectMentionContext(mentionOptions[0]);
        return;
      }
      if (!mentionLoading && !mentionError && mentionOptions.length > 0 && event.key === "Enter") {
        event.preventDefault();
        selectMentionContext(mentionOptions[mentionActiveIndex] ?? mentionOptions[0]);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitMessage();
  };

  const stopGeneration = () => {
    void cancelCurrentRun();
  };

  const continueProposal = () => {
    pendingComposerCaretRef.current = "继续调整：".length;
    refreshComposerView("继续调整：", current.contexts, current.invalidContextIds);
    updateConversation(activeKey, { draft: "继续调整：", error: null });
    window.setTimeout(() => {
      if (!inputRef.current) return;
      placeComposerCaret(inputRef.current, "继续调整：".length);
      inputRef.current.focus();
    }, 0);
  };

  const applyProposal = async (proposal: AgentProposal) => {
    updateConversation(activeKey, { busyProposalId: proposal.id, error: null });
    try {
      await api.confirmAgentProposal(proposal.id);
      updateConversation(activeKey, (state) => ({
        proposals: state.proposals.map((item) => item.id === proposal.id ? { ...item, status: "applied" } : item),
        busyProposalId: null,
      }));
    } catch (error) {
      updateConversation(activeKey, (state) => ({
        proposals: isConflictError(error)
          ? state.proposals.map((item) => item.id === proposal.id ? { ...item, status: "conflicted" } : item)
          : state.proposals,
        busyProposalId: null,
        error: safeAgentError(error),
      }));
    }
  };

  const rejectProposal = async (proposal: AgentProposal) => {
    updateConversation(activeKey, { busyProposalId: proposal.id, error: null });
    try {
      const result = await api.rejectAgentProposal(proposal.id);
      updateConversation(activeKey, (state) => ({
        proposals: state.proposals.map((item) => item.id === proposal.id
          ? result.proposal
          : item),
        busyProposalId: null,
      }));
    } catch (error) {
      updateConversation(activeKey, { busyProposalId: null, error: safeAgentError(error) });
    }
  };

  const openNewConversationWithContext = async () => {
    const context = resumeMismatch;
    await createNewConversation();
    if (context) updateConversation(NEW_CONVERSATION_KEY, { contexts: [context] });
    setResumeMismatch(null);
  };

  const replaceSession = (updatedSession: AgentSession) => {
    setSessions((items) => sortSessions([
      updatedSession,
      ...items.filter((item) => item.id !== updatedSession.id),
    ]));
    updateConversation(updatedSession.id, { session: updatedSession });
  };

  const toggleSessionPin = async (session: AgentSession) => {
    setSessionMenuId(null);
    setSessionActionBusyId(session.id);
    setSessionsError(null);
    try {
      const result = await api.updateAgentSession(session.id, { pinned: !Boolean(session.pinned) });
      replaceSession(result.session);
    } catch (error) {
      setSessionsError(safeAgentError(error));
    } finally {
      setSessionActionBusyId(null);
    }
  };

  const beginSessionRename = (session: AgentSession) => {
    setSessionMenuId(null);
    setRenamingSessionId(session.id);
    setRenameDraft(session.title);
  };

  const saveSessionRename = async (session: AgentSession) => {
    if (renamingSessionId !== session.id) return;
    const title = renameDraft.trim();
    setRenamingSessionId(null);
    if (!title || title === session.title) return;
    setSessionActionBusyId(session.id);
    setSessionsError(null);
    try {
      const result = await api.updateAgentSession(session.id, { title });
      replaceSession(result.session);
    } catch (error) {
      setSessionsError(safeAgentError(error));
    } finally {
      setSessionActionBusyId(null);
    }
  };

  const deleteSession = async () => {
    const session = pendingDeleteSession;
    if (!session) return;
    setSessionActionBusyId(session.id);
    setSessionsError(null);
    try {
      await api.deleteAgentSession(session.id);
      setSessions((items) => items.filter((item) => item.id !== session.id));
      setConversationStates((states) => {
        const next = { ...states };
        delete next[session.id];
        return next;
      });
      setPendingDeleteSession(null);
      if (activeKeyRef.current === session.id) {
        activeKeyRef.current = NEW_CONVERSATION_KEY;
        setActiveKey(NEW_CONVERSATION_KEY);
        updateConversation(NEW_CONVERSATION_KEY, {
          ...blankConversation(),
          session: blankSession(),
        });
        navigateTo(assistantPath(), { replace: true });
      }
    } catch (error) {
      setSessionsError(safeAgentError(error));
    } finally {
      setSessionActionBusyId(null);
    }
  };

  const sidebar = (
    <aside className="assistant-sidebar" aria-label="对话列表">
      <div className="assistant-sidebar-title-row">
        <button type="button" className="assistant-mobile-close" aria-label="关闭会话菜单" onClick={() => setMobileMenuOpen(false)}>
          <X size={18} />
        </button>
      </div>
      <Button variant="outline" className="assistant-new-button" onClick={() => void createNewConversation()}>
        <Plus size={16} aria-hidden="true" />新建对话
      </Button>
      <div className="assistant-sidebar-section-title">最近对话</div>
      {sessionsLoading && <p className="assistant-sidebar-muted">正在读取对话…</p>}
      {sessionsError && (
        <div className="assistant-sidebar-error" role="alert">
          {sessionsError}
          <button type="button" onClick={() => window.location.reload()}>重试</button>
        </div>
      )}
      {!sessionsLoading && !sessionsError && sessions.length === 0 && (
        <div className="assistant-sidebar-empty">
          <span aria-hidden="true"><MessageCircleQuestion size={38} /></span>
          <p>暂无历史会话</p>
        </div>
      )}
      {!sessionsLoading && sessions.length > 0 && (
        <div className="assistant-session-list">
          {sessions.map((session, index) => {
            const isActive = session.id === activeKey;
            const isRenaming = renamingSessionId === session.id;
            const isBusy = sessionActionBusyId === session.id;
            const isRunning = Boolean(conversationStates[session.id]?.running);
            return (
              <div className={`assistant-session-item${isActive ? " is-active" : ""}`} key={session.id}>
                {isRenaming ? (
                  <form
                    className="assistant-session-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveSessionRename(session);
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={`重命名对话 ${session.title}`}
                      disabled={isBusy}
                      maxLength={120}
                      value={renameDraft}
                      onBlur={() => void saveSessionRename(session)}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRenamingSessionId(null);
                        }
                      }}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="assistant-session-open"
                    onClick={() => void selectSession(session.id)}
                    title={session.title}
                  >
                    <span>{session.title}</span>
                  </button>
                )}
                <div className="assistant-session-actions">
                  <button
                    type="button"
                    className="assistant-session-more"
                    aria-label={`${session.title} 的更多操作`}
                    aria-haspopup="menu"
                    aria-expanded={sessionMenuId === session.id}
                    disabled={isBusy || isRenaming}
                    onClick={() => setSessionMenuId((openId) => openId === session.id ? null : session.id)}
                  >
                    <MoreHorizontal size={17} aria-hidden="true" />
                  </button>
                  {sessionMenuId === session.id && (
                    <div
                      className={`assistant-session-menu${index >= sessions.length - 2 ? " is-above" : ""}`}
                      role="menu"
                      aria-label={`${session.title} 的操作菜单`}
                    >
                      <button type="button" role="menuitem" onClick={() => void toggleSessionPin(session)}>
                        <Pin size={16} aria-hidden="true" />
                        <span>{session.pinned ? "Unpin" : "Pin"}</span>
                      </button>
                      <button type="button" role="menuitem" onClick={() => beginSessionRename(session)}>
                        <Pencil size={16} aria-hidden="true" />
                        <span>Rename</span>
                      </button>
                      <div className="assistant-session-menu-separator" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        disabled={isRunning}
                        title={isRunning ? "请先停止正在生成的回答" : undefined}
                        onClick={() => {
                          setSessionMenuId(null);
                          setPendingDeleteSession(session);
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );

  return (
    <main className="assistant-page">
      <div className="assistant-shell">
        {sidebar}
        <section className={`assistant-conversation${isEmptyConversation ? " is-empty" : ""}`} aria-label="AI 求职助手工作区">
          <header className="assistant-mobile-toolbar">
            <button
              type="button"
              className="assistant-icon-button assistant-mobile-menu-button"
              aria-label="打开会话菜单"
              aria-expanded={mobileMenuOpen}
              ref={mobileMenuButtonRef}
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu size={20} />
            </button>
          </header>

          <button
            type="button"
            className="assistant-recall-drawer-toggle"
            aria-label={recallDrawerOpen ? "收起对话资料" : "展开对话资料"}
            aria-expanded={recallDrawerOpen}
            aria-controls="assistant-recall-drawer"
            onClick={() => setRecallDrawerOpen((open) => !open)}
          >
            {recallDrawerOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          <div
            className="assistant-message-viewport"
            ref={messageViewportRef}
            onScroll={handleMessageViewportScroll}
            aria-live={current.running ? "off" : "polite"}
          >
            {!isEmptyConversation && conversationStateHeading && (
              <header className="assistant-state-header">
                <h1>{conversationStateHeading[0]}</h1>
                <p>{conversationStateHeading[1]}</p>
              </header>
            )}
            {isEmptyConversation && (
              <section className="assistant-empty-state" aria-label="开始使用 AI 求职助手">
                <img className="assistant-empty-feather" src={assistantFeather} alt="" />
                <h2>你好，今天想完成什么？</h2>
              </section>
            )}
            {current.messages.filter((message) => message !== pendingClarification).map((message, index) => (
              <article
                key={`${message.sequence_no}-${message.created_at}-${index}`}
                className={`assistant-message is-${message.role}${message.status ? ` is-${message.status}` : ""}`}
              >
                {message.role === "assistant" && (
                  <span
                    className="assistant-feather-motion"
                    aria-hidden="true"
                  />
                )}
                <div className="assistant-message-body">
                  <div className="assistant-message-content">
                    <AgentMarkdown content={messageText(message)} />
                  </div>
                  {message.contexts && message.contexts.length > 0 && (
                    <div className="assistant-message-contexts" aria-label="本轮引用资料">
                      {message.contexts.map((context) => <span key={contextKey(context)}>{context.label}</span>)}
                    </div>
                  )}
                  {message.status === "stopped" && <small className="assistant-stopped-label">已停止生成</small>}
                  {message.status === "failed" && <small className="assistant-stopped-label">生成未完成</small>}
                  <time className="visually-hidden" dateTime={message.created_at}>{formatTime(message.created_at)}</time>
                </div>
              </article>
            ))}
            {current.running && current.stage !== "streaming" && (
              <section className="assistant-thinking" aria-label="AI 正在思考" aria-live="polite">
                <span
                  className="assistant-feather-motion is-writing"
                  aria-hidden="true"
                >
                  <svg className="assistant-writing-ink" viewBox="0 0 56 44" focusable="false">
                    <path pathLength="1" d="M 3 34 C 10 33 16 31 22 27 C 27 24 30 19 28 15 C 27 11 22 12 20 17 C 17 23 20 29 26 30 C 32 31 35 26 40 28 C 44 31 48 28 53 25" />
                  </svg>
                  <img className="assistant-message-feather" src={assistantFeather} alt="" />
                </span>
                <div className="assistant-thinking-line">
                  <strong>{current.phase || "AI 正在处理…"}</strong>
                  <span>{elapsedSeconds} 秒</span>
                </div>
                {detailsReady && (
                  <>
                    <button type="button" className="assistant-thinking-details-toggle" onClick={() => updateConversation(activeKey, { detailsOpen: !current.detailsOpen })}>
                      {current.detailsOpen ? "收起详情" : "查看详情"}
                      {current.detailsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    {current.detailsOpen && (
                      <div className="assistant-thinking-details">
                        <div><Check size={16} aria-hidden="true" /><strong>已读取 {current.referencedContextCount} 项资料</strong></div>
                        {current.contexts.slice(0, 10).map((context) => <span key={contextKey(context)}>{context.label}</span>)}
                        <div className="assistant-thinking-current"><Target size={16} aria-hidden="true" /><span>{PHASE_LABELS.comparing_context === current.phase ? current.phase : "AI 正在处理…"}</span></div>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </div>

          {recallDrawerOpen && (
            <aside id="assistant-recall-drawer" className="assistant-context-panel" aria-label="最新一轮对话的引用资料与修改内容">
              <section className="assistant-context-panel-section">
                <button
                  type="button"
                  className="assistant-context-panel-trigger"
                  aria-label={recallReferencesOpen ? "收起引用资料" : "展开引用资料"}
                  aria-expanded={recallReferencesOpen}
                  aria-controls="assistant-recall-references"
                  onClick={() => setRecallReferencesOpen((open) => !open)}
                >
                  <strong>引用资料</strong>
                  <span>{latestTurnContexts.length === 0 ? "0 个文件" : `${latestTurnContexts.length} 项`}<ChevronRight size={15} aria-hidden="true" /></span>
                </button>
                <div id="assistant-recall-references" className="assistant-context-panel-content" hidden={!recallReferencesOpen}>
                  <div className="assistant-context-panel-list">
                    {latestTurnContexts.length === 0 && <span className="is-muted">本轮没有引用资料</span>}
                    {latestTurnContexts.map((context) => (
                      <div key={contextKey(context)}><span>{context.label}</span></div>
                    ))}
                  </div>
                </div>
              </section>
              <section className="assistant-context-panel-section">
                <button
                  type="button"
                  className="assistant-context-panel-trigger"
                  aria-label={recallModificationsOpen ? "收起修改内容" : "展开修改内容"}
                  aria-expanded={recallModificationsOpen}
                  aria-controls="assistant-recall-modifications"
                  onClick={() => setRecallModificationsOpen((open) => !open)}
                >
                  <strong>修改内容</strong>
                  <span>{latestTurnProposal ? "1 个文件" : "0 个文件"}<ChevronRight size={15} aria-hidden="true" /></span>
                </button>
                <div id="assistant-recall-modifications" className="assistant-context-panel-content" hidden={!recallModificationsOpen}>
                  <div className="assistant-context-panel-modification">
                    {latestTurnProposal ? (
                      <div>
                        <span>{proposalResumeLabel(current, latestTurnProposal.resume_id)}</span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </div>
                    ) : <span className="is-muted">本轮没有修改内容</span>}
                  </div>
                </div>
              </section>
            </aside>
          )}

          {current.proposals.length > 0 && (
            <div className="assistant-proposal-list" aria-label="待确认简历修改提案">
              {current.proposals.map((proposal) => {
                const changes = proposal.operations?.length
                  ? proposal.operations.map((operation) => ({
                    before: typeof operation.target.selected_text === "string"
                      ? operation.target.selected_text
                      : "当前定位内容",
                    after: operation.new_text,
                  }))
                  : [{ before: "当前简历快照", after: "候选简历快照" }];
                const actionable = proposal.status === "pending";
                return (
                  <article className={`assistant-proposal-card is-${proposal.status}`} key={proposal.id}>
                    <header>
                      <div><FileText size={17} aria-hidden="true" /><strong>简历修改提案</strong><span>{actionable ? "等待确认" : proposal.status === "applied" ? "已应用" : proposal.status === "rejected" ? "已放弃" : "无法应用"}</span></div>
                      <small>基于版本 {proposal.base_lock_version}</small>
                    </header>
                    <dl className="assistant-proposal-meta">
                      <div><dt>目标简历</dt><dd>{proposalResumeLabel(current, proposal.resume_id)}</dd></div>
                      <div><dt>修改理由</dt><dd>{proposal.summary}</dd></div>
                    </dl>
                    <div className="assistant-proposal-diff">
                      {changes.map((change, index) => (
                        <div className="assistant-proposal-change" key={`${proposal.id}-${index}`}>
                          <div><span className="is-deleted">修改前</span><del>{change.before}</del></div>
                          <div><span className="is-added">修改后</span><ins>{change.after}</ins></div>
                        </div>
                      ))}
                    </div>
                    {actionable && (
                      <div className="assistant-proposal-actions">
                        <Button variant="accent" size="sm" disabled={current.busyProposalId !== null || current.running} onClick={() => void applyProposal(proposal)}>
                          {current.busyProposalId === proposal.id ? "处理中…" : "应用修改"}
                        </Button>
                        <Button variant="outline" size="sm" disabled={current.busyProposalId !== null} onClick={continueProposal}>继续调整</Button>
                        <Button variant="ghost" size="sm" disabled={current.busyProposalId !== null} onClick={() => void rejectProposal(proposal)}>放弃</Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {resumeMismatch && (
            <div className="assistant-mismatch-notice" role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              <span>已绑定简历的对话不能切换目标简历。</span>
              <button type="button" onClick={() => void openNewConversationWithContext()}>新建对话使用此简历</button>
            </div>
          )}
          {current.error && <div className="assistant-error-notice" role="alert"><CircleAlert size={17} aria-hidden="true" />{current.error}</div>}

          <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
            {pendingClarification?.clarification && (
              <section className={`assistant-clarification${current.clarificationCollapsed ? " is-collapsed" : ""}`} aria-label="需要你确认">
                {current.clarificationCollapsed ? (
                  <button
                    type="button"
                    className="assistant-clarification-summary"
                    aria-expanded="false"
                    aria-label="展开主动询问"
                    onClick={() => updateConversation(activeKey, { clarificationCollapsed: false })}
                  >
                    <span>
                      <strong>需要你确认</strong>
                      <small>{clarificationQuestion?.header ?? "补充关键信息"} · {clarificationPage + 1} / {clarificationQuestions.length}</small>
                    </span>
                    <ChevronUp size={18} aria-hidden="true" />
                  </button>
                ) : (
                  <>
                    <header>
                      <span><strong>需要你确认</strong><small>{clarificationPage + 1} / {clarificationQuestions.length}</small></span>
                      <button
                        type="button"
                        className="assistant-clarification-toggle"
                        aria-expanded="true"
                        aria-label="收起主动询问"
                        onClick={() => updateConversation(activeKey, { clarificationCollapsed: true })}
                      >
                        <ChevronDown size={18} aria-hidden="true" />
                      </button>
                    </header>
                    <div className="assistant-clarification-questions">
                  {clarificationQuestion && [clarificationQuestion].map((question) => {
                    const answer = current.clarificationAnswers[question.id] ?? { optionId: "", other: "" };
                    const allowCustom = clarificationAllowsCustom(pendingClarification.clarification!, question);
                    const missing = current.clarificationAttempted && (!answer.optionId || (answer.optionId === "__other__" && allowCustom && !answer.other.trim()));
                    return (
                      <fieldset key={question.id} aria-describedby={missing ? `${question.id}-error` : undefined}>
                        <legend><span>{question.header}</span>{question.question}</legend>
                      {question.options.map((option) => (
                        <label key={option.id}>
                          <input
                            type="radio"
                            name={`assistant-clarification-${question.id}`}
                            value={option.id}
                            checked={answer.optionId === option.id}
                            onChange={() => updateConversation(activeKey, (state) => ({
                              clarificationAnswers: {
                                ...state.clarificationAnswers,
                                [question.id]: { optionId: option.id, other: "" },
                              },
                            }))}
                          />
                          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                        </label>
                      ))}
                      {allowCustom && (
                        <label className="assistant-clarification-other-option">
                          <input
                            type="radio"
                            name={`assistant-clarification-${question.id}`}
                            value="__other__"
                            checked={answer.optionId === "__other__"}
                            onChange={() => updateConversation(activeKey, (state) => ({
                              clarificationAnswers: {
                                ...state.clarificationAnswers,
                                [question.id]: { optionId: "__other__", other: state.clarificationAnswers[question.id]?.other ?? "" },
                              },
                            }))}
                          />
                          <span className="assistant-clarification-other-copy">
                            <strong>其他</strong>
                          </span>
                          <input
                            className="assistant-clarification-other"
                            aria-label={`${question.header}的其他回答`}
                            maxLength={500}
                            placeholder="请输入补充内容"
                            value={answer.other}
                            onFocus={() => updateConversation(activeKey, (state) => ({
                              clarificationAnswers: {
                                ...state.clarificationAnswers,
                                [question.id]: { optionId: "__other__", other: state.clarificationAnswers[question.id]?.other ?? "" },
                              },
                            }))}
                            onChange={(event) => updateConversation(activeKey, (state) => ({
                              clarificationAnswers: {
                                ...state.clarificationAnswers,
                                [question.id]: { optionId: "__other__", other: event.target.value },
                              },
                            }))}
                          />
                        </label>
                      )}
                        {missing && <small className="assistant-clarification-error" id={`${question.id}-error`}>请选择一个选项或填写其他答案。</small>}
                      </fieldset>
                    );
                  })}
                    </div>
                    <footer>
                      <Button type="button" variant="ghost" size="sm" disabled={clarificationPage === 0} onClick={() => setClarificationPage((page) => Math.max(0, page - 1))}>
                        <ChevronLeft size={15} />上一题
                      </Button>
                      {clarificationPage < clarificationQuestions.length - 1 ? (
                        <Button type="button" variant="accent" size="sm" onClick={() => setClarificationPage((page) => Math.min(clarificationQuestions.length - 1, page + 1))}>
                          下一题<ChevronRight size={15} />
                        </Button>
                      ) : (
                        <Button type="button" variant="accent" size="sm" disabled={current.running} onClick={submitClarification}>提交回答</Button>
                      )}
                    </footer>
                  </>
                )}
              </section>
            )}
            <div className="assistant-composer-context-row">
              <button type="button" className="assistant-add-context" onClick={openContextPicker}>
                <Plus size={15} aria-hidden="true" />添加资料
              </button>
              <div ref={modelSelectorRef} className="assistant-model-selector">
                <button type="button" aria-haspopup="menu" aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen((open) => !open)}>
                  <span title={runtimeModel?.name}>{runtimeModelLabel}</span><ChevronDown size={14} />
                </button>
                {modelMenuOpen && (
                  <div role="menu" className="assistant-model-menu">
                    <button type="button" role="menuitemradio" aria-checked="true" disabled={!runtimeModel} onClick={() => setModelMenuOpen(false)}><span><strong>{runtimeModelLabel}</strong><small>{runtimeModel ? `${runtimeModel.adapter} · 当前模型` : "当前模型暂时不可用"}</small></span>{runtimeModel && <Check size={16} />}</button>
                  </div>
                )}
              </div>
            </div>
            <div className="assistant-input-shell">
              {!isEmptyConversation && <button type="button" className="assistant-input-add" aria-label="添加资料" onClick={openContextPicker}><Plus size={20} /></button>}
              {contextMention && (
                <div ref={mentionMenuRef} id="assistant-context-mention-list" className="assistant-context-mention-menu" role="listbox" aria-label="可引用的资料和简历">
                  <header>
                    <strong>{contextMention.token ? `@${contextMention.token}` : "选择资料或简历"}</strong>
                    <span>Tab 选择第一项</span>
                  </header>
                  {mentionLoading && <p>正在搜索…</p>}
                  {mentionError && <p role="alert">{mentionError}</p>}
                  {!mentionLoading && !mentionError && mentionOptions.length === 0 && <p>没有匹配的文件</p>}
                  {!mentionLoading && !mentionError && (["resume", "dataset"] as const).map((type) => {
                    const groupedOptions = mentionOptions
                      .map((context, index) => ({ context, index }))
                      .filter(({ context }) => context.type === type);
                    if (groupedOptions.length === 0) return null;
                    return (
                      <div key={type} className="assistant-context-mention-group" role="group" aria-label={type === "resume" ? "简历" : "资料"}>
                        <div className="assistant-context-mention-group-label">{type === "resume" ? "简历" : "资料"}</div>
                        {groupedOptions.map(({ context, index }) => (
                          <button
                            type="button"
                            id={`assistant-context-mention-option-${index}`}
                            role="option"
                            aria-selected={mentionActiveIndex === index}
                            className={mentionActiveIndex === index ? "is-active" : undefined}
                            key={contextKey(context)}
                            onMouseEnter={() => setMentionActiveIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectMentionContext(context)}
                          >
                            <ContextSourceIcon type={context.type} size={16} />
                            <span><strong>{context.label}</strong></span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              <div
                key={`${activeKey}:${composerView.revision}`}
                ref={inputRef}
                className="assistant-composer-editor"
                role="textbox"
                aria-multiline="true"
                aria-label="告诉助手你想完成什么"
                data-placeholder={current.messages.length > 0 ? "继续提问或说明调整要求…" : "告诉我你想完成什么…"}
                aria-autocomplete="list"
                aria-controls={contextMention ? "assistant-context-mention-list" : undefined}
                aria-expanded={Boolean(contextMention)}
                aria-activedescendant={contextMention && mentionOptions.length > 0 ? `assistant-context-mention-option-${mentionActiveIndex}` : undefined}
                aria-disabled={current.running || current.cancelling || Boolean(pendingClarification)}
                contentEditable={!(current.running || current.cancelling || Boolean(pendingClarification))}
                suppressContentEditableWarning
                onInput={(event) => {
                  const editor = event.currentTarget;
                  const nextDraft = composerValue(editor);
                  const caret = composerCaretOffset(editor);
                  const retainedContextKeys = new Set(
                    Array.from(editor.querySelectorAll<HTMLElement>("[data-context-key]"))
                      .map((element) => element.dataset.contextKey)
                      .filter((key): key is string => Boolean(key)),
                  );
                  pendingComposerCaretRef.current = caret;
                  updateConversation(activeKey, (state) => ({
                    draft: nextDraft,
                    contexts: state.contexts.filter((context) => retainedContextKeys.has(contextKey(context))),
                    invalidContextIds: state.invalidContextIds.filter((id) => retainedContextKeys.has(id)),
                  }));
                  setContextMention(contextMentionAt(nextDraft, caret));
                }}
                onKeyDown={handleInputKeyDown}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
              >
                {composerSegments(composerView.draft, composerView.contexts).map((segment) => segment.kind === "text" ? segment.text : (
                  <span
                    key={segment.key}
                    className={`assistant-composer-context-token${composerView.invalidContextIds.includes(contextKey(segment.context)) ? " is-invalid" : ""}`}
                    contentEditable={false}
                    data-context-key={contextKey(segment.context)}
                    data-context-value={`@${segment.context.label}`}
                    aria-label={`引用文件 ${segment.context.label}`}
                  >
                    <ContextSourceIcon type={segment.context.type} size={14} />
                    <span>{segment.context.label}</span>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`移除上下文 ${segment.context.label}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => removeContext(segment.context)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
              {current.running ? (
                <button type="button" className="assistant-send-button is-stop" aria-label="停止生成" onClick={stopGeneration}>
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button type="submit" className="assistant-send-button" aria-label="发送" disabled={current.cancelling || !current.draft.trim() || Boolean(pendingClarification)}>
                  <ArrowUp size={18} strokeWidth={2.2} />
                </button>
              )}
            </div>
          </form>
        </section>
      </div>

      {mobileMenuOpen && (
        <div className="assistant-mobile-menu-layer" role="presentation">
          <button type="button" className="assistant-mobile-menu-scrim" aria-label="关闭会话菜单" onClick={() => setMobileMenuOpen(false)} />
          <div className="assistant-mobile-menu" role="dialog" aria-modal="true" aria-label="会话列表">
            {sidebar}
          </div>
        </div>
      )}

      {pendingDeleteSession && (
        <ConfirmDialog
          kind="delete"
          title="删除这条对话？"
          description={`“${pendingDeleteSession.title}”及其中的全部消息将被永久删除，此操作无法撤销。`}
          confirmLabel="删除"
          busyLabel="正在删除…"
          busy={sessionActionBusyId === pendingDeleteSession.id}
          onCancel={() => setPendingDeleteSession(null)}
          onConfirm={deleteSession}
        />
      )}

      {contextPickerOpen && (
        <div className="assistant-context-picker-layer" role="presentation">
          <button type="button" className="assistant-mobile-menu-scrim" aria-label="关闭资料选择器" onClick={closeContextPicker} />
          <section className="assistant-context-picker" role="dialog" aria-modal="true" aria-label="选择资料">
            <header>
              <div><h2>添加资料</h2><p>选择本轮对话需要参考的内容，每类最多一项</p></div>
              <button ref={contextCloseButtonRef} type="button" className="assistant-icon-button" aria-label="关闭资料选择器" onClick={closeContextPicker}><X size={18} /></button>
            </header>
            <div className="assistant-context-type-list" role="tablist" aria-label="上下文类型">
              {CONTEXT_TYPES.map(({ type, label, icon: Icon }) => (
                <button type="button" role="tab" aria-selected={contextType === type} className={contextType === type ? "is-active" : undefined} key={type} onClick={() => void loadContexts(type)}>
                  <Icon size={15} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            <label className="assistant-context-search">
              <span className="visually-hidden">搜索资料</span>
              <Search size={17} aria-hidden="true" />
              <input value={contextSearch} placeholder="搜索资料" onChange={(event) => setContextSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadContexts(contextType, contextSearch); }} />
            </label>
            {contextLoading && <p className="assistant-context-status">正在读取可选资料…</p>}
            {contextError && <p className="assistant-context-error" role="alert">{contextError}</p>}
            {!contextLoading && !contextError && contextOptions.length === 0 && <p className="assistant-context-status">暂无可选择的{contextLabel(contextType)}。</p>}
            {!contextLoading && !contextError && contextOptions.length > 0 && (
              <div className="assistant-context-option-list">
                {contextOptions.map((context) => (
                  <button type="button" className={contextDrafts.some((item) => contextKey(item) === contextKey(context)) ? "is-selected" : undefined} aria-pressed={contextDrafts.some((item) => contextKey(item) === contextKey(context))} key={contextKey(context)} onClick={() => toggleContextDraft(context)}>
                    <span><strong>{context.label}</strong>{context.description && <small>{context.description}</small>}</span>
                    {contextDrafts.some((item) => contextKey(item) === contextKey(context)) ? <Check size={18} aria-label="已选择" /> : <time dateTime={context.updated_at ?? undefined}>{formatConversationDate(context.updated_at)}</time>}
                  </button>
                ))}
              </div>
            )}
            <footer className="assistant-context-picker-actions">
              <Button type="button" variant="ghost" onClick={closeContextPicker}>取消</Button>
              <Button type="button" variant="accent" onClick={confirmContextDrafts}>添加 {contextDrafts.length} 项</Button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
