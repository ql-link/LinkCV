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
  wechat_status: "unbound",
  wechat_bound_at: null,
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

class FakeFileReader {
  onload: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL() {
    this.result = "data:image/png;base64,cHJldmlldw==";
    this.onload?.();
  }
}

function pickAvatarFile() {
  vi.stubGlobal("FileReader", FakeFileReader);
  const input = screen.getByLabelText("选择头像图片");
  fireEvent.change(input, {
    target: { files: [new File(["preview"], "avatar.png", { type: "image/png" })] },
  });
}

describe("AccountPage", () => {
  it("加载并展示资料、简历数量与最近简历", async () => {
    render(<AccountPage />);

    expect(await screen.findAllByText("user@example.test")).toHaveLength(2);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("产品经理简历")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "账号设置" })).toBeInTheDocument();
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
    await screen.findAllByText("user@example.test");

    fireEvent.change(screen.getByLabelText("昵称", { exact: false }), {
      target: { value: "新昵称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

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
    await screen.findAllByText("user@example.test");

    fireEvent.click(screen.getByRole("button", { name: "移除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(await screen.findByText("头像已删除。")).toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBeNull();
  });

  it("选择头像后先本地预览，保存成功才更新", async () => {
    const upload = vi
      .spyOn(api, "uploadAccountAvatar")
      .mockResolvedValue({ url: "/api/assets/new-avatar.png" });
    render(<AccountPage />);
    await screen.findAllByText("user@example.test");

    pickAvatarFile();

    expect(await screen.findByText("新头像已预览，尚未保存")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "保存新头像" });
    fireEvent.click(save);

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(await screen.findByText("头像已更新。")).toBeInTheDocument();
    expect(screen.queryByText("新头像已预览，尚未保存")).not.toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBe("/api/assets/new-avatar.png");
  });

  it("头像保存失败时恢复原头像并提示", async () => {
    vi.spyOn(api, "uploadAccountAvatar").mockRejectedValue(
      new ApiRequestError(500, "ASSET_UPLOAD_FAILED"),
    );
    render(<AccountPage />);
    await screen.findAllByText("user@example.test");

    pickAvatarFile();
    await screen.findByText("新头像已预览，尚未保存");
    fireEvent.click(screen.getByRole("button", { name: "保存新头像" }));

    expect(await screen.findByText(/服务暂时不可用/)).toBeInTheDocument();
    expect(screen.queryByText("新头像已预览，尚未保存")).not.toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBeNull();
  });

  it("未绑定微信时展示绑定入口，发起后显示小程序码并轮询感知成功", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const request = vi
        .spyOn(api, "requestWechatBind")
        .mockResolvedValue({ ticket: "ticket-1", qrcode_data: "cXJjb2Rl" });
      vi.spyOn(api, "getWechatBindStatus").mockResolvedValue({ status: "bound" });
      const getProfile = vi
        .spyOn(api, "getAccountProfile")
        .mockResolvedValueOnce({ ...profile, user: { ...user } })
        .mockResolvedValue({
          ...profile,
          user: {
            ...user,
            wechat_status: "bound",
            wechat_bound_at: "2026-08-13T00:00:00Z",
          },
        });

      render(<AccountPage />);
      await screen.findAllByText("user@example.test");

      fireEvent.click(screen.getByRole("button", { name: "绑定微信" }));
      await waitFor(() => expect(request).toHaveBeenCalledOnce());
      expect(screen.getByAltText("微信绑定二维码")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(getProfile).toHaveBeenCalledTimes(2);
      expect(await screen.findByText(/已绑定微信/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("已绑定微信时只展示状态，不提供解绑", async () => {
    vi.spyOn(api, "getAccountProfile").mockResolvedValue({
      ...profile,
      user: {
        ...user,
        wechat_status: "bound",
        wechat_bound_at: "2026-08-13T00:00:00Z",
      },
    });
    render(<AccountPage />);
    await screen.findAllByText("user@example.test");

    expect(screen.getByText(/已绑定微信/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "绑定微信" })).not.toBeInTheDocument();
  });

  it("微信服务不可用时展示不可用提示且无绑定入口", async () => {
    vi.spyOn(api, "getAccountProfile").mockResolvedValue({
      ...profile,
      user: { ...user, wechat_status: "unavailable" },
    });
    render(<AccountPage />);
    await screen.findAllByText("user@example.test");

    expect(screen.getByText(/微信绑定服务暂不可用/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "绑定微信" })).not.toBeInTheDocument();
  });

  it("退出登录后回到首页并清空登录态", async () => {
    const logout = vi.spyOn(useResumeStore.getState(), "logout").mockResolvedValue();
    render(<AccountPage />);
    await screen.findAllByText("user@example.test");

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
