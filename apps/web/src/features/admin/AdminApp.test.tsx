import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApp, adminPageFromPath } from "./AdminApp";
import { AdminLoginPage } from "./AdminLoginPage";
import { api, ApiRequestError, type AdminInsightOverview, type LogItem } from "../../api/client";

const mockAdminUser = { id: "admin-1", email: "admin@example.test", nickname: "陈听澜", is_admin: true };
const mockRegularUser = { id: "user-1", email: "user@example.test", nickname: "张三", is_admin: false };

const overview: AdminInsightOverview = {
  metrics: { activeUsers7d: 3204, newUsers7d: 486, callsToday: 8492, cost7d: { costs: [{ currency: "USD", amount: "184.2" }], unmeteredCallCount: 0 } },
  deltas: { activeUsers7d: "0.124", newUsers7d: null, callsToday: "-0.05", cost7d: null },
  trend: [{ date: "2026-09-28", calls: 100, successRate: 0.99, p95Ms: 2100 }, { date: "2026-09-29", calls: 120, successRate: 1, p95Ms: 1800 }],
  alerts: [{ type: "llm_binding_invalid", severity: "critical", title: "对话能力 probe 失效", description: "1 条已启用的对话渠道验证已失效：主账号", target: "models/capabilities" }],
};

const emptyLogs = { items: [], nextCursor: null, partial: false, droppedMalformed: 0 };
const emptySummary = { callCount: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0, costs: [], unmeteredCallCount: 0 };

function mockCommonApis() {
  vi.spyOn(api, "adminInsightOverview").mockResolvedValue(overview);
  vi.spyOn(api, "adminAnnouncementStats").mockResolvedValue({ draft: 1, published: 2, unpublished: 0, active: 1, scheduled: 0 });
  vi.spyOn(api, "adminLogSummary").mockResolvedValue({ system: { total: 2, warnings: 1, errors: 0 }, audit: { total: 1, succeeded: 1, failed: 0 } });
  vi.spyOn(api, "adminLogHeatmap").mockResolvedValue({ buckets: [] });
  vi.spyOn(api, "adminListSystemLogs").mockResolvedValue(emptyLogs);
  vi.spyOn(api, "adminListAuditLogs").mockResolvedValue(emptyLogs);
  vi.spyOn(api, "getAdminPluginRelease").mockResolvedValue({ status: "absent", release: null });
  vi.spyOn(api, "adminInsightJobImports").mockResolvedValue({ imported7d: 0, imported30d: 0, users7d: 0, sources: [], daily: [] });
  vi.spyOn(api, "listLlmCalls").mockResolvedValue({ calls: [], nextCursor: null, summary: emptySummary });
  vi.spyOn(api, "listLlmRoutes").mockResolvedValue({ routes: [] });
  vi.spyOn(api, "listLlmModels").mockResolvedValue({ models: [] });
  vi.spyOn(api, "listLlmConnections").mockResolvedValue({ connections: [] });
  vi.spyOn(api, "adminLogin").mockResolvedValue({ user: mockAdminUser });
}

function openAt(path: string) {
  window.history.replaceState(null, "", path);
  vi.spyOn(api, "me").mockResolvedValue({ user: mockAdminUser });
  return render(<AdminApp />);
}

describe("adminPageFromPath", () => {
  it("maps V3 and legacy admin paths", () => {
    expect(adminPageFromPath("/admin")).toBe("overview");
    expect(adminPageFromPath("/admin/users")).toBe("users");
    expect(adminPageFromPath("/admin/llm/models")).toBe("models");
    expect(adminPageFromPath("/admin/llm")).toBe("models");
    expect(adminPageFromPath("/admin/logs")).toBe("llmCalls");
    expect(adminPageFromPath("/admin/logs/audit")).toBe("audit");
    expect(adminPageFromPath("/admin/agent-operations/op_1")).toBe("agentTrace");
    expect(adminPageFromPath("/admin/unknown")).toBe("overview");
  });
});

describe("AdminApp", () => {
  beforeEach(mockCommonApis);
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("uses the shared page loader while verifying the administrator session", () => {
    vi.spyOn(api, "me").mockReturnValue(new Promise(() => {}));
    render(<AdminApp />);
    expect(screen.getByRole("status", { name: "正在验证身份…" })).toHaveClass("page-loading", "is-page");
  });

  it("shows overview metrics and derived alerts for an admin", async () => {
    openAt("/admin");
    expect(await screen.findByRole("heading", { level: 1, name: /陈听澜/ })).toBeInTheDocument();
    expect(await screen.findByText("3,204")).toBeInTheDocument();
    expect(screen.getByText("+12.4%")).toBeInTheDocument();
    expect(screen.getByText("对话能力 probe 失效")).toBeInTheDocument();
    expect(screen.getByText("$184.20")).toBeInTheDocument();
  });

  it("navigates from an alert to its target page", async () => {
    vi.spyOn(api, "getLlmCatalog").mockResolvedValue({ useCases: ["assistant_conversation"], providers: [] });
    vi.spyOn(api, "listLlmBindings").mockResolvedValue({ bindings: [] });
    openAt("/admin");
    fireEvent.click(await screen.findByRole("button", { name: "去处理" }));
    expect(await screen.findByRole("heading", { level: 1, name: "能力配置" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin/llm/capabilities");
  });

  it("expands the active group in the sidebar", async () => {
    openAt("/admin/logs/system");
    expect(await screen.findByRole("heading", { level: 1, name: "系统日志" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "管理端导航" });
    expect(within(nav).getByRole("button", { name: "系统日志" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "业务审计" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "接入连接" })).not.toBeInTheDocument();
  });

  it("opens a system log in a modal from the table", async () => {
    const log: LogItem = {
      timestampNs: "1", timestamp: "2026-09-29T01:00:00Z", eventId: "evt_1", eventVersion: 1, logType: "system", level: "INFO",
      service: "linkresume", environment: "test", source: "backend", logger: "linkresume.http", message: "健康检查完成",
      requestId: "req_1", taskId: null, operationId: null, actorUserId: null, dependency: null, durationMs: 4, httpMethod: "GET",
      httpRoute: "/api/health", httpStatus: 200, errorCode: null, exceptionType: null, exceptionStack: null, action: null,
      actorType: null, targetType: null, targetId: null, result: null, summary: null,
    };
    vi.mocked(api.adminListSystemLogs).mockResolvedValue({ ...emptyLogs, items: [log] });
    openAt("/admin/logs/system");
    fireEvent.click(await screen.findByRole("row", { name: "查看日志 evt_1" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("GET /api/health")).toBeInTheDocument();
    expect(within(dialog).getByText("req_1")).toBeInTheDocument();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a retry state instead of an empty list when Loki fails", async () => {
    vi.mocked(api.adminListSystemLogs).mockRejectedValue(new ApiRequestError(503, "LOG_QUERY_UNAVAILABLE"));
    openAt("/admin/logs/system");
    expect(await screen.findByText("日志查询暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("当前筛选下没有日志")).not.toBeInTheDocument();
  });

  it("keeps the legacy LLM log route independent from Loki", async () => {
    openAt("/admin/logs");
    expect(await screen.findByRole("heading", { level: 1, name: "LLM 调用日志" })).toBeInTheDocument();
    await waitFor(() => expect(api.listLlmCalls).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 })));
    expect(api.adminLogSummary).not.toHaveBeenCalled();
  });

  it("filters audit records by failed result from the metric", async () => {
    openAt("/admin/logs/audit");
    fireEvent.click(await screen.findByRole("button", { name: /失败/ }));
    await waitFor(() => expect(api.adminListAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ result: "failed" })));
  });

  it("opens the plugin publishing page from its route", async () => {
    openAt("/admin/plugins");
    expect(await screen.findByRole("heading", { level: 1, name: "浏览器插件" })).toBeInTheDocument();
    expect(await screen.findByText("当前没有插件")).toBeInTheDocument();
  });

  it("redirects a regular user to the admin login page", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: mockRegularUser });
    window.history.replaceState(null, "", "/admin/users");
    render(<AdminApp />);
    await waitFor(() => expect(window.location.pathname).toBe("/admin/login"));
    expect(window.location.search).toBe("?next=%2Fadmin%2Fusers");
  });

  it("redirects a guest to the admin login page", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new ApiRequestError(401, "UNAUTHORIZED"));
    window.history.replaceState(null, "", "/admin");
    render(<AdminApp />);
    await waitFor(() => expect(window.location.pathname).toBe("/admin/login"));
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
