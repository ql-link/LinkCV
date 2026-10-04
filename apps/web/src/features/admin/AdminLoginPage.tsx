import { FormEvent, useEffect, useState } from "react";
import { Brand, PageLoading } from "@/components/ui";
import "./admin.css";

import {
  api,
  ApiRequestError,
} from "../../api/client";
import { isSafeAdminPath, navigateTo } from "../../routing";

/** Figma "V3 · 00 管理员登录" (530:2309): one centred 400px card on the console canvas, footnote below. */
export function AdminLoginPage({ next = null }: { next?: string | null }) {
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Same 1392-width zoom as the console so the card keeps the design's proportions on large screens.

  useEffect(() => {
    api
      .me()
      .then((res) => {
        // 已登录管理员访问登录页时直接回到后台，避免重复登录。
        if (res.user?.is_admin) {
          navigateTo("/admin", { replace: true });
        }
      })
      .catch(() => {
        // 未登录或会话失效：留在登录页。
      })
      .finally(() => setChecking(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email.includes("@") || password.length < 8) {
      setError("请输入有效的管理员邮箱和至少 8 位密码。");
      return;
    }
    setLoading(true);
    try {
      await api.adminLogin(email, password);
      const target = isSafeAdminPath(next) ? next : "/admin";
      navigateTo(target as string, { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.message === "INVALID_CREDENTIALS") {
          setError("账号或密码错误，或该账号不是管理员。");
        } else if (err.message === "FORBIDDEN") {
          setError("账号或密码错误，或该账号不是管理员。");
        } else {
          setError("登录失败，请稍后重试");
        }
      } else {
        setError("网络异常，请检查连接");
      }
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return <PageLoading label="正在验证身份…" scope="page" />;
  }

  return (
    <main className="adm-login">
      <div className="adm-login-stack">
        <section className="adm-login-card" aria-labelledby="adm-login-title">
          <a className="adm-login-brand" href="/" aria-label="返回 LinkResume">
            <Brand />
          </a>
          <h1 id="adm-login-title">管理员登录</h1>
          <form className="adm-login-form" onSubmit={submit}>
            <label>
              <span>邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
                autoComplete="username"
                required
              />
            </label>
            <label>
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
                autoComplete="current-password"
                minLength={8}
                required
              />
            </label>
            {error && <p className="adm-login-error" role="alert">{error}</p>}
            <button className="adm-login-submit" type="submit" disabled={loading}>
              {loading ? "登录中…" : "登录"}
            </button>
          </form>
        </section>
        <p className="adm-login-foot">仅限管理员账号 · 普通用户请前往 <a href="/">LinkResume 主站</a></p>
      </div>
    </main>
  );
}
