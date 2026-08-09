import { useState, type ReactNode } from "react";
import { BriefcaseBusiness, Database, FileText, LayoutTemplate, LogOut, UserRound } from "lucide-react";
import { navigateTo } from "../routing";
import { useResumeStore } from "../store/resumeStore";
import { Brand } from "./ds";

export type WorkspaceSection = "resumes" | "templates" | "jobs" | "datasets" | "account";

type WorkspaceSidebarProps = {
  active: WorkspaceSection;
  email: string;
  nickname?: string;
  avatarUrl?: string | null;
  loggingOut?: boolean;
  logoutError?: string | null;
  onLogout?: () => void;
};

export function WorkspaceSidebar({
  active,
  email,
  nickname,
  avatarUrl,
  loggingOut = false,
  logoutError = null,
  onLogout,
}: WorkspaceSidebarProps) {
  const displayName = nickname || email;
  return (
    <nav className="dashboard-sidebar" aria-label="工作区导航">
      <Brand className="dashboard-brand" />
      <div className="dashboard-tabs">
        <button
          className={active === "resumes" ? "is-active" : ""}
          type="button"
          aria-current={active === "resumes" ? "page" : undefined}
          onClick={() => navigateTo("/resumes")}
        >
          <FileText size={16} />全部简历
        </button>
        <button
          className={active === "templates" ? "is-active" : ""}
          type="button"
          aria-current={active === "templates" ? "page" : undefined}
          onClick={() => navigateTo("/resumes?view=templates")}
        >
          <LayoutTemplate size={16} />模板
        </button>
        <button
          className={active === "jobs" ? "is-active" : ""}
          type="button"
          aria-current={active === "jobs" ? "page" : undefined}
          onClick={() => navigateTo("/jobs")}
        >
        <BriefcaseBusiness size={16} />JD 中心
        </button>
        <button
          className={active === "datasets" ? "is-active" : ""}
          type="button"
          aria-current={active === "datasets" ? "page" : undefined}
          onClick={() => navigateTo("/datasets")}
        >
        <Database size={16} />资料库
        </button>
      </div>
      <div className="dashboard-account-area">
        <button
          className={`dashboard-account${active === "account" ? " is-active" : ""}`}
          type="button"
          aria-current={active === "account" ? "page" : undefined}
          onClick={() => navigateTo("/account")}
          title="个人资料"
        >
          {avatarUrl ? (
            <img className="account-avatar" src={avatarUrl} alt="" />
          ) : (
            <span className="account-avatar-fallback" aria-hidden="true">
              {[...displayName][0] ?? <UserRound size={14} />}
            </span>
          )}
          <span className="account-text">
            <strong className="account-name">{displayName}</strong>
            <small className="account-email">{email}</small>
          </span>
        </button>
        {onLogout && (
          <button
            className="dashboard-logout-button"
            type="button"
            disabled={loggingOut}
            onClick={onLogout}
            aria-label={loggingOut ? "正在退出登录" : "退出登录"}
            title={loggingOut ? "正在退出登录" : "退出登录并返回欢迎页"}
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{loggingOut ? "退出中…" : "退出"}</span>
          </button>
        )}
        {logoutError && <p className="dashboard-logout-error" role="alert">{logoutError}</p>}
      </div>
    </nav>
  );
}

export function WorkspaceLayout({ active, children }: { active: WorkspaceSection; children: ReactNode }) {
  const user = useResumeStore((state) => state.user);
  const logout = useResumeStore((state) => state.logout);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
      navigateTo("/", { replace: true });
    } catch {
      setLogoutError("退出登录失败，请稍后重试。");
      setLoggingOut(false);
    }
  };

  return (
    <div className="dashboard-shell">
      <WorkspaceSidebar
        active={active}
        email={user?.email ?? ""}
        nickname={user?.nickname}
        avatarUrl={user?.avatar_url}
        loggingOut={loggingOut}
        logoutError={logoutError}
        onLogout={() => void handleLogout()}
      />
      {children}
    </div>
  );
}
