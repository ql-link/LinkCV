import { act, render, screen } from "@testing-library/react";
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

describe("AuthPage WeChat-only login", () => {
  it("注册或登录入口都只展示微信二维码，不展示表单", async () => {
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
