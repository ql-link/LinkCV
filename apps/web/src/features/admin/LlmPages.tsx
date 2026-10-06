import { useMemo, useState } from "react";
import { BadgeCheck, ChevronRight, Download, CircleAlert, Coins, Eye, EyeOff, KeyRound, Layers, Pencil, Plus, RefreshCw, Route as RouteIcon, Timer, Trash2, Workflow, Zap } from "lucide-react";
import {
  api,
  type LlmBinding,
  type LlmCatalog,
  type LlmConnection,
  type LlmModel,
  type LlmRoute,
} from "../../api/client";
import { Donut, DonutLegend, OTHER_COLOR, SERIES_COLORS } from "./charts";
import {
  Avatar,
  Button,
  ConfirmModal,
  DataTable,
  ErrorState,
  Field,
  Footnote,
  IconButton,
  MoreMenu,
  InlineError,
  LinkButton,
  LoadingRegion,
  Logo,
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
  TextTabs,
  Toggle,
  errorCode,
  formatCosts,
  formatDate,
  parseTime,
  formatDelta,
  formatMoney,
  formatMs,
  formatNumber,
  formatPercent,
  formatWhen,
  useCaseLabel,
  useConsole,
  useLoad,
} from "./kit";
import { modelIcon, providerIcon, vendorIcon } from "./brandIcons";

/* ---------- shared LLM data ---------- */

export type LlmData = { catalog: LlmCatalog; connections: LlmConnection[]; models: LlmModel[]; routes: LlmRoute[]; bindings: LlmBinding[] };

export function useLlmData() {
  return useLoad<LlmData>(async () => {
    const [catalog, connections, models, routes, bindings] = await Promise.all([
      api.getLlmCatalog(), api.listLlmConnections(), api.listLlmModels(), api.listLlmRoutes(), api.listLlmBindings(),
    ]);
    return { catalog, connections: connections.connections, models: models.models, routes: routes.routes, bindings: bindings.bindings };
  });
}

const providerColors: Record<string, string> = {
  aihubmix: "#3d5fd9", siliconflow: "#7a4fd6", deepseek: "#4d6bfe", volcengine: "#d9573d", aliyun: "#e8791a", opencode_zen: "#232421",
};

const avatarSizes = { sm: 20, md: 24, lg: 28 } as const;

/** Small model-family mark in lists; an empty slot keeps names aligned when the family is unknown. */
function ModelMark({ icon }: { icon: string | null }) {
  return <span className="adm-model-mark" aria-hidden="true">{icon && <img src={icon} alt="" width={14} height={14} draggable={false} />}</span>;
}

export function ProviderAvatar({ code, label, size = "sm" }: { code: string; label: string; size?: "sm" | "md" | "lg" }) {
  const icon = providerIcon(code);
  return icon ? <Logo letter={label} icon={icon} size={avatarSizes[size]} /> : <Avatar label={label} size={size} color={providerColors[code] ?? "#858883"} />;
}

/** V4 provider mark: white tile with the provider's brand icon (coloured initial as fallback). */
export function ProviderLogo({ code, label, size = 22 }: { code: string; label: string; size?: number }) {
  return <Logo letter={label} color={providerColors[code] ?? "#454842"} size={size} icon={providerIcon(code)} />;
}

/**
 * Model developers (`llm_models.developer_name`) are free text, usually a lowercase slug from the
 * catalog. Known slugs get a display name and brand colour; anything else is shown as written.
 */
const vendors: Record<string, { label: string; color: string }> = {
  openai: { label: "OpenAI", color: "#111827" },
  alibaba: { label: "阿里云 · 通义", color: "#ff6a00" },
  qwen: { label: "阿里云 · 通义", color: "#ff6a00" },
  google: { label: "Google", color: "#4285f4" },
  zhipu: { label: "智谱 AI", color: "#2a55e5" },
  zai: { label: "智谱 AI", color: "#2a55e5" },
  minimax: { label: "MiniMax", color: "#e5484d" },
  anthropic: { label: "Anthropic", color: "#d97757" },
  xiaomi: { label: "小米", color: "#ff6900" },
  xai: { label: "xAI", color: "#111827" },
  bytedance: { label: "字节跳动", color: "#325ab4" },
  moonshot: { label: "Moonshot", color: "#111827" },
  moonshotai: { label: "Moonshot", color: "#111827" },
  deepseek: { label: "DeepSeek", color: "#4d6bfe" },
  nvidia: { label: "NVIDIA", color: "#76b900" },
  microsoft: { label: "Microsoft", color: "#00a4ef" },
  cohere: { label: "Cohere", color: "#39594d" },
  tencent: { label: "腾讯混元", color: "#0052d9" },
  baidu: { label: "百度", color: "#2932e1" },
  meta: { label: "Meta", color: "#0866ff" },
  mistral: { label: "Mistral", color: "#fa520f" },
};

export const UNLABELED_VENDOR = "__none";

export function vendorKey(developer: string | null | undefined) {
  const value = developer?.trim().toLowerCase();
  if (!value) return UNLABELED_VENDOR;
  // Aliases share one group ("qwen" and "alibaba" are the same vendor).
  const known = vendors[value];
  return known ? known.label : value;
}

export function vendorInfo(developer: string | null | undefined) {
  const value = developer?.trim();
  if (!value) return { label: "未标注厂商", color: "#b7792e" };
  return vendors[value.toLowerCase()] ?? { label: value, color: "#454842" };
}

export type VendorGroup<T> = { key: string; label: string; color: string; items: T[] };

/** Groups models by vendor: largest vendor first, the unlabelled bucket always last. */
export function groupByVendor<T extends { developerName: string | null }>(models: T[]): Array<VendorGroup<T>> {
  const groups = new Map<string, VendorGroup<T>>();
  for (const model of models) {
    const key = vendorKey(model.developerName);
    const info = vendorInfo(model.developerName);
    const group = groups.get(key) ?? { key, label: info.label, color: info.color, items: [] };
    group.items.push(model);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(a.key === UNLABELED_VENDOR) - Number(b.key === UNLABELED_VENDOR) || b.items.length - a.items.length || a.label.localeCompare(b.label, "zh-CN"));
}

const llmErrors: Record<string, string> = {
  LLM_CONFIG_CHANGED: "配置已被其他管理员修改，已刷新，请重新操作",
  LLM_CONNECTION_INVALID: "连接参数不被该接入商支持",
  LLM_CONNECTION_IN_USE: "连接下的线路仍被绑定或已有调用记录，不能删除",
  LLM_MODEL_IN_USE: "模型仍被线路绑定、会话或历史调用引用，不能删除",
  LLM_ROUTE_IN_USE: "线路仍被绑定或已有调用记录，不能删除；可以改为停用",
  LLM_ROUTE_INVALID: "线路配置与接入商不匹配",
  LLM_PROBE_REQUIRED: "请重新启用线路，系统将自动验证",
  LLM_UNAVAILABLE: "模型验证失败：上游不可用，请检查模型名称和接入配置",
  LLM_RESPONSE_INVALID: "模型验证失败：返回结果不符合该场景要求",
  INTENT_UNCERTAIN: "意图验证未通过：决策置信度不足，请检查识别规则后重试",
  INTENT_DECISION_INCONSISTENT: "意图验证未通过：分类、目标或澄清结果互相矛盾",
  LLM_REQUEST_REJECTED: "模型验证失败：上游拒绝请求，请检查协议和权限",
  LLM_TIMEOUT: "模型验证超时，请稍后重新启用",
  LLM_PI_AGENT_UNAVAILABLE: "模型验证失败：Pi Agent 服务不可用",
  LLM_CONNECTION_FAILED: "模型验证失败：无法连接上游服务",
  LLM_CREDENTIALS_UNAVAILABLE: "连接密钥不可用，请更换 Key",
  LLM_CATALOG_UNAVAILABLE: "上游目录暂不可用，稍后再试",
  LLM_CATALOG_UNSUPPORTED: "该接入商不支持目录同步",
  LLM_CONFLICT: "与已有配置冲突（名称或调用目标重复）",
};

export function llmMessage(error: unknown, prefix: string) {
  const code = errorCode(error);
  return llmErrors[code] ?? `${prefix}：${code}`;
}

export function priceText(pricing: Record<string, unknown> | null) {
  if (!pricing) return "未定价";
  const currency = typeof pricing.currency === "string" ? pricing.currency : "USD";
  const input = pricing.input_per_million;
  const output = pricing.output_per_million;
  if (input == null || output == null) return "未定价";
  return `${formatMoney(String(input), currency)} / ${formatMoney(String(output), currency)}`;
}

/* ---------- 06 connections ---------- */

const regions = ["cn-beijing", "ap-southeast-1", "cn-hongkong", "eu-central-1", "ap-northeast-1", "us-east-1"];
const workspaceRequired = new Set(["cn-beijing", "eu-central-1", "ap-northeast-1", "us-east-1"]);

function connectionAddress(connection: LlmConnection) {
  if (connection.providerCode === "aihubmix") return connection.settings.endpoint === "alternate" ? "备用地址" : "默认地址";
  if (connection.providerCode === "aliyun") return String(connection.settings.region ?? "");
  return "";
}

export function ConnectionsPage() {
  const { notify } = useConsole();
  const llm = useLlmData();
  const [editing, setEditing] = useState<LlmConnection | "new" | null>(null);
  const [rotating, setRotating] = useState<LlmConnection | null>(null);
  const [deleting, setDeleting] = useState<LlmConnection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const data = llm.data;
  const label = (code: string) => data?.catalog.providers.find((item) => item.code === code)?.label ?? code;

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try { await action(); notify(success); } catch (error) {
      notify(llmMessage(error, "操作失败"), "error");
    } finally { setBusy(null); void llm.reload(); }
  };

  const sync = async (row: LlmConnection) => {
    setBusy(row.id);
    try {
      const result = await api.syncLlmCatalog(row.id);
      notify(result.unchanged ? "目录没有变化" : `目录已同步，更新 ${result.synced} 个模型`);
    } catch (error) {
      notify(llmMessage(error, "同步失败"), "error");
    } finally { setBusy(null); void llm.reload(); }
  };

  const connections = data?.connections ?? [];
  const missingKey = connections.filter((item) => !item.keyConfigured);
  const routesInUse = (id: string) => {
    const routeIds = new Set((data?.routes ?? []).filter((route) => route.connectionId === id).map((route) => route.id));
    // A route bound to several use cases is still one route in use.
    return new Set((data?.bindings ?? []).filter((binding) => routeIds.has(binding.routeId)).map((binding) => binding.routeId)).size;
  };
  return (
    <>
      <PageHeader title="接入连接" actions={<Button variant="primary" disabled={!data} onClick={() => setEditing("new")}>添加连接</Button>} />
      {missingKey.length > 0 && (
        <p className="adm-alert-line" role="status">
          <KeyRound size={16} aria-hidden="true" />
          <span>{missingKey.map((item) => item.name).join("、")}缺少 API Key，补充后才能启用</span>
          <LinkButton onClick={() => setRotating(missingKey[0])}>更换 Key</LinkButton>
        </p>
      )}
      {llm.loading && !data ? <LoadingRegion label="正在加载连接…"><SkeletonRows rows={5} columns={5} height={96} /></LoadingRegion> : !data ? <ErrorState code={llm.error} onRetry={() => void llm.reload()} /> : connections.length === 0 ? (
        <div className="adm-state"><strong>还没有连接，先添加一个接入商账号</strong></div>
      ) : (
        <ul className="adm-feed adm-rack" aria-label="连接">
          {connections.map((row, index) => {
            const provider = data.catalog.providers.find((item) => item.code === row.providerCode);
            const catalogCount = data.routes.filter((route) => route.connectionId === row.id && route.origin === "catalog").length;
            const inUse = routesInUse(row.id);
            return (
              <li key={row.id} style={{ "--adm-i": Math.min(index, 12) } as React.CSSProperties}>
                <ProviderLogo code={row.providerCode} label={label(row.providerCode)} size={36} />
                <div className="adm-rack-name">
                  <strong>{row.name}{!row.enabled && <span className="adm-feed-tag is-muted">已停用</span>}</strong>
                  <span>{[label(row.providerCode), connectionAddress(row)].filter(Boolean).join(" · ")}</span>
                </div>
                <span className={`adm-rack-fact${row.keyConfigured ? "" : " is-bad"}`}><KeyRound size={14} aria-hidden="true" />{row.keyConfigured ? "Key 已配置" : "Key 缺失"}</span>
                <span className="adm-rack-fact is-wide">
                  {provider?.catalogSync
                    ? <><RefreshCw size={14} aria-hidden="true" />{row.catalogSyncedAt ? `${catalogCount} 个模型 · ${formatWhen(row.catalogSyncedAt)} 同步` : "未同步目录"}</>
                    : <><Layers size={14} aria-hidden="true" />手动维护线路</>}
                </span>
                <span className="adm-rack-fact is-usage"><RouteIcon size={14} aria-hidden="true" />{inUse ? `${inUse} 条线路在用` : "未被使用"}</span>
                <Toggle label={`${row.enabled ? "停用" : "启用"}连接 ${row.name}`} checked={row.enabled} disabled={busy !== null} onChange={(next) => void run(row.id, () => api.updateLlmConnection(row.id, { baseVersion: row.runtimeConfigVersion, enabled: next }), next ? "连接已启用" : "连接已停用")} />
                <span className="adm-rack-actions">
                  {provider?.catalogSync && <IconButton icon={RefreshCw} label={busy === row.id ? "同步中…" : "同步目录"} disabled={busy !== null} className={busy === row.id ? "is-spinning" : undefined} onClick={() => void sync(row)} />}
                  <IconButton icon={KeyRound} label="更换 Key" onClick={() => setRotating(row)} />
                  <IconButton icon={Pencil} label="编辑" onClick={() => setEditing(row)} />
                  <IconButton icon={Trash2} label="删除" tone="bad" onClick={() => setDeleting(row)} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Footnote icon={CircleAlert}>一个连接 = 一个接入商账号的 API Key；Base URL 由服务端按接入商固定。修改 Key 或地址后，关联线路需要重新启用验证。</Footnote>
      {editing && data && <ConnectionModal catalog={data.catalog} connection={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void llm.reload(); }} />}
      {rotating && <RotateKeyModal connection={rotating} providerLabel={label(rotating.providerCode)} onClose={() => setRotating(null)} onSaved={() => { setRotating(null); void llm.reload(); }} />}
      {deleting && (
        <ConfirmModal title="删除连接？" confirmLabel="删除" danger busy={busy === "delete"} onCancel={() => setDeleting(null)} onConfirm={() => void run("delete", () => api.deleteLlmConnection(deleting.id), "连接已删除").then(() => setDeleting(null))}>
          <p>「{deleting.name}」及其下未被使用的线路会一并删除，逻辑模型保留。已被绑定或有调用记录的连接不能删除，可以改为停用。</p>
        </ConfirmModal>
      )}
    </>
  );
}

function ConnectionModal({ catalog, connection, onClose, onSaved }: { catalog: LlmCatalog; connection: LlmConnection | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useConsole();
  const [providerCode, setProviderCode] = useState(connection?.providerCode ?? catalog.providers[0]?.code ?? "aihubmix");
  const [name, setName] = useState(connection?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(connection?.settings.endpoint === "alternate" ? "alternate" : "primary");
  const [region, setRegion] = useState(String(connection?.settings.region ?? "cn-beijing"));
  const [workspace, setWorkspace] = useState(String(connection?.settings.workspace_id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsWorkspace = providerCode === "aliyun" && workspaceRequired.has(region);
  const valid = name.trim() && (connection || apiKey.trim()) && (!needsWorkspace || workspace.trim());

  const settings = () => {
    if (providerCode === "aihubmix") return endpoint === "alternate" ? { endpoint: "alternate" } : {};
    if (providerCode === "aliyun") return workspace.trim() ? { region, workspace_id: workspace.trim() } : { region };
    return {};
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (connection) {
        await api.updateLlmConnection(connection.id, { baseVersion: connection.runtimeConfigVersion, name: name.trim(), settings: settings() });
        notify("连接已保存，关联线路需重新启用验证");
      } else {
        await api.createLlmConnection({ providerCode, name: name.trim(), apiKey: apiKey.trim(), settings: settings() });
        notify("连接已创建，默认停用");
      }
      onSaved();
    } catch (caught) {
      setError(llmMessage(caught, "保存失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      width={560}
      title={connection ? "编辑连接" : "添加连接"}
      subtitle="Base URL 由服务端按接入商固定；创建后默认停用"
      onClose={onClose}
      busy={busy}
      footer={<><Button dismiss disabled={busy}>取消</Button><Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>{busy ? "保存中…" : connection ? "保存" : "添加连接"}</Button></>}
    >
      <div className="adm-form">
        <Field label="接入商">
          <div className="adm-provider-grid" role="radiogroup" aria-label="接入商">
            {catalog.providers.map((provider) => (
              <button key={provider.code} type="button" role="radio" aria-checked={providerCode === provider.code} disabled={Boolean(connection) && connection?.providerCode !== provider.code} onClick={() => setProviderCode(provider.code)}>
                <ProviderAvatar code={provider.code} label={provider.label} />{provider.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="连接名称" htmlFor="connection-name">
          <input id="connection-name" className="adm-input" value={name} maxLength={128} onChange={(event) => setName(event.target.value)} placeholder="例如：生产环境主账号" />
        </Field>
        {!connection && (
          <Field label="API Key" htmlFor="connection-key" hint="加密存储，保存后不再显示">
            <input id="connection-key" className="adm-input" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" />
          </Field>
        )}
        {providerCode === "aihubmix" && (
          <Field label="API 地址">
            <div className="adm-radio-list" role="radiogroup" aria-label="API 地址">
              <button type="button" role="radio" aria-checked={endpoint === "primary"} onClick={() => setEndpoint("primary")}><strong>默认地址</strong><span>aihubmix.com</span></button>
              <button type="button" role="radio" aria-checked={endpoint === "alternate"} onClick={() => setEndpoint("alternate")}><strong>备用地址</strong><span>api.inferera.com</span></button>
            </div>
          </Field>
        )}
        {providerCode === "aliyun" && (
          <div className="adm-form-row">
            <Field label="地域"><SelectBox label="地域" value={region} onChange={setRegion} options={regions.map((value) => ({ value, label: value }))} /></Field>
            <Field label="Workspace ID" htmlFor="connection-workspace" hint={needsWorkspace ? `${region} 地域必填` : "可选"}>
              <input id="connection-workspace" className="adm-input" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="ws-…" />
            </Field>
          </div>
        )}
        {error && <InlineError>{error}</InlineError>}
      </div>
    </Modal>
  );
}

function RotateKeyModal({ connection, providerLabel, onClose, onSaved }: { connection: LlmConnection; providerLabel: string; onClose: () => void; onSaved: () => void }) {
  const { notify } = useConsole();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateLlmConnection(connection.id, { baseVersion: connection.runtimeConfigVersion, apiKey: apiKey.trim() });
      notify("API Key 已更新，关联线路需重新启用验证");
      onSaved();
    } catch (caught) { setError(llmMessage(caught, "保存失败")); } finally { setBusy(false); }
  };
  return (
    <Modal width={480} title="更换 API Key" subtitle={`${connection.name} · ${providerLabel}`} onClose={onClose} busy={busy}
      footer={<><Button dismiss disabled={busy}>取消</Button><Button variant="primary" disabled={!apiKey.trim() || busy} onClick={() => void submit()}>{busy ? "保存中…" : "保存新 Key"}</Button></>}>
      <div className="adm-form">
        <Field label="新 API Key" htmlFor="rotate-key" hint="保存后，这个连接下所有线路的绑定需要重新启用验证才会恢复生效。">
          <input id="rotate-key" className="adm-input" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" />
        </Field>
        {error && <InlineError>{error}</InlineError>}
      </div>
    </Modal>
  );
}

/* ---------- 07 models & routes ---------- */

const VENDOR_PREVIEW = 4;

/** "9 月 3 日" (Figma V4 07 detail subtitle). */
function monthDayLabel(value: string | null | undefined) {
  const date = parseTime(value);
  return date ? `${date.getMonth() + 1} 月 ${date.getDate()} 日` : "—";
}

export function ModelsPage() {
  const { notify } = useConsole();
  const llm = useLlmData();
  // Calls per model over the last 24h for the detail header; one request for the whole list.
  const usage = useLoad(() => {
    const to = new Date();
    return api.adminInsightLlmUsage({ groupBy: "model", from: new Date(to.getTime() - 24 * 3600_000).toISOString(), to: to.toISOString() });
  });
  const data = llm.data;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Vendors the admin opened or collapsed by hand; the selected model's vendor is always open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modelEditor, setModelEditor] = useState<LlmModel | "new" | null>(null);
  const [routeEditor, setRouteEditor] = useState<{ route?: LlmRoute; modelId?: string } | null>(null);
  const [pending, setPending] = useState<{ kind: "model"; item: LlmModel } | { kind: "route"; item: LlmRoute } | null>(null);
  const [busy, setBusy] = useState(false);

  const connectionById = useMemo(() => new Map((data?.connections ?? []).map((item) => [item.id, item])), [data]);
  const routesByModel = useMemo(() => {
    const map = new Map<string, LlmRoute[]>();
    for (const route of data?.routes ?? []) map.set(route.modelId, [...(map.get(route.modelId) ?? []), route]);
    return map;
  }, [data]);
  const providerLabel = (code: string) => data?.catalog.providers.find((item) => item.code === code)?.label ?? code;

  const search = query.trim().toLowerCase();
  const matching = (data?.models ?? []).filter((model) => !search
    || model.displayName.toLowerCase().includes(search)
    || (model.developerName ?? "").toLowerCase().includes(search)
    || (routesByModel.get(model.id) ?? []).some((route) => route.invokeTarget.toLowerCase().includes(search)));
  const vendorGroups = useMemo(() => groupByVendor(matching), [matching]); // eslint-disable-line react-hooks/exhaustive-deps
  const allGroups = useMemo(() => groupByVendor(data?.models ?? []), [data]);
  const selected = data?.models.find((item) => item.id === selectedId) ?? vendorGroups[0]?.items[0] ?? null;
  const selectedVendor = selected ? vendorKey(selected.developerName) : null;
  const isOpen = (key: string) => toggled[key] ?? (Boolean(search) || key === selectedVendor);

  const toggleRoute = async (route: LlmRoute, next: boolean) => {
    try { await api.updateLlmRoute(route.id, { enabled: next }); notify(next ? "线路已启用" : "线路已停用"); } catch (error) { notify(llmMessage(error, "操作失败"), "error"); } finally { void llm.reload(); }
  };

  const remove = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "model") await api.deleteLlmModel(pending.item.id);
      else await api.deleteLlmRoute(pending.item.id);
      notify(pending.kind === "model" ? "模型已删除" : "线路已删除");
      if (pending.kind === "model") setSelectedId(null);
    } catch (error) { notify(llmMessage(error, "删除失败"), "error"); } finally { setBusy(false); setPending(null); void llm.reload(); }
  };

  const setSelectable = async (model: LlmModel, next: boolean) => {
    try { await api.updateLlmModel(model.id, { userSelectable: next }); notify(next ? "已对用户开放" : "已对用户隐藏"); } catch (error) { notify(llmMessage(error, "操作失败"), "error"); } finally { void llm.reload(); }
  };

  const routes = selected ? routesByModel.get(selected.id) ?? [] : [];
  const usedBy = selected && data ? data.bindings.filter((binding) => routes.some((route) => route.id === binding.routeId)) : [];
  const useCaseRank = (useCase: string) => {
    const ordered = groupModelOrder(data?.bindings.filter((item) => item.useCase === useCase) ?? [], data?.routes ?? []);
    return ordered.indexOf(selected?.id ?? "") + 1;
  };
  const vendor = selected ? vendorInfo(selected.developerName) : null;
  const vendorSize = selected ? allGroups.find((group) => group.key === selectedVendor)?.items.length ?? 0 : 0;
  const firstPriced = routes.find((route) => priceText(route.pricing) !== "未定价");
  const calls24h = selected ? usage.data?.groups.find((group) => group.key === selected.id)?.calls ?? (usage.data ? 0 : null) : null;

  return (
    <>
      <PageHeader title="模型与线路" actions={<><Button disabled={!data?.models.length} onClick={() => setRouteEditor({ modelId: selected?.id })}>添加线路</Button><Button variant="primary" disabled={!data} onClick={() => setModelEditor("new")}>添加模型</Button></>} />
      {llm.loading && !data ? <LoadingRegion label="正在加载模型…"><SkeletonRows rows={6} columns={4} height={48} /></LoadingRegion> : !data ? <ErrorState code={llm.error} onRetry={() => void llm.reload()} /> : data.models.length === 0 ? (
        <div className="adm-state"><strong>还没有模型</strong><Button variant="primary" onClick={() => setModelEditor("new")}>添加模型</Button></div>
      ) : (
        <div className="adm-master">
          <nav className="adm-master-list" aria-label="模型列表">
            <SearchInput value={query} onChange={setQuery} placeholder="搜索模型或调用目标" />
            <p className="adm-master-count">{vendorGroups.length} 个厂商 · {matching.length} 个模型</p>
            {vendorGroups.length === 0 && <p className="adm-muted adm-small">没有符合条件的模型</p>}
            {vendorGroups.map((group) => {
              const open = isOpen(group.key);
              const showAll = expanded.has(group.key) || Boolean(search);
              // Keep the selected model visible even when it sits beyond the preview.
              const visible = showAll ? group.items : group.items.filter((item, index) => index < VENDOR_PREVIEW || item.id === selected?.id);
              const unlabeled = group.key === UNLABELED_VENDOR;
              return (
                <div key={group.key} className={`adm-vendor${open ? " is-open" : ""}`}>
                  <button type="button" className="adm-vendor-head" aria-expanded={open} onClick={() => setToggled((current) => ({ ...current, [group.key]: !open }))}>
                    <ChevronRight size={14} className="adm-vendor-caret" aria-hidden="true" />
                    {unlabeled ? <CircleAlert size={16} className="adm-tone-warn" aria-hidden="true" /> : <Logo letter={group.label} color={group.color} size={20} icon={vendorIcon(group.items[0]?.developerName)} />}
                    <span>{group.label}</span>
                    <b className={unlabeled ? "adm-tone-warn" : undefined}>{group.items.length}</b>
                  </button>
                  {open && (
                    <ul className="adm-vendor-models">
                      {visible.map((model) => {
                        const own = routesByModel.get(model.id) ?? [];
                        const enabled = own.filter((route) => route.enabled).length;
                        return (
                          <li key={model.id}>
                            <button type="button" className={`adm-vendor-model${model.id === selected?.id ? " is-active" : ""}`} aria-current={model.id === selected?.id || undefined} title={model.displayName} onClick={() => setSelectedId(model.id)}>
                              <span className="adm-ellipsis">{model.displayName}</span>
                              <small className={enabled ? "is-on" : undefined} aria-label={enabled ? `${enabled}/${own.length} 条线路启用` : own.length ? "线路未启用" : "没有线路"}>
                                <i className={`adm-dot adm-dot-${enabled ? "ok" : "muted"}`} aria-hidden="true" />{enabled ? `${enabled} 条线路` : own.length ? "未启用" : "无线路"}
                              </small>
                            </button>
                          </li>
                        );
                      })}
                      {!showAll && group.items.length > visible.length && (
                        <li><button type="button" className="adm-vendor-more" onClick={() => setExpanded((current) => new Set(current).add(group.key))}>还有 {group.items.length - visible.length} 个 · 展开全部</button></li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
          {selected && vendor && (
            <section className="adm-detail adm-swap" key={selected.id} aria-label={`${selected.displayName} 详情`}>
              <header className="adm-detail-head">
                <Logo letter={vendor.label} color={vendor.color} size={44} icon={modelIcon(selected.displayName, selected.developerName)} />
                <div>
                  <h2>{selected.displayName}</h2>
                  <p>{vendor.label}{selectedVendor !== UNLABELED_VENDOR ? ` › ${vendorSize} 个模型中的一个` : ""} · 创建于 {monthDayLabel(selected.createdAt)}</p>
                </div>
                <label className="adm-inline-toggle">
                  {selected.userSelectable ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                  <span>{selected.userSelectable ? "用户可选" : "对用户隐藏"}</span>
                  <Toggle label={`${selected.displayName} 用户可选`} checked={selected.userSelectable} onChange={(next) => void setSelectable(selected, next)} />
                </label>
                <Button aria-label={`编辑模型 ${selected.displayName}`} onClick={() => setModelEditor(selected)}><Pencil size={14} aria-hidden="true" />编辑</Button>
                <MoreMenu label="更多模型操作" items={[{ label: "删除模型", icon: Trash2, tone: "bad", onSelect: () => setPending({ kind: "model", item: selected }) }]} />
              </header>
              <div className="adm-facts">
                <div><span><RouteIcon size={13} aria-hidden="true" />线路</span><strong>{routes.length} · {routes.filter((route) => route.enabled).length} 启用</strong></div>
                <div><span><Zap size={13} aria-hidden="true" />24h 调用</span><strong>{calls24h == null ? "—" : formatNumber(calls24h)}</strong></div>
                <div><span><Coins size={13} aria-hidden="true" />单价 / 百万 Token</span><strong>{firstPriced ? priceText(firstPriced.pricing).replace(" / ", " · ") : "未定价"}</strong></div>
                <div><span><Workflow size={13} aria-hidden="true" />用于</span><strong>{new Set(usedBy.map((item) => item.useCase)).size} 个场景</strong></div>
              </div>
              <div className="adm-block-head">
                <div className="adm-block-title"><h2>线路</h2></div>
                <LinkButton onClick={() => setRouteEditor({ modelId: selected.id })}><Plus size={14} aria-hidden="true" />添加线路</LinkButton>
              </div>
              <DataTable<LlmRoute>
                className="adm-route-table"
                rows={routes}
                rowKey={(row) => row.id}
                setKey={selected.id}
                empty="还没有线路"
                columns={[
                  { key: "target", label: "连接 / 调用目标", width: "minmax(0, 1fr)", render: (row) => {
                    const connection = connectionById.get(row.connectionId);
                    return (
                      <span className="adm-cell-with-avatar">
                        <ProviderLogo code={connection?.providerCode ?? ""} label={providerLabel(connection?.providerCode ?? "?")} />
                        <span className="adm-cell-stack">
                          <strong className="adm-ellipsis" title={row.invokeTarget}>{row.invokeTarget}</strong>
                          <small className="adm-route-meta">
                            <span>{connection?.name ?? `#${row.connectionId}`}</span>
                            <span>{priceText(row.pricing) === "未定价" ? "未设置单价" : priceText(row.pricing)}</span>
                          </small>
                        </span>
                      </span>
                    );
                  } },
                  { key: "available", label: "上游", width: "90px", render: (row) => <StatusDot tone={row.targetAvailable ? "ok" : "warn"}>{row.targetAvailable ? "可用" : "缺失"}</StatusDot> },
                  { key: "enabled", label: "启用", width: "40px", render: (row) => <Toggle label={`${row.enabled ? "停用" : "启用"}线路 #${row.id}`} checked={row.enabled} onChange={(next) => void toggleRoute(row, next)} /> },
                  { key: "actions", label: "", width: "60px", align: "right", render: (row) => (
                    <span className="adm-row-actions is-tight">
                      <IconButton icon={Pencil} label="编辑" onClick={() => setRouteEditor({ route: row })} />
                      <IconButton icon={Trash2} label="删除" tone="bad" onClick={() => setPending({ kind: "route", item: row })} />
                    </span>
                  ) },
                ]}
              />
              <p className="adm-used-by">
                <span>用于</span>
                {usedBy.length === 0 ? <span className="adm-muted">还没有加入任何使用场景</span> : [...new Set(usedBy.map((item) => item.useCase))].map((useCase) => (
                  <span key={useCase} className="adm-pill"><Workflow size={13} aria-hidden="true" />{useCaseLabel(useCase)} · 第 {useCaseRank(useCase)} 位</span>
                ))}
              </p>
            </section>
          )}
        </div>
      )}
      {modelEditor && <ModelModal model={modelEditor === "new" ? null : modelEditor} routeCount={modelEditor === "new" ? 0 : (routesByModel.get(modelEditor.id) ?? []).length} onClose={() => setModelEditor(null)} onSaved={() => { setModelEditor(null); void llm.reload(); }} />}
      {routeEditor && data && <RouteModal data={data} route={routeEditor.route ?? null} defaultModelId={routeEditor.modelId} onClose={() => setRouteEditor(null)} onSaved={() => { setRouteEditor(null); void llm.reload(); }} />}
      {pending && (
        <ConfirmModal title={pending.kind === "model" ? "删除模型？" : "删除线路？"} confirmLabel="删除" danger busy={busy} onCancel={() => setPending(null)} onConfirm={() => void remove()}>
          {pending.kind === "model"
            ? <p>「{pending.item.displayName}」及其未被使用的线路会一并删除。被会话、绑定或历史调用引用的模型不能删除。</p>
            : <p>线路 #{pending.item.id}（{pending.item.invokeTarget}）将被删除。已被绑定或有调用记录的线路不能删除，可以改为停用。</p>}
        </ConfirmModal>
      )}
    </>
  );
}

/** Model ids of a use case in resolver order (first binding priority per model). */
function groupModelOrder(bindings: LlmBinding[], routes: LlmRoute[]) {
  const modelOf = new Map(routes.map((route) => [route.id, route.modelId]));
  const order: string[] = [];
  for (const binding of bindings.slice().sort((a, b) => a.priority - b.priority)) {
    const modelId = modelOf.get(binding.routeId);
    if (modelId && !order.includes(modelId)) order.push(modelId);
  }
  return order;
}

function ModelModal({ model, routeCount, onClose, onSaved }: { model: LlmModel | null; routeCount: number; onClose: () => void; onSaved: () => void }) {
  const { notify } = useConsole();
  const [displayName, setDisplayName] = useState(model?.displayName ?? "");
  const [developer, setDeveloper] = useState(model?.developerName ?? "");
  const [selectable, setSelectable] = useState(model?.userSelectable ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = { displayName: displayName.trim(), developerName: developer.trim() || null, userSelectable: selectable };
    try {
      if (model) await api.updateLlmModel(model.id, body); else await api.createLlmModel(body);
      notify(model ? "模型已保存" : "模型已添加");
      onSaved();
    } catch (caught) { setError(llmMessage(caught, "保存失败")); } finally { setBusy(false); }
  };
  return (
    <Modal width={520} title={model ? "编辑模型" : "添加模型"} subtitle={model ? `${model.displayName} · ${routeCount} 条线路` : "逻辑模型是用户看到的名字；同一个模型可以挂多条线路"} onClose={onClose} busy={busy}
      footer={<><Button dismiss disabled={busy}>取消</Button><Button variant="primary" disabled={!displayName.trim() || busy} onClick={() => void submit()}>{busy ? "保存中…" : model ? "保存" : "添加模型"}</Button></>}>
      <div className="adm-form">
        <Field label="显示名称" htmlFor="model-name" hint="必填，1–128 字">
          <input id="model-name" className="adm-input" value={displayName} maxLength={128} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 DeepSeek V3" />
        </Field>
        <Field label="开发者（可选）" htmlFor="model-developer">
          <input id="model-developer" className="adm-input" value={developer} maxLength={128} onChange={(event) => setDeveloper(event.target.value)} placeholder="例如 DeepSeek" />
        </Field>
        <div className="adm-setting-row">
          <div><strong>用户可选</strong><span>关闭后该模型不出现在对话页的模型列表里，也不会被选为默认；已选中它的会话会在运行时报错</span></div>
          <Toggle label="用户可选" checked={selectable} onChange={setSelectable} />
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>
    </Modal>
  );
}

const identifierOptions = [
  { value: "pinned" as const, label: "pinned（固定版本）" },
  { value: "alias" as const, label: "alias（别名，随上游更新）" },
  { value: "unknown" as const, label: "unknown（未知）" },
];

function RouteModal({ data, route, defaultModelId, onClose, onSaved }: { data: LlmData; route: LlmRoute | null; defaultModelId?: string; onClose: () => void; onSaved: () => void }) {
  const { notify } = useConsole();
  const [modelId, setModelId] = useState(route?.modelId ?? defaultModelId ?? data.models[0]?.id ?? "");
  const [connectionId, setConnectionId] = useState(route?.connectionId ?? data.connections[0]?.id ?? "");
  const connection = data.connections.find((item) => item.id === connectionId);
  const provider = data.catalog.providers.find((item) => item.code === connection?.providerCode);
  const kinds = (provider?.targetKinds ?? ["model"]) as Array<LlmRoute["targetKind"]>;
  const [targetKind, setTargetKind] = useState<LlmRoute["targetKind"]>(route?.targetKind ?? "model");
  const [identifierKind, setIdentifierKind] = useState<LlmRoute["identifierKind"]>(route?.identifierKind ?? "pinned");
  const [invokeTarget, setInvokeTarget] = useState(route?.invokeTarget ?? "");
  const [inputPrice, setInputPrice] = useState(route?.pricing?.input_per_million != null ? String(route.pricing.input_per_million) : "");
  const [outputPrice, setOutputPrice] = useState(route?.pricing?.output_per_million != null ? String(route.pricing.output_per_million) : "");
  const [currency, setCurrency] = useState(typeof route?.pricing?.currency === "string" ? route.pricing.currency : "USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceMismatch = Boolean(inputPrice.trim()) !== Boolean(outputPrice.trim());
  const priceInvalid = [inputPrice, outputPrice].some((value) => value.trim() && !(Number(value) >= 0));
  const valid = (route || (modelId && connectionId && invokeTarget.trim())) && !priceMismatch && !priceInvalid;
  const effectiveKind = kinds.includes(targetKind) ? targetKind : kinds[0];

  const submit = async () => {
    setBusy(true);
    setError(null);
    const pricing = inputPrice.trim() ? { currency, input_per_million: inputPrice.trim(), output_per_million: outputPrice.trim() } : null;
    try {
      if (route) await api.updateLlmRoute(route.id, { identifierKind, pricing });
      else await api.createLlmRoute({ modelId: Number(modelId), connectionId: Number(connectionId), targetKind: effectiveKind, invokeTarget: invokeTarget.trim(), identifierKind, pricing });
      notify(route ? "线路已保存" : "线路已创建，请绑定使用场景，启用时自动验证");
      onSaved();
    } catch (caught) { setError(llmMessage(caught, "保存失败")); } finally { setBusy(false); }
  };

  const modelName = data.models.find((item) => item.id === route?.modelId)?.displayName;
  return (
    <Modal width={route ? 520 : 560} title={route ? "编辑线路" : "添加线路"} subtitle={route ? `#${route.id} · ${modelName ?? ""} · ${connection?.name ?? ""}` : "线路 = 模型通过哪个连接调用；创建后默认停用，需要绑定场景，启用时自动验证"} onClose={onClose} busy={busy}
      footer={<><Button dismiss disabled={busy}>取消</Button><Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>{busy ? "保存中…" : route ? "保存" : "添加线路"}</Button></>}>
      <div className="adm-form">
        {route ? (
          <div className="adm-readonly-grid">
            <div><span>调用目标</span><code className="adm-code">{route.invokeTarget}</code></div>
            <div><span>目标类型</span><strong>{route.targetKind}</strong></div>
          </div>
        ) : (
          <>
            <div className="adm-form-row">
              <Field label="逻辑模型"><SelectBox label="逻辑模型" value={modelId} onChange={setModelId} options={data.models.map((item) => ({ value: item.id, label: item.displayName }))} /></Field>
              <Field label="接入连接"><SelectBox label="接入连接" value={connectionId} onChange={setConnectionId} options={data.connections.map((item) => ({ value: item.id, label: `${data.catalog.providers.find((spec) => spec.code === item.providerCode)?.label ?? item.providerCode} · ${item.name}` }))} /></Field>
            </div>
            <div className="adm-form-row">
              <Field label="目标类型" hint="由连接的接入商决定可选项"><SelectBox label="目标类型" value={effectiveKind} onChange={setTargetKind} options={kinds.map((value) => ({ value, label: value }))} /></Field>
              <Field label="调用目标 ID" htmlFor="route-target" hint="上游 model / endpoint / deployment ID">
                <input id="route-target" className="adm-input" value={invokeTarget} maxLength={256} onChange={(event) => setInvokeTarget(event.target.value)} placeholder="例如 deepseek-chat" />
              </Field>
            </div>
          </>
        )}
        <Field label="标识类型"><SelectBox label="标识类型" value={identifierKind} onChange={setIdentifierKind} options={identifierOptions} /></Field>
        <div className="adm-form-row is-three">
          <Field label="输入单价 / 百万 Token" htmlFor="route-input-price"><input id="route-input-price" className="adm-input" inputMode="decimal" value={inputPrice} onChange={(event) => setInputPrice(event.target.value)} placeholder="0.00" /></Field>
          <Field label="输出单价 / 百万 Token" htmlFor="route-output-price"><input id="route-output-price" className="adm-input" inputMode="decimal" value={outputPrice} onChange={(event) => setOutputPrice(event.target.value)} placeholder="0.00" /></Field>
          <Field label="币种"><SelectBox label="币种" value={currency} onChange={setCurrency} options={[{ value: "USD", label: "USD" }, { value: "CNY", label: "CNY" }]} /></Field>
        </div>
        {priceMismatch || priceInvalid ? <InlineError>{priceMismatch ? "输入和输出单价需要同时填写" : "单价必须是非负数字"}</InlineError> : <small className="adm-muted">{route ? "调用目标、模型和连接创建后不可修改；如需更换请新建线路" : "单价可留空；填写时输入、输出需同时填写"}</small>}
        {error && <InlineError>{error}</InlineError>}
      </div>
    </Modal>
  );
}

/* ---------- 09 usage ---------- */

const windows = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 } as const;
const rangeLabels = { "24h": "24h", "7d": "7 天", "30d": "30 天" } as const;

/** One currency's total per group; mixed-currency groups only count their share in that currency. */
function costIn(item: { costs: Array<{ currency: string; amount: string }> }, currency: string) {
  return Number(item.costs.find((entry) => entry.currency === currency)?.amount ?? 0);
}

/**
 * Donut slices for the top groups; everything past the fifth slot folds into "其他" so a colour
 * always means the same entity. `colorOf` keeps an entity's colour identical in both donuts.
 */
export function compositionSlices<T extends { key: string }>(items: T[], value: (item: T) => number, label: (item: T) => string, colorOf: Map<string, string>, display?: (value: number) => string) {
  const sorted = items.filter((item) => value(item) > 0).sort((a, b) => value(b) - value(a));
  const head = sorted.filter((item) => colorOf.has(item.key));
  const rest = sorted.filter((item) => !colorOf.has(item.key));
  const slices = head.map((item) => ({ key: item.key, label: label(item), value: value(item), color: colorOf.get(item.key)!, display: display?.(value(item)) }));
  const other = rest.reduce((sum, item) => sum + value(item), 0);
  if (other > 0) slices.push({ key: "__other", label: "其他", value: other, color: OTHER_COLOR, display: display?.(other) });
  return slices;
}

type UsageGroup = { key: string; label: string; calls: number; successRate: number | null; p95Ms: number | null; costs: Array<{ currency: string; amount: string }> };

/** V4 09: models show their vendor logo; use cases and channels keep the colour dot shared with the donuts. */
function usageMark(row: UsageGroup, groupBy: string, colorOf: Map<string, string>) {
  if (groupBy === "model") {
    const vendor = vendorInfo(row.label);
    return <Logo letter={vendor.label} color={vendor.color} size={18} icon={modelIcon(row.label, null)} />;
  }
  return <i className="adm-dot" style={{ background: colorOf.get(row.key) ?? OTHER_COLOR }} aria-hidden="true" />;
}

/** Client-side CSV of the rows currently loaded (no export endpoint); BOM so Excel reads UTF-8. */
function downloadUsageCsv(rows: UsageGroup[], label: (row: UsageGroup) => string, noun: string, range: string) {
  const cell = (value: string | number | null) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [[noun, "调用", "费用", "成功率", "P95 (ms)"].join(",")];
  for (const row of rows) {
    const cost = row.costs.map((item) => `${item.amount} ${item.currency}`).join(" + ");
    lines.push([label(row), row.calls, cost, row.successRate == null ? null : (row.successRate * 100).toFixed(1) + "%", row.p95Ms].map(cell).join(","));
  }
  const url = URL.createObjectURL(new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `llm-usage-${noun}-${range}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function UsagePage() {
  const [range, setRange] = useState<keyof typeof windows>("24h");
  const [groupBy, setGroupBy] = useState<"model" | "useCase" | "connection">("model");
  const [query, setQuery] = useState("");
  const usage = useLoad(() => {
    const to = new Date();
    const from = new Date(to.getTime() - windows[range] * 3600_000);
    return api.adminInsightLlmUsage({ groupBy, from: from.toISOString(), to: to.toISOString() });
  }, [range, groupBy]);
  const data = usage.data;
  const label = (item: { key: string; label: string }) => (groupBy === "useCase" ? useCaseLabel(item.key) : item.label);
  const groups = (data?.groups ?? []).filter((item) => !query.trim() || label(item).toLowerCase().includes(query.trim().toLowerCase()));

  const change = (current: number | null | undefined, previous: number | null | undefined) => {
    if (current == null || previous == null || previous === 0) return null;
    return formatDelta(String((current - previous) / previous));
  };
  const calls = change(data?.summary.calls, data?.previous.calls);
  const rateDiff = data?.summary.successRate != null && data.previous.successRate != null ? data.summary.successRate - data.previous.successRate : null;

  // Colours follow the entity: the five busiest groups by calls own the five slots in both donuts.
  const colorOf = useMemo(() => new Map((data?.groups ?? []).slice().sort((a, b) => b.calls - a.calls).slice(0, SERIES_COLORS.length).map((item, index) => [item.key, SERIES_COLORS[index]])), [data]);
  const currency = data?.summary.costs[0]?.currency ?? "USD";
  const multiCurrency = (data?.summary.costs.length ?? 0) > 1;
  const callSlices = data ? compositionSlices(data.groups, (item) => item.calls, label, colorOf) : [];
  const costSlices = data ? compositionSlices(data.groups, (item) => costIn(item, currency), label, colorOf, (value) => formatMoney(value, currency)) : [];
  const groupNoun = groupBy === "model" ? "模型" : groupBy === "useCase" ? "能力" : "渠道";

  return (
    <>
      <PageHeader title="模型使用情况" actions={<><Segmented label="时间范围" value={range} onChange={setRange} options={[{ value: "24h", label: "24 小时" }, { value: "7d", label: "7 天" }, { value: "30d", label: "30 天" }]} /><Button disabled={!data?.groups.length} onClick={() => data && downloadUsageCsv(data.groups, label, groupNoun, range)}><Download size={14} aria-hidden="true" />导出数据</Button></>} />
      {usage.loading && !data ? <LoadingRegion label="正在加载使用情况…"><SkeletonMetrics /></LoadingRegion> : !data ? <ErrorState code={usage.error} onRetry={() => void usage.reload()} /> : (
        <Metrics items={[
          { label: "调用", value: formatNumber(data.summary.calls), note: calls?.text, tone: calls?.tone, icon: Zap, tint: "blue" },
          { label: "费用", value: formatCosts(data.summary), note: data.summary.unmeteredCallCount ? `${data.summary.unmeteredCallCount} 次未计价` : undefined, icon: Coins, tint: "green" },
          { label: "成功率", value: formatPercent(data.summary.successRate), note: rateDiff != null ? `${rateDiff >= 0 ? "+" : ""}${(rateDiff * 100).toFixed(1)}%` : undefined, tone: rateDiff == null ? undefined : rateDiff >= 0 ? "ok" : "bad", icon: BadgeCheck, tint: "violet" },
          { label: "P95 延迟", value: formatMs(data.summary.p95Ms), icon: Timer, tint: "amber" },
        ]} />
      )}
      <section className="adm-section adm-composition">
        <div className="adm-block-head">
          <div className="adm-block-title"><h2>调用与费用构成</h2><span>{rangeLabels[range]} · 颜色在两张图中对应同一个{groupNoun}</span></div>
          <TextTabs label="分组" value={groupBy} onChange={setGroupBy} options={[{ value: "model", label: "按模型" }, { value: "useCase", label: "按能力" }, { value: "connection", label: "按渠道" }]} />
        </div>
        {usage.loading && !data ? <SkeletonChart height={184} /> : data && data.groups.length === 0 ? <div className="adm-state"><strong>该时间范围内没有调用</strong></div> : data && (
          <div className="adm-pair adm-swap" key={`${range}|${groupBy}`}>
            <div>
              <div className="adm-block-title is-sub"><h2>调用占比</h2><span>按调用次数</span></div>
              <div className="adm-donut-body">
                <Donut size={184} ariaLabel={`按${groupNoun}的调用占比`} slices={callSlices} center={formatNumber(data.summary.calls)} sub="次调用" />
                <DonutLegend slices={callSlices} />
              </div>
            </div>
            <span className="adm-vrule" aria-hidden="true" />
            <div>
              <div className="adm-block-title is-sub"><h2>费用占比</h2><span>按估算费用{multiCurrency ? ` · 仅 ${currency}` : ""}</span></div>
              {costSlices.length === 0 ? <p className="adm-muted adm-empty-donut">该时间范围内没有计价的调用</p> : (
                <div className="adm-donut-body">
                  <Donut size={184} ariaLabel={`按${groupNoun}的费用占比`} slices={costSlices} center={formatMoney(costSlices.reduce((sum, item) => sum + item.value, 0), currency)} sub={data.summary.unmeteredCallCount ? `${data.summary.unmeteredCallCount} 次未计价` : "估算费用"} />
                  <DonutLegend slices={costSlices} />
                </div>
              )}
            </div>
          </div>
        )}
      </section>
      <span className="adm-rule" aria-hidden="true" />
      <section className="adm-section">
        <div className="adm-block-head">
          <div className="adm-block-title"><h2>明细</h2></div>
          <SearchInput value={query} onChange={setQuery} placeholder={`搜索${groupNoun}…`} width={210} />
        </div>
        {usage.loading && !data ? <SkeletonRows rows={5} columns={5} height={44} /> : (
          <DataTable
            className="adm-usage-table"
            busy={usage.loading}
            rows={groups}
            rowKey={(row) => row.key}
            empty="没有匹配的记录"
            columns={[
              { key: "label", label: groupNoun, width: "minmax(0, 1fr)", render: (row) => <span className="adm-cell-inline">{usageMark(row, groupBy, colorOf)}<span className="adm-usage-name">{label(row)}</span></span> },
              { key: "calls", label: "调用", width: "90px", align: "right", render: (row) => formatNumber(row.calls) },
              { key: "cost", label: "费用", width: "90px", align: "right", render: (row) => formatCosts(row) },
              { key: "rate", label: "成功率", width: "90px", align: "right", render: (row) => <StatusDot tone={row.successRate == null ? "muted" : row.successRate >= 0.98 ? "ok" : row.successRate >= 0.9 ? "warn" : "bad"}>{formatPercent(row.successRate)}</StatusDot> },
              { key: "p95", label: "P95", width: "70px", align: "right", render: (row) => formatMs(row.p95Ms) },
            ]}
          />
        )}
      </section>
    </>
  );
}
