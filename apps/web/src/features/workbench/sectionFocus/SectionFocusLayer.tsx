import { t } from "@/i18n";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FocusSheet, DiffText, type AppliedEdit, type FocusRequest, type SheetSnapshot } from "./FocusSheet";
import {
  CONTEXT_LIMIT,
  focusUnitsFromDoc,
  matchTarget,
  replaceLineText,
  unitLabel,
  type FocusUnit,
} from "./sectionModel";
import { PenLine } from "lucide-react";
import { addedRanges } from "./textDiff";
import "./section-focus.css";

const COACH_KEY = "linkresume.section-focus.coach.v1";
const QUICK_ASKS = ["分析这段", "突出技术深度", "更有冲击力", "更精简", "补上数据"];
const HIGHLIGHT_NAME = "linkresume-section-focus-added";
/** The entry stays this long after the editor loses focus, so it can still be clicked. */
const BLUR_GRACE = 200;
const GUTTER_GAP = 12;
const CHIP_WIDTH = 236;
const COMPACT_WIDTH = 30;
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

type ChipSpot = { compact: boolean; top: number; left: number };

/**
 * The entry lives outside the editable text: in the grey margin beside the
 * page, or as a compact icon column in the page's own blank right margin.
 * When neither has room there is no entry on the page (⌘K still works); it
 * never sits on top of resume text.
 */
function chipSpot(editor: Editor, scroller: HTMLElement | null, origin: DOMRect, rect: Rect): ChipSpot | null {
  const gutter = gutterLeft(editor, scroller, origin, CHIP_WIDTH, rect.left + rect.width / 2);
  if (gutter !== null) return { compact: false, top: rect.top, left: gutter };
  const contentRight = editor.view.dom.getBoundingClientRect().right - origin.left;
  const margin = paperBox(editor).right - origin.left - contentRight;
  if (margin >= COMPACT_WIDTH + 6) return { compact: true, top: rect.top, left: contentRight + (margin - COMPACT_WIDTH) / 2 };
  return null;
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
  onNotice,
}: {
  editor: Editor;
  resumeId: string;
  scrollRef: RefObject<HTMLElement | null>;
  onNotice: (label: string) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  // The paragraph holding the caret. The entry follows the caret, never the
  // pointer, so nothing reacts to mouse movement over the resume text.
  const [caretId, setCaretId] = useState<string | null>(null);
  const [entryHovered, setEntryHovered] = useState(false);
  const [composerId, setComposerId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
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
  const saveAnalysis = useCallback((unitId: string, snapshot: SheetSnapshot) => {
    analyses.current.set(unitId, snapshot);
  }, []);
  useEffect(() => { analyses.current.clear(); }, [resumeId]);

  useEffect(() => {
    // Every document change, including content replaced without an update event
    // (loading a version, switching templates).
    const bump = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) setRevision((value) => value + 1);
    };
    editor.on("transaction", bump);
    return () => { editor.off("transaction", bump); };
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

  const openFocus = useCallback((unitId: string, intent = "") => {
    setComposerId(null);
    setComposerText("");
    setPaletteOpen(false);
    setEntryHovered(false);
    setLanding(null);
    visitEdits.current = [];
    editor.commands.blur();
    setFocus({ unitId, intent });
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
      if (event.key === "Escape" && (paletteOpen || composerId)) {
        setPaletteOpen(false);
        setComposerId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composerId, editor, focus, paletteOpen, units]);

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
  const composerUnit = unitById(composerId);
  const landingUnit = unitById(landing?.unitId ?? null);
  const landingUnitCount = new Set(landing?.edits.map((edit) => edit.unitId)).size;
  const showEntry = Boolean(caretUnit) && !focus && !composerId && !paletteOpen;
  const caretRect = showEntry && caretUnit && origin ? unitRect(editor, caretUnit, origin) : null;
  const chip = caretRect && origin ? chipSpot(editor, scrollRef.current, origin, caretRect) : null;
  const coachLeft = caretRect && chip && origin && !coachSeen
    ? gutterLeft(editor, scrollRef.current, origin, COACH_WIDTH, caretRect.left + caretRect.width / 2)
    : null;
  const composerRect = composerUnit && origin ? unitRect(editor, composerUnit, origin) : null;
  const landingRect = landingUnit && origin ? unitRect(editor, landingUnit, origin) : null;
  const focusIndex = focus ? units.findIndex((unit) => unit.id === focus.unitId) : -1;
  const nextUnit = landing ? units[units.findIndex((unit) => unit.id === landing.unitId) + 1] ?? null : null;

  return (
    <div ref={layerRef} className="sf-layer">
      {caretRect && caretUnit && chip && (
        <>
          {/* Which paragraph the entry acts on, shown only while pointing at the entry. */}
          {entryHovered && <div className="sf-hover-outline" style={{ top: caretRect.top, left: caretRect.left, width: caretRect.width, height: caretRect.height }} />}
          <div
            className={`sf-hover-actions${chip.compact ? " is-compact" : ""}`}
            // Clicking the entry must not take the caret out of the resume.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setEntryHovered(true)}
            onMouseLeave={() => setEntryHovered(false)}
            style={{ top: chip.top, left: chip.left }}
          >
            <button type="button" onClick={() => openFocus(caretUnit.id)} aria-label={t("聚焦这段")} title={chip.compact ? t("聚焦这段") : undefined}>
              <i className="sf-ring" aria-hidden="true" />
              {!chip.compact && t("聚焦这段")}
            </button>
            <button type="button" onClick={() => { setComposerId(caretUnit.id); setComposerText(""); setEntryHovered(false); dismissCoach(); }} aria-label={t("说说怎么改…")} title={chip.compact ? t("说说怎么改…") : undefined}>
              {chip.compact ? <PenLine size={13} aria-hidden="true" /> : t("说说怎么改…")}
            </button>
          </div>
          {!coachSeen && coachLeft !== null && (
            <div className="sf-coach" role="note" onMouseDown={(event) => event.preventDefault()} style={{ top: caretRect.top + 40, left: coachLeft, width: COACH_WIDTH }}>
              <span className="sf-mono">NEW</span>
              <strong>{t("让 AI 帮你改某一段")}</strong>
              <p>{t("光标停在哪段经历里，页边就会出现这段的入口：点「聚焦这段」让 AI 先看看问题；点「说说怎么改」直接写你的要求。也可以按 ⌘K 一句话直达。")}</p>
              <button type="button" onClick={dismissCoach}>{t("知道了")}</button>
            </div>
          )}
        </>
      )}

      {composerUnit && composerRect && (
        <>
          <div className="sf-selected-outline" style={{ top: composerRect.top, left: composerRect.left, width: composerRect.width, height: composerRect.height }} />
          <form
            className="sf-composer"
            style={{ top: composerRect.top + composerRect.height + 8, left: composerRect.left - 12, width: Math.max(420, composerRect.width + 24) }}
            onSubmit={(event) => {
              event.preventDefault();
              openFocus(composerUnit.id, composerText.trim());
            }}
          >
            <div className="sf-composer-head">
              <i className="sf-ring" aria-hidden="true" />
              <strong>{t("改这一段")}</strong>
              <span className="sf-muted">{unitLabel(composerUnit)}</span>
              <button type="button" className="sf-link sf-muted" onClick={() => setComposerId(null)}>{t("Esc 关闭")}</button>
            </div>
            <input
              autoFocus
              value={composerText}
              maxLength={300}
              onChange={(event) => setComposerText(event.target.value)}
              placeholder={t("想怎么改？比如「帮我分析一下这段，想突出技术深度」")}
              aria-label={t("修改要求")}
            />
            <div className="sf-quick">
              <span className="sf-muted">{t("常用")}</span>
              {QUICK_ASKS.map((label) => (
                <button key={label} type="button" className={composerText === t(label) ? "is-selected" : ""} onClick={() => setComposerText(t(label))}>{t(label)}</button>
              ))}
            </div>
            <div className="sf-composer-foot">
              <span className="sf-mono sf-muted">CONTEXT</span>
              <span className="sf-muted">
                {t("会一并参考：{list}", {
                  list: units.filter((unit) => unit.id !== composerUnit.id).slice(0, CONTEXT_LIMIT).map((unit) => unit.heading || unit.sectionLabel).join("、") || t("无"),
                })}
              </span>
              <button type="submit" className="sf-btn sf-btn-dark">{t("开始 ↵")}</button>
            </div>
          </form>
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
              <dt>{t("参照")}</dt>
              <dd><span className="sf-pill">{t("通用写作标准")}</span><span className="sf-muted">{t("聚焦后可以换成你保存的岗位")}</span></dd>
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
