import { api, type JobApplicationSummary } from "@/api/client";

export async function listAllJobApplications(): Promise<JobApplicationSummary[]> {
  const items: JobApplicationSummary[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await api.listJobApplications({ scope: "all", cursor, limit: 200 });
    items.push(...page.items);
    if (!page.next_cursor) break;
    if (seenCursors.has(page.next_cursor)) throw new Error("Job application pagination did not advance");
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

export function applicationsForJob(applications: JobApplicationSummary[], jobId: string) {
  return applications
    .filter((application) => application.job_description_id === jobId)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

export function activeApplicationForJob(applications: JobApplicationSummary[], jobId: string) {
  return applicationsForJob(applications, jobId).find(
    (application) => application.status === "active" && application.archived_at === null,
  ) ?? null;
}

export function applicationOutcome(application: JobApplicationSummary): string {
  if (application.status === "active") return application.current_stage_label;
  if (application.offer_status === "accepted") return "已接受 Offer";
  if (application.offer_status === "declined") return "已婉拒 Offer";
  if (application.status === "rejected") return "未通过";
  if (application.status === "withdrawn") return "已主动结束";
  return "已结束";
}
