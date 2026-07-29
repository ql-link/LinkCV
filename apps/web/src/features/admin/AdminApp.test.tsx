import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "./AdminApp";
import { api } from "../../api/client";

const mockAdminUser = {
  id: "admin-1",
  email: "admin@linkcv.cn",
  nickname: "陈听澜",
  is_admin: true,
};

describe("AdminApp mock flow", () => {
  beforeEach(() => {
    vi.spyOn(api, "me").mockRejectedValue(new Error("UNAUTHORIZED"));
    vi.spyOn(api, "adminLogin").mockResolvedValue({ user: mockAdminUser });
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("signs in with the demo account and navigates through admin sections", async () => {
    window.history.replaceState(null, "", "/admin");
    render(<AdminApp />);

    const demoButton = await screen.findByRole("button", { name: "填入演示账号" }, { timeout: 4_000 });
    fireEvent.click(demoButton);
    fireEvent.click(screen.getByRole("button", { name: "进入管理台" }));
    expect(await screen.findByRole("heading", { name: "早上好，陈听澜" }, { timeout: 4_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "模型配置" }));
    expect(window.location.pathname).toBe("/admin/llm/models");
    expect(await screen.findByRole("heading", { name: "模型配置" }, { timeout: 4_000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新增模型" }));
    expect(screen.getByRole("heading", { name: "新增模型" })).toBeInTheDocument();
  });

  it("preserves a directly addressed admin section after mock login", async () => {
    window.history.replaceState(null, "", "/admin/users");
    render(<AdminApp />);

    const demoButton = await screen.findByRole("button", { name: "填入演示账号" }, { timeout: 4_000 });
    fireEvent.click(demoButton);
    fireEvent.click(screen.getByRole("button", { name: "进入管理台" }));
    expect(await screen.findByRole("heading", { name: "用户管理" }, { timeout: 4_000 })).toBeInTheDocument();
  });
});
