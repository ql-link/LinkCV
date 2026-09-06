import type { ComponentType, ReactNode } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  Database,
  FileText,
  LayoutTemplate,
  ListChecks,
} from "lucide-react";
import assistantFeatherOutline from "../assets/assistant-feather-outline.png";
import { navigateTo } from "../routing";
import { useResumeStore } from "../store/resumeStore";
import { Brand, PageHeader } from "@/components/ui";
import RandomLetterSwapNav from "@/components/ui/m-random-letter-swap-1";
import { preloadWorkspacePage } from "../workspacePageLoaders";
import "./career-navigation.css";

export type WorkspaceSection = "resumes" | "assistant" | "templates" | "career" | "datasets" | "account";
export type CareerSection = "applications" | "schedule" | "reviews";

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
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string; strokeWidth?: number }>;
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
    activeColor: "var(--ui-assistant-accent)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-assistant-accent) 28%, transparent) 0%, color-mix(in srgb, var(--ui-assistant-accent) 12%, transparent) 48%, transparent 76%)",
    key: "assistant",
    label: "AI 助手",
    href: "/assistant",
    icon: AssistantFeatherIcon,
  },
  {
    activeColor: "var(--ui-warning)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-warning) 24%, transparent) 0%, color-mix(in srgb, var(--ui-warning) 10%, transparent) 48%, transparent 76%)",
    key: "career",
    label: "求职中心",
    href: "/career/applications",
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

function AssistantFeatherIcon({
  className,
  "aria-hidden": ariaHidden,
}: {
  "aria-hidden"?: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  return <img aria-hidden={ariaHidden} className={`${className ?? ""} dark:invert`} src={assistantFeatherOutline} alt="" />;
}

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
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  tone?: "accent" | "template" | "success" | "warning";
  className?: string;
}) {
  if (icon) {
    return (
      <header className={`page-hero is-module${className ? ` ${className}` : ""}`}>
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
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actions}
      className={className}
    />
  );
}

const CAREER_ITEMS: Array<{ key: CareerSection; label: string; href: string; icon: typeof BriefcaseBusiness }> = [
  { key: "applications", label: "求职记录", href: "/career/applications", icon: ListChecks },
  { key: "schedule", label: "面试排期", href: "/career/schedule", icon: CalendarDays },
];

export function CareerNavigation({ active }: { active: CareerSection }) {
  const activeEntry = active === "schedule" ? "schedule" : "applications";

  return (
    <nav className="career-subnav" aria-label="求职中心导航">
      {CAREER_ITEMS.map(({ key, label, href, icon: Icon }) => (
        <a
          key={key}
          className={activeEntry === key ? "is-active" : ""}
          aria-current={activeEntry === key ? "page" : undefined}
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

export function WorkspaceLayout({
  active,
  children,
  className,
}: {
  active: WorkspaceSection;
  children: ReactNode;
  className?: string;
}) {
  const user = useResumeStore((state) => state.user);
  return (
    <div className={`dashboard-shell${className ? ` ${className}` : ""}`} data-ui-theme="light">
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
