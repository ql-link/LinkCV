import { FormEvent, useMemo, useState } from "react";
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
  TestTube2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Brand } from "../../components/ds";
import "./admin.css";

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

const spring = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.8 };
const gentleSpring = { type: "spring" as const, stiffness: 310, damping: 34, mass: 0.9 };

const usersData = [
  { id: "100028", name: "周予安", email: "zhou@sample.cn", role: "普通用户", status: "启用", resumes: 5, calls: 182, cost: "$0.84", login: "8 分钟前" },
  { id: "100027", name: "林嘉禾", email: "lin@sample.cn", role: "普通用户", status: "启用", resumes: 2, calls: 64, cost: "$0.29", login: "1 小时前" },
  { id: "100026", name: "陈听澜", email: "chen@sample.cn", role: "管理员", status: "启用", resumes: 8, calls: 341, cost: "$1.62", login: "今天 09:42" },
  { id: "100025", name: "江知夏", email: "jiang@sample.cn", role: "普通用户", status: "禁用", resumes: 1, calls: 12, cost: "$0.06", login: "7 月 24 日" },
];

const modelData = [
  { name: "openai/gpt-4.1-mini", base: "供应商默认", priority: 10, input: "$0.40", output: "$1.60", enabled: true, keyConfigured: true, tested: "3 分钟前" },
  { name: "anthropic/claude-sonnet-4", base: "https://api.anthropic.com", priority: 20, input: "$3.00", output: "$15.00", enabled: true, keyConfigured: true, tested: "昨天 18:24" },
  { name: "deepseek/deepseek-chat", base: "https://api.deepseek.com", priority: 30, input: "$0.27", output: "$1.10", enabled: false, keyConfigured: false, tested: "尚未测试" },
];

const logsData = [
  { time: "10:42:18", level: "INFO", event: "LLM 调用完成", detail: "gpt-4.1-mini · 1.2s · call_8f3a2c", tone: "ok" },
  { time: "10:40:05", level: "INFO", event: "用户登录成功", detail: "user_100028 · Web", tone: "ok" },
  { time: "10:36:42", level: "WARN", event: "模型连接重试", detail: "claude-sonnet-4 · 第 2 次", tone: "warn" },
  { time: "10:31:09", level: "INFO", event: "简历导出完成", detail: "resume_7812 · PDF", tone: "ok" },
];

export function AdminApp() {
  const [signedIn, setSignedIn] = useState(false);

  return (
    <MotionConfig transition={spring} reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        {signedIn ? (
          <motion.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AdminWorkspace onLogout={() => setSignedIn(false)} />
          </motion.div>
        ) : (
          <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AdminLogin onLogin={() => setSignedIn(true)} />
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email.includes("@") || password.length < 8) {
      setError("请输入有效的管理员邮箱和至少 8 位密码。");
      return;
    }
    onLogin();
  };

  const fillDemo = () => {
    setEmail("admin@linkcv.demo");
    setPassword("linkcv-demo");
    setError("");
  };

  return (
    <main className="admin-login-shell">
      <motion.div className="admin-login-frame" initial={{ opacity: 0, scale: 0.975 }} animate={{ opacity: 1, scale: 1 }} transition={gentleSpring}>
        <section className="admin-login-context" aria-label="管理台范围">
          <a className="admin-wordmark" href="/" aria-label="返回 LinkCV"><Brand /></a>
          <motion.div className="login-context-copy" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={gentleSpring}>
            <span className="login-access-label"><ShieldCheck size={14} /> INTERNAL ACCESS</span>
            <h1>欢迎回到<br />LinkCV 管理台</h1>
            <p>在一个视图中掌握服务状态，处理真正需要关注的事项。</p>
            <ul className="login-scope-list">
              <li><Users size={16} /><span>用户与权限</span></li>
              <li><Bot size={16} /><span>模型与调用</span></li>
              <li><Activity size={16} /><span>运行与日志</span></li>
            </ul>
          </motion.div>
          <div className="login-context-status"><span aria-hidden="true" />安全连接已就绪</div>
        </section>

        <section className="admin-login-form-side">
          <motion.div className="admin-login-card" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={gentleSpring}>
            <div className="login-form-meta">
              <span>管理控制台</span>
              <span>演示环境</span>
            </div>
            <div className="login-card-heading">
              <span className="mobile-admin-mark"><ShieldCheck size={18} /></span>
              <h2>安全登录</h2>
              <p>使用你的管理员凭据继续</p>
            </div>
            <form className="admin-login-form" onSubmit={submit}>
              <label>
                <span>管理员邮箱</span>
                <div className="field-wrap"><UserRound size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" autoComplete="username" required /></div>
              </label>
              <label>
                <span>密码</span>
                <div className="field-wrap"><LockKeyhole size={17} /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" autoComplete="current-password" minLength={8} required /><button type="button" className="field-action" onClick={() => setShowPassword((value) => !value)} aria-label={`${showPassword ? "隐藏" : "显示"}密码`}>{showPassword ? "隐藏" : "显示"}</button></div>
              </label>
              <AnimatePresence initial={false}>
                {error && <motion.div className="admin-form-error" role="alert" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}><CircleAlert size={15} />{error}</motion.div>}
              </AnimatePresence>
              <motion.button className="admin-login-submit" type="submit" whileTap={{ scale: 0.97 }}>
                <KeyRound size={17} />
                <span>进入管理台</span>
                <ArrowRight size={17} />
              </motion.button>
            </form>
            <button className="demo-login-button" type="button" onClick={fillDemo} aria-label="填入演示账号"><span>没有管理员凭据？</span> 使用演示账号 <ArrowRight size={14} /></button>
            <div className="login-security-note"><ShieldCheck size={16} /><span>登录活动受保护并记录在审计日志中。</span></div>
          </motion.div>
        </section>
      </motion.div>
    </main>
  );
}

function AdminWorkspace({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState<AdminSection>(initialAdminSection);
  const [mobileNav, setMobileNav] = useState(false);
  const [drawer, setDrawer] = useState<null | "user" | "model" | "alerts">(null);
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

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <SidebarContent section={section} navigate={navigate} onLogout={onLogout} />
      </aside>
      <AnimatePresence>{mobileNav && <motion.div className="mobile-nav-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNav(false)}><motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} onClick={(event) => event.stopPropagation()}><SidebarContent section={section} navigate={navigate} onLogout={onLogout} /></motion.aside></motion.div>}</AnimatePresence>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="topbar-left">
            <motion.button className="mobile-menu-button" whileTap={{ scale: 0.94 }} onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={20} /></motion.button>
            <div className="admin-breadcrumb"><span>管理台</span><ChevronRight size={14} /><strong>{sectionLabels[section]}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="command-search"><Search size={15} /><span>搜索</span><kbd><Command size={11} /> K</kbd></div>
            <motion.button className="topbar-icon-button" whileTap={{ scale: 0.92 }} onClick={() => setDrawer("alerts")} aria-label="查看通知"><Bell size={18} /><i /></motion.button>
            <button className="admin-account-button" onClick={() => setDrawer("user")}><span>陈</span><div><strong>陈听澜</strong><small>超级管理员</small></div></button>
          </div>
        </header>

        <div className="admin-content">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={section} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={gentleSpring}>
              {section === "overview" && <Overview navigate={navigate} openDrawer={setDrawer} />}
              {section === "users" && <UsersPanel openDrawer={() => setDrawer("user")} notify={notify} />}
              {section === "models" && <ModelsPanel openDrawer={() => setDrawer("model")} notify={notify} />}
              {section === "logs" && <LogsPanel />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>{drawer && <AdminDrawer kind={drawer} close={() => setDrawer(null)} notify={notify} />}</AnimatePresence>
      <AnimatePresence>{toast && <motion.div className="admin-toast" role="status" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}><Check size={16} />{toast}</motion.div>}</AnimatePresence>
    </div>
  );
}

const sectionLabels: Record<AdminSection, string> = { overview: "概览", users: "用户管理", models: "模型配置", logs: "系统日志" };

function SidebarContent({ section, navigate, onLogout }: { section: AdminSection; navigate: (section: AdminSection) => void; onLogout: () => void }) {
  const items: Array<{ id: AdminSection; label: string; icon: typeof LayoutDashboard }> = [
    { id: "overview", label: "概览", icon: LayoutDashboard },
    { id: "users", label: "用户管理", icon: Users },
    { id: "models", label: "模型配置", icon: Bot },
    { id: "logs", label: "系统日志", icon: Activity },
  ];
  return <>
    <a className="sidebar-brand" href="/admin"><Brand /><small>ADMIN</small></a>
    <nav className="admin-nav" aria-label="管理端导航">
      <p>工作区</p>
      {items.map((item) => <motion.button key={item.id} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)} whileTap={{ scale: 0.97 }}><item.icon size={18} /><span>{item.label}</span>{section === item.id && <motion.i layoutId="admin-active-nav" transition={spring} />}</motion.button>)}
    </nav>
    <div className="sidebar-health"><div><span className="health-dot" /><strong>服务运行正常</strong></div><p>最后检查 1 分钟前</p></div>
    <div className="sidebar-bottom"><button><Settings2 size={17} />系统设置</button><button onClick={onLogout}><LogOut size={17} />退出登录</button></div>
  </>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <header className="admin-page-heading"><div><span className="page-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

function Overview({ navigate, openDrawer }: { navigate: (section: AdminSection) => void; openDrawer: (drawer: "model") => void }) {
  const metrics = [
    { label: "用户总数", value: "1,284", delta: "+12.4%", note: "较上月", icon: Users },
    { label: "近 7 日登录用户", value: "468", delta: "+8.2%", note: "成功登录口径", icon: Activity },
    { label: "今日 LLM 调用", value: "3,204", delta: "+18.6%", note: "成功率 98.7%", icon: Bot },
    { label: "本月估算费用", value: "$184.32", delta: "62%", note: "预算使用", icon: FileText },
  ];
  return <>
    <PageHeading eyebrow="2026 年 7 月 27 日 · 星期一" title="早上好，陈听澜" description="这是 LinkCV 今天的运行状态与需要关注的事项。" action={<motion.button className="admin-primary-button" whileTap={{ scale: 0.97 }} onClick={() => openDrawer("model")}><Plus size={16} />新增模型</motion.button>} />
    <section className="metrics-grid" aria-label="核心指标">{metrics.map((metric, index) => <motion.article key={metric.label} className="metric-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...gentleSpring, delay: index * 0.035 }}><div className="metric-card-top"><span><metric.icon size={17} /></span><small>{metric.delta}</small></div><p>{metric.label}</p><strong>{metric.value}</strong><footer>{metric.note}</footer></motion.article>)}</section>
    <div className="overview-grid">
      <section className="admin-surface activity-surface"><div className="surface-heading"><div><h2>实时动态</h2><p>最近发生在系统中的关键事件</p></div><button onClick={() => navigate("logs")}>查看全部 <ArrowRight size={15} /></button></div><div className="activity-list">{logsData.map((log) => <div className="activity-row" key={log.time + log.event}><span className={`event-icon ${log.tone}`}><Activity size={15} /></span><div><strong>{log.event}</strong><p>{log.detail}</p></div><time>{log.time}</time></div>)}</div></section>
      <aside className="overview-side-stack">
        <section className="admin-surface attention-surface"><div className="surface-heading"><div><h2>需要关注</h2><p>2 项待处理</p></div></div><button className="attention-item" onClick={() => navigate("models")}><span className="warn-icon"><CircleAlert size={17} /></span><div><strong>备用模型尚未配置密钥</strong><p>deepseek-chat 无法参与调用</p></div><ChevronRight size={16} /></button><button className="attention-item" onClick={() => navigate("users")}><span className="neutral-icon"><Clock3 size={17} /></span><div><strong>18 位用户从未登录</strong><p>占全部用户的 1.4%</p></div><ChevronRight size={16} /></button></section>
        <section className="admin-surface model-health"><div className="surface-heading"><div><h2>模型健康度</h2><p>最近 24 小时</p></div><span className="healthy-pill"><span /> 正常</span></div><dl><div><dt>成功率</dt><dd>98.7%</dd></div><div><dt>P95 延迟</dt><dd>2.4 s</dd></div><div><dt>可用模型</dt><dd>2 / 3</dd></div></dl></section>
      </aside>
    </div>
  </>;
}

function UsersPanel({ openDrawer, notify }: { openDrawer: () => void; notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const visibleUsers = useMemo(() => usersData.filter((user) => `${user.name}${user.email}${user.id}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return <>
    <PageHeading eyebrow="账号与权限" title="用户管理" description="检索用户，查看账号与使用情况，并管理访问权限。" action={<button className="admin-secondary-button" onClick={() => notify("用户数据已导出（演示）")}>导出数据</button>} />
    <section className="mini-metrics"><div><span>用户总数</span><strong>1,284</strong></div><div><span>启用用户</span><strong>1,248</strong></div><div><span>今日新增</span><strong>18</strong></div><div><span>从未登录</span><strong>18</strong></div></section>
    <section className="admin-surface table-surface"><div className="table-tools"><label className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户 ID、邮箱或昵称" /></label><div><select aria-label="账号状态"><option>全部状态</option><option>启用</option><option>禁用</option></select><select aria-label="用户角色"><option>全部角色</option><option>管理员</option><option>普通用户</option></select><button><Settings2 size={16} />筛选</button></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>用户</th><th>用户 ID</th><th>角色 / 状态</th><th>简历</th><th>LLM 调用 / 费用</th><th>最近登录</th><th /></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id}><td><button className="user-cell" onClick={openDrawer}><span>{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></button></td><td><button className="copy-id" onClick={() => notify(`已复制用户 ID ${user.id}`)}>{user.id}<Copy size={13} /></button></td><td><div className="status-stack"><span>{user.role}</span><small className={user.status === "启用" ? "enabled" : "disabled"}>{user.status}</small></div></td><td>{user.resumes}</td><td><strong className="table-strong">{user.calls}</strong><small className="table-sub">{user.cost}</small></td><td>{user.login}</td><td><button className="row-action" aria-label={`更多操作 ${user.name}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div><footer className="table-footer"><span>共 1,284 位用户 · 当前显示 {visibleUsers.length} 条</span><div><button disabled>上一页</button><button>下一页</button></div></footer></section>
  </>;
}

function ModelsPanel({ openDrawer, notify }: { openDrawer: () => void; notify: (message: string) => void }) {
  const [testing, setTesting] = useState("");
  const test = (name: string) => { setTesting(name); window.setTimeout(() => { setTesting(""); notify(`连接成功 · call_${Math.random().toString(16).slice(2, 8)}`); }, 800); };
  return <>
    <PageHeading eyebrow="AI 基础设施" title="模型配置" description="配置业务调用模型、主备顺序与成本，无需修改环境变量。" action={<motion.button className="admin-primary-button" whileTap={{ scale: 0.97 }} onClick={openDrawer}><Plus size={16} />新增模型</motion.button>} />
    <section className="model-summary"><div><span className="model-summary-icon"><Bot size={20} /></span><div><strong>2 个模型正在参与业务调用</strong><p>按优先级自动切换，上次故障转移发生在 6 天前。</p></div></div><button onClick={() => notify("所有启用模型连接正常")}>测试全部连接 <TestTube2 size={15} /></button></section>
    <section className="models-list">{modelData.map((model, index) => <motion.article className="model-card" key={model.name} layout><div className="model-priority"><span>{index + 1}</span><small>{index === 0 ? "主模型" : index === 1 ? "备用" : "候选"}</small></div><div className="model-main"><div className="model-title-row"><h3>{model.name}</h3><span className={model.enabled ? "enabled-pill" : "disabled-pill"}>{model.enabled ? "启用" : "停用"}</span></div><p>{model.base}</p><div className="model-meta"><span className={model.keyConfigured ? "" : "missing-key"}><KeyRound size={14} />{model.keyConfigured ? "密钥已配置" : "密钥未配置"}</span><span>优先级 {model.priority}</span><span>输入 {model.input} / 输出 {model.output}</span><span>测试：{model.tested}</span></div></div><div className="model-actions"><button onClick={() => test(model.name)} disabled={testing === model.name}>{testing === model.name ? "测试中…" : "测试连接"}</button><button onClick={openDrawer}>编辑</button><button aria-label={`更多 ${model.name}`}><MoreHorizontal size={18} /></button></div></motion.article>)}</section>
  </>;
}

function LogsPanel() {
  return <>
    <PageHeading eyebrow="可观测性" title="系统日志" description="追踪关键业务事件与异常，只展示安全的结构化上下文。" action={<span className="live-status"><span /> 实时更新</span>} />
    <section className="admin-surface logs-surface"><div className="table-tools"><label className="table-search"><Search size={16} /><input placeholder="搜索事件、callId 或用户 ID" /></label><div><select aria-label="日志等级"><option>全部等级</option><option>INFO</option><option>WARN</option><option>ERROR</option></select><select aria-label="时间范围"><option>最近 1 小时</option><option>最近 24 小时</option><option>最近 7 天</option></select></div></div><div className="log-stream">{[...logsData, ...logsData].map((log, index) => <div className="log-row" key={`${log.time}-${index}`}><time>{log.time}</time><span className={`log-level ${log.tone}`}>{log.level}</span><strong>{log.event}</strong><p>{log.detail}</p><button aria-label="查看日志详情"><ChevronRight size={16} /></button></div>)}</div></section>
  </>;
}

function AdminDrawer({ kind, close, notify }: { kind: "user" | "model" | "alerts"; close: () => void; notify: (message: string) => void }) {
  return <div className="drawer-layer" onClick={close}><motion.aside className="admin-drawer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={gentleSpring} onClick={(event) => event.stopPropagation()}><header><div><span className="page-eyebrow">{kind === "model" ? "模型配置" : kind === "alerts" ? "通知中心" : "用户详情"}</span><h2>{kind === "model" ? "新增模型" : kind === "alerts" ? "待处理通知" : "陈听澜"}</h2></div><motion.button whileTap={{ scale: 0.9 }} onClick={close} aria-label="关闭"><X size={19} /></motion.button></header>{kind === "model" ? <ModelForm close={close} notify={notify} /> : kind === "alerts" ? <Alerts /> : <UserDetail notify={notify} />}</motion.aside></div>;
}

function ModelForm({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  return <form className="drawer-form" onSubmit={(event) => { event.preventDefault(); close(); notify("模型配置已保存为停用状态"); }}><label><span>模型标识</span><input placeholder="openai/gpt-4.1-mini" required /></label><label><span>API Base <small>可选</small></span><input placeholder="使用供应商默认地址" /></label><label><span>API Key</span><input type="password" placeholder="仅写入，不会再次显示" required /></label><div className="drawer-form-row"><label><span>优先级</span><input type="number" defaultValue="40" min="0" /></label><label><span>初始状态</span><select defaultValue="disabled"><option value="disabled">停用</option><option value="enabled">启用</option></select></label></div><div className="drawer-form-row"><label><span>输入价格</span><input type="number" placeholder="USD / 百万 Token" /></label><label><span>输出价格</span><input type="number" placeholder="USD / 百万 Token" /></label></div><div className="drawer-callout"><ShieldCheck size={17} /><p>凭据只会加密写入。响应、日志与异常中均不会出现密钥原文。</p></div><footer><button type="button" onClick={close}>取消</button><motion.button whileTap={{ scale: 0.97 }} type="submit">保存配置</motion.button></footer></form>;
}

function UserDetail({ notify }: { notify: (message: string) => void }) {
  return <div className="user-detail"><div className="user-detail-hero"><span>陈</span><div><strong>陈听澜</strong><p>chen@sample.cn</p><small>管理员 · 启用</small></div></div><dl><div><dt>用户 ID</dt><dd>100026</dd></div><div><dt>注册时间</dt><dd>2026-06-12</dd></div><div><dt>最近登录</dt><dd>今天 09:42</dd></div></dl><section><h3>使用概况</h3><div className="detail-stats"><div><strong>8</strong><span>简历</span></div><div><strong>341</strong><span>LLM 调用</span></div><div><strong>$1.62</strong><span>估算费用</span></div></div></section><section><h3>最近简历</h3><div className="recent-item"><FileText size={17} /><div><strong>高级产品经理 · 中文</strong><span>今天 09:18 更新</span></div></div><div className="recent-item"><FileText size={17} /><div><strong>Product Lead · English</strong><span>7 月 25 日更新</span></div></div></section><button className="danger-zone-button" onClick={() => notify("演示环境未执行账号禁用")}>禁用此账号</button></div>;
}

function Alerts() {
  return <div className="drawer-alerts"><div><span className="warn-icon"><CircleAlert size={17} /></span><div><strong>备用模型尚未配置密钥</strong><p>deepseek-chat 当前无法参与故障转移。</p><time>12 分钟前</time></div></div><div><span className="neutral-icon"><Users size={17} /></span><div><strong>本周新增用户增长 12.4%</strong><p>较上一周期增加 28 位用户。</p><time>1 小时前</time></div></div></div>;
}
