import { useEffect, useState } from "react";
import { api, type AgentOperationDetail, type AgentOperationItem } from "../../api/client";

const dateTime = (value: string) => new Date(
  /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`,
).toLocaleString("zh-CN");

export function AdminAgentTracePanel() {
  const [items, setItems] = useState<AgentOperationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentOperationDetail | null>(null);
  const [status, setStatus] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const response = await api.adminListAgentOperations({
        status: status || undefined,
        errorCode: errorCode || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        cursor,
      });
      setItems(cursor ? (current) => [...current, ...response.items] : response.items);
      setNextCursor(response.next_cursor);
    } catch {
      setError("读取 Agent 排障记录失败");
    } finally {
      setLoading(false);
    }
  }

  async function open(id: string) {
    setError("");
    try {
      setSelected(await api.adminGetAgentOperation(id));
    } catch {
      setError("读取操作详情失败");
    }
  }

  async function loadMoreEvents() {
    if (!selected?.next_cursor) return;
    try {
      const page = await api.adminGetAgentOperation(selected.id, { cursor: selected.next_cursor });
      setSelected({ ...page, events: [...selected.events, ...page.events] });
    } catch {
      setError("读取阶段事件失败");
    }
  }

  useEffect(() => { void load(); }, []); // Initial 31-day window; filters apply on submit.

  return <div className="agent-trace-panel">
    <header className="admin-page-heading"><div><h1>Agent 调用排障</h1><p>按操作查看执行阶段、工具与提案状态。记录不包含对话或简历正文。</p></div></header>
    <section className="admin-surface agent-trace-filter">
      <label>开始时间<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>结束时间<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="preflighting">预检中</option><option value="running">运行中</option><option value="succeeded">成功</option><option value="failed">失败</option><option value="cancelled">取消</option></select></label>
      <label>错误码<input value={errorCode} onChange={(event) => setErrorCode(event.target.value)} placeholder="例如 AGENT_UNAVAILABLE" /></label>
      <button type="button" onClick={() => { setSelected(null); void load(); }} disabled={loading}>查询</button>
    </section>
    {error && <p role="alert">{error}</p>}
    <section className="admin-surface agent-trace-list">
      <table><thead><tr><th>时间</th><th>操作 ID</th><th>用户 ID</th><th>调用模型</th><th>状态</th><th>失败阶段</th><th>错误码</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}>
          <td>{dateTime(item.created_at)}</td>
          <td><button type="button" onClick={() => void open(item.id)}>{item.id}</button>{item.legacy && "（历史）"}</td>
          <td>{item.user_id}</td><td>{item.model_name ?? "—"}</td><td>{item.status}</td><td>{item.failure_stage ?? "—"}</td><td>{item.error_code ?? "—"}</td>
        </tr>)}
      </tbody></table>
      {!loading && items.length === 0 && <p>当前条件下没有记录。</p>}
      {nextCursor && <button type="button" onClick={() => void load(nextCursor)} disabled={loading}>加载更多</button>}
    </section>
    {selected && <section className="admin-surface agent-trace-detail">
      <header><h2>操作详情</h2><button type="button" onClick={() => setSelected(null)}>关闭</button></header>
      <p>操作 ID：{selected.id}　用户 ID：{selected.user_id}　状态：{selected.status}　时间线：{selected.timeline_status}{selected.gap_reason && `（${selected.gap_reason}）`}</p>
      <p>调用模型：{selected.model_name ?? "未记录"}</p>
      <h3>阶段事件</h3>
      {selected.events.length === 0 && <p>{selected.timeline_status === "legacy" ? "历史运行无阶段记录。" : "暂无阶段事件。"}</p>}
      <ol>{selected.events.map((event) => <li key={event.id}>{dateTime(event.occurred_at)}　{event.stage} · {event.result}{event.duration_ms != null && ` · ${event.duration_ms} ms`}{event.error_code && ` · ${event.error_code}`}{event.tool_call_key && ` · 工具 ${event.tool_call_key}`}{event.proposal_id && ` · 提案 ${event.proposal_id}`}</li>)}</ol>
      {selected.next_cursor && <button type="button" onClick={() => void loadMoreEvents()}>加载更多阶段</button>}
      <h3>工具调用</h3><ul>{selected.tools.map((tool) => <li key={tool.call_key}>{tool.tool_name} · {tool.status}{tool.error_code && ` · ${tool.error_code}`}</li>)}</ul>
      <h3>提案</h3><ul>{selected.proposals.map((proposal) => <li key={proposal.id}>{proposal.id} · {proposal.status}</li>)}</ul>
    </section>}
  </div>;
}
