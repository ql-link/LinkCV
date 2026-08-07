import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "./client";

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

  it("导入请求刷新会话后保留同一个幂等键", async () => {
    const imported = { resume: { id: "8" }, import: { warnings: [] } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "1", email: "zhangsan@example.test" } }),
      )
      .mockResolvedValueOnce(jsonResponse(201, imported));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["# 张三"], "resume.md", { type: "text/markdown" });
    const key = "8d42a61f-2396-4dbc-a63d-a1770e398f61";

    await api.importResume(file, undefined, key);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/resumes/import",
      expect.objectContaining({ headers: { "Idempotency-Key": key } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/resumes/import",
      expect.objectContaining({ headers: { "Idempotency-Key": key } }),
    );
  });
});

describe("JD API client", () => {
  it("编码列表筛选和游标，并保持相对 API 路径", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], next_cursor: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.listJobDescriptions({
      scope: "archived",
      keyword: "Java 后端",
      cursor: "cursor/value",
      limit: 30,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/job-descriptions?scope=archived&keyword=Java+%E5%90%8E%E7%AB%AF&cursor=cursor%2Fvalue&limit=30",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("保留重复冲突的受控详情供页面选择后续动作", async () => {
    const duplicate = {
      existing: { id: "42", job_title: "Java 开发", lock_version: 3 },
      allowed_actions: ["update", "cancel"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, { error: "JD_SOURCE_DUPLICATE", duplicate }),
      ),
    );

    try {
      await api.createJobDescription({
        job_title: "Java 开发",
        company_name: "示例科技",
        description: "虚构岗位",
        source_type: "manual",
        source_url: "https://example.test/jobs/42",
      });
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).payload).toEqual({
        error: "JD_SOURCE_DUPLICATE",
        duplicate,
      });
    }
  });
});

describe("WeChat scan login API client", () => {
  it("申请登录二维码时提交 mode 并读取 scene 与 base64 图片", async () => {
    const body = { scene: "login:abcd1234", qr_base64: "base64-qr" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, body)),
    );

    await expect(api.wechatQrcode("login")).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/wechat/qrcode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "login" }),
        credentials: "include",
      }),
    );
  });

  it("绑定模式同样通过同一接口提交 bind", async () => {
    const body = { scene: "bind:abcd5678", qr_base64: "base64-qr" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, body)),
    );

    await expect(api.wechatQrcode("bind")).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/wechat/qrcode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "bind" }),
      }),
    );
  });

  it("轮询状态时编码 scene 查询参数并返回当前状态", async () => {
    const status = { status: "success", user: { id: "9", email: null, nickname: "微信用户" } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, status)),
    );

    await expect(api.wechatStatus("login:a b")).resolves.toEqual(status);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/wechat/status?scene=login%3Aa%20b",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("二维码请求受限时抛出可读错误码", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(429, { error: "WECHAT_RATE_LIMITED" })),
    );

    await expect(api.wechatQrcode("login")).rejects.toThrow(
      "WECHAT_RATE_LIMITED",
    );
  });
});
