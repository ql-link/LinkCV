import { t } from "@/i18n";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FocusSheet, DiffText, snapshotNotes, type AppliedEdit, type FocusRequest, type SheetSnapshot } from "./FocusSheet";
import { PageLens, type LensGroup } from "./PageLens";
import {
  focusUnitsFromDoc,
  matchTarget,
  replaceLineText,
  unitLabel,
  type FocusUnit,
} from "./sectionModel";
import { addedRanges } from "./textDiff";
import "./section-focus.css";

const COACH_KEY = "linkresume.section-focus.coach.v1";
const QUICK_ASKS = ["分析这段", "突出技术深度", "更有冲击力", "更精简", "补上数据"];
const HIGHLIGHT_NAME = "linkresume-section-focus-added";
/** The entry stays this long after the editor loses focus, so it can still be clicked. */
const BLUR_GRACE = 200;
const GUTTER_GAP = 12;
/** The command bar under the paragraph frame, at 100% zoom. */
const BAR_HEIGHT = 40;
const BAR_GAP = 6;
/** The bar stays out of the way while the user is typing in the paragraph. */
const TYPING_QUIET = 900;
/** Overlays hide while the canvas zooms and come back once it settles. */
const ZOOM_SETTLE = 140;
const COACH_WIDTH = 260;

type Rect = { top: number; left: number; width: number; height: number };
type Landing = { unitId: string; edits: AppliedEdit[]; recapOpen: boolean };

function readCoachSeen() {
  try { return localStorage.getItem(COACH_KEY) === "1"; } catch { return true; }
}

/** The unit that holds the caret, if any. */
function unitAtSelection(editor: Editor, units: FocusUnit[]): string | null {
  const pos = editor.state.selection.from;
  return units.find((unit) => pos >= unit.from && pos <= unit.to)?.id ?? null;
}

/** Union of the on-screen boxes of a unit's blocks, relative to `origin`. */
function unitRect(editor: Editor, unit: FocusUnit, origin: DOMRect): Rect | null {
  const view = editor.view;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  editor.state.doc.nodesBetween(unit.from, Math.min(unit.to, editor.state.doc.content.size), (node, pos) => {
    if (!node.isTextblock) return true;
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      const box = dom.getBoundingClientRect();
      if (box.height > 0) {
        top = Math.min(top, box.top);
        bottom = Math.max(bottom, box.bottom);
        left = Math.min(left, box.left);
        right = Math.max(right, box.right);
      }
    }
    return false;
  });
  if (!Number.isFinite(top)) return null;
  return { top: top - origin.top - 6, left: left - origin.left - 10, width: right - left + 20, height: bottom - top + 12 };
}

/**
 * Left offset in the grey margin beside the page, so floating UI never sits on
 * top of resume text. Tries the side nearer to `nearX` first; null when
 * neither side has room.
 */
function gutterLeft(editor: Editor, scroller: HTMLElement | null, origin: DOMRect, width: number, nearX: number): number | null {
  const paper = paperBox(editor);
  const bounds = (scroller ?? editor.view.dom).getBoundingClientRect();
  const right = paper.right + GUTTER_GAP + width <= bounds.right - 8 ? paper.right - origin.left + GUTTER_GAP : null;
  const left = paper.left - GUTTER_GAP - width >= bounds.left + 8 ? paper.left - origin.left - GUTTER_GAP - width : null;
  const preferLeft = nearX + origin.left < (paper.left + paper.right) / 2;
  return preferLeft ? left ?? right : right ?? left;
}

function paperBox(editor: Editor) {
  return (editor.view.dom.closest(".resume-paper") ?? editor.view.dom).getBoundingClientRect();
}

type BarSpot = { top: number; left: number; width: number; scale: number; above: boolean };

/**
 * The command bar hangs from the bottom edge of the paragraph frame, as wide
 * as the frame; when there is no room below it moves above. It follows the
 * canvas zoom down to 85% so it stays easy to hit, and never grows past 100%.
 */
function barSpot(scroller: HTMLElement | null, editor: Editor, origin: DOMRect, rect: Rect, zoom: number): BarSpot {
  const scale = Math.min(1, Math.max(0.85, zoom));
  const height = BAR_HEIGHT * scale;
  const view = (scroller ?? editor.view.dom).getBoundingClientRect();
  const bottom = view.bottom - origin.top - 8;
  const below = rect.top + rect.height + BAR_GAP;
  const above = below + height > bottom && rect.top - BAR_GAP - height >= view.top - origin.top + 8;
  return { top: above ? rect.top - BAR_GAP - height : below, left: rect.left, width: rect.width, scale, above };
}

/** Briefly highlight the added words of applied edits on the page. */
function flashEdits(editor: Editor, edits: AppliedEdit[]) {
  const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightCtor) return;
  const ranges: Range[] = [];
  for (const edit of edits) {
    const host = editor.view.dom.querySelector(`[data-resume-block-id="${CSS.escape(edit.lineId)}"]`)?.closest("p, li, h1, h2, h3, h4");
    if (!host) continue;
    // Skip widget text such as the「+」line-insert button; it is not part of the line.
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest('[contenteditable="false"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT),
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const [start, end] of addedRanges(edit.before, edit.after)) {
      let offset = 0;
      for (const node of nodes) {
        const length = node.data.length;
        const from = Math.max(start, offset);
        const to = Math.min(end, offset + length);
        if (from < to) {
          const range = document.createRange();
          range.setStart(node, from - offset);
          range.setEnd(node, to - offset);
          ranges.push(range);
        }
        offset += length;
      }
    }
  }
  if (!ranges.length) return;
  registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
  window.setTimeout(() => registry.delete(HIGHLIGHT_NAME), 1_600);
}

export function SectionFocusLayer({
  editor,
  resumeId,
  scrollRef,
  scale = 1,
  onNotice,
  onLensReserve,
}: {
  editor: Editor;
  resumeId: string;
  scrollRef: RefObject<HTMLElement | null>;
  /** Canvas zoom. The paper is scaled with CSS, which fires no resize, so a change re-measures. */
  scale?: number;
  onNotice: (label: string) => void;
  /** Whether the canvas should keep the page-lens column free on its right. */
  onLensReserve?: (reserve: boolean) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  // The paragraph holding the caret. The entry follows the caret, never the
  // pointer, so nothing reacts to mouse movement over the resume text.
  const [caretId, setCaretId] = useState<string | null>(null);
  const [entryHovered, setEntryHovered] = useState(false);
  // What the user types in the command bar, and the paragraph it is pinned to
  // while the bar's input has focus (the editor's caret is gone by then).
  const [barText, setBarText] = useState("");
  const [barUnitId, setBarUnitId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [zooming, setZooming] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const [coachSeen, setCoachSeen] = useState(readCoachSeen);
  const [, setLayoutTick] = useState(0);
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  // Edits from paragraphs already left via the rail during this focus session.
  const visitEdits = useRef<AppliedEdit[]>([]);
  const visitCount = useRef(0);
  // Finished analyses by paragraph, kept until the page is left; reopening reuses them.
  const analyses = useRef(new Map<string, SheetSnapshot>());
  // Bumped when an analysis is saved, so the page annotations pick it up.
  const [analysesVersion, setAnalysesVersion] = useState(0);
  // Paragraphs whose page notes the user folded away; each folds on its own.
  const [lensCollapsed, setLensCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleLens = useCallback((unitId: string, open: boolean) => {
    setLensCollapsed((current) => {
      const next = new Set(current);
      if (open) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }, []);
  const saveAnalysis = useCallback((unitId: string, snapshot: SheetSnapshot) => {
    analyses.current.set(unitId, snapshot);
    // A fresh look at a paragraph shows its notes again.
    setLensCollapsed((current) => {
      if (!current.has(unitId)) return current;
      const next = new Set(current);
      next.delete(unitId);
      return next;
    });
    setAnalysesVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    analyses.current.clear();
    setAnalysesVersion((value) => value + 1);
  }, [resumeId]);

  useEffect(() => {
    // Every document change, including content replaced without an update event
    // (loading a version, switching templates).
    let quietTimer = 0;
    const bump = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      setRevision((value) => value + 1);
      if (!editor.isFocused) return;
      setTyping(true);
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => setTyping(false), TYPING_QUIET);
    };
    editor.on("transaction", bump);
    return () => {
      window.clearTimeout(quietTimer);
      editor.off("transaction", bump);
    };
  }, [editor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const units = useMemo(() => focusUnitsFromDoc(editor.state.doc), [editor, revision]);
  const unitById = useCallback((id: string | null) => units.find((unit) => unit.id === id) ?? null, [units]);

  // Re-measure overlay positions when the page scrolls or resizes.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const tick = () => setLayoutTick((value) => value + 1);
    const measure = () => {
      setOrigin(layerRef.current?.getBoundingClientRect() ?? null);
      tick();
    };
    measure();
    scroller?.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", measure);
    // Side panels can move the canvas without resizing the window.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (layerRef.current) observer?.observe(layerRef.current);
    if (scroller) observer?.observe(scroller);
    return () => {
      scroller?.removeEventListener("scroll", tick);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [scrollRef]);

  // Zooming moves every paragraph on screen: hide the frame and bar while it
  // happens, then measure again at the new scale.
  const firstScale = useRef(true);
  useLayoutEffect(() => {
    if (firstScale.current) {
      firstScale.current = false;
      return;
    }
    setZooming(true);
    const timer = window.setTimeout(() => {
      setOrigin(layerRef.current?.getBoundingClientRect() ?? null);
      setLayoutTick((value) => value + 1);
      setZooming(false);
    }, ZOOM_SETTLE);
    return () => window.clearTimeout(timer);
  }, [scale]);

  useEffect(() => {
    let blurTimer = 0;
    const sync = () => {
      window.clearTimeout(blurTimer);
      setCaretId(editor.isFocused ? unitAtSelection(editor, units) : null);
    };
    const onBlur = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => setCaretId(null), BLUR_GRACE);
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("focus", sync);
    editor.on("blur", onBlur);
    return () => {
      window.clearTimeout(blurTimer);
      editor.off("selectionUpdate", sync);
      editor.off("focus", sync);
      editor.off("blur", onBlur);
    };
  }, [editor, units]);

  const openFocus = useCallback((unitId: string, intent = "", itemId?: string) => {
    setBarText("");
    setBarUnitId(null);
    setPaletteOpen(false);
    setEntryHovered(false);
    setLanding(null);
    visitEdits.current = [];
    editor.commands.blur();
    setFocus({ unitId, intent, itemId });
  }, [editor]);

  // ⌘K / Ctrl+K opens the one-line palette, aimed at the paragraph holding the caret.
  const [paletteUnit, setPaletteUnit] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !focus) {
        event.preventDefault();
        setPaletteUnit(editor.isFocused ? unitAtSelection(editor, units) : null);
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "Escape" && paletteOpen) setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, focus, paletteOpen, units]);

  const dismissCoach = () => {
    setCoachSeen(true);
    try { localStorage.setItem(COACH_KEY, "1"); } catch { /* private browsing */ }
  };

  /** Edit ids restart in every sheet, so tag them with the visit. */
  const tagVisit = (edits: AppliedEdit[]) => {
    visitCount.current += 1;
    return edits.map((edit) => ({ ...edit, id: `v${visitCount.current}-${edit.id}` }));
  };

  const finishFocus = (edits: AppliedEdit[]) => {
    const current = focus?.unitId;
    setFocus(null);
    if (!current) return;
    const all = [...visitEdits.current, ...tagVisit(edits)];
    visitEdits.current = [];
    if (all.length) {
      const unitId = edits.length ? current : all[all.length - 1].unitId;
      setLanding({ unitId, edits: all, recapOpen: true });
      requestAnimationFrame(() => {
        const node = editor.view.dom.querySelector(`[data-resume-block-id="${CSS.escape(unitId)}"]`);
        node?.scrollIntoView({ block: "center", behavior: "smooth" });
        window.setTimeout(() => flashEdits(editor, all), 320);
      });
    }
  };

  const undoEdit = (edit: AppliedEdit): boolean => {
    const result = replaceLineText(editor.state, edit.lineId, edit.after, edit.before);
    if (typeof result === "string") return false;
    editor.view.dispatch(result);
    return true;
  };

  const undoLanding = (target: AppliedEdit | "all") => {
    if (!landing) return;
    const list = target === "all" ? [...landing.edits].reverse() : [target];
    const kept: AppliedEdit[] = [];
    let blocked = 0;
    for (const edit of list) {
      if (undoEdit(edit)) continue;
      blocked += 1;
      kept.push(edit);
    }
    const removed = new Set(list.filter((edit) => !kept.includes(edit)).map((edit) => edit.id));
    const remaining = landing.edits.filter((edit) => !removed.has(edit.id));
    setLanding(remaining.length ? { ...landing, edits: remaining } : null);
    if (blocked) onNotice(t("有 {n} 处之后又被改过，没有自动撤销。", { n: blocked }));
  };

  const caretUnit = unitById(caretId);
  const landingUnit = unitById(landing?.unitId ?? null);
  const landingUnitCount = new Set(landing?.edits.map((edit) => edit.unitId)).size;
  // Analysis results of every paragraph analysed in this session, in page order.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lensGroups = useMemo<LensGroup[]>(() => units.flatMap((unit) => {
    const snapshot = analyses.current.get(unit.id);
    const notes = snapshot ? snapshotNotes(snapshot, editor) : [];
    return notes.length ? [{ unit, notes }] : [];
  }), [units, editor, analysesVersion, revision]);
  // Reserved from the first analysis on, also while the sheet is open, so the
  // paper moves aside once rather than every time the sheet opens or closes.
  const reserveLens = lensGroups.length > 0;
  useEffect(() => {
    onLensReserve?.(reserveLens);
  }, [onLensReserve, reserveLens]);
  useEffect(() => () => onLensReserve?.(false), [onLensReserve]);
  const showLens = lensGroups.length > 0 && !focus && !(landing?.recapOpen);
  // The bar's own input keeps its paragraph while it has focus.
  const entryUnit = caretUnit ?? unitById(barUnitId);
  const showEntry = Boolean(entryUnit) && !focus && !paletteOpen && !zooming;
  const entryRect = showEntry && entryUnit && origin ? unitRect(editor, entryUnit, origin) : null;
  const bar = entryRect && origin && (!typing || barUnitId) ? barSpot(scrollRef.current, editor, origin, entryRect, scale) : null;
  const coachLeft = entryRect && bar && origin && !coachSeen
    ? gutterLeft(editor, scrollRef.current, origin, COACH_WIDTH, entryRect.left + entryRect.width / 2)
    : null;
  const landingRect = landingUnit && origin ? unitRect(editor, landingUnit, origin) : null;
  const focusIndex = focus ? units.findIndex((unit) => unit.id === focus.unitId) : -1;
  const nextUnit = landing ? units[units.findIndex((unit) => unit.id === landing.unitId) + 1] ?? null : null;

  return (
    <div ref={layerRef} className="sf-layer">
      {showLens && origin && (
        <PageLens
          editor={editor}
          groups={lensGroups}
          origin={origin}
          scroller={scrollRef.current}
          collapsed={lensCollapsed}
          revision={revision}
          onToggle={toggleLens}
          onOpenNote={(unitId, noteId) => openFocus(unitId, "", noteId)}
        />
      )}
      {entryRect && entryUnit && (
        <>
          {/* The paragraph the bar acts on. It never takes clicks, so editing is unaffected. */}
          <div className={`sf-caret-outline${entryHovered || barUnitId ? " is-strong" : ""}`} style={{ top: entryRect.top, left: entryRect.left, width: entryRect.width, height: entryRect.height }} />
          {bar && (
            <form
              className={`sf-bar${bar.above ? " is-above" : ""}`}
              style={{ top: bar.top, left: bar.left, width: bar.width / bar.scale, transform: `scale(${bar.scale})` }}
              // Clicking the bar, except its input, must not take the caret out of the resume.
              onMouseDown={(event) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}
              onMouseEnter={() => setEntryHovered(true)}
              onMouseLeave={() => setEntryHovered(false)}
              onSubmit={(event) => {
                event.preventDefault();
                openFocus(entryUnit.id, barText.trim());
              }}
            >
              <button type="submit" className="sf-bar-focus">
                <i className="sf-ring" aria-hidden="true" />
                {t("聚焦这段")}
              </button>
              <input
                value={barText}
                maxLength={300}
                onChange={(event) => setBarText(event.target.value)}
                onFocus={() => { setBarUnitId(entryUnit.id); dismissCoach(); }}
                onBlur={() => setBarUnitId(null)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  setBarText("");
                  editor.commands.focus();
                }}
                placeholder={t("对这段说点什么，比如「更突出结果」")}
                aria-label={t("对这段的要求")}
              />
              <kbd aria-hidden="true">↵</kbd>
              {barUnitId && !barText && (
                <div className="sf-bar-quick">
                  {QUICK_ASKS.map((label) => (
                    <button key={label} type="button" onClick={() => setBarText(t(label))}>{t(label)}</button>
                  ))}
                </div>
              )}
            </form>
          )}
          {!coachSeen && coachLeft !== null && (
            <div className="sf-coach" role="note" onMouseDown={(event) => event.preventDefault()} style={{ top: entryRect.top, left: coachLeft, width: COACH_WIDTH }}>
              <span className="sf-mono">NEW</span>
              <strong>{t("让 AI 帮你改某一段")}</strong>
              <p>{t("光标停在哪段经历里，这段就会被虚线框住，下方出现指令条：点「聚焦这段」让 AI 先看看问题，或者直接写下要求按回车。也可以按 ⌘K 一句话直达。")}</p>
              <button type="button" onClick={dismissCoach}>{t("知道了")}</button>
            </div>
          )}
        </>
      )}

      {paletteOpen && (
        <CommandPalette
          units={units}
          initialUnitId={paletteUnit}
          onClose={() => setPaletteOpen(false)}
          onConfirm={(unitId, intent) => openFocus(unitId, intent)}
        />
      )}

      {focus && focusIndex >= 0 && (
        <FocusSheet
          key={focus.unitId}
          editor={editor}
          resumeId={resumeId}
          units={units}
          request={focus}
          index={focusIndex}
          cached={analyses.current.get(focus.unitId) ?? null}
          onSave={saveAnalysis}
          onClose={finishFocus}
          onNavigate={(unitId, edits) => {
            visitEdits.current = [...visitEdits.current, ...tagVisit(edits)];
            setFocus({ unitId, intent: "" });
          }}
        />
      )}

      {landing && landingRect && landing.recapOpen && (
        <aside className="sf-recap" style={{ top: landingRect.top, left: landingRect.left + landingRect.width + 16 }} aria-label={t("这段改了什么")}>
          <header>
            <strong>{t("这段改了什么")}</strong>
            <span>{t("{n} 处 · 已采用", { n: landing.edits.length })}</span>
          </header>
          {landing.edits.map((edit, index) => (
            <div key={edit.id} className={`sf-recap-row sf-recap-${edit.kind}`}>
              <span className="sf-num">{index + 1}</span>
              <div>
                <div className="sf-recap-title">
                  <strong>
                    {edit.unitId !== landing.unitId && <span className="sf-muted">{unitById(edit.unitId)?.heading ?? ""} · </span>}
                    {edit.title}
                  </strong>
                  <button type="button" className="sf-link sf-muted" onClick={() => undoLanding(edit)}>{t("撤销")}</button>
                </div>
                <p><DiffText before={edit.before} after={edit.after} withDeleted /></p>
              </div>
            </div>
          ))}
          <footer>{t("绿色底 = 新增或改写的文字；删除线 = 删掉的原文。刷新页面后不能再撤销。")}</footer>
        </aside>
      )}

      {landing && (
        <div className="sf-toast" role="status">
          <i aria-hidden="true">✓</i>
          <span>
            {landingUnitCount > 1
              ? t("{count} 段已更新：采用 {n} 处", { count: landingUnitCount, n: landing.edits.length })
              : t("{unit}已更新：采用 {n} 处", { unit: landingUnit ? `${landingUnit.heading} ` : "", n: landing.edits.length })}
          </span>
          <button type="button" onClick={() => setLanding({ ...landing, recapOpen: !landing.recapOpen })}>{landing.recapOpen ? t("收起改动") : t("查看改动")}</button>
          <button type="button" onClick={() => undoLanding("all")}>{t("全部撤销")}</button>
          {nextUnit && <button type="button" className="is-light" onClick={() => openFocus(nextUnit.id)}>{t("下一段：{name}", { name: nextUnit.heading || nextUnit.sectionLabel })}</button>}
          <button type="button" className="sf-toast-close" aria-label={t("关闭")} onClick={() => setLanding(null)}>×</button>
        </div>
      )}
    </div>
  );
}

function CommandPalette({
  units,
  initialUnitId,
  onClose,
  onConfirm,
}: {
  units: FocusUnit[];
  initialUnitId: string | null;
  onClose: () => void;
  onConfirm: (unitId: string, intent: string) => void;
}) {
  const [query, setQuery] = useState("");
  // The paragraph holding the caret is the target until the sentence names another.
  const [picked, setPicked] = useState<string | null>(initialUnitId);
  const [choosing, setChoosing] = useState(false);
  const match = useMemo(() => matchTarget(query, units), [query, units]);
  const target = picked
    ? units.find((unit) => unit.id === picked) ?? null
    : match.kind === "unique" ? match.unit : null;
  const candidates = choosing || (!target && query.trim()) ? (match.kind === "unique" ? units : match.candidates) : [];

  return (
    <div className="sf-palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className="sf-palette"
        role="dialog"
        aria-label={t("一句话修改")}
        onSubmit={(event) => {
          event.preventDefault();
          if (target) onConfirm(target.id, query.trim());
          else setChoosing(true);
        }}
      >
        <label className="sf-palette-input">
          <i className="sf-ring" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            maxLength={300}
            placeholder={t("一句话说要改哪段、怎么改，比如「帮我改一下美团那段，突出技术深度」")}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              // Naming a paragraph in the sentence overrides the caret one.
              setPicked(initialUnitId && matchTarget(value, units).kind !== "unique" ? initialUnitId : null);
              setChoosing(false);
            }}
          />
          <kbd>Esc</kbd>
        </label>
        {query.trim() && target && !choosing && (
          <div className="sf-understood">
            <span className="sf-mono sf-blue">{t("AI 理解为")}</span>
            <dl>
              <dt>{t("目标")}</dt>
              <dd><button type="button" className="sf-pill" onClick={() => setChoosing(true)}>{unitLabel(target)} ▾</button></dd>
              <dt>{t("要求")}</dt>
              <dd><span className="sf-pill">{query.trim()}</span><span className="sf-muted">{t("来自你的原话")}</span></dd>
              <dt>{t("风格")}</dt>
              <dd><span className="sf-pill">{t("STAR 法则")}</span><span className="sf-muted">{t("聚焦后可以换风格，或选要投递的岗位")}</span></dd>
            </dl>
            <div className="sf-understood-actions">
              <button type="submit" className="sf-btn sf-btn-dark">{t("聚焦并分析这一段 ↵")}</button>
              <span className="sf-muted">{t("不对？点「目标」换一段")}</span>
            </div>
          </div>
        )}
        {!query.trim() && target && !choosing && (
          <div className="sf-palette-current">
            <span className="sf-muted">{t("当前段")}</span>
            <button type="button" className="sf-pill" onClick={() => setChoosing(true)}>{unitLabel(target)} ▾</button>
            <span className="sf-muted">{t("直接回车聚焦这段，或写下要求")}</span>
          </div>
        )}
        {candidates.length > 0 && (
          <div className="sf-candidates">
            <span className="sf-muted">
              {match.kind === "ambiguous" && !choosing ? t("有几段都可能是你说的，选一段：") : !target ? t("没认出是哪一段，选一段：") : t("换成哪一段？")}
            </span>
            <ul>
              {candidates.map((unit) => (
                <li key={unit.id}>
                  <button type="button" onClick={() => { setPicked(unit.id); setChoosing(false); }}>{unitLabel(unit)}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <footer className="sf-palette-foot">
          <span>↵ {t("执行")}</span>
          <span>Esc {t("关闭")}</span>
        </footer>
      </form>
    </div>
  );
}
