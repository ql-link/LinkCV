import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { ChangePasswordPage, passwordErrorMessage } from "./ChangePasswordPage";

function fillForm(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("当前密码"), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText("新密码至少 8 位"), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: confirm },
  });
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
  it("前端校验：空当前密码、长度不足、两次不一致、新旧相同", () => {
    render(<ChangePasswordPage />);

    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    expect(screen.getByText("请输入当前密码。")).toBeInTheDocument();

    fillForm("old-password-1", "short", "short");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    expect(screen.getByText("新密码至少需要 8 位。")).toBeInTheDocument();

    fillForm("old-password-1", "new-password-1", "new-password-2");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    expect(screen.getByText("两次输入的新密码不一致。")).toBeInTheDocument();

    fillForm("old-password-1", "old-password-1", "old-password-1");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    expect(screen.getByText("新密码不能与当前密码相同。")).toBeInTheDocument();
  });

  it("修改成功后提示重新登录并清空本地登录态", async () => {
    const change = vi
      .spyOn(api, "changePassword")
      .mockResolvedValue({ ok: true, message: "密码已修改，请重新登录" });
    render(<ChangePasswordPage />);

    fillForm("old-password-1", "new-password-1", "new-password-1");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    await waitFor(() => expect(change).toHaveBeenCalledOnce());
    expect(await screen.findByText("密码已修改")).toBeInTheDocument();
    expect(useResumeStore.getState().authStatus).toBe("guest");
    expect(useResumeStore.getState().user).toBeNull();
  });

  it("当前密码错误时展示后端错误文案且保留登录态", async () => {
    const change = vi
      .spyOn(api, "changePassword")
      .mockRejectedValue(new ApiRequestError(400, "INVALID_CURRENT_PASSWORD"));
    render(<ChangePasswordPage />);

    fillForm("wrong-password-1", "new-password-1", "new-password-1");
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

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
    ).toContain("至少");
    expect(
      passwordErrorMessage(new ApiRequestError(400, "PASSWORD_MISMATCH")),
    ).toContain("不一致");
  });
});
