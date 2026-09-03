import { useSyncExternalStore } from "react";

export type AppRoute =
  | { kind: "landing" }
  | { kind: "auth"; mode: "login" | "register"; next: string | null }
  | { kind: "admin" }
  | { kind: "adminLogin"; next: string | null }
  | { kind: "resumes" }
  | { kind: "assistant" }
  | { kind: "templates" }
  | { kind: "resumeCreate" }
  | { kind: "editor"; resumeId: string }
  | { kind: "interviews"; view: InterviewView; applicationId?: string; sessionId?: string; jobId?: string; createApplication?: boolean; importJob?: boolean }
  | { kind: "jobDetail"; jobId: string }
  | { kind: "datasets" }
  | { kind: "account" }
  | { kind: "share"; token: string }
  | { kind: "notFound" };

export type InterviewView = "applications" | "schedule" | "records";

type NavigateOptions = {
  replace?: boolean;
  state?: unknown;
};

const editorPathPattern = /^\/resumes\/([^/]+)\/edit$/;
const jobDetailPathPattern = /^\/(?:career\/jobs|jobs)\/([^/]+)$/;
const jobEditPathPattern = /^\/(?:career\/jobs|jobs)\/([^/]+)\/edit$/;
const applicationDetailPathPattern = /^\/career\/applications\/([^/]+)$/;
const sharePathPattern = /^\/share\/([^/]+)$/;

function normalizePathname(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function isSafeAppPath(value: string | null) {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//") && /^\/(?:resumes|assistant|templates|jobs|career|interviews|account|datasets)(?:\/|$|\?)/.test(value));
}

export function isSafeAdminPath(value: string | null) {
  return Boolean(
    value &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      /^\/admin(?:\/|$)/.test(value) &&
      !/^\/admin\/login(?:\/|$)/.test(value),
  );
}

export function parseAppRoute(pathname: string, search = ""): AppRoute {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === "/" || normalizedPath === "/home") return { kind: "landing" };
  if (/^\/admin\/login(?:\/|$)/.test(normalizedPath)) {
    const params = new URLSearchParams(search);
    const next = params.get("next");
    return { kind: "adminLogin", next: isSafeAdminPath(next) ? next : null };
  }
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
  if (normalizedPath === "/assistant") return { kind: "assistant" };
  if (normalizedPath === "/templates") return { kind: "templates" };
  if (normalizedPath === "/resumes/new") return { kind: "resumeCreate" };
  if (normalizedPath === "/career/jobs" || normalizedPath === "/jobs") return { kind: "interviews", view: "applications" };
  if (normalizedPath === "/career") return { kind: "interviews", view: "applications" };
  if (normalizedPath === "/interviews") {
    const requestedView = new URLSearchParams(search).get("view");
    if (requestedView === "applications" || requestedView === "schedule" || requestedView === "records") {
      return { kind: "interviews", view: requestedView };
    }
    return { kind: "interviews", view: "applications" };
  }
  if (normalizedPath === "/career/applications") {
    const params = new URLSearchParams(search);
    return {
      kind: "interviews",
      view: "applications",
      jobId: params.get("job") ?? undefined,
      createApplication: params.get("create") === "1" || undefined,
      importJob: params.get("import") === "1" || undefined,
    };
  }
  if (normalizedPath === "/career/schedule") return { kind: "interviews", view: "schedule" };
  if (normalizedPath === "/career/reviews") {
    return { kind: "interviews", view: "records", sessionId: new URLSearchParams(search).get("session") ?? undefined };
  }
  if (normalizedPath === "/career/jobs/new" || normalizedPath === "/jobs/new") {
    return { kind: "interviews", view: "applications", importJob: true };
  }
  if (normalizedPath === "/datasets") return { kind: "datasets" };
  if (normalizedPath === "/account") return { kind: "account" };

  const editorMatch = normalizedPath.match(editorPathPattern);
  if (editorMatch) {
    try {
      return { kind: "editor", resumeId: decodeURIComponent(editorMatch[1]) };
    } catch {
      return { kind: "notFound" };
    }
  }

  const applicationDetailMatch = normalizedPath.match(applicationDetailPathPattern);
  if (applicationDetailMatch) {
    try {
      const sessionId = new URLSearchParams(search).get("session") ?? undefined;
      return {
        kind: "interviews",
        view: "applications",
        applicationId: decodeURIComponent(applicationDetailMatch[1]),
        sessionId,
      };
    } catch {
      return { kind: "notFound" };
    }
  }

  const jobEditMatch = normalizedPath.match(jobEditPathPattern);
  if (jobEditMatch) {
    try {
      return { kind: "jobDetail", jobId: decodeURIComponent(jobEditMatch[1]) };
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

  const shareMatch = normalizedPath.match(sharePathPattern);
  if (shareMatch) {
    try {
      return { kind: "share", token: decodeURIComponent(shareMatch[1]) };
    } catch {
      return { kind: "notFound" };
    }
  }

  return { kind: "notFound" };
}

export function sharePath(token: string) {
  return `/share/${encodeURIComponent(token)}`;
}

export function editorPath(resumeId: string) {
  return `/resumes/${encodeURIComponent(resumeId)}/edit`;
}

export function jobDetailPath(jobId: string, fromApplicationId?: string) {
  const path = `/career/jobs/${encodeURIComponent(jobId)}`;
  return fromApplicationId
    ? `${path}?fromApplication=${encodeURIComponent(fromApplicationId)}`
    : path;
}

export function careerViewPath(view: InterviewView) {
  return view === "applications"
    ? "/career/applications"
    : view === "schedule"
      ? "/career/schedule"
      : "/career/reviews";
}

export function careerApplicationPath(applicationId: string, sessionId?: string | null) {
  const path = `/career/applications/${encodeURIComponent(applicationId)}`;
  return sessionId ? `${path}?session=${encodeURIComponent(sessionId)}` : path;
}

export function startCareerApplicationPath(jobId: string) {
  const params = new URLSearchParams({ job: jobId, create: "1" });
  return `/career/applications?${params}`;
}

export function legacyCareerRedirect(pathname: string, search = ""): string | null {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === "/career" || normalizedPath === "/career/jobs" || normalizedPath === "/jobs") {
    return "/career/applications";
  }
  if (normalizedPath === "/career/jobs/new" || normalizedPath === "/jobs/new") {
    return "/career/applications?import=1";
  }
  if (normalizedPath.startsWith("/jobs/")) {
    return `/career${normalizedPath.replace(/\/edit$/, "")}${search}`;
  }
  if (normalizedPath.startsWith("/career/jobs/") && normalizedPath.endsWith("/edit")) {
    return `${normalizedPath.replace(/\/edit$/, "")}${search}`;
  }
  if (normalizedPath === "/interviews") {
    const requestedView = new URLSearchParams(search).get("view");
    if (requestedView === "applications" || requestedView === "schedule" || requestedView === "records") {
      return careerViewPath(requestedView);
    }
    return "/career/applications";
  }
  return null;
}

export function authPath(mode: "login" | "register", next?: string | null) {
  const params = new URLSearchParams();
  if (mode === "register") params.set("mode", "register");
  if (isSafeAppPath(next ?? null)) params.set("next", next as string);
  const search = params.toString();
  return search ? `/login?${search}` : "/login";
}

export function adminLoginPath(next?: string | null) {
  const params = new URLSearchParams();
  if (isSafeAdminPath(next ?? null)) params.set("next", next as string);
  const search = params.toString();
  return search ? `/admin/login?${search}` : "/admin/login";
}

export function navigateTo(path: string, options: NavigateOptions = {}) {
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === path) return;
  if (options.replace) window.history.replaceState(options.state ?? null, "", path);
  else window.history.pushState(options.state ?? null, "", path);
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
