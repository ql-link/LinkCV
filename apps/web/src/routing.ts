import { useSyncExternalStore } from "react";

export type AppRoute =
  | { kind: "landing" }
  | { kind: "auth"; mode: "login" | "register"; next: string | null }
  | { kind: "admin" }
  | { kind: "resumes" }
  | { kind: "editor"; resumeId: string }
  | { kind: "jobs" }
  | { kind: "jobCreate" }
  | { kind: "jobDetail"; jobId: string }
  | { kind: "jobEdit"; jobId: string }
  | { kind: "notFound" };

type NavigateOptions = {
  replace?: boolean;
};

const editorPathPattern = /^\/resumes\/([^/]+)\/edit$/;
const jobDetailPathPattern = /^\/jobs\/([^/]+)$/;
const jobEditPathPattern = /^\/jobs\/([^/]+)\/edit$/;

function normalizePathname(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function isSafeAppPath(value: string | null) {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//") && /^\/(?:resumes|jobs)(?:\/|$)/.test(value));
}

export function parseAppRoute(pathname: string, search = ""): AppRoute {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === "/") return { kind: "landing" };
  if (/^\/admin(?:\/|$)/.test(normalizedPath)) return { kind: "admin" };
  if (normalizedPath === "/login") {
    const params = new URLSearchParams(search);
    const next = params.get("next");
    return {
      kind: "auth",
      mode: params.get("mode") === "register" ? "register" : "login",
      next: isSafeAppPath(next) ? next : null,
    };
  }
  if (normalizedPath === "/resumes") return { kind: "resumes" };
  if (normalizedPath === "/jobs") return { kind: "jobs" };
  if (normalizedPath === "/jobs/new") return { kind: "jobCreate" };

  const editorMatch = normalizedPath.match(editorPathPattern);
  if (editorMatch) {
    try {
      return { kind: "editor", resumeId: decodeURIComponent(editorMatch[1]) };
    } catch {
      return { kind: "notFound" };
    }
  }

  const jobEditMatch = normalizedPath.match(jobEditPathPattern);
  if (jobEditMatch) {
    try {
      return { kind: "jobEdit", jobId: decodeURIComponent(jobEditMatch[1]) };
    } catch {
      return { kind: "notFound" };
    }
  }

  const jobDetailMatch = normalizedPath.match(jobDetailPathPattern);
  if (jobDetailMatch) {
    try {
      return { kind: "jobDetail", jobId: decodeURIComponent(jobDetailMatch[1]) };
    } catch {
      return { kind: "notFound" };
    }
  }

  return { kind: "notFound" };
}

export function editorPath(resumeId: string) {
  return `/resumes/${encodeURIComponent(resumeId)}/edit`;
}

export function jobDetailPath(jobId: string) {
  return `/jobs/${encodeURIComponent(jobId)}`;
}

export function jobEditPath(jobId: string) {
  return `/jobs/${encodeURIComponent(jobId)}/edit`;
}

export function authPath(mode: "login" | "register", next?: string | null) {
  const params = new URLSearchParams();
  if (mode === "register") params.set("mode", "register");
  if (isSafeAppPath(next ?? null)) params.set("next", next as string);
  const search = params.toString();
  return search ? `/login?${search}` : "/login";
}

export function navigateTo(path: string, options: NavigateOptions = {}) {
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === path) return;
  if (options.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function subscribeToLocation(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getLocationSnapshot() {
  return `${window.location.pathname}${window.location.search}`;
}

export function useAppRoute() {
  const location = useSyncExternalStore(subscribeToLocation, getLocationSnapshot, () => "/");
  const url = new URL(location, "http://linkcv.local");
  return parseAppRoute(url.pathname, url.search);
}
