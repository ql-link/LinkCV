/**
 * Capability config (Figma 346:367): a use case lists the logical models it may run, in the order the
 * resolver tries them. The resolver (backend `llm/resolver.py`) walks bindings by priority, takes the
 * model of the first effective binding as the default, and only fails over between routes of that same
 * model — so the page groups bindings by model and edits the order at that level.
 */
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ArrowRight, AudioLines, CircleAlert, Eye, EyeOff, FileText, Gauge, GripVertical, Image, Languages, ListChecks, MessageSquare, Mic, Plus, ScanText, Search, Trash2, UserRound, Workflow, type LucideIcon } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { api, type LlmBinding, type LlmModel, type LlmRoute } from "../../api/client";
import {
  Badge,
  Button,
  Chip,
  ConfirmModal,
  DataTable,
  ErrorState,
  Field,
  InlineError,
  LinkButton,
  LoadingRegion,
  Logo,
  Modal,
  MoreMenu,
  Footnote,
  PageHeader,
  Segmented,
  SelectBox,
  SkeletonRows,
  StatusDot,
  Toggle,
  formatWhen,
  insertionIndex,
  layoutMids,
  useFlip,
  useCaseLabel,
  useConsole,
} from "./kit";
import { modelIcon } from "./brandIcons";
import { ProviderAvatar, ProviderLogo, type LlmData, llmMessage, priceText, useLlmData, vendorInfo } from "./LlmPages";

const ASSISTANT = "assistant_conversation";

const useCaseIcons: Record<string, LucideIcon> = {
  assistant_conversation: MessageSquare,
  assistant_intent: Workflow,
  resume_structuring: ScanText,
  job_text_extraction: FileText,
  job_image_extraction: Image,
  mock_interview: UserRound,
  transcript_correction: Languages,
  job_match: Gauge,
  interview_prep: ListChecks,
  speech_to_text: Mic,
  text_to_speech: AudioLines,
};
const PRIORITY_STEP = 10;
// Priorities are unique per use case, so a reorder first parks rows above every final value.
const PARKING_OFFSET = 10_000;

export type ModelGroup = { model: LlmModel | undefined; modelId: string; bindings: LlmBinding[] };

/** Groups a use case's bindings by model; group order = the best (lowest) priority inside each group. */
export function groupBindings(bindings: LlmBinding[], routes: Map<string, LlmRoute>, models: Map<string, LlmModel>): ModelGroup[] {
  const sorted = bindings.slice().sort((a, b) => a.priority - b.priority || Number(a.routeId) - Number(b.routeId));
  const groups = new Map<string, ModelGroup>();
  for (const binding of sorted) {
    const modelId = routes.get(binding.routeId)?.modelId ?? `route:${binding.routeId}`;
    const group = groups.get(modelId) ?? { model: models.get(modelId), modelId, bindings: [] };
    group.bindings.push(binding);
    groups.set(modelId, group);
  }
  return [...groups.values()];
}

/**
 * Turns a desired grouped order into PATCH steps. Final priorities are 10, 20, 30… with each model's
 * routes consecutive, which is exactly the order the resolver will walk. Rows that already hold their
 * final value are left alone; every other row is parked above all final values first, so no single
 * step can hit the unique (use_case, priority) constraint: parked values are distinct and out of range,
 * final values are distinct, and an unmoved row only ever holds its own final value.
 */
export function planPriorities(groups: ModelGroup[]): { park: Array<{ routeId: string; priority: number }>; place: Array<{ routeId: string; priority: number }> } {
  const flat = groups.flatMap((group) => group.bindings);
  const moving = flat
    .map((binding, index) => ({ binding, priority: (index + 1) * PRIORITY_STEP }))
    .filter(({ binding, priority }) => binding.priority !== priority);
  const top = Math.max(PARKING_OFFSET, ...flat.map((binding) => binding.priority));
  return {
    park: moving.map(({ binding }, index) => ({ routeId: binding.routeId, priority: top + (index + 1) * PRIORITY_STEP })),
    place: moving.map(({ binding, priority }) => ({ routeId: binding.routeId, priority })),
  };
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

type DragState = { kind: "model"; id: string; to: number } | { kind: "route"; group: string; id: string; to: number };

/** The order shown while dragging: the dragged item already sits at its prospective slot. */
export function previewOrder(groups: ModelGroup[], drag: DragState | null): ModelGroup[] {
  if (!drag) return groups;
  if (drag.kind === "model") return moveItem(groups, groups.findIndex((group) => group.modelId === drag.id), drag.to);
  return groups.map((group) => (group.modelId === drag.group ? { ...group, bindings: moveItem(group.bindings, group.bindings.findIndex((item) => item.routeId === drag.id), drag.to) } : group));
}

export function CapabilitiesPage() {
  const { notify } = useConsole();
  const llm = useLlmData();
  const data = llm.data;
  const useCases = data?.catalog.useCases ?? [];
  const [useCase, setUseCase] = useState(ASSISTANT);
  const [adding, setAdding] = useState<{ modelId?: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "route"; binding: LlmBinding } | { kind: "model"; group: ModelGroup } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Optimistic order while a reorder is being written; cleared on reload.
  const [draft, setDraft] = useState<ModelGroup[] | null>(null);
  // Same interaction as the template grid: a dashed placeholder moves to the target slot and the other
  // items slide out of the way (FLIP); nothing is written until the drop.
  const [drag, setDrag] = useState<DragState | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const flip = useFlip(listRef, "capFlip");

  const routeById = useMemo(() => new Map((data?.routes ?? []).map((item) => [item.id, item])), [data]);
  const modelById = useMemo(() => new Map((data?.models ?? []).map((item) => [item.id, item])), [data]);
  const connectionById = useMemo(() => new Map((data?.connections ?? []).map((item) => [item.id, item])), [data]);
  const providerLabel = (code: string) => data?.catalog.providers.find((item) => item.code === code)?.label ?? code;
  const bindings = (data?.bindings ?? []).filter((item) => item.useCase === useCase);
  const serverGroups = useMemo(() => groupBindings(bindings, routeById, modelById), [bindings, routeById, modelById]);
  const groups = draft ?? serverGroups;
  const shown = previewOrder(groups, drag);
  const assistant = useCase === ASSISTANT;
  // Mirrors the resolver: the first group with an effective binding (and, for chat, a selectable model).
  const defaultModelId = shown.find((group) => group.bindings.some((item) => item.effective) && (!assistant || group.model?.userSelectable))?.modelId;

  const reload = async () => { await llm.reload(); setDraft(null); };

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try { await action(); notify(success); } catch (error) { notify(llmMessage(error, "操作失败"), "error"); } finally { setBusy(null); void reload(); }
  };

  const saveOrder = async (next: ModelGroup[]) => {
    const { park, place } = planPriorities(next);
    if (place.length === 0) return;
    setDraft(next);
    setBusy("order");
    try {
      for (const step of park) await api.updateLlmBinding(useCase, step.routeId, { priority: step.priority });
      for (const step of place) await api.updateLlmBinding(useCase, step.routeId, { priority: step.priority });
      notify("顺序已保存");
    } catch (error) {
      // Steps are not atomic; reloading shows whatever order actually landed.
      notify(`${llmMessage(error, "顺序保存失败")}，已重新加载当前顺序`, "error");
    } finally {
      setBusy(null);
      void reload();
    }
  };

  const moveModel = (from: number, to: number) => { flip.capture(); void saveOrder(moveItem(groups, from, to)); };
  const moveRoute = (groupIndex: number, from: number, to: number) => { flip.capture(); void saveOrder(groups.map((group, index) => (index === groupIndex ? { ...group, bindings: moveItem(group.bindings, from, to) } : group))); };

  const startDrag = (event: DragEvent<HTMLElement>, state: DragState, item: HTMLElement | null) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.id);
    // Drag the whole card/row, not just the small handle.
    if (item) {
      const rect = item.getBoundingClientRect();
      event.dataTransfer.setDragImage?.(item, event.clientX - rect.left, event.clientY - rect.top);
    }
    // Deferred so the browser snapshots the real item as the drag image before it becomes the placeholder.
    window.requestAnimationFrame(() => { flip.capture(); setDrag(state); });
  };

  // Targets are measured live from layout (offsetTop), so the moving placeholder never flips the index back.
  const trackDrag = (event: DragEvent<HTMLElement>, kind: DragState["kind"], container: HTMLElement | null, items: HTMLElement[]) => {
    if (drag?.kind !== kind || !container) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const to = insertionIndex(layoutMids(container, items, (node) => node.classList.contains("is-placeholder")), event.clientY);
    if (to !== drag.to) { flip.capture(); setDrag({ ...drag, to }); }
  };

  const endDrag = () => { flip.capture(); setDrag(null); };

  const drop = (event: DragEvent<HTMLElement>) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const next = shown;
    endDrag();
    void saveOrder(next);
  };

  const setSelectable = (model: LlmModel, next: boolean) => run(`model:${model.id}`, () => api.updateLlmModel(model.id, { userSelectable: next }), next ? "已对用户开放" : "已对用户隐藏");

  const effectiveCount = bindings.filter((item) => item.effective).length;

  // Sidebar status per use case: the model the resolver would pick, or why none is available.
  const caseStatus = (value: string): { tone: "ok" | "warn" | "bad"; text: string } => {
    const own = (data?.bindings ?? []).filter((item) => item.useCase === value);
    if (own.length === 0) return { tone: "bad", text: "还没有模型" };
    const chosen = groupBindings(own, routeById, modelById).find((group) => group.bindings.some((item) => item.effective) && (value !== ASSISTANT || group.model?.userSelectable));
    return chosen ? { tone: "ok", text: chosen.model?.displayName ?? "未知模型" } : { tone: "warn", text: "无生效线路" };
  };

  return (
    <>
      <PageHeader title="能力配置" actions={<Button variant="primary" disabled={!data} onClick={() => setAdding({})}><Plus size={14} aria-hidden="true" />添加模型</Button>} />
      {llm.loading && !data ? <LoadingRegion label="正在加载能力配置…"><SkeletonRows rows={4} columns={6} /></LoadingRegion> : !data ? <ErrorState code={llm.error} onRetry={() => void llm.reload()} /> : (
        <div className="adm-master is-cases">
          <div className="adm-case-list" role="tablist" aria-label="使用场景" aria-orientation="vertical">
            <p className="adm-master-count">使用场景</p>
            {useCases.map((value) => {
              const status = caseStatus(value);
              const Icon = useCaseIcons[value] ?? Workflow;
              return (
                <button key={value} type="button" role="tab" aria-selected={value === useCase} className={`adm-case${value === useCase ? " is-active" : ""}`} onClick={() => { setUseCase(value); setDraft(null); }}>
                  <Icon size={16} aria-hidden="true" />
                  <span><strong>{useCaseLabel(value)}</strong><small><i className={`adm-dot adm-dot-${status.tone}`} aria-hidden="true" />{status.text}</small></span>
                </button>
              );
            })}
          </div>
        <div className="adm-swap adm-stack-28" key={useCase}>
          <section className="adm-section">
            <div className="adm-case-head">
              <Chip icon={useCaseIcons[useCase] ?? Workflow} tint="blue" size={40} />
              <div>
                <h2>{useCaseLabel(useCase)}</h2>
                <span>{groups.length} 个模型 · {bindings.length} 条线路 · {effectiveCount} 条生效</span>
              </div>
              <LinkButton disabled={busy !== null} onClick={() => setAdding({})}><Plus size={14} aria-hidden="true" />加入模型</LinkButton>
            </div>
            {groups.length === 0 ? (
              <div className="adm-state"><strong>这个场景还没有模型</strong><span>添加模型后，按顺序使用第一个可用的模型；它的线路失败时依次切到下一条线路。</span><Button variant="primary" onClick={() => setAdding({})}>添加模型</Button></div>
            ) : (
              <ol
                ref={listRef}
                className={`adm-cap-list${busy === "order" ? " is-saving" : ""}${drag ? " is-dragging" : ""}`}
                aria-label={`${useCaseLabel(useCase)}的模型顺序`}
                aria-busy={busy === "order"}
                onDragOver={(event) => trackDrag(event, "model", listRef.current, [...(listRef.current?.querySelectorAll<HTMLElement>(":scope > .adm-cap-model") ?? [])])}
                onDrop={drop}
              >
                {shown.map((group, groupIndex) => {
                  const effective = group.bindings.some((item) => item.effective);
                  const hidden = assistant && group.model && !group.model.userSelectable;
                  const placeholder = drag?.kind === "model" && drag.id === group.modelId;
                  const routeDrag = drag?.kind === "route" && drag.group === group.modelId ? drag : null;
                  return (
                    <li
                      key={group.modelId}
                      data-cap-flip={group.modelId}
                      className={`adm-cap-model${placeholder ? " is-placeholder" : ""}`}
                      style={{ "--adm-i": Math.min(groupIndex, 12) } as CSSProperties}
                      aria-hidden={placeholder || undefined}
                    >
                      <header className="adm-cap-head">
                        <span
                          className="adm-cap-grip"
                          role="button"
                          tabIndex={0}
                          draggable={busy === null}
                          aria-label={`调整模型 ${group.model?.displayName ?? group.modelId} 的顺序，使用上下方向键`}
                          onDragStart={(event) => startDrag(event, { kind: "model", id: group.modelId, to: groupIndex }, event.currentTarget.closest("li"))}
                          onDragEnd={endDrag}
                          onKeyDown={(event) => {
                            if (busy !== null) return;
                            if (event.key === "ArrowUp") { event.preventDefault(); moveModel(groupIndex, groupIndex - 1); }
                            if (event.key === "ArrowDown") { event.preventDefault(); moveModel(groupIndex, groupIndex + 1); }
                          }}
                        ><GripVertical size={14} /></span>
                        <span className={`adm-cap-rank${group.modelId === defaultModelId ? " is-default" : ""}`}>{String(groupIndex + 1).padStart(2, "0")}</span>
                        <div className="adm-cap-model-name">
                          <Logo letter={vendorInfo(group.model?.developerName).label} color={vendorInfo(group.model?.developerName).color} size={30} icon={modelIcon(group.model?.displayName, group.model?.developerName)} />
                          <div className="adm-cap-title">
                            <strong>
                              <span className="adm-ellipsis">{group.model?.displayName ?? "未知模型"}</span>
                              {group.modelId === defaultModelId && <em className="adm-cap-default">默认</em>}
                            </strong>
                            <small>{vendorInfo(group.model?.developerName).label}{hidden && <> · <span>对用户隐藏</span></>}{!effective && <> · <span className="adm-tone-warn">无生效线路</span></>}</small>
                          </div>
                        </div>
                        {/* V4 lane: the failover chain reads inline; route controls open in a popover. */}
                        <PopoverPrimitive.Root modal={false}>
                          <PopoverPrimitive.Trigger className="adm-cap-chain" aria-label={`${group.model?.displayName ?? "模型"} 线路：${group.bindings.length} 条，点击管理`} disabled={busy === "order"}>
                            {group.bindings.map((item, index) => {
                              const connection = connectionById.get(routeById.get(item.routeId)?.connectionId ?? "");
                              return (
                                <span key={item.routeId} className="adm-cap-chain-item">
                                  {index > 0 && <ArrowRight size={14} className="adm-faint" aria-hidden="true" />}
                                  <span className="adm-cap-pill">
                                    <b>{index === 0 ? "主" : `备 ${index}`}</b>
                                    <span>{connection?.name ?? `#${item.routeId}`}</span>
                                    <i className={`adm-dot adm-dot-${item.effective ? "ok" : item.enabled ? "warn" : "muted"}`} aria-hidden="true" />
                                  </span>
                                </span>
                              );
                            })}
                          </PopoverPrimitive.Trigger>
                          <PopoverPrimitive.Portal>
                            <PopoverPrimitive.Content className="adm-select-content adm-cap-pop" align="start" sideOffset={8} collisionPadding={12} aria-label={`${group.model?.displayName ?? "模型"} 的线路`}>
                              <header className="adm-cap-pop-head">
                                <strong>线路切换顺序</strong>
                                <span>主线路失败时依次切到备用线路{group.bindings.length > 1 ? " · 拖动“主 / 备”调整" : ""}</span>
                              </header>
                      <div
                        className="adm-cap-routes"
                        onDragOver={(event) => {
                          const body = event.currentTarget.querySelector<HTMLElement>(".adm-tbody");
                          if (routeDrag) trackDrag(event, "route", body, [...(body?.querySelectorAll<HTMLElement>(":scope > .adm-tr") ?? [])]);
                        }}
                        onDrop={(event) => { if (routeDrag) drop(event); }}
                      >
                      <DataTable<LlmBinding>
                        headless
                        className="is-roomy"
                        rows={group.bindings}
                        rowKey={(item) => item.routeId}
                        // Stable identity: reordering routes must not replay the row entrance.
                        setKey={group.modelId}
                        rowAttrs={(item) => ({ "data-cap-flip": `route:${item.routeId}`, className: routeDrag?.id === item.routeId ? "is-placeholder" : undefined })}
                        columns={[
                          { key: "order", label: "", width: "40px", render: (item) => {
                            const index = group.bindings.indexOf(item);
                            return (
                              <span
                                className="adm-cap-route-grip"
                                role="button"
                                tabIndex={group.bindings.length > 1 ? 0 : -1}
                                draggable={busy === null && group.bindings.length > 1}
                                aria-label={`调整线路 #${item.routeId} 的切换顺序`}
                                onDragStart={(event) => startDrag(event, { kind: "route", group: group.modelId, id: item.routeId, to: index }, event.currentTarget.closest<HTMLElement>(".adm-tr"))}
                                onDragEnd={endDrag}
                                onKeyDown={(event) => {
                                  if (busy !== null) return;
                                  if (event.key === "ArrowUp") { event.preventDefault(); moveRoute(groupIndex, index, index - 1); }
                                  if (event.key === "ArrowDown") { event.preventDefault(); moveRoute(groupIndex, index, index + 1); }
                                }}
                              >{index === 0 ? "主" : `备${index}`}</span>
                            );
                          } },
                          { key: "route", label: "线路", width: "minmax(0, 1fr)", render: (item) => {
                            const route = routeById.get(item.routeId);
                            const connection = connectionById.get(route?.connectionId ?? "");
                            return (
                              <span className="adm-cell-with-avatar">
                                <ProviderLogo code={connection?.providerCode ?? ""} label={providerLabel(connection?.providerCode ?? "?")} />
                                <span className="adm-cell-stack">
                                  <strong>{connection?.name ?? "—"}</strong>
                                  <small className="adm-route-meta">
                                    <span title={route?.invokeTarget}>{route?.invokeTarget ?? "—"}</span>
                                    <span>{priceText(route?.pricing ?? null)}</span>
                                    <span>{item.protocolCode}</span>
                                    <span>{item.validatedAt ? `探测于 ${formatWhen(item.validatedAt)}` : "未探测"}</span>
                                  </small>
                                </span>
                              </span>
                            );
                          } },
                          { key: "state", label: "状态", width: "72px", render: (item) => <StatusDot tone={item.effective ? "ok" : item.enabled ? "warn" : "muted"}>{item.effective ? "生效" : item.enabled ? "待恢复" : "停用"}</StatusDot> },
                          { key: "actions", label: "", width: "150px", align: "right", render: (item) => (
                            <span className="adm-row-actions is-tight">
                              <Button className="adm-btn-sm" disabled={busy !== null} onClick={() => void run(`probe:${item.routeId}`, () => api.probeLlmBinding(item.useCase, item.routeId), "探测通过")}>{busy === `probe:${item.routeId}` ? "探测中…" : "探测"}</Button>
                              <Toggle label={`${item.enabled ? "停用" : "启用"}线路 #${item.routeId}`} checked={item.enabled} disabled={busy !== null} onChange={(next) => void run(`binding:${item.routeId}`, () => api.updateLlmBinding(item.useCase, item.routeId, { enabled: next }), next ? "线路已启用" : "线路已停用")} />
                              <MoreMenu label={`线路 #${item.routeId} 更多操作`} disabled={busy !== null} items={[
                                { label: `复制线路 ID #${item.routeId}`, onSelect: () => void navigator.clipboard?.writeText(item.routeId) },
                                { label: "移出场景", icon: Trash2, tone: "bad", onSelect: () => setPendingDelete({ kind: "route", binding: item }) },
                              ]} />
                            </span>
                          ) },
                        ]}
                      />
                      </div>
                              <footer className="adm-cap-pop-foot">
                                <LinkButton disabled={busy !== null} onClick={() => setAdding({ modelId: group.modelId })}><Plus size={14} aria-hidden="true" />添加线路</LinkButton>
                              </footer>
                            </PopoverPrimitive.Content>
                          </PopoverPrimitive.Portal>
                        </PopoverPrimitive.Root>
                        {assistant && group.model && (
                          <label className="adm-inline-toggle">
                            {group.model.userSelectable ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}<span>用户可选</span>
                            <Toggle label={`${group.model.displayName} 用户可选`} checked={group.model.userSelectable} disabled={busy !== null} onChange={(next) => void setSelectable(group.model!, next)} />
                          </label>
                        )}
                        <MoreMenu label={`${group.model?.displayName ?? "模型"} 更多操作`} disabled={busy !== null} items={[
                          { label: "添加线路", icon: Plus, onSelect: () => setAdding({ modelId: group.modelId }) },
                          { label: "移出场景", icon: Trash2, tone: "bad", onSelect: () => setPendingDelete({ kind: "model", group }) },
                        ]} />
                      </header>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <Footnote icon={CircleAlert}>
            {useCase === "assistant_intent" && "独立识别本轮目标，未配置或识别调用失败时沿用原有路由；启用后每轮可能增加模型调用。 "}
            {groups.length > 1 ? "拖动序号调整默认顺序，拖动“主 / 备”调整线路切换顺序。" : ""}
            {assistant
              ? "用户在对话里能选的，是这里列出且开启“用户可选”的模型；没选时使用排第一的可用模型。某个模型的主线路失败时，只会切到它自己的备用线路，不会换成别的模型。"
              : "这个场景使用排第一的可用模型；它的主线路失败时，只会切到它自己的备用线路，不会换成别的模型。"}
            {" "}新加入的线路默认停用，探测通过后才能启用。
          </Footnote>
        </div>
        </div>
      )}
      {adding && data && (
        <AddModelModal
          data={data}
          useCase={useCase}
          lockedModelId={adding.modelId}
          existing={bindings}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); void reload(); }}
        />
      )}
      {pendingDelete && (
        <ConfirmModal
          title={pendingDelete.kind === "model" ? "把模型移出这个场景？" : "移除这条线路？"}
          confirmLabel="移除"
          danger
          busy={busy === "delete"}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void run("delete", async () => {
            const targets = pendingDelete.kind === "model" ? pendingDelete.group.bindings : [pendingDelete.binding];
            for (const item of targets) await api.deleteLlmBinding(item.useCase, item.routeId);
          }, pendingDelete.kind === "model" ? "模型已移出场景" : "线路已移除").then(() => setPendingDelete(null))}
        >
          {pendingDelete.kind === "model"
            ? <p>「{pendingDelete.group.model?.displayName ?? "该模型"}」的 {pendingDelete.group.bindings.length} 条线路将不再用于「{useCaseLabel(useCase)}」。模型和线路本身保留，可以在其他场景继续使用。</p>
            : <p>线路 #{pendingDelete.binding.routeId} 将不再用于「{useCaseLabel(useCase)}」。线路本身保留。</p>}
        </ConfirmModal>
      )}
    </>
  );
}

/* ---------- add model to a use case ---------- */

type Mode = "existing" | "new";

function AddModelModal({ data, useCase, lockedModelId, existing, onClose, onSaved }: {
  data: LlmData;
  useCase: string;
  lockedModelId?: string;
  existing: LlmBinding[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useConsole();
  const assistant = useCase === ASSISTANT;
  const intent = useCase === "assistant_intent";
  const eligibleConnections = intent ? data.connections.filter((item) => data.catalog.providers.find((spec) => spec.code === item.providerCode)?.protocols.includes("openai_chat")) : data.connections;
  const boundRoutes = new Set(existing.map((item) => item.routeId));
  const boundModels = new Set(existing.map((item) => data.routes.find((route) => route.id === item.routeId)?.modelId));
  const [mode, setMode] = useState<Mode>("existing");
  const [query, setQuery] = useState("");
  const [modelId, setModelId] = useState(lockedModelId ?? "");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // New model + first route.
  const [name, setName] = useState("");
  const [developer, setDeveloper] = useState("");
  const [selectable, setSelectable] = useState(true);
  const [connectionId, setConnectionId] = useState(eligibleConnections[0]?.id ?? "");
  const [target, setTarget] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [currency, setCurrency] = useState("USD");

  const routesByModel = useMemo(() => {
    const map = new Map<string, LlmRoute[]>();
    for (const route of data.routes.filter((item) => !intent || eligibleConnections.some((connection) => connection.id === item.connectionId))) map.set(route.modelId, [...(map.get(route.modelId) ?? []), route]);
    return map;
  }, [data.routes, intent]);
  const keyword = query.trim().toLowerCase();
  const candidates = useMemo(() => data.models
    .filter((model) => (routesByModel.get(model.id) ?? []).some((route) => !boundRoutes.has(route.id)))
    .filter((model) => !keyword || `${model.displayName} ${model.developerName ?? ""}`.toLowerCase().includes(keyword))
    // Models already in this use case first (adding a backup route), then ones with enabled routes.
    .sort((a, b) => Number(boundModels.has(b.id)) - Number(boundModels.has(a.id))
      || Number((routesByModel.get(b.id) ?? []).some((route) => route.enabled)) - Number((routesByModel.get(a.id) ?? []).some((route) => route.enabled))
      || a.displayName.localeCompare(b.displayName, "zh-CN"))
    .slice(0, 60), [data.models, routesByModel, keyword]); // eslint-disable-line react-hooks/exhaustive-deps

  const model = data.models.find((item) => item.id === modelId);
  const available = (routesByModel.get(modelId) ?? []).filter((route) => !boundRoutes.has(route.id));
  const chosen = picked ?? new Set(available.filter((route) => route.enabled).map((route) => route.id));
  const connection = data.connections.find((item) => item.id === connectionId);
  const provider = data.catalog.providers.find((item) => item.code === connection?.providerCode);
  const protocolFor = (route: LlmRoute) => intent ? "openai_chat" : data.catalog.providers.find((spec) => spec.code === data.connections.find((item) => item.id === route.connectionId)?.providerCode)?.protocols[0] ?? "openai_chat";
  const nextPriority = (existing.reduce((max, item) => Math.max(max, item.priority), 0) || 0) + PRIORITY_STEP;

  const priceMismatch = Boolean(inputPrice.trim()) !== Boolean(outputPrice.trim());
  const priceInvalid = [inputPrice, outputPrice].some((value) => value.trim() && !(Number(value) >= 0));
  const validExisting = Boolean(model && chosen.size > 0);
  const validNew = Boolean(name.trim() && connectionId && target.trim() && !priceMismatch && !priceInvalid);

  const bind = async (routes: LlmRoute[]) => {
    let priority = nextPriority;
    for (const route of routes) {
      await api.putLlmBinding(useCase, route.id, { protocolCode: protocolFor(route), priority, enabled: false });
      priority += PRIORITY_STEP;
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "existing") {
        await bind(available.filter((route) => chosen.has(route.id)));
        notify(`已加入 ${chosen.size} 条线路，探测通过后再启用`);
      } else {
        const created = (await api.createLlmModel({ displayName: name.trim(), developerName: developer.trim() || null, userSelectable: assistant ? selectable : true })).model;
        const pricing = inputPrice.trim() ? { currency, input_per_million: inputPrice.trim(), output_per_million: outputPrice.trim() } : null;
        const route = (await api.createLlmRoute({ modelId: Number(created.id), connectionId: Number(connectionId), targetKind: (provider?.targetKinds[0] ?? "model") as LlmRoute["targetKind"], invokeTarget: target.trim(), identifierKind: "pinned", pricing })).route;
        await bind([route]);
        notify("模型已创建并加入场景，探测通过后再启用");
      }
      onSaved();
    } catch (caught) {
      setError(`${llmMessage(caught, "保存失败")}。已完成的步骤会保留，关闭后可以看到当前状态。`);
    } finally {
      setBusy(false);
    }
  };

  const toggleRoute = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  return (
    <Modal
      width={600}
      title={lockedModelId ? `为「${model?.displayName ?? ""}」添加线路` : "添加模型"}
      subtitle={`加入「${useCaseLabel(useCase)}」，排在当前顺序的最后；新线路默认停用，探测通过后再启用`}
      onClose={onClose}
      busy={busy}
      footer={<><Button dismiss disabled={busy}>取消</Button><Button variant="primary" disabled={busy || !(mode === "existing" ? validExisting : validNew)} onClick={() => void submit()}>{busy ? "保存中…" : mode === "existing" ? `加入 ${chosen.size || ""} 条线路`.replace("  ", " ") : "创建并加入"}</Button></>}
    >
      <div className="adm-form">
        {!lockedModelId && <Segmented label="添加方式" value={mode} onChange={(next) => { setMode(next); setError(null); }} options={[{ value: "existing", label: "选择已有模型" }, { value: "new", label: "新建模型" }]} />}
        {mode === "existing" ? (
          <>
            {!lockedModelId && (
              <div className="adm-picker">
                <label className="adm-search adm-picker-search">
                  <Search size={14} aria-hidden="true" />
                  <input ref={searchRef} type="search" value={query} placeholder="搜索模型名称或厂商" aria-label="搜索模型" onChange={(event) => setQuery(event.target.value)} />
                </label>
                <div className="adm-picker-list" role="listbox" aria-label="可加入的模型">
                  {candidates.length === 0 ? <p className="adm-muted adm-picker-empty">{keyword ? "没有匹配的模型；可以切换到“新建模型”" : "所有模型的线路都已加入这个场景"}</p> : candidates.map((item) => {
                    const routes = routesByModel.get(item.id) ?? [];
                    return (
                      <button key={item.id} type="button" role="option" aria-selected={item.id === modelId} className="adm-picker-option" onClick={() => { setModelId(item.id); setPicked(null); }}>
                        <span className="adm-cell-stack"><strong>{item.displayName}</strong><small>{[item.developerName, `${routes.length} 条线路`, `${routes.filter((route) => route.enabled).length} 条已启用`].filter(Boolean).join(" · ")}</small></span>
                        {boundModels.has(item.id) && <Badge tone="info">已在场景中</Badge>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {model && (
              <fieldset className="adm-route-picks">
                <legend>加入哪些线路 <span className="adm-muted">按勾选顺序作为主线路和备用线路</span></legend>
                {available.length === 0 ? <p className="adm-muted">这个模型的线路都已加入。可以在“模型与线路”里为它新建线路。</p> : available.map((route) => {
                  const routeConnection = data.connections.find((item) => item.id === route.connectionId);
                  return (
                    <label key={route.id} className={`adm-route-pick${chosen.has(route.id) ? " is-checked" : ""}`}>
                      <input type="checkbox" checked={chosen.has(route.id)} onChange={() => toggleRoute(route.id)} />
                      <ProviderAvatar size="sm" code={routeConnection?.providerCode ?? ""} label={data.catalog.providers.find((item) => item.code === routeConnection?.providerCode)?.label ?? "?"} />
                      <span className="adm-cell-stack"><strong>{routeConnection?.name ?? `#${route.connectionId}`}</strong><small>#{route.id} · {route.invokeTarget} · {priceText(route.pricing)}</small></span>
                      {!route.enabled && <Badge tone="neutral">线路已停用</Badge>}
                    </label>
                  );
                })}
              </fieldset>
            )}
          </>
        ) : (
          <>
            <div className="adm-form-row">
              <Field label="模型名称" htmlFor="cap-model-name" hint="用户和管理员看到的名字"><input id="cap-model-name" className="adm-input" value={name} maxLength={128} onChange={(event) => setName(event.target.value)} placeholder="例如 DeepSeek V3" /></Field>
              <Field label="厂商" htmlFor="cap-model-dev"><input id="cap-model-dev" className="adm-input" value={developer} maxLength={128} onChange={(event) => setDeveloper(event.target.value)} placeholder="选填" /></Field>
            </div>
            {assistant && (
              <div className="adm-setting-row">
                <div><strong>用户可选</strong><span>开启后，用户可以在对话里选择这个模型</span></div>
                <Toggle label="用户可选" checked={selectable} onChange={setSelectable} />
              </div>
            )}
            <p className="adm-subhead">第一条线路</p>
            <div className="adm-form-row">
              <Field label="接入连接"><SelectBox label="接入连接" value={connectionId} onChange={setConnectionId} options={eligibleConnections.map((item) => ({ value: item.id, label: `${data.catalog.providers.find((spec) => spec.code === item.providerCode)?.label ?? item.providerCode} · ${item.name}` }))} /></Field>
              <Field label="调用目标 ID" htmlFor="cap-target" hint="上游 model / endpoint / deployment ID"><input id="cap-target" className="adm-input" value={target} maxLength={256} onChange={(event) => setTarget(event.target.value)} placeholder="例如 deepseek-chat" /></Field>
            </div>
            <div className="adm-form-row is-three">
              <Field label="输入单价 / 百万 Token" htmlFor="cap-in"><input id="cap-in" className="adm-input" inputMode="decimal" value={inputPrice} onChange={(event) => setInputPrice(event.target.value)} placeholder="0.00" /></Field>
              <Field label="输出单价 / 百万 Token" htmlFor="cap-out"><input id="cap-out" className="adm-input" inputMode="decimal" value={outputPrice} onChange={(event) => setOutputPrice(event.target.value)} placeholder="0.00" /></Field>
              <Field label="币种"><SelectBox label="币种" value={currency} onChange={setCurrency} options={[{ value: "USD", label: "USD" }, { value: "CNY", label: "CNY" }]} /></Field>
            </div>
            {priceMismatch || priceInvalid ? <InlineError>{priceMismatch ? "输入和输出单价需要同时填写" : "单价必须是非负数字"}</InlineError> : <small className="adm-muted">单价可留空。更多线路和目标类型可以之后在“添加线路”里补充。</small>}
          </>
        )}
        {error && <InlineError>{error}</InlineError>}
      </div>
    </Modal>
  );
}
