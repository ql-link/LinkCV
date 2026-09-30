import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Bell,
  Bot,
  Filter,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Brand, FeedbackNotice, PageLoading } from "@/components/ui";
import { api, type User } from "../../api/client";
import { adminLoginPath, navigateTo } from "../../routing";
import { AdminConsoleProvider } from "./kit";
import { useAdminViewportScale } from "./viewportScale";
import { AnnouncementsPage } from "./AnnouncementsPage";
import { CapabilitiesPage } from "./CapabilitiesPage";
import { ConnectionsPage, ModelsPage, UsagePage } from "./LlmPages";
import { FunnelPage } from "./FunnelPage";
import { OverviewPage } from "./OverviewPage";
import { PluginReleasePanel } from "./PluginReleasePanel";
import {
  AgentLogsPage,
  AgentOperationsPage,
  AuditLogsPage,
  LlmCallsPage,
  SystemLogsPage,
} from "./SecurityPages";
import { TemplatesPage } from "./TemplatesPage";
import { UsersPage } from "./UsersPage";
import "./admin.css";
import "./console.css";

export type AdminPage =
  | "overview"
  | "users"
  | "funnel"
  | "templates"
  | "plugins"
  | "announcements"
  | "connections"
  | "models"
  | "capabilities"
  | "usage"
  | "agentLogs"
  | "agentTrace"
  | "systemLogs"
  | "llmCalls"
  | "audit";

export const adminPagePaths: Record<AdminPage, string> = {
  overview: "/admin",
  users: "/admin/users",
  funnel: "/admin/funnel",
  templates: "/admin/templates",
  plugins: "/admin/plugins",
  announcements: "/admin/announcements",
  connections: "/admin/llm/connections",
  models: "/admin/llm/models",
  capabilities: "/admin/llm/capabilities",
  usage: "/admin/llm/usage",
  agentLogs: "/admin/agent",
  agentTrace: "/admin/agent-operations",
  systemLogs: "/admin/logs/system",
  llmCalls: "/admin/logs/llm",
  audit: "/admin/logs/audit",
};

/** Legacy paths (`/admin/logs`, `/admin/llm`) resolve to their V3 equivalents. */
export function adminPageFromPath(pathname: string): AdminPage {
  const path = pathname.replace(/\/+$/, "") || "/admin";
  const exact = (Object.entries(adminPagePaths) as Array<[AdminPage, string]>).find(([, value]) => value === path);
  if (exact) return exact[0];
  if (path === "/admin/logs") return "llmCalls";
  if (path.startsWith("/admin/logs")) return "systemLogs";
  if (path.startsWith("/admin/llm")) return "models";
  if (path.startsWith("/admin/agent-operations")) return "agentTrace";
  const prefix = (Object.entries(adminPagePaths) as Array<[AdminPage, string]>).find(([, value]) => value !== "/admin" && path.startsWith(value));
  return prefix?.[0] ?? "overview";
}

type NavGroup = { id: string; label: string; icon: typeof LayoutDashboard; pages: Array<{ page: AdminPage; label: string }> };

const navGroups: NavGroup[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard, pages: [{ page: "overview", label: "总览" }] },
  { id: "users", label: "用户管理", icon: Users, pages: [{ page: "users", label: "用户管理" }] },
  { id: "funnel", label: "转化漏斗", icon: Filter, pages: [{ page: "funnel", label: "转化漏斗" }] },
  { id: "content", label: "内容管理", icon: FileText, pages: [{ page: "templates", label: "简历模板" }, { page: "plugins", label: "浏览器插件" }] },
  { id: "announcements", label: "通知管理", icon: Bell, pages: [{ page: "announcements", label: "应用内公告" }] },
  { id: "models", label: "模型管理", icon: Bot, pages: [{ page: "connections", label: "接入连接" }, { page: "models", label: "模型与线路" }, { page: "capabilities", label: "能力配置" }, { page: "usage", label: "使用情况" }] },
  {
    id: "security",
    label: "系统安全",
    icon: ShieldCheck,
    pages: [
      { page: "agentLogs", label: "Agent 日志" },
      { page: "agentTrace", label: "Agent 排障" },
      { page: "systemLogs", label: "系统日志" },
      { page: "llmCalls", label: "LLM 调用" },
      { page: "audit", label: "业务审计" },
    ],
  },
];

const pageOrder = navGroups.flatMap((group) => group.pages.map((item) => ({ page: item.page, group: group.id })));

/** Pages within one group slide sideways; moving between groups slides along the sidebar's direction. */
export function pageMotion(from: AdminPage, to: AdminPage) {
  const a = pageOrder.findIndex((item) => item.page === from);
  const b = pageOrder.findIndex((item) => item.page === to);
  const lateral = pageOrder[a]?.group === pageOrder[b]?.group;
  const forward = b > a;
  if (lateral) return forward ? "lateral-forward" : "lateral-back";
  return forward ? "forward" : "back";
}

export function AdminApp() {
  const [user, setUser] = useState<User | null | "loading">("loading");

  useEffect(() => {
    api.me().then((result) => setUser(result.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    // Guests and non-admins go to the dedicated login page with the original target.
    if (user === "loading" || (user && user.is_admin)) return;
    navigateTo(adminLoginPath(`${window.location.pathname}${window.location.search}`), { replace: true });
  }, [user]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  if (user === "loading") return <PageLoading label="正在验证身份…" scope="page" />;
  if (!user?.is_admin) return <PageLoading label="正在前往登录页…" scope="page" />;
  return <AdminWorkspace user={user} onLogout={logout} onSessionExpired={() => setUser(null)} />;
}

function AdminWorkspace({ user, onLogout, onSessionExpired }: { user: User; onLogout: () => void; onSessionExpired: () => void }) {
  const [page, setPage] = useState<AdminPage>(() => adminPageFromPath(window.location.pathname));
  // Direction of the last page change, used by the enter animation (see console.css).
  const [motion, setMotion] = useState<"initial" | "forward" | "back" | "lateral-forward" | "lateral-back">("initial");
  const [mobileNav, setMobileNav] = useState(false);
  useAdminViewportScale();
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [auditFailedOnly] = useState(() => new URLSearchParams(window.location.search).get("result") === "failed");

  const pageRef = useRef(page);
  const changePage = useCallback((next: AdminPage) => {
    if (pageRef.current === next) return;
    setMotion(pageMotion(pageRef.current, next));
    pageRef.current = next;
    setPage(next);
  }, []);

  useEffect(() => {
    const onPop = () => changePage(adminPageFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [changePage]);

  const go = useCallback((next: AdminPage) => {
    changePage(next);
    setMobileNav(false);
    if (window.location.pathname !== adminPagePaths[next]) window.history.pushState(null, "", adminPagePaths[next]);
    const main = document.querySelector(".adm-main");
    if (main) main.scrollTop = 0;
  }, [changePage]);

  const consoleValue = useMemo(() => ({
    notify: (message: string, kind: "success" | "error" = "success") => setToast({ message, kind }),
    onSessionExpired,
    navigate: (path: string) => go(adminPageFromPath(path)),
  }), [go, onSessionExpired]);

  const sidebar = <Sidebar page={page} onNavigate={go} user={user} onLogout={onLogout} />;

  return (
    <AdminConsoleProvider value={consoleValue}>
      <div className="admin-shell adm-shell">
        <aside className="adm-sidebar">{sidebar}</aside>
        {/* Kept mounted so the drawer can slide out as well as in. */}
        <div className={`adm-mobile-nav${mobileNav ? " is-open" : ""}`} inert={!mobileNav} aria-hidden={!mobileNav || undefined} onClick={() => setMobileNav(false)}>
          <aside onClick={(event) => event.stopPropagation()}>
            <button type="button" className="adm-close adm-mobile-close" aria-label="关闭导航" onClick={() => setMobileNav(false)}><X size={16} /></button>
            <Sidebar page={page} onNavigate={go} user={user} onLogout={onLogout} />
          </aside>
        </div>
        <main className="adm-main">
          <button type="button" className="adm-mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={18} /></button>
          <div className="adm-content" key={page} data-motion={motion}>
            {page === "overview" && <OverviewPage user={user} />}
            {page === "users" && <UsersPage currentUser={user} />}
            {page === "funnel" && <FunnelPage />}
            {page === "templates" && <TemplatesPage />}
            {page === "plugins" && <PluginReleasePanel />}
            {page === "announcements" && <AnnouncementsPage />}
            {page === "connections" && <ConnectionsPage />}
            {page === "models" && <ModelsPage />}
            {page === "capabilities" && <CapabilitiesPage />}
            {page === "usage" && <UsagePage />}
            {page === "agentLogs" && <AgentLogsPage />}
            {page === "agentTrace" && <AgentOperationsPage />}
            {page === "systemLogs" && <SystemLogsPage />}
            {page === "llmCalls" && <LlmCallsPage />}
            {page === "audit" && <AuditLogsPage initialFailedOnly={auditFailedOnly} />}
          </div>
        </main>
        {toast && (
          <FeedbackNotice kind={toast.kind} placement="floating" onDismiss={() => setToast(null)}>{toast.message}</FeedbackNotice>
        )}
      </div>
    </AdminConsoleProvider>
  );
}

function Sidebar({ page, onNavigate, user, onLogout }: { page: AdminPage; onNavigate: (page: AdminPage) => void; user: User; onLogout: () => void }) {
  const activeGroup = navGroups.find((group) => group.pages.some((item) => item.page === page))?.id;
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();
  // Search jumps straight to a page; groups stay collapsed while filtering.
  const matches = keyword
    ? navGroups.flatMap((group) => group.pages.filter((item) => `${group.label}${item.label}`.toLowerCase().includes(keyword)).map((item) => ({ ...item, group: group.label })))
    : [];
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const jump = (target: AdminPage) => {
    setQuery("");
    onNavigate(target);
  };

  return (
    <>
      <a className="adm-brand" href="/admin" onClick={(event) => { event.preventDefault(); onNavigate("overview"); }}>
        <Brand />
      </a>
      <label className="adm-nav-search">
        <Search size={13} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="搜索"
          aria-label="搜索页面"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) jump(matches[0].page);
            if (event.key === "Escape") setQuery("");
          }}
        />
        {!query && <kbd aria-hidden="true">⌘K</kbd>}
      </label>
      <nav className="adm-nav" aria-label="管理端导航">
        {keyword ? (
          <div className="adm-nav-results">
            <p>{matches.length ? "页面" : "没有匹配的页面"}</p>
            {matches.map((item) => (
              <button key={item.page} type="button" onClick={() => jump(item.page)}>
                <span>{item.label}</span>
                {item.group !== item.label && <small>{item.group}</small>}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p>工作区</p>
            <div className="adm-nav-list">
            {/* One shared highlight slides between rows; every row is 34px + 5px gap, and only the active group is expanded below itself. */}
            <i className="adm-nav-indicator" aria-hidden="true" style={{ "--adm-nav-index": Math.max(0, navGroups.findIndex((group) => group.id === activeGroup)) } as CSSProperties} />
            {navGroups.map((group) => {
              const open = group.id === activeGroup;
              const single = group.pages.length === 1;
              const subIndex = group.pages.findIndex((item) => item.page === page);
              return (
                <div key={group.id} className={`adm-nav-group${open ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className={open ? "is-active" : undefined}
                    aria-current={single && open ? "page" : undefined}
                    aria-expanded={single ? undefined : open}
                    onClick={() => onNavigate(group.pages[0].page)}
                  >
                    <group.icon size={13} strokeWidth={2} aria-hidden="true" />
                    <span>{group.label}</span>
                  </button>
                  {!single && (
                    // Always rendered so the grid-rows transition can animate open and closed.
                    <div className="adm-subnav" inert={!open} aria-hidden={!open || undefined}>
                      <div>
                        <i className="adm-subnav-indicator" aria-hidden="true" style={{ "--adm-nav-index": Math.max(0, subIndex) } as CSSProperties} />
                        {group.pages.map((item) => (
                          <button key={item.page} type="button" className={item.page === page ? "is-active" : undefined} aria-current={item.page === page ? "page" : undefined} onClick={() => onNavigate(item.page)}>
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </>
        )}
      </nav>
      <div className="adm-sidebar-foot">
        <span className="adm-account"><span aria-hidden="true">{user.nickname.slice(0, 1).toUpperCase()}</span><strong>{user.nickname}</strong></span>
        <button type="button" onClick={onLogout} aria-label="退出登录" title="退出登录"><LogOut size={14} /></button>
      </div>
    </>
  );
}
