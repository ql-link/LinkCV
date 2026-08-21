import type {
  DuplicateDetails,
  ImportJobPayload,
  JobRecord,
} from "../contracts";

interface User {
  id: string;
  email: string;
}

export interface LinkCVConnection {
  origin: string;
  user: User | null;
}

export class LinkCVApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown>,
  ) {
    super(code);
  }

  get duplicate(): DuplicateDetails | null {
    const value = this.details.duplicate;
    if (!value || typeof value !== "object") return null;
    return value as DuplicateDetails;
  }
}

const FALLBACK_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];

export async function connectToLinkCV(): Promise<LinkCVConnection | null> {
  let firstReachable: LinkCVConnection | null = null;
  for (const origin of candidateOrigins()) {
    try {
      const current = await rawRequest<{ user: User | null }>(origin, "/api/auth/me");
      if (current.user) return { origin, user: current.user };
      firstReachable ??= { origin, user: null };
      const refreshed = await tryRefresh(origin);
      if (refreshed) return { origin, user: refreshed };
    } catch (error) {
      if (error instanceof LinkCVApiError && error.status < 500) {
        firstReachable ??= { origin, user: null };
      }
    }
  }
  return firstReachable;
}

export async function importJob(
  origin: string,
  payload: ImportJobPayload,
): Promise<JobRecord> {
  try {
    return await importOnce(origin, payload);
  } catch (error) {
    if (error instanceof LinkCVApiError && error.status === 401 && (await tryRefresh(origin))) {
      return importOnce(origin, payload);
    }
    throw error;
  }
}

export function linkCVUrl(origin: string, path: string): string {
  return new URL(path, `${origin}/`).toString();
}

async function importOnce(origin: string, payload: ImportJobPayload): Promise<JobRecord> {
  const response = await rawRequest<{ job_description: JobRecord }>(
    origin,
    "/api/job-descriptions/import",
    { method: "POST", body: JSON.stringify(payload) },
  );
  return response.job_description;
}

async function tryRefresh(origin: string): Promise<User | null> {
  try {
    const result = await rawRequest<{ user: User }>(origin, "/api/auth/refresh", {
      method: "POST",
    });
    return result.user;
  } catch {
    return null;
  }
}

async function rawRequest<T>(
  origin: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    credentials: "include",
    headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new LinkCVApiError(
      response.status,
      typeof body.error === "string" ? body.error : `HTTP_${response.status}`,
      body,
    );
  }
  return body as T;
}

function candidateOrigins(): string[] {
  const values = [import.meta.env.WXT_PUBLIC_LINKCV_ORIGIN, ...FALLBACK_ORIGINS];
  const origins: string[] = [];
  for (const value of values) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (!origins.includes(url.origin)) origins.push(url.origin);
    } catch {
      // Invalid build-time configuration is ignored; local fallbacks still work.
    }
  }
  return origins;
}
