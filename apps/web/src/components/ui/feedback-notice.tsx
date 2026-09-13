import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import "./feedback-notice.css";

export type FeedbackNoticeKind = "info" | "success" | "warning" | "error";

export const FLOATING_FEEDBACK_NOTICE_DURATION_MS = 3000;

const defaultTitles: Record<FeedbackNoticeKind, string> = {
  info: "提示",
  success: "操作成功",
  warning: "请注意",
  error: "操作失败",
};

const noticeIcons: Record<FeedbackNoticeKind, typeof CircleAlert> = {
  info: CircleHelp,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

export function FeedbackNotice({
  kind = "success",
  title,
  placement = "inline",
  className,
  action,
  onDismiss,
  dismissKey,
  children,
}: {
  kind?: FeedbackNoticeKind;
  title?: ReactNode;
  placement?: "inline" | "floating";
  className?: string;
  action?: ReactNode;
  onDismiss?: () => void;
  dismissKey?: string | number;
  children: ReactNode;
}) {
  const Icon = noticeIcons[kind];
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const resolvedDismissKey = dismissKey
    ?? (typeof children === "string" || typeof children === "number" ? children : undefined);

  useEffect(() => {
    if (placement !== "floating") return;
    const timer = window.setTimeout(
      () => onDismissRef.current?.(),
      FLOATING_FEEDBACK_NOTICE_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [placement, resolvedDismissKey]);

  const notice = (
    <div
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={cn(
        "ui-feedback-notice",
        `is-${kind}`,
        placement === "floating" && "is-floating",
        action && "has-action",
        className,
      )}
      data-kind={kind}
      data-slot="feedback-notice"
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon className="ui-feedback-notice-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
      <div className="ui-feedback-notice-copy">
        <strong>{title ?? defaultTitles[kind]}</strong>
        <div className="ui-feedback-notice-description">{children}</div>
      </div>
      {action && <div className="ui-feedback-notice-action">{action}</div>}
    </div>
  );

  if (placement === "floating" && typeof document !== "undefined") {
    return createPortal(notice, document.body);
  }
  return notice;
}
