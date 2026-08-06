import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "./AdminApp";
import { AdminLoginPage } from "./AdminLoginPage";
import { api, type AdminStatsResponse } from "../../api/client";

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
