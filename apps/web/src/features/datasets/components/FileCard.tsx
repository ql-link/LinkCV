import {api} from "../../../api/client";
import { useRef, useState, type KeyboardEvent } from "react";
import { Download, FolderInput, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";

import type { DatasetRecord } from "../../../api/client";
import { DatasetSelectionCheckbox } from "../DatasetsPage";
import { DatasetFileTypeIcon } from "./DatasetFileTypeIcon";

type FileCardProps = {
  dataset: DatasetRecord;
  batchMode: boolean;
  selected: boolean;
  active: boolean;
  selectionDisabled: boolean;
  menuOpen: boolean;
  busy: boolean;
  displayName: string;
  isInteractive: boolean;
  statusLabel: string;
  statusKind: "queued" | "processing" | "succeeded" | "failed";
  statusReason: string | null;
  onSelect: (dataset: DatasetRecord) => void;
  onToggleSelection: (id: string, checked: boolean) => void;
  onToggleMenu: (id: string) => void;
  onRename: (dataset: DatasetRecord) => void;
  onMove: (dataset: DatasetRecord) => void;
  onRetry: (dataset: DatasetRecord) => void;
  onDelete: (dataset: DatasetRecord) => void;
  onDownload: (dataset: DatasetRecord) => void;
};

export function FileCard({
  dataset,
  batchMode,
  selected,
  active,
  selectionDisabled,
  menuOpen,
  busy,
  displayName,
  isInteractive,
  statusLabel,
  statusKind,
  statusReason,
  onSelect,
  onToggleSelection,
  onToggleMenu,
  onRename,
  onMove,
  onRetry,
  onDelete,
  onDownload,
}: FileCardProps) {
  const [replacementError,setReplacementError]=useState("");
  const [replacementBusy,setReplacementBusy]=useState(false);
  const retryRequest=useRef<string|null>(null);
  async function handleReplacement(retry:boolean){
    const op=dataset.replacement;
    if(!op||replacementBusy)return;
    if(retry&&!window.confirm("重试替换将覆盖当前源文件和解析内容，是否继续？"))return;
    setReplacementBusy(true);setReplacementError("");
    try {
      if(retry){
        retryRequest.current??=crypto.randomUUID();
        await api.retryDatasetReplacement(dataset.id,op.id,dataset.content_revision??"0",retryRequest.current);
      }else await api.discardDatasetReplacement(dataset.id,op.id);
      retryRequest.current=null;
      window.dispatchEvent(new Event("dataset-replacement-refresh"));
    }catch{setReplacementError("操作未完成，请刷新列表确认当前状态后重试。");window.dispatchEvent(new Event("dataset-replacement-refresh"));}
    finally{setReplacementBusy(false);}
  }
  const replacing=dataset.replacement?.status==="pending";
  if(replacing) { isInteractive=false; busy=true; selectionDisabled=true; }
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isInteractive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onSelect(dataset);
  };

  const format = (dataset.file_format || "file").toLowerCase();
  const uploadedAt = new Date(dataset.created_at);
  const uploadDate = Number.isNaN(uploadedAt.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(uploadedAt).replace(/\//g, "-");
  const mediaReady = (dataset.asset_kind === "audio" || dataset.asset_kind === "video")
    && dataset.upload_status === "succeeded";

  return (
    <article
      className={`macos-file-item${isInteractive ? " is-clickable" : ""}${active ? " is-active" : ""}`}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `选择「${displayName}」查看详情` : undefined}
      aria-pressed={isInteractive ? active : undefined}
      onClick={isInteractive ? () => onSelect(dataset) : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="dataset-cell dataset-cell-name">
        <div className="macos-file-graphic" aria-hidden="true">
          <DatasetFileTypeIcon dataset={dataset} />
          <span className="dataset-document-format">{format.toUpperCase()}</span>
        </div>

        <strong className="dataset-name macos-file-name" title={displayName}>
          {displayName}
        </strong>
        {uploadDate && <time className="dataset-file-date" dateTime={dataset.created_at}>上传于 {uploadDate}</time>}
        <span className={`dataset-file-association${dataset.interview_label ? " is-linked" : ""}`} title={dataset.interview_label ?? undefined}>
          {dataset.interview_label ? <><b>已关联 1 项</b><span>面试</span></> : "未关联内容"}
        </span>
      </div>

      {replacing&&<p role="status">{dataset.replacement?.upload_status==="uploading"?"正在上传…":"正在解析…"}</p>}
      {dataset.replacement && ["failed","conflict"].includes(dataset.replacement.status)&&<div className="dataset-replacement-feedback" role="status" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
        <span>替换失败，已恢复原文件。</span>
        {dataset.replacement.retryable&&<button type="button" disabled={replacementBusy} onClick={()=>void handleReplacement(true)}>重试替换</button>}
        <button type="button" disabled={replacementBusy} onClick={()=>void handleReplacement(false)}>放弃替换</button>
        {replacementError&&<span>{replacementError}</span>}
      </div>}
      {/* 底部信息与操作框 */}
      <div className="macos-file-caption">
        <div className="macos-file-subrow">
          {!mediaReady && statusKind !== "succeeded" && statusKind !== "failed" && <span className={`dataset-status is-${statusKind}`} data-status={statusKind} title={statusReason ?? undefined}>
            <span className="dataset-status-mark" aria-hidden="true" />
            {statusLabel}
          </span>}
          {statusKind === "failed" && <button
            type="button"
            className="dataset-file-retry"
            disabled={busy}
            title={statusReason ?? undefined}
            onClick={(event) => { event.stopPropagation(); onRetry(dataset); }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <RotateCcw size={12} aria-hidden="true" />
            重试
          </button>}

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
                    {(dataset.asset_kind === "audio" || dataset.asset_kind === "video") && (
                      <button type="button" role="menuitem" onClick={() => onDownload(dataset)}>
                        <Download size={14} aria-hidden="true" />
                        下载
                      </button>
                    )}
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
