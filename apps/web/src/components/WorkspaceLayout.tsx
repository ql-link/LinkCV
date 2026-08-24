import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  CalendarClock,
  Database,
  FileText,
  LayoutTemplate,
} from "lucide-react";
import { navigateTo } from "../routing";
import { useResumeStore } from "../store/resumeStore";
import { NoticeBell } from "../features/notices/NoticeBell";
import { Brand } from "@/components/ui";
import RandomLetterSwapNav from "@/components/ui/m-random-letter-swap-1";
import { preloadWorkspacePage } from "../workspacePageLoaders";

export type WorkspaceSection = "resumes" | "templates" | "jobs" | "interviews" | "datasets" | "account";

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
    activeColor: "var(--ui-warning)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-warning) 24%, transparent) 0%, color-mix(in srgb, var(--ui-warning) 10%, transparent) 48%, transparent 76%)",
    key: "jobs",
    label: "JD 中心",
    href: "/jobs",
    icon: BriefcaseBusiness,
  },
  {
    activeColor: "var(--ui-interview-accent)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-interview-accent) 26%, transparent) 0%, color-mix(in srgb, var(--ui-interview-accent) 12%, transparent) 48%, transparent 76%)",
    key: "interviews",
    label: "面试中心",
    href: "/interviews",
    icon: CalendarClock,
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
      <div className="dashboard-topbar-actions">
        <NoticeBell />
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
      </div>
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
