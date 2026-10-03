import { t, useLocale } from "@/i18n";
import { useState } from "react";

import type { DatasetFolder } from "../../../api/client";
import { Icon } from "../../../v3/Icon";
import { Dialog, DialogFooter } from "../../../v3/primitives";
import { MoveArt } from "./DatasetArt";

export type MoveToFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: DatasetFolder[];
  currentFolderId?: string | null;
  itemCount: number;
  singleItemName?: string;
  singleItemFormat?: string;
  onMove: (targetFolderId: string) => Promise<void>;
};

// 06.1b 移动到文件夹（480 宽）：插图 → 「选择目标分类」→ 文件夹单选列表（选中行浅灰底 + 对勾）→ 确定移动。
export function MoveToFolderDialog({
  open,
  onOpenChange,
  folders,
  currentFolderId,
  itemCount,
  singleItemName,
  singleItemFormat,
  onMove,
}: MoveToFolderDialogProps) {
  useLocale();
  const [selectedTarget, setSelectedTarget] = useState<string | null>(currentFolderId ?? null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 标题保留旧版文案结构，便于辅助技术区分单条与批量
  const label = singleItemName
    ? t("移动「{value0}」到文件夹", { value0: singleItemName })
    : t("批量移动 {value0} 份资料到文件夹", { value0: itemCount });
  const sub = singleItemName
    ? t("「{value0}」 · 选择目标文件夹", { value0: singleItemName })
    : t("已选择 {value0} 份资料 · 选择目标文件夹", { value0: itemCount });
  const targetName = folders.find((folder) => folder.id === selectedTarget)?.name ?? t("文件夹");
  const artTag = (singleItemFormat ?? "").toUpperCase().slice(0, 4) || String(itemCount);

  const handleSubmit = async () => {
    if (!selectedTarget) return;
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
      setError(err instanceof Error ? err.message : t("移动失败，请稍后重试。"));
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open={open} width={480} label={label} className="ds-dialog" closable={!moving} onClose={() => { if (!moving) onOpenChange(false); }}>
      <div className="v3-dialog-body">
        <h2 className="v3-dialog-title">{singleItemName ? t("移动资料到文件夹") : t("移动 {value0} 份资料到文件夹", { value0: itemCount })}</h2>
        <p className="v3-dialog-sub ds-one-line" title={sub}>{sub}</p>
        <div className="v3-stage ds-dialog-art" style={{ height: 84 }}>
          <MoveArt tag={artTag} folderName={targetName} />
        </div>
        <div className="ds-list-label"><span>{t("选择目标分类")}</span></div>
        <div className="ds-pick" role="radiogroup" aria-label={t("目标文件夹列表")} style={{ maxHeight: 228 }}>
          {folders.length === 0 && <p className="ds-pick-empty">{t("还没有其他文件夹")}</p>}
          {folders.map((folder) => {
            const isSelected = selectedTarget === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className="ds-pick-item"
                disabled={moving}
                onClick={() => setSelectedTarget(folder.id)}
              >
                <Icon name="folder" size={14} />
                <span>{folder.name}</span>
                <small className="v3-num">{folder.dataset_count}{t(" 份")}</small>
                {isSelected && <Icon className="v3-menu-check" name="check" size={14} />}
              </button>
            );
          })}
        </div>
        {error && <p className="ds-inline-error" role="alert">{error}</p>}
      </div>
      <DialogFooter>
        <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 80 }} disabled={moving} onClick={() => onOpenChange(false)}>{t("取消")}</button>
        <button
          type="button"
          className="v3-btn v3-btn-dark"
          style={{ width: 96 }}
          disabled={moving || !selectedTarget || selectedTarget === currentFolderId}
          onClick={() => void handleSubmit()}
        >
          {moving ? t("正在移动…") : t("确定移动")}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
