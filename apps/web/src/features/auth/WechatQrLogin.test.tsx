import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, User } from "../../api/client";
import { WechatQrLogin, wechatErrorMessage } from "./WechatQrLogin";

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
});

describe("WechatQrLogin", () => {
  it("登录模式生成二维码并提示扫码后自动登录", async () => {
    const qrcode = vi
      .spyOn(api, "wechatQrcode")
      .mockResolvedValue({ scene: "login:abc123", qr_base64: "base64-qr" });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({ status: "pending", user: null });

    render(<WechatQrLogin mode="login" onSuccess={() => undefined} />);
    await act(async () => {});

    expect(qrcode).toHaveBeenCalledWith("login");
    expect(screen.getByAltText("微信扫码登录二维码")).toBeInTheDocument();
    expect(screen.getByText(/扫码确认后自动登录/)).toBeInTheDocument();
  });

  it("绑定模式生成二维码并提示完成绑定", async () => {
    vi.spyOn(api, "wechatQrcode").mockResolvedValue({
      scene: "bind:abc123",
      qr_base64: "base64-qr",
    });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({ status: "pending", user: null });

    render(<WechatQrLogin mode="bind" onSuccess={() => undefined} />);
    await act(async () => {});

    expect(screen.getByText(/扫码确认后完成绑定/)).toBeInTheDocument();
  });

  it("轮询命中成功状态后回调用户", async () => {
    vi.spyOn(api, "wechatQrcode").mockResolvedValue({
      scene: "login:abc123",
      qr_base64: "base64-qr",
    });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({
      status: "success",
      user: wechatUser,
    });
    const onSuccess = vi.fn();

    render(<WechatQrLogin mode="login" onSuccess={onSuccess} />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onSuccess).toHaveBeenCalledWith(wechatUser);
  });

  it("二维码过期后展示刷新入口，点击后重新请求", async () => {
    const qrcode = vi
      .spyOn(api, "wechatQrcode")
      .mockResolvedValue({ scene: "login:abc123", qr_base64: "base64-qr" });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({ status: "expired", user: null });

    render(<WechatQrLogin mode="login" onSuccess={() => undefined} />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("刷新二维码")).toBeInTheDocument();
    fireEvent.click(screen.getByText("刷新二维码"));
    await act(async () => {});

    expect(qrcode).toHaveBeenCalledTimes(2);
  });

  it("二维码生成失败时展示错误与重试入口", async () => {
    vi.spyOn(api, "wechatQrcode").mockRejectedValue(
      new ApiRequestError(429, "WECHAT_RATE_LIMITED"),
    );

    render(<WechatQrLogin mode="login" onSuccess={() => undefined} />);
    await act(async () => {});

    expect(screen.getByText("请求太频繁，请稍后再试。")).toBeInTheDocument();
    expect(screen.getByText("刷新二维码")).toBeInTheDocument();
  });
});

describe("wechatErrorMessage", () => {
  it("将后端错误码映射为可读文案", () => {
    expect(wechatErrorMessage(new ApiRequestError(429, "WECHAT_RATE_LIMITED"), "默认")).toBe("请求太频繁，请稍后再试。");
    expect(wechatErrorMessage(new ApiRequestError(502, "WECHAT_QRCODE_FAILED"), "默认")).toBe("微信二维码生成失败，请稍后重试。");
    expect(wechatErrorMessage(new ApiRequestError(401, "UNAUTHORIZED"), "默认")).toBe("登录状态已失效，请刷新页面后重试。");
    expect(wechatErrorMessage(new Error("boom"), "默认")).toBe("默认");
  });
});
