import { useCallback, useEffect, useState } from "react";
import { Activity, ClipboardList, RefreshCw } from "lucide-react";
import {
  api,
  ApiRequestError,
  type AuditLogQuery,
  type LogItem,
  type LogListResponse,
  type LogSummary,
  type SystemLogQuery,
} from "../../api/client";
import { LogsPanel } from "./AdminLlmPanels";

type LogKind = "system" | "audit" | "llm";

function initialKind(): LogKind {
  if (window.location.pathname === "/admin/logs") return "llm";
  if (window.location.pathname.endsWith("/audit")) return "audit";
  return "system";
}

function displayTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN");
}

function LogTable({ items, kind }: { items: LogItem[]; kind: "system" | "audit" }) {
  if (!items.length) {
    return (
      <div className="llm-state">
        {kind === "system" ? <Activity size={24} /> : <ClipboardList size={24} />}
        <strong>当前筛选下没有日志</strong>
        <p>调整筛选条件，或等待新的事件写入后刷新。</p>
      </div>
    );
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table observability-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>{kind === "system" ? "级别 / 来源" : "动作 / 结果"}</th>
            <th>{kind === "system" ? "请求 / 依赖" : "操作者 / 目标"}</th>
            <th>摘要</th>
            <th>错误码</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.eventId}>
              <td>{displayTime(item.timestamp)}</td>
              <td>
                <strong className="table-strong">
                  {kind === "system" ? item.level : item.action ?? "—"}
                </strong>
                <small className="table-sub">
                  {kind === "system" ? item.source : item.result ?? "—"}
                </small>
              </td>
              <td>
                <strong className="table-strong">
                  {kind === "system"
                    ? item.requestId ?? item.operationId ?? "—"
                    : `${item.actorType ?? "—"}:${item.actorUserId ?? "—"}`}
                </strong>
                <small className="table-sub">
                  {kind === "system"
                    ? item.dependency ?? item.httpRoute ?? "—"
                    : `${item.targetType ?? "—"}:${item.targetId ?? "—"}`}
                </small>
              </td>
              <td>{item.summary ?? item.message}</td>
              <td>{item.errorCode ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueryState({
  kind,
  onSessionExpired,
  initialAuditResult = "",
}: {
  kind: "system" | "audit";
  onSessionExpired: () => void;
  initialAuditResult?: "" | "failed";
}) {
  const [response, setResponse] = useState<LogListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([]);
  const [level, setLevel] = useState("");
  const [source, setSource] = useState("");
  const [dependency, setDependency] = useState("");
  const [requestId, setRequestId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [keyword, setKeyword] = useState("");
  const [action, setAction] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [result, setResult] = useState<"" | "succeeded" | "failed">(
    initialAuditResult,
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(
    async (nextCursor?: string) => {
      setLoading(true);
      setError("");
      try {
        const windowQuery = {
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(to).toISOString() : undefined,
        };
        const next =
          kind === "system"
            ? await api.adminListSystemLogs({
                ...windowQuery,
                level: (level || undefined) as SystemLogQuery["level"],
                source: (source || undefined) as SystemLogQuery["source"],
                dependency: (dependency || undefined) as SystemLogQuery["dependency"],
                requestId: requestId.trim() || undefined,
                taskId: taskId.trim() || undefined,
                operationId: operationId.trim() || undefined,
                errorCode: errorCode.trim() || undefined,
                keyword: keyword.trim() || undefined,
                cursor: nextCursor,
                limit: 50,
              })
            : await api.adminListAuditLogs({
                ...windowQuery,
                action: action.trim() || undefined,
                actorUserId: actorUserId.trim() || undefined,
                targetType: targetType.trim() || undefined,
                targetId: targetId.trim() || undefined,
                result: (result || undefined) as AuditLogQuery["result"],
                requestId: requestId.trim() || undefined,
                cursor: nextCursor,
                limit: 50,
              });
        setResponse(next);
        return true;
      } catch (caught) {
        if (caught instanceof ApiRequestError && caught.status === 401) {
          onSessionExpired();
        }
        setResponse(null);
        setError(
          caught instanceof RangeError
            ? "时间筛选格式不合法"
            : caught instanceof Error
              ? caught.message
              : "LOG_QUERY_FAILED",
        );
        return false;
      } finally {
        setLoading(false);
      }
    }, [action, actorUserId, dependency, errorCode, from, keyword, kind, level, onSessionExpired, operationId, requestId, result, source, targetId, targetType, taskId, to],
  );

  useEffect(() => {
    void load();
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = async () => {
    if (await load()) {
      setCursor(undefined);
      setCursorStack([]);
    }
  };
  const next = async () => {
    const nextCursor = response?.nextCursor ?? undefined;
    if (!nextCursor || !(await load(nextCursor))) return;
    setCursorStack((current) => [...current, cursor]);
    setCursor(nextCursor);
  };
  const previous = async () => {
    if (!cursorStack.length) return;
    const previousCursor = cursorStack[cursorStack.length - 1];
    if (!(await load(previousCursor))) return;
    setCursor(previousCursor);
    setCursorStack((current) => current.slice(0, -1));
  };

  return (
    <>
      <form
        className="admin-surface observability-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void query();
        }}
      >
        {kind === "system" ? (
          <>
            <select aria-label="日志级别" value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">全部级别</option>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
            </select>
            <select aria-label="日志来源" value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="">全部来源</option><option value="backend">Backend</option><option value="web">Web</option>
            </select>
            <select aria-label="依赖服务" value={dependency} onChange={(event) => setDependency(event.target.value)}>
              <option value="">全部依赖</option>
              <option value="mysql">MySQL</option><option value="redis">Redis</option>
              <option value="minio">MinIO</option><option value="linkparse">LinkParse</option>
              <option value="llm">LLM</option>
            </select>
            <input aria-label="请求 ID" placeholder="requestId" value={requestId} onChange={(event) => setRequestId(event.target.value)} />
            <input aria-label="任务 ID" placeholder="taskId" value={taskId} onChange={(event) => setTaskId(event.target.value)} />
            <input aria-label="操作 ID" placeholder="operationId" value={operationId} onChange={(event) => setOperationId(event.target.value)} />
            <input aria-label="错误码" placeholder="errorCode" value={errorCode} onChange={(event) => setErrorCode(event.target.value)} />
            <input aria-label="日志关键词" placeholder="关键词" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          </>
        ) : (
          <>
            <input aria-label="审计动作" placeholder="如 resume.update" value={action} onChange={(event) => setAction(event.target.value)} />
            <input aria-label="操作者 ID" placeholder="actorUserId" value={actorUserId} onChange={(event) => setActorUserId(event.target.value)} />
            <input aria-label="目标类型" placeholder="targetType" value={targetType} onChange={(event) => setTargetType(event.target.value)} />
            <input aria-label="目标 ID" placeholder="targetId" value={targetId} onChange={(event) => setTargetId(event.target.value)} />
            <input aria-label="审计请求 ID" placeholder="requestId" value={requestId} onChange={(event) => setRequestId(event.target.value)} />
            <select aria-label="审计结果" value={result} onChange={(event) => setResult(event.target.value as "" | "succeeded" | "failed")}>
              <option value="">全部结果</option><option value="succeeded">成功</option><option value="failed">失败</option>
            </select>
          </>
        )}
        <label><span>开始时间</span><input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>结束时间</span><input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="submit" disabled={loading}>查询</button>
      </form>
      {response?.partial && <div className="llm-inline-error" role="status">部分异常日志行已忽略（{response.droppedMalformed} 条）。</div>}
      <section className="admin-surface logs-surface">
        {loading && !response ? (
          <div className="llm-state"><span className="loading-spinner" /><p>正在加载日志…</p></div>
        ) : error && !response ? (
          <div className="llm-state llm-error" role="alert"><strong>日志查询暂不可用</strong><p>{error}</p><button type="button" onClick={() => void load(cursor)}>重试</button></div>
        ) : (
          <LogTable items={response?.items ?? []} kind={kind} />
        )}
        <footer className="table-footer">
          <span>当前页 {response?.items.length ?? 0} 条</span>
          <div><button type="button" onClick={() => void previous()} disabled={!cursorStack.length || loading}>上一页</button><button type="button" onClick={() => void next()} disabled={!response?.nextCursor || loading}>下一页</button></div>
        </footer>
      </section>
    </>
  );
}

export function AdminLogsCenter({
  notify,
  onSessionExpired,
}: {
  notify: (message: string) => void;
  onSessionExpired: () => void;
}) {
  const [kind, setKind] = useState<LogKind>(initialKind);
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [auditFailedOnly, setAuditFailedOnly] = useState(false);

  const selectKind = (next: LogKind) => {
    setKind(next);
    setAuditFailedOnly(false);
    const path = next === "llm" ? "/admin/logs" : `/admin/logs/${next}`;
    window.history.replaceState(null, "", path);
  };

  const loadSummary = useCallback(async () => {
    setSummaryError("");
    try {
      setSummary(await api.adminLogSummary());
    } catch (error) {
      setSummary(null);
      if (error instanceof ApiRequestError && error.status === 401) {
        onSessionExpired();
      }
      setSummaryError(error instanceof Error ? error.message : "LOG_QUERY_FAILED");
    }
  }, [onSessionExpired]);

  useEffect(() => {
    if (kind === "llm") return;
    void loadSummary();
  }, [kind, loadSummary]);

  const showAuditFailures = () => {
    setKind("audit");
    setAuditFailedOnly(true);
    window.history.replaceState(null, "", "/admin/logs/audit");
  };

  return (
    <>
      <header className="admin-page-heading">
        <div><span className="page-eyebrow">可观测性</span><h1>日志中心</h1><p>统一查询 LinkCV 系统日志、业务审计和既有 LLM 调用记录。</p></div>
        <button className="admin-secondary-button" type="button" onClick={() => window.location.reload()}><RefreshCw size={15} />刷新</button>
      </header>
      <nav className="observability-tabs" aria-label="日志类型">
        <button className={kind === "system" ? "active" : ""} onClick={() => selectKind("system")}>系统日志</button>
        <button className={kind === "audit" ? "active" : ""} onClick={() => selectKind("audit")}>业务审计</button>
        <button className={kind === "llm" ? "active" : ""} onClick={() => selectKind("llm")}>LLM 调用</button>
      </nav>
      {kind !== "llm" && summaryError && <div className="llm-inline-error" role="alert">日志汇总暂不可用：{summaryError}<button type="button" onClick={() => void loadSummary()}>重试</button></div>}
      {kind !== "llm" && summary && <section className="mini-metrics observability-summary" aria-label="日志汇总"><div><span>系统日志</span><strong>{summary.system.total}</strong></div><div><span>告警 / 错误</span><strong>{summary.system.warnings} / {summary.system.errors}</strong></div><div><span>审计成功</span><strong>{summary.audit.succeeded}</strong></div><button type="button" onClick={showAuditFailures}><span>审计失败</span><strong>{summary.audit.failed}</strong></button></section>}
      {kind === "llm" ? <LogsPanel embedded notify={notify} onSessionExpired={onSessionExpired} /> : <QueryState key={`${kind}-${auditFailedOnly}`} kind={kind} initialAuditResult={auditFailedOnly ? "failed" : ""} onSessionExpired={onSessionExpired} />}
    </>
  );
}
