import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  vi.spyOn(api, "getUserProfile").mockResolvedValue({
    candidate_cities: ["北京"],
    salary_min: 20000,
    salary_max: 30000,
    salary_currency: "CNY",
    salary_period: "month",
    employment_types: ["full_time"],
    school: "清华大学",
    school_tier: ["project_985"],
    major: "计算机",
    education_level: "bachelor",
    candidate_status: "experienced",
    graduation_year: null,
    years_experience: 3,
    languages: ["英语 CET-6"],
    skills: ["React", "TypeScript"],
    certifications: [],
    honors: [],
    campus_experiences: [],
    lock_version: 1,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
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

function openEditDialog() {
  fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
  return screen.findByRole("dialog", { name: "编辑资料" });
}

function pickAvatarFile() {
  vi.stubGlobal("FileReader", FakeFileReader);
  const input = screen.getByLabelText("选择头像图片");
  fireEvent.change(input, {
    target: { files: [new File(["preview"], "avatar.png", { type: "image/png" })] },
  });
}

describe("AccountPage", () => {
  it("加载资料卡与四个设置区块，需后端项贴标签", async () => {
    render(<AccountPage />);

    expect(await screen.findByLabelText("个人资料摘要")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "账号" })).toBeInTheDocument();
    for (const title of ["账号与安全", "求职资料", "偏好", "退出与注销"]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/user@example.test · 注册于/)).toBeInTheDocument();
    expect(screen.getByText("邮箱已验证")).toBeInTheDocument();
    expect(screen.getAllByText("需后端").length).toBeGreaterThanOrEqual(6);
    expect(screen.getByRole("button", { name: "头像预览不可用" })).toBeDisabled();
    // 账号页不展示画像内容，只保留一行入口
    await waitFor(() => expect(api.getUserProfile).toHaveBeenCalledOnce());
    expect(await screen.findByText(/已填 \d+ \/ 14 项/)).toBeInTheDocument();
    expect(screen.queryByText("清华大学")).not.toBeInTheDocument();
  });

  it("只用微信登录时邮箱显示未绑定、密码不可修改", async () => {
    vi.spyOn(api, "getAccountProfile").mockResolvedValue({
      ...profile,
      user: { ...user, email: null, wechat_status: "bound", wechat_bound_at: "2026-09-01T00:00:00Z" },
    });
    render(<AccountPage />);

    expect(await screen.findByText("未绑定")).toBeInTheDocument();
    expect(screen.getByText("绑定邮箱后可以设置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^修改/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "解绑" })).toBeDisabled();
    expect(screen.queryByText("邮箱已验证")).not.toBeInTheDocument();
  });

  it("注销仅完成本地模拟，不删除资料或退出真实账号", async () => {
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");

    fireEvent.click(screen.getByRole("button", { name: "注销账号" }));
    const dialog = await screen.findByRole("dialog", { name: "注销账号" });
    const confirm = within(dialog).getByRole("button", { name: "永久注销" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "输入「注销账号」确认" }), { target: { value: "注销账号" } });
    fireEvent.click(confirm);
    expect(await screen.findByText("注销流程已完成（本地模拟）")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "注销账号" })).not.toBeInTheDocument();
    expect(useResumeStore.getState().user?.email).toBe(user.email);
    expect(useResumeStore.getState().authStatus).toBe("authenticated");

    fireEvent.click(screen.getAllByRole("button", { name: /^修改/ })[1]);
    const password = await screen.findByRole("dialog", { name: "修改密码" });
    expect(within(password).getByText("需要后端支持")).toBeInTheDocument();
  });

  it("提醒可以切换，修改邮箱只更新当前页面且要求本地验证码", async () => {
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    const toggle = screen.getByRole("switch", { name: "面试提醒" });
    const before = toggle.getAttribute("aria-checked");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).not.toBe(before);
    fireEvent.click(screen.getAllByRole("button", { name: /^修改/ })[0]);
    const email = await screen.findByRole("dialog", { name: "修改登录邮箱" });
    fireEvent.change(within(email).getByLabelText("新邮箱"), { target: { value: "local@example.test" } });
    expect(within(email).getByRole("button", { name: "确认修改" })).toBeDisabled();
    fireEvent.click(within(email).getByRole("button", { name: "发送验证码" }));
    expect(within(email).getByRole("button", { name: "60秒后重发" })).toBeDisabled();
    fireEvent.change(within(email).getByLabelText("验证码"), { target: { value: "482913" } });
    fireEvent.click(within(email).getByRole("button", { name: "确认修改" }));
    expect(await screen.findByText("邮箱已修改（本地模拟）")).toBeInTheDocument();
    expect(screen.getAllByText("local@example.test").length).toBeGreaterThan(0);
    expect(useResumeStore.getState().user?.email).toBe(user.email);
  });

  it("密码模拟遵守校验，成功后不登出账号", async () => {
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    fireEvent.click(screen.getAllByRole("button", { name: /^修改/ })[1]);
    const password = await screen.findByRole("dialog", { name: "修改密码" });
    const submit = within(password).getByRole("button", { name: "确认修改" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(password).getByLabelText("当前密码"), { target: { value: "Existing123" } });
    fireEvent.change(within(password).getByLabelText("新密码"), { target: { value: "Changed456" } });
    fireEvent.change(within(password).getByLabelText("确认新密码"), { target: { value: "Different456" } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(password).getByLabelText("确认新密码"), { target: { value: "Changed456" } });
    fireEvent.click(submit);
    expect(await screen.findByText("密码修改流程已完成（本地模拟）")).toBeInTheDocument();
    expect(useResumeStore.getState().authStatus).toBe("authenticated");
  });

  it("微信绑定分步模拟并可解绑，不修改真实账号状态", async () => {
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "绑定" }));
    expect(screen.getByText("本地模拟 · 等待扫码")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3500));
    expect(screen.getByText("本地模拟 · 等待确认绑定")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(screen.queryByRole("dialog", { name: "绑定微信" })).not.toBeInTheDocument();
    expect(useResumeStore.getState().user).toMatchObject({ wechat_status: "unbound" });
    fireEvent.click(screen.getByRole("button", { name: "解绑" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "解绑微信？" })).getByRole("button", { name: "解绑" }));
    expect(screen.getByText("微信已解绑（本地模拟）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "绑定" })).toBeInTheDocument();
  });

  it("修改昵称成功后同步本地资料与 store", async () => {
    const updated = { ...user, nickname: "新昵称" };
    const update = vi.spyOn(api, "updateAccountProfile").mockResolvedValue(updated);
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");

    const dialog = await openEditDialog();
    const input = within(dialog).getByRole("textbox", { name: "昵称" });
    expect(within(dialog).getByText("4 / 50")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "新昵称" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("新昵称"));
    expect(useResumeStore.getState().user?.nickname).toBe("新昵称");
    expect(screen.queryByRole("dialog", { name: "编辑资料" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新昵称" })).toBeInTheDocument();
  });

  it("昵称保存失败时保留弹窗并在页面显示行内提示", async () => {
    vi.spyOn(api, "updateAccountProfile").mockRejectedValue(new ApiRequestError(400, "BAD_REQUEST"));
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");

    const dialog = await openEditDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "昵称" }), { target: { value: "新昵称" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByText("昵称保存失败，请稍后重试。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    const inline = screen.getByRole("alert");
    expect(inline).toHaveTextContent("保存失败");
    expect(inline).toHaveTextContent("昵称保存失败，请稍后重试。");
    expect(useResumeStore.getState().user?.nickname).toBe("测试用户");
  });

  it("空昵称不提交", async () => {
    const update = vi.spyOn(api, "updateAccountProfile");
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");

    const dialog = await openEditDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "昵称" }), { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByText(/昵称不能为空/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("有头像时可以查看原图", async () => {
    vi.spyOn(api, "getAccountProfile").mockResolvedValue({ ...profile, user: { ...user, avatar_url: "/api/assets/avatar.png" } });
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");

    fireEvent.click(screen.getByRole("button", { name: "查看头像原图" }));
    const previewDialog = await screen.findByRole("dialog", { name: "查看头像原图" });
    expect(within(previewDialog).getByRole("img", { name: "头像原图" })).toHaveClass("acc-avatar-preview-image");
  });

  it("昵称非法时后端错误映射为可读文案", () => {
    const error = new ApiRequestError(400, "INVALID_NICKNAME");
    expect(accountErrorMessage(error, "默认文案")).toContain("不能为空");
  });

  it("选择头像后先调整，保存时才上传并更新", async () => {
    const upload = vi.spyOn(api, "uploadAccountAvatar").mockResolvedValue({ url: "/api/assets/new-avatar.png" });
    stubAvatarRendering();
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    const dialog = await openEditDialog();

    pickAvatarFile();

    expect(await within(dialog).findByLabelText("头像裁剪区域，可使用方向键移动")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledWith({ fileName: "avatar.png", dataUrl: "data:image/png;base64,cropped" });
    expect(await screen.findByText("头像已更新。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "编辑资料" })).not.toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBe("/api/assets/new-avatar.png");
  });

  it("头像上传失败时保留弹窗和裁剪状态", async () => {
    vi.spyOn(api, "uploadAccountAvatar").mockRejectedValue(new ApiRequestError(500, "ASSET_UPLOAD_FAILED"));
    stubAvatarRendering();
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    const dialog = await openEditDialog();

    pickAvatarFile();
    await within(dialog).findByLabelText("头像裁剪区域，可使用方向键移动");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByText(/服务暂时不可用/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "编辑资料" })).toBeInTheDocument();
    expect(screen.getByLabelText("头像裁剪区域，可使用方向键移动")).toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBeNull();
  });

  it("移除头像后保存调用删除接口", async () => {
    vi.spyOn(api, "getAccountProfile").mockResolvedValue({ ...profile, user: { ...user, avatar_url: "/api/assets/avatar.png" } });
    useResumeStore.setState({ user: { ...user, avatar_url: "/api/assets/avatar.png" } });
    const remove = vi.spyOn(api, "deleteAccountAvatar").mockResolvedValue({ ok: true });
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    const dialog = await openEditDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "移除头像" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(await screen.findByText("头像已删除。")).toBeInTheDocument();
    expect(useResumeStore.getState().user?.avatar_url).toBeNull();
  });

  it("图片解码失败时提示且不进入裁剪", async () => {
    class BrokenImage extends FakeImage {
      override set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BrokenImage);
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    await openEditDialog();

    pickAvatarFile();

    expect(await screen.findByText("头像图片无法读取，请选择其他图片。")).toBeInTheDocument();
    expect(screen.queryByLabelText("头像裁剪区域，可使用方向键移动")).not.toBeInTheDocument();
  });

  it("裁剪区支持方向键移动和 1x-3x 缩放", async () => {
    stubAvatarRendering();
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    const dialog = await openEditDialog();

    pickAvatarFile();
    const cropArea = await within(dialog).findByLabelText("头像裁剪区域，可使用方向键移动");
    fireEvent.keyDown(cropArea, { key: "ArrowRight", shiftKey: true });
    const cropImage = document.querySelector<HTMLImageElement>(".acc-crop-image");
    expect(cropImage).not.toBeNull();
    expect(cropImage).toHaveStyle({ transform: "translate(-50%, -50%) translate(16px, 0px)" });

    const zoom = screen.getByRole("slider", { name: /^缩放/ });
    fireEvent.change(zoom, { target: { value: "2" } });
    expect(zoom).toHaveValue("2");
  });

  it("确认退出后回到首页并清空登录态，取消不会退出", async () => {
    const logout = vi.spyOn(useResumeStore.getState(), "logout").mockResolvedValue();
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");

    const openLogout = screen.getByRole("button", { name: "退出" });
    fireEvent.click(openLogout);
    const dialog = await screen.findByRole("dialog", { name: "确认退出登录" });
    expect(within(dialog).getByText("退出后需要重新登录。")).toBeInTheDocument();
    expect(within(dialog).getByText("其他设备上的登录不受影响")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "确认退出登录" })).not.toBeInTheDocument();

    fireEvent.click(openLogout);
    await screen.findByRole("dialog", { name: "确认退出登录" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "确认退出登录" })).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(openLogout);
    const confirmDialog = await screen.findByRole("dialog", { name: "确认退出登录" });
    const confirm = within(confirmDialog).getByRole("button", { name: "退出登录" });
    expect(confirm).toHaveClass("v3-btn-dark");
    fireEvent.click(confirm);

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(window.location.pathname).toBe("/");
  });
});
