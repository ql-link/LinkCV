import { t } from "@/i18n";
import type { DatasetRecord, InterviewSessionSummary, JobApplicationSummary } from "../../api/client";
import { applicationProgressLabel } from "../interviews/applicationProgress";

// 求职进程项目：不单独存储，前端由「求职进程 + 面试场次 + 关联到场次的资料 + Offer 材料」聚合而成。
// 资料归属以服务端的 interview_session_id / offer_materials 为准，这里只做分组和展示。

export type JobStageNodeState = "done" | "current" | "upcoming" | "offer";

export type JobStageNode = {
  key: string;
  label: string;
  state: JobStageNodeState;
  /** 场次开始时间；投递节点为投递时间 */
  date: string | null;
  sessionId: string | null;
  datasets: DatasetRecord[];
};

export type JobProject = {
  id: string;
  application: JobApplicationSummary;
  name: string;
  monogram: string;
  statusLabel: string;
  archived: boolean;
  /** 按时间正序：投递 → 各场次 → Offer */
  nodes: JobStageNode[];
  datasetCount: number;
  lastActivity: number;
};

const time = (value: string | null | undefined) => {
  const stamp = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(stamp) ? stamp : 0;
};

export function jobProjectName(application: Pick<JobApplicationSummary, "company_name_snapshot" | "job_title_snapshot">) {
  const company = application.company_name_snapshot.trim();
  const title = application.job_title_snapshot.trim();
  return company && title ? `${company} · ${title}` : company || title || t("未命名岗位");
}

export function jobProjectStatusLabel(application: JobApplicationSummary) {
  if (application.archived_at) return t("已归档");
  if (application.offer_status === "received" || application.offer_status === "accepted") return t("已获 Offer");
  return applicationProgressLabel(application);
}

export function buildJobProjects(
  applications: JobApplicationSummary[],
  sessions: InterviewSessionSummary[],
  datasets: DatasetRecord[],
): JobProject[] {
  const sessionsByApplication = new Map<string, InterviewSessionSummary[]>();
  for (const session of sessions) {
    if (session.status === "cancelled") continue;
    const list = sessionsByApplication.get(session.application_id) ?? [];
    list.push(session);
    sessionsByApplication.set(session.application_id, list);
  }
  const datasetsBySession = new Map<string, DatasetRecord[]>();
  const datasetsById = new Map<string, DatasetRecord>();
  for (const dataset of datasets) {
    datasetsById.set(dataset.id, dataset);
    if (!dataset.interview_session_id) continue;
    const list = datasetsBySession.get(dataset.interview_session_id) ?? [];
    list.push(dataset);
    datasetsBySession.set(dataset.interview_session_id, list);
  }

  return applications
    // 还没投递的岗位只是收藏，不生成项目
    .filter((application) => application.phase !== "pending")
    .map((application) => {
      const ordered = [...(sessionsByApplication.get(application.id) ?? [])]
        .sort((a, b) => time(a.start_at) - time(b.start_at));
      const firstUpcoming = ordered.find((session) => session.status === "scheduled");
      const nodes: JobStageNode[] = [{
        key: "applied",
        label: t("投递"),
        state: "done",
        date: application.applied_at ?? application.created_at,
        sessionId: null,
        datasets: [],
      }];
      for (const session of ordered) {
        nodes.push({
          key: `session-${session.id}`,
          label: session.stage_label.trim() || t("面试"),
          state: session.status === "completed" ? "done" : session === firstUpcoming ? "current" : "upcoming",
          date: session.start_at,
          sessionId: session.id,
          datasets: [...(datasetsBySession.get(session.id) ?? [])]
            .sort((a, b) => time(a.created_at) - time(b.created_at)),
        });
      }
      const offerDatasets = (application.offer_materials ?? [])
        .map((material) => datasetsById.get(material.dataset_id))
        .filter((dataset): dataset is DatasetRecord => Boolean(dataset));
      if (application.offer_status === "received" || application.offer_status === "accepted" || offerDatasets.length > 0) {
        nodes.push({
          key: "offer",
          label: "Offer",
          state: "offer",
          date: application.offer_received_on ?? null,
          sessionId: null,
          datasets: offerDatasets,
        });
      }
      const allDatasets = nodes.flatMap((node) => node.datasets);
      const lastActivity = Math.max(
        time(application.updated_at),
        ...allDatasets.map((dataset) => time(dataset.created_at)),
      );
      const name = jobProjectName(application);
      return {
        id: application.id,
        application,
        name,
        monogram: Array.from(application.company_name_snapshot.trim() || name)[0] ?? "·",
        statusLabel: jobProjectStatusLabel(application),
        archived: Boolean(application.archived_at),
        nodes,
        datasetCount: allDatasets.length,
        lastActivity,
      };
    })
    // 归档的进程排在后面，其余按最近活动倒序
    .sort((a, b) => Number(a.archived) - Number(b.archived) || b.lastActivity - a.lastActivity);
}

/** 每份资料所在项目的显示名：求职进程项目优先，其次我的项目，否则「未归入」 */
export function datasetProjectLabels(projects: JobProject[]) {
  const labels = new Map<string, string>();
  for (const project of projects) {
    for (const node of project.nodes) {
      for (const dataset of node.datasets) labels.set(dataset.id, project.name);
    }
  }
  return labels;
}
