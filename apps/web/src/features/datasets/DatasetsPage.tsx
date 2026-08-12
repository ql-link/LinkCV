import { useEffect, useRef, useState } from "react";
import { Database, FileText, FileUp } from "lucide-react";
import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import { Button, FeedbackNotice } from "@/components/ui";

const MAX_DATASET_BYTES = 10 * 1024 * 1024;

type Notice = { kind: "success" | "error"; message: string } | null;

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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DatasetsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    if (file.size > MAX_DATASET_BYTES) {
      setNotice({ kind: "error", message: "文件过大，最大支持 10 MB。" });
      return;
    }
    void uploadFile(file);
  };

  const uploadFile = async (file: File) => {
    if (uploading) return;
    setUploading(true);
    setNotice(null);
    try {
      await api.uploadDataset(file);
      await refresh();
      setNotice({ kind: "success", message: `已上传「${file.name}」` });
    } catch (error) {
      setNotice({ kind: "error", message: datasetUploadErrorMessage(error, "上传失败，请稍后重试。") });
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="dashboard-content datasets-page">
      <header className="dashboard-header">
        <h1>资料库</h1>
        <div className="dashboard-header-actions">
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
          <Button
            variant="secondary"
            size="sm"
            icon={<FileUp size={14} />}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "正在上传…" : "上传资料"}
          </Button>
        </div>
      </header>

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
          <section className="dashboard-empty-state">
            <FileText size={48} strokeWidth={1.2} />
            <h2>资料库还是空的</h2>
            <p>上传 DOCX、PDF、Markdown 或 TXT 文件，作为简历创作的知识储备。</p>
            <Button icon={<FileUp size={16} />} onClick={() => fileInputRef.current?.click()}>
              上传第一份资料
            </Button>
          </section>
        )}

        {!loading && !loadFailed && datasets.length > 0 && (
          <section className="datasets-list" aria-label="已上传的资料">
            {datasets.map((dataset) => (
              <article key={dataset.id} className="dataset-row">
                <span className="dataset-icon" aria-hidden="true">
                  <FileText size={18} />
                </span>
                <span className="dataset-meta">
                  <strong className="dataset-name">{dataset.file_name}</strong>
                  <small className="dataset-sub">
                    <span className="dataset-format">{dataset.file_format.toUpperCase()}</span>
                    <span>{formatFileSize(dataset.file_size)}</span>
                    <span>上传于 {formatTime(dataset.created_at)}</span>
                  </small>
                </span>
              </article>
            ))}
          </section>
        )}
      </div>

      {notice && (
        <div className={`datasets-toast${fading ? " is-fading" : ""}`}>
          <FeedbackNotice kind={notice.kind}>{notice.message}</FeedbackNotice>
        </div>
      )}
    </main>
  );
}
