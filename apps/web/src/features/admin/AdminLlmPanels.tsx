import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiRequestError, LlmBinding, LlmCallRecord, LlmCatalog, LlmConnection, LlmModel, LlmRoute } from "../../api/client";

type PanelProps = { onSessionExpired: () => void; notify: (message: string) => void };

function failure(error: unknown, onSessionExpired: () => void): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) onSessionExpired();
    return error.message || "请求失败";
  }
  return error instanceof Error ? error.message : "请求失败";
}

const useCaseLabels: Record<string, string> = {
  job_text_extraction: "职位文本提取",
  resume_structuring: "简历结构化",
  job_image_extraction: "职位图片识别",
  assistant_conversation: "用户对话",
  mock_interview: "模拟面试",
};

export function ModelsPanel({ onSessionExpired, notify }: PanelProps) {
  const [catalog, setCatalog] = useState<LlmCatalog | null>(null);
  const [connections, setConnections] = useState<LlmConnection[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [routes, setRoutes] = useState<LlmRoute[]>([]);
  const [bindings, setBindings] = useState<LlmBinding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providerCode, setProviderCode] = useState("aihubmix");
  const [aihubmixEndpoint, setAihubmixEndpoint] = useState("primary");
  const [connectionName, setConnectionName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [region, setRegion] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [keyConnectionId, setKeyConnectionId] = useState("");
  const [replacementKey, setReplacementKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [developer, setDeveloper] = useState("");
  const [routeModelId, setRouteModelId] = useState("");
  const [routeConnectionId, setRouteConnectionId] = useState("");
  const [targetKind, setTargetKind] = useState<"model" | "endpoint" | "deployment">("model");
  const [invokeTarget, setInvokeTarget] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("USD");
  const [bindingUseCase, setBindingUseCase] = useState("assistant_conversation");
  const [bindingRouteId, setBindingRouteId] = useState("");
  const [bindingProtocol, setBindingProtocol] = useState("openai_chat");
  const [bindingPriority, setBindingPriority] = useState(100);
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const [c, con, m, r, b] = await Promise.all([
        api.getLlmCatalog(), api.listLlmConnections(), api.listLlmModels(),
        api.listLlmRoutes(), api.listLlmBindings(),
      ]);
      setCatalog(c); setConnections(con.connections); setModels(m.models);
      setRoutes(r.routes); setBindings(b.bindings); setError("");
    } catch (cause) { setError(failure(cause, onSessionExpired)); }
  }, [onSessionExpired]);
  useEffect(() => { void load(); }, [load]);

  const act = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true); setError("");
    try { await operation(); await load(); notify(message); }
    catch (cause) { setError(failure(cause, onSessionExpired)); }
    finally { setBusy(false); }
  };
  const submitConnection = (event: FormEvent) => {
    event.preventDefault();
    const settings: Record<string, unknown> = {};
    if (providerCode === "aihubmix" && aihubmixEndpoint === "alternate") settings.endpoint = "alternate";
    if (region.trim()) settings.region = region.trim();
    if (workspace.trim()) settings.workspace_id = workspace.trim();
    void act(async () => {
      await api.createLlmConnection({ providerCode, name: connectionName.trim(), apiKey: apiKey.trim(), settings });
      setApiKey(""); setConnectionName("");
    }, "接入商连接已创建");
  };
  const submitModel = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => { await api.createLlmModel({ displayName: modelName.trim(), developerName: developer.trim() || null }); setModelName(""); setDeveloper(""); }, "逻辑模型已创建");
  };
  const rotateKey = (event: FormEvent) => {
    event.preventDefault();
    const connection = connections.find((item) => item.id === keyConnectionId);
    if (!connection) return;
    void act(async () => {
      await api.updateLlmConnection(connection.id, { baseVersion: connection.runtimeConfigVersion, apiKey: replacementKey.trim() });
      setReplacementKey("");
    }, "API Key 已更新，关联线路需重新探测");
  };
  const submitRoute = (event: FormEvent) => {
    event.preventDefault();
    if (Boolean(inputPrice.trim()) !== Boolean(outputPrice.trim())) { setError("输入和输出单价需要同时填写。"); return; }
    const pricing = inputPrice.trim() ? { currency: priceCurrency, input_per_million: inputPrice.trim(), output_per_million: outputPrice.trim() } : null;
    void act(async () => { await api.createLlmRoute({ modelId: Number(routeModelId), connectionId: Number(routeConnectionId), targetKind, invokeTarget: invokeTarget.trim(), pricing }); setInvokeTarget(""); }, "线路已创建，请先绑定使用场景并探测");
  };
  const submitBinding = (event: FormEvent) => {
    event.preventDefault();
    void act(() => api.putLlmBinding(bindingUseCase, bindingRouteId, { protocolCode: bindingProtocol, priority: bindingPriority, enabled: false }), "使用场景已绑定，请探测后启用");
  };
  const routeProviderCode = connections.find((item) => item.id === routeConnectionId)?.providerCode;
  const selectedProvider = catalog?.providers.find((item) => item.code === routeProviderCode);
  return <div className="admin-llm-panel">
    <header className="admin-page-heading"><div><span className="page-eyebrow">模型管理</span><h1>模型与路由</h1><p>配置接入商、模型线路及使用场景。只有探测通过且全部开关开启的对话模型会出现在用户列表。</p></div><button className="admin-secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} />刷新</button></header>
    {error && <p role="alert" className="llm-error">{error}</p>}
    <section className="admin-surface"><h2>1. 接入商连接</h2>
      <form onSubmit={submitConnection} className="log-filter-form">
        <label>厂商 <select value={providerCode} onChange={(event) => { setProviderCode(event.target.value); setAihubmixEndpoint("primary"); setRegion(""); setWorkspace(""); }}>{catalog?.providers.map((provider) => <option key={provider.code} value={provider.code}>{provider.label}</option>)}</select></label>
        <label>连接名称 <input required value={connectionName} onChange={(event) => setConnectionName(event.target.value)} placeholder="例如：生产环境主账号" /></label>
        <label>API Key <input required type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
        {providerCode === "aihubmix" && <label>API 地址 <select value={aihubmixEndpoint} onChange={(event) => setAihubmixEndpoint(event.target.value)}><option value="primary">默认地址</option><option value="alternate">备用地址</option></select></label>}
        {providerCode === "aliyun" && <><label>地域 <input required value={region} onChange={(event) => setRegion(event.target.value)} placeholder="cn-beijing" /></label><label>Workspace（可选） <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} /></label></>}
        <button type="submit" disabled={busy}>添加连接</button>
      </form>
      <table><thead><tr><th>连接</th><th>厂商</th><th>Key</th><th>状态</th><th>目录</th><th>操作</th></tr></thead><tbody>{connections.map((connection) => <tr key={connection.id}><td>{connection.name}{connection.providerCode === "aihubmix" && <small> · {connection.settings.endpoint === "alternate" ? "备用地址" : "默认地址"}</small>}</td><td>{connection.providerCode}</td><td>{connection.keyConfigured ? "已配置" : "缺失"}</td><td>{connection.enabled ? "启用" : "停用"}</td><td>{connection.catalogSyncedAt ? new Date(connection.catalogSyncedAt).toLocaleString() : "未同步"}</td><td><button type="button" disabled={busy} onClick={() => void act(() => api.updateLlmConnection(connection.id, { baseVersion: connection.runtimeConfigVersion, enabled: !connection.enabled }), connection.enabled ? "连接已停用" : "连接已启用")}>{connection.enabled ? "停用" : "启用"}</button>{connection.providerCode === "aihubmix" && <button type="button" disabled={busy} onClick={() => void act(() => api.updateLlmConnection(connection.id, { baseVersion: connection.runtimeConfigVersion, settings: connection.settings.endpoint === "alternate" ? {} : { endpoint: "alternate" } }), "API 地址已切换，关联线路需重新探测")}>{connection.settings.endpoint === "alternate" ? "使用默认地址" : "使用备用地址"}</button>}{catalog?.providers.find((item) => item.code === connection.providerCode)?.catalogSync && <button type="button" disabled={busy} onClick={() => void act(() => api.syncLlmCatalog(connection.id), "模型目录已同步")}>同步目录</button>}</td></tr>)}</tbody></table>
      <form onSubmit={rotateKey} className="log-filter-form"><label>更换连接 Key <select required value={keyConnectionId} onChange={(event) => setKeyConnectionId(event.target.value)}><option value="">选择连接</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label><label>新 API Key <input required type="password" autoComplete="new-password" value={replacementKey} onChange={(event) => setReplacementKey(event.target.value)} /></label><button disabled={busy}>保存新 Key</button></form>
    </section>
    <section className="admin-surface"><h2>2. 逻辑模型</h2><p>用户看到逻辑模型名称；同一个模型可以有多条线路。</p>
      <form onSubmit={submitModel} className="log-filter-form"><label>显示名称 <input required value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="例如：DeepSeek V3" /></label><label>开发者（可选） <input value={developer} onChange={(event) => setDeveloper(event.target.value)} /></label><button disabled={busy}>添加模型</button></form>
      <table><thead><tr><th>ID</th><th>名称</th><th>开发者</th><th>线路数</th></tr></thead><tbody>{models.map((model) => <tr key={model.id}><td>{model.id}</td><td>{model.displayName}</td><td>{model.developerName ?? "—"}</td><td>{routes.filter((route) => route.modelId === model.id).length}</td></tr>)}</tbody></table>
    </section>
    <section className="admin-surface"><h2>3. 调用线路</h2>
      <form onSubmit={submitRoute} className="log-filter-form"><label>逻辑模型 <select required value={routeModelId} onChange={(event) => setRouteModelId(event.target.value)}><option value="">选择模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label><label>接入商连接 <select required value={routeConnectionId} onChange={(event) => setRouteConnectionId(event.target.value)}><option value="">选择连接</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label><label>目标类型 <select value={targetKind} onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}>{(selectedProvider?.targetKinds ?? ["model", "endpoint", "deployment"]).map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label><label>调用目标 ID <input required value={invokeTarget} onChange={(event) => setInvokeTarget(event.target.value)} placeholder="上游 model / endpoint / deployment ID" /></label><label>输入单价（每百万 Token，可选） <input type="number" min="0" step="any" value={inputPrice} onChange={(event) => setInputPrice(event.target.value)} /></label><label>输出单价（每百万 Token，可选） <input type="number" min="0" step="any" value={outputPrice} onChange={(event) => setOutputPrice(event.target.value)} /></label><label>币种 <select value={priceCurrency} onChange={(event) => setPriceCurrency(event.target.value)}><option value="USD">USD</option><option value="CNY">CNY</option></select></label><button disabled={busy}>添加线路</button></form>
      <table><thead><tr><th>ID</th><th>模型</th><th>连接</th><th>调用目标</th><th>可用</th><th>状态</th><th>操作</th></tr></thead><tbody>{routes.map((route) => <tr key={route.id}><td>{route.id}</td><td>{models.find((model) => model.id === route.modelId)?.displayName ?? route.modelId}</td><td>{connections.find((item) => item.id === route.connectionId)?.name ?? route.connectionId}</td><td>{route.invokeTarget}</td><td>{route.targetAvailable ? "是" : "否"}</td><td>{route.enabled ? "启用" : "停用"}</td><td><button type="button" disabled={busy} onClick={() => void act(() => api.updateLlmRoute(route.id, { enabled: !route.enabled }), route.enabled ? "线路已停用" : "线路已启用")}>{route.enabled ? "停用" : "启用"}</button></td></tr>)}</tbody></table>
    </section>
    <section className="admin-surface"><h2>4. 使用场景绑定</h2><p>对话列表来自“用户对话”绑定。同一模型的线路按优先级从小到大尝试；前一条线路发生可切换的调用失败时，自动尝试下一条。</p>
      <form onSubmit={submitBinding} className="log-filter-form"><label>场景 <select value={bindingUseCase} onChange={(event) => setBindingUseCase(event.target.value)}>{catalog?.useCases.map((useCase) => <option key={useCase} value={useCase}>{useCaseLabels[useCase] ?? useCase}</option>)}</select></label><label>线路 <select required value={bindingRouteId} onChange={(event) => { setBindingRouteId(event.target.value); const route = routes.find((item) => item.id === event.target.value); const provider = connections.find((item) => item.id === route?.connectionId); setBindingProtocol(catalog?.providers.find((item) => item.code === provider?.providerCode)?.protocols[0] ?? "openai_chat"); }}><option value="">选择线路</option>{routes.map((route) => <option key={route.id} value={route.id}>#{route.id} {models.find((model) => model.id === route.modelId)?.displayName} / {route.invokeTarget}</option>)}</select></label><label>协议 <select value={bindingProtocol} onChange={(event) => setBindingProtocol(event.target.value)}>{(catalog?.providers.find((item) => item.code === connections.find((connection) => connection.id === routes.find((route) => route.id === bindingRouteId)?.connectionId)?.providerCode)?.protocols ?? ["openai_chat"]).map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}</select></label><label>优先级 <input type="number" min="0" value={bindingPriority} onChange={(event) => setBindingPriority(Number(event.target.value))} /></label><button disabled={busy}>绑定场景</button></form>
      <table><thead><tr><th>场景</th><th>模型 / 线路</th><th>协议</th><th>优先级</th><th>探测</th><th>状态</th><th>操作</th></tr></thead><tbody>{bindings.map((binding) => { const route = routes.find((item) => item.id === binding.routeId); const key = `${binding.useCase}:${binding.routeId}`; const priority = priorityDrafts[key] ?? binding.priority; return <tr key={key}><td>{useCaseLabels[binding.useCase] ?? binding.useCase}</td><td>{models.find((model) => model.id === route?.modelId)?.displayName ?? "—"} / #{binding.routeId}</td><td>{binding.protocolCode}</td><td><input aria-label={`线路 ${binding.routeId} 优先级`} type="number" min="0" value={priority} onChange={(event) => setPriorityDrafts((drafts) => ({ ...drafts, [key]: Number(event.target.value) }))} /><button type="button" disabled={busy || priority === binding.priority} onClick={() => void act(async () => { await api.updateLlmBinding(binding.useCase, binding.routeId, { priority }); setPriorityDrafts((drafts) => { const next = { ...drafts }; delete next[key]; return next; }); }, "线路优先级已更新")}>保存</button></td><td>{binding.validatedAt ? new Date(binding.validatedAt).toLocaleString() : "未探测"}</td><td>{binding.effective ? "生效" : binding.enabled ? "待恢复" : "停用"}</td><td><button type="button" disabled={busy} onClick={() => void act(() => api.probeLlmBinding(binding.useCase, binding.routeId), "线路探测通过")}>探测</button><button type="button" disabled={busy} onClick={() => void act(() => api.updateLlmBinding(binding.useCase, binding.routeId, { enabled: !binding.enabled }), binding.enabled ? "绑定已停用" : "绑定已启用")}>{binding.enabled ? "停用" : "启用"}</button><button type="button" disabled={busy} onClick={() => void act(() => api.deleteLlmBinding(binding.useCase, binding.routeId), "绑定已删除")}>删除</button></td></tr>; })}</tbody></table>
    </section>
  </div>;
}

export function LogsPanel({ onSessionExpired, embedded = false }: PanelProps & { embedded?: boolean }) {
  const [calls, setCalls] = useState<LlmCallRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (cursor?: string) => {
    setLoading(true); setError("");
    try { const result = await api.listLlmCalls(cursor); setCalls(result.calls); setNextCursor(result.nextCursor); }
    catch (cause) { setError(failure(cause, onSessionExpired)); }
    finally { setLoading(false); }
  }, [onSessionExpired]);
  useEffect(() => { void load(); }, [load]);
  return <div className="admin-llm-panel">{!embedded && <header className="admin-page-heading"><div><span className="page-eyebrow">可观测性</span><h1>模型调用日志</h1><p>记录系统能力与 Pi 对话的实际线路、用量和费用。</p></div><button className="admin-secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} />刷新</button></header>}{error && <p role="alert">{error}</p>}<section className="admin-surface"><table><thead><tr><th>时间</th><th>场景</th><th>来源</th><th>线路</th><th>状态</th><th>Token</th><th>费用</th><th>Call ID</th></tr></thead><tbody>{calls.map((call) => <tr key={call.id}><td>{new Date(call.createdAt).toLocaleString()}</td><td>{useCaseLabels[call.useCase] ?? call.useCase}</td><td>{call.source}</td><td>#{call.routeId}</td><td>{call.status}{call.errorCode ? ` · ${call.errorCode}` : ""}</td><td>{call.inputTokens ?? "—"} / {call.outputTokens ?? "—"}</td><td>{call.estimatedCost ? `${call.estimatedCost} ${call.costCurrency ?? ""}` : "—"}</td><td>{call.callId}</td></tr>)}</tbody></table>{nextCursor && <button type="button" disabled={loading} onClick={() => void load(nextCursor)}>加载更多</button>}</section></div>;
}
