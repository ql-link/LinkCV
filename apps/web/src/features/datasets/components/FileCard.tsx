import { type KeyboardEvent } from "react";
import { FolderInput, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";

import type { DatasetRecord } from "../../../api/client";
import { DatasetSelectionCheckbox } from "../DatasetsPage";

type FileCardProps = {
  dataset: DatasetRecord;
  batchMode: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  menuOpen: boolean;
  busy: boolean;
  displayName: string;
  isInteractive: boolean;
  statusLabel: string;
  statusKind: "queued" | "processing" | "succeeded" | "failed";
  statusReason: string | null;
  formattedSize: string;
  onPreview: (dataset: DatasetRecord, trigger: HTMLElement) => void;
  onToggleSelection: (id: string, checked: boolean) => void;
  onToggleMenu: (id: string) => void;
  onRename: (dataset: DatasetRecord) => void;
  onMove: (dataset: DatasetRecord) => void;
  onRetry: (dataset: DatasetRecord) => void;
  onDelete: (dataset: DatasetRecord) => void;
};

export function FileCard({
  dataset,
  batchMode,
  selected,
  selectionDisabled,
  menuOpen,
  busy,
  displayName,
  isInteractive,
  statusLabel,
  statusKind,
  statusReason,
  formattedSize,
  onPreview,
  onToggleSelection,
  onToggleMenu,
  onRename,
  onMove,
  onRetry,
  onDelete,
}: FileCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isInteractive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onPreview(dataset, event.currentTarget);
  };

  const format = (dataset.file_format || "file").toLowerCase();

  return (
    <article
      className={`dataset-row macos-file-item${isInteractive ? " is-clickable" : ""}`}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `打开「${displayName}」解析预览` : undefined}
      onClick={isInteractive ? (event) => onPreview(dataset, event.currentTarget) : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="dataset-cell dataset-cell-name">
        {/* 顶部：macOS 质感文档卡片图片 */}
        <div className="macos-file-graphic" aria-hidden="true">
          <div className={`macos-document-sheet is-${format}`}>
            {/* 折角 Dog-ear */}
            <div className="macos-document-dogear" />

            {/* 排版线条 */}
            <div className="macos-document-lines">
              <div className="macos-document-line is-long" />
              <div className="macos-document-line is-medium" />
              <div className="macos-document-line is-short" />
            </div>

            {/* 解析状态微标 */}
            <div className="macos-document-status-tag" title={statusReason ?? undefined}>
              <span
                className={`dataset-status is-${statusKind}`}
                data-status={statusKind}
              >
                <span className="dataset-status-mark" aria-hidden="true" />
                {statusLabel}
              </span>
            </div>
          </div>
        </div>

        <strong className="dataset-name macos-file-name" title={displayName}>
          {displayName}
        </strong>
      </div>

      {/* 底部信息与操作框 */}
      <div className="macos-file-caption">
        <div className="macos-file-subrow">
          <span className="macos-file-size">{formattedSize}</span>

          <div
            className="dataset-row-actions macos-file-actions"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {batchMode ? (
              <div className="dataset-selection-cell dataset-row-selection">
                <DatasetSelectionCheckbox
                  checked={selected}
                  disabled={selectionDisabled}
                  label={`选择「${displayName}」`}
                  onChange={(checked) => onToggleSelection(dataset.id, checked)}
                />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="dataset-menu-trigger macos-file-menu-btn"
                  aria-label={`打开「${displayName}」操作菜单`}
                  aria-expanded={menuOpen}
                  disabled={busy}
                  onClick={() => onToggleMenu(dataset.id)}
                >
                  <MoreHorizontal size={13} aria-hidden="true" />
                </button>

                {menuOpen && (
                  <div
                    className="dataset-action-menu macos-file-menu"
                    role="menu"
                    aria-label={`${displayName} 操作`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button type="button" role="menuitem" onClick={() => onRename(dataset)}>
                      <Pencil size={14} aria-hidden="true" />
                      重命名
                    </button>
                    <button type="button" role="menuitem" onClick={() => onMove(dataset)}>
                      <FolderInput size={14} aria-hidden="true" />
                      移动到文件夹
                    </button>
                    {statusKind === "failed" && (
                      <button type="button" role="menuitem" onClick={() => onRetry(dataset)}>
                        <RotateCcw size={14} aria-hidden="true" />
                        重新解析
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      onClick={() => onDelete(dataset)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      删除
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
