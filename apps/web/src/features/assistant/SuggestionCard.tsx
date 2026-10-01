import { useEffect, useState } from "react";
import type { AgentProposal } from "../../api/client";
import { Icon } from "../../v3/Icon";

// 多项修改建议卡（Figma 189:579 / 189:539，交互说明「01 说明 · 多项修改建议」189:2）：
// 标签页跳到任意一项并显示状态；「采用此项」后自动切到下一项待确认；
// 「全部采用」一次处理剩余待确认项；全部处理完收起为一行摘要，点击可展开回看；
// 只有一项时不显示标签，按钮为「忽略 / 采用」。

type Change = { before: string; after: string };

export function proposalChanges(proposal: AgentProposal): Change[] {
  if (proposal.preview?.changes?.length) return proposal.preview.changes.map(({ before, after }) => ({ before, after }));
  if (proposal.operations?.length) {
    return proposal.operations.map((operation) => ({
      before: typeof operation.target.selected_text === "string" ? operation.target.selected_text : "当前定位内容",
      after: operation.op === "delete_target" ? "删除该条目" : operation.new_text,
    }));
  }
  return [{ before: "当前简历内容", after: "候选简历内容" }];
}

function statusLabel(proposal: AgentProposal) {
  if (proposal.status === "pending") return null;
  if (proposal.superseded_by) return "已被替代";
  if (proposal.status === "applied") return "已应用";
  if (proposal.status === "rejected") return "已忽略";
  return "无法应用";
}

function shortLabel(proposal: AgentProposal, index: number) {
  const text = proposal.summary?.trim();
  if (!text) return `第 ${index + 1} 项`;
  return text.length > 14 ? `${text.slice(0, 14)}…` : text;
}

export type BatchProgress = { completed: number; total: number } | null;

export function SuggestionCard({
  proposals,
  resumeLabel,
  historical,
  busyProposalId,
  running,
  batchProgress,
  batchLocked,
  selectedId,
  onSelect,
  onApply,
  onReject,
  onApplyAll,
  onContinue,
}: {
  proposals: AgentProposal[];
  resumeLabel: string;
  historical: boolean;
  busyProposalId: string | null;
  running: boolean;
  batchProgress: BatchProgress;
  batchLocked: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  onApply: (proposal: AgentProposal) => Promise<boolean>;
  onReject: (proposal: AgentProposal) => Promise<boolean>;
  onApplyAll: () => void;
  onContinue: (proposal: AgentProposal) => void;
}) {
  const pending = proposals.filter((item) => item.status === "pending");
  const applied = proposals.filter((item) => item.status === "applied").length;
  const rejected = proposals.filter((item) => item.status === "rejected").length;
  const allDone = pending.length === 0;
  const [expanded, setExpanded] = useState(!allDone);
  const selected = proposals.find((item) => item.id === selectedId) ?? pending[0] ?? proposals[0];
  const index = proposals.findIndex((item) => item.id === selected?.id);
  const multi = proposals.length > 1;
  const locked = busyProposalId !== null || batchLocked;

  // 处理完最后一项时收起成摘要
  useEffect(() => {
    if (allDone && !batchProgress) setExpanded(false);
  }, [allDone, batchProgress]);

  if (!selected) return null;

  // 处理当前项后自动定位到下一项待确认
  const advance = () => {
    const rest = proposals.filter((item) => item.status === "pending" && item.id !== selected.id);
    const next = rest.find((item) => proposals.indexOf(item) > index) ?? rest[0];
    if (next) onSelect(next.id);
  };

  const progressText = applied + rejected === 0
    ? `${pending.length} 项待确认`
    : [applied ? `已采用 ${applied}` : "", rejected ? `已忽略 ${rejected}` : "", pending.length ? `待确认 ${pending.length}` : ""].filter(Boolean).join(" · ");

  if (!expanded && allDone) {
    return (
      <section className="assistant-suggest is-summary" aria-label="待确认简历修改提案">
        <span className="assistant-suggest-summary-check" aria-hidden="true"><Icon name="check" size={12} /></span>
        <span className="assistant-suggest-summary-copy">
          <strong>{historical ? "历史修改建议 · " : ""}已处理 {proposals.length} 处修改建议</strong>
          <small>{progressText}</small>
        </span>
        <button type="button" className="v3-link" aria-expanded="false" onClick={() => setExpanded(true)}>
          查看详情<Icon name="chev" size={12} />
        </button>
      </section>
    );
  }

  const status = statusLabel(selected);
  const actionable = selected.status === "pending";
  return (
    <section className="assistant-suggest" aria-label="待确认简历修改提案">
      <header className="assistant-suggest-head">
        <div className="assistant-suggest-title">
          <strong>
            {historical ? "历史修改建议 · " : ""}
            {multi ? `建议修改 · ${proposals.length} 处` : `建议修改 · ${shortLabel(selected, 0)}`}
          </strong>
          {(multi || !actionable) && <span className="assistant-suggest-progress">{multi ? progressText : status}</span>}
        </div>
        <span className="assistant-suggest-target" title={selected.summary}>目标简历「{resumeLabel}」</span>
      </header>
      {multi && (
        <div className="assistant-suggest-tabs" role="tablist" aria-label="切换修改提案">
          {proposals.map((proposal, tabIndex) => {
            const isActive = proposal.id === selected.id;
            const tabStatus = proposal.status === "applied" ? "applied" : proposal.status === "pending" ? "pending" : "done";
            return (
              <button
                key={proposal.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`assistant-suggest-tab is-${tabStatus}${isActive ? " is-active" : ""}`}
                disabled={Boolean(batchProgress)}
                title={proposal.summary}
                onClick={() => onSelect(proposal.id)}
              >
                {tabStatus === "applied" ? <span className="assistant-suggest-mark" aria-hidden="true">✓</span>
                  : tabStatus === "done" ? <span className="assistant-suggest-mark" aria-hidden="true">–</span>
                    : <span className="assistant-suggest-dot" aria-hidden="true" />}
                <span>{shortLabel(proposal, tabIndex)}</span>
                {tabStatus !== "pending" && <small>{statusLabel(proposal)}</small>}
              </button>
            );
          })}
        </div>
      )}
      <div className="assistant-suggest-body">
        {proposalChanges(selected).map((change, changeIndex) => (
          <div className="assistant-suggest-change" key={`${selected.id}-${changeIndex}`}>
            <div className="assistant-suggest-before">
              <span>原文</span>
              <del>{change.before}</del>
            </div>
            <div className="assistant-suggest-after">
              <span>建议</span>
              <ins>{change.after}</ins>
            </div>
          </div>
        ))}
      </div>
      <footer className="assistant-suggest-foot">
        <div className="assistant-suggest-pager" aria-label="切换修改提案">
          <button type="button" aria-label="上一项修改" disabled={index <= 0 || Boolean(batchProgress)} onClick={() => onSelect(proposals[index - 1].id)}>‹</button>
          <span aria-live="polite">{index + 1} / {proposals.length}</span>
          <button type="button" aria-label="下一项修改" disabled={index >= proposals.length - 1 || Boolean(batchProgress)} onClick={() => onSelect(proposals[index + 1].id)}>›</button>
        </div>
        <div className="assistant-suggest-actions">
          {actionable ? (
            <>
              <button type="button" className="v3-btn v3-btn-text assistant-suggest-continue" disabled={locked || running} onClick={() => onContinue(selected)}>继续调整</button>
              <button
                type="button"
                className="v3-btn v3-btn-text"
                disabled={locked}
                onClick={() => { void onReject(selected).then((ok) => { if (ok) advance(); }); }}
              >
                忽略
              </button>
              <button
                type="button"
                className={`v3-btn ${pending.length > 1 ? "v3-btn-ghost" : "v3-btn-dark"}`}
                disabled={locked || running}
                onClick={() => { void onApply(selected).then((ok) => { if (ok) advance(); }); }}
              >
                {busyProposalId === selected.id && !batchProgress ? "处理中…" : pending.length > 1 ? "采用此项" : "采用"}
              </button>
              {(pending.length > 1 || batchProgress) && (
                <button type="button" className="v3-btn v3-btn-dark" disabled={locked || running} onClick={onApplyAll}>
                  {batchProgress ? `正在采用（${batchProgress.completed}/${batchProgress.total}）` : `全部采用（${pending.length}）`}
                </button>
              )}
            </>
          ) : (
            <span className={`assistant-suggest-status is-${selected.status}`}>
              {selected.status === "applied" ? "✓ 已写入简历" : status}
            </span>
          )}
        </div>
      </footer>
    </section>
  );
}
