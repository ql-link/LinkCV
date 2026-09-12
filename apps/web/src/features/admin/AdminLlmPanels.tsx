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
  Trash2,
  X,
} from "lucide-react";
import { PageLoading } from "@/components/ui";
import {
  api,
  ApiRequestError,
  ChatAdapter,
  ChatCapability,
  ChatCatalog,
  ModelCapabilityRecord,
  ModelCapability,
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
    INVALID_LLM_MODEL_CONFIG: "Chat 模型配置不合法，请检查模型供应商、模型名称和地址。",
    LLM_MODEL_NOT_FOUND: "模型配置已不存在，请刷新后重试。",
    LLM_MODEL_CONFIG_CHANGED: "测试期间配置已被其他操作修改，请刷新后重试。",
    LLM_MODEL_IN_USE: "已绑定到系统能力的模型不可编辑或删除，请先切换对应能力的绑定。",
    LLM_CREDENTIALS_UNAVAILABLE: "API Key 缺失或服务端暂时无法安全读取凭据。",
    LLM_CONNECTION_FAILED: "连接测试失败，请检查模型供应商、模型名称、地址或 API Key。",
    LLM_CHAT_NOT_CONFIGURED: "Chat 当前尚未选择模型。",
    LLM_MODEL_NOT_CONFIGURED: "该能力当前尚未选择模型。",
    LLM_PI_AGENT_UNAVAILABLE: "Pi Agent 服务尚未接入，暂不能绑定。",
    LLM_PI_AGENT_TIMEOUT: "Pi Agent 连接测试超时，原绑定未改变。",
    LLM_PI_AGENT_PROBE_FAILED: "模型没有完成 Pi Agent 工具探针，原绑定未改变。",
    LLM_BINDING_CHANGED: "能力绑定已被其他操作修改，请刷新后重试。",
    LLM_CAPABILITY_NOT_FOUND: "模型能力不存在，请刷新后重试。",
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
  const [capabilityMatrix, setCapabilityMatrix] = useState<ModelCapabilityRecord[]>([]);
  const [catalog, setCatalog] = useState<ChatCatalog | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [keyFilter, setKeyFilter] = useState("all");
  const [editor, setEditor] = useState<LlmModelConfig | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LlmModelConfig | null>(null);
  const [bindingEditorOpen, setBindingEditorOpen] = useState(false);
  const [genericBinding, setGenericBinding] = useState<ModelCapabilityRecord | null>(null);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
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
        try {
          const matrix = await api.getModelCapabilities();
          setCapabilityMatrix(matrix.capabilities);
        } catch {
          // Keep the legacy Chat view usable while an older backend rolls out.
          setCapabilityMatrix([]);
        }
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

  const adapterLabels = useMemo(
    () => new Map((catalog?.adapters ?? []).map((adapter) => [adapter.code, adapter.label])),
    [catalog?.adapters],
  );

  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (capability?.models ?? []).filter((model) => {
      const matchesQuery =
        !normalized ||
        model.model.toLowerCase().includes(normalized) ||
        model.adapter.toLowerCase().includes(normalized) ||
        adapterLabels.get(model.adapter)?.toLowerCase().includes(normalized);
      const matchesKey =
        keyFilter === "all" ||
        (keyFilter === "configured" && model.keyConfigured) ||
        (keyFilter === "missing" && !model.keyConfigured);
      return matchesQuery && matchesKey;
    });
  }, [adapterLabels, capability?.models, keyFilter, query]);

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

  return (
    <>
      <PanelHeading
        eyebrow="AI 基础设施"
        title="模型配置"
        description="先接入并验证模型，再为每项系统能力选择唯一绑定。"
        action={
          <button className="admin-primary-button" type="button" onClick={() => setEditor("new")}>
            <Plus size={16} />
            新增模型
          </button>
        }
      />

      {loadState === "loading" && (
        <section className="admin-surface">
          <PageLoading label="正在加载 Chat 模型配置…" scope="panel" />
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
          <section className="llm-config-section" aria-labelledby="llm-capabilities-heading">
            <div className="llm-section-heading">
              <div>
                <span className="page-eyebrow">能力配置</span>
                <h2 id="llm-capabilities-heading">系统能力</h2>
                <p>点击能力，选择它在运行时实际使用的模型。</p>
              </div>
            </div>
            <button
              className="model-summary chat-capability-card"
              type="button"
              onClick={() => setBindingEditorOpen(true)}
            >
              <div>
                <span className="model-summary-icon"><Bot size={20} /></span>
                <div>
                  <small>对话能力</small>
                  <strong>Chat</strong>
                  <p>
                    {capability.activeModel
                      ? `已绑定 ${adapterLabels.get(capability.activeModel.adapter) ?? capability.activeModel.adapter} / ${capability.activeModel.model}`
                      : "尚未绑定模型，点击这里选择。"}
                  </p>
                </div>
              </div>
              <span className={capability.activeModel ? "enabled-pill" : "disabled-pill"}>
                {capability.activeModel ? "已绑定" : "未绑定"}
              </span>
            </button>
            {capabilityMatrix
              .filter((item) => item.capability !== "chat")
              .map((item) => (
                <button
                  className="model-summary chat-capability-card"
                  type="button"
                  key={item.capability}
                  onClick={() => setGenericBinding(item)}
                >
                  <div>
                    <span className="model-summary-icon"><Bot size={20} /></span>
                    <div>
                      <small>能力配置</small>
                      <strong>{capabilityLabel(item.capability)}</strong>
                      <p>
                        {item.activeModel
                          ? `已绑定 ${adapterLabels.get(item.activeModel.adapter) ?? item.activeModel.adapter} / ${item.activeModel.model}`
                          : "尚未绑定模型，点击这里选择。"}
                      </p>
                    </div>
                  </div>
                  <span className={item.activeModel ? "enabled-pill" : "disabled-pill"}>
                    {item.activeModel ? "已绑定" : "未绑定"}
                  </span>
                </button>
              ))}
          </section>

          <section className="llm-config-section" aria-labelledby="llm-models-heading">
            <div className="llm-section-heading">
              <div>
                <span className="page-eyebrow">模型接入</span>
                <h2 id="llm-models-heading">已接入模型</h2>
                <p>模型配置只负责连接和凭据；能力绑定在上方单独设置。</p>
              </div>
            </div>

            <section className="admin-surface llm-filter-bar" aria-label="模型筛选">
              <label className="table-search">
                <Search size={16} />
                <input
                  aria-label="按模型供应商或模型名称筛选"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索模型供应商或模型名称"
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
                <strong>还没有可用于 Chat 的模型</strong>
                <p>先接入模型并配置凭据，再从上方 Chat 能力中选择绑定。</p>
                <button type="button" onClick={() => setEditor("new")}>新增模型</button>
              </section>
            ) : visibleModels.length === 0 ? (
              <section className="admin-surface llm-state">
                <Search size={24} />
                <strong>没有符合筛选条件的模型</strong>
                <p>清除筛选可恢复全部已接入模型。</p>
              </section>
            ) : (
              <section className="models-list" aria-label="已接入模型">
                {visibleModels.map((model) => {
                  const testing = testingIds.has(model.id);
                  const transientResult = testResults[model.id];
                  return (
                    <article className={`model-card ${model.active ? "current-model-card" : ""}`} key={model.id}>
                      <div className="model-priority model-adapter-badge">
                        <Bot size={19} />
                        <small>{adapterLabels.get(model.adapter) ?? model.adapter}</small>
                      </div>
                      <div className="model-main">
                        <div className="model-title-row">
                          <h3>{model.model}</h3>
                          <span className={model.active ? "enabled-pill" : "disabled-pill"}>
                            {model.active ? "已绑定 Chat" : "未绑定"}
                          </span>
                        </div>
                        <p>{model.apiBase || "使用供应商默认地址"}</p>
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
                        <button type="button" onClick={() => void testModel(model)} disabled={testing}>
                          <TestTube2 size={14} />{testing ? "测试中…" : "测试连接"}
                        </button>
                        <button type="button" onClick={() => setEditor(model)} disabled={testing}>编辑</button>
                        <button
                          className="model-delete-button"
                          type="button"
                          aria-label={`删除 ${model.model}`}
                          onClick={() => setDeleteTarget(model)}
                          disabled={testing}
                        >
                          <Trash2 size={14} aria-hidden="true" />删除
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </section>
        </>
      )}

      {bindingEditorOpen && capability && (
        <ChatBindingEditor
          capability={capability}
          adapterLabels={adapterLabels}
          onClose={() => setBindingEditorOpen(false)}
          onAddModel={() => {
            setBindingEditorOpen(false);
            setEditor("new");
          }}
          onBound={async (message) => {
            setBindingEditorOpen(false);
            await load(false);
            notify(message);
          }}
          onSessionExpired={onSessionExpired}
        />
      )}

      {genericBinding && (
        <GenericBindingEditor
          capability={genericBinding}
          adapterLabels={adapterLabels}
          onClose={() => setGenericBinding(null)}
          onBound={async (message) => {
            setGenericBinding(null);
            await load(false);
            notify(message);
          }}
          onSessionExpired={onSessionExpired}
        />
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

      {deleteTarget && (
        <ModelDeleteDialog
          model={deleteTarget}
          adapterLabel={adapterLabels.get(deleteTarget.adapter) ?? deleteTarget.adapter}
          onClose={() => setDeleteTarget(null)}
          onDeleted={async () => {
            const deleted = deleteTarget;
            setDeleteTarget(null);
            await load(false);
            notify(`已删除 ${adapterLabels.get(deleted.adapter) ?? deleted.adapter} / ${deleted.model}`);
          }}
          onSessionExpired={onSessionExpired}
        />
      )}
    </>
  );
}

function ModelDeleteDialog({
  model,
  adapterLabel,
  onClose,
  onDeleted,
  onSessionExpired,
}: {
  model: LlmModelConfig;
  adapterLabel: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = `delete-model-${model.id}-title`;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !deleting) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      await api.deleteLlmModel(model.id);
      await onDeleted();
    } catch (caught) {
      setError(errorMessage(caught, "删除模型失败，请稍后重试。", onSessionExpired));
      setDeleting(false);
    }
  };

  return (
    <div
      className="plugin-admin-dialog-backdrop"
      onMouseDown={(event) => {
        if (!deleting && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="plugin-admin-dialog model-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id={titleId}>删除模型配置？</h2>
        <p>
          将删除 <strong>{adapterLabel} / {model.model}</strong>、加密凭据和验证证据。此操作不可恢复；历史调用日志会保留模型快照，已被系统能力绑定的配置不会被删除。
        </p>
        {error && <p className="llm-inline-error" role="alert"><CircleAlert size={15} />{error}</p>}
        <div>
          <button ref={cancelRef} className="admin-secondary-button" type="button" disabled={deleting} onClick={onClose}>取消</button>
          <button className="admin-danger-button" type="button" disabled={deleting} onClick={() => void remove()}>
            <Trash2 size={15} aria-hidden="true" />{deleting ? "正在删除…" : "确认删除"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ChatBindingEditor({
  capability,
  adapterLabels,
  onClose,
  onAddModel,
  onBound,
  onSessionExpired,
}: {
  capability: ChatCapability;
  adapterLabels: Map<string, string>;
  onClose: () => void;
  onAddModel: () => void;
  onBound: (message: string) => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [selectedId, setSelectedId] = useState(capability.activeModelId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const selectedModel = capability.models.find((model) => model.id === selectedId);
  const bindingUnchanged = selectedId === capability.activeModelId;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedModel || bindingUnchanged || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await api.bindChatModel(selectedModel.id);
      await onBound(`Chat 已绑定 ${adapterLabels.get(selectedModel.adapter) ?? selectedModel.adapter} / ${selectedModel.model} · ${response.callId}`);
    } catch (caught) {
      setError(
        errorMessage(
          caught,
          "测试并绑定失败，Chat 原绑定保持不变。",
          onSessionExpired,
        ),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className="llm-modal-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="llm-modal" role="dialog" aria-modal="true" aria-labelledby="chat-binding-title">
        <header>
          <div>
            <span className="page-eyebrow">能力配置</span>
            <h2 id="chat-binding-title">设置 Chat</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭 Chat 设置"><X size={18} /></button>
        </header>
        <form className="drawer-form" onSubmit={submit}>
          <div className="llm-current-binding">
            <small>当前绑定</small>
            <strong>
              {capability.activeModel
                ? `${adapterLabels.get(capability.activeModel.adapter) ?? capability.activeModel.adapter} / ${capability.activeModel.model}`
                : "尚未绑定模型"}
            </strong>
          </div>

          {capability.models.length === 0 ? (
            <div className="llm-binding-empty">
              <Bot size={22} />
              <strong>没有可绑定的模型</strong>
              <p>先接入一个 Chat 模型，再回到这里完成绑定。</p>
              <button type="button" onClick={onAddModel}>新增模型</button>
            </div>
          ) : (
            <fieldset className="llm-binding-list">
              <legend>选择 Chat 使用的模型</legend>
              {capability.models.map((model) => (
                <label
                  className={`llm-binding-option ${selectedId === model.id ? "selected" : ""}`}
                  key={model.id}
                >
                  <input
                    type="radio"
                    name="chat-model-binding"
                    value={model.id}
                    checked={selectedId === model.id}
                    onChange={() => setSelectedId(model.id)}
                  />
                  <span>
                    <strong>{adapterLabels.get(model.adapter) ?? model.adapter} / {model.model}</strong>
                    <small>
                      {model.keyConfigured ? "API Key 已配置" : "API Key 未配置"}
                      {model.lastTest
                        ? ` · 最近测试${model.lastTest.status === "succeeded" ? "成功" : "失败"}`
                        : " · 尚未测试"}
                    </small>
                  </span>
                  {model.active && <em>当前绑定</em>}
                </label>
              ))}
            </fieldset>
          )}

          {capability.models.length > 0 && (
            <div className="drawer-callout">
              <ShieldCheck size={18} />
              <p>绑定前会使用所选模型执行一次真实连接测试。只有测试成功才会更新 Chat；失败时原绑定保持不变。</p>
            </div>
          )}
          {error && <p className="llm-inline-error" role="alert"><CircleAlert size={15} />{error}</p>}
          {capability.models.length > 0 && (
            <footer>
              <button type="button" onClick={onClose}>取消</button>
              <button type="submit" disabled={!selectedModel || bindingUnchanged || saving}>
                {saving ? "测试并绑定中…" : bindingUnchanged ? "当前已绑定" : "测试并绑定"}
              </button>
            </footer>
          )}
        </form>
      </section>
    </div>
  );
}

function GenericBindingEditor({
  capability,
  adapterLabels,
  onClose,
  onBound,
  onSessionExpired,
}: {
  capability: ModelCapabilityRecord;
  adapterLabels: Map<string, string>;
  onClose: () => void;
  onBound: (message: string) => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [selectedId, setSelectedId] = useState(capability.activeModelId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedModel = capability.models.find((model) => model.id === selectedId);
  const unchanged = selectedId === capability.activeModelId;
  const label: Record<Exclude<ModelCapability, "chat">, string> = {
    resume_structuring: "简历结构化",
    pi_agent: "Pi Agent",
    job_image_structuring: "JD 图片解析",
  };
  const capabilityLabel = label[capability.capability as Exclude<ModelCapability, "chat">];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedModel || unchanged || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await api.bindModelCapability(
        capability.capability as Exclude<ModelCapability, "chat">,
        selectedModel.id,
        selectedModel.configVersion,
        capability.bindingVersion,
      );
      await onBound(
        `${capabilityLabel} 已绑定 ${adapterLabels.get(selectedModel.adapter) ?? selectedModel.adapter} / ${selectedModel.model} · ${response.callId}`,
      );
    } catch (caught) {
      setError(errorMessage(caught, "测试并绑定失败，原绑定保持不变。", onSessionExpired));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="llm-modal-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="llm-modal" role="dialog" aria-modal="true" aria-labelledby="generic-binding-title">
        <header>
          <div><span className="page-eyebrow">能力配置</span><h2 id="generic-binding-title">设置 {capabilityLabel}</h2></div>
          <button type="button" onClick={onClose} aria-label={`关闭${capabilityLabel}设置`}><X size={18} /></button>
        </header>
        <form className="drawer-form" onSubmit={submit}>
          <div className="llm-current-binding">
            <small>当前绑定</small>
            <strong>{capability.activeModel ? `${adapterLabels.get(capability.activeModel.adapter) ?? capability.activeModel.adapter} / ${capability.activeModel.model}` : "尚未绑定模型"}</strong>
          </div>
          {capability.models.length === 0 ? (
            <div className="llm-binding-empty"><Bot size={22} /><strong>没有可绑定的模型</strong><p>先接入一个模型，再回到这里完成绑定。</p></div>
          ) : (
            <fieldset className="llm-binding-list">
              <legend>选择 {capabilityLabel} 使用的模型</legend>
              {capability.models.map((model) => (
                <label className={`llm-binding-option ${selectedId === model.id ? "selected" : ""}`} key={model.id}>
                  <input type="radio" name={`${capability.capability}-model-binding`} value={model.id} checked={selectedId === model.id} onChange={() => setSelectedId(model.id)} />
                  <span><strong>{adapterLabels.get(model.adapter) ?? model.adapter} / {model.model}</strong><small>{model.keyConfigured ? "API Key 已配置" : "API Key 未配置"}{model.lastTest ? ` · 最近测试${model.lastTest.status === "succeeded" ? "成功" : "失败"}` : " · 尚未测试"}</small></span>
                  {capability.activeModelId === model.id && <em>当前绑定</em>}
                </label>
              ))}
            </fieldset>
          )}
          {capability.models.length > 0 && <div className="drawer-callout"><ShieldCheck size={18} /><p>绑定前会按该能力执行连接验证；失败时原绑定保持不变。</p></div>}
          {error && <p className="llm-inline-error" role="alert"><CircleAlert size={15} />{error}</p>}
          {capability.models.length > 0 && <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={!selectedModel || unchanged || saving}>{saving ? "测试并绑定中…" : unchanged ? "当前已绑定" : "测试并绑定"}</button></footer>}
        </form>
      </section>
    </div>
  );
}

function capabilityLabel(capability: ModelCapability): string {
  if (capability === "resume_structuring") return "简历结构化";
  if (capability === "job_image_structuring") return "JD 图片解析";
  if (capability === "pi_agent") return "Pi Agent";
  return "Chat";
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
            ? `已绑定模型完成验证并保存 · ${response.validationCallId}`
            : "模型配置已保存",
        );
      } else {
        const payload: LlmModelCreatePayload = {
          adapter,
          model: modelName.trim(),
          apiBase: apiBase.trim() || null,
        };
        if (apiKey.trim()) payload.apiKey = apiKey;
        await api.createLlmModel(payload);
        await onSaved("模型已接入；能力绑定没有改变");
      }
    } catch (caught) {
      setError(errorMessage(caught, "保存失败，请稍后重试。", onSessionExpired));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className="llm-modal-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="llm-modal" role="dialog" aria-modal="true" aria-labelledby="model-editor-title">
        <header>
          <div><span className="page-eyebrow">模型接入</span><h2 id="model-editor-title">{model ? "编辑模型" : "新增模型"}</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭模型编辑"><X size={18} /></button>
        </header>
        <form className="drawer-form" onSubmit={submit}>
          <label>
            <span>模型供应商</span>
            <select value={adapter} onChange={(event) => { setAdapter(event.target.value as ChatAdapter); setModelName(""); }} required>
              {catalog.adapters.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>模型名称</span>
            <input value={modelName} onChange={(event) => setModelName(event.target.value)} list={`models-${adapter}`} placeholder={adapter === "deepseek" ? "例如 deepseek-chat" : adapter === "dashscope" ? "例如 qwen-plus" : "输入供应商模型名称"} required />
            <datalist id={`models-${adapter}`}>{selectedAdapter?.models.map((name) => <option key={name} value={name} />)}</datalist>
            <small>可从建议中选择，也可填写供应商支持的其他模型名称。</small>
          </label>
          <label>
            <span>API Base <small>可选</small></span>
            <input type="url" value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="使用供应商默认地址" />
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
          <div className="drawer-callout"><ShieldCheck size={18} /><p>API Key 只会加密写入。{model?.active ? "该模型已绑定到 Chat，保存前会先验证拟议配置；失败不会覆盖当前版本。" : "保存模型不会改变任何能力绑定。"}</p></div>
          {error && <p className="llm-inline-error" role="alert"><CircleAlert size={15} />{error}</p>}
          <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={saving}>{saving ? (model?.active ? "验证并保存中…" : "保存中…") : model?.active ? "验证并保存" : "保存模型"}</button></footer>
        </form>
      </section>
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

export function LogsPanel({
  onSessionExpired,
  embedded = false,
}: PanelProps & { embedded?: boolean }) {
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
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

  const countActiveFilters = () =>
    [filters.source, filters.status, filters.modelConfigId, filters.userId.trim(), filters.callId.trim(), filters.from, filters.to]
      .filter(Boolean).length;

  const applyFilters = async () => {
    let nextQuery: LlmCallQuery;
    try { nextQuery = buildLogQuery(filters); } catch { setLoadError("时间筛选格式不合法，请检查后重试。"); return; }
    if (await loadPage(nextQuery)) {
      setAppliedQuery(nextQuery);
      setCurrentCursor(undefined);
      setCursorStack([]);
      setAppliedCount(countActiveFilters());
      setFilterOpen(false);
    }
  };
  const refresh = () => void loadPage(appliedQuery, currentCursor);
  const next = async () => { if (!nextCursor || pagePending) return; if (await loadPage(appliedQuery, nextCursor)) { setCursorStack((current) => [...current, currentCursor]); setCurrentCursor(nextCursor); } };
  const previous = async () => { if (!cursorStack.length || pagePending) return; const cursor = cursorStack[cursorStack.length - 1]; if (await loadPage(appliedQuery, cursor)) { setCursorStack((current) => current.slice(0, -1)); setCurrentCursor(cursor); } };

  return (
    <>
      {!embedded && <PanelHeading eyebrow="可观测性" title="LLM 调用日志" description="查询真实 Chat 调用的安全元数据；数据仅在手动刷新后更新。" action={<button className="admin-secondary-button" type="button" onClick={refresh} disabled={pagePending}><RefreshCw size={15} />{pagePending ? "刷新中…" : "刷新"}</button>} />}
      {loadState === "loading" && <section className="admin-surface"><PageLoading label="正在加载 LLM 调用日志…" scope="panel" /></section>}
      {loadState === "error" && <section className="admin-surface llm-state llm-error" role="alert"><CircleAlert size={22} /><strong>无法加载 LLM 调用日志</strong><p>{loadError}</p><button type="button" onClick={() => void loadPage(appliedQuery, currentCursor, true)}>重试</button></section>}
      {loadState === "ready" && (
        <>
          <section className="mini-metrics llm-summary-grid" aria-label="调用汇总">
            <div><span>调用次数</span><strong>{summary.callCount}</strong></div><div><span>不完整计量</span><strong>{summary.incompleteMeteringCount}</strong></div><div><span>输入 Token</span><strong>{summary.inputTokens ?? "—"}</strong></div><div><span>输出 Token</span><strong>{summary.outputTokens ?? "—"}</strong></div><div><span>预估费用 USD</span><strong>{summary.estimatedCostUsd ?? "—"}</strong></div>
          </section>
          <div className="observability-filterbar">
            <span>默认最近 24 小时 · {appliedCount} 个筛选条件</span>
            <button
              type="button"
              className="observability-filter-open"
              onClick={() => setFilterOpen(true)}
            >
              筛选
            </button>
          </div>
          {filterOpen && (
            <div className="drawer-layer" onClick={() => setFilterOpen(false)}>
              <aside
                className="admin-drawer log-filter-drawer"
                role="dialog"
                aria-modal="true"
                aria-label="筛选调用记录"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <div><h2>筛选调用记录</h2></div>
                  <button type="button" aria-label="关闭筛选" onClick={() => setFilterOpen(false)}><X size={18} /></button>
                </header>
                <form
                  className="log-filter-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void applyFilters();
                  }}
                >
                  <div className="log-filter-group">
                    <span>常用筛选</span>
                    <div className="log-filter-grid">
                      <input aria-label="调用来源" placeholder="调用来源" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} />
                      <select aria-label="调用状态" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as LogFilters["status"] })}><option value="">调用状态</option><option value="pending">处理中</option><option value="succeeded">成功</option><option value="failed">失败</option><option value="cancelled">已取消</option></select>
                      <select aria-label="实际模型" value={filters.modelConfigId} onChange={(event) => setFilters({ ...filters, modelConfigId: event.target.value })}><option value="">实际模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.adapter}/{model.model}</option>)}</select>
                      <input aria-label="用户 ID" placeholder="用户 ID" value={filters.userId} onChange={(event) => setFilters({ ...filters, userId: event.target.value })} />
                      <input aria-label="callId" placeholder="callId" value={filters.callId} onChange={(event) => setFilters({ ...filters, callId: event.target.value })} />
                    </div>
                  </div>
                  <div className="log-filter-group">
                    <span>时间范围</span>
                    <div className="log-filter-grid">
                      <input aria-label="开始时间" type="datetime-local" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
                      <input aria-label="结束时间" type="datetime-local" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
                    </div>
                  </div>
                  <footer className="log-filter-footer">
                    <button type="button" onClick={() => setFilters(initialLogFilters)}>重置</button>
                    <button type="submit" disabled={pagePending}>应用</button>
                  </footer>
                </form>
              </aside>
            </div>
          )}
          {loadError && <div className="llm-inline-error" role="alert"><CircleAlert size={15} />{loadError}</div>}
          <section className="admin-surface logs-surface">
            {calls.length === 0 ? <div className="llm-state"><Bot size={24} /><strong>当前筛选下没有 LLM 调用记录</strong><p>连接测试或内部 Chat 调用产生记录后，可通过刷新获取。</p></div> : (
              <div className="admin-table-wrap"><table className="admin-table llm-calls-table"><thead><tr><th>时间</th><th>来源 / 状态</th><th>能力 / 模型</th><th>Token / 预估费用</th><th>耗时 / 计量</th><th>错误码</th></tr></thead><tbody>{calls.map((call) => <tr key={call.callId}><td>{new Date(call.createdAt).toLocaleString("zh-CN")}</td><td><strong className="table-strong">{call.source === "connection_test" ? "连接测试" : call.source}</strong><small className={`table-sub call-status ${call.status}`}>{statusLabel(call.status)}</small></td><td><strong className="table-strong">{call.adapter && call.model ? `${call.adapter}/${call.model}` : "未选择模型"}</strong><small className="table-sub">Chat · 用户 {call.userId}</small></td><td><strong className="table-strong">{call.inputTokens ?? "—"} / {call.outputTokens ?? "—"}</strong><small className="table-sub">${call.estimatedCostUsd ?? "—"}</small></td><td><strong className="table-strong">{call.latencyMs == null ? "—" : `${call.latencyMs} ms`}</strong><small className="table-sub">{meteringLabel(call.meteringStatus)}</small></td><td>{call.errorCode ?? "—"}</td></tr>)}</tbody></table></div>
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
