import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiRequestError,
  type AccountProfile,
  type UserProfile,
} from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { AccountPage, accountErrorMessage } from "./AccountPage";

const user: UserProfile = {
  id: "1",
  email: "user@example.test",
  nickname: "测试用户",
  is_admin: false,
  avatar_url: null,
};

const profile: AccountProfile = {
  user,
  resume_count: 3,
  recent_resumes: [
    { id: "11", title: "产品经理简历", updated_at: "2026-07-30T08:00:00Z" },
  ],
};

beforeEach(() => {
  useResumeStore.setState({
    authStatus: "authenticated",
    user: { ...user },
  });
  vi.spyOn(api, "getAccountProfile").mockResolvedValue({
    ...profile,
    user: { ...user },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("AccountPage", () => {
  it("加载并展示资料、简历数量与最近编辑", async () => {
    render(<AccountPage />);

    expect(
      await screen.findByDisplayValue("user@example.test"),
    ).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("产品经理简历")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /修改密码/ }),
    ).toBeInTheDocument();
  });

  it("修改昵称成功后同步本地资料与 store", async () => {
    const updated = { ...user, nickname: "新昵称" };
    const update = vi
      .spyOn(api, "updateAccountProfile")
      .mockResolvedValue(updated);
    render(<AccountPage />);
    await screen.findByDisplayValue("user@example.test");

    fireEvent.change(screen.getByLabelText("昵称", { exact: false }), {
      target: { value: "新昵称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存昵称" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("新昵称"));
    expect(await screen.findByText("昵称已更新。")).toBeInTheDocument();
    expect(useResumeStore.getState().user?.nickname).toBe("新昵称");
  });

  it("昵称非法时后端错误映射为可读文案", () => {
    const error = new ApiRequestError(400, "INVALID_NICKNAME");
    expect(accountErrorMessage(error, "默认文案")).toContain("不能为空");
  });

  it("删除头像后同步清除本地头像", async () => {
    const withAvatar = {
      ...profile,
      user: { ...user, avatar_url: "/api/assets/avatar.png" },
    };
    vi.spyOn(api, "getAccountProfile").mockResolvedValue(withAvatar);
    const remove = vi
      .spyOn(api, "deleteAccountAvatar")
      .mockResolvedValue({ ok: true });
    render(<AccountPage />);
    await screen.findByDisplayValue("user@example.test");

    fireEvent.click(screen.getByRole("button", { name: "删除头像" }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(await screen.findByText("头像已删除。")).toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBeNull();
  });

  it("退出登录后回到首页并清空登录态", async () => {
    const logout = vi.spyOn(useResumeStore.getState(), "logout").mockResolvedValue();
    render(<AccountPage />);
    await screen.findByDisplayValue("user@example.test");

    fireEvent.click(screen.getByRole("button", { name: /退出登录/ }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(window.location.pathname).toBe("/");
  });
});

describe("AccountPage WeChat binding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("打开绑定弹窗后展示二维码", async () => {
    const qrcode = vi
      .spyOn(api, "wechatQrcode")
      .mockResolvedValue({ scene: "bind:abc123", qr_base64: "base64-qr" });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({ status: "pending", user: null });

    render(<AccountPage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /微信绑定/ }));
    await act(async () => {});

    expect(qrcode).toHaveBeenCalledWith("bind");
    expect(screen.getByAltText("微信扫码登录二维码")).toBeInTheDocument();
  });

  it("绑定成功后显示已绑定状态与成功提示", async () => {
    const boundUser: UserProfile = {
      ...user,
      email: "user@example.test",
    };
    vi.spyOn(api, "wechatQrcode").mockResolvedValue({
      scene: "bind:abc123",
      qr_base64: "base64-qr",
    });
    vi.spyOn(api, "wechatStatus").mockResolvedValue({
      status: "success",
      user: boundUser,
    });

    render(<AccountPage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /微信绑定/ }));
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("微信绑定成功。")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /已绑定微信，可用微信扫码登录/ })).toBeInTheDocument();
  });
});
