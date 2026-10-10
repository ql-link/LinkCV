import type {
  DuplicateDetails,
  ImportJobPayload,
  JobImportResult,
} from "../contracts";

interface User {
  id: string;
  email: string | null;
  nickname?: string | null;
}

export interface LinkResumeConnection {
  origin: string;
  user: User | null;
}

export class LinkResumeApiError extends Error {
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

export async function connectToLinkResume(): Promise<LinkResumeConnection | null> {
  let firstReachable: LinkResumeConnection | null = null;
  for (const origin of candidateOrigins()) {
    try {
      const current = await rawRequest<{ user: User | null }>(origin, "/api/auth/me");
      if (current.user) return { origin, user: current.user };
      firstReachable ??= { origin, user: null };
      const refreshed = await tryRefresh(origin);
      if (refreshed) return { origin, user: refreshed };
    } catch (error) {
      if (error instanceof LinkResumeApiError && error.status < 500) {
        firstReachable ??= { origin, user: null };
      }
    }
  }
  return firstReachable;
}

export async function importJob(
  origin: string,
  payload: ImportJobPayload,
): Promise<JobImportResult> {
  try {
    return await importOnce(origin, payload);
  } catch (error) {
    if (error instanceof LinkResumeApiError && error.status === 401 && (await tryRefresh(origin))) {
      return importOnce(origin, payload);
    }
    throw error;
  }
}

export function linkResumeUrl(origin: string, path: string): string {
  return new URL(path, `${origin}/`).toString();
}

export async function uploadCompanyLogo(origin: string, jobId: string, file: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", file, "company-logo");
  const send = () => rawRequest(origin, `/api/job-descriptions/${encodeURIComponent(jobId)}/logo`, {
    method: "POST", body: form, signal: AbortSignal.timeout(20_000),
  });
  try {
    await send();
  } catch (error) {
    if (error instanceof LinkResumeApiError && error.status === 401 && await tryRefresh(origin)) {
      await send();
      return;
    }
    throw error;
  }
}

async function importOnce(origin: string, payload: ImportJobPayload): Promise<JobImportResult> {
  return rawRequest<JobImportResult>(
    origin,
    "/api/job-descriptions/import",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

const refreshes = new Map<string, Promise<User | null>>();

function tryRefresh(origin: string): Promise<User | null> {
  const existing = refreshes.get(origin);
  if (existing) return existing;
  const refresh = () => rawRequest<{ user: User }>(origin, "/api/auth/refresh", { method: "POST" }).then((result) => result.user);
  const locks = globalThis.navigator?.locks;
  const pending = (locks ? locks.request(`linkresume-session-refresh:${origin}`, async () => {
    // Side panel and service worker share an extension origin, but separate JS globals.
    const current = await rawRequest<{ user: User | null }>(origin, "/api/auth/me");
    return current.user ?? await refresh();
  }) : refresh()).catch(() => null)
    .finally(() => refreshes.delete(origin));
  refreshes.set(origin, pending);
  return pending;
}

export async function apiRequest<T>(origin: string, path: string, init: RequestInit = {}): Promise<T> {
  // Callers use fixed API paths; a bridge message cannot choose an arbitrary target.
  if (!candidateOrigins().includes(origin) || !path.startsWith("/api/")) throw new Error("LinkResume 地址不匹配");
  try {
    return await rawRequest<T>(origin, path, init);
  } catch (error) {
    if (error instanceof LinkResumeApiError && error.status === 401 && !init.signal?.aborted && await tryRefresh(origin)) {
      return rawRequest<T>(origin, path, init);
    }
    throw error;
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
    headers: typeof init.body === "string" ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new LinkResumeApiError(
      response.status,
      typeof body.error === "string" ? body.error : `HTTP_${response.status}`,
      body,
    );
  }
  return body as T;
}

export function candidateOrigins(): string[] {
  const configuredChannel = import.meta.env.WXT_PUBLIC_LINKRESUME_CHANNEL;
  const configuredOrigin = import.meta.env.WXT_PUBLIC_LINKRESUME_ORIGIN;
  const values = configuredChannel === "development" || configuredChannel === "production"
    ? [configuredOrigin]
    : [configuredOrigin, ...FALLBACK_ORIGINS];
  const origins: string[] = [];
  for (const value of values) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (!origins.includes(url.origin)) origins.push(url.origin);
    } catch {
      // Release packages fail closed; ordinary local builds may continue to fallbacks.
    }
  }
  return origins;
}
