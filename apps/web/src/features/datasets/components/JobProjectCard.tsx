import { t, useLocale } from "@/i18n";
import { compactStageNodes, type JobProject, type JobStageNode } from "../jobProjects";

function shortDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nodeCaption(node: JobStageNode) {
  if (node.sessionId) return node.state === "done" || node.datasets.length > 0 ? t("{value0} 份", { value0: node.datasets.length }) : "—";
  if (node.state === "offer") return node.datasets.length > 0 ? t("{value0} 份", { value0: node.datasets.length }) : shortDate(node.date);
  return shortDate(node.date);
}

// 求职进程的阶段进度条：节点 = 投递 / 各场次 / Offer，节点下写阶段名与该阶段的资料数
export function JobStageTrack({ project }: { project: JobProject }) {
  useLocale();
  const nodes = compactStageNodes(project.nodes);
  const reached = nodes.reduce((last, node, index) => (node.state === "upcoming" ? last : index), 0);
  const progress = nodes.length > 1 ? (reached / (nodes.length - 1)) * 100 : 0;
  return (
    // 进度线从第一个节点中心画到最后一个节点中心：左右各缩进半列宽
    <span className="ds-job-track" style={{ ["--ds-track-progress" as string]: `${progress}%`, ["--ds-track-inset" as string]: `${50 / nodes.length}%` }}>
      <span className="ds-job-track-line" aria-hidden="true"><i /></span>
      {/* 卡片整体是按钮，内部只能放行内元素，节点用 span 排成网格 */}
      <span className="ds-job-track-nodes" style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}>
        {nodes.map((node) => (
          <span key={node.key} className={`ds-job-node is-${node.state}`}>
            <span className="ds-job-dot" aria-hidden="true" />
            <strong>{node.label}</strong>
            <small>{nodeCaption(node)}</small>
          </span>
        ))}
      </span>
    </span>
  );
}

// 求职进程卡片：与「我的项目」同尺寸，舞台里放公司字标、岗位、状态和阶段进度条
export function JobProjectCard({ project, onOpen }: { project: JobProject; onOpen: () => void }) {
  useLocale();
  const { application } = project;
  const offer = application.offer_status === "received" || application.offer_status === "accepted";
  return (
    <button
      type="button"
      className={`ds-folder ds-job-card${project.archived ? " is-archived" : ""}`}
      aria-label={t("打开求职进程项目「{value0}」", { value0: project.name })}
      onClick={onOpen}
    >
      <span className="ds-job-stage">
        <span className="ds-job-stage-head">
          <span className="ds-job-mono" aria-hidden="true">{project.monogram}</span>
          <span className="ds-job-role">{application.job_title_snapshot}</span>
          <span className={`ds-job-status${offer ? " is-offer" : ""}`}>{project.statusLabel}</span>
        </span>
        <JobStageTrack project={project} />
      </span>
      <span className="ds-folder-name" title={project.name}>{project.name}</span>
      <span className="ds-folder-meta">
        {project.datasetCount > 0 ? t("{value0} 份资料", { value0: project.datasetCount }) : t("还没有资料")}
      </span>
    </button>
  );
}
