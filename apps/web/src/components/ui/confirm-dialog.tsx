import { LayoutTemplate, Link2, RefreshCw, Save, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  kind: "delete" | "template" | "warning" | "create" | "save";
  overlayClassName?: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  kind,
  overlayClassName,
  title,
  description,
  confirmLabel,
  busyLabel,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent
        className="home-confirm-dialog"
        overlayClassName={overlayClassName}
        data-slot="confirm-dialog"
        role={kind === "delete" ? "alertdialog" : "dialog"}
      >
        <span className={`home-confirm-icon is-${kind}`} aria-hidden="true">
          {kind === "delete" ? (
            <Trash2 size={21} />
          ) : kind === "create" ? (
            <Link2 size={21} />
          ) : kind === "save" ? (
            <Save size={21} />
          ) : kind === "warning" ? (
            <RefreshCw size={21} />
          ) : (
            <LayoutTemplate size={21} />
          )}
        </span>
        <AlertDialogHeader className="home-confirm-copy">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="home-confirm-actions">
          <AlertDialogCancel asChild>
            <Button disabled={busy} variant="secondary">取消</Button>
          </AlertDialogCancel>
          <Button
            className={kind === "delete" ? "home-confirm-danger" : undefined}
            disabled={busy}
            onClick={() => void onConfirm()}
            variant={kind === "delete" ? "destructive" : "default"}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
