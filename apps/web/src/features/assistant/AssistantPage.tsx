import { MotionPresence } from "@/components/ui/motion";
import { PageLoading } from "@/components/ui/page-loading";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type CSSProperties,
} from "react";

import {
  AgentMarkdown,
  agentErrorMessage,
  clarificationAllowsCustom,
  clarificationAnswerText,
  clarificationAnswerPayload,
  pendingClarificationMessage,
  type ClarificationAnswer,
} from "../agent/AgentPanel";
import {
  AgentActiveRun,
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
import {
  assistantPath,
  careerViewPath,
  datasetsPath,
  navigateTo,
  rememberAssistantSession,
  type AssistantWorkspaceSection,
} from "../../routing";
import { useResumeStore } from "../../store/resumeStore";
import { V3Shell } from "../../v3/Shell";
import { Icon, type V3IconName } from "../../v3/Icon";
import { BeTag, Dialog, DialogFooter, SearchBox, Toast } from "../../v3/primitives";
import { useActiveSessionStore, useSessionStore } from "../../v3/sessionStore";
import { MOCK_PREP_CHECKLIST } from "../../v3/mocks";
import assistantFeather from "./assistant-assets/assistant-feather.png";
import { MessageActions } from "../agent/MessageActions";
import { HomeCardView } from "./HomeCards";
import { greetingPrefix, homeCopy, useHomeDashboard } from "./homeDashboard";
import { ModelPicker } from "./ModelPicker";
import { openPreviewTab, PreviewPanel, previewTabKey, type PreviewTab, type GeneratedDocument, type ScreenshotAttachment } from "./PreviewPanel";
import { createLocalDocument, GeneratedDocumentCard, isLocalDocumentRequest, ScreenshotStrip } from "./localArtifacts";
import { SuggestionCard } from "./SuggestionCard";
import "./assistant.css";

const NEW_CONVERSATION_KEY = "__assistant_new__";
const CONTEXT_TYPES: Array<{ type: AgentContextType; label: string; icon: V3IconName }> = [
  { type: "resume", label: "当前简历", icon: "resume" },
  { type: "dataset", label: "资料", icon: "folder" },
  { type: "job", label: "岗位", icon: "brief" },
  { type: "application", label: "求职进程", icon: "flag" },
  { type: "interview", label: "面试记录", icon: "cal" },
];

const PHASE_LABELS: Record<string, string> = {
  loading_context: "正在读取所选资料…",
  comparing_context: "正在对比岗位 JD 与项目经历…",
  drafting: "正在整理建议…",
};

const MESSAGE_FOLLOW_THRESHOLD = 96;

// V3 不再在助手里嵌其他模块：旧的 /assistant/workspace/... 直接跳到独立页面
function workspaceRedirectPath(section: AssistantWorkspaceSection, careerView?: "applications" | "schedule") {
  if (section === "resumes") return "/resumes";
  if (section === "templates") return "/templates";
  if (section === "datasets") return datasetsPath();
  return careerViewPath(careerView === "schedule" ? "schedule" : "applications");
}

type LocalMessage = AgentMessage & {
  screenshots?: ScreenshotAttachment[];
  generatedDocument?: GeneratedDocument;
  artifactFollowup?: string;
  localOnly?: boolean;
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

function insertComposerPlainText(element: HTMLElement, text: string) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const insertionRange = range && element.contains(range.commonAncestorContainer)
    ? range
    : document.createRange();
  if (!range || !element.contains(range.commonAncestorContainer)) {
    insertionRange.selectNodeContents(element);
    insertionRange.collapse(false);
  }
  insertionRange.deleteContents();
  const textNode = document.createTextNode(text);
  insertionRange.insertNode(textNode);
  insertionRange.setStartAfter(textNode);
  insertionRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(insertionRange);
}

type ConversationState = {
  loadState: "loading" | "ready" | "error";
  screenshots?: ScreenshotAttachment[];
  revisionProposalId?: string;
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
  activityText: string;
  activities: Array<{
    callKey: string;
    label: string;
    status: "running" | "succeeded" | "failed";
    errorCode?: string;
  }>;
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

type ProposalBatchProgress = {
  viewKey: string;
  completed: number;
  total: number;
} | null;

function blankSession(): AgentSession {
  const timestamp = new Date().toISOString();
  return {
    id: NEW_CONVERSATION_KEY,
    selected_model_id: null,
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
    loadState: "ready",
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
    activityText: "",
    activities: [],
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

function contextKey(context: Pick<AgentContextRef, "type" | "id">) {
  return `${context.type}:${context.id}`;
}

// 输入框上方的简历小标签：从「添加资料」选的简历（正文里没有 @简历名），234:2 ④
function isChipContext(context: AgentContextSnapshot, draft: string) {
  return (context.type === "resume" || context.type === "resume_version") && !draft.includes(`@${context.label}`);
}

// AI 回答里提到本会话引用过的文件时，改写成特殊链接，渲染成可点击的蓝色文字（代码块里不改）
const REF_HREF_PREFIX = "#linkresume-ref:";
function linkContextMentions(content: string, contexts: AgentContextSnapshot[]) {
  const targets = contexts.filter((context) => context.label.trim().length >= 2 && previewTabForContext(context));
  if (targets.length === 0) return content;
  return content.split(/(```[\s\S]*?```|`[^`\n]*`)/u).map((part, index) => {
    if (index % 2 === 1) return part;
    let next = part;
    for (const context of [...targets].sort((left, right) => right.label.length - left.label.length)) {
      const label = context.label.replace(/[[\]]/gu, "");
      const href = `${REF_HREF_PREFIX}${encodeURIComponent(context.type)}:${encodeURIComponent(context.resume_id ?? context.id)}`;
      next = next.split(context.label).join(`[${label}](${href})`);
    }
    return next;
  }).join("");
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

function contextIcon(type: AgentContextType): V3IconName {
  return type === "resume" || type === "resume_version" ? "resume" : type === "dataset" ? "doc" : CONTEXT_TYPES.find((item) => item.type === type)?.icon ?? "doc";
}

// 可以在右侧面板预览的引用：简历和资料库文件
export function previewTabForContext(context: AgentContextSnapshot): PreviewTab | null {
  if (context.type === "resume" || context.type === "resume_version") {
    return { kind: "resume", id: context.resume_id ?? context.id, label: context.label };
  }
  if (context.type === "dataset") return { kind: "dataset", id: context.id, label: context.label };
  return null;
}

// 已发送的用户消息（234:2）：简历 = 气泡上方的小标签；@ 引用的文件 = 气泡里的蓝色文字，点击在右侧预览
function UserMessageContent({
  content,
  contexts,
  activePreviewKey,
  unavailableKeys,
  onOpen,
}: {
  content: string;
  contexts: AgentContextSnapshot[];
  activePreviewKey: string | null;
  unavailableKeys: string[];
  onOpen: (context: AgentContextSnapshot) => void;
}) {
  const visibleContexts = contexts.filter((context) => context.presentation !== "implicit");
  const attachedResumes = visibleContexts.filter((context) => (context.type === "resume" || context.type === "resume_version") && !content.includes(`@${context.label}`));
  const inlineContexts = visibleContexts.filter((context) => !attachedResumes.includes(context));
  const isUnavailable = (context: AgentContextSnapshot) => { const tab = previewTabForContext(context); return Boolean(tab && unavailableKeys.includes(previewTabKey(tab))); };
  const isActive = (context: AgentContextSnapshot) => {
    const tab = previewTabForContext(context);
    return Boolean(tab && previewTabKey(tab) === activePreviewKey);
  };
  return (
    <>
      {attachedResumes.length > 0 && (
        <div className="assistant-sent-attachments">
          {attachedResumes.map((context) => (
            <button
              type="button"
              key={contextKey(context)}
              className={`assistant-resume-chip${isActive(context) ? " is-active" : ""}`}
              aria-label={`引用文件 ${context.label}`}
              disabled={isUnavailable(context)}
              onClick={() => onOpen(context)}
            >
              <Icon name="resume" size={12} />
              <span>{context.label}</span>
              <small>简历</small>
            </button>
          ))}
        </div>
      )}
      <div className="assistant-message-content">
        <div className="assistant-user-message-content">
          {composerSegments(content, inlineContexts).map((segment) => segment.kind === "text" ? segment.text : (
            <button
              type="button"
              className={`assistant-message-context-token${isActive(segment.context) ? " is-active" : ""}`}
              key={segment.key}
              data-context-type={segment.context.type}
              aria-label={`引用文件 ${segment.context.label}`}
              disabled={!previewTabForContext(segment.context) || isUnavailable(segment.context)}
              onClick={() => onOpen(segment.context)}
            >
              {segment.context.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
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

export function parseAgentTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatTime(value: string | null | undefined) {
  const timestamp = parseAgentTimestamp(value);
  if (timestamp === null) return "";
  const date = new Date(timestamp);
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
    presentation: item.presentation === "implicit" ? "implicit" : "mention",
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
    AGENT_CLARIFICATION_CONTEXT_CONFLICT: "这次回答选择了另一份资料，请继续使用原问题对应的资料。",
    AGENT_CLARIFICATION_CONTEXT_INVALID: "原问题的资料记录已损坏，请重新发起请求。",
    AGENT_SESSION_NOT_FOUND: "对话不存在或已无法访问。",
    AGENT_UNAVAILABLE: "智能助手暂时不可用，草稿和已选资料不会丢失。",
    AGENT_MODEL_UNAVAILABLE: "当前模型暂时不可用，请稍后重试。",
    AGENT_STREAM_INCOMPLETE: "智能助手连接意外中断，请稍后重试。",
    RESUME_EDIT_CONFLICT: "简历已发生新的修改，这份提案没有应用。",
    TARGET_STALE: "提案定位内容已发生变化，请重新定位后再试。",
    AGENT_PROPOSAL_EXPIRED: "这份提案已过期，请重新生成建议。",
    AGENT_PROPOSAL_NOT_PENDING: "这份提案已经处理过，不能重复应用。",
    RESUME_DRAFT_SAVE_FAILED: "当前草稿保存失败，提案没有应用。请先保存后重试。",
    RESUME_WRITE_PENDING: "正在保存或应用修改，请稍后重试。",
    AGENT_PROPOSAL_RESULT_UNKNOWN: "暂时无法确认修改结果，请刷新提案状态后再操作。",
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
  const localMessages = current.filter((message) => message.localOnly);
  const persistedAssistant = persisted.some((message) => message.role === "assistant");
  const partialAssistant = persistedAssistant ? [] : current.filter((message) => !message.localOnly && message.role === "assistant" && message.sequence_no < 0);
  return [...persisted, ...partialAssistant, ...localMessages].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

type AssistantPageProps = {
  sessionId?: string;
  workspaceSection?: AssistantWorkspaceSection;
  careerView?: "applications" | "schedule";
};

export function AssistantPage({ sessionId, workspaceSection, careerView }: AssistantPageProps = {}) {
  const [conversationStates, setConversationStates] = useState<Record<string, ConversationState>>(() => ({
    [NEW_CONVERSATION_KEY]: blankConversation(),
  }));
  const [activeKey, setActiveKey] = useState(NEW_CONVERSATION_KEY);
  const [runtimeModel, setRuntimeModel] = useState<AgentModelSummary | null>(null);
  const [runtimeModels, setRuntimeModels] = useState<AgentModelSummary[]>([]);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [runtimeModelLoading, setRuntimeModelLoading] = useState(true);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextType, setContextType] = useState<AgentContextType>("resume");
  const [contextOptions, setContextOptions] = useState<AgentContextSnapshot[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextSearch, setContextSearch] = useState("");
  const [contextDrafts, setContextDrafts] = useState<AgentContextSnapshot[]>([]);
  const [clarificationPage, setClarificationPage] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [contextMention, setContextMention] = useState<ContextMention | null>(null);
  const [mentionOptions, setMentionOptions] = useState<AgentContextSnapshot[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  // 右侧预览面板：按会话保留已打开的标签（本会话内保留，切会话时各自独立）
  const [previewTabs, setPreviewTabs] = useState<Record<string, PreviewTab[]>>({});
  const [previewActive, setPreviewActive] = useState<Record<string, string | null>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(520);
  const [unavailableKeys, setUnavailableKeys] = useState<string[]>([]);
  const [prepStates, setPrepStates] = useState<Record<string, boolean[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [composerView, setComposerView] = useState(() => ({
    revision: 0,
    draft: "",
    contexts: [] as AgentContextSnapshot[],
    invalidContextIds: [] as string[],
  }));
  const user = useResumeStore((state) => state.user);
  const storeSessions = useSessionStore((state) => state.sessions);
  const loadSessions = useSessionStore((state) => state.load);
  const upsertSession = useSessionStore((state) => state.upsert);
  const promoteStoreSession = useSessionStore((state) => state.promote);
  const setSessionRunning = useSessionStore((state) => state.setRunning);
  const setActiveSession = useActiveSessionStore((state) => state.setActive);
  // 只更新会话内容、不改变列表顺序（打开历史会话、生成结束后刷新详情时用）
  const replaceStoreSession = useCallback((updated: AgentSession) => {
    useSessionStore.setState((state) => ({
      sessions: state.sessions.some((item) => item.id === updated.id)
        ? state.sessions.map((item) => item.id === updated.id ? updated : item)
        : state.sessions,
    }));
  }, []);
  const streamRequestRef = useRef(0);
  const sessionRequestRef = useRef(0);
  const pageMountedRef = useRef(true);
  const mentionRequestRef = useRef(0);
  const activeKeyRef = useRef(activeKey);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const pendingComposerCaretRef = useRef<number | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const followMessagesRef = useRef(true);
  const isComposingRef = useRef(false);
  activeKeyRef.current = activeKey;

  const conversationStatesRef = useRef(conversationStates);
  conversationStatesRef.current = conversationStates;
  const current = conversationStates[activeKey] ?? conversationStates[NEW_CONVERSATION_KEY] ?? blankConversation();
  const [proposalViews, setProposalViews] = useState<Record<string, { id?: string }>>({});
  const [proposalBatchProgress, setProposalBatchProgress] = useState<ProposalBatchProgress>(null);
  const turnUsers = current.messages.filter((item) => item.role === "user");
  const proposalGroup = (proposal: AgentProposal) => {
    const owner = turnUsers.find((item) => item.run_id === proposal.run_id)
      ?? [...turnUsers].reverse().find((item) => !item.run_id && new Date(item.created_at).getTime() <= new Date(proposal.created_at).getTime());
    return owner ? String(owner.sequence_no) : `history-${proposal.run_id}`;
  };
  const newestGroup = String(turnUsers.slice(-1)[0]?.sequence_no ?? "none");
  // 多项修改建议卡：同一轮提问产生的全部提案合并在一张卡里
  const proposalPanel = (group: string) => {
    const proposals = current.proposals.filter((item) => proposalGroup(item) === group);
    if (!proposals.length) return null;
    const viewKey = `${activeKey}:${group}`;
    const batch = proposalBatchProgress?.viewKey === viewKey ? proposalBatchProgress : null;
    return (
      <SuggestionCard
        key={viewKey}
        proposals={proposals}
        resumeLabel={proposalResumeLabel(current, proposals[0].resume_id)}
        historical={group !== newestGroup}
        busyProposalId={current.busyProposalId}
        running={current.running}
        batchProgress={batch ? { completed: batch.completed, total: batch.total } : null}
        batchLocked={proposalBatchProgress !== null}
        selectedId={proposalViews[viewKey]?.id}
        onSelect={(id) => setProposalViews((views) => ({ ...views, [viewKey]: { id } }))}
        onApply={applyProposal}
        onReject={rejectProposal}
        onApplyAll={() => void applyAllProposals(viewKey, proposals)}
        onContinue={continueProposal}
      />
    );
  };
  const pendingClarification = pendingClarificationMessage(current.messages);
  const conversationPending = current.loadState === "loading";
  const isEmptyConversation = !conversationPending && current.loadState === "ready" && current.messages.length === 0 && !current.running;
  const clarificationQuestions = pendingClarification?.clarification?.questions ?? [];
  const clarificationQuestion = clarificationQuestions[Math.min(clarificationPage, Math.max(0, clarificationQuestions.length - 1))];
  const latestUserMessage = [...current.messages].reverse().find((message) => message.role === "user");
  const latestTurnContexts = latestUserMessage?.contexts ?? (current.running ? current.contexts : []);

  const refreshComposerView = useCallback((draft: string, contexts: AgentContextSnapshot[], invalidContextIds: string[]) => {
    setComposerView((view) => ({
      revision: view.revision + 1,
      draft,
      contexts,
      invalidContextIds,
    }));
  }, []);

  // 首页与对话中是两套输入框布局，切换时编辑区会重新挂载，也要按最新草稿重建
  const isHomeLayout = isEmptyConversation;
  useEffect(() => {
    refreshComposerView(current.draft, current.contexts, current.invalidContextIds);
  }, [activeKey, current.running, current.cancelling, isHomeLayout]);

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

  const syncComposerFromDom = (
    editor: HTMLDivElement,
    options: { restoreCaret: boolean; updateMention: boolean },
  ) => {
    const nextDraft = composerValue(editor);
    const caret = composerCaretOffset(editor);
    const retainedContextKeys = new Set(
      Array.from(editor.querySelectorAll<HTMLElement>("[data-context-key]"))
        .map((element) => element.dataset.contextKey)
        .filter((key): key is string => Boolean(key)),
    );
    pendingComposerCaretRef.current = options.restoreCaret ? caret : null;
    updateConversation(activeKey, (state) => ({
      draft: nextDraft,
      // 简历小标签放在输入框上方、不在编辑区里，所以编辑区的 DOM 里找不到它，要单独保留
      contexts: state.contexts.filter((context) => retainedContextKeys.has(contextKey(context)) || isChipContext(context, state.draft)),
      invalidContextIds: state.invalidContextIds.filter((id) => retainedContextKeys.has(id)),
    }));
    if (options.updateMention) setContextMention(contextMentionAt(nextDraft, caret));
  };

  // 会话列表由 sessionStore 统一读取（侧栏也读它）；进入首页时强制刷新一次。
  // 刷新结果可能晚于本页刚创建的新会话返回，这时把当前会话补回列表，避免侧栏丢掉它
  useEffect(() => {
    void loadSessions(true).then(() => {
      const key = activeKeyRef.current;
      if (key === NEW_CONVERSATION_KEY) return;
      const { sessions } = useSessionStore.getState();
      const state = conversationStatesRef.current[key];
      if (state && !sessions.some((item) => item.id === key)) useSessionStore.getState().promote(state.session);
    });
  }, [loadSessions]);

  useEffect(() => {
    if (storeSessions.length === 0) return;
    setConversationStates((states) => {
      const next = { ...states };
      for (const session of storeSessions) {
        next[session.id] = next[session.id] ?? {
          ...blankConversation(),
          loadState: "loading",
          session,
          messages: session.messages ?? [],
        };
      }
      return next;
    });
  }, [storeSessions]);

  // 侧栏删除当前会话时，Shell 会把「当前会话」清空并导航回 /assistant；这里据此回到新对话
  useEffect(() => useActiveSessionStore.subscribe((state, previous) => {
    if (!previous.activeId || state.activeId || activeKeyRef.current !== previous.activeId) return;
    const removed = previous.activeId;
    setConversationStates((states) => {
      const next = { ...states };
      delete next[removed];
      return next;
    });
    resetToNewConversation();
  }), []);

  // 告诉侧栏当前会话（高亮）和正在生成的会话（删除置灰）
  useEffect(() => {
    setActiveSession(activeKey === NEW_CONVERSATION_KEY ? null : activeKey);
  }, [activeKey, setActiveSession]);
  useEffect(() => () => setActiveSession(null), [setActiveSession]);
  const runningMarksRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    for (const [key, state] of Object.entries(conversationStates)) {
      if (key === NEW_CONVERSATION_KEY) continue;
      const running = state.running || state.cancelling;
      if (Boolean(runningMarksRef.current[key]) === running) continue;
      runningMarksRef.current[key] = running;
      setSessionRunning(key, running);
    }
  }, [conversationStates, setSessionRunning]);
  useEffect(() => () => {
    Object.keys(runningMarksRef.current).forEach((key) => setSessionRunning(key, false));
  }, [setSessionRunning]);

  useEffect(() => {
    let cancelled = false;
    void api.getAgentModels()
      .then(({ models, defaultModelId }) => {
        if (!cancelled) {
          setRuntimeModels(models);
          setRuntimeModel(models.find((model) => model.id === defaultModelId) ?? models[0] ?? null);
        }
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
    pageMountedRef.current = true;
    return () => {
      pageMountedRef.current = false;
      streamRequestRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
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

  const handleMessageViewportScroll = () => {
    const element = messageViewportRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    followMessagesRef.current = distanceFromBottom <= MESSAGE_FOLLOW_THRESHOLD;
  };

  const elapsedSeconds = current.startedAt ? Math.max(0, Math.floor((clock - current.startedAt) / 1_000)) : 0;
  const detailsReady = current.running && current.stage !== "streaming" && elapsedSeconds >= 8;
  const structuredActivityLabels = new Set(current.activities.map((activity) => activity.label.replace(/[…：].*$/, "")));
  const activityLines = current.activityText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !structuredActivityLabels.has(line.replace(/[…：].*$/, "")));
  const activityStatusText = (activity: ConversationState["activities"][number]) => {
    if (activity.status === "succeeded") return `${activity.label} ✓`;
    if (activity.status === "failed") return `${activity.label}（失败：${activity.errorCode ?? "AGENT_TOOL_FAILED"}）`;
    return `${activity.label}…`;
  };
  const latestStructuredActivity = current.activities[current.activities.length - 1];
  const latestActivity = latestStructuredActivity
    ? activityStatusText(latestStructuredActivity)
    : activityLines[activityLines.length - 1] ?? "";
  const processDetailsReady = detailsReady || activityLines.length > 0 || current.activities.length > 0;
  const selectedModelId = activeKey === NEW_CONVERSATION_KEY
    ? (pendingModelId ?? runtimeModel?.id)
    : (current.session.selected_model_id ?? runtimeModel?.id);
  const selectedModel = runtimeModels.find((model) => model.id === selectedModelId) ?? null;
  const runtimeModelLabel = selectedModel?.name ?? (runtimeModelLoading ? "正在读取模型" : "模型不可用");

  const selectModel = async (modelId: string) => {
    if (activeKey === NEW_CONVERSATION_KEY) {
      setPendingModelId(modelId);
      return;
    }
    if (current.running || current.cancelling) return;
    try {
      const result = await api.updateAgentSession(current.session.id, { modelId });
      updateConversation(current.session.id, { session: result.session });
      upsertSession(result.session);
    } catch (error) {
      updateConversation(current.session.id, { error: safeAgentError(error) });
    }
  };

  const cancelCurrentRun = useCallback(async (key = activeKeyRef.current) => {
    const state = conversationStates[key];
    if (!state?.running) return;
    streamRequestRef.current += 1;
    const runId = state.runId;
    abortRef.current?.abort();
    abortRef.current = null;
    refreshComposerView("", state.contexts, state.invalidContextIds);
    updateConversation(key, (latest) => ({
      running: false,
      cancelling: Boolean(runId),
      stage: "stopped",
      activityText: "",
      activities: [],
      runId: null,
      startedAt: null,
      error: null,
      draft: "",
      messages: latest.messages.map((message, index, messages) => (
        index === messages.length - 1 && message.role === "assistant" && message.temporary
          ? { ...message, status: "stopped" as const }
          : message
      )),
    }));
    if (runId) await api.cancelAgentRun(runId).catch(() => undefined);
    updateConversation(key, { cancelling: false });
  }, [conversationStates, refreshComposerView, updateConversation]);

  const selectSession = async (sessionIdToSelect: string, retry = false) => {
    if (sessionIdToSelect === activeKeyRef.current && !retry) {
      navigateTo(assistantPath(sessionIdToSelect));
      return;
    }
    const request = ++sessionRequestRef.current;
    streamRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    activeKeyRef.current = sessionIdToSelect;
    setActiveKey(sessionIdToSelect);
    navigateTo(assistantPath(sessionIdToSelect));
    updateConversation(sessionIdToSelect, { error: null, loadState: "loading" });
    try {
      const [activeRun, detail] = await Promise.all([
        api.getActiveAgentRun(sessionIdToSelect).catch(() => ({ run: null })),
        api.getAgentSession(sessionIdToSelect),
      ]);
      if (!pageMountedRef.current || request !== sessionRequestRef.current || activeKeyRef.current !== sessionIdToSelect) return;
      const proposalResult = await api.listAgentProposals(null, sessionIdToSelect, true);
      if (!pageMountedRef.current || request !== sessionRequestRef.current || activeKeyRef.current !== sessionIdToSelect) return;
      rememberAssistantSession(detail.session.id);
      updateConversation(sessionIdToSelect, {
        loadState: "ready",
        session: detail.session,
        messages: detail.session.messages ?? [],
        proposals: proposalResult.proposals,
        contexts: [],
        invalidContextIds: [],
        clarificationAnswers: {},
        clarificationAttempted: false,
        error: null,
        running: Boolean(activeRun.run),
        cancelling: false,
        stage: activeRun.run ? "thinking" : "idle",
        runId: activeRun.run?.run_id ?? null,
        startedAt: activeRun.run ? parseAgentTimestamp(activeRun.run.started_at) : null,
        phase: activeRun.run ? "AI 正在处理…" : "正在准备…",
        activityText: "",
      });
      replaceStoreSession(detail.session);
      if (activeRun.run) reconnectToRun(sessionIdToSelect, activeRun.run);
    } catch (error) {
      if (!pageMountedRef.current || request !== sessionRequestRef.current || activeKeyRef.current !== sessionIdToSelect) return;
      // 会话已被删除或无权访问：回到新对话，并提示一次
      if (error instanceof ApiRequestError && (error.status === 404 || error.message === "AGENT_SESSION_NOT_FOUND")) {
        if (activeKeyRef.current === sessionIdToSelect) {
          resetToNewConversation();
          navigateTo(assistantPath(), { replace: true });
          setNotice("这条对话不存在或已被删除，已为你打开新对话。");
        }
        return;
      }
      updateConversation(sessionIdToSelect, { error: safeAgentError(error), loadState: "error" });
    }
  };

  // 回到空白新对话（不改地址）：删除当前会话、会话不存在时共用
  function resetToNewConversation() {
    rememberAssistantSession(null);
    streamRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    activeKeyRef.current = NEW_CONVERSATION_KEY;
    setActiveKey(NEW_CONVERSATION_KEY);
    updateConversation(NEW_CONVERSATION_KEY, { ...blankConversation(), session: blankSession() });
  }

  const createNewConversation = async () => {
    rememberAssistantSession(null);
    setPreviewOpen(false);
    if (activeKeyRef.current === NEW_CONVERSATION_KEY) {
      if (conversationStatesRef.current[NEW_CONVERSATION_KEY]?.messages.some((message) => message.localOnly)) {
        updateConversation(NEW_CONVERSATION_KEY, blankConversation());
        setPreviewTabs((all) => ({ ...all, [NEW_CONVERSATION_KEY]: [] }));
        setPreviewActive((all) => ({ ...all, [NEW_CONVERSATION_KEY]: null }));
      }
      navigateTo(assistantPath());
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    streamRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    activeKeyRef.current = NEW_CONVERSATION_KEY;
    setActiveKey(NEW_CONVERSATION_KEY);
    navigateTo(assistantPath());
    updateConversation(NEW_CONVERSATION_KEY, {
      ...blankConversation(),
      session: blankSession(),
    });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  // 旧版「在助手里嵌其他模块」的地址：直接跳到对应独立页面
  useEffect(() => {
    if (workspaceSection) navigateTo(workspaceRedirectPath(workspaceSection, careerView), { replace: true });
  }, [workspaceSection, careerView]);

  useLayoutEffect(() => {
    if (workspaceSection) return;
    const routeSessionId = sessionId ?? NEW_CONVERSATION_KEY;
    if (routeSessionId === activeKeyRef.current) return;
    if (routeSessionId === NEW_CONVERSATION_KEY) {
      void createNewConversation();
      return;
    }
    void selectSession(routeSessionId);
  }, [sessionId, workspaceSection]);

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
  };

  const closeContextPicker = () => {
    setContextPickerOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const toggleContextDraft = (context: AgentContextSnapshot) => {
    setContextDrafts((items) => {
      if (items.some((item) => contextKey(item) === contextKey(context))) {
        return items.filter((item) => contextKey(item) !== contextKey(context));
      }
      return [...items.filter((item) => item.type !== context.type), context];
    });
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
    const nextCaret = contextMention.start + context.label.length + 2;
    const contexts = [...current.contexts.filter((item) => item.type !== context.type), context].slice(0, 10);
    const invalidContextIds = current.invalidContextIds.filter((id) => contexts.some((item) => contextKey(item) === id));
    const draft = `${current.draft.slice(0, contextMention.start)}@${context.label} ${current.draft.slice(contextMention.end)}`;
    pendingComposerCaretRef.current = nextCaret;
    refreshComposerView(draft, contexts, invalidContextIds);
    updateConversation(activeKey, { contexts, invalidContextIds, draft, error: null });
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
      updateConversation(key, (state) => {
        const latestUser = state.messages.filter((message) => message.role === "user").slice(-1)[0];
        return { runId: event.runId, revisionProposalId: undefined, stage: "thinking", messages: state.messages.map((message) => message === latestUser ? { ...message, run_id: event.runId } : message) };
      });
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
    if (event.type === "assistant.activity.delta") {
      updateConversation(key, (state) => ({
        activityText: state.activityText + event.delta,
        stage: "thinking",
        error: null,
      }));
      return;
    }
    if (event.type === "assistant.activity.status") {
      updateConversation(key, (state) => {
        const activity = {
          callKey: event.callKey,
          label: event.label,
          status: event.status,
          ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        };
        const index = state.activities.findIndex((item) => item.callKey === event.callKey);
        return {
          activities: index < 0
            ? [...state.activities, activity]
            : state.activities.map((item, itemIndex) => itemIndex === index ? activity : item),
          stage: "thinking",
          error: null,
        };
      });
      return;
    }
    if (event.type === "assistant.activity.clear") {
      updateConversation(key, { activityText: "", activities: [], detailsOpen: false });
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
            run_id: event.runId,
            content: event.delta,
            created_at: new Date().toISOString(),
            temporary: true,
            status: "streaming",
          });
        }
        return { messages, stage: "streaming", activityText: "", activities: [], detailsOpen: false, error: null };
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
        activityText: "",
        activities: [],
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
    if (event.type === "run.completed") {
      updateConversation(key, (state) => {
        const lastPrompt = state.messages.map((message) => message.role).lastIndexOf("user");
        return {
          messages: state.messages.map((message, index) => index >= lastPrompt
            ? { ...message, temporary: false, status: undefined }
            : message),
        };
      });
      return;
    }
    if (event.type === "run.failed") {
      updateConversation(key, (state) => ({
        error: safeAgentError(new ApiRequestError(502, event.error)),
        stage: "failed",
        activityText: "",
        activities: [],
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
        activityText: "",
        activities: [],
        draft: "",
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

  const reconnectToRun = (key: string, run: AgentActiveRun) => {
    const requestNumber = streamRequestRef.current + 1;
    streamRequestRef.current = requestNumber;
    const controller = new AbortController();
    abortRef.current = controller;
    updateConversation(key, (state) => ({
      running: true,
      cancelling: false,
      stage: "thinking",
      activityText: "",
      activities: [],
      runId: run.run_id,
      startedAt: parseAgentTimestamp(run.started_at),
      error: null,
      messages: state.messages.filter((message) => !message.temporary),
    }));
    void api.streamAgentRun(
      run.run_id,
      controller.signal,
      (event) => handleEvent(key, requestNumber, event),
    ).then(async () => {
      if (streamRequestRef.current !== requestNumber || activeKeyRef.current !== key) return;
      // The stream terminal is authoritative. A failed history refresh must
      // not turn a completed run into a failed conversation.
      const detail = await api.getAgentSession(key).catch(() => null);
      const proposalResult = await api.listAgentProposals(null, key, true).catch(() => ({ proposals: [] }));
      if (streamRequestRef.current !== requestNumber || activeKeyRef.current !== key) return;
      updateConversation(key, (latest) => ({
        session: detail?.session ?? latest.session,
        messages: detail ? mergeSessionMessages(detail.session.messages ?? [], latest.messages) : latest.messages,
        proposals: proposalResult.proposals.length > 0 ? proposalResult.proposals : latest.proposals,
        running: false,
        stage: latest.stage === "failed" || latest.stage === "stopped" ? latest.stage : "idle",
        runId: null,
        startedAt: null,
        ...(latest.stage === "failed" || latest.stage === "stopped" ? {} : {
          contexts: [],
          invalidContextIds: [],
        }),
      }));
      if (detail) replaceStoreSession(detail.session);
    }).catch((error) => {
      if (controller.signal.aborted || streamRequestRef.current !== requestNumber) return;
      updateConversation(key, {
        error: safeAgentError(error),
        running: false,
        stage: "failed",
        runId: null,
        startedAt: null,
      });
    }).finally(() => {
      if (abortRef.current === controller) abortRef.current = null;
    });
  };

  const ensureSession = async (state: ConversationState) => {
    if (state.session.id !== NEW_CONVERSATION_KEY) return state.session;
    const result = await api.createAgentSession(undefined, pendingModelId);
    const newState = { ...state, session: result.session };
    setConversationStates((states) => {
      const next = { ...states, [result.session.id]: newState };
      delete next[NEW_CONVERSATION_KEY];
      return next;
    });
    activeKeyRef.current = result.session.id;
    rememberAssistantSession(result.session.id);
    promoteStoreSession(result.session);
    setActiveKey(result.session.id);
    navigateTo(assistantPath(result.session.id), { replace: true });
    return result.session;
  };

  const runMessage = async (
    content: string,
    replyToSequenceNo?: number,
    clarificationAnswersPayload?: ReturnType<typeof clarificationAnswerPayload>,
  ) => {
    const trimmed = content.trim();
    const key = activeKeyRef.current;
    const state = conversationStates[key] ?? blankConversation();
    const statePendingClarification = pendingClarificationMessage(state.messages);
    if (!trimmed || state.running || state.cancelling || (statePendingClarification && replyToSequenceNo === undefined)) return;
    if (replyToSequenceNo === undefined && (isLocalDocumentRequest(trimmed) || state.screenshots?.length)) {
      const timestamp = new Date().toISOString();
      const generatedDocument = isLocalDocumentRequest(trimmed) ? createLocalDocument(idempotencyKey(), state.contexts) : undefined;
      updateConversation(key, {
        draft: "", screenshots: [], contexts: [], error: null,
        messages: [...state.messages,
          { role: "user", sequence_no: -(Date.now()), created_at: timestamp, content: trimmed, contexts: state.contexts, screenshots: state.screenshots, localOnly: true },
          { role: "assistant", sequence_no: -(Date.now() + 1), created_at: timestamp, content: generatedDocument ? "准备文档已整理在下方，可以打开预览、复制或保存。文档生成目前使用本地示例，尚未连接 AI 生成接口。" : "截图已加入本次对话，可点击缩略图查看。截图理解尚未连接后端，当前仅保留本地预览。", generatedDocument, artifactFollowup: generatedDocument ? "需要的话，我可以按这份文档陪你做一轮模拟面试。" : undefined, localOnly: true },
        ],
      });
      refreshComposerView("", [], []);
      return;
    }
    const explicitResume = state.contexts.find((item) => item.type === "resume");
    const revisionResume = state.proposals.find((item) => item.id === state.revisionProposalId)?.resume_id;
    // V3 不再在助手里嵌入简历编辑器，所以没有「当前打开的简历」这一隐式上下文，也没有编辑器选区
    const runResumeContextId = revisionResume ?? explicitResume?.id ?? null;
    let session: AgentSession;
    try {
      session = await ensureSession(state);
    } catch (error) {
      updateConversation(key, { error: safeAgentError(error) });
      return;
    }
    const requestKey = session.id;
    setProposalViews((views) => ({ ...views, [requestKey]: {} }));
    promoteStoreSession(session);
    const requestNumber = streamRequestRef.current + 1;
    streamRequestRef.current = requestNumber;
    const controller = new AbortController();
    abortRef.current = controller;
    const sentContexts = state.contexts;
    const originalResume = replyToSequenceNo === undefined ? undefined : [...state.messages]
      .reverse()
      .find((message) => message.role === "user" && message.sequence_no < replyToSequenceNo)
      ?.contexts?.find((item) => item.type === "resume");
    const replacesInheritedResume = Boolean(
      originalResume && explicitResume && originalResume.id !== explicitResume.id
    );
    let requestContexts: AgentContextRef[] = sentContexts.map(({ type, id, presentation, version_id: versionId, version }) => ({
      type,
      id,
      ...(presentation ? { presentation } : {}),
      ...(versionId ? { version_id: versionId } : {}),
      ...(version ? { version } : {}),
    }));
    if (runResumeContextId) {
      const explicitCurrentResume = requestContexts.find((item) => (
        item.type === "resume" && item.id === runResumeContextId
      ));
      requestContexts = [
        explicitCurrentResume
          ?? { type: "resume", id: runResumeContextId, presentation: "implicit" },
        ...requestContexts.filter((item) => item.type !== "resume"),
      ];
    }
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
      activityText: "",
      activities: [],
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
          ...(state.revisionProposalId ? { revision_proposal_id: state.revisionProposalId } : {}),
          ...(replyToSequenceNo !== undefined ? { reply_to_sequence_no: replyToSequenceNo } : {}),
          ...(replacesInheritedResume ? { replace_inherited_resume: true } : {}),
          ...(clarificationAnswersPayload ? { clarification_answers: clarificationAnswersPayload } : {}),
          ...(requestContexts.length > 0 ? { contexts: requestContexts } : {}),
        },
        controller.signal,
        (event) => handleEvent(requestKey, requestNumber, event),
      );
      if (streamRequestRef.current !== requestNumber) return;
      const detail = await api.getAgentSession(session.id).catch(() => null);
      const proposalResult = await api.listAgentProposals(null, session.id, true).catch(() => ({ proposals: [] }));
      if (streamRequestRef.current !== requestNumber) return;
      updateConversation(requestKey, (latest) => {
        const messages = detail ? mergeSessionMessages(detail.session.messages, latest.messages) : latest.messages;
        const runCompleted = latest.stage !== "failed" && latest.stage !== "stopped";
        return {
          ...(runCompleted ? {
            stage: "idle" as const,
            contexts: [],
            invalidContextIds: [],
          } : latest.stage === "failed" ? {
            stage: latest.stage,
            draft: latest.draft || trimmed,
          } : {
            stage: latest.stage,
            draft: "",
          }),
          session: detail?.session ?? latest.session,
          messages,
          proposals: proposalResult.proposals.length > 0 ? proposalResult.proposals : latest.proposals,
          running: false,
          runId: null,
          startedAt: null,
        };
      });
      if (detail) replaceStoreSession(detail.session);
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
        // 上一轮还在停止中：这次没有发出去，保留用户刚输入的内容，方便稍后重发
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
      clarificationAnswerPayload(pendingClarification.clarification, answers),
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

  const continueProposal = (proposal: AgentProposal) => {
    pendingComposerCaretRef.current = "继续调整：".length;
    refreshComposerView("继续调整：", current.contexts, current.invalidContextIds);
    updateConversation(activeKey, { draft: "继续调整：", revisionProposalId: proposal.id, error: null });
    window.setTimeout(() => {
      if (!inputRef.current) return;
      placeComposerCaret(inputRef.current, "继续调整：".length);
      inputRef.current.focus();
    }, 0);
  };

  // 返回是否成功，建议卡据此决定是否自动切到下一项
  const applyProposal = async (proposal: AgentProposal) => {
    updateConversation(activeKey, { busyProposalId: proposal.id, error: null });
    try {
      await useResumeStore.getState().confirmResumeProposal(proposal.id, proposal.resume_id, "assistant");
      updateConversation(activeKey, (state) => ({
        proposals: state.proposals.map((item) => item.id === proposal.id ? { ...item, status: "applied" } : item),
        busyProposalId: null,
      }));
      return true;
    } catch (error) {
      updateConversation(activeKey, (state) => ({
        proposals: isConflictError(error)
          ? state.proposals.map((item) => item.id === proposal.id ? { ...item, status: "conflicted" } : item)
          : state.proposals,
        busyProposalId: null,
        error: safeAgentError(error),
      }));
      return false;
    }
  };

  const applyAllProposals = async (viewKey: string, proposals: AgentProposal[]) => {
    const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
    if (pendingProposals.length < 2 || proposalBatchProgress || current.busyProposalId !== null || current.running) return;
    const conversationKey = activeKey;
    setProposalBatchProgress({ viewKey, completed: 0, total: pendingProposals.length });
    updateConversation(conversationKey, { error: null });
    let completed = 0;
    try {
      for (const proposal of pendingProposals) {
        updateConversation(conversationKey, { busyProposalId: proposal.id });
        try {
          await useResumeStore.getState().confirmResumeProposal(proposal.id, proposal.resume_id, "assistant");
          completed += 1;
          updateConversation(conversationKey, (state) => ({
            proposals: state.proposals.map((item) => item.id === proposal.id ? { ...item, status: "applied" } : item),
            busyProposalId: null,
          }));
          setProposalBatchProgress({ viewKey, completed, total: pendingProposals.length });
        } catch (error) {
          updateConversation(conversationKey, (state) => ({
            proposals: isConflictError(error)
              ? state.proposals.map((item) => item.id === proposal.id ? { ...item, status: "conflicted" } : item)
              : state.proposals,
            busyProposalId: null,
            error: completed > 0
              ? `已应用 ${completed} 项，批量处理已停止：${safeAgentError(error)}`
              : safeAgentError(error),
          }));
          break;
        }
      }
    } finally {
      updateConversation(conversationKey, { busyProposalId: null });
      setProposalBatchProgress(null);
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
      return true;
    } catch (error) {
      updateConversation(activeKey, { busyProposalId: null, error: safeAgentError(error) });
      return false;
    }
  };

  /* ───────────── 右侧文件预览 ───────────── */

  const sessionPreviewTabs = previewTabs[activeKey] ?? [];
  const activePreviewKey = previewOpen ? (previewActive[activeKey] ?? null) : null;
  // 本会话引用过的所有文件（用户消息与当前输入框里的上下文），右上角「N 个文件」汇总它们
  const sessionContexts = (() => {
    const seen = new Map<string, AgentContextSnapshot>();
    for (const context of [...current.messages.flatMap((message) => message.contexts ?? []), ...current.contexts]) {
      if (context.presentation === "implicit" || !previewTabForContext(context)) continue;
      seen.set(previewTabKey(previewTabForContext(context)!), context);
    }
    return [...seen.values()];
  })();

  useEffect(() => {
    messageViewportRef.current?.querySelectorAll<HTMLAnchorElement>('a[href^="#linkresume-ref:"]').forEach((anchor) => {
      const [type, id] = (anchor.getAttribute("href") ?? "").slice(REF_HREF_PREFIX.length).split(":").map(decodeURIComponent);
      const key = `${type === "resume_version" ? "resume" : type}:${id}`;
      anchor.classList.toggle("is-active", key === activePreviewKey);
      if (unavailableKeys.includes(key)) { anchor.setAttribute("aria-disabled", "true"); anchor.tabIndex = -1; }
      else { anchor.removeAttribute("aria-disabled"); anchor.removeAttribute("tabindex"); }
    });
  }, [current.messages, activePreviewKey, unavailableKeys]);

  const localFiles = current.messages.flatMap((message) => [...(message.screenshots ?? []), ...(message.generatedDocument ? [message.generatedDocument] : [])]);
  const allFileCount = sessionContexts.length + localFiles.length;

  const openPreview = (tab: PreviewTab) => {
    setPreviewTabs((all) => ({ ...all, [activeKey]: openPreviewTab(all[activeKey] ?? [], tab) }));
    setPreviewActive((all) => ({ ...all, [activeKey]: previewTabKey(tab) }));
    setPreviewOpen(true);
  };
  const openContextPreview = (context: AgentContextSnapshot) => {
    const tab = previewTabForContext(context);
    if (tab?.kind === "resume") tab.pendingChanges = current.proposals.filter((proposal) => proposal.status === "pending" && proposal.resume_id === tab.id).flatMap((proposal) => proposal.preview?.changes.map((change) => change.before) ?? []);
    if (tab?.kind === "dataset") tab.excerpts = current.proposals.flatMap((proposal) => proposal.source_refs ?? []).filter((source) => source.id === tab.id || source.dataset_id === tab.id).flatMap((source) => typeof source.quote === "string" ? [source.quote] : typeof source.excerpt === "string" ? [source.excerpt] : []);
    if (tab && !unavailableKeys.includes(previewTabKey(tab))) openPreview(tab);
  };
  const openAllFiles = () => {
    let tabs = sessionPreviewTabs;
    sessionContexts.forEach((context) => { tabs = openPreviewTab(tabs, previewTabForContext(context)!); });
    localFiles.forEach((file) => { tabs = openPreviewTab(tabs, file); });
    setPreviewTabs((all) => ({ ...all, [activeKey]: tabs }));
    setPreviewActive((all) => ({ ...all, [activeKey]: all[activeKey] ?? (tabs[0] ? previewTabKey(tabs[0]) : null) }));
    if (tabs.length) setPreviewOpen(true);
  };
  const closePreviewTab = (key: string) => {
    const tabs = sessionPreviewTabs.filter((tab) => previewTabKey(tab) !== key);
    setPreviewTabs((all) => ({ ...all, [activeKey]: (all[activeKey] ?? []).filter((tab) => previewTabKey(tab) !== key) }));
    if (previewActive[activeKey] === key) {
      setPreviewActive((all) => ({ ...all, [activeKey]: tabs[tabs.length - 1] ? previewTabKey(tabs[tabs.length - 1]) : null }));
    }
    if (tabs.length === 0) setPreviewOpen(false);
  };
  const savingDocumentsRef = useRef(new Set<string>());
  const saveGeneratedDocument = async (id: string) => {
    if (savingDocumentsRef.current.has(id)) return;
    const document = sessionPreviewTabs.find((tab): tab is GeneratedDocument => tab.kind === "generated" && tab.id === id);
    if (!document || document.saved) return;
    savingDocumentsRef.current.add(id);
    // 同一份文档重试用同一个幂等键，网络重放不会产生两份资料
    const key = idempotencyKey();
    const upload = (fileName: string) => api.uploadDataset(new File([document.content], fileName, { type: "text/markdown" }), key, "");
    try {
      let saved;
      try {
        saved = await upload(document.label);
      } catch (error) {
        if (!(error instanceof ApiRequestError && error.message === "DATASET_NAME_CONFLICT")) throw error;
        // 资料库里已有同名文件：保留两份，新文件名带上保存时间
        const stamp = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(/[/:\s]/g, "");
        saved = await api.uploadDataset(new File([document.content], document.label.replace(/(\.md)?$/, `-${stamp}.md`), { type: "text/markdown" }), idempotencyKey(), "");
      }
      updateConversation(activeKey, (state) => ({ messages: state.messages.map((message) => message.generatedDocument?.id === id ? { ...message, generatedDocument: { ...message.generatedDocument, saved: true } } : message) }));
      setPreviewTabs((all) => ({ ...all, [activeKey]: (all[activeKey] ?? []).map((tab) => tab.kind === "generated" && tab.id === id ? { ...tab, saved: true } : tab) }));
      setNotice(`已保存到资料库：${saved.file_name}。`);
    } catch (error) {
      setNotice(error instanceof ApiRequestError && error.status === 401 ? "登录已过期，请重新登录后保存。" : "保存到资料库失败，请稍后重试。");
    } finally {
      savingDocumentsRef.current.delete(id);
    }
  };
  // AI 回答里的文件引用（蓝色文字）：拦截特殊链接，在右侧打开
  const handleAssistantClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest?.("a");
    const href = anchor?.getAttribute("href") ?? "";
    if (!href.startsWith(REF_HREF_PREFIX)) return;
    event.preventDefault();
    const [type, id] = href.slice(REF_HREF_PREFIX.length).split(":").map(decodeURIComponent);
    const context = sessionContexts.find((item) => item.type === type && (item.resume_id ?? item.id) === id);
    if (context) openContextPreview(context);
  };

  /* ───────────── 首页（空闲） ───────────── */

  const home = useHomeDashboard(isEmptyConversation);
  const now = new Date();
  const displayName = user?.nickname || "";
  const dashboard = home.status === "ready" ? home.dashboard : null;
  const copy = dashboard ? homeCopy(dashboard) : null;
  const chipResumes = current.contexts.filter((context) => isChipContext(context, current.draft));

  const applyQuickPrompt = (text: string) => {
    pendingComposerCaretRef.current = text.length;
    refreshComposerView(text, current.contexts, current.invalidContextIds);
    updateConversation(activeKey, { draft: text, error: null });
  };

  // 首页默认附上最近编辑的简历（规则说明第 3 条：输入框默认附件跟位置 1 的主题走；
  // Offer 没有可作为上下文的对象，这里统一附最近的简历）
  const homeDefaultResume = home.status === "ready" ? home.defaultResume : null;
  const homeResumeAttachedRef = useRef(false);
  useLayoutEffect(() => {
    // 离开新对话后，下次回到首页重新附上默认简历
    if (activeKey !== NEW_CONVERSATION_KEY) {
      homeResumeAttachedRef.current = false;
      return;
    }
    if (!homeDefaultResume || homeResumeAttachedRef.current || !isEmptyConversation) return;
    if (current.contexts.some((context) => context.type === "resume")) return;
    homeResumeAttachedRef.current = true;
    const resumeContext: AgentContextSnapshot = {
      type: "resume",
      id: homeDefaultResume.id,
      version: String(homeDefaultResume.lock_version),
      resume_id: homeDefaultResume.id,
      label: homeDefaultResume.title,
      presentation: "mention",
      updated_at: homeDefaultResume.updated_at,
    };
    // The default resume is a separate chip; don't remount an editor the user is typing in.
    updateConversation(NEW_CONVERSATION_KEY, (state) => ({ contexts: [resumeContext, ...state.contexts] }));
  }, [homeDefaultResume?.id, activeKey]);

  /* ───────────── 渲染 ───────────── */

  const composerDisabled = current.running || current.cancelling || Boolean(pendingClarification);
  const isHome = isEmptyConversation;

  const mentionMenu = contextMention && (
    <div ref={mentionMenuRef} id="assistant-context-mention-list" className="assistant-mention" role="listbox" aria-label="可引用的资料和简历">
      {mentionLoading && <p className="assistant-mention-status">正在搜索…</p>}
      {mentionError && <p className="assistant-mention-status" role="alert">{mentionError}</p>}
      {!mentionLoading && !mentionError && mentionOptions.length === 0 && <p className="assistant-mention-status">没有匹配的文件</p>}
      {!mentionLoading && !mentionError && (["dataset", "resume"] as const).map((type) => {
        const groupedOptions = mentionOptions
          .map((context, index) => ({ context, index }))
          .filter(({ context }) => context.type === type);
        if (groupedOptions.length === 0) return null;
        return (
          <div key={type} className="assistant-mention-group" role="group" aria-label={type === "resume" ? "简历" : "资料"}>
            <div className="assistant-mention-group-label">{type === "resume" ? "简历" : "资料库"}</div>
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
                <Icon name={contextIcon(context.type)} size={14} />
                <strong>{context.label}</strong>
                <small>{context.type === "resume" ? "简历" : context.description || "资料"}</small>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );

  const editor = (
    <div
      key={`${activeKey}:${composerView.revision}`}
      ref={inputRef}
      className="assistant-composer-editor"
      role="textbox"
      aria-multiline="true"
      aria-label="告诉助手你想完成什么"
      data-placeholder={isHome ? "问问 LinkResume：改简历、分析 JD、准备面试…" : "继续提问或说明调整要求…"}
      aria-autocomplete="list"
      aria-controls={contextMention ? "assistant-context-mention-list" : undefined}
      aria-expanded={Boolean(contextMention)}
      aria-activedescendant={contextMention && mentionOptions.length > 0 ? `assistant-context-mention-option-${mentionActiveIndex}` : undefined}
      aria-disabled={composerDisabled}
      contentEditable={!composerDisabled}
      suppressContentEditableWarning
      onInput={(event) => {
        const composing = (event.nativeEvent as InputEvent).isComposing || isComposingRef.current;
        syncComposerFromDom(event.currentTarget, { restoreCaret: !composing, updateMention: !composing });
      }}
      onPaste={(event) => {
        event.preventDefault();
        const files = Array.from(event.clipboardData.items ?? []).filter((item) => item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
        if (files.length) {
          const pasteKey = activeKey;
          files.forEach((file) => {
            const reader = new FileReader();
            reader.onload = () => updateConversation(pasteKey, (state) => ({ screenshots: [...(state.screenshots ?? []), { kind: "image", id: idempotencyKey(), label: file.name || "粘贴的截图.png", url: String(reader.result) }] }));
            reader.onerror = () => setNotice("截图读取失败，请重新粘贴。");
            reader.readAsDataURL(file);
          });
        }
        insertComposerPlainText(event.currentTarget, event.clipboardData.getData("text/plain"));
        syncComposerFromDom(event.currentTarget, { restoreCaret: true, updateMention: true });
      }}
      onKeyDown={handleInputKeyDown}
      onCompositionStart={() => {
        isComposingRef.current = true;
        pendingComposerCaretRef.current = null;
      }}
      onCompositionEnd={(event) => {
        isComposingRef.current = false;
        syncComposerFromDom(event.currentTarget, { restoreCaret: true, updateMention: true });
      }}
    >
      {composerSegments(composerView.draft, composerView.contexts.filter((context) => !isChipContext(context, composerView.draft))).map((segment) => segment.kind === "text" ? segment.text : (
        <span
          key={segment.key}
          className={`assistant-composer-context-token${composerView.invalidContextIds.includes(contextKey(segment.context)) ? " is-invalid" : ""}`}
          contentEditable={false}
          data-context-key={contextKey(segment.context)}
          data-context-value={`@${segment.context.label}`}
          aria-label={`引用文件 ${segment.context.label}`}
        >
          {segment.context.label}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`移除上下文 ${segment.context.label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => removeContext(segment.context)}
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
    </div>
  );

  const sendButton = current.running ? (
    <button type="button" className="assistant-send is-stop" aria-label="停止生成" onClick={stopGeneration}>
      <span aria-hidden="true" />
    </button>
  ) : (
    <button type="submit" className="assistant-send" aria-label="发送" disabled={current.cancelling || !current.draft.trim() || Boolean(pendingClarification)}>
      <Icon name="up" size={16} strokeWidth={2.2} />
    </button>
  );

  const resumeChips = chipResumes.length > 0 && (
    <div className="assistant-composer-chips">
      {chipResumes.map((context) => (
        <span
          key={contextKey(context)}
          className={`assistant-resume-chip${composerView.invalidContextIds.includes(contextKey(context)) ? " is-invalid" : ""}`}
        >
          <button type="button" className="assistant-resume-chip-open" aria-label={`预览简历 ${context.label}`} onClick={() => openContextPreview(context)}>
            <Icon name="resume" size={12} />
            <span>{context.label}</span>
            <small>简历</small>
          </button>
          <button type="button" className="assistant-resume-chip-remove" aria-label={`移除上下文 ${context.label}`} onClick={() => removeContext(context)}>
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
    </div>
  );

  const modelPicker = (compact: boolean) => (
    <ModelPicker
      compact={compact}
      models={runtimeModels}
      selectedId={selectedModelId}
      label={runtimeModelLabel}
      loading={runtimeModelLoading}
      disabled={current.running || current.cancelling}
      onSelect={(modelId) => void selectModel(modelId)}
    />
  );

  const clarificationPanel = pendingClarification?.clarification && (
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
          <Icon name="chevu" size={16} />
        </button>
      ) : (
        <>
          <header>
            <span><strong>需要你确认</strong><small className="v3-num">{clarificationPage + 1} / {clarificationQuestions.length}</small></span>
            <button
              type="button"
              className="v3-icon-btn"
              aria-expanded="true"
              aria-label="收起主动询问"
              onClick={() => updateConversation(activeKey, { clarificationCollapsed: true })}
            >
              <Icon name="chevd" size={16} />
            </button>
          </header>
          {latestTurnContexts.some((item) => item.type === "resume") && (
            <p className="assistant-clarification-context-hint">需要改用另一份简历时，先点下方“添加资料”选择目标简历，再提交回答。</p>
          )}
          <div className="assistant-clarification-questions">
            {clarificationQuestion && [clarificationQuestion].map((question) => {
              const answer = current.clarificationAnswers[question.id] ?? { optionId: "", other: "" };
              const allowCustom = clarificationAllowsCustom(pendingClarification.clarification!, question);
              const missing = current.clarificationAttempted && (!answer.optionId || (answer.optionId === "__other__" && allowCustom && !answer.other.trim()));
              const choose = (optionId: string, other = "") => updateConversation(activeKey, (state) => ({
                clarificationAnswers: { ...state.clarificationAnswers, [question.id]: { optionId, other } },
              }));
              return (
                <fieldset key={question.id} aria-describedby={missing ? `${question.id}-error` : undefined}>
                  <legend><span>{question.header}</span>{question.question}</legend>
                  {question.options.map((option) => (
                    <label key={option.id} className={answer.optionId === option.id ? "is-checked" : undefined}>
                      <input
                        type="radio"
                        name={`assistant-clarification-${question.id}`}
                        value={option.id}
                        checked={answer.optionId === option.id}
                        onChange={() => choose(option.id)}
                      />
                      <span className={`v3-radio${answer.optionId === option.id ? " is-on" : ""}`} aria-hidden="true" />
                      <span className="assistant-clarification-option"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                    </label>
                  ))}
                  {allowCustom && (
                    <label className={`assistant-clarification-other-option${answer.optionId === "__other__" ? " is-checked" : ""}`}>
                      <input
                        type="radio"
                        name={`assistant-clarification-${question.id}`}
                        value="__other__"
                        checked={answer.optionId === "__other__"}
                        onChange={() => choose("__other__", current.clarificationAnswers[question.id]?.other ?? "")}
                      />
                      <span className={`v3-radio${answer.optionId === "__other__" ? " is-on" : ""}`} aria-hidden="true" />
                      <span className="assistant-clarification-option"><strong>其他</strong></span>
                      <input
                        className="v3-input assistant-clarification-other"
                        aria-label={`${question.header}的其他回答`}
                        maxLength={500}
                        placeholder="请输入补充内容"
                        value={answer.other}
                        onFocus={() => choose("__other__", current.clarificationAnswers[question.id]?.other ?? "")}
                        onChange={(event) => choose("__other__", event.target.value)}
                      />
                    </label>
                  )}
                  {missing && <small className="assistant-clarification-error" id={`${question.id}-error`}>请选择一个选项或填写其他答案。</small>}
                </fieldset>
              );
            })}
          </div>
          <footer>
            <button type="button" className="v3-btn v3-btn-text" disabled={clarificationPage === 0} onClick={() => setClarificationPage((page) => Math.max(0, page - 1))}>
              <Icon name="chevl" size={13} />上一题
            </button>
            {clarificationPage < clarificationQuestions.length - 1 ? (
              <button type="button" className="v3-btn v3-btn-dark" onClick={() => setClarificationPage((page) => Math.min(clarificationQuestions.length - 1, page + 1))}>
                下一题<Icon name="chev" size={13} />
              </button>
            ) : (
              <button type="button" className="v3-btn v3-btn-dark" disabled={current.running} onClick={submitClarification}>提交回答</button>
            )}
          </footer>
        </>
      )}
    </section>
  );

  // 面试准备清单卡：后端没有准备清单模型，只在最新一轮回答提到面试准备时展示示例（01.1a）
  const latestAssistant = [...current.messages].reverse().find((message) => message.role === "assistant" && !message.temporary);
  const showPrepChecklist = Boolean(latestAssistant && !latestAssistant.localOnly && /面试/.test(latestAssistant.content) && /准备/.test(latestAssistant.content) && !current.running);
  const prepChecklistKey = `${activeKey}:${latestAssistant?.sequence_no ?? 0}`;
  const prepItems = MOCK_PREP_CHECKLIST.map((item, index) => ({ ...item, done: prepStates[prepChecklistKey]?.[index] ?? item.done }));
  const prepDone = prepItems.filter((item) => item.done).length;
  const prepChecklist = (
    <section className="assistant-prep" aria-label="面试准备清单">
      <header>
        <strong>面试准备清单</strong>
        <BeTag />
        <span className="v3-num">{prepDone} / {MOCK_PREP_CHECKLIST.length} 已完成</span>
      </header>
      <ul>
        {prepItems.map((item, index) => (
          <li key={item.title} className={item.done ? "is-done" : undefined}>
            <button type="button" role="checkbox" aria-label={item.title} aria-checked={item.done} className="assistant-prep-check" title="需后端：勾选状态仅在本次对话中保留" onClick={() => setPrepStates((states) => ({ ...states, [prepChecklistKey]: prepItems.map((entry, entryIndex) => entryIndex === index ? !entry.done : entry.done) }))}>{item.done && <Icon name="check" size={9} strokeWidth={2.4} />}</button>
            <span className="assistant-prep-title">{item.title}</span>
            {item.done ? <small>已完成</small> : (
              <span className="assistant-prep-start"><BeTag /><button type="button" className="v3-link" onClick={() => { applyQuickPrompt(`按准备清单的「${item.title}」陪我做一轮模拟面试`); inputRef.current?.focus(); }}>开始模拟<Icon name="arrow" size={12} /></button></span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );

  const thinking = current.running && current.stage !== "streaming" && (
    <section className="assistant-thinking" aria-label="AI 正在思考" aria-live="polite">
      <span className="assistant-feather-motion is-writing" aria-hidden="true">
        <svg className="assistant-writing-ink" viewBox="0 0 56 44" focusable="false">
          <path pathLength="1" d="M 3 34 C 10 33 16 31 22 27 C 27 24 30 19 28 15 C 27 11 22 12 20 17 C 17 23 20 29 26 30 C 32 31 35 26 40 28 C 44 31 48 28 53 25" />
        </svg>
        <img className="assistant-message-feather" src={assistantFeather} alt="" />
      </span>
      <div className="assistant-thinking-copy">
        <div className="assistant-thinking-line">
          <strong>{current.phase || "AI 正在处理…"}</strong>
          <span className="v3-num">{elapsedSeconds} 秒</span>
        </div>
        {latestActivity && <p className="assistant-thinking-latest">{latestActivity}</p>}
        {processDetailsReady && (
          <>
            <button type="button" className="assistant-thinking-details-toggle" aria-expanded={current.detailsOpen} onClick={() => updateConversation(activeKey, { detailsOpen: !current.detailsOpen })}>
              {current.detailsOpen ? "收起过程" : "查看过程"}
              <Icon name={current.detailsOpen ? "chevd" : "chev"} size={12} />
            </button>
            {current.detailsOpen && (
              <div className="assistant-thinking-details">
                <div><Icon name="check" size={13} /><strong>已读取 {current.referencedContextCount} 项资料</strong></div>
                {current.contexts.length > 0 && (
                  <div className="assistant-thinking-sources">
                    {current.contexts.slice(0, 10).map((context) => <span key={contextKey(context)}>{context.label}</span>)}
                  </div>
                )}
                {activityLines.length > 0 && <p className="assistant-thinking-activity">{activityLines.join("\n")}</p>}
                {current.activities.map((activity) => (
                  <p className="assistant-thinking-activity" key={activity.callKey}>{activityStatusText(activity)}</p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );

  const screenshots = <ScreenshotStrip images={current.screenshots ?? []} activeKey={activePreviewKey} onOpen={openPreview} onRemove={(id) => updateConversation(activeKey, { screenshots: (current.screenshots ?? []).filter((image) => image.id !== id) })} />;
  const composer = (
    <form className={`assistant-composer${isHome ? " is-home" : ""}`} onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
      {current.revisionProposalId && (
        <div className="assistant-proposal-revision-context">
          <span>继续调整所选修改建议</span>
          <button type="button" className="v3-link" onClick={() => updateConversation(activeKey, { revisionProposalId: undefined })}>取消关联</button>
        </div>
      )}
      {clarificationPanel}
      {isHome ? (
        // 首页输入框卡：720×120，底部左侧 + 和简历标签，右侧模型名与发送
        <div className={`assistant-home-input${current.screenshots?.length ? " has-screenshots" : ""}`}>
          {mentionMenu}
          {screenshots}
          {editor}
          <div className="assistant-home-input-foot">
            <button type="button" className="assistant-attach" aria-label="添加资料" onClick={openContextPicker}><Icon name="plus" size={14} strokeWidth={2} /></button>
            {chipResumes.map((context) => (
              <span key={contextKey(context)} className="v3-chip assistant-home-resume-chip">
                <span>简历 · {context.label}</span>
                <button type="button" aria-label={`移除上下文 ${context.label}`} onClick={() => removeContext(context)}><Icon name="x" size={10} /></button>
              </span>
            ))}
            <span className="assistant-home-input-spacer" />
            {modelPicker(true)}
            {sendButton}
          </div>
        </div>
      ) : (
        <>
          {resumeChips}
          <div className="assistant-input">
            {mentionMenu}
            <div className="assistant-input-content">{screenshots}{editor}</div>
            {sendButton}
          </div>
          <div className="assistant-composer-foot">
            <button type="button" className="assistant-add-context" onClick={openContextPicker}>
              <Icon name="plus" size={11} strokeWidth={2} />添加资料
            </button>
            {modelPicker(false)}
          </div>
        </>
      )}
    </form>
  );

  const renderMessages = () => current.messages.filter((message) => message !== pendingClarification).map((message, index) => {
    const messageIndex = current.messages.indexOf(message);
    const source = current.messages.slice(0, messageIndex + 1).filter((item) => item.role === "user").slice(-1)[0];
    const next = current.messages[messageIndex + 1];
    const proposalGroupAfterMessage = source && (!next || next.role === "user") ? String(source.sequence_no) : null;
    return (
      <Fragment key={`${message.sequence_no}-${message.created_at}-${index}`}>
        <article className={`assistant-message is-${message.role}${message.status ? ` is-${message.status}` : ""}`}>
          <div className="assistant-message-body">
            {message.screenshots && <ScreenshotStrip images={message.screenshots} sent activeKey={activePreviewKey} onOpen={openPreview} />}
            {message.role === "user" && message.contexts && message.contexts.length > 0 ? (
              <UserMessageContent
                content={messageText(message)}
                contexts={message.contexts}
                activePreviewKey={activePreviewKey}
                unavailableKeys={unavailableKeys}
                onOpen={openContextPreview}
              />
            ) : (
              <div className="assistant-message-content" onClick={message.role === "assistant" ? handleAssistantClick : undefined}>
                <AgentMarkdown content={message.role === "assistant" ? linkContextMentions(messageText(message), sessionContexts) : messageText(message)} />
              </div>
            )}
            {message.generatedDocument && <GeneratedDocumentCard document={message.generatedDocument} active={activePreviewKey === previewTabKey(message.generatedDocument)} onOpen={() => openPreview(message.generatedDocument!)} />}
            {message.artifactFollowup && <p className="assistant-artifact-followup">{message.artifactFollowup}</p>}
            {message.localOnly && message.role === "assistant" && !message.generatedDocument && <BeTag />}
            {message.status === "stopped" && <small className="assistant-stopped-label">已停止生成</small>}
            {message.status === "failed" && <small className="assistant-stopped-label">生成未完成</small>}
            <MessageActions content={messageText(message)} createdAt={message.created_at} timeLabel={formatTime(message.created_at)} />
          </div>
        </article>
        {proposalGroupAfterMessage && proposalPanel(proposalGroupAfterMessage)}
        {showPrepChecklist && message === latestAssistant && prepChecklist}
      </Fragment>
    );
  });

  if (workspaceSection) return null;

  return (
    <V3Shell
      active="home"
      scroll={false}
      contentClassName={`assistant-v3-content${previewOpen && sessionPreviewTabs.length ? " has-preview" : ""}`}
      onNewConversation={() => void createNewConversation()}
      onSelectSession={(id) => void selectSession(id)}
    >
      <style>{`.v3-content.assistant-v3-content.has-preview { --assistant-preview-width: ${previewWidth}px; }`}</style>
      <section style={{ "--assistant-preview-width": `${previewWidth}px` } as CSSProperties} className={`assistant-conversation${isHome ? " is-empty" : ""}`} aria-label="AI 求职助手工作区">
        {!isHome && allFileCount > 0 && !(previewOpen && sessionPreviewTabs.length) && (
          <button type="button" className="assistant-files-toggle" onClick={openAllFiles} aria-label={`查看本会话的 ${allFileCount} 个文件`}>
            <Icon name="panel" size={15} />
            <span>{allFileCount} 个文件</span>
          </button>
        )}

        {conversationPending ? (
          <PageLoading label="正在读取对话…" scope="workspace" />
        ) : current.loadState === "error" ? (
          <div className="assistant-session-error" role="alert">
            <p>对话暂时无法读取</p>
            <button type="button" className="v3-btn v3-btn-ghost" onClick={() => void selectSession(activeKey, true)}>重试</button>
          </div>
        ) : isHome ? (
          <div className="assistant-home" aria-label="开始使用 AI 求职助手">
            {/* 首页文字不用骨架：加载时先占住同样的高度，数据到了整行从下方慢慢浮现 */}
            <h1 className="assistant-home-title">
              {home.status === "loading" && !copy
                ? <span className="assistant-home-rise-slot" aria-hidden="true" />
                : <span className="assistant-home-rise">{copy ? <>{greetingPrefix(now)}{displayName ? `，${displayName}` : ""}。{copy.title}</> : "首页信息暂时无法读取"}</span>}
            </h1>
            <p className="assistant-home-sub">
              {home.status === "loading" && !copy
                ? <span className="assistant-home-rise-slot" aria-hidden="true" />
                : <span className="assistant-home-rise is-delay-1">{copy ? copy.subtitle
                  : <>请稍后重试。<button type="button" className="v3-link" onClick={home.retry}>重新加载</button></>}</span>}
            </p>
            {composer}
            {copy && (
              <div className="assistant-home-chips assistant-home-rise is-delay-2" aria-label="快捷指令">
                {copy.chips.map((chip) => (
                  <button type="button" key={chip} className="v3-chip assistant-home-chip" onClick={() => applyQuickPrompt(chip)}>{chip}</button>
                ))}
              </div>
            )}
            {home.status === "loading" && <div className="assistant-home-chips is-placeholder" aria-hidden="true" />}
            {dashboard && (
              <div className="assistant-home-cards assistant-home-cards-rise">
                {dashboard.cards.map((card, index) => <HomeCardView key={`${card.kind}-${index}`} card={card} now={now} />)}
              </div>
            )}
            {/* 加载中只占位不画骨架，卡片到了再逐张浮现 */}
            {home.status === "loading" && <div className="assistant-home-cards is-placeholder" role="status" aria-label="正在加载首页信息…" />}
          </div>
        ) : (
          <>
            <div
              className="assistant-message-viewport"
              ref={messageViewportRef}
              onScroll={handleMessageViewportScroll}
              aria-live={current.running ? "off" : "polite"}
            >
              <div className="assistant-thread">
                {renderMessages()}
                {thinking}
                {[...new Set(current.proposals.map(proposalGroup))]
                  .filter((group) => group.startsWith("history-"))
                  .map((group) => <div className="assistant-orphan-proposal" key={group}>{proposalPanel(group)}</div>)}
              </div>
            </div>
            <div className="assistant-composer-dock">{composer}</div>
          </>
        )}
      </section>

      <MotionPresence>{previewOpen && sessionPreviewTabs.length > 0 && (
        <PreviewPanel
          tabs={sessionPreviewTabs}
          width={previewWidth}
          onWidthChange={setPreviewWidth}
          onUnavailable={(key) => setUnavailableKeys((keys) => keys.includes(key) ? keys : [...keys, key])}
          onSaveGenerated={saveGeneratedDocument}
          onNotice={setNotice}
          activeKey={previewActive[activeKey] ?? null}
          onActivate={(key) => setPreviewActive((all) => ({ ...all, [activeKey]: key }))}
          onCloseTab={closePreviewTab}
          onClose={() => setPreviewOpen(false)}
        />
      )}</MotionPresence>

      <MotionPresence>{current.error && (
        <Toast title="本次请求未完成" message={current.error} kind="error" onDismiss={() => updateConversation(activeKey, { error: null })} />
      )}</MotionPresence>
      <MotionPresence>{notice && <Toast title="提示" message={notice} onDismiss={() => setNotice(null)} />}</MotionPresence>

      <MotionPresence>{contextPickerOpen && (
        <Dialog width={560} label="选择资料" onClose={closeContextPicker} className="assistant-context-dialog">
          <div className="v3-dialog-body">
            <h2 className="v3-dialog-title">添加资料</h2>
            <p className="v3-dialog-sub">选择本轮对话需要参考的内容，每类最多一项</p>
            <div className="assistant-context-types" role="tablist" aria-label="上下文类型">
              {CONTEXT_TYPES.map(({ type, label, icon }) => (
                <button type="button" role="tab" aria-selected={contextType === type} className={contextType === type ? "is-active" : undefined} key={type} onClick={() => void loadContexts(type)}>
                  <Icon name={icon} size={13} />{label}
                </button>
              ))}
            </div>
            <div
              className="assistant-context-search"
              onKeyDown={(event) => { if (event.key === "Enter") void loadContexts(contextType, contextSearch); }}
            >
              <SearchBox value={contextSearch} onChange={setContextSearch} placeholder="搜索资料" label="搜索资料" />
            </div>
            {contextLoading && <p className="assistant-context-status">正在读取可选资料…</p>}
            {contextError && <p className="assistant-context-error" role="alert">{contextError}</p>}
            {!contextLoading && !contextError && contextOptions.length === 0 && <p className="assistant-context-status">暂无可选择的{contextLabel(contextType)}。</p>}
            {!contextLoading && !contextError && contextOptions.length > 0 && (
              <div className="v3-gcard assistant-context-options">
                {contextOptions.map((context) => {
                  const selected = contextDrafts.some((item) => contextKey(item) === contextKey(context));
                  return (
                    <button type="button" className={`v3-grow${selected ? " is-selected" : ""}`} aria-pressed={selected} key={contextKey(context)} onClick={() => toggleContextDraft(context)}>
                      <Icon name={contextIcon(context.type)} size={15} />
                      <span className="v3-grow-copy"><strong>{context.label}</strong>{context.description && <small>{context.description}</small>}</span>
                      <span className="v3-grow-right">
                        {selected ? <Icon name="ccheck" size={16} aria-label="已选择" /> : <time className="v3-num" dateTime={context.updated_at ?? undefined}>{formatConversationDate(context.updated_at)}</time>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter left={<span className="assistant-context-count">已选 {contextDrafts.length} 项</span>}>
            <button type="button" className="v3-btn v3-btn-ghost" onClick={closeContextPicker}>取消</button>
            <button type="button" className="v3-btn v3-btn-dark" onClick={confirmContextDrafts}>添加 {contextDrafts.length} 项</button>
          </DialogFooter>
        </Dialog>
      )}</MotionPresence>
    </V3Shell>
  );
}
