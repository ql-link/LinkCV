import { useEffect, useState } from "react";
import { ChevronRight, Copy, Shield } from "lucide-react";
import { api, ApiRequestError, type AdminUserDetail, type AdminUserSummary, type User } from "../../api/client";
import { Donut, DonutLegend, STATUS_COLORS, ThinBars, type DonutSlice } from "./charts";
import {
  Avatar,
  Button,
  ConfirmModal,
  DataTable,
  DetailList,
  Drawer,
  ErrorState,
  LinkButton,
  ListPanel,
  LoadingRegion,
  PageHeader,
  SearchInput,
  SkBar,
  SkeletonChart,
  SkeletonRows,
  StatusDot,
  TableFooter,
  TextTabs,
  copyText,
  formatCosts,
  formatDate,
  formatDateTime,
  formatDayLabel,
  formatNumber,
  formatPercent,
  formatWhen,
  useConsole,
  useLoad,
} from "./kit";

const PAGE_SIZE = 20;

type RoleTab = "" | "admin" | "disabled";

const avatarColors = ["#5972d9", "#2f9461", "#7c64c5", "#b7792e", "#c25b56", "#454842"];
/** Stable colour per user so the list does not reshuffle colours between pages. */
export function avatarColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return avatarColors[hash % avatarColors.length];
}

export function UsersPage({ currentUser, initialUserId }: { currentUser: User; initialUserId?: string | null }) {
  const stats = useLoad(() => api.adminInsightUsers());
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [tab, setTab] = useState<RoleTab>("");
  const [page, setPage] = useState(1);
  const list = useLoad(
    () => api.adminListUsers({ page, size: PAGE_SIZE, q: appliedQuery || undefined, status: tab === "disabled" ? "disabled" : undefined, role: tab === "admin" ? "admin" : undefined }),
    [page, appliedQuery, tab],
  );
  const [selected, setSelected] = useState<string | null>(initialUserId ?? null);

  // Debounce the search box so every keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => { setAppliedQuery(query.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const data = stats.data;
  const daily = data?.daily ?? [];
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.size)) : 1;
  // Active and disabled are disjoint (active counts only enabled accounts), the rest is "not logged in for 7 days".
  const accounts: DonutSlice[] = data ? [
    { key: "active", label: "7 日活跃", value: data.activeUsers7d, color: STATUS_COLORS.ok },
    { key: "idle", label: "7 日未登录", value: Math.max(0, data.total - data.activeUsers7d - data.disabled), color: STATUS_COLORS.idle },
    { key: "disabled", label: "已禁用", value: data.disabled, color: STATUS_COLORS.bad },
  ] : [];

  return (
    <>
      <PageHeader title="用户管理" />
      {stats.loading && !data ? <LoadingRegion label="正在加载用户统计…"><SkeletonChart height={188} /></LoadingRegion> : !data ? <ErrorState code={stats.error} onRetry={() => void stats.reload()} /> : (
        <div className="adm-duo">
          <div>
            <div className="adm-block-head"><div className="adm-block-title"><h2>账号构成</h2><span>共 {formatNumber(data.total)} 位</span></div></div>
            <div className="adm-donut-body">
              <Donut ariaLabel="账号构成" slices={accounts} center={data.total ? formatPercent(data.activeUsers7d / data.total) : "—"} sub="7 日活跃率" />
              <DonutLegend slices={accounts} stacked />
            </div>
          </div>
          <span className="adm-vrule" aria-hidden="true" />
          <div>
            <div className="adm-block-head">
              <div className="adm-block-title"><h2>新增用户</h2><span>最近 14 天</span></div>
              <span className="adm-block-stat"><b>{formatNumber(data.newUsers7d)}</b>7 日新增 · 今日 {data.registeredToday}</span>
            </div>
            <ThinBars
              ariaLabel="最近 14 天新增用户"
              data={daily.map((day, index) => ({
                key: day.date,
                label: index === daily.length - 1 ? "今天" : `${Number(day.date.slice(5, 7))} 月 ${Number(day.date.slice(8, 10))} 日`,
                value: day.count,
                tooltip: <><small>{formatDayLabel(day.date)}</small><strong>新增 {day.count} 人</strong></>,
              }))}
            />
          </div>
        </div>
      )}

      <span className="adm-rule" aria-hidden="true" />
      <ListPanel
        label="用户列表"
        resetKey={`${tab}|${appliedQuery}|${page}`}
        toolbar={(
          <div className="adm-filterbar">
            <TextTabs
              label="用户筛选"
              value={tab}
              onChange={(next) => { setTab(next); setPage(1); }}
              options={[
                { value: "", label: "全部", count: data?.total },
                { value: "admin", label: "管理员", count: data?.admins },
                { value: "disabled", label: "已禁用", count: data?.disabled },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="搜索邮箱或用户 ID" width={220} />
          </div>
        )}
        footer={list.data && list.data.total > PAGE_SIZE && (
          <TableFooter>
            <span>共 {list.data.total.toLocaleString("en-US")} 位 · 第 {list.data.page} / {totalPages} 页</span>
            <div>
              <Button disabled={page <= 1 || list.loading} onClick={() => setPage((value) => value - 1)}>上一页</Button>
              <Button disabled={page >= totalPages || list.loading} onClick={() => setPage((value) => value + 1)}>下一页</Button>
            </div>
          </TableFooter>
        )}
      >
        {list.loading && !list.data ? <LoadingRegion label="正在加载用户…"><SkeletonRows rows={6} columns={5} /></LoadingRegion> : list.error ? (
          <ErrorState code={list.error} onRetry={() => void list.reload()} />
        ) : (
          <DataTable<AdminUserSummary>
            busy={list.loading}
            rows={list.data?.items ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelected(row.id)}
            rowLabel={(row) => `查看用户 ${row.nickname}`}
            empty={appliedQuery || tab ? "没有匹配的用户" : "暂无用户"}
            columns={[
              { key: "user", label: "用户", width: "minmax(0, 1fr)", render: (row) => <span className="adm-cell-with-avatar"><span className="adm-avatar is-round" style={{ background: avatarColor(row.id) }} aria-hidden="true">{row.nickname.slice(0, 1).toUpperCase()}</span><span className="adm-cell-stack"><strong>{row.nickname}</strong><small>{row.email ?? "未绑定邮箱"}</small></span></span> },
              { key: "role", label: "角色", width: "110px", render: (row) => row.is_admin ? <span className="adm-role-admin"><Shield size={14} aria-hidden="true" />管理员</span> : <span className="adm-ink2">普通用户</span> },
              { key: "resumes", label: "简历", width: "60px", render: (row) => <span className="adm-ink2">{row.resume_count}</span> },
              { key: "status", label: "状态", width: "80px", render: (row) => <StatusDot tone={row.status === 1 ? "ok" : "muted"}>{row.status === 1 ? "启用" : "禁用"}</StatusDot> },
              { key: "login", label: "最近登录", width: "100px", render: (row) => <span className="adm-ink2">{formatWhen(row.last_login_at, "从未登录")}</span> },
              { key: "open", label: "", width: "20px", render: () => <ChevronRight size={18} className="adm-chevron" aria-hidden="true" /> },
            ]}
          />
        )}
      </ListPanel>

      {selected && (
        <UserDrawer
          userId={selected}
          currentUser={currentUser}
          onClose={() => setSelected(null)}
          onChanged={() => { void list.reload(); void stats.reload(); }}
        />
      )}
    </>
  );
}

function UserDrawer({ userId, currentUser, onClose, onChanged }: { userId: string; currentUser: User; onClose: () => void; onChanged: () => void }) {
  const { notify } = useConsole();
  const detail = useLoad<AdminUserDetail>(() => api.adminGetUser(userId), [userId]);
  const [confirm, setConfirm] = useState<"disable" | "enable" | null>(null);
  const [busy, setBusy] = useState(false);
  const user = detail.data;
  const isSelf = user?.id === currentUser.id;

  const apply = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await api.adminUpdateUserStatus(userId, confirm);
      notify(confirm === "disable" ? "账号已禁用，活跃会话已撤销" : "账号已启用");
      setConfirm(null);
      await detail.reload();
      onChanged();
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.message : "";
      notify(code === "CANNOT_SELF_DISABLE" ? "不能禁用自己的账号" : code === "CANNOT_DISABLE_LAST_ADMIN" ? "不能禁用最后一个管理员" : "操作失败，请重试", "error");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title="用户详情" onClose={onClose} width={460}>
      {detail.loading && !user ? (
        <LoadingRegion label="正在加载用户详情…"><div className="adm-user-hero"><SkBar width={44} height={44} /><div><SkBar width={120} height={14} /><SkBar width={180} /></div></div></LoadingRegion>
      ) : !user ? <ErrorState code={detail.error} onRetry={() => void detail.reload()} /> : (
        <>
          <div className="adm-user-hero">
            <Avatar label={user.nickname} color="#232421" />
            <div>
              <strong>{user.nickname}<StatusDot tone={user.status === 1 ? "ok" : "muted"}>{user.status === 1 ? "启用" : "禁用"}</StatusDot></strong>
              <span>{user.email ?? "未绑定邮箱"} · {user.is_admin ? "管理员" : "普通用户"}</span>
            </div>
          </div>
          <h3 className="adm-subhead">使用概况</h3>
          <div className="adm-stat-grid">
            <div><span>简历</span><strong>{user.resume_count}</strong></div>
            <div><span>LLM 调用</span><strong>{formatNumber(user.llm_call_count)}</strong></div>
            <div><span>估算费用</span><strong>{formatCosts(user.llm_costs)}</strong></div>
          </div>
          <h3 className="adm-subhead">账号资料</h3>
          <DetailList items={[
            ["用户 ID", <span className="adm-inline-copy">{user.id}<LinkButton onClick={() => copyText(user.id, notify, "已复制用户 ID")} aria-label="复制用户 ID"><Copy size={12} />复制</LinkButton></span>],
            ["角色", user.is_admin ? "管理员" : "普通用户"],
            ["注册时间", formatDate(user.created_at)],
            ["最近登录", formatDateTime(user.last_login_at, "从未登录")],
          ]} />
          <div className="adm-danger-zone">
            {user.status === 1 ? (
              <>
                <strong>禁用此账号</strong>
                <p>该用户所有活跃会话立即撤销。不能禁用自己，也不能禁用最后一个管理员。</p>
                <Button variant="danger" disabled={isSelf} title={isSelf ? "不能禁用自己的账号" : undefined} onClick={() => setConfirm("disable")}>禁用此账号</Button>
              </>
            ) : (
              <>
                <strong>启用此账号</strong>
                <p>启用后该用户可以重新登录。</p>
                <Button variant="primary" onClick={() => setConfirm("enable")}>启用此账号</Button>
              </>
            )}
          </div>
          {confirm && (
            <ConfirmModal
              title={confirm === "disable" ? "禁用账号？" : "启用账号？"}
              confirmLabel={confirm === "disable" ? "禁用" : "启用"}
              danger={confirm === "disable"}
              busy={busy}
              onCancel={() => setConfirm(null)}
              onConfirm={() => void apply()}
            >
              {confirm === "disable"
                ? `确定要禁用 ${user.nickname}（${user.email ?? "未绑定邮箱"}）吗？该用户所有活跃会话将被立即撤销。`
                : `确定要启用 ${user.nickname}（${user.email ?? "未绑定邮箱"}）吗？`}
            </ConfirmModal>
          )}
        </>
      )}
    </Drawer>
  );
}
