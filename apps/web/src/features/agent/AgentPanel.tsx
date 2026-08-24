import { ChevronLeft, CircleCheck, History, LoaderCircle, Pencil, Plus, RotateCcw, Send, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import {
  AgentMessage,
  AgentClarification,
  AgentProposal,
  AgentSession,
  AgentSelectionContext,
  AgentStreamEvent,
  ApiRequestError,
  ResumeDocumentV1,
  ResumeStyleV1,
  api,
} from "../../api/client";
import { Avatar, AvatarFallback, AvatarImage, Button, PageLoading } from "@/components/ui";

type AgentPanelProps = {
  resumeId: string;
  currentData?: ResumeDocumentV1;
  currentStyle?: ResumeStyleV1;
  userAvatarUrl?: string | null;
  userDisplayName?: string;
  onBeforeRun?: () => Promise<boolean>;
  onBeforeConfirm: () => Promise<boolean>;
  onApplied: () => Promise<void>;
  onClose?: () => void;
  draft?: AgentSelectionDraft | null;
};

export type AgentSelectionDraft = {
  id: number;
  instruction: string;
  selectionContext: AgentSelectionContext;
};

const agentQuickPrompts = [
  { label: "检查问题", prompt: "检查最影响投递的表达", icon: CircleCheck },
  { label: "优化内容", prompt: "让经历更贴合目标岗位", icon: Pencil },
  { label: "提炼亮点", prompt: "提炼这份简历的技术亮点", icon: Sparkles },
];

const sectionLabels: Record<keyof ResumeDocumentV1["sections"], string> = {
  work_experiences: "工作经历",
  educations: "教育经历",
  projects: "项目经历",
  skills: "技能",
  certificates: "证书",
  awards: "奖项",
  languages: "语言",
  custom_sections: "自定义内容",
};

function proposalChanges(
  proposal: AgentProposal,
  currentData?: ResumeDocumentV1,
  currentStyle?: ResumeStyleV1,
) {
  if (proposal.operations?.length) {
    return proposal.operations.map((operation, index) => ({
      label: operation.op === "insert_after_target" ? `新增内容 ${index + 1}` : `修改内容 ${index + 1}`,
      before: typeof operation.target.selected_text === "string"
        ? operation.target.selected_text
        : "当前定位内容",
      after: operation.new_text,
    }));
  }
  if (!currentData || !currentStyle) return [];
  const changes: Array<{ label: string; before: string; after: string }> = [];
  if (JSON.stringify(currentData.basics) !== JSON.stringify(proposal.data.basics)) {
    changes.push({ label: "基本信息", before: "当前内容", after: "有修改" });
  }
  for (const key of Object.keys(sectionLabels) as Array<keyof ResumeDocumentV1["sections"]>) {
    const before = currentData.sections[key];
    const after = proposal.data.sections[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({ label: sectionLabels[key], before: `${before.length} 项`, after: `${after.length} 项` });
    }
  }
  if (JSON.stringify(currentStyle) !== JSON.stringify(proposal.style)) {
    changes.push({ label: "排版样式", before: currentStyle.template_key, after: proposal.style.template_key });
  }
  return changes;
}

function agentErrorMessage(error: unknown) {
  const code = error instanceof ApiRequestError ? error.message : "";
  const messages: Record<string, string> = {
    AGENT_UNAVAILABLE: "智能助手暂时不可用，简历编辑不受影响。",
    AGENT_STREAM_INCOMPLETE: "智能助手连接意外中断，请稍后重试。",
    AGENT_MODEL_UNAVAILABLE: "当前模型暂时不可用，请稍后重试。",
    AGENT_MODEL_UNSUPPORTED: "当前管理员模型暂不受智能助手支持。",
    AGENT_MODEL_TIMEOUT: "当前模型响应超时，请稍后重试。",
    AGENT_MODEL_REQUEST_FAILED: "当前模型请求失败，请稍后重试。",
    AGENT_TIMEOUT: "智能助手本轮运行超时，请稍后重试。",
    AGENT_RUN_IN_PROGRESS: "上一条请求仍在处理中，请等待或取消后重试。",
    RESUME_EDIT_CONFLICT: "简历已发生新的修改，这份提案没有应用。请重新生成建议。",
    TARGET_STALE: "所选内容已发生变化，请重新选择后再试。",
    TARGET_RESOLUTION_REQUIRED: "还不能唯一定位要处理的内容，请重新选择或说得更具体。",
    DIAGNOSIS_REQUIRED: "诊断依据已失效，请重新分析后再生成修改。",
    SKILL_MODE_CONFLICT: "本轮同时出现了不同修改方式，请新建对话后只选择一种方式。",
    PATCH_OUT_OF_SCOPE: "修改超出了已定位范围，系统没有创建提案。",
    SOURCE_REQUIRED: "从资料生成内容前需要先选择可追溯的授权资料。",
    SOURCE_FORBIDDEN: "引用资料不存在、已变化或不属于当前账号。",
    AGENT_CLARIFICATION_STALE: "这个问题已经更新，请按当前问题重新回答。",
  };
  return messages[code] ?? "智能助手没有完成这次请求，请稍后重试。";
}

function messageKey(message: AgentMessage, index: number) {
  return `${message.sequence_no}-${message.role}-${index}`;
}

const agentToolLabels: Record<string, string> = {
  resolve_resume_target: "正在定位所选内容…",
  get_resume_context: "正在读取授权简历上下文…",
  search_resume_materials: "正在查找你的资料…",
  analyze_resume_content: "正在进行结构化诊断…",
  create_resume_change_proposal: "正在生成待确认修改…",
  create_resume_proposal: "正在生成待确认修改…",
};

function messageTime(createdAt: string) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(created);
}

function conversationTime(createdAt: string) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(created);
}

function pendingClarificationMessage(messages: AgentMessage[]) {
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && last.message_type === "clarification" && last.clarification
    ? last
    : null;
}

type ClarificationAnswer = { optionId: string; other: string };

function clarificationAnswerText(
  clarification: AgentClarification,
  answers: Record<string, ClarificationAnswer>,
) {
  return clarification.questions.map((question) => {
    const answer = answers[question.id];
    const selected = question.options.find((option) => option.id === answer?.optionId);
    return `${question.header}：${answer?.optionId === "__other__" ? answer.other.trim() : selected?.label ?? ""}`;
  }).join("\n");
}

function avatarFallback(displayName: string) {
  return [...displayName.trim()][0]?.toLocaleUpperCase("zh-CN") ?? "用";
}

export function AgentUserAvatar({ avatarUrl, displayName = "用户" }: { avatarUrl?: string | null; displayName?: string }) {
  return (
    <Avatar className="agent-user-avatar">
      {avatarUrl && <AvatarImage src={avatarUrl} alt={`${displayName}的头像`} width={32} height={32} />}
      <AvatarFallback aria-label={`${displayName}的头像`}>{avatarFallback(displayName)}</AvatarFallback>
    </Avatar>
  );
}

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function AgentMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]?.trimEnd() ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```") ) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]?.startsWith("```")) code.push(lines[index++] ?? "");
      index += 1;
      blocks.push(<pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? "")) items.push((lines[index++] ?? "").replace(/^[-*]\s+/, ""));
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push(<strong className="agent-markdown-heading" key={`heading-${index}`}>{inlineMarkdown(heading[2] ?? "")}</strong>);
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]?.trim() && !/^(```|[-*]\s+|#{1,3}\s+)/.test(lines[index] ?? "")) paragraph.push(lines[index++] ?? "");
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join("\n"))}</p>);
  }
  return <div className="agent-message-content">{blocks}</div>;
}

export function AgentPanel({
  resumeId,
  currentData,
  currentStyle,
  userAvatarUrl,
  userDisplayName = "用户",
  onBeforeRun = async () => true,
  onBeforeConfirm,
  onApplied,
  onClose = () => undefined,
  draft,
}: AgentPanelProps) {
  const [sessionBinding, setSessionBinding] = useState<{ resumeId: string; sessionId: string } | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [conversationView, setConversationView] = useState<"conversation" | "history">("conversation");
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [selectedContext, setSelectedContext] = useState<AgentSelectionContext | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, ClarificationAnswer>>({});
  const [clarificationAttempted, setClarificationAttempted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRequestRef = useRef(0);
  const streamRequestRef = useRef(0);
  const activeResumeIdRef = useRef(resumeId);
  const messageListRef = useRef<HTMLDivElement>(null);
  const handledDraftIdRef = useRef<number | null>(null);
  activeResumeIdRef.current = resumeId;
  const sessionId = sessionBinding?.resumeId === resumeId ? sessionBinding.sessionId : null;
  const pendingClarification = pendingClarificationMessage(messages);

  useEffect(() => {
    streamRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setSessionBinding(null);
    setMessages([]);
    setProposals([]);
    setInput("");
    setLoading(false);
    setRunning(false);
    setRunId(null);
    setToolStatus(null);
    setError(null);
    setProposalBusyId(null);
    setSelectedContext(null);
    setConversationView("conversation");
    setSessions([]);
    setHistoryLoading(false);
    setHistoryError(null);
    setClarificationAnswers({});
    setClarificationAttempted(false);
    return () => {
      abortRef.current?.abort();
    };
  }, [resumeId]);

  useEffect(() => {
    setClarificationAnswers({});
    setClarificationAttempted(false);
  }, [pendingClarification?.sequence_no]);

  useEffect(() => {
    if (!draft || handledDraftIdRef.current === draft.id) return;
    handledDraftIdRef.current = draft.id;
    setSelectedContext(draft.selectionContext);
    setInput(draft.instruction);
    setError(null);
  }, [draft]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (typeof messageList?.scrollTo === "function") {
      messageList.scrollTo({ top: messageList.scrollHeight });
    }
  }, [messages, toolStatus]);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const requestedResumeId = resumeId;
    const result = await api.createAgentSession(requestedResumeId);
    if (activeResumeIdRef.current !== requestedResumeId) {
      throw new DOMException("Agent resume changed", "AbortError");
    }
    setSessionBinding({ resumeId: requestedResumeId, sessionId: result.session.id });
    return result.session.id;
  };

  const handleEvent = (event: AgentStreamEvent) => {
    if (event.type === "run.started") {
      setRunId(event.runId);
    } else if (event.type === "assistant.delta") {
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role === "assistant" && last.sequence_no === -1 && last.message_type === "clarification") {
          return current;
        }
        if (last?.role === "assistant" && last.sequence_no === -1) {
          return [...current.slice(0, -1), { ...last, content: last.content + event.delta }];
        }
        return [...current, {
          sequence_no: -1,
          role: "assistant",
          content: event.delta,
          created_at: new Date().toISOString(),
        }];
      });
    } else if (event.type === "clarification.requested") {
      setMessages((current) => {
        const withoutTemporaryAssistant = current.filter((message) => !(message.role === "assistant" && message.sequence_no === -1));
        return [...withoutTemporaryAssistant, {
          sequence_no: -1,
          role: "assistant",
          message_type: "clarification",
          clarification: event.clarification,
          content: "",
          created_at: new Date().toISOString(),
        }];
      });
    } else if (event.type === "tool.started") {
      setToolStatus(agentToolLabels[event.tool] ?? "正在处理…");
    } else if (event.type === "tool.completed") {
      setToolStatus(null);
    } else if (event.type === "proposal.created") {
      setProposals((current) => [event.proposal, ...current.filter((item) => item.id !== event.proposal.id)]);
    } else if (event.type === "run.failed") {
      setError(agentErrorMessage(new ApiRequestError(502, event.error)));
    }
  };

  const runMessage = async (content: string, replyToSequenceNo?: number) => {
    if (!content || loading || running || (pendingClarification && replyToSequenceNo === undefined)) return;
    const runSelectionContext = selectedContext;
    if (runSelectionContext && !await onBeforeRun()) return;
    const requestedResumeId = resumeId;
    setInput("");
    setError(null);
    setRunning(true);
    setToolStatus(null);
    setMessages((current) => [...current, {
      sequence_no: -2,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    }]);
    const controller = new AbortController();
    const streamRequestId = streamRequestRef.current + 1;
    streamRequestRef.current = streamRequestId;
    abortRef.current = controller;
    let currentSessionId: string | null = null;
    try {
      currentSessionId = await ensureSession();
      const idempotencyKey = globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? `${Date.now()}_agent`;
      await api.streamAgentMessage(
        currentSessionId,
        {
          content,
          idempotency_key: idempotencyKey,
          ...(runSelectionContext ? { selection_context: runSelectionContext } : {}),
          ...(replyToSequenceNo !== undefined ? { reply_to_sequence_no: replyToSequenceNo } : {}),
        },
        controller.signal,
        (streamEvent) => {
          if (
            streamRequestRef.current === streamRequestId &&
            activeResumeIdRef.current === requestedResumeId
          ) handleEvent(streamEvent);
        },
      );
      if (
        streamRequestRef.current !== streamRequestId ||
        activeResumeIdRef.current !== requestedResumeId
      ) return;
      const detail = await api.getAgentSession(currentSessionId);
      if (
        streamRequestRef.current === streamRequestId &&
        activeResumeIdRef.current === requestedResumeId
      ) {
        setMessages(detail.session.messages);
        const proposalResult = await api.listAgentProposals(requestedResumeId, currentSessionId);
        if (
          streamRequestRef.current === streamRequestId &&
          activeResumeIdRef.current === requestedResumeId
        ) setProposals(proposalResult.proposals);
      }
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        streamRequestRef.current === streamRequestId &&
        activeResumeIdRef.current === requestedResumeId
      ) {
        setError(agentErrorMessage(reason));
        if (reason instanceof ApiRequestError && reason.message === "AGENT_CLARIFICATION_STALE" && currentSessionId) {
          try {
            const [detail, proposalResult] = await Promise.all([
              api.getAgentSession(currentSessionId),
              api.listAgentProposals(requestedResumeId, currentSessionId),
            ]);
            if (
              streamRequestRef.current === streamRequestId &&
              activeResumeIdRef.current === requestedResumeId
            ) {
              setMessages(detail.session.messages);
              setProposals(proposalResult.proposals);
            }
          } catch {
            // Keep the actionable stale-answer error when refreshing the latest question also fails.
          }
        }
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (
        streamRequestRef.current === streamRequestId &&
        activeResumeIdRef.current === requestedResumeId
      ) {
        setRunning(false);
        setRunId(null);
        setToolStatus(null);
      }
    }
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    void runMessage(input.trim());
  };

  const startNewConversation = () => {
    streamRequestRef.current += 1;
    if (runId) void api.cancelAgentRun(runId).catch(() => undefined);
    abortRef.current?.abort();
    abortRef.current = null;
    setSessionBinding(null);
    setMessages([]);
    setProposals([]);
    setInput("");
    setSelectedContext(null);
    setConversationView("conversation");
    setClarificationAnswers({});
    setClarificationAttempted(false);
    setRunning(false);
    setRunId(null);
    setToolStatus(null);
    setError(null);
  };

  const openHistory = async () => {
    setConversationView("history");
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await api.listAgentSessions(resumeId);
      setSessions(result.sessions);
    } catch (reason) {
      setHistoryError(agentErrorMessage(reason));
    } finally {
      setHistoryLoading(false);
    }
  };

  const selectSession = async (selectedSession: AgentSession) => {
    const requestId = sessionRequestRef.current + 1;
    sessionRequestRef.current = requestId;
    streamRequestRef.current += 1;
    if (runId) await api.cancelAgentRun(runId).catch(() => undefined);
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setRunId(null);
    setToolStatus(null);
    setLoading(true);
    setError(null);
    setMessages([]);
    setProposals([]);
    setSelectedContext(null);
    try {
      const [detail, proposalResult] = await Promise.all([
        api.getAgentSession(selectedSession.id),
        api.listAgentProposals(resumeId, selectedSession.id),
      ]);
      if (sessionRequestRef.current !== requestId) return;
      setSessionBinding({ resumeId, sessionId: selectedSession.id });
      setMessages(detail.session.messages);
      setProposals(proposalResult.proposals);
      setConversationView("conversation");
    } catch (reason) {
      if (sessionRequestRef.current === requestId) setHistoryError(agentErrorMessage(reason));
    } finally {
      if (sessionRequestRef.current === requestId) setLoading(false);
    }
  };

  const submitClarification = () => {
    if (!pendingClarification?.clarification) return;
    setClarificationAttempted(true);
    const complete = pendingClarification.clarification.questions.every((question) => {
      const answer = clarificationAnswers[question.id];
      return Boolean(answer?.optionId && (answer.optionId !== "__other__" || answer.other.trim()));
    });
    if (!complete) return;
    void runMessage(
      clarificationAnswerText(pendingClarification.clarification, clarificationAnswers),
      pendingClarification.sequence_no,
    );
  };

  const regenerateLastAnswer = () => {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const content = latestUserMessage?.content.trim();
    if (content) void runMessage(content);
  };

  const cancelRun = async () => {
    streamRequestRef.current += 1;
    if (runId) await api.cancelAgentRun(runId).catch(() => undefined);
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setRunId(null);
    setToolStatus(null);
  };

  const closePanel = () => {
    streamRequestRef.current += 1;
    if (runId) void api.cancelAgentRun(runId).catch(() => undefined);
    abortRef.current?.abort();
    onClose();
  };

  const confirmProposal = async (proposal: AgentProposal) => {
    setProposalBusyId(proposal.id);
    setError(null);
    try {
      if (!await onBeforeConfirm()) return;
      await api.confirmAgentProposal(proposal.id);
      setProposals((current) => current.filter((item) => item.id !== proposal.id));
      await onApplied();
    } catch (reason) {
      setError(agentErrorMessage(reason));
    } finally {
      setProposalBusyId(null);
    }
  };

  const rejectProposal = async (proposal: AgentProposal) => {
    setProposalBusyId(proposal.id);
    setError(null);
    try {
      await api.rejectAgentProposal(proposal.id);
      setProposals((current) => current.filter((item) => item.id !== proposal.id));
    } catch (reason) {
      setError(agentErrorMessage(reason));
    } finally {
      setProposalBusyId(null);
    }
  };

  return (
    <section className="agent-panel" aria-label="简历智能助手">
      <header className="agent-panel-head">
        <div className="agent-panel-identity">
          <span className="agent-mark" aria-hidden="true"><Sparkles size={16} /></span>
          <span><strong id="workbench-agent-title">AI 简历助手</strong><small>{selectedContext ? "正在处理所选内容" : "智能优化，高效提升"}</small></span>
        </div>
        <div className="agent-panel-head-actions">
          {conversationView === "history" ? (
            <button type="button" aria-label="返回当前对话" title="返回当前对话" onClick={() => setConversationView("conversation")}><ChevronLeft size={17} /></button>
          ) : (
            <button type="button" aria-label="历史对话" title="历史对话" onClick={() => void openHistory()}><History size={17} /></button>
          )}
          <button type="button" aria-label="新建对话" title="新建对话" onClick={startNewConversation}><Plus size={17} /></button>
          <button type="button" aria-label="关闭智能助手" title="关闭" onClick={closePanel}><X size={17} /></button>
        </div>
      </header>

      {conversationView === "history" ? (
        <section className="agent-conversation-history" aria-label="历史对话">
          <header><strong>历史对话</strong><small>当前简历 · 最近 50 条</small></header>
          {historyLoading && <PageLoading label="正在读取历史对话…" scope="panel" />}
          {historyError && <div className="agent-error" role="alert">{historyError}<button type="button" onClick={() => void openHistory()}>重试</button></div>}
          {!historyLoading && !historyError && sessions.length === 0 && <p className="agent-empty">暂无历史对话。发送第一条消息后会显示在这里。</p>}
          {!historyLoading && !historyError && sessions.length > 0 && (
            <div className="agent-conversation-list">
              {sessions.map((item) => (
                <button
                  type="button"
                  className={item.id === sessionId ? "is-current" : undefined}
                  key={item.id}
                  onClick={() => void selectSession(item)}
                >
                  <span>{item.title}</span>
                  <small>{conversationTime(item.last_message_at ?? item.created_at)}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : <>
      <div className="agent-message-list" ref={messageListRef} aria-live="polite">
        {loading && <PageLoading label="正在读取对话…" scope="panel" />}
        {!loading && messages.length === 0 && (
          <div className="agent-welcome-message">
            <strong>你好！我是你的 AI 简历助手</strong>
            <p>专注于为你提供简历优化建议。你可以直接输入问题，也可以先选中一段简历内容。</p>
          </div>
        )}
        {messages.filter((message) => message !== pendingClarification).map((message, index) => (
          <article className={`agent-message is-${message.role}`} key={messageKey(message, index)}>
            <div className="agent-message-row">
              <div className="agent-message-bubble">
                {message.role === "assistant" && <span className="agent-message-mark" aria-hidden="true"><Sparkles size={15} /></span>}
                <AgentMarkdown content={message.content} />
              </div>
              {message.role === "user" && <AgentUserAvatar avatarUrl={userAvatarUrl} displayName={userDisplayName} />}
            </div>
            <time dateTime={message.created_at}>{messageTime(message.created_at)}</time>
          </article>
        ))}
        {toolStatus && <p className="agent-tool-status"><LoaderCircle aria-hidden="true" className="agent-spinner" />{toolStatus}</p>}
      </div>

      {proposals.length > 0 && <div className="agent-proposal-list" aria-label="待确认修改提案">
        {proposals.map((proposal) => (
          <article className="agent-proposal" key={proposal.id}>
          <header>
            <span><CircleCheck aria-hidden="true" size={15} />待你确认</span>
            <small>基于版本 {proposal.base_lock_version}</small>
          </header>
          <p>{proposal.summary}</p>
          {proposal.rationale && proposal.rationale.length > 0 && (
            <ul className="agent-proposal-rationale" aria-label="修改依据">
              {proposal.rationale.map((item, index) => (
                <li key={`${item.code ?? "reason"}-${index}`}>{item.reason ?? item.message ?? JSON.stringify(item)}</li>
              ))}
            </ul>
          )}
          {proposalChanges(proposal, currentData, currentStyle).length > 0 && (
            <details className="agent-proposal-diff">
              <summary>查看修改范围</summary>
              <dl>
                {proposalChanges(proposal, currentData, currentStyle).map((change) => (
                  <div key={change.label}>
                    <dt>{change.label}</dt>
                    <dd><del>{change.before}</del><span aria-hidden="true">→</span><ins>{change.after}</ins></dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <div className="agent-proposal-actions">
            <Button
              disabled={proposalBusyId !== null || running}
              size="sm"
              variant="accent"
              onClick={() => void confirmProposal(proposal)}
            >
              {proposalBusyId === proposal.id ? "处理中…" : "应用到简历"}
            </Button>
            <Button
              disabled={proposalBusyId !== null}
              size="sm"
              variant="ghost"
              onClick={() => void rejectProposal(proposal)}
            >
              放弃提案
            </Button>
          </div>
          </article>
        ))}
      </div>}

      {error && <div className="agent-error" role="alert">{error}</div>}

      {messages.some((message) => message.role === "assistant") && !running && !pendingClarification && (
        <button type="button" className="agent-regenerate" onClick={regenerateLastAnswer}>
          <RotateCcw aria-hidden="true" size={14} />重新生成
        </button>
      )}

      <form className="agent-composer" onSubmit={sendMessage}>
        {selectedContext && (
          <div className="agent-selection-context">
            <span><Sparkles aria-hidden="true" size={13} />已选内容</span>
            <p>{selectedContext.selected_text}</p>
            <button type="button" onClick={() => setSelectedContext(null)}>移除上下文</button>
          </div>
        )}
        {pendingClarification?.clarification && (
          <section className="agent-clarification" aria-label="需要你确认">
            <header><Sparkles aria-hidden="true" size={15} /><span><strong>需要你确认</strong><small>回答后我再继续处理</small></span></header>
            {pendingClarification.clarification.questions.map((question) => {
              const answer = clarificationAnswers[question.id] ?? { optionId: "", other: "" };
              const missing = clarificationAttempted && (!answer.optionId || (answer.optionId === "__other__" && !answer.other.trim()));
              return (
                <fieldset key={question.id} aria-describedby={missing ? `${question.id}-error` : undefined}>
                  <legend><span>{question.header}</span>{question.question}</legend>
                  {question.options.map((option) => (
                    <label key={option.id}>
                      <input
                        type="radio"
                        name={`clarification-${question.id}`}
                        value={option.id}
                        checked={answer.optionId === option.id}
                        onChange={() => setClarificationAnswers((current) => ({ ...current, [question.id]: { optionId: option.id, other: "" } }))}
                      />
                      <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                    </label>
                  ))}
                  <label>
                    <input
                      type="radio"
                      name={`clarification-${question.id}`}
                      value="__other__"
                      checked={answer.optionId === "__other__"}
                      onChange={() => setClarificationAnswers((current) => ({ ...current, [question.id]: { optionId: "__other__", other: current[question.id]?.other ?? "" } }))}
                    />
                    <span><strong>其他</strong><small>用自己的话补充</small></span>
                  </label>
                  {answer.optionId === "__other__" && (
                    <input
                      className="agent-clarification-other"
                      aria-label={`${question.header}的其他回答`}
                      maxLength={500}
                      value={answer.other}
                      onChange={(event) => setClarificationAnswers((current) => ({ ...current, [question.id]: { optionId: "__other__", other: event.target.value } }))}
                    />
                  )}
                  {missing && <small className="agent-clarification-error" id={`${question.id}-error`}>请选择一个选项或填写其他答案。</small>}
                </fieldset>
              );
            })}
            <Button type="button" variant="accent" disabled={running} onClick={submitClarification}>提交回答</Button>
          </section>
        )}
        {!pendingClarification && <div className="agent-quick-prompts" aria-label="AI 快捷指令">
          {agentQuickPrompts.map(({ label, prompt, icon: PromptIcon }) => (
            <button type="button" key={label} onClick={() => setInput(prompt)}>
              <PromptIcon aria-hidden="true" size={14} />{label}
            </button>
          ))}
        </div>}
        <label className="visually-hidden" htmlFor="agent-message-input">告诉助手你想改善什么</label>
        <div className="agent-input-shell">
          <textarea
            id="agent-message-input"
            value={input}
            maxLength={32_768}
            placeholder={pendingClarification ? "请先回答上方问题…" : "输入你的问题…"}
            disabled={loading || running || Boolean(pendingClarification)}
            onChange={(event) => setInput(event.target.value)}
          />
          {running ? (
            <button className="agent-send-button is-stop" type="button" aria-label="停止生成" onClick={() => void cancelRun()}><Square aria-hidden="true" size={15} /></button>
          ) : (
            <button className="agent-send-button" disabled={loading || !input.trim() || Boolean(pendingClarification)} type="submit" aria-label="发送"><Send aria-hidden="true" size={17} /></button>
          )}
        </div>
        <small className="agent-composer-note">修改提案不会自动覆盖简历，需要你确认后应用。</small>
      </form>
      </>}
    </section>
  );
}
