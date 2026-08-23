import { LoaderCircle, RefreshCw, Send, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useRef } from "react";

export type InlineAiComposerProps = {
  instruction: string;
  loading: boolean;
  hasSuggestion: boolean;
  stale: boolean;
  error: string | null;
  onInstructionChange: (value: string) => void;
  onSubmit: () => void;
  onApply: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
};

export function InlineAiComposer({
  instruction,
  loading,
  hasSuggestion,
  stale,
  error,
  onInstructionChange,
  onSubmit,
  onApply,
  onRegenerate,
  onDiscard,
}: InlineAiComposerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  return (
    <section className="workbench-ai-composer" aria-label="AI 局部修改">
      <div className="workbench-ai-composer-head">
        <span><Sparkles size={14} aria-hidden="true" />AI 局部修改</span>
        <button type="button" aria-label="放弃 AI 修改" onClick={onDiscard}><X size={14} aria-hidden="true" /></button>
      </div>
      <div className="workbench-ai-input-row">
        <input
          ref={inputRef}
          name="resume-ai-instruction"
          autoComplete="off"
          value={instruction}
          disabled={loading}
          placeholder={hasSuggestion ? "继续说明怎么调整…" : "例如：更简洁，突出后端成果"}
          aria-label="修改要求"
          onChange={(event) => onInstructionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
            if (event.key === "Escape") onDiscard();
          }}
        />
        <button
          type="button"
          className="workbench-ai-send"
          disabled={loading || !instruction.trim()}
          aria-label={hasSuggestion ? "继续调整" : "生成修改"}
          onClick={onSubmit}
        >
          {loading
            ? <LoaderCircle className="workbench-status-spinner" size={15} aria-hidden="true" />
            : <Send size={15} aria-hidden="true" />}
        </button>
      </div>
      {loading && <p className="workbench-ai-status" role="status">正在生成正文内预览…</p>}
      {error && <p className="workbench-ai-error" role="alert">{error}</p>}
      {stale && <p className="workbench-ai-error" role="alert">原文已经变化，请放弃后重新选择文字。</p>}
      {hasSuggestion && !loading && (
        <div className="workbench-ai-actions">
          <span>删除内容以红色删除线表示，新增内容以下划线表示。</span>
          <div>
            <button type="button" onClick={onRegenerate}><RefreshCw size={13} aria-hidden="true" />重新生成</button>
            <button type="button" onClick={onDiscard}><Undo2 size={13} aria-hidden="true" />放弃</button>
            <button type="button" className="is-primary" disabled={stale} onClick={onApply}>应用到简历</button>
          </div>
        </div>
      )}
    </section>
  );
}
