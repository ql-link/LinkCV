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

import { setLocale, t } from "../../i18n";

const user: UserProfile = {
  id: "1",
  email: "user@example.test",
  nickname: "测试用户",
  is_admin: false,
  avatar_url: null,
  contact_email: "contact@example.test",
  registered_at: "2026-07-30T08:00:00Z",
  wechat_status: "unbound",
  wechat_bound_at: null,
};

const profile: AccountProfile = {
  user,
  resume_count: 3,
  current_session: { device_label: "macOS · Chrome" },
  capabilities: { auth_mode: "password", can_change_password: true, can_delete_account: true, deletion_confirmation_method: "password" },
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
  vi.spyOn(api, "getAccountPreferences").mockResolvedValue({ locale: "zh-CN", interview_reminder_enabled: false, notifications_available: false });
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
  setLocale("zh-CN");
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
  it("显示真实资料并移除模拟功能", async () => {
    render(<AccountPage />);
    expect(await screen.findByLabelText("个人资料摘要")).toBeInTheDocument();
    for (const title of ["账号与安全", "求职资料", "偏好", "退出与注销"]) expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    expect(screen.getByText("macOS · Chrome")).toBeInTheDocument();
    expect(screen.queryByText("邮箱已验证")).not.toBeInTheDocument();
    expect(screen.queryByText("需后端")).not.toBeInTheDocument();
    expect(screen.queryByText("面试提醒")).not.toBeInTheDocument();
    expect(screen.queryByText("仅保存偏好，暂不发送通知")).not.toBeInTheDocument();
    expect(screen.queryByText("微信")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "绑定" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "头像预览不可用" })).toBeDisabled();
  });

  it("正式版只有微信登录信息，没有登录邮箱和密码入口", async () => {
    vi.mocked(api.getAccountProfile).mockResolvedValue({ ...profile, capabilities: { auth_mode: "wechat", can_change_password: false, can_delete_account: true, deletion_confirmation_method: "wechat" } });
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    expect(screen.getAllByText("微信登录").length).toBeGreaterThan(0);
    expect(screen.queryByText("登录邮箱")).not.toBeInTheDocument();
    expect(screen.queryByText("登录密码")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解绑" })).not.toBeInTheDocument();
  });

  it("联系邮箱直接保存或清空，不改变登录邮箱", async () => {
    const save = vi.spyOn(api, "updateContactEmail").mockResolvedValue({ contact_email: "new@example.test" });
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    const row = screen.getByText("联系邮箱").closest(".acc-row")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "修改" }));
    const dialog = await screen.findByRole("dialog", { name: "联系邮箱" });
    expect(within(dialog).queryByLabelText("验证码")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("邮箱地址"), { target: { value: "new@example.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("new@example.test"));
    expect(await screen.findByText("new@example.test")).toBeInTheDocument();
    expect(useResumeStore.getState().user?.email).toBe("user@example.test");
  });

  it("修改密码调用真实接口，成功后清空会话", async () => {
    const save = vi.spyOn(api, "changePassword").mockResolvedValue({ ok: true });
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    fireEvent.click(within(screen.getByText("登录密码").closest(".acc-row")! as HTMLElement).getByRole("button", { name: "修改" }));
    const dialog = await screen.findByRole("dialog", { name: "修改密码" });
    fireEvent.change(within(dialog).getByLabelText("当前密码"), { target: { value: "Current123" } });
    fireEvent.change(within(dialog).getByLabelText("新密码"), { target: { value: "Changed123" } });
    fireEvent.change(within(dialog).getByLabelText("确认新密码"), { target: { value: "Changed123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认修改" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ current_password: "Current123", new_password: "Changed123", confirm_password: "Changed123" }));
    await waitFor(() => expect(useResumeStore.getState().user).toBeNull());
    expect(window.location.pathname).toBe("/login");
  });

  it("注销需要确认文字和身份，受理后显示进度并清空会话", async () => {
    const remove = vi.spyOn(api, "deleteAccount").mockResolvedValue({ job_id: "fictional-job", receipt_token: "fictional-receipt", status: "pending" });
    render(<AccountPage />);
    await screen.findByLabelText("个人资料摘要");
    fireEvent.click(screen.getByRole("button", { name: "注销账号" }));
    const dialog = await screen.findByRole("dialog", { name: "注销账号" });
    const submit = within(dialog).getByRole("button", { name: "永久注销" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("输入「注销账号」确认"), { target: { value: "注销账号" } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("当前密码"), { target: { value: "Current123" } });
    fireEvent.click(submit);
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ method: "password", confirmation: "注销账号", current_password: "Current123" }));
    await waitFor(() => expect(useResumeStore.getState().authStatus).toBe("guest"));
    expect(window.location.pathname).toBe("/account-deletion");
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


describe("账号语言与正式版注销确认", () => {
  it("语言只在服务端保存成功后切换，用户文本不变", async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.updateAccountPreferences>>) => void;
    const save = vi.spyOn(api, "updateAccountPreferences").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<AccountPage />);
    const language = await screen.findByLabelText("界面语言");
    await waitFor(() => expect(language).not.toBeDisabled());
    fireEvent.click(language);
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    expect(screen.getByRole("region", { name: "账号与安全" })).toBeInTheDocument();
    expect(language).toBeDisabled();
    expect(language).toHaveTextContent("简体中文");
    await act(async () => finish({ locale: "en-US", interview_reminder_enabled: false, notifications_available: false }));
    expect(await screen.findByRole("region", { name: "Account and security" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "测试用户" })).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith({ locale: "en-US" });
    expect(localStorage.getItem("linkresume.interface-locale")).toBe("en-US");
  });
  it("语言保存失败时保留原语言和选择值", async () => {
    vi.spyOn(api, "updateAccountPreferences").mockRejectedValue(new Error("offline"));
    render(<AccountPage />);
    const language = await screen.findByLabelText("界面语言");
    await waitFor(() => expect(language).not.toBeDisabled());
    fireEvent.click(language);
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    expect(await screen.findByText("偏好保存失败，请重试。")).toBeInTheDocument();
    expect(language).toHaveTextContent("简体中文");
    expect(screen.getByRole("region", { name: "账号与安全" })).toBeInTheDocument();
  });
  it("自绘语言菜单支持键盘打开和 Escape 取消，不保存未确认的选择", async () => {
    const save = vi.spyOn(api, "updateAccountPreferences");
    render(<AccountPage />);
    const language = await screen.findByRole("button", { name: "界面语言" });
    await waitFor(() => expect(language).not.toBeDisabled());
    language.focus();
    fireEvent.keyDown(language, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "简体中文" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(language, { key: "ArrowDown" });
    fireEvent.keyDown(language, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(language).toHaveAttribute("aria-expanded", "false");
    expect(language).toHaveFocus();
    expect(save).not.toHaveBeenCalled();
  });
  it("正式版获取新微信确认，刷新清除旧证明，关闭取消当前请求", async () => {
    vi.mocked(api.getAccountProfile).mockResolvedValue({ ...profile, capabilities: { auth_mode: "wechat", can_change_password: false, can_delete_account: true, deletion_confirmation_method: "wechat" } });
    const first = { scene: "del:first", poll_token: "fictional-poll-1", qrcode_data: "aW1hZ2U=", expires_at: new Date(Date.now() + 300000).toISOString() };
    const second = { ...first, scene: "del:second", poll_token: "fictional-poll-2" };
    vi.spyOn(api, "createAccountVerification").mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.spyOn(api, "accountVerificationStatus").mockResolvedValue({ status: "verified", action_token: "fictional-proof" });
    const cancel = vi.spyOn(api, "cancelAccountVerification").mockResolvedValue({ status: "cancelled" });
    const remove = vi.spyOn(api, "deleteAccount");
    render(<AccountPage />); await screen.findByLabelText("个人资料摘要");
    fireEvent.click(screen.getByRole("button", { name: "注销账号" }));
    const dialog = await screen.findByRole("dialog", { name: "注销账号" });
    expect(within(dialog).queryByLabelText("当前密码")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByPlaceholderText("注销账号"), { target: { value: "注销账号" } });
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "获取确认二维码" })); });
    const submit = within(dialog).getByRole("button", { name: "永久注销" });
    expect(submit).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(submit).not.toBeDisabled();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "刷新二维码" })); });
    expect(submit).toBeDisabled();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "取消" })); });
    expect(cancel).toHaveBeenCalledWith(second);
    expect(remove).not.toHaveBeenCalled();
  });
});
