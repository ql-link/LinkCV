import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "./AdminApp";
import { AdminLoginPage } from "./AdminLoginPage";
import { api, ApiRequestError, type AdminStatsResponse } from "../../api/client";

const mockAdminUser = {
  id: "admin-1",
  email: "admin@linkcv.cn",
  nickname: "陈听澜",
  is_admin: true,
};

const mockRegularUser = {
  id: "user-1",
  email: "user@linkcv.cn",
  nickname: "张三",
  is_admin: false,
};

const emptyChatCapability = {
  capability: "chat" as const,
  activeModelId: null,
  activeModel: null,
  models: [],
};

const chatCatalog = {
  capability: "chat" as const,
  adapters: [
    {
      code: "deepseek" as const,
      label: "DeepSeek",
      requiresApiKey: true,
      models: ["deepseek-chat"],
    },
  ],
};

const emptyStats: AdminStatsResponse = {
  total_users: 0,
  active_users_7d: 0,
  total_resumes: 0,
  llm_calls_today: 0,
  estimated_cost_month: "$0.00",
};

function mockCommonApis() {
  vi.spyOn(api, "adminLogin").mockResolvedValue({ user: mockAdminUser });
  vi.spyOn(api, "getChatCapability").mockResolvedValue(emptyChatCapability);
  vi.spyOn(api, "getChatCatalog").mockResolvedValue(chatCatalog);
  vi.spyOn(api, "adminStats").mockResolvedValue(emptyStats);
  vi.spyOn(api, "adminLogSummary").mockResolvedValue({
    system: { total: 2, warnings: 1, errors: 0 },
    audit: { total: 1, succeeded: 1, failed: 0 },
  });
  vi.spyOn(api, "adminListSystemLogs").mockResolvedValue({
    items: [], nextCursor: null, partial: false, droppedMalformed: 0,
  });
  vi.spyOn(api, "adminListAuditLogs").mockResolvedValue({
    items: [], nextCursor: null, partial: false, droppedMalformed: 0,
  });
  vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "unpublished", release: null });
}

describe("AdminApp access control", () => {
  beforeEach(() => {
    mockCommonApis();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("shows the workspace for an admin user", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
    window.history.replaceState(null, "", "/admin");
    render(<AdminApp />);

    expect(
      await screen.findByRole("heading", { name: "早上好，陈听澜" }, { timeout: 4_000 }),
    ).toBeInTheDocument();
  });

  it("opens the system log center from its direct route", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
    window.history.replaceState(null, "", "/admin/logs/system");
    render(<AdminApp />);

    expect(await screen.findByRole("heading", { name: "日志中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "系统日志" })).toHaveClass("active");
    await waitFor(() => expect(api.adminListSystemLogs).toHaveBeenCalled());
  });

  it("opens a log detail dialog instead of showing the summary in the table", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
    vi.mocked(api.adminListSystemLogs).mockResolvedValue({
      items: [{
        timestampNs: "1786092502557798000",
        timestamp: "2026-08-07T08:48:22.557798Z",
        eventId: "event-system-1",
        eventVersion: 1,
        logType: "system",
        level: "INFO",
        service: "linkcv",
        environment: "development",
        source: "backend",
        logger: "linkcv.http",
        message: "http request completed",
        requestId: "request-system-1",
        taskId: null,
        operationId: null,
        actorUserId: "1",
        dependency: null,
        durationMs: 12,
        httpMethod: "GET",
        httpRoute: "/api/health",
        httpStatus: 200,
        errorCode: null,
        exceptionType: null,
        exceptionStack: null,
        action: null,
        actorType: null,
        targetType: null,
        targetId: null,
        result: null,
        summary: "健康检查完成",
      }],
      nextCursor: null,
      partial: false,
      droppedMalformed: 0,
    });
    window.history.replaceState(null, "", "/admin/logs/system");
    render(<AdminApp />);

    expect(await screen.findByRole("button", { name: "查看日志 event-system-1" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "摘要" })).not.toBeInTheDocument();
    expect(screen.queryByText("健康检查完成")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看日志 event-system-1" }));
    expect(screen.getByRole("dialog", { name: "日志详情" })).toBeInTheDocument();
    expect(screen.getByText("健康检查完成")).toBeInTheDocument();
    expect(screen.getByText("GET /api/health")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭日志详情" }));
    expect(screen.queryByRole("dialog", { name: "日志详情" })).not.toBeInTheDocument();
  });

  it("keeps the legacy LLM log route independent from Loki summary", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
    vi.spyOn(api, "listLlmCalls").mockResolvedValue({
      calls: [],
      summary: {
        callCount: 0,
        incompleteMeteringCount: 0,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
      },
      nextCursor: null,
    });
    window.history.replaceState(null, "", "/admin/logs");
    render(<AdminApp />);

    expect(await screen.findByRole("heading", { name: "日志中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LLM 调用" })).toHaveClass("active");
    expect(api.adminLogSummary).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listLlmCalls).toHaveBeenCalled());
  });

  it("shows an explicit retry state instead of an empty list when Loki fails", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
    vi.mocked(api.adminLogSummary).mockRejectedValue(
      new ApiRequestError(503, "LOG_QUERY_UNAVAILABLE"),
    );
    vi.mocked(api.adminListSystemLogs).mockRejectedValue(
      new ApiRequestError(503, "LOG_QUERY_UNAVAILABLE"),
    );
    window.history.replaceState(null, "", "/admin/logs/system");
    render(<AdminApp />);

    expect(await screen.findByText("日志查询暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("当前筛选下没有日志")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "重试" }).length).toBeGreaterThan(0);
  });

  it("opens the failed audit list from the summary card", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
    window.history.replaceState(null, "", "/admin/logs/system");
    render(<AdminApp />);

    const failed = await screen.findByRole("button", { name: /审计失败/ });
    fireEvent.click(failed);
    await waitFor(() => {
      expect(api.adminListAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ result: "failed" }),
      );
    });
  });

  it("opens the plugin publishing section from its route", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
    window.history.replaceState(null, "", "/admin/plugins");
    render(<AdminApp />);

    expect(await screen.findByRole("heading", { name: "插件发布" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "管理端导航" })).toHaveTextContent("插件发布");
  });

  it("redirects a regular user to the admin login page", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockRegularUser });
    window.history.replaceState(null, "", "/admin");
    render(<AdminApp />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin/login");
    });
  });

  it("redirects a guest to the admin login page", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new Error("UNAUTHORIZED"));
    window.history.replaceState(null, "", "/admin");
    render(<AdminApp />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin/login");
    });
  });
});

describe("AdminLoginPage", () => {
  beforeEach(() => {
    mockCommonApis();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("renders the login form for a guest", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new Error("UNAUTHORIZED"));
    window.history.replaceState(null, "", "/admin/login");
    render(<AdminLoginPage />);

    expect(
      await screen.findByRole("button", { name: "进入管理台" }, { timeout: 4_000 }),
    ).toBeInTheDocument();
  });

  it("redirects an already signed-in admin to the workspace", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
    window.history.replaceState(null, "", "/admin/login");
    render(<AdminLoginPage />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin");
    });
  });

  it("returns to the next target after a successful admin login", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new Error("UNAUTHORIZED"));
    window.history.replaceState(null, "", "/admin/login?next=/admin/users");
    render(<AdminLoginPage next="/admin/users" />);

    const demoButton = await screen.findByRole("button", { name: "填入演示账号" }, { timeout: 4_000 });
    fireEvent.click(demoButton);
    fireEvent.click(screen.getByRole("button", { name: "进入管理台" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin/users");
    });
  });

  it("falls back to the workspace when the next target is unsafe", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new Error("UNAUTHORIZED"));
    window.history.replaceState(null, "", "/admin/login?next=https://example.com");
    render(<AdminLoginPage next="https://example.com" />);

    const demoButton = await screen.findByRole("button", { name: "填入演示账号" }, { timeout: 4_000 });
    fireEvent.click(demoButton);
    fireEvent.click(screen.getByRole("button", { name: "进入管理台" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin");
    });
  });
});
