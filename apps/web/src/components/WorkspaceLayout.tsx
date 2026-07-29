import type { ReactNode } from "react";
import { BriefcaseBusiness, FileText, LayoutTemplate, LogOut, Shield } from "lucide-react";
import { navigateTo } from "../routing";
import { useResumeStore } from "../store/resumeStore";
import { Brand } from "./ds";

export type WorkspaceSection = "resumes" | "templates" | "jobs";

type WorkspaceSidebarProps = {
  active: WorkspaceSection;
  email: string;
  isAdmin: boolean;
  onLogout: () => void | Promise<void>;
};

export function WorkspaceSidebar({ active, email, isAdmin, onLogout }: WorkspaceSidebarProps) {
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
      </div>
      {isAdmin && (
        <>
          <hr className="sidebar-divider" />
          <button
            className="sidebar-admin-button"
            type="button"
            onClick={() => navigateTo("/admin")}
            title="管理台"
          >
            <Shield size={16} />
            管理台
          </button>
        </>
      )}
      <button className="dashboard-account" type="button" onClick={() => void onLogout()}>
        <LogOut size={14} />
        <span>{email}</span>
      </button>
    </nav>
  );
}

export function WorkspaceLayout({ active, children }: { active: WorkspaceSection; children: ReactNode }) {
  const user = useResumeStore((state) => state.user);
  const logout = useResumeStore((state) => state.logout);

  const logoutAndReturn = async () => {
    await logout();
    navigateTo("/", { replace: true });
  };

  return (
    <div className="dashboard-shell">
      <WorkspaceSidebar active={active} email={user?.email ?? ""} isAdmin={user?.is_admin ?? false} onLogout={logoutAndReturn} />
      {children}
    </div>
  );
}
