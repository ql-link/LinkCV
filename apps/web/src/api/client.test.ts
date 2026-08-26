import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "./client";
import { defaultSemanticDocument, defaultSemanticStyle } from "./resumeContract";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: vi.fn(async () => index < chunks.length
          ? { done: false, value: encoder.encode(chunks[index++]) }
          : { done: true, value: undefined }),
      }),
    },
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

describe("resume template API", () => {
  it("兼容旧数据库响应时也不会向产品暴露已退役空白模板", async () => {
    const retained = { id: "5", key: "classic-technical-cn", name: "经典单页技术简历" };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, {
      templates: [
        { id: "1", key: "blank-cn", name: "空白简历" },
        retained,
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listResumeTemplates()).resolves.toEqual({ templates: [retained] });
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

describe("Agent SSE client", () => {
  it("正常 EOF 前没有终态事件时按协议失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse([
          'event: assistant.delta\ndata: {"delta":"半条回复"}\n\n',
        ]),
      ),
    );

    await expect(
      api.streamAgentMessage(
        "session-1",
        { content: "优化简历", idempotency_key: "retry_key_1" },
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      status: 502,
      message: "AGENT_STREAM_INCOMPLETE",
    });
  });

  it("收到终态事件后正常完成", async () => {
    const onEvent = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse([
          'event: run.completed\ndata: {"runId":"run-1"}\n\n',
        ]),
      ),
    );

    await expect(
      api.streamAgentMessage(
        "session-1",
        { content: "优化简历", idempotency_key: "retry_key_2" },
        new AbortController().signal,
        onEvent,
      ),
    ).resolves.toBeUndefined();
    expect(onEvent).toHaveBeenCalledWith({ type: "run.completed", runId: "run-1" });
  });
});

describe("Agent session list API", () => {
  it("支持按简历筛选，也支持读取当前用户最近会话", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { sessions: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.listAgentSessions("resume/42");
    await api.listAgentSessions();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/agent/sessions?resume_id=resume%2F42",
      "/api/agent/sessions",
    ]);
  });
});

describe("resume import polling API", () => {
  it("按任务 ID 查询单个导入状态并编码路径参数", async () => {
    const body = { import: { id: "41", parse_status: "processing" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(api.getResumeImport("41/other")).resolves.toEqual(body);

    expect(fetch).toHaveBeenCalledWith(
      "/api/resume-imports/41%2Fother",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });
});

describe("resume version detail API", () => {
  it("按简历和版本号读取完整版本快照", async () => {
    const body = { version: { id: "9", version_no: 3, name: "投递版", data: {}, style: {} } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    await expect(api.getResumeVersion("42", 3)).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      "/api/resumes/42/versions/3",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });
});

describe("resume PDF download API", () => {
  it("按当前锁版本请求 PDF，传递取消信号并读取 UTF-8 文件名", async () => {
    const signal = new AbortController().signal;
    const blob = new Blob(["%PDF-test"], { type: "application/pdf" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "Content-Disposition": "attachment; filename*=UTF-8''%E5%BC%A0%E4%B8%89-%E7%AE%80%E5%8E%86.pdf",
      }),
      blob: vi.fn().mockResolvedValue(blob),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.downloadResumePdf("resume/42", 7, signal)).resolves.toEqual({
      blob,
      filename: "张三-简历.pdf",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/resumes/resume%2F42/pdf?lock_version=7",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        signal,
        headers: expect.objectContaining({ "X-Request-ID": expect.any(String) }),
      }),
    );
  });

  it("保留服务端 PDF 错误码和请求追踪 ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers({ "X-Request-ID": "request-pdf-1" }),
      json: vi.fn().mockResolvedValue({ error: "RESUME_PDF_SNAPSHOT_STALE" }),
    }));

    await expect(api.downloadResumePdf("42", 3)).rejects.toMatchObject({
      status: 409,
      message: "RESUME_PDF_SNAPSHOT_STALE",
      requestId: "request-pdf-1",
    });
  });
});

describe("JD API client", () => {
  it("编码列表搜索和游标，并保持相对 API 路径", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], next_cursor: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.listJobDescriptions({
      keyword: "Java 后端",
      cursor: "cursor/value",
      limit: 30,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/job-descriptions?keyword=Java+%E5%90%8E%E7%AB%AF&cursor=cursor%2Fvalue&limit=30",
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

  it("使用 multipart 分别提交文字和图片草稿解析请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        draft: {},
        warnings: [],
        inputType: "text",
        callId: "llmcall_fictional",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    await api.parseJobDescriptionDraft({
      text: "虚构的产品经理岗位",
      signal: controller.signal,
    });
    const image = new File([new Uint8Array([1, 2, 3])], "job.png", {
      type: "image/png",
    });
    await api.parseJobDescriptionDraft({ image });

    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({ method: "POST", credentials: "include" }),
      );
      expect(options.headers).not.toHaveProperty("Content-Type");
      expect(options.body).toBeInstanceOf(FormData);
    }
    expect(fetchMock.mock.calls[0][0]).toBe("/api/job-descriptions/parse-draft");
    expect((fetchMock.mock.calls[0][1].body as FormData).get("text")).toBe(
      "虚构的产品经理岗位",
    );
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    expect((fetchMock.mock.calls[1][1].body as FormData).get("image")).toBe(image);
  });
});

describe("面试中心 API client", () => {
  it("编码求职进程与面试记录的游标和历史范围", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], next_cursor: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.listJobApplications({
      scope: "all",
      keyword: "后端 面试",
      stage_type: "interview",
      cursor: "application/cursor",
      limit: 40,
    });
    await api.listInterviewSessions({
      include_archived: true,
      status: "completed",
      cursor: "session/cursor",
      limit: 80,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/job-applications?scope=all&keyword=%E5%90%8E%E7%AB%AF+%E9%9D%A2%E8%AF%95&stage_type=interview&cursor=application%2Fcursor&limit=40",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/interview-sessions?status=completed&include_archived=true&cursor=session%2Fcursor&limit=80",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("调用取消、归档、恢复和永久清理接口时保留版本契约", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { deleted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.cancelInterviewSession("31", {
      reason: "时间变化",
      base_lock_version: 2,
    });
    await api.archiveJobApplication("21", 3);
    await api.restoreJobApplication("21", 4);
    await api.deleteInterviewSession("31");
    await api.deleteJobApplication("21");

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/interview-sessions/31/cancel",
      "/api/job-applications/21/archive",
      "/api/job-applications/21/restore",
      "/api/interview-sessions/31",
      "/api/job-applications/21",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      reason: "时间变化",
      base_lock_version: 2,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      base_lock_version: 3,
    });
    expect(fetchMock.mock.calls[3][1]).toEqual(
      expect.objectContaining({ method: "DELETE" }),
    );
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

  it("支持资料重命名、解析重试和删除契约", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "42", file_name: "新名称.md" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "42", file_name: "新名称.md", parse_status: "processing" }))
      .mockResolvedValueOnce(jsonResponse(200, { deleted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.renameDataset("42", "新名称");
    await api.retryDataset("42");
    await api.deleteDataset("42");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/datasets/42");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "新名称" }) }));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/datasets/42/retry");
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/datasets/42");
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ method: "DELETE" }));
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
          data: defaultSemanticDocument,
          style: defaultSemanticStyle,
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

  it("开发环境邮箱密码注册提交凭据", async () => {
    const body = {
      user: { id: "2", email: "new@example.test", nickname: "开发用户" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, body)));

    await expect(api.register("new@example.test", "password-123")).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/register",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "new@example.test",
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
