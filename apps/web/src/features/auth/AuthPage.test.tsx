import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, User } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { AuthPage } from "./AuthPage";

const wechatUser: User = {
  id: "9",
  email: null,
  nickname: "微信用户",
  is_admin: false,
  avatar_url: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(api, "authCapabilities").mockResolvedValue({
    password_login_enabled: false,
  });
  vi.spyOn(api, "wechatQrcode").mockResolvedValue({
    scene: "login:abc123",
    poll_token: "poll-token",
    qr_base64: "base64-qr",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("AuthPage environment-aware login", () => {
  it("确认登录方式时使用统一的面板加载状态", () => {
    vi.mocked(api.authCapabilities).mockReturnValue(new Promise(() => {}));

    render(<AuthPage initialMode="login" />);

    expect(screen.getByRole("status", { name: "正在确认登录方式…" })).toHaveClass(
      "page-loading",
      "is-panel",
    );
  });

  it("生产环境的注册或登录入口都只展示微信二维码，不展示表单", async () => {
    vi.spyOn(api, "wechatStatus").mockResolvedValue({
      status: "pending",
      user: null,
    });

    const { rerender } = render(<AuthPage initialMode="login" />);
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "微信扫码登录 LinkCV" })).toBeInTheDocument();
    expect(screen.getByAltText("微信扫码登录二维码")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();

    rerender(<AuthPage initialMode="register" />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("开发环境展示邮箱密码登录，并允许切换到微信扫码", async () => {
    vi.mocked(api.authCapabilities).mockResolvedValue({
      password_login_enabled: true,
    });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({
      status: "pending",
      user: null,
    });
    const login = vi
      .spyOn(useResumeStore.getState(), "login")
      .mockResolvedValue();

    render(<AuthPage initialMode="login" />);
    await act(async () => {});

    expect(screen.getByRole("heading", { name: "登录 LinkCV" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.queryByAltText("微信扫码登录二维码")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), {
      target: { value: "developer@example.test" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "登录" }).closest("form")!);
    await act(async () => {});
    expect(login).toHaveBeenCalledWith("developer@example.test", "password-123");

    fireEvent.click(screen.getByRole("button", { name: /使用微信扫码登录/ }));
    await act(async () => {});
    expect(screen.getByAltText("微信扫码登录二维码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回邮箱密码登录" })).toBeInTheDocument();
  });

  it("开发环境的注册入口创建账号而不是提交登录", async () => {
    vi.mocked(api.authCapabilities).mockResolvedValue({
      password_login_enabled: true,
    });
    const login = vi
      .spyOn(useResumeStore.getState(), "login")
      .mockResolvedValue();
    const register = vi
      .spyOn(useResumeStore.getState(), "register")
      .mockResolvedValue();

    render(<AuthPage initialMode="register" />);
    await act(async () => {});

    expect(screen.getByRole("heading", { name: "注册 LinkCV" })).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), {
      target: { value: "new@example.test" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "注册" }).closest("form")!);
    await act(async () => {});

    expect(register).toHaveBeenCalledWith("new@example.test", "password-123");
    expect(login).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/resumes");
  });

  it("轮询成功后写入登录态并跳转简历主页", async () => {
    vi.spyOn(api, "wechatStatus").mockResolvedValue({
      status: "success",
      user: wechatUser,
    });
    const loginWithWechat = vi
      .spyOn(useResumeStore.getState(), "loginWithWechat")
      .mockResolvedValue();

    render(<AuthPage initialMode="login" />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(loginWithWechat).toHaveBeenCalledWith(wechatUser);
    expect(window.location.pathname).toBe("/resumes");
  });
});
