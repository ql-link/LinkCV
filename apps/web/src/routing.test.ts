import { describe, expect, it } from "vitest";
import {
  adminLoginPath,
  authPath,
  editorPath,
  isSafeAdminPath,
  isSafeAppPath,
  jobDetailPath,
  jobEditPath,
  legacyCareerRedirect,
  navigateTo,
  parseAppRoute,
  sharePath,
} from "./routing";

describe("LinkCV routes", () => {
  it("parses landing, auth, admin, resume, template, and editor routes", () => {
    expect(parseAppRoute("/")).toEqual({ kind: "landing" });
    expect(parseAppRoute("/home")).toEqual({ kind: "landing" });
    expect(parseAppRoute("/home/")).toEqual({ kind: "landing" });
    expect(parseAppRoute("/login", "?mode=register")).toEqual({ kind: "auth", mode: "register", next: null });
    expect(parseAppRoute("/admin/llm/models")).toEqual({ kind: "admin" });
    expect(parseAppRoute("/resumes/")).toEqual({ kind: "resumes" });
    expect(parseAppRoute("/assistant/")).toEqual({ kind: "assistant" });
    expect(parseAppRoute("/templates/")).toEqual({ kind: "templates" });
    expect(parseAppRoute("/resumes/resume_123/edit")).toEqual({ kind: "editor", resumeId: "resume_123" });
    expect(parseAppRoute("/jobs")).toEqual({ kind: "jobs" });
    expect(parseAppRoute("/jobs/new")).toEqual({ kind: "jobCreate" });
    expect(parseAppRoute("/jobs/job_123")).toEqual({ kind: "jobDetail", jobId: "job_123" });
    expect(parseAppRoute("/jobs/job_123/edit")).toEqual({ kind: "jobEdit", jobId: "job_123" });
    expect(parseAppRoute("/interviews")).toEqual({ kind: "interviews", view: "applications" });
    expect(parseAppRoute("/career")).toEqual({ kind: "interviews", view: "applications" });
    expect(parseAppRoute("/career/jobs")).toEqual({ kind: "jobs" });
    expect(parseAppRoute("/career/jobs/new")).toEqual({ kind: "jobCreate" });
    expect(parseAppRoute("/career/applications")).toEqual({ kind: "interviews", view: "applications", jobId: undefined, createApplication: undefined });
    expect(parseAppRoute("/career/applications", "?job=job_123&create=1")).toEqual({ kind: "interviews", view: "applications", jobId: "job_123", createApplication: true });
    expect(parseAppRoute("/career/applications/application_1")).toEqual({ kind: "interviews", view: "applications", applicationId: "application_1", sessionId: undefined });
    expect(parseAppRoute("/career/applications/application_1", "?session=session_1")).toEqual({ kind: "interviews", view: "records", applicationId: "application_1", sessionId: "session_1" });
    expect(parseAppRoute("/career/schedule")).toEqual({ kind: "interviews", view: "schedule" });
    expect(parseAppRoute("/career/reviews")).toEqual({ kind: "interviews", view: "records", sessionId: undefined });
    expect(parseAppRoute("/interviews", "?view=schedule")).toEqual({ kind: "interviews", view: "schedule" });
    expect(parseAppRoute("/interviews", "?view=records")).toEqual({ kind: "interviews", view: "records" });
    expect(parseAppRoute("/interviews", "?view=overview")).toEqual({ kind: "interviews", view: "applications" });
    expect(parseAppRoute("/interviews", "?view=unknown")).toEqual({ kind: "interviews", view: "applications" });
    expect(parseAppRoute("/datasets")).toEqual({ kind: "datasets" });
    expect(parseAppRoute("/account")).toEqual({ kind: "account" });
    expect(parseAppRoute("/account/password")).toEqual({ kind: "notFound" });
    expect(parseAppRoute("/share/abc123")).toEqual({ kind: "share", token: "abc123" });
    expect(parseAppRoute("/share/a%20b")).toEqual({ kind: "share", token: "a b" });
    expect(parseAppRoute("/missing")).toEqual({ kind: "notFound" });
  });

  it("redirects career entry routes to the two current career center entries", () => {
    expect(legacyCareerRedirect("/career")).toBe("/career/applications");
    expect(legacyCareerRedirect("/interviews")).toBe("/career/applications");
    expect(legacyCareerRedirect("/interviews", "?view=overview")).toBe("/career/applications");
    expect(legacyCareerRedirect("/interviews", "?view=unknown")).toBe("/career/applications");
    expect(legacyCareerRedirect("/interviews", "?view=applications")).toBe("/career/applications");
  });

  it("encodes share tokens when building share paths", () => {
    expect(sharePath("abc123")).toBe("/share/abc123");
    expect(sharePath("a/b c")).toBe("/share/a%2Fb%20c");
  });

  it("parses the admin login route and its safe next target", () => {
    expect(parseAppRoute("/admin/login")).toEqual({ kind: "adminLogin", next: null });
    expect(parseAppRoute("/admin/login", "?next=/admin/users")).toEqual({ kind: "adminLogin", next: "/admin/users" });
    expect(parseAppRoute("/admin/login", "?next=https://example.com")).toEqual({ kind: "adminLogin", next: null });
    expect(parseAppRoute("/admin/login/")).toEqual({ kind: "adminLogin", next: null });
  });

  it("encodes resume identifiers and only accepts internal resume return paths", () => {
    expect(editorPath("resume/a b")).toBe("/resumes/resume%2Fa%20b/edit");
    expect(jobDetailPath("job/a b")).toBe("/career/jobs/job%2Fa%20b");
    expect(jobEditPath("job/a b")).toBe("/career/jobs/job%2Fa%20b/edit");
    expect(isSafeAppPath("/resumes/resume_123/edit")).toBe(true);
    expect(isSafeAppPath("/assistant")).toBe(true);
    expect(isSafeAppPath("/templates")).toBe(true);
    expect(isSafeAppPath("/jobs/job_123/edit")).toBe(true);
    expect(isSafeAppPath("/interviews?view=records")).toBe(true);
    expect(isSafeAppPath("/career?view=applications")).toBe(true);
    expect(isSafeAppPath("/datasets")).toBe(true);
    expect(isSafeAppPath("/account")).toBe(true);
    expect(isSafeAppPath("/account/password")).toBe(true);
    expect(isSafeAppPath("//example.com/resumes")).toBe(false);
    expect(isSafeAppPath("https://example.com/resumes")).toBe(false);
    expect(authPath("login", "/resumes/resume_123/edit")).toBe("/login?next=%2Fresumes%2Fresume_123%2Fedit");
  });

  it("only accepts internal admin paths as login return targets", () => {
    expect(isSafeAdminPath("/admin")).toBe(true);
    expect(isSafeAdminPath("/admin/users")).toBe(true);
    expect(isSafeAdminPath("/admin/llm/models")).toBe(true);
    expect(isSafeAdminPath("/admin/login")).toBe(false);
    expect(isSafeAdminPath("/admin/login/")).toBe(false);
    expect(isSafeAdminPath("//example.com/admin")).toBe(false);
    expect(isSafeAdminPath("https://example.com/admin")).toBe(false);
    expect(isSafeAdminPath(null)).toBe(false);
  });

  it("builds admin login paths with an encoded next target", () => {
    expect(adminLoginPath()).toBe("/admin/login");
    expect(adminLoginPath("/admin/users")).toBe("/admin/login?next=%2Fadmin%2Fusers");
    expect(adminLoginPath("https://example.com")).toBe("/admin/login");
  });

  it("updates browser history for in-app navigation", () => {
    window.history.replaceState(null, "", "/");
    navigateTo("/resumes");
    expect(window.location.pathname).toBe("/resumes");
    navigateTo("/login", { replace: true });
    expect(window.location.pathname).toBe("/login");
  });
});
