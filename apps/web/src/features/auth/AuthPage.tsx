import { FormEvent, lazy, Suspense, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, PageLoading, TextField } from "@/components/ui";
import { api, User } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { authPath, navigateTo } from "../../routing";
import { WechatQrLogin } from "./WechatQrLogin";
import "./auth.css";

const GrainGradient = lazy(() =>
  import("@paper-design/shaders-react").then((module) => ({
    default: module.GrainGradient,
  })),
);

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
    <main className="auth-entry min-h-screen bg-background p-3 text-foreground antialiased [font-synthesis:none]">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        <section className="flex items-center rounded-md border border-border bg-surface px-6 py-12 sm:px-10 lg:px-14 lg:py-20 xl:px-20">
          <div className="mx-auto w-full max-w-[520px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {showPasswordForm
                ? (isRegister ? "Development account" : "Development sign in")
                : "WeChat sign in"}
            </span>
            <h1 className="mt-3 text-3xl font-medium tracking-[-0.04em] sm:text-4xl lg:text-[42px] lg:leading-[1.05] xl:text-[48px]">
              {showPasswordForm
                ? (isRegister ? "注册 LinkCV" : "登录 LinkCV")
                : "微信扫码登录 LinkCV"}
            </h1>
            <p className="mt-3 text-base leading-snug text-text-secondary sm:text-lg">
              {showPasswordForm
                ? (isRegister
                  ? "创建仅用于本地或开发环境调试的邮箱账号。"
                  : "开发环境支持使用邮箱和密码进入工作台。")
                : "使用微信扫描小程序码，并在小程序中确认本次登录。"}
            </p>

            {passwordLoginEnabled === null && (
              <PageLoading className="mt-10" label="正在确认登录方式…" scope="panel" />
            )}

            {showPasswordForm && (
              <>
                <form className="mt-10 space-y-4" onSubmit={submit}>
                  <TextField
                    autoComplete="email"
                    inputClassName="h-12 text-base"
                    label="邮箱"
                    name="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                    spellCheck={false}
                    type="email"
                    value={email}
                  />
                  <TextField
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    inputClassName="h-12 text-base"
                    label="密码"
                    minLength={8}
                    name="password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="至少 8 位"
                    required
                    type="password"
                    value={password}
                  />
                  {error && (
                    <p className="rounded-md border border-destructive bg-[var(--ui-destructive-subtle)] px-4 py-2.5 text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                  <Button
                    className="mt-6 h-12 w-full text-base"
                    disabled={submitting}
                    type="submit"
                  >
                    {submitting
                      ? (isRegister ? "注册中…" : "登录中…")
                      : (isRegister ? "注册" : "登录")}
                  </Button>
                </form>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <a
                    className="inline-flex items-center gap-1.5 bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    href={authPath(isRegister ? "login" : "register", next)}
                  >
                    {isRegister ? "已有账号，去登录" : "没有账号，去注册"}
                    <ArrowRight aria-hidden size={14} />
                  </a>
                  <button
                    className="inline-flex items-center gap-1.5 bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowWechat(true)}
                    type="button"
                  >
                    使用微信扫码登录
                    <ArrowRight aria-hidden size={14} />
                  </button>
                </div>
              </>
            )}

            {showWechatLogin && (
              <div className="auth-wechat-login mt-10">
                <WechatQrLogin
                  appearance="auth"
                  onSuccess={(user) => void handleWechatSuccess(user)}
                />
                {passwordLoginEnabled && (
                  <button
                    className="mx-auto mt-6 block bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowWechat(false)}
                    type="button"
                  >
                    返回邮箱密码登录
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="auth-entry-visual relative min-h-[420px] overflow-hidden rounded-md bg-black text-white lg:min-h-0">
          <div className="auth-entry-shader absolute inset-0">
            <Suspense fallback={null}>
              <GrainGradient
                className="absolute inset-0 bg-black"
                colorBack="#00000000"
                colors={["#FFFFFF", "#155fd7", "#155fd7", "#FFFFFF"]}
                frame={2854.5}
                intensity={0.5}
                noise={0.25}
                offsetX={0}
                offsetY={0}
                rotation={0}
                scale={1}
                shape="corners"
                softness={0.5}
                speed={1}
              />
            </Suspense>
          </div>
          <div className="relative z-10 flex h-full w-full flex-col justify-between gap-10 p-8 sm:p-12 lg:p-14 xl:p-16">
            <h2 className="max-w-[560px] text-4xl font-medium leading-[0.98] tracking-[-0.05em] sm:text-5xl xl:text-[64px]">
              扫码确认，
              <br />
              安全进入工作台。
            </h2>
            <p className="max-w-[420px] text-base leading-relaxed text-white/70 xl:text-lg">
              {showPasswordForm
                ? (isRegister
                  ? "本地创建测试账号，正式环境仍只开放微信身份入口。"
                  : "开发环境可使用已有账号调试；微信扫码登录仍可随时验证。")
                : "普通账号由微信身份自动创建，无需填写注册或登录表单。"}
            </p>
          </div>
        </aside>
      </div>
    </main>
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
