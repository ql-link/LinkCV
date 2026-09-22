import type { DatasetRecord } from "../../../api/client";
import { DatasetFileTypeIcon, DatasetSelectFileIcon } from "./DatasetFileTypeIcon";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatUploadDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\//g, "-");
}

export function DatasetDetailInspector({
  dataset,
  displayName,
  available,
  onOpen,
  onManage,
}: {
  dataset: DatasetRecord | null;
  displayName: string;
  available: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
  onManage: () => void;
}) {
  if (!dataset) {
    return (
      <aside className="dataset-detail-empty" aria-label="文件详情">
        <DatasetSelectFileIcon />
        <strong>选择一个文件</strong>
        <span>查看文件详情以及关联的面试、简历</span>
      </aside>
    );
  }

  const associationCount = dataset.interview_label ? 1 : 0;
  const uploadDate = formatUploadDate(dataset.created_at);

  return (
    <aside className="dataset-detail-inspector" aria-label={`${displayName} 文件详情`}>
      <header className="dataset-detail-header">
        <h2>文件详情</h2>
        {associationCount > 0 && <span>已关联 {associationCount} 项</span>}
      </header>

      <div className="dataset-detail-file-summary">
        <DatasetFileTypeIcon dataset={dataset} size={40} />
        <div>
          <strong title={dataset.file_name}>{dataset.file_name}</strong>
          <span>
            {dataset.file_format.toUpperCase()} · {formatFileSize(dataset.file_size)}
            {uploadDate ? ` · 上传于 ${uploadDate}` : ""}
          </span>
        </div>
      </div>

      <div className="dataset-detail-divider" />

      <div className="dataset-detail-section-heading">
        <h3>关联内容</h3>
        <button type="button" onClick={onManage}>管理关联</button>
      </div>

      <div className="dataset-detail-associations">
        {dataset.interview_label ? (
          <section>
            <span>面试</span>
            <strong>{dataset.interview_label.replace(/\s*·\s*/g, " · ")}</strong>
            <small>来自求职中心的面试资料</small>
          </section>
        ) : (
          <p>尚未关联到面试或简历</p>
        )}
      </div>

      <div className="dataset-detail-actions">
        {available ? (
          <button type="button" onClick={(event) => onOpen(event.currentTarget)}>查看文件 →</button>
        ) : (
          <span>文件暂不可用</span>
        )}
      </div>
    </aside>
  );
}
