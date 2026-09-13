import { afterEach, describe, expect, it } from "vitest";
import { applyRouteSeo, SITE_DESCRIPTION, SITE_TITLE } from "./seo";

describe("applyRouteSeo", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("allows the public landing page to be indexed with one canonical URL", () => {
    applyRouteSeo({ kind: "landing" });

    expect(document.title).toBe(SITE_TITLE);
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute("content", SITE_DESCRIPTION);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toContain("index, follow");
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://linkresume.cn/");
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute("content", SITE_TITLE);
  });

  it("keeps user workspace routes out of search results", () => {
    applyRouteSeo({ kind: "resumes" });

    expect(document.title).toBe("我的简历 | LinkResume");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeInTheDocument();
    expect(document.head.querySelector('meta[property="og:title"]')).not.toBeInTheDocument();
  });

  it("does not expose public resume share links to discovery by default", () => {
    applyRouteSeo({ kind: "share", token: "private-token" });

    expect(document.title).toBe("公开简历 | LinkResume");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");
  });
});
