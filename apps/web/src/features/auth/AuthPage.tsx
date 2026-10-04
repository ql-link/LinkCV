import { t, useLocale, setLocale, type Locale } from "@/i18n";
import { useContentMotion } from "../../components/ui/motion";
import { FormEvent, useEffect, useState } from "react";
import { PageLoading } from "@/components/ui";
import { api, User, type AuthCapabilities } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { authPath, navigateTo } from "../../routing";
import { V3Shell } from "../../v3/Shell";
import { Icon } from "../../v3/Icon";
import { WechatQrLogin } from "./WechatQrLogin";
import "./auth.css";

// 08 登录：整窗白色内容卡（不带侧栏），左上角品牌字，正文一列 360 宽水平居中。
// 登录入口由服务端能力决定，能力读取失败时显示可重试错误。
export function AuthPage(props: {
  initialMode?: "login" | "register";
  next?: string | null;
}) {
  const locale = useLocale();
  const next = props.next ?? null;
  const isRegister = props.initialMode === "register";
  const login = useResumeStore((state) => state.login);
  const register = useResumeStore((state) => state.register);
  const loginWithWechat = useResumeStore((state) => state.loginWithWechat);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);
  const [capabilitiesFailed, setCapabilitiesFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const contentRef = useContentMotion<HTMLElement>(`${props.initialMode}:${capabilities?.password_login_enabled}`);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    api.authCapabilities()
      .then((data) => { if (active) { setCapabilities(data); setCapabilitiesFailed(false); } })
      .catch(() => {
        if (active) setCapabilitiesFailed(true);
      });
    return () => {
      active = false;
    };
  }, [retry]);

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

  const showPasswordForm = capabilities?.password_login_enabled === true;
  const showWechatLogin = capabilities?.wechat_login_enabled === true && !showPasswordForm;

  return (
    <V3Shell active="none" bare contentClassName="auth-page">
      <select className="v3-input auth-language" aria-label={t("界面语言")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select>
      <div className="auth-brand" aria-label={t("LinkResume 求职工作台")}>
        <strong>LinkResume</strong>
        <span>{t("求职工作台")}</span>
      </div>

      <section ref={contentRef} className="auth-col">
        {capabilities === null && !capabilitiesFailed && (
          <PageLoading className="auth-loading" label={t("正在确认登录方式…")} scope="panel" />
        )}

        {(capabilitiesFailed || (capabilities && !showPasswordForm && !showWechatLogin)) && (
          <div role="alert"><p>{t("登录服务暂时不可用，请稍后重试。")}</p><button type="button" className="v3-btn" onClick={() => { setCapabilitiesFailed(false); setCapabilities(null); setRetry((value) => value + 1); }}>{t("重试")}</button></div>
        )}
        {showPasswordForm && (
          <>
            <span className="auth-dev-tag">{t("仅开发环境")}</span>
            <h1 className="auth-title">{isRegister ? t("注册 LinkResume。") : t("登录 LinkResume。")}</h1>
            <p className="auth-sub">
              {isRegister ? t("创建仅用于本地或开发环境调试的邮箱账号。") : t("开发环境支持使用邮箱和密码进入工作台。")}
            </p>
            <form className="auth-form" onSubmit={submit}>
              <label className="auth-field">
                <span className="v3-field-label">{t("邮箱")}</span>
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
                <span className="v3-field-label">{t("密码")}</span>
                <span className="auth-input">
                  <Icon name="lock" size={14} />
                  <input
                    className="v3-input is-filled"
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    placeholder={t("至少 8 位")}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </span>
              </label>
              {isRegister && <span className="auth-hint">{t("密码至少需要 8 位。")}</span>}
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="v3-btn v3-btn-dark auth-submit" type="submit" disabled={submitting}>
                {submitting ? (isRegister ? t("注册中…") : t("登录中…")) : (isRegister ? t("注册") : t("登录"))}
                {!submitting && <Icon name="arrow" size={12} />}
              </button>
            </form>
            <div className="auth-links">
              <a className="v3-link" href={authPath(isRegister ? "login" : "register", next)}>
                {isRegister ? t("已有账号，去登录") : t("没有账号，去注册")}
                <Icon name="arrow" size={12} />
              </a>

            </div>
          </>
        )}

        {showWechatLogin && (
          <>
            <p className="auth-eyebrow">{t("微信登录")}</p>
            <h1 className="auth-title">{t("微信扫码登录 LinkResume。")}</h1>
            <p className="auth-sub">{t("普通账号由微信身份自动创建，无需填写注册或登录表单。")}</p>
            <WechatQrLogin onSuccess={(user) => void handleWechatSuccess(user)} />
            <p className="auth-agree">{t("登录即表示同意《用户协议》与《隐私政策》")}</p>
          </>
        )}
      </section>

      <p className="auth-foot">{t("© 2026 LinkResume · 让每一份简历都被认真对待")}</p>
    </V3Shell>
  );
}

function normalizeAuthError(error: string) {
  if (error === "INVALID_CREDENTIALS") return t("邮箱或密码不正确。");
  if (error === "EMAIL_EXISTS") return t("该邮箱已经注册，请直接登录。");
  if (error === "INVALID_EMAIL") return t("请输入有效的邮箱地址。");
  if (error === "WEAK_PASSWORD") return t("密码至少需要 8 位。");
  if (error === "NOT_FOUND") return t("当前环境未开放邮箱密码登录或注册。");
  return t("操作失败，请稍后再试。");
}
