import { useEffect, useRef, useState } from "react";
import { api, type PoolSource } from "../../api/client";
import { Button, FeedbackNotice, PageHeader } from "@/components/ui";
import { ConfirmModal, useLoad } from "./kit";
import { PoolCompanyLogo, PoolDialog, PoolSearch, PoolSelect, PoolState, PoolTag } from "../jobs/PoolUi";
import { poolDate, poolError, syncLabels } from "../jobs/jobPoolPresentation";
import "./job-pool.css";

const channels: Record<string, string> = { campus: "校招", experienced: "社招", internship: "实习" };
type Confirmation = { kind: "bootstrap" } | { kind: "enable" | "pause" | "review"; source: PoolSource };
const sourceStatus = (source: PoolSource) => !source.adapter_ready ? "官网待适配" : !source.is_enabled ? "已暂停" : source.sync_status === "idle" && !source.last_complete_at ? "待首次同步" : syncLabels[source.sync_status] ?? source.sync_status;

export function JobPoolPanel() {
  const sources = useLoad(() => api.listPoolSources());
  const [busy, setBusy] = useState<string | null>(null);
  const runningAction = useRef(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [enabled, setEnabled] = useState("all");
  const [status, setStatus] = useState("all");
  const running = sources.data?.items.some((source) => ["queued", "running"].includes(source.sync_status));
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void sources.reload(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [running, sources.reload]);
  const run = async (id: string, action: () => Promise<unknown>) => {
    if (runningAction.current) return;
    runningAction.current = true; setBusy(id); setError("");
    try { await action(); setConfirmation(null); await sources.reload(); }
    catch (reason) { setConfirmation(null); setError(poolError(reason)); await sources.reload(); }
    finally { runningAction.current = false; setBusy(null); }
  };
  const items = sources.data?.items ?? [];
  const visible = items.filter((source) => `${source.company_name} ${source.tenant_key}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())
    && (enabled === "all" || (enabled === "pending" ? !source.adapter_ready : enabled === "enabled" ? source.is_enabled : !source.is_enabled))
    && (status === "all" || source.sync_status === status));
  const selected = items.find((source) => source.id === selectedId);
  const latest = selected?.last_sync_result.latest;
  const catalog = sources.data?.catalog_counts;
  const metrics = [[catalog?.companies ?? new Set(items.map((source) => source.company_id)).size, catalog ? "预置企业" : "已登记企业", "含独立招聘主体"], [catalog?.sources ?? items.length, catalog ? "预置招聘来源" : "已登记招聘来源", "同企业可有多个来源"], [items.filter((source) => source.is_enabled).length, "已启用来源", "以后台实际配置为准"]];
  const confirmSource = confirmation && "source" in confirmation ? confirmation.source : null;
  const confirm = () => {
    if (!confirmation) return;
    if (confirmation.kind === "bootstrap") void run("bootstrap", api.bootstrapPoolSources);
    else if (confirmation.kind === "review") void run(confirmation.source.id, () => api.acceptPoolSync(confirmation.source));
    else void run(confirmation.source.id, () => api.setPoolSourceEnabled(confirmation.source, confirmation.kind === "enable"));
  };
  return <div className="pool-theme pool-admin">
    <PageHeader eyebrow={null} title="官网岗位池" description="企业来源、采集状态与最近一次同步。" actions={<Button variant="outline" disabled={busy !== null} onClick={() => setConfirmation({ kind: "bootstrap" })}>登记预置企业</Button>} />
    {sources.error && <PoolState title="加载失败" description={poolError({ code: sources.error })} error><Button variant="outline" onClick={() => void sources.reload()}>重新加载</Button></PoolState>}
    {error && !selected && <FeedbackNotice kind="error">{error}</FeedbackNotice>}
    <div className="pool-admin-metrics">{metrics.map(([count, label, note]) => <section key={label} className="pool-admin-metric"><strong>{sources.data ? count : "—"}</strong><span>{label}</span><small>{note}</small></section>)}</div>
    <div className="pool-admin-filters">
      <PoolSearch aria-label="搜索岗位来源" placeholder="搜索企业名称 / 招聘来源" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
      <PoolSelect label="全部启用状态" value={enabled} onChange={({ target }) => setEnabled(target.value)} options={[{ value: "all", label: "全部启用状态" }, { value: "enabled", label: "已启用" }, { value: "paused", label: "已暂停" }, { value: "pending", label: "官网待适配" }]} />
      <PoolSelect label="全部同步状态" value={status} onChange={({ target }) => setStatus(target.value)} options={[{ value: "all", label: "全部同步状态" }, ...["idle", "queued", "running", "succeeded", "partial", "failed", "anomalous", "cancelled"].map((value) => ({ value, label: syncLabels[value] }))]} />
      <Button variant="outline" onClick={() => void sources.reload()}>刷新</Button>
    </div>
    {sources.loading && !sources.data ? <div className="pool-admin-loading" role="status">正在加载岗位来源…</div> : sources.data && <div className="pool-table-scroll">
      <table className="pool-source-table"><thead><tr><th>企业 / 官方来源</th><th>覆盖渠道</th><th>同步状态</th><th>上次完整同步</th><th>操作</th></tr></thead><tbody>
        {visible.map((source) => <tr key={source.id}>
          <td><div className="pool-source-company"><PoolCompanyLogo company={{ name: source.company_name, logo_url: source.company_logo_url }} /><a href={source.careers_url} target="_blank" rel="noopener noreferrer" title={`查看${source.company_name}招聘官网`}>{source.company_name}</a></div>{items.filter((item) => item.company_id === source.company_id).length > 1 && <small>{source.tenant_key}</small>}</td>
          <td><span aria-label={`覆盖渠道：${source.supported_channels.map((channel) => channels[channel] ?? channel).join("、")}`}>{source.supported_channels.map((channel) => channels[channel] ?? channel).join(" / ") || "尚未确认"}</span></td>
          <td><PoolTag tone={["partial", "failed", "anomalous"].includes(source.sync_status) && source.is_enabled ? "warning" : "neutral"}>{sourceStatus(source)}</PoolTag></td>
          <td>{source.last_complete_at ? poolDate(source.last_complete_at) : "尚未同步"}</td>
          <td><div className="pool-source-actions">
            {source.last_sync_result.latest && <button type="button" onClick={() => setSelectedId(source.id)}>查看结果</button>}
            {["queued", "running"].includes(source.sync_status) ? <button type="button" onClick={() => setSelectedId(source.id)}>查看当前任务</button>
              : source.is_enabled ? <button type="button" disabled={busy !== null || !source.adapter_ready || !sources.data?.sync_enabled} onClick={() => void run(source.id, () => api.syncPoolSource(source.id))}>立即同步</button> : null}
            <button type="button" disabled={busy !== null || !source.adapter_ready} onClick={() => setConfirmation({ kind: source.is_enabled ? "pause" : "enable", source })}>{source.is_enabled ? "暂停" : "启用"}</button>
            {source.sync_status === "anomalous" && source.last_sync_result.latest?.is_complete && !source.last_sync_result.latest.is_reviewed && <button type="button" disabled={busy !== null} onClick={() => setConfirmation({ kind: "review", source })}>确认异常结果</button>}
          </div></td>
        </tr>)}
      </tbody></table>
      {!visible.length && <PoolState title={items.length ? "没有符合条件的来源" : "暂无来源"} description={items.length ? "请调整企业名称或来源状态筛选。" : "登记预置企业后，可逐个启用已完成适配的官网。"} />}
    </div>}
    <p className="pool-admin-hint">新登记来源默认暂停；启用后由后台 Worker 执行同步。</p>
    {sources.data && !sources.data.sync_enabled && <p className="pool-admin-hint">自动同步当前关闭。开启后，新任务由现有 Worker 执行。</p>}
    {selected && <PoolDialog title={`${selected.company_name} · ${["queued", "running"].includes(selected.sync_status) ? "当前同步任务" : "同步结果"}`} wide onClose={() => setSelectedId(null)} busy={busy !== null} footer={<>
      <Button variant="outline" disabled={busy !== null} onClick={() => setSelectedId(null)}>关闭</Button>
      <Button disabled={busy !== null || !selected.is_enabled || !selected.adapter_ready || !sources.data?.sync_enabled} onClick={() => ["queued", "running"].includes(selected.sync_status) ? void sources.reload() : void run(selected.id, () => api.syncPoolSource(selected.id))}>{busy ? "处理中…" : ["queued", "running"].includes(selected.sync_status) ? "刷新任务" : "重试同步"}</Button>
    </>}>
      <PoolTag tone={["partial", "failed", "anomalous"].includes(selected.sync_status) ? "warning" : "neutral"}>{sourceStatus(selected)}</PoolTag>
      {error && <FeedbackNotice kind="error">{error}</FeedbackNotice>}
      {selected.sync_status === "partial" && <><strong>有效岗位已保留，本轮未判断岗位下线。</strong><p>部分招聘数据未能完整读取，需要重试后确认。</p></>}
      {selected.sync_status === "failed" && <p>同步失败，已保留上次岗位数据。</p>}
      {latest ? <><div className="pool-sync-metrics">{[[latest.observed_count, "发现岗位"], [latest.counts.created, "新增"], [latest.counts.updated, "更新"]].map(([count, label]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
        <dl className="pool-sync-details">{[["恢复", latest.counts.restored], ["未发现", latest.counts.missing], ["下线", latest.counts.closed], ["无效", latest.counts.invalid]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
        {latest.error_code && <p className="pool-muted">错误代码：{latest.error_code}</p>}
        {latest.company_logo_error_code && <p className="pool-muted">公司图标暂未获取，不影响有效岗位保存。</p>}
        <p className="pool-muted">上次完整同步 · {poolDate(selected.last_complete_at)}<br />本次尝试 · {poolDate(latest.finished_at)}</p></> : <p>任务尚未产生同步结果，可稍后刷新查看。</p>}
      <p>覆盖渠道：{selected.supported_channels.map((channel) => channels[channel] ?? channel).join("、") || "尚未确认"}</p>
      <a className="pool-official-link" href={selected.careers_url} target="_blank" rel="noopener noreferrer">企业招聘官网 ↗</a>
    </PoolDialog>}
    {confirmation && <ConfirmModal width={confirmation.kind === "review" ? 600 : 520} title={confirmation.kind === "bootstrap" ? "登记预置企业" : confirmation.kind === "review" ? `确认「${confirmSource!.company_name}」的同步结果` : `${confirmation.kind === "enable" ? "启用" : "暂停"}「${confirmSource!.company_name}」`}
      confirmLabel={confirmation.kind === "bootstrap" ? "登记来源" : confirmation.kind === "review" ? "确认并核对上下线" : confirmation.kind === "enable" ? "启用来源" : "暂停来源"} busy={busy !== null} onCancel={() => setConfirmation(null)} onConfirm={confirm}>
      <div className="pool-theme pool-confirm-content">{confirmation.kind === "bootstrap" ? <><p>登记系统已预置的企业官方招聘来源。</p><PoolTag tone="warning">首次登记默认暂停</PoolTag><p>登记只创建来源；启用并同步后才会收录岗位。已有来源配置保持不变。</p></>
        : confirmation.kind === "review" ? <><p>本轮岗位数量较上次大幅下降。确认后，将以本轮完整结果更新基线，并按连续缺失和时间阈值核对下线岗位。</p><p>上次基线 {confirmSource!.last_sync_result.baseline_count ?? "无"} 个，本轮发现 {confirmSource!.last_sync_result.latest?.observed_count ?? 0} 个。请先核对官网实际岗位数量。</p></>
          : <p>{confirmation.kind === "enable" ? "启用后该来源将按后台同步设置采集官网岗位。" : "暂停后停止该来源的新同步任务，已有岗位和个人求职记录继续保留。"}</p>}</div>
    </ConfirmModal>}
  </div>;
}
