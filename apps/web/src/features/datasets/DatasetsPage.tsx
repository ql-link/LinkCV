import { useEffect, useRef, useState } from "react";
import { Database, FileSearch, FileText, Plus, Search, X } from "lucide-react";
import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import { Button, FeedbackNotice, FileUpload, PageLoading } from "@/components/ui";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";
import { DatasetPreviewDialog } from "./DatasetPreviewDialog";

const MAX_DATASET_BYTES = 10 * 1024 * 1024;
const SUPPORTED_DATASET_EXTENSIONS = ["docx", "pdf", "md", "txt"];

type Notice = { kind: "success" | "error"; message: string } | null;
type TypeFilter = "all" | "pdf" | "docx" | "text";

const FAILURE_REASON_LABELS: Record<NonNullable<DatasetRecord["failure_reason"]>, string> = {
  format_unsupported: "文件格式不受支持，请重新选择文件。",
  content_invalid: "文件内容无效，请检查后重新上传。",
  size_exceeded: "文件内容超出解析限制，请缩小文件后重试。",
  service_unavailable: "解析服务暂不可用，请稍后重新上传。",
  timeout: "解析超时，请稍后重新上传。",
  quota_exceeded: "当前资料数量已达上限。",
  internal_error: "解析失败，请重新上传。",
};

function datasetFormatError(file: File): string | null {
  if (file.size === 0) return "文件为空，请重新选择。";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_DATASET_EXTENSIONS.includes(extension)) {
    return "仅支持 DOCX、PDF、Markdown 和 TXT 文件。";
  }
  if (file.size > MAX_DATASET_BYTES) {
    return "文件过大，最大支持 10 MB。";
  }
  return null;
}

export function datasetUploadErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiRequestError)) return fallback;

  switch (error.message) {
    case "INVALID_DATASET_FILENAME":
      return "文件名无效，请重命名后再上传。";
    case "UNSUPPORTED_DATASET_FORMAT":
      return "仅支持 DOCX、PDF、Markdown 和 TXT 文件。";
    case "EMPTY_DATASET_FILE":
      return "文件为空，请重新选择。";
    case "DATASET_TOO_LARGE":
      return "文件过大，最大支持 10 MB。";
    case "DATASET_UPLOAD_FAILED":
      return "上传失败，请稍后重试。";
    case "DATASET_RECORD_FAILED":
      return "资料保存失败，请稍后重试。";
    case "DATASET_QUEUE_UNAVAILABLE":
      return "资料已保存，但解析服务暂不可用，请重新上传。";
    default:
      if (error.status === 401) return "登录状态已失效，请重新登录。";
      return error.status >= 500 ? "服务暂时不可用，请稍后重试。" : fallback;
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
  const startOfDay = (target: Date) => new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `昨天 ${time}`;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function matchesType(dataset: DatasetRecord, filter: TypeFilter) {
  if (filter === "all") return true;
  if (filter === "text") return dataset.file_format === "md" || dataset.file_format === "txt";
  return dataset.file_format === filter;
}

function DatasetBadge({ format }: { format: string }) {
  return <span className={`dataset-badge is-${format}`}>{format.toUpperCase()}</span>;
}

function DatasetName({
  dataset,
  onPreview,
}: {
  dataset: DatasetRecord;
  onPreview: (dataset: DatasetRecord, trigger: HTMLButtonElement) => void;
}) {
  if (dataset.parse_status !== "succeeded") {
    return <strong className="dataset-name">{dataset.file_name}</strong>;
  }
  return (
    <button
      type="button"
      className="dataset-name dataset-name-button"
      aria-label={`查看「${dataset.file_name}」的解析结果`}
      onClick={(event) => onPreview(dataset, event.currentTarget)}
    >
      <span>{dataset.file_name}</span>
      <span className="dataset-name-action"><FileSearch size={14} aria-hidden="true" />查看结果</span>
    </button>
  );
}

function DatasetStatus({ dataset }: { dataset: DatasetRecord }) {
  if (dataset.upload_status === "uploading") {
    return <span className="dataset-status is-pending">排队中</span>;
  }
  if (dataset.upload_status === "failed") {
    return <span className="dataset-status is-failed">上传失败</span>;
  }
  if (dataset.parse_status === "processing") {
    return <span className="dataset-status is-processing">解析中</span>;
  }
  if (dataset.parse_status === "succeeded") {
    return <span className="dataset-status is-succeeded">解析完成</span>;
  }
  const reason = dataset.failure_reason
    ? FAILURE_REASON_LABELS[dataset.failure_reason]
    : FAILURE_REASON_LABELS.internal_error;
  return (
    <span className="dataset-status-block">
      <span className="dataset-status is-failed">解析失败</span>
      <small>{reason}</small>
    </span>
  );
}

function DatasetDropzone({
  disabled = false,
  file = null,
  onDropFile,
}: {
  disabled?: boolean;
  file?: File | null;
  onDropFile: (file: File | undefined) => void;
}) {
  return (
    <FileUpload
      accept=".docx,.pdf,.md,.txt,application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      inputLabel="选择资料文件"
      supportingText="支持 DOCX、PDF、Markdown 和 TXT，单个文件不超过 10 MB"
      disabled={disabled}
      file={file}
      onFileSelect={onDropFile}
    />
  );
}

export function DatasetsPage() {
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [notice, setNotice] = useState<Notice>(null);
  const [fading, setFading] = useState(false);
  const [previewDataset, setPreviewDataset] = useState<DatasetRecord | null>(null);

  const openPreview = (dataset: DatasetRecord, trigger: HTMLButtonElement) => {
    previewTriggerRef.current = trigger;
    setPreviewDataset(dataset);
  };

  const closePreview = () => {
    setPreviewDataset(null);
  };

  useEffect(() => {
    if (!notice) return;
    setFading(false);
    const fadeTimer = window.setTimeout(() => setFading(true), 3000);
    const removeTimer = window.setTimeout(() => setNotice(null), 3300);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.listDatasets();
        if (!cancelled) setDatasets(data.datasets);
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasActiveParsing = datasets.some(
    (dataset) => dataset.upload_status === "uploading" || dataset.parse_status === "processing",
  );

  useEffect(() => {
    if (!hasActiveParsing) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void api.listDatasets().then((data) => {
        if (!cancelled) setDatasets(data.datasets);
      }).catch(() => undefined);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveParsing]);

  const refresh = async () => {
    const data = await api.listDatasets();
    setDatasets(data.datasets);
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    const error = datasetFormatError(file);
    if (error) {
      setNotice({ kind: "error", message: error });
      return;
    }
    setPendingFile(file);
    setDialogOpen(true);
    setNotice(null);
  };

  const closeDialog = () => {
    if (uploading) return;
    setDialogOpen(false);
    setPendingFile(null);
  };

  const confirmUpload = async () => {
    if (!pendingFile || uploading) return;
    const file = pendingFile;
    setUploading(true);
    setNotice(null);
    try {
      await api.uploadDataset(file);
      await refresh();
      setNotice({ kind: "success", message: `已上传「${file.name}」` });
      setPendingFile(null);
      setDialogOpen(false);
    } catch (error) {
      setNotice({ kind: "error", message: datasetUploadErrorMessage(error, "上传失败，请稍后重试。") });
    } finally {
      setUploading(false);
    }
  };

  const keyword = query.trim().toLowerCase();
  const filtered = datasets.filter((dataset) =>
    matchesType(dataset, typeFilter) && (!keyword || dataset.file_name.toLowerCase().includes(keyword)),
  );
  const isDefaultView = !keyword && typeFilter === "all";
  const latest = isDefaultView && filtered.length > 0 ? filtered[0] : null;
  const listItems = latest ? filtered.slice(1) : filtered;

  const counts: Record<TypeFilter, number> = {
    all: datasets.length,
    pdf: datasets.filter((dataset) => matchesType(dataset, "pdf")).length,
    docx: datasets.filter((dataset) => matchesType(dataset, "docx")).length,
    text: datasets.filter((dataset) => matchesType(dataset, "text")).length,
  };
  const typePills: Array<{ key: TypeFilter; label: string; tint?: string }> = [
    { key: "all", label: "全部" },
    { key: "pdf", label: "PDF", tint: "is-pdf" },
    { key: "docx", label: "DOCX", tint: "is-docx" },
    { key: "text", label: "MD / TXT" },
  ];

  return (
    <main className="dashboard-content datasets-page">
      <WorkspacePageHero
        icon={<Database />}
        tone="success"
        title="资料库"
        description={datasets.length > 0 ? `${datasets.length} 份资料 · 按最近上传排列` : "把履历、项目记录和参考资料集中在这里，写简历时随时调用。"}
        actions={(
          <Button variant="outline" icon={<Plus size={15} />} onClick={() => setDialogOpen(true)}>上传资料</Button>
        )}
      />

      {loading ? (
        <PageLoading label="正在加载资料…" />
      ) : (
        <div className="datasets-body">
          {loadFailed && (
            <section className="dashboard-empty-state">
              <Database size={48} strokeWidth={1.2} />
              <h2>资料加载失败</h2>
              <p>请稍后重试。</p>
              <Button variant="secondary" onClick={() => window.location.reload()}>重新加载</Button>
            </section>
          )}

        {!loadFailed && datasets.length === 0 && (
          <section className="datasets-empty">
            <span className="datasets-empty-icon" aria-hidden="true"><FileText size={44} strokeWidth={1.2} /></span>
            <h2>还没有资料</h2>
            <p>建议先上传一份与你当前求职方向相关的资料，<br />后续写简历时可以快速检索和引用。</p>
            <Button icon={<Plus size={15} />} onClick={() => setDialogOpen(true)}>上传第一份资料</Button>
          </section>
        )}

        {!loadFailed && datasets.length > 0 && (
          <>
            <div className="datasets-toolbar">
              <label className="datasets-search-field">
                <span>搜索资料</span>
                <span className="datasets-search">
                  <Search size={15} />
                  <input aria-label="搜索资料" value={query} placeholder="资料名称" onChange={(event) => setQuery(event.target.value)} />
                </span>
              </label>
              <div className="datasets-type-pills" aria-label="文件类型筛选">
                {typePills.map((pill) => (
                  <button
                    key={pill.key}
                    type="button"
                    className={`${typeFilter === pill.key ? "is-active" : ""}${typeFilter !== pill.key && pill.tint ? ` ${pill.tint}` : ""}`}
                    onClick={() => setTypeFilter(pill.key)}
                  >
                    {pill.label} {counts[pill.key]}
                  </button>
                ))}
              </div>
            </div>

            {latest && (
              <section className="datasets-section">
                <h2>最近上传</h2>
                <article className="dataset-feature">
                  <DatasetBadge format={latest.file_format} />
                  <span className="dataset-meta">
                    <DatasetName dataset={latest} onPreview={openPreview} />
                    <small className="dataset-sub">
                      <span>{formatFileSize(latest.file_size)}</span>
                      <span>上传于 {relativeTime(latest.created_at)}</span>
                    </small>
                  </span>
                  <DatasetStatus dataset={latest} />
                  <span className="dataset-feature-tag">最近上传</span>
                </article>
              </section>
            )}

            <section className="datasets-section">
              <header className="datasets-section-head">
                <h2>全部资料</h2>
                <span>按最近上传</span>
              </header>
              <div className="dataset-list-card">
                {listItems.length === 0 ? (
                  <p className="dataset-list-empty">{isDefaultView ? "没有更多资料。" : "没有匹配的资料。"}</p>
                ) : (
                  listItems.map((dataset) => (
                    <article key={dataset.id} className="dataset-row">
                      <DatasetBadge format={dataset.file_format} />
                      <span className="dataset-meta">
                        <DatasetName dataset={dataset} onPreview={openPreview} />
                        <small className="dataset-sub">
                          <span>{dataset.file_format.toUpperCase()}</span>
                          <span>{formatFileSize(dataset.file_size)}</span>
                          <span>上传于 {relativeTime(dataset.created_at)}</span>
                        </small>
                      </span>
                      <DatasetStatus dataset={dataset} />
                    </article>
                  ))
                )}
              </div>
            </section>
          </>
        )}
        </div>
      )}

      {dialogOpen && (
        <div className="dataset-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <section className="dataset-dialog" role="dialog" aria-modal="true" aria-labelledby="dataset-upload-title">
            <button className="dataset-dialog-close" type="button" aria-label="关闭上传窗口" onClick={closeDialog}><X size={18} /></button>
            <h2 id="dataset-upload-title">上传资料</h2>
            <p>把文件加入资料库，后续写简历时可以随时引用。</p>

            <DatasetDropzone disabled={uploading} file={pendingFile} onDropFile={pickFile} />

            {pendingFile && (
              <div className="dataset-pending-block" aria-label="待上传的文件">
                <p className="dataset-pending-label">待上传文件</p>
                <div className="dataset-pending-row">
                  <DatasetBadge format={(pendingFile.name.split(".").pop() ?? "").toLowerCase()} />
                  <span className="dataset-meta">
                    <strong className="dataset-name">{pendingFile.name}</strong>
                    <small className="dataset-sub">
                      <span>{formatFileSize(pendingFile.size)}</span>
                      <span>将保存到资料库</span>
                    </small>
                  </span>
                  <button type="button" className="dataset-text-btn" disabled={uploading} onClick={() => setPendingFile(null)}>移除文件</button>
                </div>
              </div>
            )}

            <p className="dataset-dialog-hint">上传后，资料会按文件类型和上传时间排列。<br />写简历时可以随时检索和引用。</p>

            <footer className="dataset-dialog-actions">
              <Button variant="ghost" disabled={uploading} onClick={closeDialog}>取消</Button>
              <Button disabled={!pendingFile || uploading} onClick={() => void confirmUpload()}>
                {uploading ? "正在上传…" : "上传资料"}
              </Button>
            </footer>
          </section>
        </div>
      )}

      {notice && (
        <div className={`datasets-toast${fading ? " is-fading" : ""}`}>
          <FeedbackNotice kind={notice.kind}>{notice.message}</FeedbackNotice>
        </div>
      )}

      {previewDataset && (
        <DatasetPreviewDialog
          dataset={previewDataset}
          returnFocusTo={previewTriggerRef.current}
          onClose={closePreview}
        />
      )}
    </main>
  );
}
