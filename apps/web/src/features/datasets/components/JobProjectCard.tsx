import { t, useLocale } from "@/i18n";
import type { JobProject, JobStageNode } from "../jobProjects";

function shortDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// 阶段链最多 5 个阶段：保留投递和最近 3 个阶段，中间用省略号
function chainNodes(nodes: JobStageNode[]): Array<JobStageNode | null> {
  if (nodes.length <= 5) return nodes;
  return [nodes[0], null, ...nodes.slice(-3)];
}

// 求职进程卡片（06.V4-1b）：公司与岗位 → 一行文字阶段链 → 下一场 / 状态与资料数。
// 不用色块表示进度：一屏几十张卡片时只靠字重和灰度区分，只有 Offer 用蓝色。
export function JobProjectCard({ project, onOpen }: { project: JobProject; onOpen: () => void }) {
  useLocale();
  const { application, nodes } = project;
  const company = application.company_name_snapshot.trim();
  const role = application.job_title_snapshot.trim();
  const offer = application.offer_status === "received" || application.offer_status === "accepted";
  const next = project.archived ? undefined : nodes.find((node) => node.state === "current");
  // 强调「下一场」，没有下一场时强调最后走到的阶段
  const reached = nodes.filter((node) => node.state !== "upcoming");
  const focusKey = (next ?? reached[reached.length - 1])?.key;
  const nextDate = next ? shortDate(next.date) : "";

  return (
    <button
      type="button"
      className={`ds-job-card${project.archived ? " is-archived" : ""}`}
      aria-label={t("打开求职进程项目「{value0}」", { value0: project.name })}
      onClick={onOpen}
    >
      <span className="ds-job-head">
        <span className="ds-job-mono" aria-hidden="true">{project.monogram}</span>
        <span className="ds-job-title">
          <strong title={company || project.name}>{company || project.name}</strong>
          {company && role && <small title={role}>{role}</small>}
        </span>
      </span>

      <span className="ds-job-chain">
        {chainNodes(nodes).map((node, index) => (
          <span key={node?.key ?? "gap"} className="ds-job-chain-item">
            {index > 0 && <i aria-hidden="true">›</i>}
            {node
              ? <span className={`is-${node.state}${node.key === focusKey ? " is-focus" : ""}`}>{node.label}</span>
              : <span className="is-done">…</span>}
          </span>
        ))}
      </span>

      <span className="ds-job-foot">
        {next
          ? <span>{nextDate ? t("下一场 {value0} {value1}", { value0: nextDate, value1: next.label }) : t("下一场 {value0}", { value0: next.label })}</span>
          : <span className={offer ? "is-offer" : undefined}>{project.statusLabel}</span>}
        <small>{project.datasetCount > 0 ? t("{value0} 份资料", { value0: project.datasetCount }) : t("还没有资料")}</small>
      </span>
    </button>
  );
}
