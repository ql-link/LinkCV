import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  Database,
  FileText,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  NotebookTabs,
} from "lucide-react";
import { navigateTo } from "../routing";
import { useResumeStore } from "../store/resumeStore";
import { Brand } from "@/components/ui";
import RandomLetterSwapNav from "@/components/ui/m-random-letter-swap-1";
import { preloadWorkspacePage } from "../workspacePageLoaders";
import "./career-navigation.css";

export type WorkspaceSection = "resumes" | "templates" | "career" | "datasets" | "account";
export type CareerSection = "overview" | "jobs" | "applications" | "schedule" | "reviews";

type WorkspaceNavigationProps = {
  active: WorkspaceSection;
  email: string;
  nickname?: string;
  avatarUrl?: string | null;
  onItemIntent?: (href: string) => void;
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
    label: "我的简历",
    href: "/resumes",
    icon: FileText,
  },
  {
    activeColor: "var(--ui-template-accent)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-template-accent) 24%, transparent) 0%, color-mix(in srgb, var(--ui-template-accent) 10%, transparent) 48%, transparent 76%)",
    key: "templates",
    label: "简历模板",
    href: "/templates",
    icon: LayoutTemplate,
  },
  {
    activeColor: "var(--ui-interview-accent)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-interview-accent) 26%, transparent) 0%, color-mix(in srgb, var(--ui-interview-accent) 12%, transparent) 48%, transparent 76%)",
    key: "career",
    label: "求职中心",
    href: "/career",
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
];

export function WorkspaceNavigation({
  active,
  avatarUrl,
  email,
  nickname,
  onItemIntent = preloadWorkspacePage,
}: WorkspaceNavigationProps) {
  const displayName = nickname || email || "个人资料";
  const activeHref = NAV_ITEMS.find((item) => item.key === active)?.href ?? "";

  return (
    <header className="dashboard-topbar">
      <a
        className="dashboard-brand-link no-underline hover:no-underline"
        href="/resumes"
        onFocus={() => { void onItemIntent("/resumes"); }}
        onMouseEnter={() => { void onItemIntent("/resumes"); }}
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
            onItemIntent={(href) => { void onItemIntent(href); }}
          />
        </nav>
      </div>
      <a
        aria-current={active === "account" ? "page" : undefined}
        aria-label={`打开个人资料，当前账号：${displayName}`}
        className="dashboard-account-badge"
        href="/account"
        onFocus={() => { void onItemIntent("/account"); }}
        onMouseEnter={() => { void onItemIntent("/account"); }}
        title={`个人资料：${displayName}`}
        onClick={(event) => {
          if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          event.preventDefault();
          navigateTo("/account");
        }}
      >
        {avatarUrl
          ? <img src={avatarUrl} alt="" width="34" height="34" />
          : [...displayName][0]}
      </a>
    </header>
  );
}

export function WorkspacePageHero({
  eyebrow,
  title,
  description,
  actions,
  icon,
  tone = "accent",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  tone?: "accent" | "template" | "success";
}) {
  if (icon) {
    return (
      <header className="page-hero is-module">
        <div className="page-hero-module-summary">
          <span className={`page-hero-module-mark is-${tone}`} aria-hidden="true">
            {icon}
          </span>
          <div className="page-hero-module-copy">
            <h1>{title}</h1>
            {description && <p className="page-hero-description">{description}</p>}
          </div>
        </div>
        {actions && <div className="page-hero-actions">{actions}</div>}
      </header>
    );
  }

  return (
    <header className="page-hero">
      <div className="page-hero-text">
        {eyebrow && <p className="page-hero-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-hero-description">{description}</p>}
      </div>
      {actions && <div className="page-hero-actions">{actions}</div>}
    </header>
  );
}

const CAREER_ITEMS: Array<{ key: CareerSection; label: string; href: string; icon: typeof BriefcaseBusiness }> = [
  { key: "overview", label: "总览", href: "/career", icon: LayoutDashboard },
  { key: "jobs", label: "岗位库", href: "/career/jobs", icon: BriefcaseBusiness },
  { key: "applications", label: "求职进程", href: "/career/applications", icon: ListChecks },
  { key: "schedule", label: "面试排期", href: "/career/schedule", icon: CalendarDays },
  { key: "reviews", label: "记录复盘", href: "/career/reviews", icon: NotebookTabs },
];

export function CareerNavigation({ active }: { active: CareerSection }) {
  return (
    <nav className="career-subnav" aria-label="求职中心导航">
      {CAREER_ITEMS.map(({ key, label, href, icon: Icon }) => (
        <a
          key={key}
          className={active === key ? "is-active" : ""}
          aria-current={active === key ? "page" : undefined}
          href={href}
          onClick={(event) => {
            if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            navigateTo(href);
          }}
        >
          <Icon />
          {label}
        </a>
      ))}
    </nav>
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
