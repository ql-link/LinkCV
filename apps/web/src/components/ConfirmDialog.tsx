import { LayoutTemplate, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./ds";

type ConfirmDialogProps = {
  kind: "delete" | "template";
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  kind,
  title,
  description,
  confirmLabel,
  busyLabel,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = `confirm-${kind}-title`;
  const descriptionId = `confirm-${kind}-description`;
  const dialogRef = useRef<HTMLElement>(null);
  const cancelActionRef = useRef(onCancel);
  const busyStateRef = useRef(busy);

  useEffect(() => {
    cancelActionRef.current = onCancel;
    busyStateRef.current = busy;
  }, [busy, onCancel]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyStateRef.current) {
        cancelActionRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled)"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
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
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div
      className="home-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="home-confirm-dialog"
        role={kind === "delete" ? "alertdialog" : "dialog"}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <span className={`home-confirm-icon is-${kind}`} aria-hidden="true">
          {kind === "delete" ? <Trash2 size={21} /> : <LayoutTemplate size={21} />}
        </span>
        <div className="home-confirm-copy">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
        <div className="home-confirm-actions">
          <Button variant="secondary" disabled={busy} autoFocus onClick={onCancel}>
            取消
          </Button>
          <Button
            className={kind === "delete" ? "home-confirm-danger" : ""}
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
