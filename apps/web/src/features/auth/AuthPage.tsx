import { useContentMotion } from "../../components/ui/motion";
import { FormEvent, useEffect, useState } from "react";
import { PageLoading } from "@/components/ui";
import { api, User } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { authPath, navigateTo } from "../../routing";
import { V3Shell } from "../../v3/Shell";
import { Icon } from "../../v3/Icon";
import { WechatQrLogin } from "./WechatQrLogin";
import "./auth.css";

// 08 登录：整窗白色内容卡（不带侧栏），左上角品牌字，正文一列 360 宽水平居中。
// 正式环境 password_login_enabled=false 只有 08.3 微信扫码；开发环境显示 08.1 登录 / 08.2 注册，可切到扫码。
export function AuthPage(props: {
  initialMode?: "login" | "register";
  next?: string | null;
}) {
  const next = props.next ?? null;
  const isRegister = props.initialMode === "register";
  const login = useResumeStore((state) => state.login);
  const register = useResumeStore((state) => state.register);
  const loginWithWechat = useResumeStore((state) => state.loginWithWechat);
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState<boolean | null>(null);
  const [showWechat, setShowWechat] = useState(false);
  const contentRef = useContentMotion<HTMLElement>(`${props.initialMode}:${showWechat}:${passwordLoginEnabled}`);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    api.authCapabilities()
      .then(({ password_login_enabled }) => {
        if (active) setPasswordLoginEnabled(password_login_enabled);
      })
      .catch(() => {
        // 查询失败按正式环境处理：只给微信扫码
        if (active) setPasswordLoginEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isRegister) await register(email, password);
      else await login(email, password);
      navigateTo(next ?? "/resumes", { replace: true });
    } catch (submitError) {
      setError(normalizeAuthError((submitError as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleWechatSuccess = async (user: User) => {
    await loginWithWechat(user);
    navigateTo(next ?? "/resumes", { replace: true });
  };

  const showPasswordForm = passwordLoginEnabled === true && !showWechat;
  const showWechatLogin = passwordLoginEnabled === false || showWechat;

  return (
    <V3Shell active="none" bare contentClassName="auth-page">
      <div className="auth-brand" aria-label="LinkResume 求职工作台">
        <strong>LinkResume</strong>
        <span>求职工作台</span>
      </div>

      <section ref={contentRef} className="auth-col">
        {passwordLoginEnabled === null && (
          <PageLoading className="auth-loading" label="正在确认登录方式…" scope="panel" />
        )}

        {showPasswordForm && (
          <>
            <span className="auth-dev-tag">仅开发环境</span>
            <h1 className="auth-title">{isRegister ? "注册 LinkResume。" : "登录 LinkResume。"}</h1>
            <p className="auth-sub">
              {isRegister ? "创建仅用于本地或开发环境调试的邮箱账号。" : "开发环境支持使用邮箱和密码进入工作台。"}
            </p>
            <form className="auth-form" onSubmit={submit}>
              <label className="auth-field">
                <span className="v3-field-label">邮箱</span>
                <span className="auth-input">
                  <Icon name="mail" size={14} />
                  <input
                    className="v3-input is-filled"
                    autoComplete="email"
                    name="email"
                    type="email"
                    required
                    spellCheck={false}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </span>
              </label>
              <label className="auth-field">
                <span className="v3-field-label">密码</span>
                <span className="auth-input">
                  <Icon name="lock" size={14} />
                  <input
                    className="v3-input is-filled"
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    placeholder="至少 8 位"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </span>
              </label>
              {isRegister && <span className="auth-hint">密码至少需要 8 位。</span>}
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="v3-btn v3-btn-dark auth-submit" type="submit" disabled={submitting}>
                {submitting ? (isRegister ? "注册中…" : "登录中…") : (isRegister ? "注册" : "登录")}
                {!submitting && <Icon name="arrow" size={12} />}
              </button>
            </form>
            <div className="auth-links">
              <a className="v3-link" href={authPath(isRegister ? "login" : "register", next)}>
                {isRegister ? "已有账号，去登录" : "没有账号，去注册"}
                <Icon name="arrow" size={12} />
              </a>
              <button className="v3-link" type="button" onClick={() => setShowWechat(true)}>
                使用微信扫码登录
                <Icon name="arrow" size={12} />
              </button>
            </div>
          </>
        )}

        {showWechatLogin && (
          <>
            <p className="auth-eyebrow">微信登录</p>
            <h1 className="auth-title">微信扫码登录 LinkResume。</h1>
            <p className="auth-sub">普通账号由微信身份自动创建，无需填写注册或登录表单。</p>
            <WechatQrLogin onSuccess={(user) => void handleWechatSuccess(user)} />
            {passwordLoginEnabled ? (
              <button className="v3-link auth-back" type="button" onClick={() => setShowWechat(false)}>
                返回邮箱密码登录
              </button>
            ) : (
              <p className="auth-agree">登录即表示同意《用户协议》与《隐私政策》</p>
            )}
          </>
        )}
      </section>

      <p className="auth-foot">© 2026 LinkResume · 让每一份简历都被认真对待</p>
    </V3Shell>
  );
}

function normalizeAuthError(error: string) {
  if (error === "INVALID_CREDENTIALS") return "邮箱或密码不正确。";
  if (error === "EMAIL_EXISTS") return "该邮箱已经注册，请直接登录。";
  if (error === "INVALID_EMAIL") return "请输入有效的邮箱地址。";
  if (error === "WEAK_PASSWORD") return "密码至少需要 8 位。";
  if (error === "NOT_FOUND") return "当前环境未开放邮箱密码登录或注册。";
  return "操作失败，请稍后再试。";
}
