export interface BossJobCapture {
  job_title?: string;
  company_name?: string;
  description_text?: string;
  skills: string[];
  employment_type_text?: string;
  education_text?: string;
  experience_text?: string;
  work_schedule_text?: string;
  work_city?: string;
  work_address?: string;
  salary_text?: string;
  company_legal_name?: string;
  company_industry?: string;
  company_size?: string;
  company_financing_stage?: string;
  company_description?: string;
  company_tags: string[];
  recruiter_name?: string;
  recruiter_title?: string;
}

export interface BossCaptureSuccess {
  ok: true;
  sourceUrl: string;
  capture: BossJobCapture;
  warnings: string[];
}

export interface BossCaptureFailure {
  ok: false;
  error: "UNSUPPORTED_PAGE" | "CAPTURE_INCOMPLETE" | "CAPTURE_FAILED";
  message: string;
}

export type BossCaptureResult = BossCaptureSuccess | BossCaptureFailure;

export interface DuplicateResolution {
  action: "update" | "restore";
  job_description_id: string;
  base_lock_version: number;
}

export interface JobSummary {
  id: string;
  job_title: string;
  company_name: string;
  archived_at: string | null;
  lock_version: number;
}

export interface JobRecord extends JobSummary {
  source_url: string | null;
}

export interface ImportJobPayload {
  source_url: string;
  capture: BossJobCapture;
  duplicate_resolution?: DuplicateResolution;
}

export interface DuplicateDetails {
  existing: JobSummary;
  allowed_actions: Array<"update" | "restore" | "cancel">;
}

export const CAPTURE_MESSAGE = "LINKCV_CAPTURE_BOSS_JOB" as const;
