import { Bot, CircleCheck, LoaderCircle, Send, ShieldCheck, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

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
};

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

export function AgentPanel({ resumeId, currentData, currentStyle, onBeforeConfirm, onApplied }: AgentPanelProps) {
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
  const abortRef = useRef<AbortController | null>(null);
  const activeResumeIdRef = useRef(resumeId);
  const messageListRef = useRef<HTMLDivElement>(null);
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

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading || running) return;
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
        { content, idempotency_key: idempotencyKey },
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
      <div className="agent-trust-note">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>助手只能读取当前简历；修改必须经你确认。</span>
      </div>

      <div className="agent-message-list" ref={messageListRef} aria-live="polite">
        {loading && <p className="agent-empty"><LoaderCircle aria-hidden="true" className="agent-spinner" />正在读取对话…</p>}
        {!loading && messages.length === 0 && (
          <div className="agent-empty-state">
            <Bot aria-hidden="true" size={22} />
            <strong>从一个具体目标开始</strong>
            <p>例如：检查这份简历最影响面试转化的三处表达，并给出可确认的修改建议。</p>
          </div>
        )}
        {messages.map((message, index) => (
          <article className={`agent-message is-${message.role}`} key={messageKey(message, index)}>
            <span>{message.role === "user" ? "你" : "助手"}</span>
            <p>{message.content}</p>
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

      <form className="agent-composer" onSubmit={sendMessage}>
        <label htmlFor="agent-message-input">告诉助手你想改善什么</label>
        <textarea
          id="agent-message-input"
          value={input}
          maxLength={32_768}
          placeholder="分析这份简历，并优先改进与目标岗位相关的表达"
          disabled={loading || running}
          onChange={(event) => setInput(event.target.value)}
        />
        <div>
          <small>提案不会自动覆盖简历</small>
          {running ? (
            <Button icon={<Square aria-hidden="true" />} size="sm" variant="secondary" onClick={() => void cancelRun()}>停止</Button>
          ) : (
            <Button disabled={loading || !input.trim()} icon={<Send aria-hidden="true" />} size="sm" type="submit" variant="accent">发送</Button>
          )}
        </div>
      </form>
    </section>
  );
}
