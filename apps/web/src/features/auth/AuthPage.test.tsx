import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthPage } from "./AuthPage";

describe("AuthPage initial mode", () => {
  it("允许 Landing CTA 直接打开注册模式", () => {
    render(<AuthPage initialMode="register" />);

    expect(screen.getByRole("heading", { name: "开始你的 LinkCV。" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /注册并创建简历/ })).toBeInTheDocument();
  });

  it("登录模式继续保留原有登录表单", () => {
    render(<AuthPage initialMode="login" />);

    expect(screen.getByRole("heading", { name: "欢迎回来。" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /登录/ })).toBeInTheDocument();
  });
});
