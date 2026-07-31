import type { ResumeDocumentV1, ResumeStyleV1 } from "./resumeContract";

export type User = {
  id: string;
  email: string;
  nickname: string;
  is_admin: boolean;
};

export type ResumeSummary = {
  id: string;
  title: string;
  source_type: "blank" | "template" | "import";
  lock_version: number;
  created_at: string;
  updated_at: string;
};

export type ResumeRecord = ResumeSummary & {
  template_id: string | null;
  data: ResumeDocumentV1;
  style: ResumeStyleV1;
  source_filename: string | null;
};

export type ResumeVersion = {
  id: string;
  version_no: number;
  reason: "initial" | "manual" | "before_restore" | "restore";
  created_at: string;
  data?: ResumeDocumentV1;
  style?: ResumeStyleV1;
};

export type UploadedAsset = {
  object_key: string;
  url: string;
};

export type JobSourceType = "manual" | "external_import";
export type JobEmploymentType = "full_time" | "part_time" | "internship" | "contract" | "temporary";
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

type ApiOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    code: string,
    readonly payload: Record<string, unknown> | null = null,
  ) {
    super(code);
    this.name = "ApiRequestError";
  }
}

let refreshInFlight: Promise<boolean> | null = null;

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
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.formData ?? (options.body ? JSON.stringify(options.body) : undefined),
    credentials: "include",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new ApiRequestError(
      response.status,
      typeof data.error === "string" ? data.error : `HTTP_${response.status}`,
      data && typeof data === "object" ? data as Record<string, unknown> : null,
    );

    if (response.status === 401 && retryAuth && !path.startsWith("/api/auth/")) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return request<T>(path, options, false);
      }
    }

    throw error;
  }
  return data as T;
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
  register: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/register", { method: "POST", body: { email, password } }),
 login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: { email, password } }),
  adminLogin: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/admin-login", { method: "POST", body: { email, password } }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  listResumes: () => request<{ resumes: ResumeSummary[] }>("/api/resumes"),
  createResume: (payload: { title?: string; template_id?: string }) =>
    request<{ resume: ResumeRecord }>("/api/resumes", { method: "POST", body: payload }),
  getResume: (id: string) => request<{ resume: ResumeRecord }>(`/api/resumes/${id}`),
  updateResume: (
    id: string,
    payload: {
      title?: string;
      data?: ResumeDocumentV1;
      style?: ResumeStyleV1;
      base_lock_version: number;
    },
  ) => request<{ resume: ResumeRecord }>(`/api/resumes/${id}`, { method: "PUT", body: payload }),
  deleteResume: (id: string) => request<{ deleted: boolean }>(`/api/resumes/${id}`, { method: "DELETE" }),
  listVersions: (id: string) => request<{ versions: ResumeVersion[] }>(`/api/resumes/${id}/versions`),
  createVersion: (id: string) => request<{ version: ResumeVersion }>(`/api/resumes/${id}/versions`, { method: "POST" }),
  deleteVersion: (id: string, versionNo: number) =>
    request<{ deleted: boolean }>(`/api/resumes/${id}/versions/${versionNo}`, { method: "DELETE" }),
  restoreVersion: (id: string, versionNo: number) =>
    request<{ resume: ResumeRecord }>(`/api/resumes/${id}/versions/${versionNo}/restore`, { method: "POST" }),
  importResume: (file: File, title?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (title) formData.append("title", title);
    return request<{ resume: ResumeRecord; import: { warnings: string[] } }>("/api/resumes/import", { method: "POST", formData });
  },
  uploadResumeAsset: (resumeId: string, payload: { file_name: string; data_url: string }) =>
    request<{ asset: UploadedAsset }>(`/api/resumes/${resumeId}/assets`, { method: "POST", body: payload }),
  listJobDescriptions: (params: {
    scope?: "active" | "archived" | "all";
    keyword?: string;
    cursor?: string;
    limit?: number;
  } = {}) => {
    const search = new URLSearchParams();
    if (params.scope) search.set("scope", params.scope);
    if (params.keyword) search.set("keyword", params.keyword);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    const suffix = search.toString();
    return request<{ items: JobDescriptionSummary[]; next_cursor: string | null }>(
      `/api/job-descriptions${suffix ? `?${suffix}` : ""}`,
    );
  },
  createJobDescription: (payload: JobDescriptionCreatePayload) =>
    request<{ job_description: JobDescriptionRecord }>("/api/job-descriptions", { method: "POST", body: payload }),
  getJobDescription: (id: string) =>
    request<{ job_description: JobDescriptionRecord }>(`/api/job-descriptions/${id}`),
  updateJobDescription: (id: string, payload: JobDescriptionFields & { base_lock_version: number }) =>
    request<{ job_description: JobDescriptionRecord }>(`/api/job-descriptions/${id}`, { method: "PUT", body: payload }),
  archiveJobDescription: (id: string, baseLockVersion: number) =>
    request<{ job_description: JobDescriptionRecord }>(`/api/job-descriptions/${id}/archive`, {
      method: "POST",
      body: { base_lock_version: baseLockVersion },
    }),
  restoreJobDescription: (id: string, baseLockVersion: number) =>
    request<{ job_description: JobDescriptionRecord }>(`/api/job-descriptions/${id}/restore`, {
      method: "POST",
      body: { base_lock_version: baseLockVersion },
    }),
  deleteJobDescription: (id: string) =>
    request<{ deleted: boolean }>(`/api/job-descriptions/${id}`, { method: "DELETE" }),
  getChatCapability: () =>
    request<ChatCapability>("/api/admin/llm/capabilities/chat"),
  getChatCatalog: () =>
    request<ChatCatalog>("/api/admin/llm/catalog/chat"),
  createLlmModel: (payload: LlmModelCreatePayload) =>
    request<{ model: LlmModelConfig }>("/api/admin/llm/models", {
      method: "POST",
      body: payload,
    }),
  updateLlmModel: (id: string, payload: LlmModelPatchPayload) =>
    request<{ model: LlmModelConfig; validationCallId: string | null }>(`/api/admin/llm/models/${id}`, {
      method: "PATCH",
      body: payload,
    }),
  testLlmModel: (id: string) =>
    request<{ ok: true; callId: string }>(`/api/admin/llm/models/${id}/test`, {
      method: "POST",
    }),
  activateLlmModel: (id: string) =>
    request<{ activeModel: LlmModelConfig; callId: string }>(`/api/admin/llm/models/${id}/activate`, {
      method: "POST",
    }),
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
};

export type { ResumeDocumentV1, ResumeStyleV1 } from "./resumeContract";
