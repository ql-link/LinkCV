import { FormEvent, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  Bot,
  CircleAlert,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { Brand, PageLoading } from "@/components/ui";
import "./admin.css";

import {
  api,
  ApiRequestError,
} from "../../api/client";
import { isSafeAdminPath, navigateTo } from "../../routing";

export function AdminLoginPage({ next = null }: { next?: string | null }) {
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
          setError("邮箱或密码错误");
        } else if (err.message === "FORBIDDEN") {
          setError("该账号不是管理员");
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

  const fillDemo = () => {
    setEmail("admin@linkcv.demo");
    setPassword("linkcv-demo");
    setError("");
  };

  if (checking) {
    return <PageLoading label="正在验证身份…" scope="page" />;
  }

  return (
    <main className="admin-login-shell">
      <motion.div
        className="admin-login-frame"
        initial={{ opacity: 0, scale: 0.975 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 310, damping: 34, mass: 0.9 }}
      >
        <section className="admin-login-context" aria-label="管理台范围">
          <a className="admin-wordmark" href="/" aria-label="返回 LinkCV">
            <Brand />
          </a>
          <motion.div
            className="login-context-copy"
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", stiffness: 310, damping: 34, mass: 0.9 }}
          >
            <span className="login-access-label">
              <ShieldCheck size={14} /> INTERNAL ACCESS
            </span>
            <h1>
              欢迎回到
              <br />
              LinkCV 管理台
            </h1>
            <p>在一个视图中掌握服务状态，处理真正需要关注的事项。</p>
            <ul className="login-scope-list">
              <li>
                <Users size={16} />
                <span>用户与权限</span>
              </li>
              <li>
                <Bot size={16} />
                <span>模型与调用</span>
              </li>
              <li>
                <Activity size={16} />
                <span>运行与日志</span>
              </li>
            </ul>
          </motion.div>
          <div className="login-context-status">
            <span aria-hidden="true" />
            安全连接已就绪
          </div>
        </section>

        <section className="admin-login-form-side">
          <motion.div
            className="admin-login-card"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", stiffness: 310, damping: 34, mass: 0.9 }}
          >
            <div className="login-form-meta">
              <span>管理控制台</span>
              <span>演示环境</span>
            </div>
            <div className="login-card-heading">
              <span className="mobile-admin-mark">
                <ShieldCheck size={18} />
              </span>
              <h2>安全登录</h2>
              <p>使用你的管理员凭据继续</p>
            </div>
            <form className="admin-login-form" onSubmit={submit}>
              <label>
                <span>管理员邮箱</span>
                <div className="field-wrap">
                  <UserRound size={17} />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="admin@company.com"
                    autoComplete="username"
                    required
                  />
                </div>
              </label>
              <label>
                <span>密码</span>
                <div className="field-wrap">
                  <LockKeyhole size={17} />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="至少 8 位"
                    autoComplete="current-password"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    className="field-action"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={`${showPassword ? "隐藏" : "显示"}密码`}
                  >
                    {showPassword ? "隐藏" : "显示"}
                  </button>
                </div>
              </label>
              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    className="admin-form-error"
                    role="alert"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                  >
                    <CircleAlert size={15} />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button
                className="admin-login-submit"
                type="submit"
                disabled={loading}
                whileTap={{ scale: 0.97 }}
              >
                <KeyRound size={17} />
                <span>{loading ? "登录中..." : "进入管理台"}</span>
                <ArrowRight size={17} />
              </motion.button>
            </form>
            <button
              className="demo-login-button"
              type="button"
              onClick={fillDemo}
              aria-label="填入演示账号"
            >
              <span>没有管理员凭据？</span> 使用演示账号{" "}
              <ArrowRight size={14} />
            </button>
            <div className="login-security-note">
              <ShieldCheck size={16} />
              <span>登录活动受保护并记录在审计日志中。</span>
            </div>
          </motion.div>
        </section>
      </motion.div>
    </main>
  );
}
