import type { ResumeSettings } from "../store/resumeStore";

export type User = {
  id: string;
  email: string;
};

export type ResumeSummary = {
  id: string;
  title: string;
  sourceType: "blank" | "template" | "import";
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ResumeRecord = ResumeSummary & {
  markdown: string;
  settings: ResumeSettings;
  splitRatio: number;
  previewScale: number;
};

export type UploadedAsset = {
  objectName: string;
  url: string;
};

type ApiOptions = {
  method?: string;
  body?: unknown;
};

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    code: string,
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
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new ApiRequestError(
      response.status,
      typeof data.error === "string" ? data.error : `HTTP_${response.status}`,
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
    request<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: { email, password },
    }),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  listResumes: () => request<{ resumes: ResumeSummary[] }>("/api/resumes"),
  createResume: (payload: Partial<ResumeRecord>) =>
    request<{ resume: ResumeRecord }>("/api/resumes", {
      method: "POST",
      body: payload,
    }),
  getResume: (id: string) => request<{ resume: ResumeRecord }>(`/api/resumes/${id}`),
  updateResume: (id: string, payload: Partial<ResumeRecord>) =>
    request<{ resume: ResumeRecord }>(`/api/resumes/${id}`, {
      method: "PUT",
      body: payload,
    }),
  deleteResume: (id: string) =>
    request<{ deleted: boolean }>(`/api/resumes/${id}`, { method: "DELETE" }),
  uploadAsset: (payload: { fileName: string; dataUrl: string }) =>
    request<{ asset: UploadedAsset }>("/api/assets", {
      method: "POST",
      body: payload,
    }),
};
