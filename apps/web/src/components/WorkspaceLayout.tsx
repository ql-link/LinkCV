import { t, useLocale } from "@/i18n";
import type { ComponentType, ReactNode } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  FolderOpen,
  FileText,
  LayoutTemplate,
  ListChecks,
} from "lucide-react";
import assistantFeather from "../features/assistant/assistant-assets/assistant-feather.png";
import { navigateTo, rememberedAssistantPath } from "../routing";
import { useResumeStore } from "../store/resumeStore";
import { Brand, PageHeader } from "@/components/ui";
import RandomLetterSwapNav from "@/components/ui/m-random-letter-swap-1";
import { preloadWorkspacePage } from "../workspacePageLoaders";
import "./career-navigation.css";

export type WorkspaceSection = "resumes" | "assistant" | "templates" | "applications" | "schedule" | "datasets" | "account";
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
    get label() { return t("我的简历"); },
    href: "/resumes",
    icon: FileText,
  },
  {
    activeColor: "var(--ui-template-accent)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-template-accent) 24%, transparent) 0%, color-mix(in srgb, var(--ui-template-accent) 10%, transparent) 48%, transparent 76%)",
    key: "templates",
    get label() { return t("简历模板"); },
    href: "/templates",
    icon: LayoutTemplate,
  },
  {
    activeColor: "var(--ui-warning)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-warning) 24%, transparent) 0%, color-mix(in srgb, var(--ui-warning) 10%, transparent) 48%, transparent 76%)",
    key: "applications",
    get label() { return t("求职记录"); },
    href: "/career/applications",
    icon: ListChecks,
  },
  {
    activeColor: "var(--ui-warning)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-warning) 24%, transparent) 0%, color-mix(in srgb, var(--ui-warning) 10%, transparent) 48%, transparent 76%)",
    key: "schedule",
    get label() { return t("面试排期"); },
    href: "/career/schedule",
    icon: CalendarDays,
  },
  {
    activeColor: "var(--ui-success)",
    gradient: "radial-gradient(circle, color-mix(in srgb, var(--ui-success) 24%, transparent) 0%, color-mix(in srgb, var(--ui-success) 10%, transparent) 48%, transparent 76%)",
    key: "datasets",
    get label() { return t("资料库"); },
    href: "/datasets",
    icon: FolderOpen,
  },
];

export function WorkspaceNavigation({
  active,
  avatarUrl,
  email,
  nickname,
  onItemIntent = preloadWorkspacePage,
}: WorkspaceNavigationProps) {
  useLocale();
  const displayName = nickname || email || t("个人资料");
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
        aria-label={t("DrawOffer 首页")}
      >
        <Brand className="dashboard-brand" label="DrawOffer" name="DrawOffer" />
      </a>
      <div className="dashboard-nav-scroll">
        <nav aria-label={t("工作区导航")} title={t("当前账号：{value0}", { value0: displayName })}>
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
        <a
          className="dashboard-ai-workspace-link"
          href={rememberedAssistantPath()}
          onFocus={() => { void onItemIntent(rememberedAssistantPath()); }}
          onMouseEnter={() => { void onItemIntent(rememberedAssistantPath()); }}
          onClick={(event) => {
            if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            navigateTo(rememberedAssistantPath());
          }}
        >
          <img src={assistantFeather} alt="" aria-hidden="true" />
          <span>{t("AI 工作台")}</span>
        </a>
        <a
          aria-current={active === "account" ? "page" : undefined}
          aria-label={t("打开个人资料，当前账号：{value0}", { value0: displayName })}
          className="dashboard-account-badge"
          href="/account"
          onFocus={() => { void onItemIntent("/account"); }}
          onMouseEnter={() => { void onItemIntent("/account"); }}
          title={t("个人资料：{value0}", { value0: displayName })}
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
  layout,
  eyebrow,
  title,
  description,
  navigation,
  actions,
  icon,
  tone = "accent",
  className,
}: {
  layout?: "module";
  eyebrow?: string;
  title: string;
  description?: string;
  navigation?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  tone?: "accent" | "template" | "success" | "warning";
  className?: string;
}) {
  useLocale();
  if (icon || layout === "module") {
    return (
      <header className={`page-hero is-module${className ? ` ${className}` : ""}`}>
        <div className="page-hero-module-summary">
          {icon && (
            <span className={`page-hero-module-mark is-${tone}`} aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="page-hero-module-copy">
            <h1>{title}</h1>
            {description && <p className="page-hero-description">{description}</p>}
          </div>
        </div>
        {navigation && <div className="page-hero-module-navigation">{navigation}</div>}
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
  { key: "applications", get label() { return t("求职记录"); }, href: "/career/applications", icon: ListChecks },
  { key: "schedule", get label() { return t("面试排期"); }, href: "/career/schedule", icon: CalendarDays },
];

export function CareerNavigation({ active }: { active: CareerSection }) {
  useLocale();
  const activeEntry = active === "schedule" ? "schedule" : "applications";

  return (
    <nav className="career-subnav" aria-label={t("求职中心导航")}>
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
          <Icon aria-hidden="true" />
          <span className="career-subnav-label">{label}</span>
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
  useLocale();
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

export function AssistantWorkspaceLayout({ children }: { children: ReactNode }) {
  useLocale();
  return (
    <div className="dashboard-shell assistant-workspace-shell" data-ui-theme="light">
      {children}
    </div>
  );
}
