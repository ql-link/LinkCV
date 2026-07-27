import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminApp } from "./AdminApp";

describe("AdminApp mock flow", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("signs in with the demo account and navigates through admin sections", async () => {
    window.history.replaceState(null, "", "/admin");
    render(<AdminApp />);

    fireEvent.click(screen.getByRole("button", { name: "填入演示账号" }));
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

    fireEvent.click(screen.getByRole("button", { name: "填入演示账号" }));
    fireEvent.click(screen.getByRole("button", { name: "进入管理台" }));
    expect(await screen.findByRole("heading", { name: "用户管理" }, { timeout: 4_000 })).toBeInTheDocument();
  });
});
