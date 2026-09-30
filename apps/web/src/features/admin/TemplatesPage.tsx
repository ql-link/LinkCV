import { useEffect, useRef, useState } from "react";
import { Download, GripVertical, Minus, Plus } from "lucide-react";
import { api, ApiRequestError, type AdminResumeTemplate } from "../../api/client";
import { FileUpload } from "@/components/ui";
import { ResumePreview } from "../preview/ResumePreview";
import {
  Badge,
  Button,
  ConfirmModal,
  ErrorState,
  InlineError,
  ListPanel,
  LoadingRegion,
  Modal,
  MoreMenu,
  PageHeader,
  SearchInput,
  SelectBox,
  SkBar,
  StatusDot,
  TextTabs,
  Toggle,
  errorCode,
  nearestSlot,
  useFlip,
  useConsole,
  useLoad,
} from "./kit";
import { visualScale } from "./viewportScale";

export const STYLE_OPTIONS = ["简约", "经典", "现代", "创意"] as const;
export const USE_CASE_OPTIONS = ["实习", "校招", "社招"] as const;

type StatusTab = "all" | "active" | "inactive" | "invalid";

function categoryText(template: AdminResumeTemplate) {
  if (!template.valid) return { text: "结构无效", tone: "bad" as const };
  if (template.style_review_status === "unsure") return { text: "待讨论", tone: "warn" as const };
  const styles = template.style_categories.join(" / ");
  const cases = template.use_cases.join(" / ");
  if (!styles && !cases) return { text: "未分类", tone: "warn" as const };
  return { text: [styles, cases].filter(Boolean).join(" · "), tone: "neutral" as const };
}

/** Classification export keyed by template key, for review outside the console. */
export function buildClassificationExport(templates: AdminResumeTemplate[]) {
  return {
    schema_version: "template-classification.v3",
    style_categories: [...STYLE_OPTIONS],
    use_case_options: [...USE_CASE_OPTIONS],
    templates: templates.filter((item) => item.active && item.valid).map((item) => ({
      key: item.key,
      name: item.name,
      style_categories: item.style_categories,
      use_cases: item.use_cases,
      style_review_status: item.style_review_status,
      use_case_review_status: item.use_cases.length > 0 ? "classified" : "pending",
    })),
  };
}

function downloadClassification(templates: AdminResumeTemplate[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(buildClassificationExport(templates), null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "template-classification.json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Moves `id` to sit at `targetIndex` in the list. */
export function moveTemplate(ids: string[], id: string, targetIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, id);
  return next;
}

export function TemplatesPage() {
  const { notify } = useConsole();
  const list = useLoad(() => api.listAdminResumeTemplates().then((result) => result.templates));
  const templates = list.data ?? [];
  const [tab, setTab] = useState<StatusTab>("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  // Final index the dragged card will land on; the placeholder is rendered there.
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Card rects captured at drag start. Slots are measured once so the reflowing
  // placeholder can never move the target out from under the pointer.
  const slotsRef = useRef<DOMRect[]>([]);
  // The grid scrolls inside its panel; slots are measured once, so later scrolling is added back.
  const scrollAtStart = useRef(0);
  const gridRef = useRef<HTMLOListElement>(null);
  const flip = useFlip(gridRef);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [busyToggle, setBusyToggle] = useState<string | null>(null);

  const counts = {
    all: templates.length,
    active: templates.filter((item) => item.active).length,
    inactive: templates.filter((item) => !item.active && item.valid).length,
    invalid: templates.filter((item) => !item.valid).length,
  };

  const visible = templates.filter((item) => {
    if (tab === "active" && !item.active) return false;
    if (tab === "inactive" && (item.active || !item.valid)) return false;
    if (tab === "invalid" && item.valid) return false;
    if (category === "__none" && (item.style_categories.length || item.use_cases.length || item.style_review_status === "unsure")) return false;
    if (category === "__unsure" && item.style_review_status !== "unsure") return false;
    if (category && !category.startsWith("__") && !item.style_categories.includes(category) && !item.use_cases.includes(category)) return false;
    const search = query.trim().toLowerCase();
    return !search || `${item.name} ${item.key}`.toLowerCase().includes(search);
  });
  // Reordering a filtered subset would silently shuffle hidden cards, so drag only works on the full list.
  const canReorder = tab === "all" && !query.trim() && !category && !saving;
  // The grid is re-keyed by this so a filter change replays the card entrance; drags and toggles keep it.
  const filterKey = `${tab}|${query.trim()}|${category}`;

  const saveOrder = async (ids: string[]) => {
    const previous = templates;
    const byId = new Map(templates.map((item) => [item.id, item]));
    list.setData(ids.map((id) => byId.get(id)!).filter(Boolean));
    setSaving(true);
    try {
      const result = await api.reorderAdminResumeTemplates(ids);
      list.setData(result.templates);
      notify("展示顺序已保存");
    } catch (error) {
      list.setData(previous);
      if (error instanceof ApiRequestError && error.message === "TEMPLATE_ORDER_STALE") {
        notify("模板列表已被其他管理员修改，已重新加载", "error");
        void list.reload();
      } else {
        notify(`排序保存失败：${errorCode(error)}`, "error");
      }
    } finally {
      setSaving(false);
    }
  };

  const ids = templates.map((item) => item.id);
  // While dragging, the list already shows the prospective order with a placeholder in the target slot.
  const displayIds = dragId && dropIndex != null ? moveTemplate(ids, dragId, dropIndex) : ids;
  const byId = new Map(templates.map((item) => [item.id, item]));

  const startDrag = (event: React.DragEvent, template: AdminResumeTemplate) => {
    if (!canReorder) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", template.id);
    const cards = [...(gridRef.current?.querySelectorAll<HTMLElement>(":scope > .adm-template-card") ?? [])];
    slotsRef.current = cards.map((card) => card.getBoundingClientRect());
    scrollAtStart.current = gridRef.current?.closest(".adm-list-body")?.scrollTop ?? 0;
    // Defer so the browser snapshots the real card as the drag image, not the placeholder.
    window.requestAnimationFrame(() => {
      flip.capture();
      setDragId(template.id);
      setDropIndex(ids.indexOf(template.id));
    });
  };

  const trackDrag = (event: React.DragEvent) => {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const body = gridRef.current?.closest<HTMLElement>(".adm-list-body");
    // scrollTop is layout px while slots and the pointer are on-screen px (viewport zoom).
    const scrolled = ((body?.scrollTop ?? 0) - scrollAtStart.current) * visualScale(body);
    const slot = nearestSlot(slotsRef.current, event.clientX, event.clientY + scrolled);
    if (slot != null && slot !== dropIndex) {
      flip.capture();
      setDropIndex(slot);
    }
  };

  const endDrag = () => {
    flip.capture();
    setDragId(null);
    setDropIndex(null);
  };

  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    if (!dragId || dropIndex == null) return endDrag();
    const from = ids.indexOf(dragId);
    const target = dropIndex;
    const moved = dragId;
    endDrag();
    if (target !== from) void saveOrder(moveTemplate(ids, moved, target));
  };

  const keyboardMove = (template: AdminResumeTemplate, delta: number) => {
    const from = ids.indexOf(template.id);
    const target = from + delta;
    if (target < 0 || target >= ids.length) return;
    flip.capture();
    void saveOrder(moveTemplate(ids, template.id, target));
  };

  const toggle = async (template: AdminResumeTemplate, next: boolean) => {
    setBusyToggle(template.id);
    try {
      const result = await api.updateAdminResumeTemplateStatus(template.id, next);
      list.setData(templates.map((item) => item.id === template.id ? result.template : item));
      notify(next ? "模板已启用" : "模板已停用");
    } catch (error) {
      notify(`状态更新失败：${errorCode(error)}`, "error");
    } finally {
      setBusyToggle(null);
    }
  };

  const remove = async (template: AdminResumeTemplate) => {
    await api.deleteAdminResumeTemplate(template.id);
    list.setData(templates.filter((item) => item.id !== template.id));
    setDetailId(null);
    notify("模板已删除");
  };

  const replace = (updated: AdminResumeTemplate) => list.setData(templates.map((item) => item.id === updated.id ? updated : item));

  return (
    <>
      <PageHeader
        title="简历模板"
        hint="拖动卡片调整展示顺序，松手即保存"
        actions={<><MoreMenu label="更多模板操作" items={[{ label: "导出分类", icon: Download, disabled: !templates.length, onSelect: () => downloadClassification(templates) }]} /><Button variant="primary" onClick={() => setImporting(true)}>导入模板</Button></>}
      />
      <ListPanel label="模板" resetKey={filterKey} toolbar={(
        <>
        <div className="adm-filterbar">
          <TextTabs
            label="模板状态"
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "全部", count: counts.all },
              { value: "active", label: "已启用", count: counts.active },
              { value: "inactive", label: "已停用", count: counts.inactive },
              { value: "invalid", label: "结构无效", count: counts.invalid },
            ]}
          />
          <div className="adm-toolbar-right">
            <SearchInput value={query} onChange={setQuery} placeholder="搜索名称或 key" width={220} />
            <SelectBox
              label="模板分类"
              value={category}
              onChange={setCategory}
              options={[
                { value: "", label: "全部分类" },
                ...STYLE_OPTIONS.map((value) => ({ value, label: `风格 · ${value}` })),
                ...USE_CASE_OPTIONS.map((value) => ({ value, label: `场景 · ${value}` })),
                { value: "__unsure", label: "待讨论" },
                { value: "__none", label: "未分类" },
              ]}
            />
          </div>
        </div>
        {!canReorder && !saving && templates.length > 0 && <p className="adm-hint-line">筛选或搜索时不能拖动排序，切回“全部”后再调整。</p>}
        </>
      )}>

      {list.loading && !list.data ? (
        <LoadingRegion label="正在加载模板…">
          <div className="adm-template-grid">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="adm-template-card is-skeleton"><div className="adm-template-preview" /><div className="adm-template-info"><SkBar width="70%" /><SkBar width="45%" /></div></div>
            ))}
          </div>
        </LoadingRegion>
      ) : list.error ? <ErrorState code={list.error} onRetry={() => void list.reload()} /> : visible.length === 0 ? (
        <div className="adm-state"><strong>{templates.length ? "没有符合条件的模板" : "还没有模板"}</strong>{!templates.length && <Button variant="primary" onClick={() => setImporting(true)}>导入模板</Button>}</div>
      ) : (
        <ol key={filterKey} ref={gridRef} className={`adm-template-grid${dragId ? " is-dragging" : ""}`} aria-label="模板列表" aria-busy={saving} onDragOver={trackDrag} onDrop={drop}>
          {(dragId ? displayIds.map((id) => byId.get(id)!) : visible).map((template, position) => {
            if (template.id === dragId) return <li key={template.id} className="adm-template-card is-placeholder" data-flip={template.id} aria-hidden="true" />;
            const index = ids.indexOf(template.id);
            const category = categoryText(template);
            return (
              <li
                key={template.id}
                data-flip={template.id}
                style={{ "--adm-i": Math.min(position, 14) } as React.CSSProperties}
                className={`adm-template-card${!template.valid ? " is-invalid" : ""}`}
                draggable={canReorder}
                onDragStart={(event) => startDrag(event, template)}
                onDragEnd={endDrag}
              >
                <button type="button" className="adm-template-open" onClick={() => setDetailId(template.id)} aria-label={`查看${template.name}详情`}>
                  <span className="adm-template-preview">
                    {template.valid && template.data && template.style ? (
                      <span className="adm-template-paper" aria-hidden="true"><ResumePreview data={template.data} style={template.style} layoutPlan={template.layout_plan} /></span>
                    ) : <span className="adm-template-unavailable">无法预览</span>}
                  </span>
                </button>
                {canReorder && (
                  <span
                    className="adm-template-grip"
                    role="button"
                    tabIndex={0}
                    aria-label={`调整${template.name}的顺序，使用方向键移动`}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); keyboardMove(template, -1); }
                      if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); keyboardMove(template, 1); }
                    }}
                  >
                    <GripVertical size={14} />
                  </span>
                )}
                {/* V4 03: order · name / category · switch under the paper; the switch carries the state. */}
                <div className="adm-template-info">
                  <span className="adm-template-order" aria-hidden="true">{String((dragId ? displayIds.indexOf(template.id) : index) + 1).padStart(2, "0")}</span>
                  <span className="adm-template-name">
                    <strong title={template.name}>{template.name}</strong>
                    <span className={`adm-tone-${category.tone}`}>{category.text}</span>
                  </span>
                    <Toggle
                      label={`${template.active ? "停用" : "启用"}${template.name}`}
                      checked={template.active}
                      disabled={busyToggle === template.id || (!template.valid && !template.active)}
                      onChange={(next) => void toggle(template, next)}
                    />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      </ListPanel>

      {detailId && (
        <TemplateDetailModal
          templates={templates}
          templateId={detailId}
          onSelect={setDetailId}
          onClose={() => setDetailId(null)}
          onChange={replace}
          onToggle={toggle}
          onDelete={remove}
        />
      )}
      {importing && <ImportTemplateModal onClose={() => setImporting(false)} onImported={() => { setImporting(false); void list.reload(); }} />}
    </>
  );
}

function TemplateDetailModal({
  templates,
  templateId,
  onSelect,
  onClose,
  onChange,
  onToggle,
  onDelete,
}: {
  templates: AdminResumeTemplate[];
  templateId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onChange: (template: AdminResumeTemplate) => void;
  onToggle: (template: AdminResumeTemplate, next: boolean) => Promise<void>;
  onDelete: (template: AdminResumeTemplate) => Promise<void>;
}) {
  const index = templates.findIndex((item) => item.id === templateId);
  const template = templates[index];
  const [zoom, setZoom] = useState(0.62);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const classified = templates.filter((item) => item.valid && item.style_review_status === "classified").length;
  const validCount = templates.filter((item) => item.valid).length;

  useEffect(() => { setSaved(false); setSaveError(null); setDeleteError(null); }, [templateId]);
  if (!template) return null;

  const save = async (styleCategories: string[], useCases: string[], status: AdminResumeTemplate["style_review_status"]) => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.updateAdminResumeTemplateClassification(template.id, {
        style_categories: STYLE_OPTIONS.filter((value) => styleCategories.includes(value)),
        use_cases: USE_CASE_OPTIONS.filter((value) => useCases.includes(value)),
        style_review_status: status,
      });
      onChange(result.template);
      setSaved(true);
    } catch (error) {
      setSaveError(`分类保存失败：${errorCode(error)}，当前选择未生效。`);
    } finally {
      setSaving(false);
    }
  };

  const toggleStyle = (value: string) => {
    const next = template.style_categories.includes(value)
      ? template.style_categories.filter((item) => item !== value)
      : [...template.style_categories, value];
    void save(next, template.use_cases, next.length ? "classified" : "pending");
  };
  const toggleCase = (value: string) => {
    const next = template.use_cases.includes(value) ? template.use_cases.filter((item) => item !== value) : [...template.use_cases, value];
    void save(template.style_categories, next, template.style_review_status);
  };
  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(template);
    } catch (error) {
      const code = errorCode(error);
      setDeleteError(code === "TEMPLATE_IN_USE" ? "该模板已被用户简历或导入任务使用，不能删除；如需下线请关闭“对用户展示”。" : `删除失败：${code}`);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };
  const toggleUnsure = () => void save([], template.use_cases, template.style_review_status === "unsure" ? "pending" : "unsure");

  return (
    <Modal
      width={1040}
      onClose={onClose}
      title={<span className="adm-title-row">{template.name}<Badge tone={!template.valid ? "bad" : template.active ? "ok" : "neutral"}>{!template.valid ? "结构无效" : template.active ? "已启用" : "已停用"}</Badge></span>}
      subtitle={`${template.key} · ID ${template.id} · 第 ${index + 1} / ${templates.length} 位`}
      footer={(
        <>
          <span className="adm-foot-note">分类选择后立即保存 · 已分类 {classified} / {validCount}</span>
          <Button disabled={index <= 0} onClick={() => onSelect(templates[index - 1].id)}>← 上一个</Button>
          <Button disabled={index >= templates.length - 1} onClick={() => onSelect(templates[index + 1].id)}>下一个 →</Button>
          <Button variant="primary" dismiss>完成</Button>
        </>
      )}
    >
      <div className="adm-template-detail">
        <div className="adm-template-canvas">
          {template.valid && template.data && template.style ? (
            <div className="adm-template-full" style={{ zoom }}><ResumePreview data={template.data} style={template.style} layoutPlan={template.layout_plan} mode="full" /></div>
          ) : <div className="adm-state"><strong>结构无效，无法预览</strong><code>{template.validation_error ?? "TEMPLATE_SCHEMA_INVALID"}</code></div>}
          {template.valid && (
            <div className="adm-zoom" role="group" aria-label="预览缩放">
              <button type="button" aria-label="缩小" onClick={() => setZoom((value) => Math.max(0.4, +(value - 0.1).toFixed(2)))}><Minus size={12} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="放大" onClick={() => setZoom((value) => Math.min(1.2, +(value + 0.1).toFixed(2)))}><Plus size={12} /></button>
            </div>
          )}
        </div>
        <div className="adm-template-side">
          <div className="adm-setting-row">
            <div><strong>对用户展示</strong><span>{template.valid ? "结构有效 · 关闭后用户新建简历时不再看到" : "结构无效的模板不能启用"}</span></div>
            <Toggle label="对用户展示" checked={template.active} disabled={!template.valid && !template.active} onChange={(next) => void onToggle(template, next)} />
          </div>
          <fieldset className="adm-chip-group" disabled={saving || !template.valid}>
            <legend>风格（可多选）</legend>
            <div>
              {STYLE_OPTIONS.map((value) => <button key={value} type="button" aria-pressed={template.style_categories.includes(value)} onClick={() => toggleStyle(value)}>{value}</button>)}
            </div>
            <div className="adm-chip-extra">
              <button type="button" aria-pressed={template.style_review_status === "unsure"} onClick={toggleUnsure}>待讨论</button>
              <small>与风格互斥</small>
            </div>
          </fieldset>
          <fieldset className="adm-chip-group" disabled={saving || !template.valid}>
            <legend>适用场景（可多选）</legend>
            <div>
              {USE_CASE_OPTIONS.map((value) => <button key={value} type="button" aria-pressed={template.use_cases.includes(value)} onClick={() => toggleCase(value)}>{value}</button>)}
            </div>
            <small>通用模板可选择多个场景；无法判断时可暂时留空。</small>
          </fieldset>
          <div aria-live="polite">
            {saving ? <span className="adm-muted">正在保存…</span> : saveError ? <InlineError>{saveError}</InlineError> : saved ? <StatusDot tone="ok">已自动保存</StatusDot> : null}
          </div>
          {template.description && <p className="adm-template-desc">{template.description}</p>}
          <div className="adm-setting-row adm-template-danger">
            <div><strong>删除模板</strong><span>仅未被任何简历使用的模板可以删除，删除后不可恢复</span></div>
            <Button variant="danger" disabled={deleting} onClick={() => setConfirmingDelete(true)}>删除</Button>
          </div>
          {deleteError && <InlineError>{deleteError}</InlineError>}
        </div>
      </div>
      {confirmingDelete && (
        <ConfirmModal
          title="删除模板？"
          confirmLabel="删除"
          busyLabel="删除中…"
          danger
          busy={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void confirmDelete()}
        >
          确定要删除“{template.name}”（{template.key}）吗？此操作不可恢复。
        </ConfirmModal>
      )}
    </Modal>
  );
}

function ImportTemplateModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { notify } = useConsole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await api.importAdminResumeTemplate(file);
      notify("模板已导入，默认保持停用");
      onImported();
    } catch (caught) {
      const code = errorCode(caught, "TEMPLATE_IMPORT_FAILED");
      setError(code === "TEMPLATE_KEY_CONFLICT" ? "导入失败：已有相同 key 的模板，不会覆盖" : code === "INVALID_TEMPLATE_PACKAGE" ? "导入失败：模板包结构校验未通过" : `导入失败：${code}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal width={520} title="导入模板" subtitle="严格 JSON 模板包；导入后默认停用" onClose={onClose} busy={busy} footer={<Button dismiss disabled={busy}>取消</Button>}>
      <FileUpload
        accept="application/json,.json"
        inputLabel="选择 JSON 模板包"
        supportingText="拖拽 JSON 模板包到这里，或点击选择文件；选择后立即校验并导入"
        disabled={busy}
        browseLabel={busy ? "正在导入…" : "选择文件"}
        onFileSelect={(file) => { if (file) void upload(file); }}
      />
      {error && <InlineError>{error}</InlineError>}
    </Modal>
  );
}
