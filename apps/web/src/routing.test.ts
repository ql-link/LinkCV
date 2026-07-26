import { describe, expect, it } from "vitest";
import { authPath, editorPath, isSafeAppPath, navigateTo, parseAppRoute } from "./routing";

describe("LinkCV routes", () => {
  it("parses landing, auth, resume list, and editor routes", () => {
    expect(parseAppRoute("/")).toEqual({ kind: "landing" });
    expect(parseAppRoute("/login", "?mode=register")).toEqual({ kind: "auth", mode: "register", next: null });
    expect(parseAppRoute("/resumes/")).toEqual({ kind: "resumes" });
    expect(parseAppRoute("/resumes/resume_123/edit")).toEqual({ kind: "editor", resumeId: "resume_123" });
    expect(parseAppRoute("/missing")).toEqual({ kind: "notFound" });
  });

  it("encodes resume identifiers and only accepts internal resume return paths", () => {
    expect(editorPath("resume/a b")).toBe("/resumes/resume%2Fa%20b/edit");
    expect(isSafeAppPath("/resumes/resume_123/edit")).toBe(true);
    expect(isSafeAppPath("//example.com/resumes")).toBe(false);
    expect(isSafeAppPath("https://example.com/resumes")).toBe(false);
    expect(authPath("login", "/resumes/resume_123/edit")).toBe("/login?next=%2Fresumes%2Fresume_123%2Fedit");
  });

  it("updates browser history for in-app navigation", () => {
    window.history.replaceState(null, "", "/");
    navigateTo("/resumes");
    expect(window.location.pathname).toBe("/resumes");
    navigateTo("/login", { replace: true });
    expect(window.location.pathname).toBe("/login");
  });
});
