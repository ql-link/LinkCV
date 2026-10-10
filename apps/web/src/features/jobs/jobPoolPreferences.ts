import type { PoolQuery } from "../../api/client";

/**
 * Reserved hook for the job-seeking preferences feature: default pool filters
 * (city, job_category direction, recruitment_type) derived from the user's
 * saved preferences. Applied only when the URL carries no filter of its own,
 * so shared links and manual filters always win.
 *
 * Returns null until preferences exist; the pool then lists every job.
 */
export async function loadPreferredPoolQuery(): Promise<PoolQuery | null> {
  return null;
}
