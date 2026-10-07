import { t, useLocale } from "@/i18n";
import { MotionPresence } from "@/components/ui/motion";
import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import brandWordmark from "@/assets/linkresume-wordmark.png";
import { api, type AgentSession } from "../api/client";
import { assistantPath, navigateTo, rememberAssistantSession } from "../routing";
import { useResumeStore } from "../store/resumeStore";
import { preloadWorkspacePage } from "../workspacePageLoaders";
import { Icon, type V3IconName } from "./Icon";
import { Avatar, ConfirmDialog, Dialog, Menu, Toast } from "./primitives";
import { useActiveSessionStore, useSessionStore } from "./sessionStore";
import { DeleteSessionArt } from "./art";
import { readPageCache, writePageCache } from "./pageCache";
import "./v3.css";

export type V3Section = "home" | "resumes" | "templates" | "jobs" | "schedule" | "mock" | "datasets" | "account" | "none";

const NAV: Array<{ key: V3Section; icon: V3IconName; label: string; href: string; count?: () => number | null }> = [
  { key: "home", icon: "sun", get label() { return t("首页"); }, href: "/assistant" },
  { key: "resumes", icon: "doc", get label() { return t("我的简历"); }, href: "/resumes", count: () => useResumeStore.getState().resumes.length || null },
  { key: "templates", icon: "layout", get label() { return t("简历模板"); }, href: "/templates" },
  { key: "jobs", icon: "brief", get label() { return t("岗位看板"); }, href: "/career/applications" },
  { key: "schedule", icon: "cal", get label() { return t("面试日程"); }, href: "/career/schedule" },
  { key: "mock", icon: "mic", get label() { return t("模拟面试"); }, href: "/mock-interviews" },
  { key: "datasets", icon: "folder", get label() { return t("资料库"); }, href: "/datasets" },
];

// 侧栏选中滑块的上一次位置（跨页面保留）
let lastIndicatorTop: number | null = null;

function go(event: React.MouseEvent, href: string, onNavigate?: () => void) {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  navigateTo(href);
  onNavigate?.();
}

export function V3Sidebar({
  active,
  onSelectSession,
  onNavigate,
}: {
  active: V3Section;
  onSelectSession?: (sessionId: string) => void;
  onNavigate?: () => void;
}) {
  useLocale();
  const user = useResumeStore((state) => state.user);
  const resumeCount = useResumeStore((state) => state.resumes.length);
  const sessions = useSessionStore((state) => state.sessions);
  const collapsedGroups = useSessionStore((state) => state.collapsedGroups);
  const toggleGroup = useSessionStore((state) => state.toggleGroup);
  const groupId = useId();
  const status = useSessionStore((state) => state.status);
  const load = useSessionStore((state) => state.load);
  const activeSessionId = useActiveSessionStore((state) => state.activeId);
  const displayName = user?.nickname || user?.email || t("我");
  const [applicationCount, setApplicationCount] = useState<number | null>(() => readPageCache<number>("sidebar-application-count")?.value ?? null);

  useEffect(() => {
    let cancelled = false;
    // 侧栏「岗位看板」计数：5 分钟内切换页面直接用上次的数，不重复请求
    const cached = readPageCache<number>("sidebar-application-count");
    const refresh = async () => {
      try {
        let count = 0;
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const result = await api.listJobApplications({ scope: "active", limit: 200, cursor });
          if (!result || cancelled) return;
          count += result.items.filter((item) => item.status === "active" && !item.archived_at).length;
          cursor = result.next_cursor ?? undefined;
          if (cursor && seen.has(cursor)) break;
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (!cancelled) { setApplicationCount(count); writePageCache("sidebar-application-count", count); }
      } catch { /* 计数暂不可用时保留导航。 */ }
    };
    const changed = (event: Event) => {
      const count = (event as CustomEvent<number>).detail;
      setApplicationCount(count);
      writePageCache("sidebar-application-count", count);
    };
    if (!cached?.fresh) void refresh();
    window.addEventListener("career-applications-changed", changed);
    return () => { cancelled = true; window.removeEventListener("career-applications-changed", changed); };
  }, [active, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 选中项的高亮背景用一个滑块表示：切换页面时从旧位置滑到新位置
  // 不同页面各自挂载一份侧栏，所以记住上一次的位置：新侧栏先放在旧位置，下一帧再滑到当前项
  const navRef = useRef<HTMLElement>(null);
  // snap 表示这次定位不播放滑动动画
  const [indicator, setIndicator] = useState<{ top: number | null; snap: boolean }>(() => ({ top: lastIndicatorTop, snap: true }));
  const indicatorTop = indicator.top;
  useLayoutEffect(() => {
    // nav 始终是定位容器；offsetTop 不受抽屉入场 scale 影响。
    // getBoundingClientRect 会把入场缩放计入位置，动画结束后高亮就会偏移。
    const nav = navRef.current;
    const target = nav?.querySelector<HTMLElement>(".v3-side-row.is-active");
    const next = target ? target.offsetTop : null;
    const from = lastIndicatorTop;
    if (next === null || from === null || from === next) {
      setIndicator({ top: next, snap: true });
      lastIndicatorTop = next;
      return undefined;
    }
    // 懒加载页面的侧栏可能在 Suspense 等待期间就被隐藏挂载，初始位置已经过时；
    // 显示时先无动画放到最近一次的位置，下一帧再滑到当前项，避免从旧位置重新滑一遍。
    setIndicator({ top: from, snap: true });
    const frame = requestAnimationFrame(() => { setIndicator({ top: next, snap: false }); lastIndicatorTop = next; });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <aside className="v3-sidebar" aria-label={t("工作区侧栏")}>
      <a className="v3-sidebar-brand" href="/assistant" aria-label={t("LinkResume 首页")} onClick={(event) => go(event, "/assistant", onNavigate)}>
        <img src={brandWordmark} alt="" width={146} height={30} />
      </a>
      <div className="v3-side-body" data-locale-scroll>
        <nav ref={navRef} className={`v3-side-nav${indicatorTop !== null ? " has-indicator" : ""}`} aria-label={t("工作区导航")}>
          {indicatorTop !== null && <span className="v3-side-indicator" aria-hidden="true" style={{ transform: `translateY(${indicatorTop}px)`, transition: indicator.snap ? "none" : undefined }} />}
          {NAV.map((item) => {
            const count = item.key === "resumes" ? resumeCount || null : item.key === "jobs" ? applicationCount : item.count?.() ?? null;
            const isActive = item.key === active;
            return (
              <a
                key={item.key}
                href={item.href}
                className={`v3-side-row${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onMouseEnter={() => { void preloadWorkspacePage(item.href); }}
                onFocus={() => { void preloadWorkspacePage(item.href); }}
                onClick={(event) => go(event, item.href, onNavigate)}
              >
                <Icon name={item.icon} size={16} />
                <span data-locale-motion>{item.label}</span>
                {count ? <span className="v3-side-count">{count}</span> : null}
              </a>
            );
          })}
        </nav>
        {(["pin", "recent"] as const).map((group) => {
          const label = group === "pin" ? "Pin" : t("最近对话");
          const items = sessions.filter((session) => Boolean(session.pinned) === (group === "pin"));
          if (group === "pin" && items.length === 0) return null;
          const collapsed = collapsedGroups[group];
          const id = `${groupId}-${group}`;
          return (
            <section className="v3-side-session-group" key={group} aria-label={label}>
              <div className="v3-side-section">
                <span data-locale-motion>{label}</span>
                <button type="button" aria-label={t(collapsed ? "展开{value0}" : "收起{value0}", { value0: label })} aria-expanded={!collapsed} aria-controls={id} onClick={() => toggleGroup(group)}>
                  <Icon name={collapsed ? "chev" : "chevd"} size={13} />
                </button>
              </div>
              <div id={id} className="v3-side-sessions" hidden={collapsed}>
                {status === "loading" && <p className="v3-side-muted">{t("正在读取对话…")}</p>}
                {status === "error" && <p className="v3-side-muted">{t("对话列表暂时无法读取")}</p>}
                {status === "ready" && items.length === 0 && <p className="v3-side-muted">{t(group === "pin" ? "还没有 Pin 对话" : "还没有对话")}</p>}
                {(group === "pin" ? items : items.slice(0, 30)).map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={active === "home" && session.id === activeSessionId}
                    onSelect={() => {
                      if (onSelectSession) onSelectSession(session.id);
                      else navigateTo(assistantPath(session.id));
                      onNavigate?.();
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="v3-side-foot">
        {/* 账号与设置的唯一入口：点击头像进入（原来单独的「设置」行与它重复，已删除） */}
        <a href="/account" className={`v3-side-user${active === "account" ? " is-active" : ""}`} aria-current={active === "account" ? "page" : undefined} onClick={(event) => go(event, "/account", onNavigate)} aria-label={t("打开账号设置，当前账号：{value0}", { value0: displayName })}>
          <Avatar name={displayName} src={user?.avatar_url} size={36} />
          <span style={{ minWidth: 0 }}>
            <strong>{user?.nickname || t("未设置昵称")}</strong>
            <small>{user?.email || t("微信登录")}</small>
          </span>
        </a>
      </div>
    </aside>
  );
}

// 对话行：悬停出现 ⋯，支持 Pin、重命名与删除。
function SessionRow({ session, active, onSelect }: { session: AgentSession; active: boolean; onSelect: () => void }) {
  useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pinError, setPinError] = useState(false);
  const setPinned = useSessionStore((state) => state.setPinned);
  const rename = useSessionStore((state) => state.rename);
  const destroy = useSessionStore((state) => state.destroy);
  const running = useSessionStore((state) => state.runningIds.includes(session.id));
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  const saveRename = async () => {
    const title = draft.trim();
    setRenaming(false);
    if (!title || title === session.title) return;
    try {
      await rename(session.id, title);
    } catch {
      setDraft(session.title);
    }
  };

  if (renaming) {
    return (
      <form className="v3-side-rename" onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
        <input
          ref={inputRef}
          aria-label={t("重命名对话 {value0}", { value0: session.title })}
          maxLength={120}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void saveRename()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(session.title);
              setRenaming(false);
            }
          }}
        />
        <small className="v3-num">{t("Enter 保存 · Esc 取消")}</small>
      </form>
    );
  }

  return (
    <div className={`v3-side-session${active ? " is-active" : ""}`}>
      <button type="button" className="v3-side-session-open" title={session.title} onClick={onSelect} aria-current={active ? "page" : undefined}>
        {session.title}
      </button>
      <button
        ref={moreRef}
        type="button"
        className="v3-side-more"
        aria-label={t("{value0} 的更多操作", { value0: session.title })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Icon name="more" size={16} />
      </button>
      <Menu
        anchorRef={moreRef}
        open={menuOpen}
        onClose={closeMenu}
        width={148}
        label={t("{value0} 的操作菜单", { value0: session.title })}
        placement="bottom-start"
        items={[
          { label: t(session.pinned ? "取消 Pin" : "Pin"), icon: "thumbtack", disabled: busy, onSelect: async () => {
            setBusy(true);
            setPinError(false);
            try { await setPinned(session.id, !session.pinned); }
            catch { setPinError(true); }
            finally { setBusy(false); }
          } },
          { label: t("重命名"), icon: "edit", onSelect: () => { setDraft(session.title); setRenaming(true); } },
          { kind: "separator" },
          {
            label: t("删除"),
            icon: "trash",
            danger: true,
            disabled: running,
            title: running ? t("请先停止正在生成的回答") : undefined,
            onSelect: () => setConfirming(true),
          },
        ]}
      />
      <MotionPresence>{pinError && <Toast title={t("Pin 状态保存失败，请重试")} kind="error" onDismiss={() => setPinError(false)} />}</MotionPresence>
      <MotionPresence>{confirming && (
        <ConfirmDialog
          title={t("删除这条对话？")}
          description={<>「{session.title}{t("」及其中的全部消息将被永久删除。")}<br />{t("此操作无法撤销。")}</>}
          art={<DeleteSessionArt />}
          confirmLabel={t("删除")}
          busyLabel={t("正在删除…")}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await destroy(session.id);
              setConfirming(false);
              if (active) {
                rememberAssistantSession(null);
                useActiveSessionStore.getState().setActive(null);
                navigateTo(assistantPath(), { replace: true });
              }
            } finally {
              setBusy(false);
            }
          }}
        />
      )}</MotionPresence>
    </div>
  );
}

// 窗口外壳：左侧栏 + 右侧白色内容卡。bare 用于编辑器、分享页等不带侧栏的整窗页面。
export function V3Shell({
  active,
  children,
  bare = false,
  onSelectSession,
  contentClassName = "",
  scroll = true,
}: {
  active: V3Section;
  children: ReactNode;
  bare?: boolean;
  onSelectSession?: (sessionId: string) => void;
  contentClassName?: string;
  scroll?: boolean;
}) {
  useLocale();
  const [compact, setCompact] = useState(() => window.innerWidth < 1024);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 1023px)");
    const update = () => {
      const next = media?.matches ?? window.innerWidth < 1024;
      setCompact(next);
      if (!next) setNavigationOpen(false);
    };
    update();
    if (media) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const closeNavigation = () => {
    setNavigationOpen(false);
    // 等待背景解除 inert 后恢复焦点；浏览器会在打开抽屉时移走原触发器的焦点。
    requestAnimationFrame(() => navigationTriggerRef.current?.focus());
  };
  const sidebar = <V3Sidebar active={active} onSelectSession={onSelectSession} onNavigate={compact ? closeNavigation : undefined} />;
  return (
    <div className={`v3 v3-window${bare ? " is-bare" : ""}`} data-ui-theme="light">
      {!bare && !compact && sidebar}
      {!bare && compact && <>
        <header className="v3-mobile-head" inert={navigationOpen || undefined}>
          <button ref={navigationTriggerRef} type="button" aria-label={t("打开工作区导航")} aria-haspopup="dialog" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Icon name="menu" size={20} /></button>
          <span data-locale-motion>{NAV.find((item) => item.key === active)?.label ?? (active === "account" ? t("账号设置") : t("工作区"))}</span>
        </header>
        {navigationOpen && <Dialog width={264} label={t("工作区导航")} className="v3-mobile-nav" showCloseButton={false} onClose={closeNavigation}>{sidebar}</Dialog>}
      </>}
      <main className={`v3-content ${contentClassName}`} inert={!bare && compact && navigationOpen || undefined}>
        {scroll ? <div className="v3-content-scroll" data-locale-scroll>{children}</div> : children}
      </main>
    </div>
  );
}
