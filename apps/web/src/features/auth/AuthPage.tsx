import { FormEvent, useState } from "react";
import { ArrowRight, LogIn, UserPlus } from "lucide-react";
import { useResumeStore } from "../../store/resumeStore";
import { Brand, Button, TextInput } from "../../components/ds";
import { authPath, editorPath, navigateTo } from "../../routing";

export function AuthPage({ initialMode = "login", next = null }: { initialMode?: "login" | "register"; next?: string | null }) {
  const login = useResumeStore((state) => state.login);
  const register = useResumeStore((state) => state.register);
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "login") {
        await login(email, password);
        navigateTo(next ?? "/resumes", { replace: true });
      } else {
        await register(email, password);
        const resumeId = useResumeStore.getState().activeResumeId;
        navigateTo(resumeId ? editorPath(resumeId) : "/resumes", { replace: true });
      }
    } catch (submitError) {
      setError(normalizeAuthError((submitError as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <Brand />
          <div>
            <span className="eyebrow">WRITE WITH CLARITY</span>
            <h1>{mode === "login" ? "欢迎回来。" : "开始你的 LinkCV。"}</h1>
            <p>专注内容，实时预览，生成一份真正属于你的简历。</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <TextInput label="邮箱" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required />
          <TextInput label="密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
          {error && <div className="form-error">{error}</div>}
          <Button className="auth-submit" type="submit" disabled={submitting} icon={mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}>
            {submitting ? "处理中..." : mode === "login" ? "登录" : "注册并创建简历"}
          </Button>
        </form>
        <Button
          className="auth-switch"
          variant="text"
          icon={<ArrowRight size={15} />}
          onClick={() => {
            const nextMode = mode === "login" ? "register" : "login";
            setMode(nextMode);
            setError(null);
            navigateTo(authPath(nextMode, next), { replace: true });
          }}
        >
          {mode === "login" ? "没有账号？创建一个" : "已有账号？返回登录"}
        </Button>
      </section>
      <aside className="auth-story" aria-label="LinkCV 产品介绍">
        <div className="auth-story-copy">
          <span className="story-index">01 / FOCUS</span>
          <blockquote>“好的简历，不是堆砌经历，<br />而是让重要的事被看见。”</blockquote>
          <p>Markdown 写作、实时排版、A4 与智能一页导出，保持每一次修改都清晰可控。</p>
        </div>
        <div className="auth-paper-preview" aria-hidden="true">
          <span />
          <strong>张三</strong>
          <i />
          <i />
          <i />
        </div>
      </aside>
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
