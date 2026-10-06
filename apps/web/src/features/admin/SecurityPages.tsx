import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiRequestError,
  type AgentOperationDetail,
  type AgentOperationItem,
  type AuditLogQuery,
  type LlmCallQuery,
  type LlmCallRecord,
  type LogItem,
  type LogListResponse,
  type SystemLogQuery,
} from "../../api/client";
import { Activity, BadgeCheck, CalendarClock, CircleAlert, CircleCheck, Coins, FileText, GitBranch, History, Layers, Megaphone, Puzzle, Route as RouteIcon, Server, Shield, Timer, TriangleAlert, UserRound, Workflow, Zap, ChevronRight, RefreshCw, type LucideIcon } from "lucide-react";
import { DotLegend, Donut, DonutLegend, HeatLegend, Heatmap, STATUS_COLORS, ThinStackedBars, type DonutSlice, type ThinStackSeries } from "./charts";
import { DateTimeInput } from "./DateTimeInput";
import {
  Badge,
  Button,
  Chip,
  DataTable,
  DetailList,
  Drawer,
  ErrorState,
  Field,
  Footnote,
  InlineError,
  ListPanel,
  LoadingRegion,
  Metrics,
  Modal,
  PageHeader,
  SearchInput,
  Segmented,
  SelectBox,
  SkeletonChart,
  SkeletonMetrics,
  SkeletonRows,
  StatusDot,
  TableFooter,
  TextTabs,
  copyText,
  errorCode,
  formatCompact,
  formatCosts,
  formatDateTime,
  formatMoney,
  formatMs,
  formatNumber,
  formatPercent,
  formatDayLabel,
  formatWhen,
  fromLocalInput,
  useCaseLabel,
  useCaseLabels,
  useConsole,
  parseRecordSearch,
  useLoad,
  type Tint,
  type Tone,
} from "./kit";

const agentStatus: Record<string, { tone: Tone; label: string }> = {
  preflighting: { tone: "info", label: "预检中" },
  running: { tone: "info", label: "运行中" },
  succeeded: { tone: "ok", label: "成功" },
  failed: { tone: "bad", label: "失败" },
  cancelled: { tone: "muted", label: "取消" },
};
const statusOf = (value: string) => agentStatus[value] ?? { tone: "muted" as Tone, label: value };

/* ---------- cursor pagination ---------- */

function useCursorPages() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [stack, setStack] = useState<Array<string | undefined>>([]);
  return {
    cursor,
    hasPrevious: stack.length > 0,
    next: (value: string | null | undefined) => { if (!value) return; setStack((current) => [...current, cursor]); setCursor(value); },
    previous: () => { setCursor(stack[stack.length - 1]); setStack((current) => current.slice(0, -1)); },
    reset: () => { setCursor(undefined); setStack([]); },
  };
}

/* ---------- 10 agent logs (health view) ---------- */

const agentSeries: ThinStackSeries[] = [
  { key: "succeeded", label: "成功", color: STATUS_COLORS.ok },
  { key: "failed", label: "失败", color: STATUS_COLORS.bad },
  { key: "running", label: "运行中", color: STATUS_COLORS.info },
];

export function AgentLogsPage() {
  const insight = useLoad(() => api.adminInsightAgent());
  const [filter, setFilter] = useState<"" | "succeeded" | "failed" | "running">("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState<ReturnType<typeof parseRecordSearch>>(null);
  // Search runs on the server over the whole 7-day window, not just the rows already shown.
  const recent = useLoad(() => api.adminListAgentOperations({
    status: filter || undefined,
    limit: 20,
    operationId: appliedQuery?.kind === "id" ? appliedQuery.value : undefined,
    userId: appliedQuery?.kind === "user" ? appliedQuery.value : undefined,
    errorCode: appliedQuery?.kind === "error" ? appliedQuery.value : undefined,
  }), [filter, appliedQuery]);
  const [selected, setSelected] = useState<string | null>(null);
  const data = insight.data;
  const items = recent.data?.items ?? [];
  const totals = (data?.daily ?? []).reduce((sum, day) => ({ succeeded: sum.succeeded + day.succeeded, failed: sum.failed + day.failed, running: sum.running + day.running }), { succeeded: 0, failed: 0, running: 0 });
  const results: DonutSlice[] = agentSeries.map((entry) => ({ key: entry.key, label: entry.label, value: totals[entry.key as keyof typeof totals], color: entry.color }));
  const resultTotal = totals.succeeded + totals.failed + totals.running;

  return (
    <>
      <PageHeader title="Agent 日志" />
      {insight.loading && !data ? <LoadingRegion label="正在加载 Agent 统计…"><SkeletonMetrics /></LoadingRegion> : !data ? <ErrorState code={insight.error} onRetry={() => void insight.reload()} /> : (
        <>
          <Metrics items={[
            { label: "7 日操作", value: formatNumber(data.operations), icon: Workflow, tint: "blue" },
            { label: "成功率", value: formatPercent(data.failureRate == null ? null : 1 - data.failureRate), icon: BadgeCheck, tint: "green" },
            { label: "失败", value: formatNumber(data.failed), note: data.running ? `${data.running} 个运行中` : undefined, tone: "muted", icon: CircleAlert, tint: "red" },
            { label: "最常失败阶段", value: <span className="adm-metric-code">{data.topFailureStage ?? "—"}</span>, icon: GitBranch, tint: "amber" },
          ]} />
          <div className="adm-duo">
            <div>
              <div className="adm-block-head"><div className="adm-block-title"><h2>结果构成</h2><span>7 天合计 {formatNumber(resultTotal)} 次</span></div></div>
              <div className="adm-donut-body">
                <Donut ariaLabel="最近 7 天 Agent 结果构成" slices={results} center={resultTotal ? formatPercent(totals.succeeded / resultTotal) : "—"} sub="成功率" />
                <DonutLegend slices={results} stacked />
              </div>
            </div>
            <span className="adm-vrule" aria-hidden="true" />
            <div>
              <div className="adm-block-head">
                <div className="adm-block-title"><h2>每日运行结果</h2><span>最近 7 天</span></div>
                <DotLegend items={agentSeries} />
              </div>
              <ThinStackedBars
                ariaLabel="最近 7 天 Agent 运行结果"
                series={agentSeries}
                data={data.daily.map((day, index) => ({ key: day.date, label: index === data.daily.length - 1 ? "今天" : formatDayLabel(day.date).split(" ")[1], values: { succeeded: day.succeeded, failed: day.failed, running: day.running } }))}
              />
            </div>
          </div>
        </>
      )}
      <ListPanel label="最近运行" resetKey={`${filter}|${appliedQuery?.value ?? ""}`} toolbar={(
        <div className="adm-filterbar">
          <TextTabs label="运行状态" value={filter} onChange={setFilter} options={[
            { value: "", label: "全部", count: data ? resultTotal : null },
            { value: "succeeded", label: "成功", count: data ? totals.succeeded : null },
            { value: "running", label: "运行中", count: data ? totals.running : null },
            { value: "failed", label: "失败", count: data ? totals.failed : null },
          ]} />
          <SearchInput value={query} onChange={(next) => { setQuery(next); if (!next.trim()) setAppliedQuery(null); }} onSubmit={() => setAppliedQuery(parseRecordSearch(query))} placeholder="操作 ID / 用户 ID，回车" width={200} />
        </div>
      )}>
        {recent.loading && !recent.data ? <SkeletonRows rows={5} columns={5} /> : recent.error ? <ErrorState code={recent.error} onRetry={() => void recent.reload()} /> : (
          <DataTable<AgentOperationItem>
            className="is-compact"
            busy={recent.loading}
            rows={items}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelected(row.id)}
            rowLabel={(row) => `查看操作 ${row.id}`}
            empty="当前条件下没有运行记录"
            columns={[
              { key: "id", label: "操作 ID", width: "170px", render: (row) => <span className="adm-ellipsis adm-ink2 adm-medium adm-small">{row.id}</span> },
              { key: "model", label: "模型", width: "minmax(0, 1fr)", render: (row) => <span className="adm-ink2">{row.model_name ?? "—"}</span> },
              { key: "stage", label: "失败阶段", width: "170px", render: (row) => row.failure_stage ? <span className="adm-tone-bad adm-medium adm-small">{row.failure_stage}</span> : <span className="adm-ink2">—</span> },
              { key: "status", label: "状态", width: "90px", render: (row) => <StatusDot tone={statusOf(row.status).tone}>{statusOf(row.status).label}</StatusDot> },
              { key: "time", label: "时间", width: "70px", align: "right", render: (row) => <span className="adm-ink2">{formatWhen(row.created_at, "—", { compact: true })}</span> },
            ]}
          />
        )}
      </ListPanel>
      {selected && <AgentOperationDrawer id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/* ---------- 14 agent operations (troubleshooting) ---------- */

export function AgentOperationsPage() {
  const insight = useLoad(() => {
    const to = new Date();
    return api.adminInsightAgent({ from: new Date(to.getTime() - 31 * 86400_000).toISOString(), to: to.toISOString() });
  });
  // Filters apply as they change (Figma V4 14); the search box applies on Enter, like the other log pages.
  const [filters, setFilters] = useState<{ range: AgentRange; from: string; to: string; status: string; search: string }>({ range: "7d", from: "", to: "", status: "", search: "" });
  const [searchText, setSearchText] = useState("");
  const [items, setItems] = useState<AgentOperationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { onSessionExpired } = useConsole();
  const requestId = useRef(0);

  const load = useCallback(async (cursor?: string) => {
    // A reply for superseded filters must not overwrite or append to the current list.
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.adminListAgentOperations({
        status: filters.status || undefined,
        ...(() => {
          const search = parseRecordSearch(filters.search);
          return {
            errorCode: search?.kind === "error" ? search.value : undefined,
            operationId: search?.kind === "id" ? search.value : undefined,
            userId: search?.kind === "user" ? search.value : undefined,
          };
        })(),
        ...agentRangeQuery(filters),
        cursor,
      });
      if (current !== requestId.current) return;
      setItems((previous) => (cursor ? [...previous, ...result.items] : result.items));
      setNextCursor(result.next_cursor);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 401) onSessionExpired();
      if (current === requestId.current) setError(errorCode(caught));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [filters, onSessionExpired]);

  useEffect(() => { void load(); }, [load]);
  const data = insight.data;
  const refresh = () => { void load(); void insight.reload(); };

  return (
    <>
      <PageHeader title="Agent 调用排障" actions={<Button onClick={refresh}>刷新</Button>} />
      {insight.loading && !data ? <SkeletonMetrics /> : data && (
        <Metrics items={[
          { label: "31 日操作", value: formatNumber(data.operations), icon: Workflow, tint: "blue" },
          { label: "失败", value: formatNumber(data.failed), note: formatPercent(data.failureRate), tone: "muted", icon: CircleAlert, tint: "red" },
          { label: "运行中", value: formatNumber(data.running), icon: Activity, tint: "violet" },
          { label: "P95 耗时", value: formatMs(data.p95Ms), icon: Timer, tint: "amber" },
        ]} />
      )}
      <ListPanel
        label="操作记录"
        resetKey={JSON.stringify(filters)}
        toolbar={(
        <div className="adm-filterbar is-trace">
          <SearchInput value={searchText} onChange={(next) => { setSearchText(next); if (!next.trim() && filters.search) setFilters({ ...filters, search: "" }); }} onSubmit={() => setFilters({ ...filters, search: searchText.trim() })} placeholder="操作 ID / 用户 ID" width={220} />
          <SelectBox label="状态" icon={Layers} className="adm-filter-select" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[{ value: "", label: "全部状态" }, ...Object.entries(agentStatus).map(([value, item]) => ({ value, label: item.label }))]} />
          <SelectBox label="时间范围" icon={CalendarClock} className="adm-filter-select" value={filters.range} onChange={(range) => setFilters({ ...filters, range })} options={Object.entries(agentRanges).map(([value, label]) => ({ value: value as AgentRange, label }))} />
          {filters.range === "custom" && (
            <>
              <DateTimeInput label="开始时间" placeholder="开始时间" width={180} value={filters.from} onChange={(from) => setFilters({ ...filters, from })} />
              <DateTimeInput label="结束时间" placeholder="结束时间" width={180} defaultTime="23:59" value={filters.to} onChange={(to) => setFilters({ ...filters, to })} />
            </>
          )}
          <span className="adm-filter-spacer" aria-hidden="true" />
          <Button className="adm-filter-btn" disabled={loading} onClick={refresh}><RefreshCw size={14} strokeWidth={2} aria-hidden="true" />刷新</Button>
        </div>
        )}
        footer={items.length > 0 && (
          <TableFooter>
            <span>已加载 {items.length} 条</span>
            {nextCursor && <Button disabled={loading} onClick={() => void load(nextCursor)}>{loading ? "加载中…" : "加载更多"}</Button>}
          </TableFooter>
        )}
      >
        {loading && items.length === 0 ? <LoadingRegion label="正在加载操作记录…"><SkeletonRows rows={6} columns={7} /></LoadingRegion> : error && items.length === 0 ? <ErrorState title="读取 Agent 排障记录失败" code={error} onRetry={() => void load()} /> : (
          <>
            <DataTable<AgentOperationItem>
              className="is-trace"
              setKey={JSON.stringify(filters)}
              rows={items}
              rowKey={(row) => row.id}
              onRowClick={(row) => setSelected(row.id)}
              rowLabel={(row) => `查看操作 ${row.id}`}
              empty="当前条件下没有记录"
              columns={[
                { key: "time", label: "时间", width: "60px", render: (row) => <span className="adm-ink2">{formatWhen(row.created_at, "—", { compact: true })}</span> },
                { key: "id", label: "操作", width: "170px", render: (row) => <span className="adm-cell-inline"><span className="adm-ellipsis adm-ink2 adm-medium adm-small">{row.id}</span>{row.legacy && <Badge tone="neutral">历史</Badge>}</span> },
                { key: "user", label: "用户", width: "80px", render: (row) => <span className="adm-ink2">{row.user_id}</span> },
                { key: "model", label: "模型", width: "minmax(0, 1fr)", render: (row) => <span className="adm-ellipsis adm-ink2">{row.model_name ?? "—"}</span> },
                { key: "status", label: "状态", width: "90px", render: (row) => <StatusDot tone={statusOf(row.status).tone}>{statusOf(row.status).label}</StatusDot> },
                { key: "stage", label: "阶段 / 错误码", width: "220px", render: (row) => row.error_code
                  ? <span className="adm-cell-stack is-tight adm-medium adm-small"><span className="adm-ellipsis adm-ink2">{row.failure_stage ?? "—"}</span><span className="adm-ellipsis adm-tone-bad">{row.error_code}</span></span>
                  : row.failure_stage ? <span className="adm-ellipsis adm-ink2 adm-small">{row.failure_stage}</span> : <span className="adm-faint">—</span> },
                { key: "open", label: "", width: "20px", render: () => <ChevronRight size={16} className="adm-chevron" aria-hidden="true" /> },
              ]}
            />
          </>
        )}
      </ListPanel>
      <Footnote icon={Shield}>记录只包含执行阶段、工具与提案状态，不包含对话或简历正文。</Footnote>
      {selected && <AgentOperationDrawer id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

const agentRanges = { "": "全部时间", "24h": "最近 24 小时", "7d": "最近 7 天", "31d": "最近 31 天", custom: "自定义" } as const;
type AgentRange = keyof typeof agentRanges;
const agentRangeHours: Partial<Record<AgentRange, number>> = { "24h": 24, "7d": 7 * 24, "31d": 31 * 24 };

/** Presets are resolved when the query runs so "最近 24 小时" always ends now; only 自定义 uses the date inputs. */
function agentRangeQuery(filters: { range: AgentRange; from: string; to: string }): { from?: string; to?: string } {
  if (filters.range === "custom") return { from: fromLocalInput(filters.from) ?? undefined, to: fromLocalInput(filters.to) ?? undefined };
  const hours = agentRangeHours[filters.range];
  return hours ? { from: new Date(Date.now() - hours * 3600_000).toISOString() } : {};
}

function AgentOperationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useLoad<AgentOperationDetail>(() => api.adminGetAgentOperation(id), [id]);
  const [loadingMore, setLoadingMore] = useState(false);
  const data = detail.data;
  const status = data ? statusOf(data.status) : null;

  const loadMore = async () => {
    if (!data?.next_cursor) return;
    setLoadingMore(true);
    try {
      const page = await api.adminGetAgentOperation(id, { cursor: data.next_cursor });
      detail.setData({ ...page, events: [...data.events, ...page.events] });
    } finally { setLoadingMore(false); }
  };

  return (
    <Drawer
      width={560}
      onClose={onClose}
      eyebrow="Agent 操作详情"
      title={<span className="adm-title-row">{id}{status && <Badge tone={status.tone}>{status.label}</Badge>}</span>}
      subtitle="不包含对话或简历正文"
    >
      {detail.loading && !data ? <SkeletonRows rows={6} columns={3} height={36} /> : !data ? <ErrorState code={detail.error} onRetry={() => void detail.reload()} /> : (
        <>
          <DetailList items={[
            ["用户 ID", data.user_id],
            ["调用模型", data.model_name ?? "未记录"],
            ["时间线", data.timeline_status === "complete" ? "完整" : data.timeline_status === "legacy" ? "历史运行" : `不完整${data.gap_reason ? `（${data.gap_reason}）` : ""}`],
            ["失败阶段 · 错误码", data.failure_stage || data.error_code ? `${data.failure_stage ?? "—"} · ${data.error_code ?? "—"}` : null],
          ]} />
          <h3 className="adm-subhead">阶段事件</h3>
          {data.events.length === 0 ? <p className="adm-muted">{data.timeline_status === "legacy" ? "历史运行无阶段记录。" : "暂无阶段事件。"}</p> : (
            <ol className="adm-timeline">
              {data.events.map((event) => (
                <li key={event.id} className={event.result === "failed" ? "is-failed" : undefined}>
                  <time>{formatDateTime(event.occurred_at).slice(11)}</time>
                  <code>{event.stage}</code>
                  <span>{[event.result !== "succeeded" ? event.result : null, formatMs(event.duration_ms), event.error_code, event.tool_call_key && `工具 ${event.tool_call_key}`, event.proposal_id && `提案 ${event.proposal_id}`].filter((value) => value && value !== "—").join(" · ") || "—"}</span>
                </li>
              ))}
            </ol>
          )}
          {data.next_cursor && <Button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多阶段"}</Button>}
          <h3 className="adm-subhead">工具调用</h3>
          {data.tools.length === 0 ? <p className="adm-muted">没有工具调用。</p> : (
            <DataTable
              rows={data.tools}
              rowKey={(row) => row.call_key}
              columns={[
                { key: "tool", label: "工具", width: "minmax(0, 1.4fr)", render: (row) => <code className="adm-code">{row.tool_name}</code> },
                { key: "status", label: "状态", width: "80px", render: (row) => <StatusDot tone={statusOf(row.status).tone}>{statusOf(row.status).label}</StatusDot> },
                { key: "code", label: "错误码", width: "minmax(0, 1fr)", render: (row) => row.error_code ?? "—" },
              ]}
            />
          )}
          <h3 className="adm-subhead">提案</h3>
          {data.proposals.length === 0 ? <p className="adm-muted">没有提案。</p> : (
            <ul className="adm-plain-list">{data.proposals.map((proposal) => <li key={proposal.id}><code className="adm-code">{proposal.id}</code> · {proposal.status}{proposal.applied_at && ` · ${formatWhen(proposal.applied_at)} 应用`}</li>)}</ul>
          )}
        </>
      )}
    </Drawer>
  );
}

/* ---------- 11/12 system logs & audit ---------- */

type LogKind = "system" | "audit";

const levelTone = (level: string): Tone => (level === "ERROR" || level === "CRITICAL" ? "bad" : level === "WARNING" ? "warn" : "neutral");

function useLogList(kind: LogKind, query: SystemLogQuery | AuditLogQuery) {
  const key = JSON.stringify(query);
  return useLoad<LogListResponse>(
    () => (kind === "system" ? api.adminListSystemLogs(query as SystemLogQuery) : api.adminListAuditLogs(query as AuditLogQuery)),
    [kind, key],
  );
}

/** Summary for the last 24h plus the 24h before it, for the "较上周期" deltas (Figma 11 / 12). */
function useLogSummaries() {
  const current = useLoad(() => api.adminLogSummary());
  const previous = useLoad(() => {
    const end = new Date(Date.now() - 24 * 3600_000);
    return api.adminLogSummary({ from: new Date(end.getTime() - 24 * 3600_000).toISOString(), to: end.toISOString() });
  });
  return { summary: current, previous: previous.data };
}

/** "+4" / "-2" against the previous window; more errors reads as bad, fewer as good. */
const dependencyLabels: Record<string, string> = { mysql: "MySQL", redis: "Redis", minio: "MinIO", linkparse: "LinkParse", llm: "LLM" };

export function countDelta(current: number, previous: number | undefined, worseWhenHigher = true, worseTone: Tone = "bad"): { note?: string; tone?: Tone } {
  if (previous == null) return {};
  const diff = current - previous;
  if (diff === 0) return { note: "持平", tone: "muted" };
  const up = diff > 0;
  return { note: `${up ? "+" : ""}${diff}`, tone: up === worseWhenHigher ? worseTone : "ok" };
}

export function SystemLogsPage() {
  const { summary, previous } = useLogSummaries();
  const heatmap = useLoad(() => api.adminLogHeatmap());
  const pages = useCursorPages();
  const [level, setLevel] = useState<"" | "ERROR" | "WARNING">("");
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [advanced, setAdvanced] = useState<SystemLogQuery>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<LogItem | null>(null);
  const query: SystemLogQuery = { ...advanced, level: level || advanced.level, keyword: appliedKeyword || advanced.keyword, cursor: pages.cursor, limit: 50 };
  const list = useLogList("system", query);
  const activeFilters = Object.values(advanced).filter(Boolean).length;
  const data = summary.data;
  // Info = everything that is neither a warning nor an error, so the three slices add up to the total.
  const levels: DonutSlice[] = data ? [
    { key: "info", label: "信息", value: Math.max(0, data.system.total - data.system.warnings - data.system.errors), color: STATUS_COLORS.neutral },
    { key: "warn", label: "警告", value: data.system.warnings, color: STATUS_COLORS.warn },
    { key: "error", label: "错误", value: data.system.errors, color: STATUS_COLORS.bad },
  ] : [];

  return (
    <>
      <PageHeader title="系统日志" actions={<Button onClick={() => setFilterOpen(true)}>高级筛选{activeFilters ? ` · ${activeFilters}` : ""}</Button>} />
      {summary.loading && !data ? <SkeletonMetrics /> : summary.error ? <ErrorState title="日志汇总暂不可用" code={summary.error} onRetry={() => void summary.reload()} /> : data && (
        <Metrics items={[
          { label: "错误 · 24h", value: formatNumber(data.system.errors), ...countDelta(data.system.errors, previous?.system.errors), icon: CircleAlert, tint: "red", onClick: () => { setLevel("ERROR"); pages.reset(); } },
          { label: "警告 · 24h", value: formatNumber(data.system.warnings), ...countDelta(data.system.warnings, previous?.system.warnings, true, "warn"), icon: TriangleAlert, tint: "amber", onClick: () => { setLevel("WARNING"); pages.reset(); } },
          { label: "全部 · 24h", value: formatNumber(data.system.total), icon: FileText, tint: "gray" },
          { label: "审计失败 · 24h", value: formatNumber(data.audit.failed), icon: Shield, tint: "violet" },
        ]} />
      )}
      <div className="adm-duo is-trend-first">
        <div>
          <div className="adm-block-head">
            <div className="adm-block-title"><h2>错误与警告分布</h2><span>最近 7 天 · 每格 3 小时</span></div>
            <HeatLegend />
          </div>
          {heatmap.loading && !heatmap.data ? <SkeletonChart height={189} /> : heatmap.error ? <ErrorState title="热力图暂不可用" code={heatmap.error} onRetry={() => void heatmap.reload()} /> : heatmap.data && <Heatmap buckets={heatmap.data.buckets} />}
        </div>
        <span className="adm-vrule" aria-hidden="true" />
        <div>
          <div className="adm-block-head"><div className="adm-block-title"><h2>级别构成</h2><span>24h</span></div></div>
          {data ? (
            <div className="adm-donut-body is-column">
              <Donut size={128} ariaLabel="最近 24 小时日志级别构成" slices={levels} center={formatNumber(data.system.total)} sub="条日志" />
              <DonutLegend slices={levels} />
            </div>
          ) : <SkeletonChart height={200} />}
        </div>
      </div>
      <ListPanel label="最近事件" resetKey={JSON.stringify(query)} footer={<LogPager list={list} pages={pages} />} toolbar={(
        <div className="adm-filterbar">
          <TextTabs label="日志级别" value={level} onChange={(value) => { setLevel(value); pages.reset(); }} options={[{ value: "", label: "全部" }, { value: "ERROR", label: "ERROR" }, { value: "WARNING", label: "WARN" }]} />
          <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索事件或来源" width={200} onSubmit={() => { setAppliedKeyword(keyword.trim()); pages.reset(); }} />
        </div>
      )}>
        <LogTable list={list} onSelect={setSelected} />
      </ListPanel>
      {filterOpen && <LogFilterDrawer kind="system" value={advanced} onClose={() => setFilterOpen(false)} onApply={(next) => { setAdvanced(next); pages.reset(); setFilterOpen(false); }} />}
      {selected && <LogDetailModal item={selected} kind="system" onClose={() => setSelected(null)} />}
    </>
  );
}

/** Audit action → readable name and an icon chip; unknown actions fall back to the raw code. */
const auditActions: Record<string, { label: string; icon: LucideIcon; tint: Tint }> = {
  "auth.admin_login": { label: "管理员登录", icon: Shield, tint: "gray" },
  "auth.login": { label: "用户登录", icon: UserRound, tint: "gray" },
  "auth.logout": { label: "退出登录", icon: UserRound, tint: "gray" },
  "auth.register": { label: "注册账号", icon: UserRound, tint: "green" },
  "auth.session_refresh": { label: "刷新会话", icon: History, tint: "gray" },
  "admin.user_status_change": { label: "变更用户状态", icon: UserRound, tint: "green" },
  "admin.announcement_create": { label: "新建公告草稿", icon: Megaphone, tint: "blue" },
  "admin.announcement_update": { label: "编辑公告", icon: Megaphone, tint: "blue" },
  "admin.announcement_publish": { label: "发布公告", icon: Megaphone, tint: "blue" },
  "admin.announcement_unpublish": { label: "下线公告", icon: Megaphone, tint: "blue" },
  "admin.announcement_delete": { label: "删除公告草稿", icon: Megaphone, tint: "blue" },
  "admin.llm_connection_create": { label: "添加连接", icon: RouteIcon, tint: "violet" },
  "admin.llm_connection_update": { label: "更新连接", icon: RouteIcon, tint: "violet" },
  "admin.llm_connection_delete": { label: "删除连接", icon: RouteIcon, tint: "violet" },
  "admin.llm_connection_sync": { label: "同步模型目录", icon: RouteIcon, tint: "violet" },
  "admin.llm_model_create": { label: "添加模型", icon: RouteIcon, tint: "violet" },
  "admin.llm_model_update": { label: "编辑模型", icon: RouteIcon, tint: "violet" },
  "admin.llm_model_delete": { label: "删除模型", icon: RouteIcon, tint: "violet" },
  "admin.llm_route_create": { label: "添加线路", icon: RouteIcon, tint: "violet" },
  "admin.llm_route_update": { label: "更新线路", icon: RouteIcon, tint: "violet" },
  "admin.llm_route_delete": { label: "删除线路", icon: RouteIcon, tint: "violet" },
  "admin.llm_binding_upsert": { label: "绑定能力线路", icon: RouteIcon, tint: "violet" },
  "admin.llm_binding_update": { label: "调整能力配置", icon: RouteIcon, tint: "violet" },
  "admin.llm_binding_delete": { label: "移除能力线路", icon: RouteIcon, tint: "violet" },
  "admin.llm_binding_probe": { label: "探测能力线路", icon: RouteIcon, tint: "violet" },
  "admin.plugin_release_publish": { label: "上传插件", icon: Puzzle, tint: "amber" },
  "admin.plugin_release_unpublish": { label: "下架插件", icon: Puzzle, tint: "amber" },
  "admin.plugin_release_reactivate": { label: "重新上架插件", icon: Puzzle, tint: "amber" },
  "admin.plugin_release_delete": { label: "删除插件", icon: Puzzle, tint: "amber" },
};

export function auditAction(action: string | null) {
  if (action && auditActions[action]) return auditActions[action];
  if (action?.includes("template")) return { label: action, icon: Layers, tint: "amber" as Tint };
  return { label: action ?? "—", icon: History, tint: "gray" as Tint };
}

export function AuditLogsPage({ initialFailedOnly = false }: { initialFailedOnly?: boolean }) {
  const { summary, previous } = useLogSummaries();
  const pages = useCursorPages();
  const [result, setResult] = useState<"" | "succeeded" | "failed">(initialFailedOnly ? "failed" : "");
  const [advanced, setAdvanced] = useState<AuditLogQuery>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<LogItem | null>(null);
  const list = useLogList("audit", { ...advanced, result: result || advanced.result, cursor: pages.cursor, limit: 50 });
  const activeFilters = Object.values(advanced).filter(Boolean).length;
  const data = summary.data;
  const changeResult = (value: typeof result) => { setResult(value); pages.reset(); };

  return (
    <>
      <PageHeader title="业务审计" />
      {summary.loading && !data ? <SkeletonMetrics /> : summary.error ? <ErrorState title="日志汇总暂不可用" code={summary.error} onRetry={() => void summary.reload()} /> : data && (
        <Metrics items={[
          { label: "24h 操作", value: formatNumber(data.audit.total), icon: History, tint: "blue" },
          { label: "成功", value: formatNumber(data.audit.succeeded), note: data.audit.total ? formatPercent(data.audit.succeeded / data.audit.total) : undefined, tone: "muted", icon: CircleCheck, tint: "green", onClick: () => changeResult("succeeded") },
          { label: "失败", value: formatNumber(data.audit.failed), note: data.audit.total ? formatPercent(data.audit.failed / data.audit.total) : undefined, tone: "muted", icon: CircleAlert, tint: "red", onClick: () => changeResult("failed") },
          { label: "系统错误 · 24h", value: formatNumber(data.system.errors), icon: Server, tint: "amber" },
        ]} />
      )}
      <ListPanel label="审计记录" resetKey={`${result}|${pages.cursor ?? ""}|${JSON.stringify(advanced)}`} footer={<LogPager list={list} pages={pages} />} toolbar={(
        <div className="adm-filterbar is-audit">
          <TextTabs label="审计结果" value={result} onChange={changeResult} options={[
            { value: "", label: "全部", count: data?.audit.total },
            { value: "succeeded", label: "成功", count: data?.audit.succeeded },
            { value: "failed", label: "失败", count: data?.audit.failed },
          ]} />
          <Button className="adm-filter-btn" onClick={() => setFilterOpen(true)}><Layers size={14} strokeWidth={2} aria-hidden="true" />筛选{activeFilters ? ` · ${activeFilters}` : ""}</Button>
        </div>
      )}>
        <AuditFeed list={list} onSelect={setSelected} />
      </ListPanel>
      {filterOpen && <LogFilterDrawer kind="audit" value={advanced} onClose={() => setFilterOpen(false)} onApply={(next) => { setAdvanced(next); pages.reset(); setFilterOpen(false); }} />}
      {selected && <LogDetailModal item={selected} kind="audit" onClose={() => setSelected(null)} />}
    </>
  );
}

function AuditFeed({ list, onSelect }: { list: ReturnType<typeof useLogList>; onSelect: (item: LogItem) => void }) {
  if (list.loading && !list.data) return <LoadingRegion label="正在加载日志…"><SkeletonRows rows={6} columns={4} /></LoadingRegion>;
  if (list.error && !list.data) return <ErrorState title="日志查询暂不可用" code={list.error} onRetry={() => void list.reload()} />;
  const items = list.data?.items ?? [];
  return (
    <>
      {list.data?.partial && <p className="adm-hint-line" role="status">部分异常日志行已忽略（{list.data.droppedMalformed} 条）。</p>}
      {items.length === 0 ? <div className="adm-state"><strong>当前筛选下没有日志</strong></div> : (
        <ul className={`adm-feed adm-audit${list.loading ? " is-busy" : ""}`} aria-label="审计记录">
          {items.map((row, index) => {
            const action = auditAction(row.action);
            return (
              <li
                key={row.eventId}
                className="is-clickable"
                tabIndex={0}
                aria-label={`查看日志 ${row.eventId}`}
                style={{ "--adm-i": Math.min(index, 12) } as React.CSSProperties}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); onSelect(row); } }}
              >
                <time>{formatWhen(row.timestamp, "—", { compact: true })}</time>
                <Chip icon={action.icon} tint={row.result === "failed" ? "red" : action.tint} size={30} />
                <div className="adm-feed-copy"><strong>{action.label}{row.result === "failed" && "失败"}</strong><span>{row.actorType ?? "—"}:{row.actorUserId ?? "—"} → {row.targetType ?? "—"}{row.targetId ? `:${row.targetId}` : ""}</span></div>
                <code className="adm-audit-code">{row.action ?? "—"}</code>
                <StatusDot tone={row.result === "failed" ? "bad" : "ok"}>{row.result === "failed" ? "失败" : "成功"}</StatusDot>
                <ChevronRight size={16} className="adm-chevron" aria-hidden="true" />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Cursor pager for the log panels; sits in the panel footer so it stays visible while the list scrolls. */
function LogPager({ list, pages }: { list: ReturnType<typeof useLogList>; pages: ReturnType<typeof useCursorPages> }) {
  if (!list.data) return null;
  return (
    <TableFooter>
      <div>
        <Button disabled={!pages.hasPrevious || list.loading} onClick={pages.previous}>上一页</Button>
        <Button disabled={!list.data.nextCursor || list.loading} onClick={() => pages.next(list.data?.nextCursor)}>下一页</Button>
      </div>
    </TableFooter>
  );
}

function LogTable({ list, onSelect }: { list: ReturnType<typeof useLogList>; onSelect: (item: LogItem) => void }) {
  if (list.loading && !list.data) return <LoadingRegion label="正在加载日志…"><SkeletonRows rows={6} columns={5} /></LoadingRegion>;
  if (list.error && !list.data) return <ErrorState title="日志查询暂不可用" code={list.error} onRetry={() => void list.reload()} />;
  const items = list.data?.items ?? [];
  return (
    <>
      {list.data?.partial && <p className="adm-hint-line" role="status">部分异常日志行已忽略（{list.data.droppedMalformed} 条）。</p>}
      <DataTable<LogItem>
        busy={list.loading}
        rows={items}
        rowKey={(row) => row.eventId}
        onRowClick={onSelect}
        rowLabel={(row) => `查看日志 ${row.eventId}`}
        empty="当前筛选下没有日志"
        columns={[
          { key: "event", label: "事件", width: "minmax(0, 1fr)", render: (row) => <span className="adm-cell-stack is-tight"><strong className="adm-ellipsis adm-small">{row.errorCode ?? row.message}</strong><small className="adm-ellipsis">{row.httpRoute ? `${row.httpMethod ?? ""} ${row.httpRoute}` : row.summary ?? row.logger}</small></span> },
          { key: "source", label: "来源", width: "130px", render: (row) => <span className="adm-ink2">{row.source}</span> },
          { key: "level", label: "级别", width: "70px", render: (row) => <span className={`adm-level is-${levelTone(row.level)}`}>{row.level === "WARNING" ? "WARN" : row.level}</span> },
          { key: "dependency", label: "依赖", width: "80px", render: (row) => <span className="adm-ink2 adm-medium adm-small">{row.dependency ? dependencyLabels[row.dependency] ?? row.dependency : "—"}</span> },
          { key: "time", label: "时间", width: "60px", align: "right", render: (row) => <span className="adm-ink2">{formatWhen(row.timestamp, "—", { compact: true })}</span> },
                ]}
      />
    </>
  );
}

function LogFilterDrawer({ kind, value, onClose, onApply }: { kind: LogKind; value: SystemLogQuery & AuditLogQuery; onClose: () => void; onApply: (next: SystemLogQuery & AuditLogQuery) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? "")])), from: "", to: "" }));
  const set = (key: string) => (next: string) => setDraft((current) => ({ ...current, [key]: next }));
  const text = (key: string, label: string, placeholder: string) => (
    <Field label={label} htmlFor={`log-filter-${key}`}><input id={`log-filter-${key}`} className="adm-input" value={draft[key] ?? ""} placeholder={placeholder} onChange={(event) => set(key)(event.target.value)} /></Field>
  );
  const chips = (key: string, options: Array<[string, string]>) => (
    <div className="adm-chip-row" role="group" aria-label={key}>
      {options.map(([option, label]) => <button key={option} type="button" className="adm-chip" aria-pressed={draft[key] === option} onClick={() => set(key)(draft[key] === option ? "" : option)}>{label}</button>)}
    </div>
  );
  const apply = () => {
    const next: Record<string, string | undefined> = {};
    for (const [key, item] of Object.entries(draft)) if (item.trim()) next[key] = key === "from" || key === "to" ? fromLocalInput(item) ?? undefined : item.trim();
    onApply(next as SystemLogQuery & AuditLogQuery);
  };
  return (
    <Drawer title={kind === "system" ? "筛选日志" : "筛选审计记录"} subtitle="默认最近 24 小时" onClose={onClose} width={420}
      footer={<><Button onClick={() => setDraft({})}>重置</Button><Button variant="primary" onClick={apply}>应用</Button></>}>
      <div className="adm-form">
        {kind === "system" ? (
          <>
            <Field label="级别">{chips("level", [["INFO", "INFO"], ["WARNING", "WARNING"], ["ERROR", "ERROR"]])}</Field>
            <Field label="来源">{chips("source", [["backend", "Backend"], ["web", "Web"]])}</Field>
            <Field label="依赖">{chips("dependency", [["mysql", "mysql"], ["redis", "redis"], ["minio", "minio"], ["linkparse", "linkparse"], ["llm", "llm"]])}</Field>
            {text("keyword", "日志关键词", "例如 auth")}
            {text("requestId", "请求 ID", "req_…")}
            {text("taskId", "任务 ID", "task_…")}
            {text("operationId", "操作 ID", "op_…")}
            {text("errorCode", "错误码", "ERROR_CODE")}
          </>
        ) : (
          <>
            {text("action", "审计动作", "例如 admin.llm_connection_update")}
            <Field label="结果">{chips("result", [["succeeded", "成功"], ["failed", "失败"]])}</Field>
            {text("actorUserId", "操作者 ID", "100003")}
            {text("targetType", "目标类型", "llm_connection")}
            {text("targetId", "目标 ID", "7")}
            {text("requestId", "请求 ID", "req_…")}
          </>
        )}
        <div className="adm-form-row">
          <Field label="开始时间" htmlFor="log-filter-from"><DateTimeInput id="log-filter-from" label="开始时间" value={draft.from ?? ""} onChange={set("from")} placeholder="不限" /></Field>
          <Field label="结束时间" htmlFor="log-filter-to"><DateTimeInput id="log-filter-to" label="结束时间" value={draft.to ?? ""} onChange={set("to")} placeholder="不限" defaultTime="23:59" /></Field>
        </div>
      </div>
    </Drawer>
  );
}

function LogDetailModal({ item, kind, onClose }: { item: LogItem; kind: LogKind; onClose: () => void }) {
  const { notify } = useConsole();
  const heading = kind === "system" ? (item.errorCode ?? item.message) : (item.action ?? "—");
  return (
    <Modal
      width={kind === "system" ? 640 : 600}
      eyebrow={kind === "system" ? "系统日志 · 日志详情" : "业务审计 · 日志详情"}
      title={<span className="adm-title-row">{heading}{kind === "system" ? <Badge tone={levelTone(item.level)}>{item.level}</Badge> : <Badge tone={item.result === "failed" ? "bad" : "ok"}>{item.result === "failed" ? "失败" : "成功"}</Badge>}</span>}
      subtitle={`${formatDateTime(item.timestamp)}${kind === "system" ? ` · ${item.source} · ${item.logger}` : ""}`}
      onClose={onClose}
      footer={<><Button onClick={() => copyText(item.eventId, notify, "已复制事件 ID")}>复制事件 ID</Button><Button variant="primary" dismiss>关闭</Button></>}
    >
      {(item.summary ?? item.message) && <p className="adm-callout">{item.summary ?? item.message}</p>}
      <DetailList items={kind === "system" ? [
        ["事件 ID", <code className="adm-code">{item.eventId}</code>],
        ["请求 ID", item.requestId],
        ["操作 ID", item.operationId],
        ["任务 ID", item.taskId],
        ["依赖", item.dependency],
        ["HTTP", [item.httpMethod, item.httpRoute].filter(Boolean).join(" ") || null],
        ["状态码 · 耗时", item.httpStatus != null ? `${item.httpStatus}${item.durationMs != null ? ` · ${item.durationMs} ms` : ""}` : null],
        ["错误码", item.errorCode],
        ["异常类型", item.exceptionType],
      ] : [
        ["操作者", `${item.actorType ?? "—"}:${item.actorUserId ?? "—"}`],
        ["目标", `${item.targetType ?? "—"}:${item.targetId ?? "—"}`],
        ["HTTP", [item.httpMethod, item.httpRoute].filter(Boolean).join(" ") || null],
        ["状态码", item.httpStatus],
        ["请求 ID", item.requestId],
        ["操作 ID", item.operationId],
        ["错误码", item.errorCode],
      ]} />
      {item.exceptionStack && <><h3 className="adm-subhead">异常堆栈</h3><pre className="adm-pre">{item.exceptionStack}</pre></>}
    </Modal>
  );
}

/* ---------- 13 LLM calls ---------- */

const callStatus: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "info", label: "进行中" },
  succeeded: { tone: "ok", label: "成功" },
  failed: { tone: "bad", label: "失败" },
  cancelled: { tone: "muted", label: "取消" },
};
const callWindows = { "": "全部时间", "24h": "24 小时", "7d": "7 天", "31d": "31 天" } as const;
const callErrorHints: Record<string, string> = {
  AUTH_FAILED: "上游认证失败。检查该连接的 API Key 后，到能力配置中重新探测。",
  RATE_LIMITED: "上游限流，稍后会自动恢复；持续出现时考虑增加线路。",
  TIMEOUT: "上游响应超时。",
};

export function LlmCallsPage() {
  const llm = useLoad(async () => {
    const [routes, models, connections] = await Promise.all([api.listLlmRoutes(), api.listLlmModels(), api.listLlmConnections()]);
    return { routes: routes.routes, models: models.models, connections: connections.connections };
  });
  const [useCase, setUseCase] = useState("");
  const [status, setStatus] = useState<"" | NonNullable<LlmCallQuery["status"]>>("");
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState<ReturnType<typeof parseRecordSearch>>(null);
  const [range, setRange] = useState<keyof typeof callWindows>("24h");
  const [items, setItems] = useState<LlmCallRecord[]>([]);
  const [selected, setSelected] = useState<LlmCallRecord | null>(null);
  const query = useMemo<LlmCallQuery>(() => {
    const hours = { "": 0, "24h": 24, "7d": 168, "31d": 744 }[range];
    const to = new Date();
    return {
      useCase: useCase || undefined,
      status: status || undefined,
      errorCode: appliedSearch?.kind === "error" ? appliedSearch.value : undefined,
      callId: appliedSearch?.kind === "id" ? appliedSearch.value : undefined,
      userId: appliedSearch?.kind === "user" ? appliedSearch.value : undefined,
      ...(hours ? { from: new Date(to.getTime() - hours * 3600_000).toISOString(), to: to.toISOString() } : {}),
      limit: 50,
    };
  }, [useCase, status, appliedSearch, range]);
  const queryRef = useRef(query);
  queryRef.current = query;
  const list = useLoad(() => api.listLlmCalls(query), [query]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Only the latest first page (guarded by useLoad) resets the list; later pages append to it.
  useEffect(() => {
    setItems(list.data?.calls ?? []);
    setNextCursor(list.data?.nextCursor != null ? String(list.data.nextCursor) : null);
  }, [list.data]);

  const loadMore = async () => {
    if (!nextCursor) return;
    const forQuery = query;
    setLoadingMore(true);
    try {
      const result = await api.listLlmCalls({ ...forQuery, cursor: nextCursor });
      if (forQuery !== queryRef.current) return;
      setItems((current) => [...current, ...result.calls]);
      setNextCursor(result.nextCursor != null ? String(result.nextCursor) : null);
    } finally { setLoadingMore(false); }
  };

  const routeLabel = (routeId: string) => {
    const route = llm.data?.routes.find((item) => item.id === routeId);
    const model = llm.data?.models.find((item) => item.id === route?.modelId);
    return model ? `#${routeId} · ${model.displayName}` : `#${routeId}`;
  };
  const connectionName = (routeId: string) => {
    const route = llm.data?.routes.find((item) => item.id === routeId);
    return llm.data?.connections.find((item) => item.id === route?.connectionId)?.name;
  };
  const summary = list.data?.summary;

  return (
    <>
      <PageHeader title="LLM 调用日志" actions={<Button onClick={() => void list.reload()}>刷新</Button>} />
      {list.loading && !summary ? <SkeletonMetrics /> : summary && (
        <Metrics items={[
          { label: "调用次数", value: formatNumber(summary.callCount), note: "当前筛选", icon: Zap, tint: "blue" },
          { label: "成功", value: formatNumber(summary.succeeded), note: summary.callCount ? formatPercent(summary.succeeded / summary.callCount) : undefined, tone: "muted", icon: BadgeCheck, tint: "green" },
          { label: "失败", value: formatNumber(summary.failed), icon: CircleAlert, tint: "red", onClick: () => setStatus("failed") },
          { label: "估算费用", value: formatCosts(summary), note: summary.unmeteredCallCount ? `${summary.unmeteredCallCount} 次未计价` : `${formatCompact(summary.inputTokens)} / ${formatCompact(summary.outputTokens)} Token`, tone: "muted", icon: Coins, tint: "amber" },
        ]} />
      )}
      <ListPanel label="调用记录" resetKey={JSON.stringify(query)}
        toolbar={(
        <div className="adm-filterbar">
          <TextTabs label="调用状态" value={status} onChange={setStatus} options={[{ value: "", label: "全部" }, { value: "succeeded", label: "成功" }, { value: "failed", label: "失败" }, { value: "pending", label: "进行中" }]} />
          <SearchInput value={searchText} onChange={(next) => { setSearchText(next); if (!next.trim()) setAppliedSearch(null); }} placeholder="调用 ID / 用户 ID / 错误码" width={200} onSubmit={() => setAppliedSearch(parseRecordSearch(searchText))} />
          <SelectBox label="场景" icon={Workflow} className="adm-filter-select" value={useCase} onChange={setUseCase} options={[{ value: "", label: "全部能力" }, ...Object.keys(useCaseLabels).map((value) => ({ value, label: useCaseLabel(value) }))]} />
          <SelectBox label="时间范围" icon={CalendarClock} className="adm-filter-select" value={range} onChange={setRange} options={Object.entries(callWindows).map(([value, label]) => ({ value: value as keyof typeof callWindows, label }))} />
        </div>
        )}
        footer={items.length > 0 && (
          <TableFooter>
              {nextCursor && <Button disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "加载中…" : "加载更多"}</Button>}
            </TableFooter>
        )}
      >
        {list.loading && !list.data ? <LoadingRegion label="正在加载调用记录…"><SkeletonRows rows={6} columns={7} /></LoadingRegion> : list.error ? <ErrorState code={list.error} onRetry={() => void list.reload()} /> : (
          <>
            <DataTable<LlmCallRecord>
              busy={list.loading}
              setKey={JSON.stringify(query)}
              rows={items}
              rowKey={(row) => row.id}
              onRowClick={setSelected}
              rowLabel={(row) => `查看调用 ${row.callId}`}
              empty="当前筛选下没有调用"
              columns={[
                { key: "time", label: "请求时间", width: "60px", render: (row) => <span className="adm-ink2">{formatWhen(row.requestStartedAt, "待核实", { compact: true })}</span> },
                { key: "useCase", label: "能力", width: "110px", render: (row) => <strong className="adm-medium">{useCaseLabel(row.useCase)}</strong> },
                { key: "source", label: "来源", width: "80px", render: (row) => <span className="adm-ink2">{row.source}</span> },
                { key: "route", label: "线路 / 协议", width: "minmax(0, 1fr)", render: (row) => <span className="adm-cell-stack"><span className="adm-ellipsis adm-ink2">{routeLabel(row.routeId)}</span><small className="adm-medium adm-faint">{row.errorCode ? <span className="adm-tone-bad">{row.errorCode}</span> : row.protocolCode}</small></span> },
                { key: "tokens", label: "Token", width: "110px", align: "right", render: (row) => <span className="adm-ink2">{formatNumber(row.inputTokens)} / {formatNumber(row.outputTokens)}</span> },
                { key: "cost", label: "费用", width: "70px", align: "right", render: (row) => <span className="adm-ink2">{row.estimatedCost ? formatMoney(row.estimatedCost, row.costCurrency) : row.status === "succeeded" ? "未计价" : "—"}</span> },
                { key: "status", label: "状态", width: "80px", render: (row) => <StatusDot tone={(callStatus[row.status] ?? callStatus.cancelled).tone}>{(callStatus[row.status] ?? { label: row.status }).label}</StatusDot> },
              ]}
            />
          </>
        )}
      </ListPanel>
      <Footnote icon={Shield}>记录实际使用的线路、用量与费用，不包含提示词和回复正文。</Footnote>
      {selected && (
        <Modal
          width={600}
          onClose={() => setSelected(null)}
          eyebrow="LLM 调用详情"
          title={<span className="adm-title-row">{selected.source}<Badge tone={(callStatus[selected.status] ?? callStatus.cancelled).tone}>{(callStatus[selected.status] ?? { label: selected.status }).label}</Badge></span>}
          subtitle={`${selected.requestStartedAt ? formatDateTime(selected.requestStartedAt) : "请求时间待核实"} · ${useCaseLabel(selected.useCase)} · 不包含提示词和回复正文`}
          footer={<><CopyCallId value={selected.callId} /><Button variant="primary" dismiss>关闭</Button></>}
        >
          <DetailList items={[
            ["Call ID", <code className="adm-code">{selected.callId}</code>],
            ["场景", useCaseLabel(selected.useCase)],
            ["用户 ID", selected.userId ?? "—"],
            ["线路", `${routeLabel(selected.routeId)}${connectionName(selected.routeId) ? ` · ${connectionName(selected.routeId)}` : ""}`],
            ["协议", <code className="adm-code">{selected.protocolCode}</code>],
            ["Agent Run", selected.agentRunId ?? "—"],
            ["Token（入 / 出）", `${formatNumber(selected.inputTokens)} / ${formatNumber(selected.outputTokens)}`],
            ["计量", selected.meteringStatus],
            ["估算费用", selected.estimatedCost != null ? formatMoney(selected.estimatedCost, selected.costCurrency) : "—"],
            ["结算费用", selected.settledCost != null ? formatMoney(selected.settledCost, selected.settledCurrency) : "—"],
            ["计费状态 / 原因", `${selected.costState ?? "历史记录"}${selected.costReason ? ` / ${selected.costReason}` : ""}`],
            ["请求时间依据", selected.timeBasis ?? "待核实"],
            ["供应商请求 ID", selected.upstreamRequestId ?? "—"],
            ["价格 / 费用版本", `${selected.priceRevisionId ?? "—"} / ${selected.costRevisionId ?? "—"}`],
          ]} />
          {selected.normalizedUsage && <details><summary>计费用量</summary><pre>{JSON.stringify(selected.normalizedUsage, null, 2)}</pre></details>}
          {selected.priceSnapshot && <details><summary>冻结的价格依据</summary><pre>{JSON.stringify(selected.priceSnapshot, null, 2)}</pre></details>}
          {selected.errorCode && <InlineError>错误码 {selected.errorCode}{callErrorHints[selected.errorCode] ? `：${callErrorHints[selected.errorCode]}` : ""}</InlineError>}
        </Modal>
      )}
    </>
  );
}

function CopyCallId({ value }: { value: string }) {
  const { notify } = useConsole();
  return <Button onClick={() => copyText(value, notify, "已复制 Call ID")}>复制 Call ID</Button>;
}
