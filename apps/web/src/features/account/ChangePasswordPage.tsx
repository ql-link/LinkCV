import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { ApiRequestError } from "../../api/client";
import { Button, TextField } from "@/components/ui";
import { authPath, navigateTo } from "../../routing";
import { useResumeStore } from "../../store/resumeStore";

const MIN_PASSWORD_LENGTH = 8;

export function passwordErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.message === "INVALID_CURRENT_PASSWORD") return "当前密码不正确。";
    if (error.message === "WEAK_PASSWORD")
      return `新密码至少需要 ${MIN_PASSWORD_LENGTH} 位。`;
    if (error.message === "PASSWORD_MISMATCH")
      return "两次输入的新密码不一致。";
    if (error.message === "PASSWORD_UNCHANGED")
      return "新密码不能与当前密码相同。";
    if (error.status === 401) return "登录状态已失效，请重新登录。";
    if (error.status >= 500) return "服务暂时不可用，请稍后重试。";
  }
  return "密码修改失败，请稍后重试。";
}

export function ChangePasswordPage() {
  const changePassword = useResumeStore((state) => state.changePassword);
  const authStatus = useResumeStore((state) => state.authStatus);
  const changedRef = useRef(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (authStatus === "guest" && !changedRef.current) {
      navigateTo(authPath("login", "/account/password"), { replace: true });
    }
  }, [authStatus]);

  const submit = async () => {
    setError(null);
    if (!currentPassword) {
      setError("请输入当前密码。");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`新密码至少需要 ${MIN_PASSWORD_LENGTH} 位。`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    if (newPassword === currentPassword) {
      setError("新密码不能与当前密码相同。");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
      changedRef.current = true;
      setChanged(true);
      window.setTimeout(() => navigateTo("/login"), 800);
    } catch (caught) {
      setError(passwordErrorMessage(caught));
      setSubmitting(false);
    }
  };

  return (
    <main className="dashboard-content account-page">
      <header className="dashboard-header account-header">
        <button
          type="button"
          className="account-back"
          onClick={() => navigateTo("/account")}
          aria-label="返回个人资料"
        >
          <ChevronLeft size={16} />
        </button>
        <h1>修改密码</h1>
      </header>

      <div className="account-body">
        <section className="account-card account-password-card">
          {changed ? (
            <div className="account-password-done">
              <ShieldCheck size={32} aria-hidden="true" />
              <h2>密码已修改</h2>
              <p>所有登录会话已失效，请使用新密码重新登录。</p>
            </div>
          ) : (
            <>
              <h2>修改密码</h2>
              <p className="account-password-hint">
                修改成功后，所有设备上的登录状态都会立即失效。
              </p>
              <div className="account-fields">
                <TextField
                  label="当前密码"
                  type="password"
                  value={currentPassword}
                  autoComplete="current-password"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <TextField
                  label="新密码"
                  type="password"
                  value={newPassword}
                  autoComplete="new-password"
                  hint={`至少 ${MIN_PASSWORD_LENGTH} 位`}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <TextField
                  label="确认新密码"
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
              {error && <p className="account-form-error">{error}</p>}
              <div className="account-password-actions">
                <Button
                  variant="secondary"
                  onClick={() => navigateTo("/account")}
                >
                  取消
                </Button>
                <Button disabled={submitting} onClick={() => void submit()}>
                  {submitting ? "提交中..." : "确认修改"}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
