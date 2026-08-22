import type { ResumeDocumentV1, ResumeStyleV1 } from "./resumeContract";

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
  preview?: { data: ResumeDocumentV1; style: ResumeStyleV1 } | null;
};

export type ResumeTemplate = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  data: ResumeDocumentV1;
  style: ResumeStyleV1;
};

export type AdminResumeTemplate = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  data: ResumeDocumentV1 | null;
  style: ResumeStyleV1 | null;
  active: boolean;
  valid: boolean;
  validation_error: string | null;
};

export type ResumeRecord = ResumeSummary & {
  template_id: string | null;
  data: ResumeDocumentV1;
  style: ResumeStyleV1;
};

export type ResumeVersion = {
  id: string;
  version_no: number;
  name: string;
  reason: "initial" | "manual" | "before_restore" | "restore";
  created_at: string;
  data?: ResumeDocumentV1;
  style?: ResumeStyleV1;
};

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
  data: ResumeDocumentV1;
  style: ResumeStyleV1;
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
  parse_status: "processing" | "succeeded" | "failed" | null;
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
  archived_at: string | null;
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
  action: "update" | "restore";
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
  apiKey?: string | null;
};

export type LlmCallStatus = "pending" | "succeeded" | "failed" | "cancelled";
export type LlmMeteringStatus = "complete" | "partial" | "unknown";

export type LlmCallRecord = {
  callId: string;
  capability: "chat";
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
    allowed_actions: Array<"restore" | "update" | "cancel">;
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
    request<{ templates: ResumeTemplate[] }>("/api/resume-templates"),
  getResumeTemplate: (id: string) =>
    request<{ template: ResumeTemplate }>(`/api/resume-templates/${id}`),
  createResume: (payload: { title: string; template_id: string }) =>
    request<{ resume: ResumeRecord }>("/api/resumes", {
      method: "POST",
      body: payload,
    }),
  getResume: (id: string) =>
    request<{ resume: ResumeRecord }>(`/api/resumes/${id}`),
  updateResume: (
    id: string,
    payload: {
      title?: string;
      data?: ResumeDocumentV1;
      style?: ResumeStyleV1;
      base_lock_version: number;
    },
  ) =>
    request<{ resume: ResumeRecord }>(`/api/resumes/${id}`, {
      method: "PUT",
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
  uploadDataset: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<DatasetRecord>("/api/datasets", {
      method: "POST",
      formData,
    });
  },
  listDatasets: () => request<{ datasets: DatasetRecord[] }>("/api/datasets"),
  getDatasetContent: (id: string) =>
    request<DatasetContent>(`/api/datasets/${id}/content`),
  listJobDescriptions: (
    params: {
      scope?: "active" | "archived" | "all";
      keyword?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.scope) search.set("scope", params.scope);
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
  archiveJobDescription: (id: string, baseLockVersion: number) =>
    request<{ job_description: JobDescriptionRecord }>(
      `/api/job-descriptions/${id}/archive`,
      {
        method: "POST",
        body: { base_lock_version: baseLockVersion },
      },
    ),
  restoreJobDescription: (id: string, baseLockVersion: number) =>
    request<{ job_description: JobDescriptionRecord }>(
      `/api/job-descriptions/${id}/restore`,
      {
        method: "POST",
        body: { base_lock_version: baseLockVersion },
      },
    ),
  deleteJobDescription: (id: string) =>
    request<{ deleted: boolean }>(`/api/job-descriptions/${id}`, {
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

export type { ResumeDocumentV1, ResumeStyleV1 } from "./resumeContract";
