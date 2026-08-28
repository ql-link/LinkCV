import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiRequestError,
  type AccountProfile,
  type AgentSession,
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
  profile: null,
};

const sessions: AgentSession[] = [
  {
    id: "session-1",
    resume_id: null,
    title: "优化项目经历",
    status: "active",
    last_message_at: "2026-07-31T08:00:00Z",
    created_at: "2026-07-30T08:00:00Z",
    updated_at: "2026-07-31T08:00:00Z",
    messages: [],
  },
  {
    id: "session-2",
    resume_id: null,
    title: "准备面试回答",
    status: "archived",
    last_message_at: "2026-07-29T08:00:00Z",
    created_at: "2026-07-29T08:00:00Z",
    updated_at: "2026-07-29T08:00:00Z",
    messages: [],
  },
];

beforeEach(() => {
  useResumeStore.setState({
    authStatus: "authenticated",
    user: { ...user },
  });
  vi.spyOn(api, "getAccountProfile").mockResolvedValue({
    ...profile,
    user: { ...user },
  });
  vi.spyOn(api, "listAgentSessions").mockResolvedValue({ sessions });
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

class FakeImage {
  naturalWidth = 640;
  naturalHeight = 480;
  width = 640;
  height = 480;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = "";

  set src(value: string) {
    this.source = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this.source;
  }

  addEventListener() {}
  removeEventListener() {}
}

function stubAvatarRendering() {
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cropped");
}

function pickAvatarFile() {
  vi.stubGlobal("FileReader", FakeFileReader);
  const input = screen.getByLabelText("选择头像图片");
  fireEvent.change(input, {
    target: { files: [new File(["preview"], "avatar.png", { type: "image/png" })] },
  });
}

describe("AccountPage", () => {
  it("加载并展示资料、统计与最近内容", async () => {
    render(<AccountPage />);

    expect(await screen.findByRole("region", { name: "个人信息" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("产品经理简历")).toBeInTheDocument();
    expect(screen.getByText("优化项目经历")).toBeInTheDocument();
    expect(screen.queryByText("user@example.test")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修改头像" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "头像预览不可用" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存所有修改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "当前会话" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /修改密码/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /绑定微信/ })).not.toBeInTheDocument();
  });

  it("修改昵称成功后同步本地资料与 store", async () => {
    const updated = { ...user, nickname: "新昵称" };
    const update = vi
      .spyOn(api, "updateAccountProfile")
      .mockResolvedValue(updated);
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    fireEvent.click(screen.getByRole("button", { name: "修改昵称" }));
    const input = await screen.findByRole("textbox", { name: "昵称" });
    expect(input).toHaveFocus();
    fireEvent.change(input, {
      target: { value: "新昵称" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(update).toHaveBeenCalledWith("新昵称"));
    expect(useResumeStore.getState().user?.nickname).toBe("新昵称");
    expect(screen.queryByText("昵称已更新。")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "昵称" })).not.toBeInTheDocument();
  });

  it("编辑昵称时按 Escape 恢复已保存值", async () => {
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    fireEvent.click(screen.getByRole("button", { name: "修改昵称" }));
    const input = await screen.findByRole("textbox", { name: "昵称" });
    fireEvent.change(input, { target: { value: "未保存昵称" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "昵称" })).not.toBeInTheDocument();
    expect(screen.getAllByText("测试用户")).toHaveLength(2);
  });

  it("头像查看与头像修改入口彼此独立", async () => {
    const withAvatar = {
      ...profile,
      user: { ...user, avatar_url: "/api/assets/avatar.png" },
    };
    vi.spyOn(api, "getAccountProfile").mockResolvedValue(withAvatar);
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    fireEvent.click(screen.getByRole("button", { name: "查看头像原图" }));
    const previewDialog = await screen.findByRole("dialog", { name: "查看头像原图" });
    expect(previewDialog.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "头像原图" })).toHaveClass("account-avatar-preview-image");
    expect(inputClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "修改头像" }));
    expect(inputClick).toHaveBeenCalledOnce();
  });

  it("对话请求失败时统计显示破折号并保留不可用状态", async () => {
    vi.spyOn(api, "listAgentSessions").mockRejectedValue(new ApiRequestError(503, "SERVICE_UNAVAILABLE"));
    render(<AccountPage />);

    expect(await screen.findByText("最近对话暂不可用")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
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
    stubAvatarRendering();
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    pickAvatarFile();
    await screen.findByRole("dialog", { name: "调整头像" });
    fireEvent.click(screen.getByRole("button", { name: "删除当前头像" }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(await screen.findByText("头像已删除。")).toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBeNull();
  });

  it("选择头像后先调整，确认后才上传并更新", async () => {
    const upload = vi
      .spyOn(api, "uploadAccountAvatar")
      .mockResolvedValue({ url: "/api/assets/new-avatar.png" });
    stubAvatarRendering();
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    pickAvatarFile();

    expect(await screen.findByRole("dialog", { name: "调整头像" })).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledWith({
      fileName: "avatar.png",
      dataUrl: "data:image/png;base64,cropped",
    });
    expect(await screen.findByText("头像已更新。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "调整头像" })).not.toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBe("/api/assets/new-avatar.png");
  });

  it("头像上传失败时保留调整窗口和裁剪状态", async () => {
    vi.spyOn(api, "uploadAccountAvatar").mockRejectedValue(
      new ApiRequestError(500, "ASSET_UPLOAD_FAILED"),
    );
    stubAvatarRendering();
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    pickAvatarFile();
    await screen.findByRole("dialog", { name: "调整头像" });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    expect(await screen.findByText(/服务暂时不可用/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "调整头像" })).toBeInTheDocument();
    expect(screen.getByLabelText("头像裁剪区域，可使用方向键移动")).toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBeNull();
  });

  it("图片解码失败时提示且不打开调整窗口", async () => {
    class BrokenImage extends FakeImage {
      override set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BrokenImage);
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    pickAvatarFile();

    expect(await screen.findByText("头像图片无法读取，请选择其他图片。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "调整头像" })).not.toBeInTheDocument();
  });

  it("裁剪区支持方向键移动和 1x-3x 缩放", async () => {
    stubAvatarRendering();
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    pickAvatarFile();
    await screen.findByRole("dialog", { name: "调整头像" });
    const cropArea = screen.getByLabelText("头像裁剪区域，可使用方向键移动");
    fireEvent.keyDown(cropArea, { key: "ArrowRight", shiftKey: true });
    const cropImage = document.querySelector<HTMLImageElement>(".account-avatar-crop-image");
    expect(cropImage).not.toBeNull();
    expect(cropImage).toHaveStyle({
      transform: "translate(-50%, -50%) translate(16px, 0px)",
    });

    const zoom = screen.getByRole("slider", { name: /^缩放/ });
    fireEvent.change(zoom, { target: { value: "2" } });
    expect(zoom).toHaveValue("2");
  });

  it("确认退出后回到首页并清空登录态，取消不会退出", async () => {
    const logout = vi.spyOn(useResumeStore.getState(), "logout").mockResolvedValue();
    render(<AccountPage />);
    await screen.findAllByText("测试用户");

    const openLogout = screen.getByRole("button", { name: "退出登录" });
    fireEvent.click(openLogout);
    const dialog = await screen.findByRole("dialog", { name: "确认退出登录" });
    expect(screen.getByText("退出后需要重新登录。")).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "确认退出登录" })).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(openLogout);
    await screen.findByRole("dialog", { name: "确认退出登录" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "确认退出登录" })).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(openLogout);
    const confirmDialog = await screen.findByRole("dialog", { name: "确认退出登录" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(window.location.pathname).toBe("/");
  });
});
