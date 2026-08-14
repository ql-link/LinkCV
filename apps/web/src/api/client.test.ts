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
    const imported = { import: { id: "8", parse_status: "processing" } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { id: "1", email: "zhangsan@example.test" } }),
      )
      .mockResolvedValueOnce(jsonResponse(202, imported));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["# 张三"], "resume.md", { type: "text/markdown" });
    const key = "8d42a61f-2396-4dbc-a63d-a1770e398f61";

    await api.importResume(file, "8", key);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/resumes/import",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": key }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/resumes/import",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": key }),
      }),
    );
  });
});

describe("API observability", () => {
  it("adds a request id and reports API 5xx without exposing the response body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: "SERVICE_UNAVAILABLE", secret: "hidden" }))
      .mockResolvedValueOnce(jsonResponse(202, { accepted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listResumes()).rejects.toMatchObject({
      status: 503,
      message: "SERVICE_UNAVAILABLE",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect((firstOptions.headers as Record<string, string>)["X-Request-ID"]).toBeTruthy();
    const reportBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/observability/client-events");
    expect(reportBody).toMatchObject({
      event_type: "api_5xx",
      error_name: "ApiRequestError",
      message: "SERVICE_UNAVAILABLE",
    });
    expect(JSON.stringify(reportBody)).not.toContain("hidden");
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

describe("知识库资料 API", () => {
  it("以 FormData 上传资料并保持相对路径", async () => {
    const record = {
      id: "42",
      file_name: "岗位要求.md",
      file_format: "md",
      file_size: 1024,
      sha256: "abc123",
      created_at: "2026-08-08T08:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, record));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["# 岗位要求"], "岗位要求.md", { type: "text/markdown" });

    await expect(api.uploadDataset(file)).resolves.toEqual(record);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
  });

  it("列出当前用户的资料清单", async () => {
    const datasets = [
      {
        id: "1",
        file_name: "行业报告.pdf",
        file_format: "pdf",
        file_size: 2048,
        sha256: "def456",
        created_at: "2026-08-07T08:00:00Z",
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { datasets }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listDatasets()).resolves.toEqual({ datasets });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/datasets",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });
});

describe("API resume share", () => {
  it("按管理与公开接口的路径和方法发起分享请求", async () => {
    const share = {
      share_token: "token_abc",
      share_visibility: "public",
      share_expires_at: null,
      share_created_at: "2026-08-05T00:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { share }))
      .mockResolvedValueOnce(jsonResponse(200, { share: null }))
      .mockResolvedValueOnce(jsonResponse(200, { share: { ...share, share_visibility: "private" } }))
      .mockResolvedValueOnce(jsonResponse(200, { deleted: true }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: { schema_version: "1.0" },
          style: { schema_version: "1.0" },
          sharer: { nickname: "于晏", avatar_url: null },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await api.createShare("1");
    await api.getShareState("1");
    await api.updateShare("1", { visibility: "private" });
    await api.deleteShare("1");
    await api.fetchPublicShare("token_abc");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/resumes/1/share",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/resumes/1/share",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/resumes/1/share",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ visibility: "private" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/resumes/1/share",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/share/token_abc",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("微信扫码登录 API", () => {
  it("读取当前环境开放的普通用户登录方式", async () => {
    const body = { password_login_enabled: true };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(api.authCapabilities()).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/capabilities",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("开发环境邮箱密码登录提交凭据", async () => {
    const body = {
      user: { id: "1", email: "developer@example.test", nickname: "开发用户" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(api.login("developer@example.test", "password-123")).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "developer@example.test",
          password: "password-123",
        }),
      }),
    );
  });

  it("申请登录二维码时读取 scene 与 base64 图片", async () => {
    const body = { scene: "login:abcd1234", poll_token: "poll-token", qr_base64: "base64-qr" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, body)),
    );

    await expect(api.wechatQrcode()).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/wechat/qrcode",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("轮询状态时编码 scene 查询参数并返回当前状态", async () => {
    const status = { status: "success", user: { id: "9", email: null, nickname: "微信用户" } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, status)),
    );

    await expect(api.wechatStatus("login:a b", "poll/token")).resolves.toEqual(status);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/wechat/status?scene=login%3Aa%20b&poll_token=poll%2Ftoken",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("二维码请求受限时抛出可读错误码", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(429, { error: "WECHAT_RATE_LIMITED" })),
    );

    await expect(api.wechatQrcode()).rejects.toThrow(
      "WECHAT_RATE_LIMITED",
    );
  });
});
