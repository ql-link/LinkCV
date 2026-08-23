import { CircleCheck, LoaderCircle, Pencil, Plus, RotateCcw, Send, Sparkles, Square, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import {
  AgentMessage,
  AgentProposal,
  AgentStreamEvent,
  ApiRequestError,
  ResumeDocumentV1,
  ResumeStyleV1,
  api,
} from "../../api/client";
import { Button } from "@/components/ui";

type AgentPanelProps = {
  resumeId: string;
  currentData?: ResumeDocumentV1;
  currentStyle?: ResumeStyleV1;
  onBeforeConfirm: () => Promise<boolean>;
  onApplied: () => Promise<void>;
  onClose?: () => void;
  draft?: AgentSelectionDraft | null;
};

export type AgentSelectionDraft = {
  id: number;
  instruction: string;
  selectedText: string;
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
  };
  return messages[code] ?? "智能助手没有完成这次请求，请稍后重试。";
}

function messageKey(message: AgentMessage, index: number) {
  return `${message.sequence_no}-${message.role}-${index}`;
}

function messageTime(createdAt: string) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(created);
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

export function AgentPanel({ resumeId, currentData, currentStyle, onBeforeConfirm, onApplied, onClose = () => undefined, draft }: AgentPanelProps) {
  const [sessionBinding, setSessionBinding] = useState<{ resumeId: string; sessionId: string } | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [selectedContext, setSelectedContext] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeResumeIdRef = useRef(resumeId);
  const messageListRef = useRef<HTMLDivElement>(null);
  const handledDraftIdRef = useRef<number | null>(null);
  activeResumeIdRef.current = resumeId;
  const sessionId = sessionBinding?.resumeId === resumeId ? sessionBinding.sessionId : null;

  useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setSessionBinding(null);
    setMessages([]);
    setProposals([]);
    setInput("");
    setLoading(true);
    setRunning(false);
    setRunId(null);
    setToolStatus(null);
    setError(null);
    setProposalBusyId(null);
    setSelectedContext(null);
    Promise.all([api.listAgentSessions(resumeId), api.listAgentProposals(resumeId)])
      .then(async ([sessionResult, proposalResult]) => {
        if (cancelled) return;
        setProposals(proposalResult.proposals);
        const session = sessionResult.sessions[0];
        if (!session) return;
        const detail = await api.getAgentSession(session.id);
        if (!cancelled) {
          setSessionBinding({ resumeId, sessionId: session.id });
          setMessages(detail.session.messages);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(agentErrorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [resumeId]);

  useEffect(() => {
    if (!draft || handledDraftIdRef.current === draft.id) return;
    handledDraftIdRef.current = draft.id;
    setSelectedContext(draft.selectedText);
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
    } else if (event.type === "tool.started") {
      setToolStatus(event.tool === "get_resume_context" ? "正在读取当前简历…" : "正在生成待确认提案…");
    } else if (event.type === "tool.completed") {
      setToolStatus(null);
    } else if (event.type === "proposal.created") {
      setProposals((current) => [event.proposal, ...current.filter((item) => item.id !== event.proposal.id)]);
    } else if (event.type === "run.failed") {
      setError(agentErrorMessage(new ApiRequestError(502, event.error)));
    }
  };

  const runMessage = async (content: string) => {
    if (!content || loading || running) return;
    const requestContent = selectedContext
      ? `${content}\n\n选中的简历内容：\n${selectedContext}`
      : content;
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
    abortRef.current = controller;
    try {
      const currentSessionId = await ensureSession();
      const idempotencyKey = globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? `${Date.now()}_agent`;
      await api.streamAgentMessage(
        currentSessionId,
        { content: requestContent, idempotency_key: idempotencyKey },
        controller.signal,
        (streamEvent) => {
          if (activeResumeIdRef.current === requestedResumeId) handleEvent(streamEvent);
        },
      );
      if (activeResumeIdRef.current !== requestedResumeId) return;
      const detail = await api.getAgentSession(currentSessionId);
      if (activeResumeIdRef.current === requestedResumeId) setMessages(detail.session.messages);
    } catch (reason) {
      if (!controller.signal.aborted && activeResumeIdRef.current === requestedResumeId) {
        setError(agentErrorMessage(reason));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (activeResumeIdRef.current === requestedResumeId) {
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
    abortRef.current?.abort();
    abortRef.current = null;
    setSessionBinding(null);
    setMessages([]);
    setInput("");
    setSelectedContext(null);
    setRunning(false);
    setRunId(null);
    setToolStatus(null);
    setError(null);
  };

  const regenerateLastAnswer = () => {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const content = latestUserMessage?.content.split("\n\n选中的简历内容：\n")[0]?.trim();
    if (content) void runMessage(content);
  };

  const cancelRun = async () => {
    if (runId) await api.cancelAgentRun(runId).catch(() => undefined);
    abortRef.current?.abort();
    setRunning(false);
    setToolStatus(null);
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
          <button type="button" aria-label="新建对话" title="新建对话" onClick={startNewConversation}><Plus size={17} /></button>
          <button type="button" aria-label="关闭智能助手" title="关闭" onClick={onClose}><X size={17} /></button>
        </div>
      </header>

      <div className="agent-message-list" ref={messageListRef} aria-live="polite">
        {loading && <p className="agent-empty"><LoaderCircle aria-hidden="true" className="agent-spinner" />正在读取对话…</p>}
        {!loading && messages.length === 0 && (
          <div className="agent-welcome-message">
            <strong>你好！我是你的 AI 简历助手</strong>
            <p>专注于为你提供简历优化建议。你可以直接输入问题，也可以先选中一段简历内容。</p>
          </div>
        )}
        {messages.map((message, index) => (
          <article className={`agent-message is-${message.role}`} key={messageKey(message, index)}>
            <div className="agent-message-row">
              <div className="agent-message-bubble">
                {message.role === "assistant" && <span className="agent-message-mark" aria-hidden="true"><Sparkles size={15} /></span>}
                <AgentMarkdown content={message.content} />
              </div>
              {message.role === "user" && <span className="agent-user-avatar" aria-hidden="true"><UserRound size={15} /></span>}
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

      {messages.some((message) => message.role === "assistant") && !running && (
        <button type="button" className="agent-regenerate" onClick={regenerateLastAnswer}>
          <RotateCcw aria-hidden="true" size={14} />重新生成
        </button>
      )}

      <form className="agent-composer" onSubmit={sendMessage}>
        {selectedContext && (
          <div className="agent-selection-context">
            <span><Sparkles aria-hidden="true" size={13} />已选内容</span>
            <p>{selectedContext}</p>
            <button type="button" onClick={() => setSelectedContext(null)}>移除上下文</button>
          </div>
        )}
        <div className="agent-quick-prompts" aria-label="AI 快捷指令">
          {agentQuickPrompts.map(({ label, prompt, icon: PromptIcon }) => (
            <button type="button" key={label} onClick={() => setInput(prompt)}>
              <PromptIcon aria-hidden="true" size={14} />{label}
            </button>
          ))}
        </div>
        <label className="visually-hidden" htmlFor="agent-message-input">告诉助手你想改善什么</label>
        <div className="agent-input-shell">
          <textarea
            id="agent-message-input"
            value={input}
            maxLength={32_768}
            placeholder="输入你的问题…"
            disabled={loading || running}
            onChange={(event) => setInput(event.target.value)}
          />
          {running ? (
            <button className="agent-send-button is-stop" type="button" aria-label="停止生成" onClick={() => void cancelRun()}><Square aria-hidden="true" size={15} /></button>
          ) : (
            <button className="agent-send-button" disabled={loading || !input.trim()} type="submit" aria-label="发送"><Send aria-hidden="true" size={17} /></button>
          )}
        </div>
        <small className="agent-composer-note">修改提案不会自动覆盖简历，需要你确认后应用。</small>
      </form>
    </section>
  );
}
