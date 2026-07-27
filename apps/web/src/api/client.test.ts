import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API session refresh", () => {
  it("应用启动时 access 失效会刷新会话并重新读取当前用户", async () => {
    const user = { id: "1", email: "zhangsan@example.test" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { user: null }))
      .mockResolvedValueOnce(jsonResponse(200, { user }))
      .mockResolvedValueOnce(jsonResponse(200, { user }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.me()).resolves.toEqual({ user });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/auth/me",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("没有 refresh 会话时仍按访客返回", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { user: null }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "INVALID_CREDENTIALS" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.me()).resolves.toEqual({ user: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("受保护请求 401 后刷新并只重试一次", async () => {
    const resumes = [{ id: "1", title: "张三的简历" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "1", email: "zhangsan@example.test" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { resumes }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listResumes()).resolves.toEqual({ resumes });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("refresh 失效时保留原始未登录错误且不循环重试", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "INVALID_CREDENTIALS" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listResumes()).rejects.toThrow("UNAUTHORIZED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("登录失败不会触发 refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "INVALID_CREDENTIALS" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.login("zhangsan@example.test", "wrong-password"),
    ).rejects.toThrow("INVALID_CREDENTIALS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("并发 401 共用一次 refresh，避免轮换令牌互相撤销", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "1", email: "zhangsan@example.test" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { resumes: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { resumes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(Promise.all([api.listResumes(), api.listResumes()])).resolves.toEqual([
      { resumes: [] },
      { resumes: [] },
    ]);
    const refreshCalls = fetchMock.mock.calls.filter(
      ([path]) => path === "/api/auth/refresh",
    );
    expect(refreshCalls).toHaveLength(1);
  });
});
