import { afterEach, describe, expect, it, vi } from "vitest";

import { connectToLinkResume, importJob, uploadCompanyLogo } from "./linkresume";

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("LinkResume extension API client", () => {
  it("uploads multipart data with cookies and retries after refreshing authentication", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: "7" } }))
      .mockResolvedValueOnce(jsonResponse(200, { logo_url: "/api/job-descriptions/42/logo", revision: "a".repeat(64) }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadCompanyLogo("https://linkresume.example.test", "42", new Blob(["image"]));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://linkresume.example.test/api/job-descriptions/42/logo",
      "https://linkresume.example.test/api/auth/refresh",
      "https://linkresume.example.test/api/job-descriptions/42/logo",
    ]);
    const request = fetchMock.mock.calls[0]![1];
    expect(request.credentials).toBe("include");
    expect(request.body).toBeInstanceOf(FormData);
    expect(request.headers).toBeUndefined();
  });
  it("checks both local origins and prefers the one with an authenticated session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { user: null }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "INVALID_CREDENTIALS" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "7", email: "user@example.test" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const connection = await connectToLinkResume();

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

  it("release channels only connect to the origin injected into that package", async () => {
    vi.stubEnv("WXT_PUBLIC_LINKRESUME_CHANNEL", "production");
    vi.stubEnv("WXT_PUBLIC_LINKRESUME_ORIGIN", "https://linkresume.cn");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { user: { id: "7", email: "user@example.test" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const connection = await connectToLinkResume();

    expect(connection?.origin).toBe("https://linkresume.cn");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://linkresume.cn/api/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("a release channel without an injected origin does not fall back to another environment", async () => {
    vi.stubEnv("WXT_PUBLIC_LINKRESUME_CHANNEL", "development");
    vi.stubEnv("WXT_PUBLIC_LINKRESUME_ORIGIN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectToLinkResume()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([201, 200])("refreshes an expired session and preserves the %i import result", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "7", email: "user@example.test" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(status, {
          job_description: {
            id: "42",
            job_title: "后端工程师",
            company_name: "示例公司",
            source_url: "https://www.zhipin.com/job_detail/abc.html",
            lock_version: 1,
          },
          application: { id: "application-42", phase: "pending" },
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

    expect(result.job_description.id).toBe("42");
    expect(result.application?.id).toBe("application-42");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:5173/api/job-descriptions/import",
      "http://127.0.0.1:5173/api/auth/refresh",
      "http://127.0.0.1:5173/api/job-descriptions/import",
    ]);
  });
});
