import { describe, expect, it } from "vitest";

import type { DatasetRecord, InterviewSessionSummary, JobApplicationSummary } from "../../api/client";
import { buildJobProjects, datasetProjectLabels } from "./jobProjects";

const application = (overrides: Partial<JobApplicationSummary> = {}) => ({
  id: "a1",
  company_name_snapshot: "虚构甲公司",
  job_title_snapshot: "后端开发",
  phase: "applied",
  offer_status: "received",
  offer_materials: [],
  offer_received_on: null,
  applied_at: "2026-09-12T02:00:00Z",
  archived_at: null,
  created_at: "2026-09-10T02:00:00Z",
  updated_at: "2026-09-12T02:00:00Z",
  ...overrides,
}) as unknown as JobApplicationSummary;

const session = (id: string, overrides: Partial<InterviewSessionSummary> = {}) => ({
  id,
  application_id: "a1",
  stage_label: "一面",
  status: "completed",
  start_at: "2026-09-26T02:00:00Z",
  ...overrides,
}) as unknown as InterviewSessionSummary;

const dataset = (id: string, overrides: Partial<DatasetRecord> = {}): DatasetRecord => ({
  id,
  folder_id: null,
  file_name: `${id}.md`,
  file_format: "md",
  file_size: 10,
  upload_status: "succeeded",
  parse_status: "succeeded",
  failure_reason: null,
  created_at: "2026-09-27T02:00:00Z",
  ...overrides,
});

describe("buildJobProjects", () => {
  it("按投递、场次时间和 Offer 排列节点，并把资料归到对应场次", () => {
    const [project] = buildJobProjects(
      [application({ offer_materials: [{ dataset_id: "d3", file_name: "offer.pdf" }] })],
      [
        session("s2", { stage_label: "二面", start_at: "2026-10-08T02:00:00Z", status: "scheduled" }),
        session("s1"),
        session("s0", { stage_label: "已取消", status: "cancelled" }),
      ],
      [
        dataset("d1", { interview_session_id: "s1", asset_kind: "audio" }),
        dataset("d2", { interview_session_id: "s1" }),
        dataset("d3"),
        dataset("d4", { folder_id: "f1" }),
      ],
    );

    expect(project.name).toBe("虚构甲公司 · 后端开发");
    expect(project.monogram).toBe("虚");
    expect(project.statusLabel).toBe("已获 Offer");
    expect(project.nodes.map((node) => [node.label, node.state])).toEqual([
      ["投递", "done"],
      ["一面", "done"],
      ["二面", "current"],
      ["Offer", "offer"],
    ]);
    expect(project.nodes[1].datasets.map((item) => item.id)).toEqual(["d1", "d2"]);
    expect(project.nodes[3].datasets.map((item) => item.id)).toEqual(["d3"]);
    expect(project.datasetCount).toBe(3);
  });

  it("未投递的岗位不生成项目，归档项目排在最后", () => {
    const projects = buildJobProjects(
      [
        application({ id: "pending", phase: "pending" }),
        application({ id: "archived", archived_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-09T00:00:00Z" }),
        application({ id: "active", updated_at: "2026-09-01T00:00:00Z" }),
      ],
      [],
      [],
    );
    expect(projects.map((project) => project.id)).toEqual(["active", "archived"]);
    expect(projects[1].statusLabel).toBe("已归档");
  });

  it("所在项目名称以求职进程为准", () => {
    const projects = buildJobProjects([application()], [session("s1")], [dataset("d1", { interview_session_id: "s1" })]);
    expect(datasetProjectLabels(projects).get("d1")).toBe("虚构甲公司 · 后端开发");
  });
});
