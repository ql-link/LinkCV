import { useEffect, useRef, useState } from "react";
import { Database, FileText, Plus, Search, X } from "lucide-react";
import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import { Button, FeedbackNotice } from "@/components/ui";
import { WorkspacePageHero } from "../../components/WorkspaceLayout";

const MAX_DATASET_BYTES = 10 * 1024 * 1024;
const SUPPORTED_DATASET_EXTENSIONS = ["docx", "pdf", "md", "txt"];

type Notice = { kind: "success" | "error"; message: string } | null;
type TypeFilter = "all" | "pdf" | "docx" | "text";

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

function DatasetDropzone({ onBrowse, onDropFile }: { onBrowse: () => void; onDropFile: (file: File | undefined) => void }) {
  return (
    <button
      type="button"
      className="dataset-dropzone"
      onClick={onBrowse}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDropFile(event.dataTransfer.files?.[0]);
      }}
    >
      <strong>拖拽文件到这里</strong>
      <span className="dataset-dropzone-or">或</span>
      <span className="dataset-dropzone-pick">选择文件</span>
      <small>支持 DOCX、PDF、Markdown 和 TXT，单个文件不超过 10 MB</small>
    </button>
  );
}

export function DatasetsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const browse = () => fileInputRef.current?.click();

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
        eyebrow="知识储备"
        title="资料库"
        description={datasets.length > 0 ? `${datasets.length} 份资料 · 按最近上传排列` : "把履历、项目记录和参考资料集中在这里，写简历时随时调用。"}
        actions={(
          <Button icon={<Plus size={15} />} onClick={() => setDialogOpen(true)}>上传资料</Button>
        )}
      />

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        aria-label="选择资料文件"
        accept=".docx,.pdf,.md,.txt,application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          pickFile(file);
        }}
      />

      <div className="datasets-body">
        {loading && <div className="app-loading">正在加载资料...</div>}

        {!loading && loadFailed && (
          <section className="dashboard-empty-state">
            <Database size={48} strokeWidth={1.2} />
            <h2>资料加载失败</h2>
            <p>请稍后重试。</p>
            <Button variant="secondary" onClick={() => window.location.reload()}>重新加载</Button>
          </section>
        )}

        {!loading && !loadFailed && datasets.length === 0 && (
          <section className="datasets-empty">
            <span className="datasets-empty-icon" aria-hidden="true"><FileText size={40} strokeWidth={1.4} /></span>
            <h2>先上传一份资料</h2>
            <p>把简历、作品集、项目复盘或岗位参考资料放进来。<br />写简历时可以快速检索和引用，减少重复整理。</p>
            <DatasetDropzone onBrowse={browse} onDropFile={pickFile} />
            <p className="datasets-empty-hint">建议先上传与你当前求职方向最相关的资料，资料越聚焦，后续引用越准确。</p>
          </section>
        )}

        {!loading && !loadFailed && datasets.length > 0 && (
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
                    <strong className="dataset-name">{latest.file_name}</strong>
                    <small className="dataset-sub">
                      <span>{formatFileSize(latest.file_size)}</span>
                      <span>上传于 {relativeTime(latest.created_at)}</span>
                    </small>
                  </span>
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
                        <strong className="dataset-name">{dataset.file_name}</strong>
                        <small className="dataset-sub">
                          <span>{dataset.file_format.toUpperCase()}</span>
                          <span>{formatFileSize(dataset.file_size)}</span>
                          <span>上传于 {relativeTime(dataset.created_at)}</span>
                        </small>
                      </span>
                    </article>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {dialogOpen && (
        <div className="dataset-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <section className="dataset-dialog" role="dialog" aria-modal="true" aria-labelledby="dataset-upload-title">
            <button className="dataset-dialog-close" type="button" aria-label="关闭上传窗口" onClick={closeDialog}><X size={18} /></button>
            <h2 id="dataset-upload-title">上传资料</h2>
            <p>把文件加入资料库，后续写简历时可以随时引用。</p>

            <DatasetDropzone onBrowse={browse} onDropFile={pickFile} />

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
                  <button type="button" className="dataset-text-btn" onClick={browse}>更换文件</button>
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
    </main>
  );
}
