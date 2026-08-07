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
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

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

describe("AuthPage WeChat scan login", () => {
  it("登录模式提供微信扫码入口，切换后请求二维码", async () => {
    const qrcode = vi
      .spyOn(api, "wechatQrcode")
      .mockResolvedValue({ scene: "login:abc123", qr_base64: "base64-qr" });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({ status: "pending", user: null });

    render(<AuthPage initialMode="login" />);
    fireEvent.click(screen.getByRole("tab", { name: "微信扫码" }));

    await act(async () => {
      // 冲刷二维码请求的微任务。
    });

    expect(qrcode).toHaveBeenCalledWith("login");
    expect(screen.getByAltText("微信扫码登录二维码")).toBeInTheDocument();
  });

  it("轮询命中成功状态后写入登录态并跳转简历主页", async () => {
    vi.spyOn(api, "wechatQrcode").mockResolvedValue({
      scene: "login:abc123",
      qr_base64: "base64-qr",
    });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({
      status: "success",
      user: wechatUser,
    });
    const loginWithWechat = vi
      .spyOn(useResumeStore.getState(), "loginWithWechat")
      .mockResolvedValue();

    render(<AuthPage initialMode="login" />);
    fireEvent.click(screen.getByRole("tab", { name: "微信扫码" }));

    await act(async () => {
      // 冲刷二维码请求的微任务。
    });
    await act(async () => {
      // 推进轮询间隔（2 秒）触发第一次状态查询。
      vi.advanceTimersByTime(2000);
    });

    expect(loginWithWechat).toHaveBeenCalledWith(wechatUser);
    expect(window.location.pathname).toBe("/resumes");
  });
});
