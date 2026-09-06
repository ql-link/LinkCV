import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import "./feedback-notice.css";

export type FeedbackNoticeKind = "info" | "success" | "warning" | "error";

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
  children,
}: {
  kind?: FeedbackNoticeKind;
  title?: ReactNode;
  placement?: "inline" | "floating";
  className?: string;
  children: ReactNode;
}) {
  const Icon = noticeIcons[kind];

  return (
    <div
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={cn(
        "ui-feedback-notice",
        `is-${kind}`,
        placement === "floating" && "is-floating",
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
    </div>
  );
}
