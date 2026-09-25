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
  onCancel,
  onSubmit,
  copying = false,
}: {
  initialTitle: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (title: string) => void | Promise<void>;
  copying?: boolean;
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
          <AlertDialogTitle>{copying ? "复制为新简历" : "重命名简历"}</AlertDialogTitle>
          <AlertDialogDescription>{copying ? "复制后得到独立简历，两份内容互不影响。" : "名称用于在简历列表中识别简历，不会写入简历正文。"}</AlertDialogDescription>
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
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="home-confirm-actions home-rename-actions">
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={busy}>取消</Button>
            </AlertDialogCancel>
            <Button type="submit" disabled={!normalizedTitle || normalizedTitle.length > 255 || busy}>
              {busy ? "正在保存…" : copying ? "创建副本" : "保存名称"}
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
