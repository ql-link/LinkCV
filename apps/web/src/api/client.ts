import type { ResumeDocument, ResumePresentation } from "./resumeContract";

export type User = {
  id: string;
  email: string | null;
  nickname: string;
  is_admin: boolean;
  avatar_url?: string | null;
};

export type WeChatQrcodeResponse = {
  scene: string;
  poll_token: string;
  qr_base64: string;
};

export type WeChatStatusResponse = {
  status: "pending" | "success" | "cancelled" | "expired";
  user: User | null;
};

export type AuthCapabilities = {
  password_login_enabled: boolean;
};

export type UserProfile = User & {
  avatar_url: string | null;
  wechat_status: "unbound" | "bound" | "unavailable";
  wechat_bound_at: string | null;
};

export type RecentResumeSummary = {
  id: string;
  title: string;
  updated_at: string;
};

export type AccountProfile = {
  user: UserProfile;
  resume_count: number;
  recent_resumes: RecentResumeSummary[];
};

export type AdminUserSummary = User & {
  status: number;
  resume_count: number;
  last_login_at: string | null;
  created_at: string;
};

export type AdminUserDetail = AdminUserSummary & {
  llm_call_count: number;
  updated_at: string;
};

export type AdminUserListResponse = {
  items: AdminUserSummary[];
  total: number;
  page: number;
  size: number;
};

export type AdminStatsResponse = {
  total_users: number;
  active_users_7d: number;
  total_resumes: number;
  llm_calls_today: number;
  estimated_cost_month: string;
};

export type AdminStatusUpdateResponse = {
  ok: boolean;
  user: AdminUserSummary;
  revoked_sessions: number;
};

export type ResumeSummary = {
  id: string;
  title: string;
  source_type: "blank" | "template" | "import";
  lock_version: number;
  created_at: string;
  updated_at: string;
  preview?: { data: ResumeDocument; style: ResumePresentation } | null;
};

export type ResumeTemplate = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  data: ResumeDocument;
  style: ResumePresentation;
  switchable: true;
  incompatibility_reason: null;
};

const RETIRED_RESUME_TEMPLATE_KEYS = new Set(["blank-cn"]);

function selectableResumeTemplates(templates: ResumeTemplate[]): ResumeTemplate[] {
  return templates.filter((template) => !RETIRED_RESUME_TEMPLATE_KEYS.has(template.key));
}

export type AdminResumeTemplate = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  data: ResumeDocument | null;
  style: ResumePresentation | null;
  active: boolean;
  valid: boolean;
  validation_error: string | null;
  switchable: boolean;
  incompatibility_reason: string | null;
};

export type ResumeRecord = ResumeSummary & {
  template_id: string | null;
  data: ResumeDocument;
  style: ResumePresentation;
};

export type SemanticClassificationSuggestion = {
  section_id: string;
  semantic_kind:
    | "profile"
    | "work"
    | "education"
    | "project"
    | "skills"
    | "activity"
    | "interests"
    | "certificates"
    | "awards"
    | "languages"
    | "custom";
  confidence: number;
  reason: string;
};

export type ResumeVersion = {
  id: string;
  version_no: number;
  name: string;
  reason: "initial" | "manual" | "before_restore" | "restore" | "agent";
  created_at: string;
  data?: ResumeDocument;
  style?: ResumePresentation;
};

export type AgentMessage = {
  sequence_no: number;
  role: "user" | "assistant";
  message_type?: "text" | "clarification";
  content: string;
  clarification?: AgentClarification | null;
  /**
   * References are intentionally lightweight snapshots.  The API keeps this
   * field optional so messages created by the editor before the assistant
   * workspace was introduced remain readable.
   */
  contexts?: AgentContextSnapshot[] | null;
  created_at: string;
};

export type AgentClarificationQuestion = {
  id: string;
  header: string;
  question: string;
  allow_custom?: boolean;
  options: Array<{ id: string; label: string; description?: string | null }>;
};

export type AgentClarification = {
  version: 1;
  allow_custom?: boolean;
  questions: AgentClarificationQuestion[];
};

export type AgentSelectionContext = {
  block_ids: string[];
  from: number;
  to: number;
  selected_text: string;
  selected_text_hash: string;
};

export type AgentContextType =
  | "resume"
  | "resume_version"
  | "job"
  | "application"
  | "interview";

export type AgentContextRef = {
  type: AgentContextType;
  id: string;
  version_id?: string | null;
  version?: string | null;
};

export type AgentContextSnapshot = AgentContextRef & {
  resume_id?: string | null;
  label: string;
  description?: string | null;
  updated_at?: string | null;
};

export type AgentContextListResponse = {
  contexts?: AgentContextSnapshot[];
  groups?: Array<{ type: AgentContextType; items: AgentContextSnapshot[] }>;
};

export type AgentSession = {
  id: string;
  resume_id: string | null;
  title: string;
  status: "active" | "archived";
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  messages: AgentMessage[];
};

export type AgentProposal = {
  id: string;
  run_id: string;
  resume_id: string;
  base_lock_version: number;
  data: ResumeDocument;
  style: ResumePresentation;
  summary: string;
  proposal_mode?: "legacy_snapshot" | "polish_local" | "rewrite_entry_star" | "generate_from_materials";
  target?: Record<string, unknown> | null;
  diagnosis?: Record<string, unknown> | null;
  operations?: Array<{
    op: "replace_target_text" | "insert_after_target";
    target: Record<string, unknown>;
    new_text: string;
    expected_text_hash: string;
  }>;
  rationale?: Array<Record<string, string>>;
  source_refs?: Array<Record<string, unknown>>;
  status: "pending" | "applied" | "rejected" | "expired" | "conflicted";
  applied_lock_version: number | null;
  expires_at: string;
  created_at: string;
};

export type AgentStreamEvent =
  | { type: "run.started"; runId: string }
  | {
      type: "run.phase";
      runId: string;
      phase?: string;
      label?: string;
      referencedContextCount?: number;
    }
  | { type: "assistant.delta"; runId: string; delta: string }
  | { type: "clarification.requested"; runId: string; clarification: AgentClarification }
  | { type: "tool.started" | "tool.completed"; runId: string; tool: string; callKey: string }
  | { type: "proposal.created"; runId: string; proposal: AgentProposal }
  | { type: "run.completed" | "run.cancelled"; runId: string }
  | { type: "run.failed"; runId: string; error: string };

export type ResumeShareState = {
  share_token: string;
  share_visibility: "private" | "public";
  share_expires_at: string | null;
  share_created_at: string;
};

export type ResumeShareUpdatePayload = {
  visibility?: "private" | "public";
  expires_at?: string | null;
};

export type PublicShareSharer = {
  nickname: string;
  avatar_url: string | null;
};

export type PublicSharePayload = {
  data: ResumeDocument;
  style: ResumePresentation;
  sharer: PublicShareSharer;
};

export type UploadedAsset = {
  object_key: string;
  url: string;
};

export type ImportWarning =
  | "pdf_ocr_applied"
  | "pdf_low_text_quality"
  | "docx_embedded_images_omitted"
  | "docx_textbox_order_may_change"
  | "document_heading_structure_missing"
  | "source_quote_not_found"
  | "unparsed_work_start_date"
  | "unparsed_work_end_date"
  | "unmapped_fragments_preserved";

export type ResumeImportResult = {
  source_file_name: string;
  source_file_format: "md" | "docx" | "pdf";
  warnings: ImportWarning[];
};

export type DatasetRecord = {
  id: string;
  file_name: string;
  file_format: string;
  file_size: number;
  upload_status: "uploading" | "succeeded" | "failed";
  parse_status: "queued" | "processing" | "succeeded" | "failed" | null;
  failure_reason:
    | "format_unsupported"
    | "content_invalid"
    | "size_exceeded"
    | "service_unavailable"
    | "timeout"
    | "quota_exceeded"
    | "internal_error"
    | null;
  created_at: string;
};

export type DatasetLimits = {
  max_file_bytes: number;
  max_files_per_batch: number;
  allowed_extensions: string[];
};

export type DatasetListResponse = {
  datasets: DatasetRecord[];
  /** Older API responses did not include limits; callers normalize that case. */
  limits?: DatasetLimits;
};

export type DatasetContent = {
  id: string;
  file_name: string;
  file_format: string;
  markdown: string;
};

export type ResumeImportSummary = {
  id: string;
  source_filename: string;
  source_file_format: "md" | "docx" | "pdf";
  upload_status: "uploading" | "succeeded" | "failed";
  upload_duration_ms: number | null;
  parse_status: "processing" | "succeeded" | "failed" | null;
  parse_duration_ms: number | null;
  result_resume_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ResumeOverview = {
  resumes: ResumeSummary[];
  active_imports: ResumeImportSummary[];
  failed_imports: ResumeImportSummary[];
  next_failed_cursor: string | null;
};

export type JobSourceType = "manual" | "external_import";
export type JobEmploymentType =
  "full_time" | "part_time" | "internship" | "contract" | "temporary";
export type JobWorkMode = "onsite" | "hybrid" | "remote";
export type JobSalaryPeriod = "hour" | "day" | "month" | "year";

export type JobDescriptionSummary = {
  id: string;
  job_title: string;
  company_name: string;
  work_city: string | null;
  salary_text: string | null;
  skills: string[];
  source_type: JobSourceType;
  source_site: string | null;
  source_url: string | null;
  lock_version: number;
  updated_at: string;
};

export type JobDescriptionRecord = JobDescriptionSummary & {
  employment_type: JobEmploymentType | null;
  description: string;
  education_requirement: string | null;
  experience_requirement: string | null;
  work_schedule: string | null;
  work_address: string | null;
  work_mode: JobWorkMode | null;
  salary_min: string | null;
  salary_max: string | null;
  salary_currency: string | null;
  salary_period: JobSalaryPeriod | null;
  salary_months_per_year: number | null;
  company_legal_name: string | null;
  company_industry: string | null;
  company_size: string | null;
  company_financing_stage: string | null;
  company_description: string | null;
  recruiter_name: string | null;
  recruiter_title: string | null;
  source_job_id: string | null;
  source_url_hash: string | null;
  imported_at: string | null;
  notes: string | null;
  created_at: string;
};

export type JobDescriptionFields = {
  job_title: string;
  company_name: string;
  employment_type?: JobEmploymentType | null;
  description: string;
  skills?: string[];
  education_requirement?: string | null;
  experience_requirement?: string | null;
  work_schedule?: string | null;
  work_city?: string | null;
  work_address?: string | null;
  work_mode?: JobWorkMode | null;
  salary_text?: string | null;
  salary_min?: string | null;
  salary_max?: string | null;
  salary_currency?: string | null;
  salary_period?: JobSalaryPeriod | null;
  salary_months_per_year?: number | null;
  company_legal_name?: string | null;
  company_industry?: string | null;
  company_size?: string | null;
  company_financing_stage?: string | null;
  company_description?: string | null;
  recruiter_name?: string | null;
  recruiter_title?: string | null;
  notes?: string | null;
};

export type JobDescriptionDraft = {
  [K in keyof JobDescriptionFields]?: JobDescriptionFields[K] | null;
};

export type JobDescriptionDraftParseResponse = {
  draft: JobDescriptionDraft;
  warnings: string[];
  inputType: "text" | "image";
  callId: string;
};

export type InterviewCalendarColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "gray";
export type ApplicationStageType = "screening" | "interview" | "hr" | "offer";
export type ApplicationStageState =
  | "awaiting_schedule"
  | "scheduled"
  | "awaiting_result"
  | "negotiating";
export type InterviewMode = "video" | "onsite" | "phone" | "other";
export type InterviewSessionStatus = "scheduled" | "completed" | "cancelled";

export type JobApplicationRecord = {
  id: string;
  job_description_id: string | null;
  resume_version_id: string | null;
  company_name_snapshot: string;
  job_title_snapshot: string;
  job_snapshot: Record<string, unknown>;
  resume_title_snapshot: string | null;
  calendar_color: InterviewCalendarColor;
  current_stage_type: ApplicationStageType;
  current_round_no: number | null;
  current_stage_label: string;
  stage_state: ApplicationStageState;
  status: "active" | "rejected" | "withdrawn" | "closed";
  offer_status:
    | "none"
    | "oc_received"
    | "written_offer_received"
    | "accepted"
    | "declined";
  is_favorite: boolean;
  applied_at: string | null;
  notes: string | null;
  archived_at: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
};

export type JobApplicationSummary = JobApplicationRecord & {
  next_session_id: string | null;
  next_session_start_at: string | null;
  next_session_end_at: string | null;
  next_session_mode: InterviewMode | null;
};

export type InterviewSessionRecord = {
  id: string;
  application_id: string;
  client_request_id: string;
  stage_type: "interview" | "hr" | "offer" | "other";
  round_no: number | null;
  stage_label: string;
  status: InterviewSessionStatus;
  round_result: "pending" | "passed" | "rejected";
  start_at: string;
  end_at: string;
  timezone: string;
  mode: InterviewMode;
  meeting_url: string | null;
  location: string | null;
  interviewer_name: string | null;
  interviewer_title: string | null;
  reminder_minutes: number | null;
  preparation_note: string | null;
  questions_markdown: string | null;
  review_summary: string | null;
  improvement_markdown: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
};

export type InterviewSessionSummary = InterviewSessionRecord & {
  company_name: string;
  job_title: string;
  calendar_color: InterviewCalendarColor;
  application_stage_state: ApplicationStageState;
};

export type InterviewAssetRecord = {
  id: string;
  interview_session_id: string;
  source_type: "recorded" | "uploaded";
  asset_type: "audio" | "video" | "document";
  original_file_name: string;
  content_type: string;
  file_size: number;
  duration_ms: number | null;
  sha256: string | null;
  created_at: string;
};

export type InterviewSessionDetail = {
  session: InterviewSessionRecord;
  application: JobApplicationRecord;
  assets: InterviewAssetRecord[];
};

export type InterviewOverview = {
  metrics: {
    weekly_interviews: number;
    upcoming_interviews: number;
    completed_interviews: number;
    written_offers: number;
  };
  pipeline: JobApplicationSummary[];
  week_sessions: InterviewSessionSummary[];
};

export type PluginRelease = {
  version: string;
  released_at: string;
  browser: "Chrome";
  manifest_version: 3;
  size: number;
  sha256: string;
  download_url: string;
};

export type PluginReleaseCurrentResponse = {
  status: "available" | "unpublished";
  release: PluginRelease | null;
};

export type AdminPluginReleaseCurrentResponse = {
  status: "absent" | "published" | "unpublished";
  release: PluginRelease | null;
};

export type DuplicateResolution = {
  action: "update";
  job_description_id: string;
  base_lock_version: number;
};

export type JobDescriptionCreatePayload = JobDescriptionFields & {
  source_type: JobSourceType;
  source_url?: string | null;
  duplicate_resolution?: DuplicateResolution;
};

export type ChatAdapter =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "dashscope"
  | "openrouter"
  | "gemini"
  | "xai"
  | "groq"
  | "mistral"
  | "cohere_chat"
  | "perplexity";

export type LlmModelLastTest = {
  status: "succeeded" | "failed" | "cancelled";
  callId: string;
  testedAt: string;
};

export type LlmModelConfig = {
  id: string;
  capability: "chat";
  adapter: ChatAdapter;
  model: string;
  apiBase: string | null;
  keyConfigured: boolean;
  active: boolean;
  lastTest: LlmModelLastTest | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelCapability = "chat" | "resume_structuring" | "pi_agent" | "job_image_structuring";

export type CapabilityModelConfig = {
  id: string;
  adapter: ChatAdapter;
  model: string;
  apiBase: string | null;
  keyConfigured: boolean;
  configVersion: number;
  activeCapabilities: ModelCapability[];
  lastTest: LlmModelLastTest | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelCapabilityRecord = {
  capability: ModelCapability;
  activeModelId: string | null;
  bindingVersion: number;
  activeModel: CapabilityModelConfig | null;
  models: CapabilityModelConfig[];
};

export type ModelCapabilityList = {
  capabilities: ModelCapabilityRecord[];
};

export type ModelCatalog = {
  capabilities: ModelCapability[];
  adapters: ChatCatalogAdapter[];
};

export type ChatCapability = {
  capability: "chat";
  activeModelId: string | null;
  activeModel: LlmModelConfig | null;
  models: LlmModelConfig[];
};

export type ChatCatalogAdapter = {
  code: ChatAdapter;
  label: string;
  requiresApiKey: boolean;
  models: string[];
};

export type ChatCatalog = {
  capability: "chat";
  adapters: ChatCatalogAdapter[];
};

export type LlmModelCreatePayload = {
  adapter: ChatAdapter;
  model: string;
  apiBase?: string | null;
  apiKey?: string | null;
};

export type LlmModelPatchPayload = Partial<
  Omit<LlmModelCreatePayload, "apiKey">
> & {
  baseConfigVersion?: number;
  apiKey?: string | null;
};

export type LlmCallStatus = "pending" | "succeeded" | "failed" | "cancelled";
export type LlmMeteringStatus = "complete" | "partial" | "unknown";

export type LlmCallRecord = {
  callId: string;
  capability: ModelCapability;
  source: string;
  userId: string;
  modelConfigId: string | null;
  adapter: ChatAdapter | null;
  model: string | null;
  status: LlmCallStatus;
  meteringStatus: LlmMeteringStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  inputPricePerMillion: string | null;
  outputPricePerMillion: string | null;
  estimatedCostUsd: string | null;
  latencyMs: number | null;
  errorCode: string | null;
  modelConfigVersion?: number | null;
  createdAt: string;
};

export type LlmCallSummary = {
  callCount: number;
  incompleteMeteringCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: string | null;
};

export type LlmCallQuery = {
  source?: string;
  status?: LlmCallStatus;
  modelConfigId?: string;
  userId?: string;
  callId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

export type JobDuplicateDetails = {
  duplicate: {
    existing: JobDescriptionSummary;
    allowed_actions: Array<"update" | "cancel">;
  };
};

export type LogItem = {
  timestampNs: string;
  timestamp: string;
  eventId: string;
  eventVersion: number;
  logType: "system" | "audit";
  level: string;
  service: string;
  environment: string;
  source: string;
  logger: string;
  message: string;
  requestId: string | null;
  taskId: string | null;
  operationId: string | null;
  actorUserId: string | null;
  dependency: string | null;
  durationMs: number | null;
  httpMethod: string | null;
  httpRoute: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  exceptionType: string | null;
  exceptionStack: string | null;
  action: string | null;
  actorType: string | null;
  targetType: string | null;
  targetId: string | null;
  result: string | null;
  summary: string | null;
};

export type LogListResponse = {
  items: LogItem[];
  nextCursor: string | null;
  partial: boolean;
  droppedMalformed: number;
};

export type SystemLogQuery = {
  from?: string;
  to?: string;
  level?: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  source?: "backend" | "web";
  dependency?: "mysql" | "redis" | "minio" | "linkparse" | "llm";
  requestId?: string;
  taskId?: string;
  operationId?: string;
  errorCode?: string;
  keyword?: string;
  cursor?: string;
  limit?: number;
};

export type AuditLogQuery = {
  from?: string;
  to?: string;
  action?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  result?: "succeeded" | "failed";
  requestId?: string;
  cursor?: string;
  limit?: number;
};

export type LogSummary = {
  system: { total: number; warnings: number; errors: number };
  audit: { total: number; succeeded: number; failed: number };
};

type ApiOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type ResumePdfDownload = {
  blob: Blob;
  filename: string | null;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    code: string,
    readonly payload: Record<string, unknown> | null = null,
    readonly requestId: string | null = null,
  ) {
    super(code);
    this.name = "ApiRequestError";
  }
}

let refreshInFlight: Promise<boolean> | null = null;

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function reportApi5xx(error: ApiRequestError): void {
  if (typeof fetch !== "function") return;
  const reportRequestId = createRequestId();
  void fetch("/api/observability/client-events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": reportRequestId,
    },
    body: JSON.stringify({
      event_type: "api_5xx",
      error_name: error.name,
      message: error.message,
      request_id: error.requestId,
    }),
    credentials: "include",
  }).catch(() => undefined);
}

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = request<{ user: User }>(
      "/api/auth/refresh",
      { method: "POST" },
      false,
    )
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && error.status === 401) {
          return false;
        }
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: ApiOptions = {},
  retryAuth = true,
): Promise<T> {
  const requestId = options.headers?.["X-Request-ID"] ?? createRequestId();
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "X-Request-ID": requestId,
      ...options.headers,
    },
    body:
      options.formData ??
      (options.body ? JSON.stringify(options.body) : undefined),
    credentials: "include",
    signal: options.signal,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const responseRequestId = response.headers?.get?.("X-Request-ID") ?? requestId;
    const error = new ApiRequestError(
      response.status,
      typeof data.error === "string" ? data.error : `HTTP_${response.status}`,
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null,
      responseRequestId,
    );

    if (
      response.status === 401 &&
      retryAuth &&
      !path.startsWith("/api/auth/")
    ) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return request<T>(path, options, false);
      }
    }

    if (response.status >= 500 && path !== "/api/observability/client-events") {
      reportApi5xx(error);
    }
    throw error;
  }
  return data as T;
}

async function requestBlob(path: string, retryAuth = true): Promise<Blob> {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && retryAuth) {
      const refreshed = await refreshSession();
      if (refreshed) return requestBlob(path, false);
    }
    throw new ApiRequestError(
      response.status,
      typeof data.error === "string" ? data.error : `HTTP_${response.status}`,
      data && typeof data === "object" ? data as Record<string, unknown> : null,
    );
  }
  return response.blob();
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ""));
    } catch {
      // Fall through to the legacy filename parameter when decoding fails.
    }
  }
  return value.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    ?? value.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()
    ?? null;
}

async function requestResumePdf(
  path: string,
  signal?: AbortSignal,
  retryAuth = true,
): Promise<ResumePdfDownload> {
  const requestId = createRequestId();
  const response = await fetch(path, {
    method: "GET",
    headers: { "X-Request-ID": requestId },
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && retryAuth && !signal?.aborted) {
      const refreshed = await refreshSession();
      if (refreshed) return requestResumePdf(path, signal, false);
    }
    const error = new ApiRequestError(
      response.status,
      typeof data.error === "string" ? data.error : `HTTP_${response.status}`,
      data && typeof data === "object" ? data as Record<string, unknown> : null,
      response.headers?.get?.("X-Request-ID") ?? requestId,
    );
    if (response.status >= 500) reportApi5xx(error);
    throw error;
  }
  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(response.headers?.get?.("Content-Disposition") ?? null),
  };
}

async function streamAgentMessage(
  sessionId: string,
  payload: {
    content: string;
    idempotency_key: string;
    selection_context?: AgentSelectionContext;
    contexts?: AgentContextRef[];
    reply_to_sequence_no?: number;
  },
  signal: AbortSignal,
  onEvent: (event: AgentStreamEvent) => void,
  retryAuth = true,
): Promise<void> {
  const path = `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`;
  const requestId = createRequestId();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
    body: JSON.stringify(payload),
    credentials: "include",
    signal,
  });
  if (response.status === 401 && retryAuth && await refreshSession()) {
    return streamAgentMessage(sessionId, payload, signal, onEvent, false);
  }
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    const error = new ApiRequestError(
      response.status,
      typeof data.error === "string" ? data.error : `HTTP_${response.status}`,
      data && typeof data === "object" ? data as Record<string, unknown> : null,
      response.headers.get("X-Request-ID") ?? requestId,
    );
    if (response.status >= 500) reportApi5xx(error);
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalReceived = false;
  const terminalEvents = new Set(["run.completed", "run.failed", "run.cancelled"]);
  const allowedEvents = new Set([
    "run.started", "run.phase", "assistant.delta", "clarification.requested", "tool.started", "tool.completed",
    "proposal.created", ...terminalEvents,
  ]);
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const eventName = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
      const rawData = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!eventName || !rawData) continue;
      try {
        const data = JSON.parse(rawData) as Record<string, unknown>;
        if (allowedEvents.has(eventName)) {
          if (terminalEvents.has(eventName)) terminalReceived = true;
          onEvent({ type: eventName, ...data } as AgentStreamEvent);
        }
      } catch {
        // Ignore an isolated malformed or future event without losing the stream.
      }
    }
    if (done) break;
  }
  if (!terminalReceived) {
    throw new ApiRequestError(502, "AGENT_STREAM_INCOMPLETE", null, requestId);
  }
}

async function getCurrentUser(): Promise<{ user: User | null }> {
  const current = await request<{ user: User | null }>("/api/auth/me");
  if (current.user || !(await refreshSession())) {
    return current;
  }
  return request<{ user: User | null }>("/api/auth/me", {}, false);
}

export const api = {
  me: getCurrentUser,
  authCapabilities: () =>
    request<AuthCapabilities>("/api/auth/capabilities"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    }),
  register: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: { email, password },
    }),
  adminLogin: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/admin-login", {
      method: "POST",
      body: { email, password },
    }),
  wechatQrcode: () =>
    request<WeChatQrcodeResponse>("/api/auth/wechat/qrcode", {
      method: "POST",
    }),
  wechatStatus: (scene: string, pollToken: string) =>
    request<WeChatStatusResponse>(
      `/api/auth/wechat/status?scene=${encodeURIComponent(scene)}&poll_token=${encodeURIComponent(pollToken)}`,
    ),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  getAccountProfile: () => request<AccountProfile>("/api/account/profile"),
  updateAccountProfile: (nickname: string) =>
    request<UserProfile>("/api/account/profile", {
      method: "PATCH",
      body: { nickname },
    }),
  uploadAccountAvatar: (payload: { fileName: string; dataUrl: string }) =>
    request<{ url: string }>("/api/account/avatar", {
      method: "PUT",
      body: payload,
    }),
  deleteAccountAvatar: () =>
    request<{ ok: boolean }>("/api/account/avatar", { method: "DELETE" }),
  listResumes: () => request<{ resumes: ResumeSummary[] }>("/api/resumes"),
  getResumeOverview: () => request<ResumeOverview>("/api/resume-overview"),
  listResumeTemplates: () =>
    request<{ templates: ResumeTemplate[] }>("/api/resume-templates")
      .then(({ templates }) => ({ templates: selectableResumeTemplates(templates) })),
  getResumeTemplate: (id: string) =>
    request<{ template: ResumeTemplate }>(`/api/resume-templates/${id}`),
  createResume: (payload: { title: string; template_id: string }) =>
    request<{ resume: ResumeRecord }>("/api/resumes", {
      method: "POST",
      body: payload,
    }),
  getResume: (id: string) =>
    request<{ resume: ResumeRecord }>(`/api/resumes/${id}`),
  classifyResumeSemantics: (
    id: string,
    payload: { content_hash: string; section_ids?: string[] },
  ) => request<{ content_hash: string; suggestions: SemanticClassificationSuggestion[] }>(
    `/api/resumes/${id}/semantic-classification`,
    { method: "POST", body: payload },
  ),
  downloadResumePdf: (id: string, lockVersion: number, signal?: AbortSignal) =>
    requestResumePdf(
      `/api/resumes/${encodeURIComponent(id)}/pdf?lock_version=${encodeURIComponent(lockVersion)}`,
      signal,
    ),
  listAgentSessions: (resumeId?: string) =>
    request<{ sessions: AgentSession[] }>(
      `/api/agent/sessions${resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : ""}`,
    ),
  getAgentReadiness: () => request<{ ready: boolean }>("/api/agent/readiness"),
  listAgentContexts: (options: {
    type?: AgentContextType;
    search?: string;
    limit?: number;
  } = {}) => {
    const params = new URLSearchParams();
    if (options.type) params.set("type", options.type);
    if (options.search?.trim()) params.set("q", options.search.trim());
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    return request<AgentContextListResponse>(`/api/agent/contexts${query ? `?${query}` : ""}`);
  },
  listAgentProposals: (resumeId: string, sessionId?: string) =>
    request<{ proposals: AgentProposal[] }>(
      `/api/agent/proposals?resume_id=${encodeURIComponent(resumeId)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ""}`,
    ),
  getAgentSession: (sessionId: string) =>
    request<{ session: AgentSession }>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
    ),
  createAgentSession: (resumeId?: string | null, title?: string) =>
    request<{ session: AgentSession }>("/api/agent/sessions", {
      method: "POST",
      body: {
        ...(resumeId ? { resume_id: resumeId } : {}),
        ...(title ? { title } : {}),
      },
    }),
  streamAgentMessage,
  cancelAgentRun: (runId: string) =>
    request<{ run_id: string; status: string }>(
      `/api/agent/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
    ),
  confirmAgentProposal: (proposalId: string) =>
    request<{ resume: ResumeRecord }>(
      `/api/agent/proposals/${encodeURIComponent(proposalId)}/confirm`,
      { method: "POST" },
    ),
  rejectAgentProposal: (proposalId: string) =>
    request<{ proposal: AgentProposal }>(
      `/api/agent/proposals/${encodeURIComponent(proposalId)}/reject`,
      { method: "POST" },
    ),
  updateResume: (
    id: string,
    payload: {
      title?: string;
      data?: ResumeDocument;
      style?: ResumePresentation;
      base_lock_version: number;
    },
  ) =>
    request<{ resume: ResumeRecord }>(`/api/resumes/${id}`, {
      method: "PUT",
      body: payload,
    }),
  applyResumeTemplate: (
    id: string,
    payload: {
      template_id: string;
      base_lock_version: number;
      title?: string;
      data?: ResumeDocument;
    },
  ) => request<{ resume: ResumeRecord }>(`/api/resumes/${id}/apply-template`, {
    method: "POST",
    body: payload,
  }),
  deleteResume: (id: string) =>
    request<{ deleted: boolean }>(`/api/resumes/${id}`, { method: "DELETE" }),
  listVersions: (id: string) =>
    request<{ versions: ResumeVersion[] }>(`/api/resumes/${id}/versions`),
  createVersion: (id: string, name?: string) =>
    request<{ version: ResumeVersion }>(`/api/resumes/${id}/versions`, {
      method: "POST",
      body: name === undefined ? undefined : { name },
    }),
  renameVersion: (id: string, versionNo: number, name: string) =>
    request<{ version: ResumeVersion }>(`/api/resumes/${id}/versions/${versionNo}`, {
      method: "PATCH",
      body: { name },
    }),
  deleteVersion: (id: string, versionNo: number) =>
    request<{ deleted: boolean }>(`/api/resumes/${id}/versions/${versionNo}`, {
      method: "DELETE",
    }),
  getResumeVersion: (id: string, versionNo: number) =>
    request<{ version: ResumeVersion }>(`/api/resumes/${id}/versions/${versionNo}`),
  restoreVersion: (id: string, versionNo: number) =>
    request<{ resume: ResumeRecord }>(
      `/api/resumes/${id}/versions/${versionNo}/restore`,
      { method: "POST" },
    ),
  getShareState: (id: string) =>
    request<{ share: ResumeShareState | null }>(`/api/resumes/${id}/share`),
  createShare: (
    id: string,
    payload?: { visibility?: "private" | "public"; expires_at?: string | null },
  ) =>
    request<{ share: ResumeShareState }>(`/api/resumes/${id}/share`, {
      method: "POST",
      body: payload,
    }),
  updateShare: (id: string, payload: ResumeShareUpdatePayload) =>
    request<{ share: ResumeShareState }>(`/api/resumes/${id}/share`, {
      method: "PATCH",
      body: payload,
    }),
  deleteShare: (id: string) =>
    request<{ deleted: boolean }>(`/api/resumes/${id}/share`, {
      method: "DELETE",
    }),
  fetchPublicShare: (token: string) =>
    request<PublicSharePayload>(`/api/share/${encodeURIComponent(token)}`),
  importResume: (file: File, templateId: string, idempotencyKey: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("template_id", templateId);
    return request<{ import: ResumeImportSummary }>(
      "/api/resumes/import",
      {
        method: "POST",
        formData,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  },
  getResumeImport: (id: string) =>
    request<{ import: ResumeImportSummary }>(
      `/api/resume-imports/${encodeURIComponent(id)}`,
    ),
  deleteResumeImport: (id: string) =>
    request<{ deleted: boolean }>(`/api/resume-imports/${id}`, {
      method: "DELETE",
    }),
  listAdminResumeTemplates: () =>
    request<{ templates: AdminResumeTemplate[] }>("/api/admin/resume-templates"),
  importAdminResumeTemplate: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<{ template: AdminResumeTemplate }>(
      "/api/admin/resume-templates/import",
      { method: "POST", formData },
    );
  },
  updateAdminResumeTemplateStatus: (id: string, active: boolean) =>
    request<{ template: AdminResumeTemplate }>(
      `/api/admin/resume-templates/${id}/status`,
      { method: "PUT", body: { active } },
    ),
  uploadResumeAsset: (
    resumeId: string,
    payload: { file_name: string; data_url: string },
  ) =>
    request<{ asset: UploadedAsset }>(`/api/resumes/${resumeId}/assets`, {
      method: "POST",
      body: payload,
    }),
  uploadDataset: (file: File, idempotencyKey: string) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<DatasetRecord>("/api/datasets", {
      method: "POST",
      formData,
      headers: { "Idempotency-Key": idempotencyKey },
    });
  },
  listDatasets: () => request<DatasetListResponse>("/api/datasets"),
  renameDataset: (id: string, name: string) =>
    request<DatasetRecord>(`/api/datasets/${id}`, {
      method: "PATCH",
      body: { name },
    }),
  retryDataset: (id: string) =>
    request<DatasetRecord>(`/api/datasets/${id}/retry`, {
      method: "POST",
    }),
  deleteDataset: (id: string) =>
    request<{ deleted: boolean }>(`/api/datasets/${id}`, {
      method: "DELETE",
    }),
  getDatasetContent: (id: string) =>
    request<DatasetContent>(`/api/datasets/${id}/content`),
  listJobDescriptions: (
    params: {
      keyword?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.keyword) search.set("keyword", params.keyword);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    const suffix = search.toString();
    return request<{
      items: JobDescriptionSummary[];
      next_cursor: string | null;
    }>(`/api/job-descriptions${suffix ? `?${suffix}` : ""}`);
  },
  createJobDescription: (payload: JobDescriptionCreatePayload) =>
    request<{ job_description: JobDescriptionRecord }>(
      "/api/job-descriptions",
      { method: "POST", body: payload },
    ),
  parseJobDescriptionDraft: ({
    text,
    image,
    signal,
  }: {
    text?: string;
    image?: File;
    signal?: AbortSignal;
  }) => {
    const formData = new FormData();
    if (text !== undefined) formData.append("text", text);
    if (image !== undefined) formData.append("image", image);
    return request<JobDescriptionDraftParseResponse>(
      "/api/job-descriptions/parse-draft",
      { method: "POST", formData, signal },
    );
  },
  getJobDescription: (id: string) =>
    request<{ job_description: JobDescriptionRecord }>(
      `/api/job-descriptions/${id}`,
    ),
  updateJobDescription: (
    id: string,
    payload: JobDescriptionFields & { base_lock_version: number },
  ) =>
    request<{ job_description: JobDescriptionRecord }>(
      `/api/job-descriptions/${id}`,
      { method: "PUT", body: payload },
    ),
  deleteJobDescription: (id: string) =>
    request<{ deleted: boolean }>(`/api/job-descriptions/${id}`, {
      method: "DELETE",
    }),
  getInterviewOverview: (weekStart: string, timezone: string) => {
    const search = new URLSearchParams({ week_start: weekStart, timezone });
    return request<InterviewOverview>(`/api/interview-overview?${search}`);
  },
  listJobApplications: (
    params: {
      scope?: "active" | "archived" | "all";
      keyword?: string;
      status?: JobApplicationRecord["status"];
      stage_type?: ApplicationStageType;
      cursor?: string;
      limit?: number;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.scope) search.set("scope", params.scope);
    if (params.keyword) search.set("keyword", params.keyword);
    if (params.status) search.set("status", params.status);
    if (params.stage_type) search.set("stage_type", params.stage_type);
    if (params.cursor) search.set("cursor", params.cursor);
    search.set("limit", String(params.limit ?? 200));
    return request<{ items: JobApplicationSummary[]; next_cursor: string | null }>(
      `/api/job-applications?${search}`,
    );
  },
  createJobApplication: (payload: {
    job_description_id: string;
    resume_version_id?: string | null;
    current_stage_type: ApplicationStageType;
    current_round_no?: number | null;
    current_stage_label: string;
    stage_state: ApplicationStageState;
    applied_at?: string | null;
    notes?: string | null;
  }) =>
    request<{ application: JobApplicationRecord }>("/api/job-applications", {
      method: "POST",
      body: payload,
    }),
  updateJobApplication: (
    id: string,
    payload: Partial<{
      calendar_color: InterviewCalendarColor;
      is_favorite: boolean;
      notes: string | null;
      applied_at: string | null;
      resume_version_id: string | null;
    }> & { base_lock_version: number },
  ) =>
    request<{ application: JobApplicationRecord }>(`/api/job-applications/${id}`, {
      method: "PUT",
      body: payload,
    }),
  advanceJobApplication: (
    id: string,
    payload: {
      target_stage_type: ApplicationStageType;
      target_round_no?: number | null;
      target_stage_label: string;
      base_lock_version: number;
    },
  ) =>
    request<{ application: JobApplicationRecord }>(
      `/api/job-applications/${id}/advance`,
      { method: "POST", body: payload },
    ),
  recordJobApplicationOffer: (
    id: string,
    offerStatus: "oc_received" | "written_offer_received",
    baseLockVersion: number,
  ) =>
    request<{ application: JobApplicationRecord }>(
      `/api/job-applications/${id}/offer`,
      {
        method: "POST",
        body: {
          offer_status: offerStatus,
          base_lock_version: baseLockVersion,
        },
      },
    ),
  closeJobApplication: (
    id: string,
    payload: {
      status: "rejected" | "withdrawn" | "closed";
      offer_status?: "accepted" | "declined" | null;
      base_lock_version: number;
    },
  ) =>
    request<{ application: JobApplicationRecord }>(
      `/api/job-applications/${id}/close`,
      { method: "POST", body: payload },
    ),
  archiveJobApplication: (id: string, baseLockVersion: number) =>
    request<{ application: JobApplicationRecord }>(
      `/api/job-applications/${id}/archive`,
      { method: "POST", body: { base_lock_version: baseLockVersion } },
    ),
  restoreJobApplication: (id: string, baseLockVersion: number) =>
    request<{ application: JobApplicationRecord }>(
      `/api/job-applications/${id}/restore`,
      { method: "POST", body: { base_lock_version: baseLockVersion } },
    ),
  deleteJobApplication: (id: string) =>
    request<{ deleted: boolean }>(`/api/job-applications/${id}`, {
      method: "DELETE",
    }),
  listInterviewSessions: (
    params: {
      start_at?: string;
      end_at?: string;
      status?: InterviewSessionStatus;
      application_id?: string;
      include_archived?: boolean;
      cursor?: string;
      limit?: number;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.start_at) search.set("start_at", params.start_at);
    if (params.end_at) search.set("end_at", params.end_at);
    if (params.status) search.set("status", params.status);
    if (params.application_id)
      search.set("application_id", String(params.application_id));
    if (params.include_archived) search.set("include_archived", "true");
    if (params.cursor) search.set("cursor", params.cursor);
    search.set("limit", String(params.limit ?? 500));
    return request<{
      items: InterviewSessionSummary[];
      next_cursor: string | null;
    }>(`/api/interview-sessions${search.size ? `?${search}` : ""}`);
  },
  getInterviewSession: (id: string) =>
    request<InterviewSessionDetail>(`/api/interview-sessions/${id}`),
  createInterviewSession: (
    applicationId: string,
    payload: {
      client_request_id: string;
      stage_type: "interview" | "hr" | "offer" | "other";
      round_no?: number | null;
      stage_label: string;
      start_at: string;
      end_at: string;
      timezone: string;
      mode: InterviewMode;
      meeting_url?: string | null;
      location?: string | null;
      interviewer_name?: string | null;
      interviewer_title?: string | null;
      reminder_minutes?: number | null;
      preparation_note?: string | null;
      allow_conflict?: boolean;
    },
  ) =>
    request<InterviewSessionDetail>(
      `/api/job-applications/${applicationId}/interview-sessions`,
      { method: "POST", body: payload },
    ),
  updateInterviewSession: (
    id: string,
    payload: Partial<{
      mode: InterviewMode;
      meeting_url: string | null;
      location: string | null;
      interviewer_name: string | null;
      interviewer_title: string | null;
      reminder_minutes: number | null;
      preparation_note: string | null;
      questions_markdown: string | null;
      review_summary: string | null;
      improvement_markdown: string | null;
    }> & { base_lock_version: number },
  ) =>
    request<InterviewSessionDetail>(`/api/interview-sessions/${id}`, {
      method: "PUT",
      body: payload,
    }),
  rescheduleInterviewSession: (
    id: string,
    payload: {
      start_at: string;
      end_at: string;
      timezone: string;
      allow_conflict: boolean;
      base_lock_version: number;
    },
  ) =>
    request<InterviewSessionDetail>(
      `/api/interview-sessions/${id}/reschedule`,
      { method: "POST", body: payload },
    ),
  completeInterviewSession: (
    id: string,
    payload: {
      questions_markdown?: string | null;
      review_summary?: string | null;
      improvement_markdown?: string | null;
      base_lock_version: number;
    },
  ) =>
    request<InterviewSessionDetail>(`/api/interview-sessions/${id}/complete`, {
      method: "POST",
      body: payload,
    }),
  cancelInterviewSession: (
    id: string,
    payload: { reason?: string | null; base_lock_version: number },
  ) =>
    request<InterviewSessionDetail>(`/api/interview-sessions/${id}/cancel`, {
      method: "POST",
      body: payload,
    }),
  deleteInterviewSession: (id: string) =>
    request<{ deleted: boolean; application: JobApplicationRecord }>(
      `/api/interview-sessions/${id}`,
      { method: "DELETE" },
    ),
  uploadInterviewAsset: (
    sessionId: string,
    file: File,
    sourceType: "recorded" | "uploaded",
    durationMs?: number,
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("source_type", sourceType);
    if (durationMs) formData.append("duration_ms", String(durationMs));
    return request<{ asset: InterviewAssetRecord }>(
      `/api/interview-sessions/${sessionId}/assets`,
      { method: "POST", formData },
    );
  },
  downloadInterviewAsset: (assetId: string) =>
    requestBlob(`/api/interview-assets/${assetId}/content`),
  deleteInterviewAsset: (assetId: string) =>
    request<{ deleted: boolean }>(`/api/interview-assets/${assetId}`, {
      method: "DELETE",
    }),
  getPluginRelease: () =>
    request<PluginReleaseCurrentResponse>("/api/plugin-releases/current"),
  downloadPluginRelease: (version: string) =>
    requestBlob(`/api/plugin-releases/${encodeURIComponent(version)}/download`),
  adminPublishPluginRelease: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<{ release: PluginRelease; cleanup_pending: boolean }>("/api/admin/plugin-releases", {
      method: "POST",
      formData,
    });
  },
  getAdminPluginRelease: () =>
    request<AdminPluginReleaseCurrentResponse>(
      "/api/admin/plugin-releases/current",
    ),
  adminUnpublishPluginRelease: () =>
    request<{ unpublished: true; release: PluginRelease }>(
      "/api/admin/plugin-releases/current",
      { method: "DELETE" },
    ),
  adminReactivatePluginRelease: () =>
    request<{ release: PluginRelease }>(
      "/api/admin/plugin-releases/current/publish",
      { method: "POST" },
    ),
  adminDeletePluginRelease: () =>
    request<{ deleted: true }>(
      "/api/admin/plugin-releases/current/package",
      { method: "DELETE" },
    ),
  adminListUsers: (
    params: {
      page?: number;
      size?: number;
      q?: string;
      status?: string;
      role?: string;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.size) search.set("size", String(params.size));
    if (params.q) search.set("q", params.q);
    if (params.status) search.set("status", params.status);
    if (params.role) search.set("role", params.role);
    const suffix = search.toString();
    return request<AdminUserListResponse>(
      `/api/auth/admin/users${suffix ? `?${suffix}` : ""}`,
    );
  },
  adminGetUser: (userId: string) =>
    request<AdminUserDetail>(`/api/auth/admin/users/${userId}`),
  adminUpdateUserStatus: (userId: string, action: "disable" | "enable") =>
    request<AdminStatusUpdateResponse>(
      `/api/auth/admin/users/${userId}/status`,
      { method: "PATCH", body: { action } },
    ),
  adminStats: () => request<AdminStatsResponse>("/api/auth/admin/stats"),
  getChatCapability: () =>
    request<ChatCapability>("/api/admin/llm/capabilities/chat"),
  getModelCapabilities: () =>
    request<ModelCapabilityList>("/api/admin/llm/capabilities"),
  getModelCatalog: () => request<ModelCatalog>("/api/admin/llm/catalog"),
  getChatCatalog: () => request<ChatCatalog>("/api/admin/llm/catalog/chat"),
  createLlmModel: (payload: LlmModelCreatePayload) =>
    request<{ model: LlmModelConfig }>("/api/admin/llm/models", {
      method: "POST",
      body: payload,
    }),
  updateLlmModel: (id: string, payload: LlmModelPatchPayload) =>
    request<{ model: LlmModelConfig; validationCallId: string | null }>(
      `/api/admin/llm/models/${id}`,
      {
        method: "PATCH",
        body: payload,
      },
    ),
  testLlmModel: (id: string) =>
    request<{ ok: true; callId: string }>(`/api/admin/llm/models/${id}/test`, {
      method: "POST",
    }),
  bindChatModel: (id: string) =>
    request<{ activeModel: LlmModelConfig; callId: string }>(
      `/api/admin/llm/models/${id}/activate`,
      {
        method: "POST",
      },
    ),
  bindModelCapability: (
    capability: Exclude<ModelCapability, "chat">,
    id: string,
    baseConfigVersion?: number,
    baseBindingVersion?: number,
  ) =>
    request<{
      capability: ModelCapability;
      activeModelId: string;
      bindingVersion: number;
      validationId: string;
      callId: string;
      activeModel: CapabilityModelConfig;
    }>(`/api/admin/llm/capabilities/${capability}/binding`, {
      method: "PUT",
      body: {
        modelConfigId: id,
        ...(baseConfigVersion ? { baseConfigVersion } : {}),
        ...(baseBindingVersion ? { baseBindingVersion } : {}),
      },
    }),
  testModelCapability: (
    id: string,
    capability: ModelCapability,
    baseConfigVersion?: number,
  ) =>
    request<{
      ok: true;
      capability: ModelCapability;
      validationId: string;
      callId: string;
      configVersion: number;
    }>(`/api/admin/llm/models/${id}/tests`, {
      method: "POST",
      body: {
        capability,
        ...(baseConfigVersion ? { baseConfigVersion } : {}),
      },
    }),
  deleteLlmModel: (id: string) =>
    request<void>(`/api/admin/llm/models/${id}`, { method: "DELETE" }),
  listLlmCalls: (params: LlmCallQuery = {}) => {
    const search = new URLSearchParams();
    if (params.source) search.set("source", params.source);
    if (params.status) search.set("status", params.status);
    if (params.modelConfigId) search.set("modelConfigId", params.modelConfigId);
    if (params.userId) search.set("userId", params.userId);
    if (params.callId) search.set("callId", params.callId);
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    const suffix = search.toString();
    return request<{
      calls: LlmCallRecord[];
      summary: LlmCallSummary;
      nextCursor: string | null;
    }>(`/api/admin/llm/calls${suffix ? `?${suffix}` : ""}`);
  },
  reportClientEvent: (payload: {
    eventType: "unhandled_error" | "unhandled_rejection" | "render_error" | "api_5xx";
    errorName: string;
    message: string;
    stack?: string | null;
    requestId?: string | null;
  }) =>
    request<{ accepted: true; eventId: string | null }>(
      "/api/observability/client-events",
      {
        method: "POST",
        body: {
          event_type: payload.eventType,
          error_name: payload.errorName,
          message: payload.message,
          stack: payload.stack,
          request_id: payload.requestId,
        },
      },
    ),
  reportAuditEvent: (payload: {
    action: "resume.pdf_export";
    targetId: string;
    result: "succeeded" | "failed";
    errorCode?: string | null;
  }) =>
    request<{ accepted: true; eventId: string | null }>("/api/audit/events", {
      method: "POST",
      body: {
        action: payload.action,
        target_type: "resume",
        target_id: payload.targetId,
        result: payload.result,
        error_code: payload.errorCode,
      },
    }),
  adminListSystemLogs: (params: SystemLogQuery = {}) =>
    request<LogListResponse>(withLogQuery("/api/admin/logs/system", params)),
  adminListAuditLogs: (params: AuditLogQuery = {}) =>
    request<LogListResponse>(withLogQuery("/api/admin/logs/audit", params)),
  adminLogSummary: (params: { from?: string; to?: string } = {}) =>
    request<LogSummary>(withLogQuery("/api/admin/logs/summary", params)),
};

function withLogQuery(path: string, params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
}

export type { ResumeDocument, ResumePresentation } from "./resumeContract";
