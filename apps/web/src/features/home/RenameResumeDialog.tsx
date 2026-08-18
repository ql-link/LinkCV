import { useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
} from "@/components/ui";

export function RenameResumeDialog({
  initialTitle,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initialTitle: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (title: string) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const normalizedTitle = title.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedTitle || normalizedTitle.length > 255 || busy) return;
    void onSubmit(normalizedTitle);
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent className="home-confirm-dialog home-rename-dialog" role="dialog">
        <span className="home-confirm-icon" aria-hidden="true">
          <Pencil size={20} />
        </span>
        <AlertDialogHeader className="home-confirm-copy">
          <AlertDialogTitle>重命名简历</AlertDialogTitle>
          <AlertDialogDescription>名称用于在简历列表中识别版本，不会写入简历正文。</AlertDialogDescription>
        </AlertDialogHeader>
        <form className="home-rename-form" onSubmit={submit}>
          <label htmlFor="resume-rename-title">简历名称</label>
          <Input
            id="resume-rename-title"
            autoFocus
            autoComplete="off"
            maxLength={255}
            value={title}
            disabled={busy}
            aria-invalid={Boolean(error)}
            onChange={(event) => setTitle(event.target.value)}
          />
          {error && <p className="home-rename-error" role="alert">{error}</p>}
          <div className="home-confirm-actions home-rename-actions">
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={busy}>取消</Button>
            </AlertDialogCancel>
            <Button type="submit" disabled={!normalizedTitle || normalizedTitle.length > 255 || busy}>
              {busy ? "正在保存…" : "保存名称"}
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
