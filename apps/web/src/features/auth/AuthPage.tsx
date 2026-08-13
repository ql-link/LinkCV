import { FormEvent, lazy, Suspense, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, TextField } from "@/components/ui";
import { useResumeStore } from "../../store/resumeStore";
import { authPath, editorPath, navigateTo } from "../../routing";
import { User } from "../../api/client";
import { WechatQrLogin } from "./WechatQrLogin";
import "./auth.css";

const GrainGradient = lazy(() =>
  import("@paper-design/shaders-react").then((module) => ({
    default: module.GrainGradient,
  })),
);

export function AuthPage({
  initialMode = "login",
  next = null,
}: {
  initialMode?: "login" | "register";
  next?: string | null;
}) {
  const login = useResumeStore((state) => state.login);
  const register = useResumeStore((state) => state.register);
  const loginWithWechat = useResumeStore((state) => state.loginWithWechat);
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [showWechat, setShowWechat] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === "login";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (isLogin) {
        await login(email, password);
        navigateTo(next ?? "/resumes", { replace: true });
      } else {
        await register(email, password);
        const resumeId = useResumeStore.getState().activeResumeId;
        navigateTo(resumeId ? editorPath(resumeId) : "/resumes", {
          replace: true,
        });
      }
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

  const switchMode = () => {
    const nextMode = isLogin ? "register" : "login";
    setMode(nextMode);
    setShowWechat(false);
    setError(null);
    navigateTo(authPath(nextMode, next), { replace: true });
  };

  return (
    <main className="auth-entry min-h-screen bg-background p-3 text-foreground antialiased [font-synthesis:none]">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        <section className="flex items-center rounded-md border border-border bg-surface px-6 py-12 sm:px-10 lg:px-14 lg:py-20 xl:px-20">
          <div className="mx-auto w-full max-w-[520px]">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {isLogin ? "Welcome back" : "Get started"}
              </span>
              <h1 className="mt-3 text-3xl font-medium tracking-[-0.04em] sm:text-4xl lg:text-[42px] lg:leading-[1.05] xl:text-[48px]">
                {isLogin ? "登录 LinkCV" : "创建账号"}
              </h1>
              <p className="mt-3 text-base leading-snug text-text-secondary sm:text-lg">
                {isLogin
                  ? "继续你的简历，接着上次的进度。"
                  : "从一份简历开始，管理版本、岗位与每一次成长。"}
              </p>
            </div>

            {isLogin && showWechat ? (
              <div className="mt-10 rounded-xl border border-border bg-surface-subtle p-6">
                <WechatQrLogin onSuccess={(user) => void handleWechatSuccess(user)} />
                <button
                  className="mx-auto mt-4 block bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowWechat(false)}
                  type="button"
                >
                  返回密码登录
                </button>
              </div>
            ) : (
              <>
                <form className="mt-10 space-y-4" onSubmit={submit}>
                  <TextField
                    autoComplete="email"
                    inputClassName="h-12 text-base"
                    label="邮箱"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                    type="email"
                    value={email}
                  />
                  <TextField
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    inputClassName="h-12 text-base"
                    label="密码"
                    minLength={8}
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
                      ? "处理中..."
                      : isLogin
                        ? "登录"
                        : "注册并创建简历"}
                  </Button>
                </form>

                {isLogin && (
                  <button
                    className="mt-5 inline-flex items-center gap-1.5 bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowWechat(true)}
                    type="button"
                  >
                    微信扫码登录
                    <ArrowRight aria-hidden size={14} />
                  </button>
                )}
              </>
            )}

            <button
              className="mt-6 inline-flex items-center gap-1.5 bg-transparent p-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
              onClick={switchMode}
              type="button"
            >
              {isLogin ? "没有账号？创建一个" : "已有账号？返回登录"}
              <ArrowRight aria-hidden size={14} />
            </button>
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
              把经历，
              <br />
              写成下一份机会。
            </h2>
            <p className="max-w-[420px] text-base leading-relaxed text-white/70 xl:text-lg">
              Markdown 写作、实时排版、A4 与智能一页导出，让每一次修改都清晰可控。
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function normalizeAuthError(error: string) {
  if (error === "INVALID_CREDENTIALS") return "邮箱或密码不正确。";
  if (error === "EMAIL_EXISTS") return "这个邮箱已经注册。";
  if (error === "WEAK_PASSWORD") return "密码至少需要 8 位。";
  if (error === "INVALID_EMAIL") return "请输入有效邮箱。";
  return "操作失败，请稍后再试。";
}
