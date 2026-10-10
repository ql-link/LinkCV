import { t, useLocale } from "@/i18n";
import { useRef, useState, type DragEvent } from "react";

import { api, ApiRequestError, type DatasetRecord, type JobApplicationSummary } from "../../api/client";
import { careerApplicationPath, editorPath, jobDetailPath, navigateTo } from "../../routing";
import { Icon } from "../../v3/Icon";
import { FormatSquare } from "./components/DatasetArt";
import type { JobProject, JobStageNode } from "./jobProjects";

// 面试场次接受的素材格式与求职进程详情保持一致
const SESSION_FILE_ACCEPT = ".webm,.m4a,.mp3,.wav,.ogg,.mp4,.mov,.pdf,.docx,.md,.txt";

export type DatasetMeta = { text: string; tone?: "processing" | "failed"; status: string };

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return date.getFullYear() === new Date().getFullYear() ? day : `${date.getFullYear()}-${day}`;
}

function formatDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.message === "INTERVIEW_ASSET_TOO_LARGE") return t("素材超过 500 MiB，请压缩后重试。");
    if (error.message === "UNSUPPORTED_INTERVIEW_ASSET") return t("暂不支持这种素材格式。");
    if (error.status === 401) return t("登录状态已失效，请重新登录。");
  }
  return t("上传失败，请稍后重试。");
}

// 录音的装饰声波：按文件 ID 生成稳定的条形高度，不代表真实音量
function waveBars(seed: string, count = 72) {
  let value = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 7);
  return Array.from({ length: count }, (_, index) => {
    value = (value * 9301 + 49297) % 233280;
    const envelope = 0.45 + 0.55 * Math.sin((index / count) * Math.PI);
    return Math.max(0.12, envelope * (0.35 + (value / 233280) * 0.65));
  });
}

function RecordingCard({
  dataset,
  meta,
  transcriptPath,
  onOpen,
}: {
  dataset: DatasetRecord;
  meta: DatasetMeta;
  /** 转写稿在面试场次详情里查看 */
  transcriptPath: string | null;
  onOpen: (dataset: DatasetRecord, trigger: HTMLElement) => void;
}) {
  useLocale();
  const ready = dataset.upload_status === "succeeded";
  const duration = formatDuration(dataset.duration_ms);
  const kind = dataset.asset_kind === "video" ? t("面试视频") : t("面试录音");
  return (
    <article className="ds-rec">
      <button
        type="button"
        className="ds-rec-play"
        disabled={!ready}
        aria-label={t("下载「{value0}」", { value0: dataset.file_name })}
        onClick={(event) => onOpen(dataset, event.currentTarget)}
      >
        <Icon name="dl" size={15} />
      </button>
      <div className="ds-rec-main">
        <strong title={dataset.file_name}>{dataset.file_name}</strong>
        <small className={meta.tone ? `is-${meta.tone}` : undefined}>
          {[kind, duration, meta.tone ? meta.text : null].filter(Boolean).join(" · ")}
        </small>
      </div>
      {transcriptPath && (
        <button type="button" className="v3-link ds-rec-transcript" onClick={() => navigateTo(transcriptPath)}>{t("查看转写稿")}</button>
      )}
      <div className="ds-rec-wave" aria-hidden="true">
        {waveBars(dataset.id).map((height, index) => <i key={index} style={{ height: `${Math.round(height * 100)}%` }} />)}
      </div>
    </article>
  );
}

function DocumentCard({
  dataset,
  meta,
  onOpen,
}: {
  dataset: DatasetRecord;
  meta: DatasetMeta;
  onOpen: (dataset: DatasetRecord, trigger: HTMLElement) => void;
}) {
  useLocale();
  const available = meta.status === "succeeded";
  return (
    <button
      type="button"
      className="ds-doc-card"
      disabled={!available}
      aria-label={t("打开「{value0}」解析预览", { value0: dataset.file_name })}
      onClick={(event) => onOpen(dataset, event.currentTarget)}
    >
      <FormatSquare dataset={dataset} />
      <span className="ds-doc-card-name">
        <strong title={dataset.file_name}>{dataset.file_name}</strong>
        <small className={meta.tone ? `is-${meta.tone}` : undefined}>{meta.text}</small>
      </span>
    </button>
  );
}

// 投递阶段：岗位 JD 与投递简历不是资料库文件，展示为跳转到原处的卡片
function ApplicationSourceCards({ application }: { application: JobApplicationSummary }) {
  useLocale();
  const cards = [
    application.job_description_id
      ? { key: "jd", tag: "JD", title: t("岗位 JD"), detail: application.job_title_snapshot, path: jobDetailPath(application.job_description_id, application.id) }
      : null,
    application.resume_id
      ? { key: "resume", tag: "CV", title: t("投递简历"), detail: application.resume_title_snapshot ?? t("查看简历"), path: editorPath(application.resume_id) }
      : null,
  ].filter((card): card is NonNullable<typeof card> => card !== null);
  if (cards.length === 0) return <p className="ds-timeline-note">{t("这次投递没有关联岗位 JD 或简历。")}</p>;
  return (
    <div className="ds-doc-grid">
      {cards.map((card) => (
        <button key={card.key} type="button" className="ds-doc-card" onClick={() => navigateTo(card.path)}>
          <span className="ds-fmt ds-source-tag" aria-hidden="true">{card.tag}</span>
          <span className="ds-doc-card-name">
            <strong title={card.detail}>{card.title}</strong>
            <small>{card.detail}</small>
          </span>
          <Icon name="ext" size={13} className="ds-doc-card-ext" />
        </button>
      ))}
    </div>
  );
}

function StageDropzone({
  node,
  compact,
  busy,
  onFiles,
}: {
  node: JobStageNode;
  /** 阶段里已有资料时只留一行轻量入口 */
  compact: boolean;
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  };
  return (
    <div
      className={`ds-stage-drop${compact ? " is-compact" : ""}${dragging ? " is-dragging" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDragLeave={(event) => { event.stopPropagation(); setDragging(false); }}
      onDrop={handleDrop}
    >
      <span>
        {busy
          ? t("正在上传…")
          : compact
            ? t("拖入文件，继续补充这一轮的资料")
          : node.state === "done"
            ? t("把这一轮的录音或笔记拖到这里")
            : t("面试结束后，把录音或笔记拖到这里")}
      </span>
      <button type="button" className="v3-btn v3-btn-ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
        <Icon name="upload" size={13} />{t("上传")}
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept={SESSION_FILE_ACCEPT}
        aria-label={t("上传到「{value0}」", { value0: node.label })}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

// 06.V4-2 求职进程项目详情：Hero → 按阶段倒序的时间线，资料挂在各自场次下
export function JobProjectView({
  project,
  datasetMeta,
  onBack,
  onOpenDataset,
  onChanged,
  onNotice,
}: {
  project: JobProject;
  datasetMeta: (dataset: DatasetRecord) => DatasetMeta;
  onBack: () => void;
  onOpenDataset: (dataset: DatasetRecord, trigger: HTMLElement) => void;
  onChanged: () => Promise<void> | void;
  onNotice: (notice: { kind: "success" | "error"; message: string }) => void;
}) {
  useLocale();
  const [uploadingNode, setUploadingNode] = useState<string | null>(null);
  const { application } = project;
  const offer = application.offer_status === "received" || application.offer_status === "accepted";
  const appliedOn = formatDate(application.applied_at ?? application.created_at);
  const timeline = [...project.nodes].reverse();

  const uploadToSession = async (node: JobStageNode, files: File[]) => {
    if (!node.sessionId || uploadingNode) return;
    setUploadingNode(node.key);
    let accepted = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        await api.uploadInterviewAsset(node.sessionId, file, "uploaded");
        accepted += 1;
      } catch (error) {
        failures.push(`${file.name}：${uploadErrorMessage(error).replace(/[。]$/u, "")}`);
      }
    }
    if (accepted > 0) await onChanged();
    setUploadingNode(null);
    if (failures.length > 0) onNotice({ kind: "error", message: failures.join("；") });
    else onNotice({ kind: "success", message: t("已上传 {value0} 份资料到「{value1}」。", { value0: accepted, value1: node.label }) });
  };

  return (
    <div className="ds-job-detail">
      <header className="ds-job-hero">
        <nav className="ds-crumb" aria-label={t("资料库路径")}>
          <button type="button" className="ds-crumb-back" onClick={onBack}>{t("资料库")}</button>
          <span className="ds-crumb-sep" aria-hidden="true">/</span>
          <span className="ds-crumb-current">{t("求职进程")}</span>
        </nav>
        <div className="ds-job-hero-row">
          <span className="ds-job-hero-mono" aria-hidden="true">{project.monogram}</span>
          <div className="ds-job-hero-text">
            <h1 className="ds-title" title={project.name}>{project.name}</h1>
            <p className="ds-sub">
              {[application.job_title_snapshot, appliedOn ? t("{value0} 投递", { value0: appliedOn }) : null, t("{value0} 份资料", { value0: project.datasetCount })].filter(Boolean).join(" · ")}
            </p>
            <span className={`ds-job-hero-status${offer ? " is-offer" : ""}`}>{project.statusLabel}</span>
          </div>
          <button type="button" className="v3-btn v3-btn-ghost ds-job-hero-open" onClick={() => navigateTo(careerApplicationPath(application.id))}>
            {t("打开求职进程")}<Icon name="ext" size={13} />
          </button>
        </div>
        {project.archived && <p className="ds-job-readonly">{t("这个求职进程已归档，资料只读。")}</p>}
      </header>

      <ol className="ds-timeline" aria-label={t("按阶段排列的资料")}>
        {timeline.map((node) => {
          const recordings = node.datasets.filter((dataset) => dataset.asset_kind === "audio" || dataset.asset_kind === "video");
          const documents = node.datasets.filter((dataset) => !(dataset.asset_kind === "audio" || dataset.asset_kind === "video"));
          const date = formatDate(node.date);
          const canUpload = Boolean(node.sessionId) && !project.archived;
          return (
            <li key={node.key} className={`ds-timeline-item is-${node.state}`}>
              <div className="ds-timeline-rail">
                <span className="ds-timeline-dot" aria-hidden="true" />
                <h2>{node.label}</h2>
                <small>
                  {node.state === "current" || node.state === "upcoming"
                    ? date ? t("{value0} · 待进行", { value0: date }) : t("待安排")
                    : date ?? ""}
                </small>
              </div>
              <div className="ds-timeline-body">
                {recordings.map((dataset) => (
                  <RecordingCard
                    key={dataset.id}
                    dataset={dataset}
                    meta={datasetMeta(dataset)}
                    transcriptPath={node.sessionId ? careerApplicationPath(application.id, node.sessionId) : null}
                    onOpen={onOpenDataset}
                  />
                ))}
                {documents.length > 0 && (
                  <div className="ds-doc-grid">
                    {documents.map((dataset) => (
                      <DocumentCard key={dataset.id} dataset={dataset} meta={datasetMeta(dataset)} onOpen={onOpenDataset} />
                    ))}
                  </div>
                )}
                {canUpload && (
                  <StageDropzone
                    node={node}
                    compact={node.datasets.length > 0}
                    busy={uploadingNode === node.key}
                    onFiles={(files) => void uploadToSession(node, files)}
                  />
                )}
                {node.key === "applied" && <ApplicationSourceCards application={application} />}
                {node.state === "offer" && node.datasets.length === 0 && (
                  <p className="ds-timeline-note">{t("Offer 材料可在求职进程中添加。")}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
