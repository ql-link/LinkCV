import type { ResumeSettings } from "../store/resumeStore";

export type User = {
  id: string;
  email: string;
};

export type ResumeSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ResumeRecord = ResumeSummary & {
  markdown: string;
  settings: ResumeSettings;
  splitRatio: number;
  previewScale: number;
};

type ApiOptions = {
  method?: string;
  body?: unknown;
};

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error ?? `HTTP_${response.status}`);
  }

  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>("/api/auth/me"),
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
};
