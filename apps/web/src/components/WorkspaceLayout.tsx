import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  Database,
  FileText,
  UserRound,
} from "lucide-react";
import { navigateTo } from "../routing";
import { useResumeStore } from "../store/resumeStore";
import { Brand } from "@/components/ui";

export type WorkspaceSection = "resumes" | "jobs" | "datasets" | "account";

type WorkspaceSidebarProps = {
  active: WorkspaceSection;
  email: string;
  nickname?: string;
  avatarUrl?: string | null;
};

const NAV_ITEMS: Array<{
  key: WorkspaceSection;
  label: string;
  href: string;
  icon: typeof FileText;
}> = [
  { key: "resumes", label: "全部简历", href: "/resumes", icon: FileText },
  { key: "jobs", label: "JD 中心", href: "/jobs", icon: BriefcaseBusiness },
  { key: "datasets", label: "资料库", href: "/datasets", icon: Database },
];

function WorkspaceAccount({ active, email, nickname, avatarUrl }: WorkspaceSidebarProps) {
  const displayName = nickname || email;

  return (
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
          <small className="account-email">个人资料</small>
        </span>
      </button>
    </div>
  );
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  return (
    <nav className="dashboard-sidebar" aria-label="工作区导航">
      <Brand className="dashboard-brand" />
      <div className="dashboard-tabs">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={props.active === item.key ? "is-active" : ""}
              type="button"
              aria-current={props.active === item.key ? "page" : undefined}
              onClick={() => navigateTo(item.href)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </div>
      <WorkspaceAccount {...props} />
    </nav>
  );
}

export function WorkspacePageHero({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-hero">
      <div className="page-hero-text">
        <p className="page-hero-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="page-hero-description">{description}</p>}
      </div>
      {actions && <div className="page-hero-actions">{actions}</div>}
    </header>
  );
}

export function WorkspaceLayout({ active, children }: { active: WorkspaceSection; children: ReactNode }) {
  const user = useResumeStore((state) => state.user);
  return (
    <div className="dashboard-shell" data-ui-theme="light">
      <WorkspaceSidebar
        active={active}
        email={user?.email ?? ""}
        nickname={user?.nickname}
        avatarUrl={user?.avatar_url}
      />
      {children}
    </div>
  );
}
