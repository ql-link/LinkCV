import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

type MessageActionsProps = {
  content: string;
  createdAt: string;
  timeLabel: string;
};

export function MessageActions({ content, createdAt, timeLabel }: MessageActionsProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="message-actions">
      <time dateTime={createdAt}>{timeLabel}</time>
      <button
        type="button"
        aria-label={copyState === "copied" ? "已复制消息" : copyState === "failed" ? "复制失败，重试" : "复制消息"}
        title={copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败，重试" : "复制消息"}
        onClick={() => void copyMessage()}
      >
        {copyState === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}
