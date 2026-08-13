import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { ChangePasswordPage, passwordErrorMessage } from "./ChangePasswordPage";

const NEW_PASSWORD_LABEL = "新密码至少 8 位，且同时包含字母和数字";

function fillForm(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("当前密码"), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText(NEW_PASSWORD_LABEL), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: confirm },
  });
}

function clickPageConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
}

function confirmDialogAndSubmit() {
  const dialog = screen.getByRole("dialog", { name: /确认修改密码/ });
  fireEvent.click(within(dialog).getByRole("button", { name: "确认修改" }));
}

beforeEach(() => {
  useResumeStore.setState({
    authStatus: "authenticated",
    user: {
      id: "1",
      email: "user@example.test",
      nickname: "测试用户",
      is_admin: false,
      avatar_url: null,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("ChangePasswordPage", () => {
  it("前端校验：空当前密码、强度不足、两次不一致、新旧相同", () => {
    render(<ChangePasswordPage />);

    clickPageConfirm();
    expect(screen.getByText("请输入当前密码。")).toBeInTheDocument();

    fillForm("old-password-1", "short", "short");
    clickPageConfirm();
    expect(
      screen.getByText("新密码至少需要 8 位，且同时包含字母和数字。"),
    ).toBeInTheDocument();

    fillForm("old-password-1", "onlyletters", "onlyletters");
    clickPageConfirm();
    expect(
      screen.getByText("新密码至少需要 8 位，且同时包含字母和数字。"),
    ).toBeInTheDocument();

    fillForm("old-password-1", "new-password-1", "new-password-2");
    clickPageConfirm();
    expect(screen.getByText("两次输入的新密码不一致。")).toBeInTheDocument();

    fillForm("old-password-1", "old-password-1", "old-password-1");
    clickPageConfirm();
    expect(screen.getByText("新密码不能与当前密码相同。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("校验通过后先弹确认框，确认后才提交", async () => {
    const change = vi
      .spyOn(api, "changePassword")
      .mockResolvedValue({ ok: true, message: "密码已修改，请重新登录" });
    render(<ChangePasswordPage />);

    fillForm("old-password-1", "new-password-1", "new-password-1");
    clickPageConfirm();

    expect(change).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /确认修改密码/ });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/所有设备上的登录状态都会立即失效/)).toBeInTheDocument();

    confirmDialogAndSubmit();
    await waitFor(() => expect(change).toHaveBeenCalledOnce());
    expect(await screen.findByText("密码已修改")).toBeInTheDocument();
    expect(useResumeStore.getState().authStatus).toBe("guest");
    expect(useResumeStore.getState().user).toBeNull();
  });

  it("取消确认框时不提交并保留页面", () => {
    const change = vi
      .spyOn(api, "changePassword")
      .mockResolvedValue({ ok: true, message: "密码已修改，请重新登录" });
    render(<ChangePasswordPage />);

    fillForm("old-password-1", "new-password-1", "new-password-1");
    clickPageConfirm();

    const dialog = screen.getByRole("dialog", { name: /确认修改密码/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(change).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("当前密码错误时展示后端错误文案且保留登录态", async () => {
    const change = vi
      .spyOn(api, "changePassword")
      .mockRejectedValue(new ApiRequestError(400, "INVALID_CURRENT_PASSWORD"));
    render(<ChangePasswordPage />);

    fillForm("wrong-password-1", "new-password-1", "new-password-1");
    clickPageConfirm();
    confirmDialogAndSubmit();

    expect(await screen.findByText("当前密码不正确。")).toBeInTheDocument();
    expect(change).toHaveBeenCalledOnce();
    expect(useResumeStore.getState().authStatus).toBe("authenticated");
  });

  it("后端错误码映射为可读文案", () => {
    expect(
      passwordErrorMessage(
        new ApiRequestError(400, "INVALID_CURRENT_PASSWORD"),
      ),
    ).toContain("当前密码");
    expect(
      passwordErrorMessage(new ApiRequestError(400, "WEAK_PASSWORD")),
    ).toContain("字母和数字");
    expect(
      passwordErrorMessage(new ApiRequestError(400, "PASSWORD_MISMATCH")),
    ).toContain("不一致");
  });
});
