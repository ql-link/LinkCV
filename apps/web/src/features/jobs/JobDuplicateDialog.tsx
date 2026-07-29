import { useEffect, useRef } from "react";
import type { JobDuplicateDetails } from "../../api/client";
import { Button } from "../../components/ds";

type DuplicateAction = "restore" | "update" | "cancel";

export function JobDuplicateDialog({
  details,
  busy,
  onAction,
}: {
  details: JobDuplicateDetails["duplicate"];
  busy: boolean;
  onAction: (action: DuplicateAction) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        void onAction("cancel");
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [busy, onAction]);

  const archived = details.existing.archived_at !== null;
  return (
    <div className="job-dialog-backdrop">
      <section
        ref={dialogRef}
        className="job-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-duplicate-title"
      >
        <p className="job-eyebrow">发现相同来源</p>
        <h2 id="job-duplicate-title">{details.existing.job_title}</h2>
        <p>
          {archived
            ? "这条岗位已经归档。可以恢复原内容，或用本次内容更新后恢复。"
            : "这条岗位仍在列表中。可以更新原记录，系统不会创建第二条。"}
        </p>
        <div className="job-dialog-actions">
          <Button variant="secondary" disabled={busy} autoFocus onClick={() => void onAction("cancel")}>
            取消
          </Button>
          {details.allowed_actions.includes("restore") && (
            <Button variant="secondary" disabled={busy} onClick={() => void onAction("restore")}>
              恢复原内容
            </Button>
          )}
          <Button disabled={busy} onClick={() => void onAction("update")}>
            {busy ? "正在处理…" : archived ? "更新并恢复" : "更新原记录"}
          </Button>
        </div>
      </section>
    </div>
  );
}
