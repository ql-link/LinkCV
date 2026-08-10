import { FormEvent, lazy, Suspense, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useResumeStore } from "../../store/resumeStore";
import { authPath, editorPath, navigateTo } from "../../routing";
import "../landing/landing.css";

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
  const [mode, setMode] = useState<"login" | "register">(initialMode);
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

  const switchMode = () => {
    const nextMode = isLogin ? "register" : "login";
    setMode(nextMode);
    setError(null);
    navigateTo(authPath(nextMode, next), { replace: true });
  };

  return (
    <main className="min-h-screen bg-white p-3 text-zinc-900 antialiased [font-synthesis:none] dark:bg-[#050505] dark:text-white">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        <section className="flex items-center rounded-md border border-black/10 bg-white px-6 py-12 dark:border-white/10 dark:bg-[#0a0a0a] sm:px-10 lg:px-14 lg:py-20 xl:px-20">
          <div className="mx-auto w-full max-w-[520px]">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                {isLogin ? "Welcome back" : "Get started"}
              </span>
              <h1 className="mt-3 text-3xl font-medium tracking-[-0.04em] sm:text-4xl lg:text-[42px] lg:leading-[1.05] xl:text-[48px]">
                {isLogin ? "登录 LinkCV" : "创建账号"}
              </h1>
              <p className="mt-3 text-base leading-snug text-zinc-600 dark:text-zinc-400 sm:text-lg">
                {isLogin
                  ? "继续你的简历，接着上次的进度。"
                  : "从一份简历开始，管理版本、岗位与每一次成长。"}
              </p>
            </div>

            <form className="mt-10 space-y-4" onSubmit={submit}>
              <AuthField
                autoComplete="email"
                label="邮箱"
                onChange={setEmail}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
              <AuthField
                autoComplete={isLogin ? "current-password" : "new-password"}
                label="密码"
                minLength={8}
                onChange={setPassword}
                placeholder="至少 8 位"
                type="password"
                value={password}
              />

              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}

              <button
                className="mt-6 flex h-12 w-full items-center justify-center rounded-[10px] border border-zinc-900 bg-zinc-900 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
                disabled={submitting}
                type="submit"
              >
                {submitting
                  ? "处理中..."
                  : isLogin
                    ? "登录"
                    : "注册并创建简历"}
              </button>
            </form>

            <button
              className="mt-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
              onClick={switchMode}
              type="button"
            >
              {isLogin ? "没有账号？创建一个" : "已有账号？返回登录"}
              <ArrowRight aria-hidden size={14} />
            </button>
          </div>
        </section>

        <aside className="relative min-h-[420px] overflow-hidden rounded-md bg-black text-white lg:min-h-0">
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

function AuthField({
  autoComplete,
  label,
  minLength,
  onChange,
  placeholder,
  type,
  value,
}: {
  autoComplete: string;
  label: string;
  minLength?: number;
  onChange: (value: string) => void;
  placeholder: string;
  type: "email" | "password";
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        autoComplete={autoComplete}
        className="flex h-12 w-full items-center rounded-[10px] border border-black/15 bg-white px-4 text-base text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-white/60"
        minLength={minLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        type={type}
        value={value}
      />
    </label>
  );
}

function normalizeAuthError(error: string) {
  if (error === "INVALID_CREDENTIALS") return "邮箱或密码不正确。";
  if (error === "EMAIL_EXISTS") return "这个邮箱已经注册。";
  if (error === "WEAK_PASSWORD") return "密码至少需要 8 位。";
  if (error === "INVALID_EMAIL") return "请输入有效邮箱。";
  return "操作失败，请稍后再试。";
}
