import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Command,
  Copy,
  FileText,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Brand } from "../../components/ds";
import { LogsPanel, ModelsPanel } from "./AdminLlmPanels";
import "./admin.css";

import {
  api,
  User,
  ApiRequestError,
  type AdminStatsResponse,
  type AdminUserListResponse,
  type AdminUserDetail as AdminUserDetailType,
} from "../../api/client";
type AdminSection = "overview" | "users" | "models" | "logs";

function initialAdminSection(): AdminSection {
  const path = window.location.pathname;
  if (path.startsWith("/admin/users")) return "users";
  if (path.startsWith("/admin/llm")) return "models";
  if (path.startsWith("/admin/logs")) return "logs";
  return "overview";
}

const adminSectionPaths: Record<AdminSection, string> = {
  overview: "/admin",
  users: "/admin/users",
  models: "/admin/llm/models",
  logs: "/admin/logs",
};

const spring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 38,
  mass: 0.8,
};
const gentleSpring = {
  type: "spring" as const,
  stiffness: 310,
  damping: 34,
  mass: 0.9,
};

const usersData = [
  {
    id: "100028",
    name: "周予安",
    email: "zhou@sample.cn",
    role: "普通用户",
    status: "启用",
    resumes: 5,
    calls: 182,
    cost: "$0.84",
    login: "8 分钟前",
  },
  {
    id: "100027",
    name: "林嘉禾",
    email: "lin@sample.cn",
    role: "普通用户",
    status: "启用",
    resumes: 2,
    calls: 64,
    cost: "$0.29",
    login: "1 小时前",
  },
  {
    id: "100026",
    name: "陈听澜",
    email: "chen@sample.cn",
    role: "管理员",
    status: "启用",
    resumes: 8,
    calls: 341,
    cost: "$1.62",
    login: "今天 09:42",
  },
  {
    id: "100025",
    name: "江知夏",
    email: "jiang@sample.cn",
    role: "普通用户",
    status: "禁用",
    resumes: 1,
    calls: 12,
    cost: "$0.06",
    login: "7 月 24 日",
  },
];

const overviewActivityData = [
  {
    time: "10:42:18",
    level: "INFO",
    event: "LLM 调用完成",
    detail: "gpt-4.1-mini · 1.2s · call_8f3a2c",
    tone: "ok",
  },
  {
    time: "10:40:05",
    level: "INFO",
    event: "用户登录成功",
    detail: "user_100028 · Web",
    tone: "ok",
  },
  {
    time: "10:36:42",
    level: "WARN",
    event: "模型连接测试失败",
    detail: "claude-sonnet-4 · 凭据不可用",
    tone: "warn",
  },
  {
    time: "10:31:09",
    level: "INFO",
    event: "简历导出完成",
    detail: "resume_7812 · PDF",
    tone: "ok",
  },
];

export function AdminApp() {
  const [user, setUser] = useState<User | null | "loading">("loading");

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null));
  }, []);

  const handleLogin = useCallback(
    (loggedInUser: User) => setUser(loggedInUser),
    [],
  );
  const handleLogout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <MotionConfig transition={spring} reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        {user === "loading" ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="admin-page-loading">
              <div className="loading-spinner" />
              <span>正在验证身份...</span>
            </div>
          </motion.div>
        ) : user ? (
          !user.is_admin ? (
            <motion.div
              key="forbidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <AdminForbidden />
            </motion.div>
          ) : (
            <motion.div
              key="workspace"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <AdminWorkspace
                user={user}
                onLogout={handleLogout}
                onSessionExpired={() => setUser(null)}
              />
            </motion.div>
          )
        ) : (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <AdminLogin onLogin={handleLogin} />
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

function AdminForbidden() {
  return (
    <main className="admin-login-shell">
      <motion.div
        className="admin-forbidden-card"
        initial={{ opacity: 0, scale: 0.975 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={gentleSpring}
      >
        <LockKeyhole size={48} />
        <h1>访问被拒绝</h1>
        <p>你没有访问管理后台的权限，请联系管理员。</p>
        <a href="/" className="admin-primary-button">
          返回首页
        </a>
      </motion.div>
    </main>
  );
}

function AdminLogin({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email.includes("@") || password.length < 8) {
      setError("请输入有效的管理员邮箱和至少 8 位密码。");
      return;
    }
    setLoading(true);
    try {
      const res = await api.adminLogin(email, password);
      onLogin(res.user);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.message === "INVALID_CREDENTIALS") {
          setError("邮箱或密码错误");
        } else if (err.message === "FORBIDDEN") {
          setError("该账号不是管理员");
        } else {
          setError("登录失败，请稍后重试");
        }
      } else {
        setError("网络异常，请检查连接");
      }
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = () => {
    setEmail("admin@linkcv.demo");
    setPassword("linkcv-demo");
    setError("");
  };

  return (
    <main className="admin-login-shell">
      <motion.div
        className="admin-login-frame"
        initial={{ opacity: 0, scale: 0.975 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={gentleSpring}
      >
        <section className="admin-login-context" aria-label="管理台范围">
          <a className="admin-wordmark" href="/" aria-label="返回 LinkCV">
            <Brand />
          </a>
          <motion.div
            className="login-context-copy"
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={gentleSpring}
          >
            <span className="login-access-label">
              <ShieldCheck size={14} /> INTERNAL ACCESS
            </span>
            <h1>
              欢迎回到
              <br />
              LinkCV 管理台
            </h1>
            <p>在一个视图中掌握服务状态，处理真正需要关注的事项。</p>
            <ul className="login-scope-list">
              <li>
                <Users size={16} />
                <span>用户与权限</span>
              </li>
              <li>
                <Bot size={16} />
                <span>模型与调用</span>
              </li>
              <li>
                <Activity size={16} />
                <span>运行与日志</span>
              </li>
            </ul>
          </motion.div>
          <div className="login-context-status">
            <span aria-hidden="true" />
            安全连接已就绪
          </div>
        </section>

        <section className="admin-login-form-side">
          <motion.div
            className="admin-login-card"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={gentleSpring}
          >
            <div className="login-form-meta">
              <span>管理控制台</span>
              <span>演示环境</span>
            </div>
            <div className="login-card-heading">
              <span className="mobile-admin-mark">
                <ShieldCheck size={18} />
              </span>
              <h2>安全登录</h2>
              <p>使用你的管理员凭据继续</p>
            </div>
            <form className="admin-login-form" onSubmit={submit}>
              <label>
                <span>管理员邮箱</span>
                <div className="field-wrap">
                  <UserRound size={17} />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="admin@company.com"
                    autoComplete="username"
                    required
                  />
                </div>
              </label>
              <label>
                <span>密码</span>
                <div className="field-wrap">
                  <LockKeyhole size={17} />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="至少 8 位"
                    autoComplete="current-password"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    className="field-action"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={`${showPassword ? "隐藏" : "显示"}密码`}
                  >
                    {showPassword ? "隐藏" : "显示"}
                  </button>
                </div>
              </label>
              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    className="admin-form-error"
                    role="alert"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                  >
                    <CircleAlert size={15} />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button
                className="admin-login-submit"
                type="submit"
                disabled={loading}
                whileTap={{ scale: 0.97 }}
              >
                <KeyRound size={17} />
                <span>{loading ? "登录中..." : "进入管理台"}</span>
                <ArrowRight size={17} />
              </motion.button>
            </form>
            <button
              className="demo-login-button"
              type="button"
              onClick={fillDemo}
              aria-label="填入演示账号"
            >
              <span>没有管理员凭据？</span> 使用演示账号{" "}
              <ArrowRight size={14} />
            </button>
            <div className="login-security-note">
              <ShieldCheck size={16} />
              <span>登录活动受保护并记录在审计日志中。</span>
            </div>
          </motion.div>
        </section>
      </motion.div>
    </main>
  );
}

function AdminWorkspace({
  user,
  onLogout,
  onSessionExpired,
}: {
  user: User;
  onLogout: () => void;
  onSessionExpired: () => void;
}) {
  const [section, setSection] = useState<AdminSection>(initialAdminSection);
  const [mobileNav, setMobileNav] = useState(false);
  const [drawer, setDrawer] = useState<null | "user" | "alerts">(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const navigate = (next: AdminSection) => {
    setSection(next);
    setMobileNav(false);
    window.history.replaceState(null, "", adminSectionPaths[next]);
  };

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const openUserDetail = (userId: string) => {
    setSelectedUserId(userId);
    setDrawer("user");
  };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <SidebarContent
          section={section}
          navigate={navigate}
          onLogout={onLogout}
        />
      </aside>
      <AnimatePresence>
        {mobileNav && (
          <motion.div
            className="mobile-nav-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileNav(false)}
          >
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              onClick={(event) => event.stopPropagation()}
            >
              <SidebarContent
                section={section}
                navigate={navigate}
                onLogout={onLogout}
              />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="topbar-left">
            <motion.button
              className="mobile-menu-button"
              whileTap={{ scale: 0.94 }}
              onClick={() => setMobileNav(true)}
              aria-label="打开导航"
            >
              <Menu size={20} />
            </motion.button>
            <div className="admin-breadcrumb">
              <span>管理台</span>
              <ChevronRight size={14} />
              <strong>{sectionLabels[section]}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="command-search">
              <Search size={15} />
              <span>搜索</span>
              <kbd>
                <Command size={11} /> K
              </kbd>
            </div>
            <motion.button
              className="topbar-icon-button"
              whileTap={{ scale: 0.92 }}
              onClick={() => setDrawer("alerts")}
              aria-label="查看通知"
            >
              <Bell size={18} />
              <i />
            </motion.button>
            <button
              className="admin-account-button"
              onClick={() => openUserDetail(user.id)}
            >
              <span>{user.nickname[0]}</span>
              <div>
                <strong>{user.nickname}</strong>
                <small>超级管理员</small>
              </div>
            </button>
          </div>
        </header>

        <div className="admin-content">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={gentleSpring}
            >
              {section === "overview" && (
                <Overview user={user} navigate={navigate} />
              )}
              {section === "users" && (
                <UsersPanel onSelectUser={openUserDetail} notify={notify} />
              )}
              {section === "models" && (
                <ModelsPanel
                  notify={notify}
                  onSessionExpired={onSessionExpired}
                />
              )}
              {section === "logs" && (
                <LogsPanel
                  notify={notify}
                  onSessionExpired={onSessionExpired}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {drawer && (
          <AdminDrawer
            kind={drawer}
            currentUser={user}
            selectedUserId={selectedUserId}
            close={() => {
              setDrawer(null);
              setSelectedUserId(null);
            }}
            notify={notify}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="admin-toast"
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
          >
            <Check size={16} />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const sectionLabels: Record<AdminSection, string> = {
  overview: "概览",
  users: "用户管理",
  models: "模型配置",
  logs: "LLM 调用日志",
};

function SidebarContent({
  section,
  navigate,
  onLogout,
}: {
  section: AdminSection;
  navigate: (section: AdminSection) => void;
  onLogout: () => void;
}) {
  const items: Array<{
    id: AdminSection;
    label: string;
    icon: typeof LayoutDashboard;
  }> = [
    { id: "overview", label: "概览", icon: LayoutDashboard },
    { id: "users", label: "用户管理", icon: Users },
    { id: "models", label: "模型配置", icon: Bot },
    { id: "logs", label: "LLM 调用日志", icon: Activity },
  ];
  return (
    <>
      <a className="sidebar-brand" href="/admin">
        <Brand />
        <small>ADMIN</small>
      </a>
      <nav className="admin-nav" aria-label="管理端导航">
        <p>工作区</p>
        {items.map((item) => (
          <motion.button
            key={item.id}
            className={section === item.id ? "active" : ""}
            onClick={() => navigate(item.id)}
            whileTap={{ scale: 0.97 }}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
            {section === item.id && (
              <motion.i layoutId="admin-active-nav" transition={spring} />
            )}
          </motion.button>
        ))}
      </nav>
      <div className="sidebar-health">
        <div>
          <span className="health-dot" />
          <strong>服务运行正常</strong>
        </div>
        <p>最后检查 1 分钟前</p>
      </div>
      <div className="sidebar-bottom">
        <button>
          <Settings2 size={17} />
          系统设置
        </button>
        <button onClick={onLogout}>
          <LogOut size={17} />
          退出登录
        </button>
      </div>
    </>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="admin-page-heading">
      <div>
        <span className="page-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

function Overview({
  user,
  navigate,
}: {
  user: User;
  navigate: (section: AdminSection) => void;
}) {
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    setStatsLoading(true);
    api
      .adminStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, []);

  const displayValue = (
    val: string | number | undefined | null,
    fallback = "—",
  ): string => {
    if (val === undefined || val === null) return fallback;
    if (typeof val === "number") return val.toLocaleString();
    return val;
  };

  const metrics = statsLoading
    ? null
    : [
        {
          label: "用户总数",
          value: displayValue(stats?.total_users),
          delta: null,
          note: "注册用户",
          icon: Users,
        },
        {
          label: "近 7 日登录用户",
          value: displayValue(stats?.active_users_7d),
          delta: null,
          note: "成功登录口径",
          icon: Activity,
        },
        {
          label: "今日 LLM 调用",
          value: displayValue(stats?.llm_calls_today),
          delta: null,
          note: "统计接入后可用",
          icon: Bot,
        },
        {
          label: "简历总数",
          value: displayValue(stats?.total_resumes),
          delta: null,
          note: "全部用户",
          icon: FileText,
        },
      ];
  return (
    <>
      <PageHeading
        eyebrow="管理控制台"
        title={`早上好，${user.nickname}`}
        description="这是 LinkCV 当前的运行状态与用户情况。"
        action={
          <motion.button
            className="admin-primary-button"
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate("models")}
          >
            <Plus size={16} />
            新增模型
          </motion.button>
        }
      />
      {metrics && (
        <section className="metrics-grid" aria-label="核心指标">
          {metrics.map((metric, index) => (
            <motion.article
              key={metric.label}
              className="metric-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...gentleSpring, delay: index * 0.035 }}
            >
              <div className="metric-card-top">
                <span>
                  <metric.icon size={17} />
                </span>
              </div>
              <p>{metric.label}</p>
              <strong>{metric.value}</strong>
              <footer>{metric.note}</footer>
            </motion.article>
          ))}
        </section>
      )}
      <div className="overview-grid">
        <section className="admin-surface activity-surface">
          <div className="surface-heading">
            <div>
              <h2>实时动态</h2>
              <p>最近发生在系统中的关键事件</p>
            </div>
            <button onClick={() => navigate("logs")}>
              查看全部 <ArrowRight size={15} />
            </button>
          </div>
          <div className="activity-list">
            {overviewActivityData.map((log) => (
              <div className="activity-row" key={log.time + log.event}>
                <span className={`event-icon ${log.tone}`}>
                  <Activity size={15} />
                </span>
                <div>
                  <strong>{log.event}</strong>
                  <p>{log.detail}</p>
                </div>
                <time>{log.time}</time>
              </div>
            ))}
          </div>
        </section>
        <aside className="overview-side-stack">
          <section className="admin-surface attention-surface">
            <div className="surface-heading">
              <div>
                <h2>需要关注</h2>
                <p>待处理事项</p>
              </div>
            </div>
            <button
              className="attention-item"
              onClick={() => navigate("models")}
            >
              <span className="warn-icon">
                <CircleAlert size={17} />
              </span>
              <div>
                <strong>备用模型尚未配置密钥</strong>
                <p>deepseek-chat 无法参与调用</p>
              </div>
              <ChevronRight size={16} />
            </button>
            <button
              className="attention-item"
              onClick={() => navigate("users")}
            >
              <span className="neutral-icon">
                <Clock3 size={17} />
              </span>
              <div>
                <strong>前往用户管理</strong>
                <p>查看和管理所有用户账号</p>
              </div>
              <ChevronRight size={16} />
            </button>
          </section>
          <section className="admin-surface model-health">
            <div className="surface-heading">
              <div>
                <h2>模型健康度</h2>
                <p>最近 24 小时</p>
              </div>
              <span className="healthy-pill">
                <span /> 正常
              </span>
            </div>
            <dl>
              <div>
                <dt>用户总数</dt>
                <dd>{displayValue(stats?.total_users)}</dd>
              </div>
              <div>
                <dt>简历总数</dt>
                <dd>{displayValue(stats?.total_resumes)}</dd>
              </div>
              <div>
                <dt>活跃用户 7d</dt>
                <dd>{displayValue(stats?.active_users_7d)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

function UsersPanel({
  onSelectUser,
  notify,
}: {
  onSelectUser: (userId: string) => void;
  notify: (message: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [size] = useState(20);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [data, setData] = useState<AdminUserListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    api
      .adminListUsers({
        page,
        size,
        q: query || undefined,
        status: statusFilter || undefined,
        role: roleFilter || undefined,
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [page, size, query, statusFilter, roleFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const resetFilters = () => {
    setQuery("");
    setStatusFilter("");
    setRoleFilter("");
    setPage(1);
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).then(
      () => notify(`已复制用户 ID ${id}`),
      () => notify("复制失败"),
    );
  };

  return (
    <>
      <PageHeading
        eyebrow="账号与权限"
        title="用户管理"
        description="检索用户，查看账号与使用情况，并管理访问权限。"
        action={
          <button
            className="admin-secondary-button"
            onClick={() => notify("导出功能待接入")}
          >
            导出数据
          </button>
        }
      />
      <section className="admin-surface table-surface">
        <div className="table-tools">
          <label className="table-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="搜索用户 ID、邮箱或昵称"
            />
          </label>
          <div>
            <select
              aria-label="账号状态"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              <option value="enabled">启用</option>
              <option value="disabled">禁用</option>
            </select>
            <select
              aria-label="用户角色"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部角色</option>
              <option value="admin">管理员</option>
              <option value="user">普通用户</option>
            </select>
            {(query || statusFilter || roleFilter) && (
              <button onClick={resetFilters}>
                <X size={16} />
                清除筛选
              </button>
            )}
          </div>
        </div>
        <div className="admin-table-wrap">
          {loading && <div className="table-status-row">加载中...</div>}
          {!loading && error && (
            <div className="table-status-row">
              加载失败
              <button onClick={load} style={{ marginLeft: 8 }}>
                重试
              </button>
            </div>
          )}
          {!loading && !error && data && data.items.length === 0 && (
            <div className="table-status-row">
              {query || statusFilter || roleFilter
                ? "没有匹配的用户"
                : "暂无用户数据"}
            </div>
          )}
          {data && data.items.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>用户 ID</th>
                  <th>角色 / 状态</th>
                  <th>简历</th>
                  <th>注册时间</th>
                  <th>最近登录</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <button
                        className="user-cell"
                        onClick={() => onSelectUser(u.id)}
                      >
                        <span>{u.nickname.slice(0, 1)}</span>
                        <div>
                          <strong>{u.nickname}</strong>
                          <small>{u.email}</small>
                        </div>
                      </button>
                    </td>
                    <td>
                      <button className="copy-id" onClick={() => copyId(u.id)}>
                        {u.id}
                        <Copy size={13} />
                      </button>
                    </td>
                    <td>
                      <div className="status-stack">
                        <span>{u.is_admin ? "管理员" : "普通用户"}</span>
                        <small
                          className={u.status === 1 ? "enabled" : "disabled"}
                        >
                          {u.status === 1 ? "启用" : "禁用"}
                        </small>
                      </div>
                    </td>
                    <td>{u.resume_count}</td>
                    <td>
                      {u.created_at
                        ? new Date(u.created_at).toLocaleDateString("zh-CN")
                        : "—"}
                    </td>
                    <td>
                      {u.last_login_at
                        ? new Date(u.last_login_at).toLocaleString("zh-CN")
                        : "从未登录"}
                    </td>
                    <td>
                      <button
                        className="row-action"
                        aria-label={`更多操作 ${u.nickname}`}
                        onClick={() => onSelectUser(u.id)}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="table-footer">
          {data && (
            <span>
              共 {data.total.toLocaleString()} 位用户 · 第 {data.page}/
              {totalPages} 页
            </span>
          )}
          <div>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        </footer>
      </section>
    </>
  );
}

function AdminDrawer({
  kind,
  currentUser,
  selectedUserId,
  close,
  notify,
}: {
  kind: "user" | "alerts";
  currentUser: User;
  selectedUserId: string | null;
  close: () => void;
  notify: (message: string) => void;
}) {
  return (
    <div className="drawer-layer" onClick={close}>
      <motion.aside
        className="admin-drawer"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={gentleSpring}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="page-eyebrow">
              {kind === "alerts" ? "通知中心" : "用户详情"}
            </span>
            <h2>{kind === "alerts" ? "待处理通知" : "用户详情"}</h2>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={close}
            aria-label="关闭"
          >
            <X size={19} />
          </motion.button>
        </header>
        {kind === "alerts" ? (
          <Alerts />
        ) : (
          <UserDetail
            userId={selectedUserId}
            currentUser={currentUser}
            notify={notify}
          />
        )}
      </motion.aside>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <div className="drawer-layer" onClick={onCancel} style={{ zIndex: 110 }}>
      <motion.div
        className="confirm-dialog"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--neutral-1)",
          borderRadius: 12,
          padding: 24,
          maxWidth: 400,
          width: "90%",
          margin: "auto",
          boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
        }}
      >
        <h3 style={{ margin: "0 0 8px" }}>{title}</h3>
        <p style={{ margin: "0 0 20px", color: "var(--neutral-11)" }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            className="admin-secondary-button"
            onClick={onCancel}
            disabled={loading}
          >
            取消
          </button>
          <motion.button
            className="admin-danger-button"
            whileTap={{ scale: 0.97 }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "处理中..." : confirmLabel}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
function UserDetail({
  userId,
  currentUser,
  notify,
}: {
  userId: string | null;
  currentUser: User;
  notify: (message: string) => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetailType | null | "loading">(
    "loading",
  );
  const [confirmAction, setConfirmAction] = useState<
    "disable" | "enable" | null
  >(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setDetail(null);
      return;
    }
    setDetail("loading");
    api
      .adminGetUser(userId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [userId]);

  const handleStatusAction = async () => {
    if (!userId || !confirmAction) return;
    setActionLoading(true);
    try {
      const res = await api.adminUpdateUserStatus(userId, confirmAction);
      notify(confirmAction === "disable" ? "账号已禁用" : "账号已启用");
      setConfirmAction(null);
      // Reload detail
      const updated = await api.adminGetUser(userId);
      setDetail(updated);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.message === "CANNOT_SELF_DISABLE")
          notify("不能禁用你自己的账号");
        else if (err.message === "CANNOT_DISABLE_LAST_ADMIN")
          notify("不能禁用最后一个管理员");
        else notify("操作失败，请重试");
      } else {
        notify("网络异常");
      }
    } finally {
      setActionLoading(false);
    }
  };

  if (detail === "loading") {
    return (
      <div className="user-detail" style={{ padding: 24, textAlign: "center" }}>
        加载中...
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="user-detail" style={{ padding: 24, textAlign: "center" }}>
        无法加载用户信息
      </div>
    );
  }

  const isSelf = currentUser.id === detail.id;
  const isLastAdmin = detail.is_admin && detail.status === 1;

  return (
    <div className="user-detail">
      <div className="user-detail-hero">
        <span>{detail.nickname[0]}</span>
        <div>
          <strong>{detail.nickname}</strong>
          <p>{detail.email}</p>
          <small>
            {detail.is_admin ? "管理员" : "普通用户"} ·{" "}
            {detail.status === 1 ? "启用" : "禁用"}
          </small>
        </div>
      </div>
      <dl>
        <div>
          <dt>用户 ID</dt>
          <dd>{detail.id}</dd>
        </div>
        <div>
          <dt>注册时间</dt>
          <dd>
            {detail.created_at
              ? new Date(detail.created_at).toLocaleDateString("zh-CN")
              : "—"}
          </dd>
        </div>
        <div>
          <dt>最近登录</dt>
          <dd>
            {detail.last_login_at
              ? new Date(detail.last_login_at).toLocaleString("zh-CN")
              : "从未登录"}
          </dd>
        </div>
      </dl>
      <section>
        <h3>使用概况</h3>
        <div className="detail-stats">
          <div>
            <strong>{detail.resume_count}</strong>
            <span>简历</span>
          </div>
          <div>
            <strong>{detail.llm_call_count}</strong>
            <span>LLM 调用</span>
          </div>
          <div>
            <strong>{detail.llm_call_count > 0 ? "—" : "0"}</strong>
            <span>
              估算费用 <small title="数据待接入">ⓘ</small>
            </span>
          </div>
        </div>
      </section>
      {detail.status === 1 ? (
        <button
          className="danger-zone-button"
          onClick={() => setConfirmAction("disable")}
          disabled={isSelf || isLastAdmin}
          title={
            isSelf
              ? "不能禁用你自己的账号"
              : isLastAdmin
                ? "不能禁用最后一个管理员"
                : undefined
          }
        >
          {isSelf
            ? "不能禁用自己"
            : isLastAdmin
              ? "最后一个管理员"
              : "禁用此账号"}
        </button>
      ) : (
        <button
          className="admin-primary-button"
          style={{ width: "100%", marginTop: 16 }}
          onClick={() => setConfirmAction("enable")}
        >
          启用此账号
        </button>
      )}

      <AnimatePresence>
        {confirmAction && (
          <ConfirmDialog
            title={
              confirmAction === "disable" ? "确认禁用账号" : "确认启用账号"
            }
            message={
              confirmAction === "disable"
                ? `确定要禁用 ${detail.nickname}（${detail.email}）吗？该用户的所有活跃会话将被立即撤销。`
                : `确定要启用 ${detail.nickname}（${detail.email}）吗？该用户将可以重新登录。`
            }
            confirmLabel={confirmAction === "disable" ? "禁用" : "启用"}
            onConfirm={handleStatusAction}
            onCancel={() => setConfirmAction(null)}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Alerts() {
  return (
    <div className="drawer-alerts">
      <div>
        <span className="warn-icon">
          <CircleAlert size={17} />
        </span>
        <div>
          <strong>备用模型尚未配置密钥</strong>
          <p>deepseek-chat 当前无法参与故障转移。</p>
          <time>12 分钟前</time>
        </div>
      </div>
      <div>
        <span className="neutral-icon">
          <Users size={17} />
        </span>
        <div>
          <strong>本周新增用户增长 12.4%</strong>
          <p>较上一周期增加 28 位用户。</p>
          <time>1 小时前</time>
        </div>
      </div>
    </div>
  );
}
