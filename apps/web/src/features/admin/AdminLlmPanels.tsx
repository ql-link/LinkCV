import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TestTube2,
  X,
} from "lucide-react";
import {
  api,
  ApiRequestError,
  ChatAdapter,
  ChatCapability,
  ChatCatalog,
  LlmCallQuery,
  LlmCallRecord,
  LlmCallSummary,
  LlmModelConfig,
  LlmModelCreatePayload,
  LlmModelPatchPayload,
} from "../../api/client";

type PanelProps = {
  onSessionExpired: () => void;
  notify: (message: string) => void;
};

type LoadState = "loading" | "ready" | "error";

function errorMessage(
  error: unknown,
  fallback: string,
  onSessionExpired: () => void,
): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  if (error.status === 401) {
    onSessionExpired();
    return "管理员会话已失效，请重新登录。";
  }
  const messages: Record<string, string> = {
    FORBIDDEN: "当前账号没有管理权限。",
    INVALID_LLM_MODEL_CONFIG: "Chat 模型配置不合法，请检查接入方式、模型调用名和地址。",
    LLM_MODEL_NOT_FOUND: "候选模型已不存在，请刷新后重试。",
    LLM_MODEL_CONFIG_CHANGED: "测试期间配置已被其他操作修改，请刷新后重试。",
    LLM_CREDENTIALS_UNAVAILABLE: "API Key 缺失或服务端暂时无法安全读取凭据。",
    LLM_CONNECTION_FAILED: "连接测试失败，请检查接入方式、模型调用名、地址或 API Key。",
    LLM_CHAT_NOT_CONFIGURED: "Chat 当前尚未选择模型。",
    INVALID_LLM_CALL_QUERY: "调用日志筛选条件不合法，请检查后重试。",
  };
  const message = messages[error.message] ?? fallback;
  const callId = error.payload?.callId;
  return typeof callId === "string" ? `${message} · ${callId}` : message;
}

function PanelHeading({
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
    <div className="admin-page-heading">
      <div>
        <span className="page-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ModelsPanel({ onSessionExpired, notify }: PanelProps) {
  const [capability, setCapability] = useState<ChatCapability | null>(null);
  const [catalog, setCatalog] = useState<ChatCatalog | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [keyFilter, setKeyFilter] = useState("all");
  const [editor, setEditor] = useState<LlmModelConfig | "new" | null>(null);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [activatingIds, setActivatingIds] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoadState("loading");
      setLoadError("");
      try {
        const [nextCapability, nextCatalog] = await Promise.all([
          api.getChatCapability(),
          api.getChatCatalog(),
        ]);
        setCapability(nextCapability);
        setCatalog(nextCatalog);
        setLoadState("ready");
      } catch (error) {
        setLoadError(
          errorMessage(error, "Chat 模型配置加载失败，请稍后重试。", onSessionExpired),
        );
        setLoadState("error");
      }
    },
    [onSessionExpired],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (capability?.models ?? []).filter((model) => {
      const matchesQuery =
        !normalized ||
        model.model.toLowerCase().includes(normalized) ||
        model.adapter.toLowerCase().includes(normalized);
      const matchesKey =
        keyFilter === "all" ||
        (keyFilter === "configured" && model.keyConfigured) ||
        (keyFilter === "missing" && !model.keyConfigured);
      return matchesQuery && matchesKey;
    });
  }, [capability?.models, keyFilter, query]);

  const testModel = async (model: LlmModelConfig) => {
    if (testingIds.has(model.id)) return;
    setTestingIds((current) => new Set(current).add(model.id));
    setTestResults((current) => {
      const next = { ...current };
      delete next[model.id];
      return next;
    });
    try {
      const response = await api.testLlmModel(model.id);
      setTestResults((current) => ({
        ...current,
        [model.id]: {
          ok: true,
          message: `连接成功 · ${response.callId}`,
        },
      }));
      await load(false);
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [model.id]: {
          ok: false,
          message: errorMessage(
            error,
            "连接测试失败，请检查配置或稍后重试。",
            onSessionExpired,
          ),
        },
      }));
    } finally {
      setTestingIds((current) => {
        const next = new Set(current);
        next.delete(model.id);
        return next;
      });
    }
  };

  const activateModel = async (model: LlmModelConfig) => {
    if (activatingIds.has(model.id) || model.active) return;
    setActivatingIds((current) => new Set(current).add(model.id));
    try {
      const response = await api.activateLlmModel(model.id);
      await load(false);
      notify(`Chat 当前模型已切换 · ${response.callId}`);
    } catch (error) {
      notify(
        errorMessage(error, "测试并启用失败，原当前模型保持不变。", onSessionExpired),
      );
    } finally {
      setActivatingIds((current) => {
        const next = new Set(current);
        next.delete(model.id);
        return next;
      });
    }
  };

  return (
    <>
      <PanelHeading
        eyebrow="AI 基础设施"
        title="模型配置"
        description="为系统 Chat 能力保存候选模型，并明确选择唯一的当前模型。"
        action={
          <button className="admin-primary-button" type="button" onClick={() => setEditor("new")}>
            <Plus size={16} />
            新增候选
          </button>
        }
      />

      {loadState === "loading" && (
        <section className="admin-surface llm-state" aria-live="polite">
          <span className="loading-spinner" />
          <p>正在加载 Chat 模型配置…</p>
        </section>
      )}
      {loadState === "error" && (
        <section className="admin-surface llm-state llm-error" role="alert">
          <CircleAlert size={22} />
          <strong>无法加载 Chat 模型配置</strong>
          <p>{loadError}</p>
          <button type="button" onClick={() => void load()}>重试</button>
        </section>
      )}
      {loadState === "ready" && capability && (
        <>
          <button
            className="model-summary chat-capability-card"
            type="button"
            onClick={() => setEditor(capability.activeModel ?? "new")}
          >
            <div>
              <span className="model-summary-icon"><Bot size={20} /></span>
              <div>
                <small>系统能力</small>
                <strong>Chat 模型</strong>
                <p>
                  {capability.activeModel
                    ? `当前使用 ${capability.activeModel.adapter} / ${capability.activeModel.model}`
                    : "尚未选择当前模型，点击这里新增候选。"}
                </p>
              </div>
            </div>
            <span className={capability.activeModel ? "enabled-pill" : "disabled-pill"}>
              {capability.activeModel ? "已配置" : "未配置"}
            </span>
          </button>

          <section className="admin-surface llm-filter-bar" aria-label="候选模型筛选">
            <label className="table-search">
              <Search size={16} />
              <input
                aria-label="按接入方式或模型调用名筛选"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索接入方式或模型调用名"
              />
            </label>
            <select aria-label="按密钥状态筛选" value={keyFilter} onChange={(event) => setKeyFilter(event.target.value)}>
              <option value="all">全部密钥状态</option>
              <option value="configured">密钥已配置</option>
              <option value="missing">密钥未配置</option>
            </select>
            <button type="button" onClick={() => { setQuery(""); setKeyFilter("all"); }}>清除筛选</button>
          </section>

          {capability.models.length === 0 ? (
            <section className="admin-surface llm-state">
              <Bot size={24} />
              <strong>Chat 还没有候选模型</strong>
              <p>先保存一个候选，再通过真实连接测试将它设为当前模型。</p>
              <button type="button" onClick={() => setEditor("new")}>新增候选模型</button>
            </section>
          ) : visibleModels.length === 0 ? (
            <section className="admin-surface llm-state">
              <Search size={24} />
              <strong>没有符合筛选条件的候选</strong>
              <p>清除筛选可恢复全部候选模型。</p>
            </section>
          ) : (
            <section className="models-list" aria-label="Chat 候选模型">
              {visibleModels.map((model) => {
                const testing = testingIds.has(model.id);
                const activating = activatingIds.has(model.id);
                const transientResult = testResults[model.id];
                return (
                  <article className={`model-card ${model.active ? "current-model-card" : ""}`} key={model.id}>
                    <div className="model-priority model-adapter-badge">
                      <Bot size={19} />
                      <small>{model.adapter}</small>
                    </div>
                    <div className="model-main">
                      <div className="model-title-row">
                        <h3>{model.model}</h3>
                        <span className={model.active ? "enabled-pill" : "disabled-pill"}>
                          {model.active ? "当前使用" : "候选"}
                        </span>
                      </div>
                      <p>{model.apiBase || "使用接入方式默认地址"}</p>
                      <div className="model-meta">
                        <span className={model.keyConfigured ? "" : "missing-key"}>
                          <KeyRound size={14} />
                          {model.keyConfigured ? "API Key 已配置" : "API Key 未配置"}
                        </span>
                        <span>
                          <TestTube2 size={14} />
                          {model.lastTest
                            ? `最近测试：${model.lastTest.status === "succeeded" ? "成功" : "失败"} · ${model.lastTest.callId}`
                            : "尚未测试"}
                        </span>
                      </div>
                      {transientResult && (
                        <p
                          className={transientResult.ok ? "model-test-ok" : "model-test-error"}
                          role={transientResult.ok ? "status" : "alert"}
                        >
                          {transientResult.ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                          {transientResult.message}
                        </p>
                      )}
                    </div>
                    <div className="model-actions">
                      <button type="button" onClick={() => void testModel(model)} disabled={testing || activating}>
                        <TestTube2 size={14} />{testing ? "测试中…" : "测试连接"}
                      </button>
                      <button type="button" onClick={() => setEditor(model)} disabled={testing || activating}>编辑</button>
                      <button type="button" onClick={() => void activateModel(model)} disabled={model.active || testing || activating}>
                        {model.active ? "当前模型" : activating ? "测试并启用中…" : "设为当前"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}

      {editor && catalog && (
        <ModelEditor
          model={editor === "new" ? null : editor}
          catalog={catalog}
          onClose={() => setEditor(null)}
          onSaved={async (message) => {
            setEditor(null);
            await load(false);
            notify(message);
          }}
          onSessionExpired={onSessionExpired}
        />
      )}
    </>
  );
}

function ModelEditor({
  model,
  catalog,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  model: LlmModelConfig | null;
  catalog: ChatCatalog;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [adapter, setAdapter] = useState<ChatAdapter>(model?.adapter ?? catalog.adapters[0]?.code ?? "deepseek");
  const [modelName, setModelName] = useState(model?.model ?? "");
  const [apiBase, setApiBase] = useState(model?.apiBase ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const selectedAdapter = catalog.adapters.find((item) => item.code === adapter);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (model) {
        const payload: LlmModelPatchPayload = {
          adapter,
          model: modelName.trim(),
          apiBase: apiBase.trim() || null,
        };
        if (clearKey) payload.apiKey = null;
        else if (apiKey.trim()) payload.apiKey = apiKey;
        const response = await api.updateLlmModel(model.id, payload);
        await onSaved(
          response.validationCallId
            ? `当前模型已验证并保存 · ${response.validationCallId}`
            : "候选模型已保存",
        );
      } else {
        const payload: LlmModelCreatePayload = {
          adapter,
          model: modelName.trim(),
          apiBase: apiBase.trim() || null,
        };
        if (apiKey.trim()) payload.apiKey = apiKey;
        await api.createLlmModel(payload);
        await onSaved("候选模型已保存；当前模型没有改变");
      }
    } catch (caught) {
      setError(errorMessage(caught, "保存失败，请稍后重试。", onSessionExpired));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="drawer-layer" role="presentation">
      <aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="model-editor-title">
        <header>
          <div><span className="page-eyebrow">Chat 模型</span><h2 id="model-editor-title">{model ? "编辑候选" : "新增候选"}</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭模型编辑"><X size={18} /></button>
        </header>
        <form className="drawer-form" onSubmit={submit}>
          <label>
            <span>接入方式</span>
            <select value={adapter} onChange={(event) => { setAdapter(event.target.value as ChatAdapter); setModelName(""); }} required>
              {catalog.adapters.map((item) => <option key={item.code} value={item.code}>{item.label} · {item.code}</option>)}
            </select>
          </label>
          <label>
            <span>模型调用名</span>
            <input value={modelName} onChange={(event) => setModelName(event.target.value)} list={`models-${adapter}`} placeholder={adapter === "deepseek" ? "deepseek-v4-flash" : "输入供应商模型调用名"} required />
            <datalist id={`models-${adapter}`}>{selectedAdapter?.models.map((name) => <option key={name} value={name} />)}</datalist>
            <small>保存时内部组装为 {adapter}/{modelName.trim() || "模型调用名"}；目录外模型也可直接输入。</small>
          </label>
          <label>
            <span>API Base <small>可选</small></span>
            <input type="url" value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="使用接入方式默认地址" />
          </label>
          <label>
            <span>API Key <small>{model?.keyConfigured ? "留空表示保留" : "启用前必须配置"}</small></span>
            <input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setClearKey(false); }} disabled={clearKey} placeholder="仅写入，不会再次显示" />
          </label>
          {model?.keyConfigured && (
            <label className="drawer-check-row">
              <input type="checkbox" checked={clearKey} onChange={(event) => { setClearKey(event.target.checked); if (event.target.checked) setApiKey(""); }} />
              <span>明确清除已保存的 API Key</span>
            </label>
          )}
          <div className="drawer-callout"><ShieldCheck size={18} /><p>API Key 只会加密写入。{model?.active ? "这是当前模型，保存前会先使用拟议配置执行真实连接测试；失败不会覆盖当前版本。" : "保存候选不会自动设为当前模型。"}</p></div>
          {error && <p className="llm-inline-error" role="alert"><CircleAlert size={15} />{error}</p>}
          <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={saving}>{saving ? (model?.active ? "验证并保存中…" : "保存中…") : model?.active ? "验证并保存" : "保存候选"}</button></footer>
        </form>
      </aside>
    </div>
  );
}

type LogFilters = {
  source: string;
  status: "" | LlmCallRecord["status"];
  modelConfigId: string;
  userId: string;
  callId: string;
  from: string;
  to: string;
};

const initialLogFilters: LogFilters = { source: "", status: "", modelConfigId: "", userId: "", callId: "", from: "", to: "" };
const emptySummary: LlmCallSummary = { callCount: 0, incompleteMeteringCount: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null };

function buildLogQuery(filters: LogFilters): LlmCallQuery {
  return {
    source: filters.source || undefined,
    status: filters.status || undefined,
    modelConfigId: filters.modelConfigId || undefined,
    userId: filters.userId.trim() || undefined,
    callId: filters.callId.trim() || undefined,
    from: filters.from ? new Date(filters.from).toISOString() : undefined,
    to: filters.to ? new Date(filters.to).toISOString() : undefined,
    limit: 50,
  };
}

export function LogsPanel({ onSessionExpired }: PanelProps) {
  const [calls, setCalls] = useState<LlmCallRecord[]>([]);
  const [models, setModels] = useState<LlmModelConfig[]>([]);
  const [summary, setSummary] = useState<LlmCallSummary>(emptySummary);
  const [filters, setFilters] = useState<LogFilters>(initialLogFilters);
  const [appliedQuery, setAppliedQuery] = useState<LlmCallQuery>({ limit: 50 });
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [pagePending, setPagePending] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>();
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([]);
  const pendingRequest = useRef("");

  const loadPage = useCallback(async (query: LlmCallQuery, cursor?: string, initial = false) => {
    const key = JSON.stringify({ ...query, cursor });
    if (pendingRequest.current === key) return false;
    pendingRequest.current = key;
    if (initial) setLoadState("loading"); else setPagePending(true);
    setLoadError("");
    try {
      const response = await api.listLlmCalls({ ...query, cursor });
      setCalls(response.calls); setSummary(response.summary); setNextCursor(response.nextCursor); setLoadState("ready");
      return true;
    } catch (error) {
      setLoadError(errorMessage(error, "LLM 调用日志加载失败，请稍后重试。", onSessionExpired));
      setLoadState("error");
      return false;
    } finally {
      pendingRequest.current = ""; setPagePending(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void loadPage({ limit: 50 }, undefined, true);
    api.getChatCapability().then((response) => setModels(response.models)).catch(() => undefined);
  }, [loadPage]);

  const applyFilters = async (event: FormEvent) => {
    event.preventDefault();
    let nextQuery: LlmCallQuery;
    try { nextQuery = buildLogQuery(filters); } catch { setLoadError("时间筛选格式不合法，请检查后重试。"); return; }
    if (await loadPage(nextQuery)) { setAppliedQuery(nextQuery); setCurrentCursor(undefined); setCursorStack([]); }
  };
  const refresh = () => void loadPage(appliedQuery, currentCursor);
  const next = async () => { if (!nextCursor || pagePending) return; if (await loadPage(appliedQuery, nextCursor)) { setCursorStack((current) => [...current, currentCursor]); setCurrentCursor(nextCursor); } };
  const previous = async () => { if (!cursorStack.length || pagePending) return; const cursor = cursorStack[cursorStack.length - 1]; if (await loadPage(appliedQuery, cursor)) { setCursorStack((current) => current.slice(0, -1)); setCurrentCursor(cursor); } };

  return (
    <>
      <PanelHeading eyebrow="可观测性" title="LLM 调用日志" description="查询真实 Chat 调用的安全元数据；数据仅在手动刷新后更新。" action={<button className="admin-secondary-button" type="button" onClick={refresh} disabled={pagePending}><RefreshCw size={15} />{pagePending ? "刷新中…" : "刷新"}</button>} />
      {loadState === "loading" && <section className="admin-surface llm-state" aria-live="polite"><span className="loading-spinner" /><p>正在加载 LLM 调用日志…</p></section>}
      {loadState === "error" && <section className="admin-surface llm-state llm-error" role="alert"><CircleAlert size={22} /><strong>无法加载 LLM 调用日志</strong><p>{loadError}</p><button type="button" onClick={() => void loadPage(appliedQuery, currentCursor, true)}>重试</button></section>}
      {loadState === "ready" && (
        <>
          <section className="mini-metrics llm-summary-grid" aria-label="调用汇总">
            <div><span>调用次数</span><strong>{summary.callCount}</strong></div><div><span>不完整计量</span><strong>{summary.incompleteMeteringCount}</strong></div><div><span>输入 Token</span><strong>{summary.inputTokens ?? "—"}</strong></div><div><span>输出 Token</span><strong>{summary.outputTokens ?? "—"}</strong></div><div><span>预估费用 USD</span><strong>{summary.estimatedCostUsd ?? "—"}</strong></div>
          </section>
          <form className="admin-surface llm-log-filters" onSubmit={applyFilters}>
            <input aria-label="调用来源" placeholder="如 connection_test" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} />
            <select aria-label="调用状态" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as LogFilters["status"] })}><option value="">全部状态</option><option value="pending">处理中</option><option value="succeeded">成功</option><option value="failed">失败</option><option value="cancelled">已取消</option></select>
            <select aria-label="实际模型" value={filters.modelConfigId} onChange={(event) => setFilters({ ...filters, modelConfigId: event.target.value })}><option value="">全部模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.adapter}/{model.model}</option>)}</select>
            <input aria-label="用户 ID" placeholder="用户 ID" value={filters.userId} onChange={(event) => setFilters({ ...filters, userId: event.target.value })} />
            <input aria-label="callId" placeholder="callId" value={filters.callId} onChange={(event) => setFilters({ ...filters, callId: event.target.value })} />
            <label><span>开始时间</span><input type="datetime-local" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label><label><span>结束时间</span><input type="datetime-local" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
            <div><button type="button" onClick={() => setFilters(initialLogFilters)}>清空</button><button type="submit" disabled={pagePending}>查询</button></div>
          </form>
          {loadError && <div className="llm-inline-error" role="alert"><CircleAlert size={15} />{loadError}</div>}
          <section className="admin-surface logs-surface">
            {calls.length === 0 ? <div className="llm-state"><Bot size={24} /><strong>当前筛选下没有 LLM 调用记录</strong><p>连接测试或内部 Chat 调用产生记录后，可通过刷新获取。</p></div> : (
              <div className="admin-table-wrap"><table className="admin-table llm-calls-table"><thead><tr><th>时间</th><th>来源 / 状态</th><th>能力 / 模型</th><th>Token / 预估费用</th><th>耗时 / 计量</th><th>错误码</th><th>callId</th></tr></thead><tbody>{calls.map((call) => <tr key={call.callId}><td>{new Date(call.createdAt).toLocaleString("zh-CN")}</td><td><strong className="table-strong">{call.source === "connection_test" ? "连接测试" : call.source}</strong><small className={`table-sub call-status ${call.status}`}>{statusLabel(call.status)}</small></td><td><strong className="table-strong">{call.adapter && call.model ? `${call.adapter}/${call.model}` : "未选择模型"}</strong><small className="table-sub">Chat · 用户 {call.userId}</small></td><td><strong className="table-strong">{call.inputTokens ?? "—"} / {call.outputTokens ?? "—"}</strong><small className="table-sub">${call.estimatedCostUsd ?? "—"}</small></td><td><strong className="table-strong">{call.latencyMs == null ? "—" : `${call.latencyMs} ms`}</strong><small className="table-sub">{meteringLabel(call.meteringStatus)}</small></td><td>{call.errorCode ?? "—"}</td><td><code>{call.callId}</code></td></tr>)}</tbody></table></div>
            )}
            <footer className="table-footer"><span>当前页 {calls.length} 条 · 汇总 {summary.callCount} 条</span><div><button type="button" onClick={() => void previous()} disabled={!cursorStack.length || pagePending}>上一页</button><button type="button" onClick={() => void next()} disabled={!nextCursor || pagePending}>下一页</button></div></footer>
          </section>
        </>
      )}
    </>
  );
}

function statusLabel(status: LlmCallRecord["status"]): string {
  return { pending: "处理中", succeeded: "成功", failed: "失败", cancelled: "已取消" }[status];
}

function meteringLabel(status: LlmCallRecord["meteringStatus"]): string {
  return { complete: "计量完整", partial: "计量部分", unknown: "计量未知" }[status];
}
