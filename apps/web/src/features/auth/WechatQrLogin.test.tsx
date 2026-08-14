import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, User, WeChatQrcodeResponse } from "../../api/client";
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
  it("生成登录二维码并提示扫码后自动登录", async () => {
    const qrcode = vi
      .spyOn(api, "wechatQrcode")
      .mockResolvedValue({ scene: "login:abc123", poll_token: "poll-token", qr_base64: "base64-qr" });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({ status: "pending", user: null });

    render(<WechatQrLogin onSuccess={() => undefined} />);
    await act(async () => {});

    expect(qrcode).toHaveBeenCalledWith();
    expect(screen.getByAltText("微信扫码登录二维码")).toBeInTheDocument();
    expect(screen.getByText(/扫码确认后自动登录/)).toBeInTheDocument();
  });

  it("轮询命中成功状态后回调用户", async () => {
    vi.spyOn(api, "wechatQrcode").mockResolvedValue({
      scene: "login:abc123",
      poll_token: "poll-token",
      qr_base64: "base64-qr",
    });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({
      status: "success",
      user: wechatUser,
    });
    const onSuccess = vi.fn();

    render(<WechatQrLogin onSuccess={onSuccess} />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onSuccess).toHaveBeenCalledWith(wechatUser);
  });

  it("Strict Mode 下忽略已卸载初始化产生的旧二维码", async () => {
    let resolveQr!: (value: WeChatQrcodeResponse) => void;
    const qrcode = vi.spyOn(api, "wechatQrcode")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveQr = resolve; }));
    const status = vi.spyOn(api, "wechatStatus").mockResolvedValue({
      status: "pending",
      user: null,
    });

    render(
      <StrictMode>
        <WechatQrLogin onSuccess={() => undefined} />
      </StrictMode>,
    );
    await act(async () => {
      resolveQr({ scene: "login:current", poll_token: "poll-current", qr_base64: "current" });
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(qrcode).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith("login:current", "poll-current");
  });

  it("二维码过期后展示刷新入口，点击后重新请求", async () => {
    const qrcode = vi
      .spyOn(api, "wechatQrcode")
      .mockResolvedValue({ scene: "login:abc123", poll_token: "poll-token", qr_base64: "base64-qr" });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({ status: "expired", user: null });

    render(<WechatQrLogin onSuccess={() => undefined} />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("刷新二维码")).toBeInTheDocument();
    fireEvent.click(screen.getByText("刷新二维码"));
    await act(async () => {});

    expect(qrcode).toHaveBeenCalledTimes(2);
  });

  it("用户取消后停止等待并提供刷新入口", async () => {
    vi.spyOn(api, "wechatQrcode").mockResolvedValue({
      scene: "login:abc123",
      poll_token: "poll-token",
      qr_base64: "base64-qr",
    });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({ status: "cancelled", user: null });

    render(<WechatQrLogin onSuccess={() => undefined} />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("登录已取消")).toBeInTheDocument();
    expect(screen.getByText("刷新二维码")).toBeInTheDocument();
  });

  it("二维码生成失败时展示错误与重试入口", async () => {
    vi.spyOn(api, "wechatQrcode").mockRejectedValue(
      new ApiRequestError(429, "WECHAT_RATE_LIMITED"),
    );

    render(<WechatQrLogin onSuccess={() => undefined} />);
    await act(async () => {});

    expect(screen.getByText("请求太频繁，请稍后再试。")).toBeInTheDocument();
    expect(screen.getByText("刷新二维码")).toBeInTheDocument();
  });
});

describe("wechatErrorMessage", () => {
  it("将后端错误码映射为可读文案", () => {
    expect(wechatErrorMessage(new ApiRequestError(429, "WECHAT_RATE_LIMITED"), "默认")).toBe("请求太频繁，请稍后再试。");
    expect(wechatErrorMessage(new ApiRequestError(502, "WECHAT_QRCODE_FAILED"), "默认")).toBe("微信二维码生成失败，请稍后重试。");
    expect(wechatErrorMessage(new ApiRequestError(503, "WECHAT_SERVICE_UNAVAILABLE"), "默认")).toBe("微信登录服务暂不可用，请稍后重试。");
    expect(wechatErrorMessage(new ApiRequestError(401, "UNAUTHORIZED"), "默认")).toBe("登录状态已失效，请刷新页面后重试。");
    expect(wechatErrorMessage(new Error("boom"), "默认")).toBe("默认");
  });
});
