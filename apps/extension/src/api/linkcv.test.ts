import { afterEach, describe, expect, it, vi } from "vitest";

import { connectToLinkCV, importJob } from "./linkcv";

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LinkCV extension API client", () => {
  it("checks both local origins and prefers the one with an authenticated session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { user: null }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "INVALID_CREDENTIALS" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "7", email: "user@example.test" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const connection = await connectToLinkCV();

    expect(connection).toEqual({
      origin: "http://localhost:5173",
      user: { id: "7", email: "user@example.test" },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:5173/api/auth/me",
      "http://127.0.0.1:5173/api/auth/refresh",
      "http://localhost:5173/api/auth/me",
    ]);
  });

  it("refreshes an expired session once before retrying an import", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "7", email: "user@example.test" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          job_description: {
            id: "42",
            job_title: "后端工程师",
            company_name: "示例公司",
            source_url: "https://www.zhipin.com/job_detail/abc.html",
            archived_at: null,
            lock_version: 1,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await importJob("http://127.0.0.1:5173", {
      source_url: "https://www.zhipin.com/job_detail/abc.html",
      capture: {
        job_title: "后端工程师",
        company_name: "示例公司",
        description_text: "负责 API 开发",
        skills: ["Python"],
        company_tags: [],
      },
    });

    expect(result.id).toBe("42");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:5173/api/job-descriptions/import",
      "http://127.0.0.1:5173/api/auth/refresh",
      "http://127.0.0.1:5173/api/job-descriptions/import",
    ]);
  });
});
