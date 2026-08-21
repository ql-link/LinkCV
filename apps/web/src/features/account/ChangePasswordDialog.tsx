import { useState } from "react";
import { ApiRequestError } from "../../api/client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  TextField,
} from "@/components/ui";
import { useResumeStore } from "../../store/resumeStore";

const MIN_PASSWORD_LENGTH = 8;

export function isStrongPassword(password: string) {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}

export function passwordErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.message === "INVALID_CURRENT_PASSWORD") return "当前密码不正确。";
    if (error.message === "WEAK_PASSWORD")
      return `新密码至少需要 ${MIN_PASSWORD_LENGTH} 位，且同时包含字母和数字。`;
    if (error.message === "PASSWORD_MISMATCH")
      return "两次输入的新密码不一致。";
    if (error.message === "PASSWORD_UNCHANGED")
      return "新密码不能与当前密码相同。";
    if (error.status === 401) return "登录状态已失效，请重新登录。";
    if (error.status >= 500) return "服务暂时不可用，请稍后重试。";
  }
  return "密码修改失败，请稍后重试。";
}

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const changePassword = useResumeStore((state) => state.changePassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const validate = (): string | null => {
    if (!currentPassword) return "请输入当前密码。";
    if (!isStrongPassword(newPassword))
      return `新密码至少需要 ${MIN_PASSWORD_LENGTH} 位，且同时包含字母和数字。`;
    if (newPassword !== confirmPassword) return "两次输入的新密码不一致。";
    if (newPassword === currentPassword) return "新密码不能与当前密码相同。";
    return null;
  };

  const submit = async () => {
    setError(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
      setChanged(true);
      window.setTimeout(onClose, 1200);
    } catch (caught) {
      setError(passwordErrorMessage(caught));
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <AlertDialogContent className="account-password-dialog" aria-label="修改密码">
        <AlertDialogHeader>
          <AlertDialogTitle>修改密码</AlertDialogTitle>
          <AlertDialogDescription>
            修改成功后，所有设备上的登录状态都会立即失效，需要用新密码重新登录。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {changed ? (
          <p className="account-password-dialog-done" role="status">
            密码已修改，请使用新密码重新登录。
          </p>
        ) : (
          <>
            <div className="account-fields">
              <TextField
                label="当前密码"
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                placeholder="请输入当前密码"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <TextField
                label="新密码"
                type="password"
                value={newPassword}
                autoComplete="new-password"
                placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位，包含字母与数字`}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <TextField
                label="确认新密码"
                type="password"
                value={confirmPassword}
                autoComplete="new-password"
                placeholder="再次输入新密码"
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            {error && <p className="account-form-error">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
              <Button disabled={submitting} onClick={() => void submit()}>
                {submitting ? "提交中..." : "确认修改"}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
