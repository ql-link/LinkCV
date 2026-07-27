import type { ResumeDocumentV1, ResumeStyleV1 } from "./resumeContract";

export type User = {
  id: string;
  email: string;
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

type ApiOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    code: string,
  ) {
    super(code);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.formData ?? (options.body ? JSON.stringify(options.body) : undefined),
    credentials: "include",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(response.status, data.error ?? `HTTP_${response.status}`);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>("/api/auth/me"),
  register: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/register", { method: "POST", body: { email, password } }),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: { email, password } }),
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
};

export type { ResumeDocumentV1, ResumeStyleV1 } from "./resumeContract";
