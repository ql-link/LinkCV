import {api} from "../../../api/client";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { FolderInput, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";

import type { DatasetRecord } from "../../../api/client";
import { DatasetSelectionCheckbox } from "../DatasetsPage";
import { DocumentThumbnail } from "./DocumentThumbnail";

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
  onPreview,
  onToggleSelection,
  onToggleMenu,
  onRename,
  onMove,
  onRetry,
  onDelete,
}: FileCardProps) {
  const graphicId = useId();
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
    onPreview(dataset, event.currentTarget);
  };

  const format = (dataset.file_format || "file").toLowerCase();
  const uploadedAt = new Date(dataset.created_at);
  const uploadDate = Number.isNaN(uploadedAt.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(uploadedAt).replace(/\//g, "-");

  return (
    <article
      className={`macos-file-item${isInteractive ? " is-clickable" : ""}`}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `打开「${displayName}」解析预览` : undefined}
      onClick={isInteractive ? (event) => onPreview(dataset, event.currentTarget) : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="dataset-cell dataset-cell-name">
        <div className="macos-file-graphic" aria-hidden="true">
          <DocumentThumbnail dataset={replacing?{...dataset,parse_status:"processing"}:dataset} fallback={<>
          <svg className="dataset-document-icon" viewBox="0 0 96 112" fill="none">
            <defs>
              <linearGradient id={`${graphicId}-paper`} x1="20" y1="4" x2="76" y2="108" gradientUnits="userSpaceOnUse">
                <stop stopColor="#f8fcff" />
                <stop offset="1" stopColor="#c9e7fb" />
              </linearGradient>
              <linearGradient id={`${graphicId}-fold`} x1="63" y1="5" x2="84" y2="30" gradientUnits="userSpaceOnUse">
                <stop stopColor="#b7ddf6" />
                <stop offset="1" stopColor="#e9f6ff" />
              </linearGradient>
            </defs>
            <path d="M18 4h43l25 25v69a10 10 0 0 1-10 10H18A10 10 0 0 1 8 98V14A10 10 0 0 1 18 4Z" fill={`url(#${graphicId}-paper)`} stroke="#a6cde6" />
            <path d="M61 5v17a8 8 0 0 0 8 8h16" fill={`url(#${graphicId}-fold)`} stroke="#a6cde6" strokeLinejoin="round" />
            <path d="M18 6h41M10 17v78" stroke="white" strokeOpacity="0.85" strokeLinecap="round" />
          </svg>
          <span className="dataset-document-format">{format.toUpperCase()}</span>
          </>} />
        </div>

        <strong className="dataset-name macos-file-name" title={displayName}>
          {displayName}
        </strong>
        {uploadDate && <time className="dataset-file-date" dateTime={dataset.created_at}>上传于 {uploadDate}</time>}
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
          {statusKind !== "succeeded" && statusKind !== "failed" && <span className={`dataset-status is-${statusKind}`} data-status={statusKind} title={statusReason ?? undefined}>
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
