import { FormEvent, useState } from "react";
import { FileText, LogIn, UserPlus } from "lucide-react";
import { useResumeStore } from "../../store/resumeStore";

export function AuthPage() {
  const login = useResumeStore((state) => state.login);
  const register = useResumeStore((state) => state.register);
  const [mode, setMode] = useState<"login" | "register">("login");
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
      } else {
        await register(email, password);
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
          <FileText size={28} />
          <div>
            <h1>简历工作台</h1>
            <p>登录后创建和管理多份 Markdown 简历。</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              minLength={8}
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}
            {submitting ? "处理中..." : mode === "login" ? "登录" : "注册并创建简历"}
          </button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "没有账号？创建一个" : "已有账号？返回登录"}
        </button>
      </section>
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
