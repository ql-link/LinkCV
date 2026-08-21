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
import RandomLetterSwapNav from "@/components/ui/m-random-letter-swap-1";

export type WorkspaceSection = "resumes" | "jobs" | "datasets" | "account";

type WorkspaceNavigationProps = {
  active: WorkspaceSection;
  email: string;
  nickname?: string;
  avatarUrl?: string | null;
};

const NAV_ITEMS: Array<{
  activeColor: string;
  gradient: string;
  key: WorkspaceSection;
  label: string;
  href: string;
  icon: typeof FileText;
}> = [
  {
    activeColor: "var(--ui-accent)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-accent) 24%, transparent) 0%, color-mix(in srgb, var(--ui-accent) 10%, transparent) 48%, transparent 76%)",
    key: "resumes",
    label: "全部简历",
    href: "/resumes",
    icon: FileText,
  },
  {
    activeColor: "var(--ui-warning)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-warning) 24%, transparent) 0%, color-mix(in srgb, var(--ui-warning) 10%, transparent) 48%, transparent 76%)",
    key: "jobs",
    label: "JD 中心",
    href: "/jobs",
    icon: BriefcaseBusiness,
  },
  {
    activeColor: "var(--ui-success)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-success) 24%, transparent) 0%, color-mix(in srgb, var(--ui-success) 10%, transparent) 48%, transparent 76%)",
    key: "datasets",
    label: "资料库",
    href: "/datasets",
    icon: Database,
  },
  {
    activeColor: "var(--ui-destructive)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-destructive) 24%, transparent) 0%, color-mix(in srgb, var(--ui-destructive) 10%, transparent) 48%, transparent 76%)",
    key: "account",
    label: "个人资料",
    href: "/account",
    icon: UserRound,
  },
];

export function WorkspaceNavigation({ active, avatarUrl, email, nickname }: WorkspaceNavigationProps) {
  const displayName = nickname || email || "个人资料";
  const activeHref = NAV_ITEMS.find((item) => item.key === active)?.href ?? "/resumes";

  return (
    <header className="dashboard-topbar">
      <a
        className="dashboard-brand-link no-underline hover:no-underline"
        href="/resumes"
        onClick={(event) => {
          if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          event.preventDefault();
          navigateTo("/resumes");
        }}
        aria-label="LinkResume 首页"
      >
        <Brand className="dashboard-brand" label="LinkResume" name="LinkResume" />
      </a>
      <div className="dashboard-nav-scroll">
        <nav aria-label="工作区导航" title={`当前账号：${displayName}`}>
          <RandomLetterSwapNav
            activeItem={activeHref}
            className="dashboard-tabs"
            currentType="page"
            links={NAV_ITEMS}
            navigationMode="client"
            onItemClick={navigateTo}
          />
        </nav>
      </div>
      <span className="dashboard-account-badge" title={displayName} aria-label={`当前账号：${displayName}`}>
        {avatarUrl
          ? <img src={avatarUrl} alt="" width="34" height="34" />
          : [...displayName][0]}
      </span>
    </header>
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
      <WorkspaceNavigation
        active={active}
        email={user?.email ?? ""}
        nickname={user?.nickname}
        avatarUrl={user?.avatar_url}
      />
      {children}
    </div>
  );
}
