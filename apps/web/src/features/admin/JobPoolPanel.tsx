import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Info, RefreshCw } from "lucide-react";
import { api, ApiRequestError, type PoolSource } from "../../api/client";
import { PoolCompanyLogo } from "../jobs/PoolUi";
import { poolError } from "../jobs/jobPoolPresentation";
import {
  Button, DataTable, ErrorState, Footnote, InlineError, ListPanel, LoadingRegion, Modal, PageHeader, SearchInput, SelectBox,
  SkeletonRows, StatusDot, TextTabs, Toggle, useLoad, type Tone,
} from "./kit";
import "./job-pool.css";

const PAGE_SIZE = 10;
const CHANNELS: Record<string, string> = { campus: "校招", experienced: "社招", internship: "实习" };
const ACTIVE = new Set(["queued", "running"]);

type StatusKey = "disabled" | "pending" | "first" | "running" | "ok" | "partial" | "failed" | "anomalous" | "cancelled";
const STATUS: Record<StatusKey, { label: string; tone: Tone }> = {
  disabled: { label: "未启用", tone: "muted" },
  pending: { label: "官网待适配", tone: "muted" },
  first: { label: "待首次同步", tone: "muted" },
  running: { label: "同步中", tone: "info" },
  ok: { label: "正常", tone: "ok" },
  partial: { label: "部分完成", tone: "warn" },
  failed: { label: "同步失败", tone: "bad" },
  anomalous: { label: "数量异常 · 待确认", tone: "warn" },
  cancelled: { label: "已取消", tone: "muted" },
};

function statusOf(source: PoolSource): StatusKey {
  if (!source.adapter_ready) return "pending";
  if (!source.is_enabled) return "disabled";
  if (ACTIVE.has(source.sync_status)) return "running";
  if (!source.last_sync_result.latest?.finished_at && !source.last_complete_at) return "first";
  return ({ succeeded: "ok", complete: "ok", partial: "partial", failed: "failed", anomalous: "anomalous", cancelled: "cancelled" } as Record<string, StatusKey>)[source.sync_status] ?? "first";
}

const channelText = (source: PoolSource) => source.supported_channels.map((channel) => CHANNELS[channel] ?? channel).join(" / ");
const hostOf = (source: PoolSource) => { try { return new URL(source.careers_url).hostname; } catch { return source.tenant_key; } };
const needsReview = (source: PoolSource) => source.sync_status === "anomalous" && Boolean(source.last_sync_result.latest?.is_complete) && !source.last_sync_result.latest?.is_reviewed;

/** 今天 08:05 / 昨天 16:20 / 9 月 30 日 */
export function shortWhen(value: string | null | undefined, fallback = "尚未同步") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === new Date().toDateString()) return `今天 ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function pageList(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((page, index) => index && page - sorted[index - 1]! > 1 ? ["gap" as const, page] : [page]);
}

export function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return <nav className="pool-pager" aria-label="分页">
    <button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
    {pageList(page, total).map((item, index) => item === "gap" ? <span key={`gap-${index}`} aria-hidden="true">…</span>
      : <button key={item} type="button" aria-current={item === page ? "page" : undefined} onClick={() => onChange(item)}>{item}</button>)}
    <button type="button" aria-label="下一页" disabled={page >= total} onClick={() => onChange(page + 1)}>›</button>
  </nav>;
}

export function JobPoolPanel() {
  const sources = useLoad(() => api.listPoolSources());
  const [busy, setBusy] = useState<string | null>(null);
  const runningAction = useRef(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "enabled" | "disabled">("all");
  const [status, setStatus] = useState<"" | StatusKey>("");
  const [channel, setChannel] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const items = sources.data?.items ?? [];
  const syncEnabled = sources.data?.sync_enabled ?? true;
  const running = items.some((source) => ACTIVE.has(source.sync_status));
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void sources.reload(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [running, sources.reload]);
  useEffect(() => { setPage(1); }, [tab, status, channel, keyword]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    if (runningAction.current) return;
    runningAction.current = true; setBusy(id); setError("");
    try { await action(); await sources.reload(); }
    catch (reason) {
      setError(poolError(reason));
      // A stale generation is refreshed so the next attempt uses the current one.
      if (reason instanceof ApiRequestError && reason.status === 409) await sources.reload();
    } finally { runningAction.current = false; setBusy(null); }
  };
  const toggle = (source: PoolSource, next: boolean) => void run(source.id, () => api.setPoolSourceEnabled(source, next));
  const syncNow = (source: PoolSource) => void run(source.id, () => api.syncPoolSource(source.id));

  const text = keyword.trim().toLocaleLowerCase();
  const filtered = useMemo(() => items.filter((source) =>
    (tab === "all" || (tab === "enabled") === source.is_enabled)
    && (!status || statusOf(source) === status)
    && (!channel || source.supported_channels.includes(channel))
    && (!text || [source.company_name, source.tenant_key, source.careers_url].some((value) => value.toLocaleLowerCase().includes(text)))), [items, tab, status, channel, text]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const enabledCount = items.filter((source) => source.is_enabled).length;
  const companies = new Set(items.map((source) => source.company_id)).size;
  const selected = items.find((source) => source.id === selectedId);

  return <>
    <PageHeader title="官网岗位池" meta={sources.data ? `${companies} 家企业 · ${items.length} 个招聘来源 · 已启用 ${enabledCount} 个 · 启用后由后台定时同步，也可以随时手动同步。` : "启用后由后台定时同步，也可以随时手动同步。"} />
    {sources.data && !syncEnabled && <p className="pool-admin-notice" role="status"><i aria-hidden="true" />后台同步已在环境配置中关闭：仍可启用或停用来源，但不会自动同步，也不能立即同步。</p>}
    {error && !selected && <InlineError>{error}</InlineError>}
    <ListPanel label="招聘来源" resetKey={`${tab}|${status}|${channel}|${text}|${current}`}
      toolbar={<div className="adm-filterbar pool-admin-filterbar">
        <TextTabs label="启用状态" value={tab} onChange={setTab} options={[
          { value: "all", label: "全部", count: sources.data ? items.length : null },
          { value: "enabled", label: "已启用", count: sources.data ? enabledCount : null },
          { value: "disabled", label: "未启用", count: sources.data ? items.length - enabledCount : null },
        ]} />
        <div className="adm-toolbar-right">
          <SelectBox label="同步状态" value={status} onChange={setStatus} className="pool-admin-select" options={[
            { value: "", label: "同步状态：全部" },
            ...(["ok", "running", "partial", "failed", "anomalous", "first", "disabled", "pending"] as const).map((key) => ({ value: key, label: `同步状态：${STATUS[key].label}` })),
          ]} />
          <SelectBox label="覆盖渠道" value={channel} onChange={setChannel} className="pool-admin-select" options={[
            { value: "", label: "覆盖渠道：全部" }, ...Object.entries(CHANNELS).map(([value, label]) => ({ value, label: `覆盖渠道：${label}` })),
          ]} />
          <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索企业名称 / 招聘来源" width={220} />
        </div>
      </div>}
      footer={sources.data && <div className="pool-admin-foot">
        {filtered.length > 0 && <div className="pool-admin-pages">
          <span>共 {filtered.length} 个来源 · 每页 {PAGE_SIZE} 个</span>
          {totalPages > 1 && <Pager page={current} total={totalPages} onChange={setPage} />}
        </div>}
        <Footnote icon={Info}>点击行查看同步结果；“启用”切换立即生效，停用后已有岗位和个人记录继续保留。数量异常需在详情里确认后才会处理上下线。</Footnote>
      </div>}>
      {sources.loading && !sources.data ? <LoadingRegion label="正在加载招聘来源…"><SkeletonRows rows={8} columns={6} /></LoadingRegion>
        : sources.error ? <ErrorState title="招聘来源暂时无法加载" code={sources.error} onRetry={() => void sources.reload()} />
          : <DataTable<PoolSource> className="pool-source-table" busy={sources.loading} rows={rows} rowKey={(row) => row.id}
            setKey={`${tab}|${status}|${channel}|${text}|${current}`}
            empty={items.length ? "没有符合条件的来源，请调整筛选条件。" : "预置来源会在服务启动时自动登记，请稍后刷新。"}
            onRowClick={(row) => { setError(""); setSelectedId(row.id); }} rowLabel={(row) => `查看${row.company_name}的同步结果`}
            columns={[
              { key: "company", label: "企业 / 官方来源", width: "minmax(220px, 2.4fr)", render: (row) => <span className="pool-source-company">
                <PoolCompanyLogo company={{ name: row.company_name, logo_url: row.company_logo_url }} />
                <span><strong>{row.company_name}</strong><small>{hostOf(row)}</small></span>
              </span> },
              { key: "channels", label: "覆盖渠道", width: "minmax(110px, 1.2fr)", render: (row) => channelText(row)
                ? <span aria-label={`覆盖渠道：${channelText(row).split(" / ").join("、")}`}>{channelText(row)}</span> : <span className="pool-faint">尚未确认</span> },
              { key: "status", label: "同步状态", width: "minmax(120px, 1.3fr)", render: (row) => <StatusDot tone={STATUS[statusOf(row)].tone}>{STATUS[statusOf(row)].label}</StatusDot> },
              { key: "count", label: "本轮岗位", width: "72px", align: "right", render: (row) => row.last_sync_result.latest?.finished_at ? row.last_sync_result.latest.observed_count : "—" },
              { key: "complete", label: "上次完整同步", width: "minmax(100px, 1fr)", render: (row) => shortWhen(row.last_complete_at) },
              { key: "enabled", label: "启用", width: "56px", render: (row) => <Toggle checked={row.is_enabled} label={`${row.is_enabled ? "停用" : "启用"}${row.company_name}`}
                disabled={busy !== null || !row.adapter_ready} onChange={(next) => toggle(row, next)} /> },
              { key: "sync", label: "", width: "104px", align: "right", render: (row) => <Button className="pool-sync-btn" disabled={busy !== null || !syncEnabled || !row.is_enabled || !row.adapter_ready || ACTIVE.has(row.sync_status)}
                onClick={(event) => { event.stopPropagation(); syncNow(row); }}><RefreshCw size={13} aria-hidden="true" />{ACTIVE.has(row.sync_status) ? "同步中…" : "立即同步"}</Button> },
            ]} />}
    </ListPanel>
    {selected && <SourceModal key={selected.id} source={selected} syncEnabled={syncEnabled} busy={busy !== null} error={error}
      onClose={() => { setSelectedId(null); setError(""); }} onToggle={(next) => toggle(selected, next)} onSync={() => syncNow(selected)}
      onAccept={() => void run(selected.id, () => api.acceptPoolSync(selected))} />}
  </>;
}

function SourceModal({ source, syncEnabled, busy, error, onClose, onToggle, onSync, onAccept }: {
  source: PoolSource; syncEnabled: boolean; busy: boolean; error: string; onClose: () => void; onToggle: (next: boolean) => void; onSync: () => void; onAccept: () => void;
}) {
  const key = statusOf(source);
  const latest = source.last_sync_result.latest;
  const synced = Boolean(latest?.finished_at || source.last_complete_at);
  const stats = latest ? [["发现", latest.observed_count], ["新增", latest.counts.created], ["更新", latest.counts.updated], ["恢复", latest.counts.restored],
    ["未发现", latest.counts.missing], ["下线", latest.counts.closed], ["无效", latest.counts.invalid], ["范围外", latest.counts.filtered ?? 0]] as const : [];
  const notice = key === "partial" ? "部分数据未完整读取：有效岗位已保留，本轮不判断下线，建议重新同步。"
    : key === "failed" ? "本轮同步失败：已有岗位保持不变，可以稍后重新同步。"
      : key === "anomalous" ? `本轮发现的岗位明显少于上次（${source.last_sync_result.baseline_count ?? "—"} → ${latest?.observed_count ?? 0}），先核对官网实际数量；确认后才会处理下线。`
        : key === "running" ? "正在同步，完成后这里会更新结果。" : null;
  const channels = channelText(source);
  return <Modal width={560} onClose={onClose} busy={busy}
    title={<span className="pool-modal-title"><PoolCompanyLogo company={{ name: source.company_name, logo_url: source.company_logo_url }} size={40} />
      <span><span className="pool-modal-name">{source.company_name}<StatusDot tone={STATUS[key].tone}>{STATUS[key].label}</StatusDot></span>
        <small>{[hostOf(source), channels || "覆盖渠道尚未确认"].join(" · ")}</small></span></span>}
    footer={<>
      <label className="pool-modal-toggle">启用同步<Toggle checked={source.is_enabled} label="启用同步" disabled={busy || !source.adapter_ready} onChange={onToggle} /></label>
      {needsReview(source) && <Button disabled={busy} onClick={onAccept}>确认并处理下线</Button>}
      <Button variant="primary" disabled={busy || !syncEnabled || !source.is_enabled || !source.adapter_ready || key === "running"} onClick={onSync}>{key === "running" ? "同步中…" : "立即同步"}</Button>
    </>}>
    <div className="pool-modal-body">
      {notice && <p className={`pool-admin-notice${key === "running" ? " is-info" : ""}`}><i aria-hidden="true" />{notice}</p>}
      {synced && latest ? <dl className="pool-stats">{stats.map(([label, value]) => <div key={label} className={value ? undefined : "is-zero"}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        : <p className="pool-modal-empty">{source.adapter_ready ? "还没有同步记录。打开「启用同步」后会在下一轮自动同步，也可以立即同步。" : "这个官网还在适配中，适配完成后才能启用和同步。"}</p>}
      {latest?.company_logo_error_code && <p className="pool-faint">公司图标本轮未获取到，不影响岗位同步。</p>}
      {error && <InlineError>{error}</InlineError>}
      <div className="pool-modal-meta">
        <span>{synced ? <>上次完整同步 {shortWhen(source.last_complete_at)}<i aria-hidden="true">·</i>本次尝试 {shortWhen(latest?.finished_at ?? null, "尚未完成")}</> : "尚未同步过"}</span>
        <a href={source.careers_url} target="_blank" rel="noopener noreferrer">企业招聘官网<ExternalLink size={12} aria-hidden="true" /></a>
      </div>
    </div>
  </Modal>;
}
