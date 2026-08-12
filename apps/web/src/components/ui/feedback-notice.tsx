import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function FeedbackNotice({ kind = "success", children }: { kind?: "success" | "error"; children: ReactNode }) {
  return (
    <div
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={cn(
        "ui-feedback-notice fixed left-1/2 top-5 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-sm",
        kind === "error"
          ? "border-destructive bg-[var(--ui-destructive-subtle)] text-destructive"
          : "border-success bg-[var(--ui-success-subtle)] text-success",
      )}
      data-slot="feedback-notice"
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
