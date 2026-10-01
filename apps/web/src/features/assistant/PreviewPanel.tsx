import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { api, ApiRequestError, type DatasetContent, type ResumeRecord } from "../../api/client";
import { datasetsPath, editorPath, navigateTo } from "../../routing";
import { Icon, type V3IconName } from "../../v3/Icon";
import { BeTag, Menu } from "../../v3/primitives";
import { renderDatasetMarkdown } from "../datasets/datasetMarkdown";
import { ResumePreview } from "../preview/ResumePreview";
import { useExitPresence } from "../../components/ui/motion";

export type GeneratedDocument = { kind: "generated"; id: string; label: string; content: string; saved?: boolean };
export type ScreenshotAttachment = { kind: "image"; id: string; label: string; url: string };
export type PreviewTab =
  | { kind: "resume"; id: string; label: string; pendingChanges?: string[] }
  | { kind: "dataset"; id: string; label: string; excerpts?: string[] }
  | GeneratedDocument
  | ScreenshotAttachment;
export const MAX_PREVIEW_TABS = 6;
export function previewTabKey(tab: Pick<PreviewTab, "kind" | "id">) { return `${tab.kind}:${tab.id}`; }
export function openPreviewTab(tabs: PreviewTab[], tab: PreviewTab) {
  const existing = tabs.findIndex((item) => previewTabKey(item) === previewTabKey(tab));
  if (existing >= 0) {
    if (Object.entries(tab).every(([key, value]) => (tabs[existing] as unknown as Record<string, unknown>)[key] === value)) return tabs;
    return tabs.map((item, index) => index === existing ? { ...item, ...tab } : item);
  }
  return [...tabs, tab].slice(-MAX_PREVIEW_TABS);
}
function tabIcon(tab: PreviewTab): V3IconName {
  if (tab.kind === "resume") return "resume";
  if (tab.kind === "generated") return "spark";
  return tab.kind === "image" || /\.(png|jpe?g|gif|webp|svg)$/iu.test(tab.label) ? "image" : "doc";
}
const isMissing = (error: unknown) => error instanceof ApiRequestError && ([403, 404].includes(error.status) || /NOT_FOUND|FORBIDDEN|ACCESS_DENIED/.test(error.message));
type Loaded<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; missing: boolean };
function useLoad<T>(key: string, load: () => Promise<T>, reload: number, onUnavailable: () => void) {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    load().then(
      (value) => { if (!cancelled) setState({ status: "ready", value }); },
      (error: unknown) => {
        if (cancelled) return;
        const missing = isMissing(error);
        setState({ status: "error", missing });
        if (missing) unavailableRef.current();
      },
    );
    return () => { cancelled = true; };
    // The resource identity and explicit reload, not callback identity, control fetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);
  return state;
}
function PreviewState({ kind, onRetry, onDownload }: { kind: "loading" | "missing" | "failed" | "unsupported"; onRetry?: () => void; onDownload?: () => void }) {
  if (kind === "loading") return <div className="assistant-preview-state" role="status"><span className="assistant-preview-skeleton" style={{ width: "60%" }} /><span className="assistant-preview-skeleton" style={{ width: "88%" }} /><span className="assistant-preview-skeleton" style={{ width: "74%" }} /><span className="v3-visually-hidden">正在加载预览…</span></div>;
  return <div className="assistant-preview-state is-box" role="status">
    <strong>{kind === "missing" ? "这个文件已不可用" : kind === "unsupported" ? "暂不支持预览此格式" : "预览加载失败"}</strong>
    <small>{kind === "missing" ? "它可能已从资料库删除，或已被移动。对话中的引用会保留为灰色、不可点击。" : kind === "unsupported" ? "Word 等格式请下载后查看；AI 已读取其中的文字内容。" : "网络异常或文件解析未完成，可以稍后重试。"}</small>
    {kind === "failed" && <button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={onRetry}>重试</button>}
    {kind === "unsupported" && <button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={onDownload}><Icon name="dl" size={13} />下载文件</button>}
  </div>;
}
function HighlightedContent({ children, excerpts = [], pending = false }: { children: React.ReactNode; excerpts?: string[]; pending?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || excerpts.length === 0) return;
    const matches = Array.from(root.querySelectorAll<HTMLElement>("p, li")).filter((node) => excerpts.some((text) => text.trim() && node.textContent?.includes(text.trim())));
    matches.forEach((node) => { node.classList.add(pending ? "assistant-preview-pending" : "assistant-preview-quoted"); if (!pending) node.dataset.citation = "已引用"; });
    matches[0]?.scrollIntoView?.({ block: "center" });
    return () => matches.forEach((node) => { node.classList.remove("assistant-preview-pending", "assistant-preview-quoted"); delete node.dataset.citation; });
  }, [children, excerpts, pending]);
  return <div ref={ref}>{children}</div>;
}
function ResumeBody({ tab, reload, onRetry, onUnavailable }: { tab: Extract<PreviewTab, { kind: "resume" }>; reload: number; onRetry: () => void; onUnavailable: () => void }) {
  const state = useLoad<ResumeRecord>(`resume:${tab.id}`, () => api.getResume(tab.id).then((result) => result.resume), reload, onUnavailable);
  if (state.status === "loading") return <PreviewState kind="loading" />;
  if (state.status === "error") return <PreviewState kind={state.missing ? "missing" : "failed"} onRetry={onRetry} />;
  return <div className="assistant-preview-resume"><HighlightedContent excerpts={tab.pendingChanges} pending><ResumePreview data={state.value.data} style={state.value.style} layoutPlan={state.value.layout_plan} mode="full" /></HighlightedContent></div>;
}
function ImageBody({ url, label }: { url: string; label: string }) {
  const [zoom, setZoom] = useState(100);
  const [failed, setFailed] = useState(false);
  return <div className="assistant-preview-image">
    <div className="assistant-preview-image-tools"><button type="button" className="v3-icon-btn" aria-label="缩小图片" disabled={zoom <= 25} onClick={() => setZoom((value) => Math.max(25, value - 25))}>−</button><button type="button" className="v3-btn v3-btn-text" onClick={() => setZoom(100)} aria-label="恢复图片大小">{zoom}%</button><button type="button" className="v3-icon-btn" aria-label="放大图片" disabled={zoom >= 300} onClick={() => setZoom((value) => Math.min(300, value + 25))}>+</button></div>
    {failed ? <PreviewState kind="failed" onRetry={() => setFailed(false)} /> : <div className="assistant-preview-image-scroll"><img src={url} alt={label} style={{ width: `${zoom}%` }} onError={() => setFailed(true)} /></div>}
  </div>;
}
function DatasetImage({ id, label, reload, onRetry, onUnavailable }: { id: string; label: string; reload: number; onRetry: () => void; onUnavailable: () => void }) {
  const state = useLoad<Blob>(`image:${id}`, () => api.downloadDatasetSource(id), reload, onUnavailable);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (state.status !== "ready") { setUrl(""); return; }
    const next = URL.createObjectURL(state.value); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [state]);
  if (state.status === "error") return <PreviewState kind={state.missing ? "missing" : "failed"} onRetry={onRetry} />;
  if (!url) return <PreviewState kind="loading" />;
  return <ImageBody url={url} label={label} />;
}
function DatasetBody({ tab, reload, onRetry, onUnavailable, onNotice }: { tab: Extract<PreviewTab, { kind: "dataset" }>; reload: number; onRetry: () => void; onUnavailable: () => void; onNotice: (message: string) => void }) {
  const state = useLoad<DatasetContent>(`dataset:${tab.id}`, () => api.getDatasetContent(tab.id), reload, onUnavailable);
  const html = useMemo(() => state.status === "ready" ? renderDatasetMarkdown(state.value.markdown) : "", [state]);
  if (state.status === "loading") return <PreviewState kind="loading" />;
  if (state.status === "error") return <PreviewState kind={state.missing ? "missing" : "failed"} onRetry={onRetry} />;
  if (!/^(md|markdown|txt|pdf)$/iu.test(state.value.file_format)) return <PreviewState kind="unsupported" onDownload={() => void api.downloadDatasetSource(tab.id).then((blob) => {
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = tab.label; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch((error: unknown) => { if (isMissing(error)) onUnavailable(); else onNotice("文件下载失败，请稍后重试。"); })} />;
  return <HighlightedContent excerpts={tab.excerpts}><div className="assistant-preview-markdown" dangerouslySetInnerHTML={{ __html: html }} /></HighlightedContent>;
}
export function PreviewPanel({ tabs, activeKey, width = 520, onWidthChange, onActivate, onCloseTab, onClose, onUnavailable = () => undefined, onSaveGenerated, onNotice = () => undefined }: {
  tabs: PreviewTab[]; activeKey: string | null; width?: number; onWidthChange?: (width: number) => void; onActivate: (key: string) => void; onCloseTab: (key: string) => void; onClose: () => void; onUnavailable?: (key: string) => void; onSaveGenerated?: (id: string) => void; onNotice?: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const present = useExitPresence(panelRef);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const active = tabs.find((tab) => previewTabKey(tab) === activeKey) ?? tabs[tabs.length - 1] ?? null;
  useEffect(() => {
    if (!present) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".v3-overlay, .v3-menu")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose, present]);
  if (!active) return null;
  const unavailable = () => onUnavailable(previewTabKey(active));
  const retry = () => setReload((value) => value + 1);
  const resize = (event: PointerEvent<HTMLDivElement>) => { if (dragRef.current) onWidthChange?.(Math.max(400, Math.min(720, dragRef.current.width + dragRef.current.x - event.clientX))); };
  const isImage = active.kind === "dataset" && /\.(png|jpe?g|gif|webp|svg)$/iu.test(active.label);
  return <>
    <button className="assistant-preview-backdrop ui-motion-overlay" data-state={present ? "open" : "closed"} inert={!present || undefined} aria-hidden={!present || undefined} aria-label="关闭文件预览抽屉" onClick={onClose} />
    <aside ref={panelRef} className={`assistant-preview ui-motion-drawer${expanded ? " is-expanded" : ""}`} data-state={present ? "open" : "closed"} inert={!present || undefined} aria-hidden={!present || undefined} style={{ width: expanded ? undefined : width }} aria-label="文件预览">
      {!expanded && <div className="assistant-preview-resize" role="separator" aria-label="调整预览宽度" aria-orientation="vertical" aria-valuemin={400} aria-valuemax={720} aria-valuenow={width} tabIndex={0} onPointerDown={(event) => { dragRef.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={resize} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); onWidthChange?.(Math.max(400, Math.min(720, width + (event.key === "ArrowLeft" ? 20 : -20)))); }} />}
      <header className="assistant-preview-head">
        <div className="assistant-preview-tabs" role="tablist" aria-label="已打开的文件">{tabs.map((tab) => {
          const key = previewTabKey(tab); const selected = key === previewTabKey(active);
          return <div key={key} className={`assistant-preview-tab${selected ? " is-active" : ""}`} title={tab.label}><button type="button" role="tab" aria-selected={selected} onClick={() => onActivate(key)}><Icon name={tabIcon(tab)} size={13} /><span>{tab.label}</span></button><button type="button" className="assistant-preview-tab-close" aria-label={`关闭 ${tab.label}`} onClick={() => onCloseTab(key)}><Icon name="x" size={12} /></button></div>;
        })}</div>
        <div className="assistant-preview-actions">
          <button ref={moreRef} type="button" className="v3-icon-btn" aria-label="更多操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="more" size={15} /></button>
          <Menu anchorRef={moreRef} open={menuOpen} onClose={() => setMenuOpen(false)} placement="bottom-end" label="预览操作" items={[{ label: "重新加载", icon: "refresh", onSelect: retry }, { label: "关闭其他标签", icon: "x", disabled: tabs.length < 2, onSelect: () => tabs.filter((tab) => previewTabKey(tab) !== previewTabKey(active)).forEach((tab) => onCloseTab(previewTabKey(tab))) }]} />
          <button type="button" className="v3-icon-btn" aria-label={expanded ? "恢复面板大小" : "全屏查看"} aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}><Icon name="expand" size={15} /></button>
          <button type="button" className="v3-icon-btn" aria-label="关闭预览" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>
      </header>
      <div className="assistant-preview-body" key={previewTabKey(active)}>
        {active.kind === "resume" && <ResumeBody tab={active} reload={reload} onRetry={retry} onUnavailable={unavailable} />}
        {active.kind === "dataset" && (isImage ? <DatasetImage id={active.id} label={active.label} reload={reload} onRetry={retry} onUnavailable={unavailable} /> : <DatasetBody tab={active} reload={reload} onRetry={retry} onUnavailable={unavailable} onNotice={onNotice} />)}
        {active.kind === "image" && <ImageBody url={active.url} label={active.label} />}
        {active.kind === "generated" && <div className="assistant-preview-markdown assistant-preview-generated" dangerouslySetInnerHTML={{ __html: renderDatasetMarkdown(active.content) }} />}
      </div>
      <footer className="assistant-preview-foot">
        <span>{active.kind === "resume" ? (active.pendingChanges?.length ? `${active.pendingChanges.length} 处待确认修改已在简历中标出` : "只读预览 · 编辑请在编辑器中打开") : active.kind === "dataset" ? (active.excerpts?.length ? `只读预览 · AI 本次引用了 ${active.excerpts.length} 条内容` : "只读预览 · AI 已读取其中的文字内容") : active.kind === "image" ? "截图 · 仅在本次对话中可见" : active.saved ? "已保存到 资料库 / AI 文档（本地模拟）" : "未保存 · 仅在本次对话中可见"}</span>
        {active.kind === "generated" ? <><button type="button" className="v3-btn v3-btn-text" onClick={() => void navigator.clipboard.writeText(active.content).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => onNotice("复制失败，请允许剪贴板访问后重试。"))}><Icon name="copy" size={13} />{copied ? "已复制" : "复制"}</button><button type="button" className="v3-btn v3-btn-dark" disabled={active.saved} onClick={() => onSaveGenerated?.(active.id)}>{active.saved ? "已保存" : "保存到资料库"}</button><BeTag /></> : active.kind !== "image" && <button type="button" className="v3-btn v3-btn-ghost" onClick={() => navigateTo(active.kind === "resume" ? editorPath(active.id) : datasetsPath())}><Icon name="ext" size={13} />{active.kind === "resume" ? "在编辑器中打开" : "在资料库中打开"}</button>}
      </footer>
    </aside>
  </>;
}
