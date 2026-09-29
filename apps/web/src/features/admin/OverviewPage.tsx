import { useMemo } from "react";
import { Activity, ChevronRight, CircleAlert, Coins, Database, Info, Layers, Megaphone, Server, UserPlus, Users, Workflow, Zap, type LucideIcon } from "lucide-react";
import { api, type AdminInsightAlert, type User } from "../../api/client";
import { ThinBars } from "./charts";
import {
  Chip,
  ErrorState,
  LinkButton,
  LoadingRegion,
  Metrics,
  PageHeader,
  SkBar,
  SkeletonChart,
  SkeletonMetrics,
  StatusDot,
  formatCosts,
  formatDelta,
  formatMs,
  formatDayLabel,
  formatNumber,
  formatPercent,
  useConsole,
  useLoad,
  type Tint,
} from "./kit";

const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/** Alert targets come from the insights API as section paths ("models/usage"). */
const alertPaths: Record<string, string> = {
  "models/capabilities": "/admin/llm/capabilities",
  "models/usage": "/admin/llm/usage",
  "security/agent-trace": "/admin/agent-operations",
  "content/templates/classification": "/admin/templates",
};

/** Icon per alert type; tint follows severity. */
const alertIcons: Record<string, LucideIcon> = {
  llm_binding_invalid: CircleAlert,
  llm_success_rate: Activity,
  agent_failures: Workflow,
  template_review: Layers,
};
const severityTint: Record<AdminInsightAlert["severity"], Tint> = { critical: "red", warning: "amber", info: "blue" };

export function OverviewPage({ user }: { user: User }) {
  const { navigate } = useConsole();
  const now = useMemo(() => new Date(), []);
  const overview = useLoad(() => api.adminInsightOverview());
  const announcements = useLoad(() => api.adminAnnouncementStats());
  const logs = useLoad(() => api.adminLogSummary());
  const data = overview.data;

  const trend = data?.trend ?? [];
  const finished = trend.filter((day) => day.successRate != null);
  const avgRate = finished.length ? finished.reduce((sum, day) => sum + (day.successRate ?? 0), 0) / finished.length : null;
  const p95 = trend.reduce<number | null>((worst, day) => (day.p95Ms == null ? worst : Math.max(worst ?? 0, day.p95Ms)), null);
  const total = trend.reduce((sum, day) => sum + day.calls, 0);

  const metric = (label: string, value: string, change: string | null | undefined, icon: LucideIcon, tint: Tint) => {
    const parsed = formatDelta(change);
    return { label, value, note: parsed?.text, tone: parsed?.tone, icon, tint };
  };

  return (
    <>
      <PageHeader title={`${greeting(now)}，${user.nickname}`} meta={`${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}`} />
      {overview.loading && !data ? (
        <LoadingRegion label="正在加载总览…">
          <SkeletonMetrics />
          <SkeletonChart height={228} />
        </LoadingRegion>
      ) : overview.error || !data ? (
        <ErrorState code={overview.error} onRetry={() => void overview.reload()} />
      ) : (
        <>
          <Metrics items={[
            metric("7 日活跃", formatNumber(data.metrics.activeUsers7d), data.deltas.activeUsers7d, Users, "blue"),
            metric("7 日新增", formatNumber(data.metrics.newUsers7d), data.deltas.newUsers7d, UserPlus, "violet"),
            metric("今日 LLM 调用", formatNumber(data.metrics.callsToday), data.deltas.callsToday, Zap, "amber"),
            { label: "7 日费用", value: formatCosts(data.metrics.cost7d), note: data.metrics.cost7d.unmeteredCallCount ? `${data.metrics.cost7d.unmeteredCallCount} 次未计价` : "估算", icon: Coins, tint: "green" },
          ]} />
          <section className="adm-section adm-overview-trend">
            <div className="adm-block-head">
              <div className="adm-block-title"><h2>LLM 调用</h2><span>最近 14 天</span></div>
              <span className="adm-inline-stats"><span>成功率 {formatPercent(avgRate)}</span><span>P95 {formatMs(p95)}</span></span>
            </div>
            <p className="adm-hero-number"><strong>{formatNumber(total)}</strong><span>次调用 · 最近 {trend.length} 天合计</span></p>
            <ThinBars
              height={228}
              barWidth={24}
              ariaLabel="最近 14 天 LLM 调用次数"
              data={trend.map((day, index) => ({
                key: day.date,
                label: index === trend.length - 1 ? "今天" : `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`,
                value: day.calls,
                tooltip: <><small>{formatDayLabel(day.date)}</small><strong>调用 {day.calls.toLocaleString("en-US")} 次</strong></>,
              }))}
            />
          </section>
          <section className="adm-section">
            <div className="adm-block-head"><div className="adm-block-title"><h2>今日关注</h2><span>{data.alerts.length ? `${data.alerts.length} 项` : "由运行数据自动推导"}</span></div></div>
            {data.alerts.length === 0 ? (
              <p className="adm-empty-line"><StatusDot tone="ok">当前没有需要处理的事项</StatusDot></p>
            ) : (
              <ul className="adm-feed adm-attention">
                {data.alerts.map((alert, index) => (
                  <li key={alert.type} style={{ "--adm-i": index } as React.CSSProperties}>
                    <Chip icon={alertIcons[alert.type] ?? Info} tint={severityTint[alert.severity]} size={30} />
                    <div className="adm-feed-copy"><strong>{alert.title}</strong><span>{alert.description}</span></div>
                    {alertPaths[alert.target] && (
                      <LinkButton onClick={() => navigate(alertPaths[alert.target])}>
                        {alert.severity === "critical" ? "去处理" : "查看"}<ChevronRight size={14} aria-hidden="true" />
                      </LinkButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <section className="adm-system" aria-label="系统状态">
        <span className="adm-system-title">系统状态</span>
        <span className="adm-system-item"><Server size={15} aria-hidden="true" />API<StatusDot tone={overview.error ? "bad" : "ok"}>{overview.error ? "异常" : "正常"}</StatusDot></span>
        <span className="adm-system-item"><Database size={15} aria-hidden="true" />日志服务 Loki<StatusDot tone={logs.loading ? "muted" : logs.error ? "warn" : "ok"}>{logs.loading ? "检查中" : logs.error ? "不可用" : "正常"}</StatusDot></span>
        <span className="adm-system-item"><Megaphone size={15} aria-hidden="true" />有效公告<StatusDot tone="info">{announcements.data ? `${announcements.data.active} 条` : announcements.loading ? <SkBar width={24} /> : "—"}</StatusDot></span>
      </section>
    </>
  );
}
