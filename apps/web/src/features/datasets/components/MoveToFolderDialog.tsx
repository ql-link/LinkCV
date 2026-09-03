import { useState } from "react";
import { Check, Folder, Inbox } from "lucide-react";

import type { DatasetFolder } from "../../../api/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@/components/ui";

export type MoveToFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: DatasetFolder[];
  currentFolderId?: string | null;
  itemCount: number;
  singleItemName?: string;
  onMove: (targetFolderId: string | null) => Promise<void>;
};

export function MoveToFolderDialog({
  open,
  onOpenChange,
  folders,
  currentFolderId,
  itemCount,
  singleItemName,
  onMove,
}: MoveToFolderDialogProps) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(
    currentFolderId ?? null,
  );
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = singleItemName
    ? `移动「${singleItemName}」到文件夹`
    : `批量移动 ${itemCount} 份资料到文件夹`;

  const handleSubmit = async () => {
    if (selectedTarget === (currentFolderId ?? null)) {
      onOpenChange(false);
      return;
    }
    setMoving(true);
    setError(null);
    try {
      await onMove(selectedTarget);
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "移动失败，请稍后重试。");
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !moving && onOpenChange(val)}>
      <DialogContent className="dataset-action-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            选择目标分类文件夹，将所选资料整理到相应分类中。
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            选择目标分类
          </Label>
          <div
            className="dataset-move-options"
            role="radiogroup"
            aria-label="目标文件夹列表"
          >
            <button
              type="button"
              role="radio"
              aria-checked={selectedTarget === null}
              className={`dataset-move-option${selectedTarget === null ? " is-selected" : ""}`}
              onClick={() => setSelectedTarget(null)}
            >
              <Inbox size={16} className="dataset-move-option-icon" aria-hidden="true" />
              <span className="dataset-move-option-name">未分类</span>
              {selectedTarget === null && (
                <Check size={15} className="dataset-move-check" aria-hidden="true" />
              )}
            </button>

            {folders.map((folder) => {
              const isSelected = selectedTarget === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`dataset-move-option${isSelected ? " is-selected" : ""}`}
                  onClick={() => setSelectedTarget(folder.id)}
                >
                  <Folder size={16} className="dataset-move-option-icon" aria-hidden="true" />
                  <span className="dataset-move-option-name">{folder.name}</span>
                  <span className="dataset-move-option-count">{folder.dataset_count} 份</span>
                  {isSelected && (
                    <Check size={15} className="dataset-move-check" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
          {error && (
            <small className="text-xs text-destructive block mt-1" role="alert">
              {error}
            </small>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={moving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={moving} onClick={() => void handleSubmit()}>
            {moving ? "正在移动…" : "确定移动"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
